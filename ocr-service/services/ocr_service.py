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
import queue
import threading
from contextlib import contextmanager
from typing import Iterator
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
from services import measurement  # noqa: E402
from utils import formatter  # noqa: E402

logger = logging.getLogger("ocr-service")

PRIMARY_LANG = os.getenv("OCR_LANG", "en")
SECONDARY_LANG = os.getenv("OCR_SECONDARY_LANG", "").strip()

# How many line crops are recognised (and orientation-classified) at once.
# See the measurements in `_build`. Configurable because the best value is a
# property of the machine's cache, not of the models.
RECOGNITION_BATCH = int(os.getenv("OCR_BATCH_SIZE", "16"))

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
                # Measured at 2.79s on and 2.66s off — five per cent, for the
                # ability to read a net quantity printed down the side of a
                # pouch or a batch code stamped upside down on a crimp. Those
                # are declarations, and five per cent is not worth one.
                # `OCR_TEXTLINE_ORIENTATION=0` disables it for a deployment that
                # has measured its own packs and decided otherwise.
                use_textline_orientation=os.getenv("OCR_TEXTLINE_ORIENTATION", "1") != "0",
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                # Recognition and orientation run per detected line, and both
                # default to one crop at a time. A back-of-pack label detects a
                # hundred-odd lines, so that default is a hundred-odd separate
                # inferences — measured on this project's densest label, 12
                # cores, same models, same 109 lines out:
                #
                #     one at a time      14.3s
                #     batched at 16      10.4s
                #     batched at 32      12.3s
                #
                # Sixteen is the floor of that curve; past it the batches stop
                # fitting cache and it gets slower again. Nothing about the
                # reading changes — same crops, same weights, same output — so
                # this is time given back, not accuracy traded away.
                text_recognition_batch_size=RECOGNITION_BATCH,
                textline_orientation_batch_size=RECOGNITION_BATCH,
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


# ── READING MORE THAN ONE PHOTOGRAPH AT A TIME ─────────────────────────────
#
# An inspection is not one image. The capture flow asks for the front and the
# back at minimum and an officer routinely takes five or six, and until now they
# were read strictly one after another — 2.7 seconds of inference each, plus
# three quarters of a second of request overhead, so six photographs took over
# twenty seconds before the rule engine had seen anything.
#
# Sending them concurrently from the backend changed nothing at all. Measured:
#
#     three images, sequential   8618 ms
#     three images, parallel     8611 ms
#
# because the handler was `async def` around a blocking call. A coroutine that
# does CPU work holds the event loop for the duration, so uvicorn processed the
# requests one at a time however they arrived — and `/health` was blocked behind
# them too, which is why a scan in progress made the service look down.
#
# Two changes together fix it, and neither works alone.
#
#   · The handler becomes a plain `def`. FastAPI then runs it in its threadpool
#     rather than on the loop, so requests genuinely overlap.
#   · Which immediately raises the question the first change creates: a Paddle
#     predictor is not safe to call from two threads at once. Sharing one would
#     trade a slow scan for a corrupt reading, which on this system means a
#     declaration invented from another photograph's tensor.
#
# So each concurrent reader gets an engine of its own, checked out of a pool and
# returned after use. `queue.Queue` is the whole mechanism: a reader that finds
# the pool empty blocks until one is free, which caps concurrency at the number
# of engines rather than at the number of requests.
#
# ── AND WHY IT DEFAULTS TO ONE ─────────────────────────────────────────────
#
# Because it was measured, and on an ordinary machine it buys nothing.
#
# With two engines the requests genuinely overlapped — the service log shows
# three reads finishing 4.6 seconds apart rather than 9 — and the wall clock did
# not move at all:
#
#     three images, one engine    8618 ms   (2654 ms each)
#     three images, two engines   9082 ms   (3980, 4641, 5293 ms each)
#
# Each individual read got slower by almost exactly the factor the concurrency
# gained. That is the signature of a compute-bound workload: PaddleOCR already
# spreads one inference across all twelve cores, so a second inference does not
# find an idle core to run on — it takes cores away from the first. Two engines
# split one CPU and pay 750 MB for the privilege.
#
# So the pool stays, because it is the only *correct* way to read concurrently
# and the machinery is written; and it stays at one, because on this hardware
# concurrency is not the lever. `OCR_WORKERS=2` is worth setting on a machine
# with cores to spare — a server with 32 of them, where one inference genuinely
# does leave capacity idle.
#
# The lever that does work is the cost of a single read. See `MAX_EDGE_PX`.
OCR_WORKERS = max(1, int(os.getenv("OCR_WORKERS", "1")))

_pool: "queue.Queue[Engine]" = queue.Queue()
_pool_size = 0


def _fill_pool() -> None:
    """
    Builds the pool, on the first read rather than at import.

    The first engine is the one `warm_up` already loads, so it is taken from the
    cache rather than built again; the rest are built here. Under the same lock
    as `get_engine`, because two first requests arriving together would
    otherwise each build the whole pool.
    """
    global _pool_size

    with _lock:
        if _pool_size > 0:
            return

        primary = get_engine(PRIMARY_LANG)
        _pool.put(primary)
        _pool_size = 1

        for index in range(1, OCR_WORKERS):
            try:
                _pool.put(
                    _build(PRIMARY_LANG, det=DET_MODEL, rec=REC_MODEL)
                )
                _pool_size += 1
            except Exception:  # noqa: BLE001
                # A machine that cannot hold a second engine keeps the first and
                # reads sequentially. Slower is a working service; failing to
                # start because the pool could not be filled is not.
                logger.warning(
                    "could not build OCR engine %d of %d; continuing with %d",
                    index + 1,
                    OCR_WORKERS,
                    _pool_size,
                    exc_info=True,
                )
                break

    logger.info("OCR engine pool ready: %d engine(s)", _pool_size)


@contextmanager
def _checkout() -> "Iterator[Engine]":
    """One engine, held exclusively for the length of a read."""
    if _pool_size == 0:
        _fill_pool()

    engine = _pool.get()
    try:
        yield engine
    finally:
        _pool.put(engine)


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


# A line of upright text is wider than it is tall. When almost every line on
# the page is the other way round, the page is on its side.
#
# Measured on a sideways photograph of a Haldiram pack and on the same image
# corrected: 0.92 of lines taller than wide against 0.00. The separation is
# the whole width of the range, so the threshold is not delicately placed.
SIDEWAYS_RATIO = 1.2
SIDEWAYS_SHARE = 0.6
SIDEWAYS_MIN_LINES = 4


def _sideways(lines: list[dict[str, Any]]) -> bool:
    """True when the geometry says the whole label is rotated a quarter turn."""
    boxes = [line.get("boundingBox") for line in lines]
    boxes = [b for b in boxes if b and b.get("width") and b.get("height")]
    if len(boxes) < SIDEWAYS_MIN_LINES:
        # Too little to tell a rotated page from one word that happens to be
        # tall, and guessing here would rotate images that are already upright.
        return False

    tall = sum(1 for b in boxes if b["height"] > b["width"] * SIDEWAYS_RATIO)
    return tall / len(boxes) >= SIDEWAYS_SHARE


def _upright(
    engine: "Engine",
    image: PreparedImage,
    lines: list[dict[str, Any]],
) -> tuple[PreparedImage, list[dict[str, Any]], int, list[str]]:
    """
    Turns a sideways label the right way up and reads it again.

    ── WHY THIS IS NOT THE ROTATION FALLBACK BELOW ────────────────────────────

    There was already rotation handling, but it only ran `if not lines` — when
    the image read as literally nothing. A label on its side does not read as
    nothing. PaddleOCR's text-line orientation classifier turns each detected
    line the right way up before recognising it, so a sideways photograph comes
    back looking *plausible*: two dozen lines, most of them right. What it
    quietly loses is the hard ones, and on a Legal Metrology label the hard ones
    are the declarations. Measured on one Haldiram moong dal pack:

        sideways                       corrected
        13.08/26   (manufacture)  ->   13/08/26
        121/2?     (use by)       ->   12/01/27
        Rs.0.309   (unit price)   ->   Rs.0.30/9
        MRP.INCLOF (label)        ->   MRP.(INCL. OF
        - missing -               ->   FSSAI Lic. No. 10013051000541
        mean confidence 0.918     ->   0.969

    Both dates, a third licence number and the unit price — the fields the rule
    engine actually decides on — were the ones being lost, while the reading as
    a whole looked healthy enough that nothing downstream flagged it.

    ── WHY IT TRIES BOTH DIRECTIONS ──────────────────────────────────────────

    The geometry says the page is a quarter turn out; it cannot say which way,
    because a detection box is stored corner-ordered and carries no reading
    direction. Both are tried and the better kept. On the pack above the two
    scored 0.965 and 0.969 — near enough that recognition barely cares, because
    the orientation classifier flips the individual lines either way. What it
    does decide is reading *order*, and that is worth one inference: the coding
    strip downstream pairs the nth header with the nth value, and reversed order
    pairs a batch number with a price.
    """
    if not _sideways(lines):
        return image, lines, 0, []

    used: list[str] = []
    best_degrees = 0
    best_image = image
    best_lines = lines
    best_quality = formatter.quality(lines)

    for degrees in (90, 270):
        used.append(f"rotate-{degrees}")
        try:
            turned = rotate(image, degrees)
            found = _predict(engine, turned)
        except Exception:  # noqa: BLE001
            logger.warning("rotation %d failed", degrees, exc_info=True)
            continue

        if not found:
            continue

        scored = formatter.quality(found)
        if scored <= best_quality:
            continue

        best_quality, best_degrees, best_image, best_lines = scored, degrees, turned, found

    if best_degrees:
        logger.info("label was on its side; read upright at %d degrees", best_degrees)

    return best_image, best_lines, best_degrees, used


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


def read(
    data: bytes,
    *,
    coin: str | None = None,
    manual_mm_per_px: float | None = None,
) -> dict[str, Any]:
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

    # Checked out before the clock starts. On the very first request this loads
    # the weights, and reporting that as the time taken to read the label would
    # misattribute a one-off startup cost to every stored inspection's timing
    # record. Held for the whole read, because a Paddle predictor may not be
    # called from two threads at once — see the note by the pool.
    with _checkout() as engine:
        return _read_with(engine, image, coin=coin, manual_mm_per_px=manual_mm_per_px)


def _read_with(
    engine: "Engine",
    image: PreparedImage,
    *,
    coin: str | None = None,
    manual_mm_per_px: float | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()

    lines = _predict(engine, image)
    languages = [PRIMARY_LANG]
    models = [engine.label]
    passes = ["original"]

    # ── Upright first ──────────────────────────────────────────────────────
    #
    # Before the enhancement passes, because contrast and sharpening spent on a
    # label lying on its side buy far less than simply turning it the right way
    # up — and because everything after this point reasons about layout. The
    # coding strip pairs headers with values by position, and position only
    # means anything once the page is the right way round.
    #
    # `image` is rebound, so the passes below, the measurement and the reading
    # order all work in the corrected frame. The boxes are turned back to the
    # frame of the stored photograph at the end, where the app draws them.
    original_frame = image
    image, lines, rotation, turned = _upright(engine, image, lines)
    passes.extend(turned)

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

    # ── Millimetres, where the photograph carries a reference ──────────────
    #
    # Rule 7's Table-I is entirely in millimetres, and until something measured
    # them every one of those checks resolved to "a person must do this". The
    # scale comes from a marker, a coin or the inspector; where there is none,
    # nothing is attached and the engine goes on saying what it said before.
    #
    # Attached per line rather than once for the image, because that is the
    # granularity the rule works at: it is the height of *this declaration's*
    # numerals that Table-I tests, not the average height of the panel.
    scale = None
    try:
        scale = measurement.find_scale(
            image.array, coin=coin, manual_mm_per_px=manual_mm_per_px
        )
    except Exception:  # noqa: BLE001
        # A failure to measure is not a failure to read. The declarations are
        # already in hand and the engine is designed to run without this.
        logger.warning("scale detection failed; continuing without measurements", exc_info=True)

    if scale is not None:
        measured = 0
        for line in lines:
            polygon = line.get("polygon")
            if not polygon:
                continue
            try:
                found = measurement.measure_line(image.array, polygon, scale)
            except Exception:  # noqa: BLE001
                continue
            if found:
                line["measurements"] = found
                measured += 1

        logger.info(
            "scale %s (%.4f mm/px): measured %d of %d lines",
            scale.source,
            scale.mm_per_px,
            measured,
            len(lines),
        )

    # ── Home again ─────────────────────────────────────────────────────────
    #
    # Everything above ran in the upright frame. The app draws evidence boxes on
    # the photograph as the inspector took it, so the boxes have to go back —
    # otherwise a highlight over the MRP lands somewhere in the corner of a
    # sideways picture. `layoutBox` keeps the upright geometry for the backend's
    # layout reasoning, which wants the opposite frame.
    if rotation:
        for line in lines:
            line["layoutBox"] = line.get("boundingBox")
            polygon = formatter.unrotate(
                line.get("polygon"),
                rotation,
                original_frame.original_width,
                original_frame.original_height,
            )
            if not polygon:
                continue
            line["polygon"] = polygon
            xs = [point[0] for point in polygon]
            ys = [point[1] for point in polygon]
            line["boundingBox"] = {
                "x": min(xs),
                "y": min(ys),
                "width": max(xs) - min(xs),
                "height": max(ys) - min(ys),
            }

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
            # Zero when the photograph was already upright. Recorded because a
            # rotated read is a different read, and a missed declaration on a
            # sideways image is a different question from one on a flat scan.
            "rotationApplied": rotation,
            "lowResolution": image.low_resolution,
            "lineCount": len(lines),
            "meanConfidence": round(sum(scored) / len(scored), 4) if scored else None,
            "minConfidence": round(min(scored), 4) if scored else None,
            # Absent where nothing could be measured, which is the honest signal
            # that Rule 7 cannot be decided on this photograph.
            "scale": scale.as_dict() if scale is not None else None,
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
