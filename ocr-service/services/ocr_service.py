"""
── THE ENGINE ──────────────────────────────────────────────────────────────

Official pretrained PaddleOCR weights, loaded once at process start.

Loading is the expensive part — the detection, recognition and orientation
weights together take several seconds to initialise and roughly a gigabyte of
RAM. Constructing `PaddleOCR()` per request would make every scan a cold
start, so engines are cached at module level, built during the FastAPI
lifespan and reused for the life of the process.

── Which models, and why ──────────────────────────────────────────────────

Pretrained only. Nothing here trains, fine-tunes or reads a dataset; the
weights are the official ones and PaddleOCR downloads them on first use.

The *version is not pinned in code*. PaddleOCR resolves the newest models it
has for the requested language — today that is PP-OCRv6 for English, and it
will be whatever ships next without an edit here. Pinning a version is how a
project quietly ends up two model generations behind.

  · **Detection** finds the quadrilateral around each line. The default
    detector is tuned for photographed text rather than scans, which is what a
    label held up in a shop actually is.
  · **Text-line orientation** is left ON. Packaging is the case it exists
    for: net-quantity and batch declarations are routinely printed rotated
    180° or down the side of a pouch, and without it those lines come back as
    nonsense rather than as text.
  · **Document orientation and unwarping are OFF.** Both are page-scanner
    features — they assume a rectangular document filling the frame. A close
    photograph of a curved packet is not one, and unwarping bends the label
    into a shape the detector then reads worse. They also cost two extra model
    downloads and loads for no gain here.

── Bilingual labels ───────────────────────────────────────────────────────

One PaddleOCR instance recognises one script family, and the newest models do
not cover every script: **PP-OCRv6 has no Devanagari recogniser**, so Hindi
resolves to the PP-OCRv5 Devanagari model instead. `_build` handles that by
asking for the newest first and falling back a version at a time, rather than
hard-coding which language needs which generation — that mapping changes with
every release.

Indian packaging is routinely English + Devanagari on the same face, so a
second engine is optionally loaded for the secondary script and its lines are
merged in by `formatter.merge_passes` — kept only where they do not overlap a
primary detection, because a Devanagari recogniser reading "MRP" produces a
confident wrong answer.

The second pass roughly doubles inference time, so it is configuration
(`OCR_SECONDARY_LANG=hi`), and empty by default.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Any

# ── Paddle runtime flags ───────────────────────────────────────────────────
#
# These MUST be set before anything imports paddleocr/paddlex, which is why
# they sit at module scope above the import rather than in a config file.
# `setdefault`, so a deployment can still override either of them.
#
#   DISABLE_MODEL_SOURCE_CHECK=True
#       PaddleX probes each model host with a short-timeout HEAD request
#       before downloading. On a busy or high-latency connection those probes
#       time out and it concludes — wrongly — that the machine is offline,
#       then refuses to download anything ("No available model hosting
#       platforms detected"). Skipping the probe keeps every host as a
#       fallback rather than eliminating them, so this is strictly more
#       robust, not less.
#
#   MODEL_SOURCE=huggingface
#       Tried first. The Baidu BOS mirror is the upstream default and is
#       slow and failure-prone from India.
#
# oneDNN is deliberately NOT disabled here: it is worth a factor of twenty on
# CPU. It is also why `paddlepaddle` is pinned below its latest release — see
# the note in requirements.txt before upgrading.
# ---------------------------------------------------------------------------
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")
os.environ.setdefault("PADDLE_PDX_MODEL_SOURCE", "huggingface")

from services.image_preprocessing import (  # noqa: E402
    PreparedImage,
    enhance,
    prepare,
    rotate,
    sharpen,
    upscale,
)
from utils import formatter  # noqa: E402

logger = logging.getLogger("ocr-service")

PRIMARY_LANG = os.getenv("OCR_LANG", "en")
SECONDARY_LANG = os.getenv("OCR_SECONDARY_LANG", "").strip()

# ── The primary model pair ─────────────────────────────────────────────────
#
# Pinned to the PP-OCRv5 *mobile* pair rather than left to PaddleOCR's own
# default, which is currently the heavier PP-OCRv6 medium pair.
#
# Measured on this project's label set — clear, blurry, rotated 12°, low
# contrast, low resolution and small print, on a 12-core CPU:
#
#     PP-OCRv5 mobile    2.0–2.8s per image    every declaration found
#     PP-OCRv6 medium    4.8–7.8s per image    every declaration found
#
# Identical extraction, ~2.7x the time. An inspection is up to four
# photographs read sequentially, so that is 9s against 27s — and the backend
# gives up at OCR_TIMEOUT_MS, 20s. The faster pair is the one that fits.
#
# This is a *default*, not a judgement that v6 is worse: it is a newer and in
# principle stronger model, and the labels above are rendered rather than
# photographed. Set OCR_DET_MODEL and OCR_REC_MODEL to compare on real
# photographs, and raise the backend timeout if v6 wins on them.
DET_MODEL = os.getenv("OCR_DET_MODEL", "PP-OCRv5_mobile_det").strip()
REC_MODEL = os.getenv("OCR_REC_MODEL", "en_PP-OCRv5_mobile_rec").strip()

# Newest first. `None` asks PaddleOCR for its own default, which is the newest
# generation it ships; the explicit versions below are the fallback for a
# language the newest generation has no recogniser for — Hindi being the case
# that matters here.
_VERSION_FALLBACKS: tuple[str | None, ...] = (None, "PP-OCRv5", "PP-OCRv4", "PP-OCRv3")

# Below this a reading is more likely noise than text. Not a rejection of the
# scan — the line is dropped, but the *backend* decides what a thin read means.
# Filtering aggressively here would hide from the rule engine the very fact it
# uses to route a check to manual review.
DROP_BELOW_CONFIDENCE = float(os.getenv("OCR_MIN_CONFIDENCE", "0.30"))

# ── When to look again ─────────────────────────────────────────────────────
#
# The trigger has to describe a *poor read*, not a *small label*.
#
# The first version multiplied line count by mean confidence and retried below
# a fixed score. It was wrong in a way worth recording: a cosmetics label
# carries eight declarations, so a flawless read scored 8 x 0.95 and tripped a
# threshold meant for failures — every clean small label paid for three extra
# inferences it did not need, and four photographs then ran past the backend's
# timeout. Line count measures how much is printed on the package, which is not
# evidence about how well it was read.
#
# So the signals below are about the reading itself: nothing found at all, a
# suspiciously thin read, or readings the recogniser is not sure of.
# Measured on this project's images, single pass:
#
#     a clean label                8 lines, mean 0.986-0.994
#     a dark MRP crop, read well   3 lines, mean 0.979
#     a tiny blurred crop, garbage 3 lines, mean 0.58   ("DO 099 TH HV")
#
# Mean confidence separates those cleanly and line count does not, which is why
# a line-count rule was tried and removed: at "fewer than four lines is poor" a
# close-up of an MRP sticker read at 0.979 still paid for three extra
# inferences, and photographing just the MRP box is a case the capture flow
# offers on purpose.
POOR_MEAN_CONFIDENCE = float(os.getenv("OCR_RETRY_CONFIDENCE", "0.80"))


def _looks_poor(lines: list[dict[str, Any]]) -> bool:
    """Whether a reading is weak enough to be worth a second attempt."""
    if not lines:
        return True

    scored = [line["confidence"] for line in lines if "confidence" in line]
    if not scored:
        # No scores at all is not evidence of a bad read, and re-reading every
        # such image would be a permanent tax on any provider that reports none.
        return False

    return sum(scored) / len(scored) < POOR_MEAN_CONFIDENCE

_engines: dict[str, "Engine"] = {}
_lock = threading.Lock()


class OCRUnavailableError(RuntimeError):
    """The engine could not be initialised. Distinct from "ran, read nothing"."""


@dataclass
class Engine:
    """A loaded PaddleOCR instance plus what it actually resolved to."""

    ocr: Any
    lang: str
    detection_model: str | None
    recognition_model: str | None

    @property
    def label(self) -> str:
        """The provenance string recorded on every inspection."""
        models = "+".join(part for part in (self.detection_model, self.recognition_model) if part)
        return f"{models or 'paddleocr'} ({self.lang})"


def _model_names(ocr: Any, lang: str, version: str | None) -> tuple[str | None, str | None]:
    """
    Which weights the instance resolved to, for the audit record.

    Best-effort: this reaches into a private helper, so it is wrapped. A
    provenance string is worth having but is never worth failing a scan for.
    """
    try:
        det, rec = ocr._get_ocr_model_names(lang, version)  # noqa: SLF001
        return det, rec
    except Exception:  # noqa: BLE001
        return None, None


def _build(lang: str, det: str | None = None, rec: str | None = None) -> Engine:
    """
    Loads one engine.

    `det`/`rec` name the weights explicitly and are used for the primary
    language only. The secondary engine passes neither, so that its models are
    resolved from its language — a Devanagari pass must not inherit an English
    recogniser.
    """
    from paddleocr import PaddleOCR

    logger.info("loading OCR weights for lang=%s (first run downloads them)", lang)
    started = time.perf_counter()

    explicit: dict[str, str] = {}
    if det:
        explicit["text_detection_model_name"] = det
    if rec:
        explicit["text_recognition_model_name"] = rec

    last_error: Exception | None = None

    for version in _VERSION_FALLBACKS:
        try:
            ocr = PaddleOCR(
                lang=lang,
                ocr_version=version,
                use_textline_orientation=True,
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                **explicit,
            )
        except ValueError as exc:
            # "No models are available for lang=... and ocr_version=..." — this
            # generation has no recogniser for this script. Try the previous
            # one rather than giving up: it is how Hindi reaches the PP-OCRv5
            # Devanagari model while English stays on PP-OCRv6.
            last_error = exc
            logger.debug("lang=%s unavailable at %s, trying older", lang, version or "default")
            continue
        except Exception as exc:  # noqa: BLE001
            logger.exception("could not initialise PaddleOCR for lang=%s", lang)
            raise OCRUnavailableError(str(exc)) from exc

        resolved_det, resolved_rec = _model_names(ocr, lang, version)
        engine = Engine(
            ocr=ocr,
            lang=lang,
            # An explicit name is what actually loaded, so it wins over what
            # the lang/version table would have chosen.
            detection_model=det or resolved_det,
            recognition_model=rec or resolved_rec,
        )

        logger.info(
            "lang=%s ready in %.1fs using %s",
            lang,
            time.perf_counter() - started,
            engine.label,
        )
        return engine

    raise OCRUnavailableError(
        f"No PaddleOCR model is available for lang={lang!r}. "
        f"Check the language code against PaddleOCR's supported list. ({last_error})"
    )


def warm_up() -> None:
    """
    Loads every configured engine at startup.

    Called from the FastAPI lifespan so the cost is paid before the service
    reports healthy, rather than by whoever sends the first scan.
    """
    get_engine(PRIMARY_LANG)
    if SECONDARY_LANG:
        get_engine(SECONDARY_LANG)


def get_engine(lang: str) -> Engine:
    engine = _engines.get(lang)
    if engine is not None:
        return engine

    # Double-checked under the lock: uvicorn runs sync handlers in a
    # threadpool, and two concurrent first requests would otherwise each load
    # a gigabyte of weights.
    with _lock:
        engine = _engines.get(lang)
        if engine is None:
            is_primary = lang == PRIMARY_LANG
            engine = _build(
                lang,
                det=DET_MODEL if is_primary else None,
                rec=REC_MODEL if is_primary else None,
            )
            _engines[lang] = engine

    return engine


def is_ready() -> bool:
    return bool(_engines)


def _as_mapping(output: Any) -> dict[str, Any] | None:
    """
    Reaches the arrays inside a 3.x result object.

    Written tolerantly on purpose: across the 3.x line the same data has been
    reachable as the object itself, as `.json`, and as `.json["res"]`. Pinning
    to one of those would make a patch-level upgrade of paddleocr a silent
    outage in which every scan reads zero lines — which downstream is
    indistinguishable from a package carrying no declarations.
    """
    for candidate in (output, getattr(output, "json", None)):
        if isinstance(candidate, dict):
            if "rec_texts" in candidate:
                return candidate
            nested = candidate.get("res")
            if isinstance(nested, dict) and "rec_texts" in nested:
                return nested

    # Result objects support mapping access without being dicts.
    def field(name: str) -> Any:
        try:
            return output[name]
        except (TypeError, KeyError, IndexError):
            return None

    texts = field("rec_texts")
    if texts is not None:
        return {
            "rec_texts": texts,
            "rec_scores": field("rec_scores"),
            "rec_polys": field("rec_polys") or field("dt_polys"),
        }

    logger.warning("unrecognised PaddleOCR result shape: %s", type(output).__name__)
    return None


def _predict(engine: Engine, image: PreparedImage) -> list[dict[str, Any]]:
    """
    Runs one engine over one image and returns formatted lines.

    PaddleOCR 3.x returns a list of result objects, one per input, each
    carrying parallel arrays: `rec_texts`, `rec_scores` and `rec_polys` (the
    detection quadrilaterals, in the coordinate frame of the array passed in).
    That is the shape which replaced 2.x's nested
    `[[box, (text, score)], ...]` list, and the reason 2.x example code — of
    which there is a great deal online — does not run against this service.
    """
    outputs = engine.ocr.predict(image.array)

    lines: list[dict[str, Any]] = []

    for output in outputs or []:
        payload = _as_mapping(output)
        if payload is None:
            continue

        texts = payload.get("rec_texts") or []
        scores = payload.get("rec_scores") or []
        polys = payload.get("rec_polys")
        if polys is None:
            polys = payload.get("dt_polys") or []

        for index, text in enumerate(texts):
            raw_score = scores[index] if index < len(scores) else None
            score = float(raw_score) if raw_score is not None else None

            if score is not None and score < DROP_BELOW_CONFIDENCE:
                continue

            entry = formatter.line(
                text=text,
                confidence=score,
                polygon=polys[index] if index < len(polys) else None,
                scale=image.scale,
            )
            if entry is not None:
                lines.append(entry)

    return lines


def _extra_passes(
    engine: "Engine",
    image: PreparedImage,
    lines: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str]]:
    """
    Reads a difficult image again, differently, and keeps the best of each.

    Every variant is an *addition*. The original reading is never discarded —
    `formatter.merge_variants` keeps whichever reading of a given printed line
    the recogniser was surer of, and adds lines no earlier pass found at all.
    So a transform that destroys faint print can only fail to help; it cannot
    take a declaration away. That property is what makes it safe to try
    enhancements the module header otherwise warns against.

    Order is deliberate — contrast first, because the failure this most often
    fixes is a dark MRP or batch box on a dark background, and it is also the
    cheapest.
    """
    used: list[str] = []

    for name, variant in (
        ("clahe", enhance(image)),
        ("sharpen", sharpen(image)),
        ("upscale", upscale(image)),
    ):
        # Recorded before the attempt, not after it succeeds. `passes` is meant
        # to answer "what did the system try on this image" — which is the
        # question asked when a declaration was missed, and a list of only the
        # passes that happened to help cannot answer it.
        used.append(name)

        try:
            found = _predict(engine, variant)
        except Exception:  # noqa: BLE001
            # One bad variant must not lose the reading we already have.
            logger.warning("variant %s failed; keeping earlier passes", name, exc_info=True)
            continue

        if not found:
            continue

        before = len(lines)
        lines = formatter.merge_variants(lines, found)
        logger.info("variant %s added %d line(s)", name, len(lines) - before)

        # Enough is enough: once the read looks healthy, stop spending time.
        if not _looks_poor(lines):
            break

    # ── Rotation, last ─────────────────────────────────────────────────────
    #
    # Only when the image still reads as essentially nothing, because this is
    # the expensive branch — three more inferences — and it is only ever the
    # answer for one specific failure: a photograph whose EXIF orientation was
    # missing or wrong, so the entire label is on its side.
    # Rotation is the expensive branch — three more inferences — so it is
    # reserved for the one failure it fixes: an image that read as nothing at
    # all because the whole label is on its side. A few garbled lines are a
    # recognition problem, not an orientation one, and rotating will not help.
    if not lines:
        for degrees in (90, 180, 270):
            used.append(f"rotate-{degrees}")
            try:
                found = _predict(engine, rotate(image, degrees))
            except Exception:  # noqa: BLE001
                logger.warning("rotation %d failed", degrees, exc_info=True)
                continue

            if formatter.quality(found) <= formatter.quality(lines):
                continue

            # Boxes came back in the rotated frame. Mapped home before anything
            # downstream draws them on the stored photograph.
            for line in found:
                polygon = formatter.unrotate(
                    line.get("polygon"), degrees, image.original_width, image.original_height
                )
                if polygon:
                    line["polygon"] = polygon
                    xs = [point[0] for point in polygon]
                    ys = [point[1] for point in polygon]
                    line["boundingBox"] = {
                        "x": min(xs),
                        "y": min(ys),
                        "width": max(xs) - min(xs),
                        "height": max(ys) - min(ys),
                    }

            lines = found
            logger.info("image read best at %d degrees", degrees)
            break

    return lines, used


def read(data: bytes) -> dict[str, Any]:
    """
    The whole read: decode → correct → detect + recognise → structure.

    Raises `InvalidImageError` for undecodable bytes and `OCRUnavailableError`
    when the engine itself is broken. An image that decodes but contains no
    text is *not* an error — it returns successfully with an empty `lines`,
    and the backend decides what that means. Those two outcomes must stay
    distinguishable: "the OCR service is down" and "this package carries no
    declarations" lead to opposite conclusions about a trader.
    """
    image = prepare(data)

    # Fetched before the clock starts. On the very first request this loads a
    # gigabyte of weights, and reporting that as the time taken to read the
    # label would misattribute a one-off startup cost to every stored
    # inspection's timing record.
    engine = get_engine(PRIMARY_LANG)

    started = time.perf_counter()

    lines = _predict(engine, image)
    languages = [PRIMARY_LANG]
    models = [engine.label]
    passes = ["original"]

    # ── Extra passes, when the first one looks thin ────────────────────────
    #
    # Conditional rather than always-on, and the reason is the clock: an
    # inspection is up to four photographs read one after another, and the
    # backend gives up at OCR_TIMEOUT_MS. Reading every image four ways would
    # turn a nine-second scan into a timeout. A label that read cleanly does
    # not need a second opinion; one that read thinly is exactly the curved
    # bottle or dark MRP box these passes exist for.
    if _looks_poor(lines):
        lines, extra = _extra_passes(engine, image, lines)
        passes.extend(extra)

    if SECONDARY_LANG and lines:
        try:
            secondary = get_engine(SECONDARY_LANG)
            merged = _predict(secondary, image)
            if merged:
                lines = formatter.merge_passes(lines, merged)
                languages.append(SECONDARY_LANG)
                models.append(secondary.label)
        except OCRUnavailableError:
            # A missing secondary model must not fail a scan that already has
            # a usable primary reading.
            logger.warning("secondary lang=%s unavailable; continuing", SECONDARY_LANG)

    lines = formatter.reading_order(lines)

    scored = [line["confidence"] for line in lines if "confidence" in line]

    return {
        "success": True,
        "fullText": "\n".join(line["text"] for line in lines),
        "lines": lines,
        "metadata": {
            "imageWidth": image.original_width,
            "imageHeight": image.original_height,
            "processingTimeMs": round((time.perf_counter() - started) * 1000),
            "engine": "paddleocr",
            "engineVersion": engine_version(),
            "models": models,
            "languages": languages,
            "preprocessing": image.steps,
            "passes": passes,
            "lowResolution": image.low_resolution,
            "lineCount": len(lines),
            "meanConfidence": round(sum(scored) / len(scored), 4) if scored else None,
            "minConfidence": round(min(scored), 4) if scored else None,
        },
    }


def engine_version() -> str:
    """
    Provenance, recorded on every inspection.

    Names the resolved weights rather than a hard-coded generation, so a
    finding can be attributed to the model that actually produced the reading
    it rests on — including after an upgrade changes which one that is.
    """
    try:
        import paddleocr

        release = f"paddleocr-{paddleocr.__version__}"
    except Exception:  # noqa: BLE001
        release = "paddleocr"

    primary = _engines.get(PRIMARY_LANG)
    if primary and primary.recognition_model:
        return f"{primary.recognition_model}/{release}"

    return release
