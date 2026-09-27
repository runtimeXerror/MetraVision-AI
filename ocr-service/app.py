"""
── THE OCR SIDECAR ─────────────────────────────────────────────────────────

    POST /ocr        multipart image  →  text, boxes, confidence
    GET  /health     readiness, for the backend's configuration check

Why a separate process at all: PaddleOCR is Python, and the backend is
TypeScript. The alternative — porting the backend, or shelling out to a
Python script per request — would either rewrite a working system or pay the
model-load cost on every scan. A long-lived sidecar holds the weights in
memory and answers over HTTP, and the backend needs to know nothing about
Paddle beyond this contract.

This service decides nothing about compliance. It does not know what an MRP
is, which declarations the law requires, or what a missing one means. It
reads pixels and returns text with coordinates. Every judgement belongs to the
rule engine, one process away — see `backend/src/compliance/`.

── Run ────────────────────────────────────────────────────────────────────

    ocr-service/.venv/Scripts/python -m uvicorn app:app --port 8001

Single worker on purpose. Each worker is its own copy of the weights (~1 GB),
and inference is CPU-bound, so a second worker on a demo laptop competes for
the same cores while doubling the memory. Scale by process only where there
are cores to spare.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import asyncio
import logging
from functools import partial
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from services import ocr_service
from services.image_preprocessing import InvalidImageError

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("ocr-service")

# Matches MAX_UPLOAD_MB in the backend. Enforced here too because this service
# must stand on its own: it is reachable directly, and an unbounded upload is
# an out-of-memory kill of the process holding the weights.
MAX_UPLOAD_MB = float(os.getenv("MAX_UPLOAD_MB", "12"))
MAX_UPLOAD_BYTES = int(MAX_UPLOAD_MB * 1024 * 1024)

ACCEPTED_TYPES = {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"}


@asynccontextmanager
async def lifespan(_: FastAPI):
    """
    Loads the weights before the port starts accepting traffic.

    The backend's readiness check depends on this ordering: a service that
    answered /health while still loading would be reported as configured, and
    the first real scan would then time out rather than queue.
    """
    try:
        ocr_service.warm_up()
        logger.info("OCR service ready (%s)", ocr_service.engine_version())
    except ocr_service.OCRUnavailableError:
        # Started but not ready. /health reports the truth and the backend
        # reports a setup problem, which is far more useful than a process
        # that refuses to boot with a stack trace.
        logger.error("startup completed without a usable OCR engine")

    try:
        yield
    except asyncio.CancelledError:
        # Ctrl-C. Uvicorn cancels the lifespan task to shut down, and letting
        # that propagate prints three chained tracebacks ending in
        # `KeyboardInterrupt` — which reads exactly like a crash, every single
        # time the service is stopped normally. Swallowed here so a deliberate
        # stop looks deliberate.
        pass
    finally:
        logger.info("OCR service stopped.")


app = FastAPI(
    title="MetraVision AI OCR Service",
    version="1.0.0",
    description="PaddleOCR PP-OCRv5 text extraction for packaged-commodity labels.",
    lifespan=lifespan,
)


@app.get("/health")
def health() -> dict[str, Any]:
    ready = ocr_service.is_ready()
    return {
        "status": "ok" if ready else "degraded",
        "ready": ready,
        "engine": "paddleocr",
        "engineVersion": ocr_service.engine_version(),
        "primaryLang": ocr_service.PRIMARY_LANG,
        "secondaryLang": ocr_service.SECONDARY_LANG or None,
        "maxUploadMb": MAX_UPLOAD_MB,
    }


@app.post("/ocr")
async def ocr(
    image: UploadFile = File(...),
    coin: str | None = Form(default=None),
    mm_per_px: float | None = Form(default=None),
) -> JSONResponse:
    """
    Reads one image.

    The failure taxonomy matters more than it looks, because the backend maps
    each status onto a different outcome for the inspection:

      400  the bytes are not a usable image        → the inspector retakes it
      413  too large                               → the inspector retakes it
      503  the engine is unavailable               → the scan is abandoned,
                                                     the inspection stays DRAFT
      200 with `lines: []`  the read worked and found nothing

    The last one is the one that must never be collapsed into an error, and
    the errors are the ones that must never be collapsed into it. An empty
    result reaching the rule engine as a successful read of a blank package is
    how a service outage becomes a violation recorded against a trader.
    """
    data = await image.read()

    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"The image exceeds the {MAX_UPLOAD_MB:g} MB limit.",
        )

    # A declared content type is a claim, not a fact — the real check is
    # whether Pillow can decode it, below. This only rejects the obviously
    # wrong thing early, before a 12 MB PDF is handed to a decoder.
    if image.content_type and image.content_type.lower() not in ACCEPTED_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported image type: {image.content_type}.",
        )

    try:
        # Off the event loop.
        #
        # `ocr_service.read` is two to three seconds of CPU-bound inference, and
        # awaiting nothing while it runs meant the coroutine held the loop for
        # its whole duration — so concurrent reads were processed strictly one
        # at a time, and `/health` was blocked behind them, which is why a scan
        # in progress made this service look down.
        #
        # `run_in_threadpool` hands it to the same worker pool FastAPI uses for
        # sync handlers. Concurrency is then bounded by the engine pool inside
        # the service rather than by the loop.
        result = await run_in_threadpool(
            partial(ocr_service.read, data, coin=coin, manual_mm_per_px=mm_per_px)
        )
    except InvalidImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ocr_service.OCRUnavailableError as exc:
        logger.error("OCR engine unavailable: %s", exc)
        raise HTTPException(status_code=503, detail="The OCR engine is not available.") from exc
    except Exception as exc:  # noqa: BLE001
        # Never degrade to an empty success. See the docstring.
        logger.exception("unexpected failure while reading %s", image.filename)
        raise HTTPException(status_code=503, detail="The OCR engine failed to read the image.") from exc

    logger.info(
        "read %s: %d lines in %dms",
        image.filename or "<unnamed>",
        result["metadata"]["lineCount"],
        result["metadata"]["processingTimeMs"],
    )

    return JSONResponse(result)


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException) -> JSONResponse:
    """One error shape, so the backend has a single thing to parse."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "error": exc.detail},
    )
