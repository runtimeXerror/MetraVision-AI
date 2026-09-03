"""
── THE WIRE FORMAT ─────────────────────────────────────────────────────────

Turns PaddleOCR's arrays into the JSON the Node backend consumes.

Two rules govern everything here:

  · **Never invent a confidence.** The rule engine's decision policy reads an
    absent confidence as "reliability unknown" and routes a failed check to
    REVIEW instead of recording it as a violation. A default of 1.0 for a
    reading the model was unsure about would convert an unknown into a
    finding against a trader. Where Paddle gives no score, the key is absent.

  · **Never clean up the text.** Rule 6 tests wording — the declaration has to
    *say* what the law requires it to say. Expanding "M.R.P." to "MRP",
    normalising ₹ to Rs., or collapsing "Net Qty." to "Net Quantity" changes
    what the rule engine sees. Normalisation is the extractor's job, one
    process away, and it is written knowing it receives raw OCR.

Geometry is reported twice on purpose. `boundingBox` is the axis-aligned
rectangle an overlay can draw; `polygon` is the four corners Paddle actually
detected, which for text photographed at an angle is not a rectangle. The
backend maps the first onto its `[x1, y1, x2, y2]` evidence box; the second is
kept so a later font-size or placement check has the true quadrilateral rather
than its inflated envelope.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from typing import Any, Iterable, Sequence

Point = tuple[float, float]


def _polygon(raw: Any) -> list[list[int]] | None:
    """Normalises whatever Paddle handed back into `[[x, y], ...]` integers."""
    if raw is None:
        return None

    try:
        points = [(float(point[0]), float(point[1])) for point in raw]
    except (TypeError, ValueError, IndexError):
        return None

    return [[round(x), round(y)] for x, y in points] if points else None


def _bounding_box(polygon: Sequence[Sequence[float]] | None) -> dict[str, int] | None:
    """The enclosing axis-aligned rectangle, in the coordinate frame of the polygon."""
    if not polygon:
        return None

    xs = [point[0] for point in polygon]
    ys = [point[1] for point in polygon]

    left, top = min(xs), min(ys)
    return {
        "x": round(left),
        "y": round(top),
        "width": round(max(xs) - left),
        "height": round(max(ys) - top),
    }


def _rescale(polygon: list[list[int]] | None, scale: float) -> list[list[int]] | None:
    """
    Maps a box from the downscaled frame back to the original photograph.

    Necessary because the backend stores the *original* image as evidence, and
    an overlay drawn on it with coordinates from a 2000px working copy sits in
    the wrong place. `scale` is 1.0 when no downscale happened, and the
    multiplication is then a no-op rather than a special case.
    """
    if not polygon or scale == 1.0:
        return polygon
    return [[round(x * scale), round(y * scale)] for x, y in polygon]


def line(
    text: str,
    confidence: float | None,
    polygon: Any,
    scale: float = 1.0,
) -> dict[str, Any] | None:
    """
    One recognised line. Returns `None` for a line with no text, so an empty
    detection never reaches the backend as a blank declaration.
    """
    stripped = (text or "").strip()
    if not stripped:
        return None

    points = _rescale(_polygon(polygon), scale)

    entry: dict[str, Any] = {"text": stripped}

    # Absent, not defaulted. See the header.
    if confidence is not None:
        entry["confidence"] = round(float(confidence), 4)

    box = _bounding_box(points)
    if box is not None:
        entry["boundingBox"] = box
        entry["polygon"] = points

    return entry


def reading_order(lines: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Sorts lines top-to-bottom, then left-to-right.

    Paddle returns detections in the detector's own order, which bears no
    relation to how the label reads. That matters because the extractor's
    patterns work a line at a time, and several declarations on Indian
    packaging span two printed lines ("Manufactured by:" then the address).

    The vertical band is quantised to 12px so that two words on the same
    printed line, whose boxes differ by a pixel or two, are not ordered by
    that difference.

    ── A known limitation, measured rather than assumed ────────────────────

    Quantising has a boundary problem: two boxes on one printed row can fall
    either side of a band edge and sort in the wrong order. On a real
    Haldiram's packet, `NET QUANTITY:` (y 3109) and its value `200g`
    (y 3103) landed in bands 259 and 258, so the value sorted before its own
    label.

    A centre-clustering replacement was written and tested, and it did pair
    the two correctly — but re-running the whole pipeline over that packet
    changed no extracted field for the better and made `manufacturer` worse
    (the correct "HALDIRAM SNACKS FOOD PRIVATE LIMITED" became a fragment of
    feedback text). It was reverted on that evidence.

    The reason is that ordering is not what is actually wrong: a packet's
    declaration block is a multi-column layout, and *no* single linearisation
    of it is correct. Fixing the misextraction properly means column-aware
    layout analysis here, or label/value association by geometry in the
    extractor — not a better sort. See the note in the project README.
    """

    def key(entry: dict[str, Any]) -> tuple[int, int]:
        box = entry.get("boundingBox")
        if not box:
            return (10**9, 0)
        return (box["y"] // 12, box["x"])

    return sorted(lines, key=key)


def _overlap(a: dict[str, int], b: dict[str, int]) -> float:
    """Intersection over the smaller box — 0.0 when they do not touch."""
    left = max(a["x"], b["x"])
    top = max(a["y"], b["y"])
    right = min(a["x"] + a["width"], b["x"] + b["width"])
    bottom = min(a["y"] + a["height"], b["y"] + b["height"])

    if right <= left or bottom <= top:
        return 0.0

    intersection = (right - left) * (bottom - top)
    smaller = min(a["width"] * a["height"], b["width"] * b["height"])
    return intersection / smaller if smaller else 0.0


# Two detections covering this much of the same area are the same printed line
# read twice, not two declarations that happen to sit on top of each other.
SAME_LINE_OVERLAP = 0.6


def merge_passes(
    primary: list[dict[str, Any]],
    secondary: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Folds a second-script pass into the first.

    A Devanagari pass over a bilingual label re-detects the Latin text too, and
    reads it badly — a recogniser trained on Devanagari will render "MRP" as
    something that is not "MRP". Keeping both would put two contradictory
    readings of one declaration in front of the extractor.

    So a secondary line is kept only where it does not sit on top of a primary
    one. Where they overlap the primary wins outright, regardless of
    confidence: the scores come from two different recognisers and are not
    comparable on the same scale.
    """
    kept = list(primary)

    for candidate in secondary:
        box = candidate.get("boundingBox")
        if box is None:
            continue

        collides = any(
            _overlap(box, existing["boundingBox"]) >= SAME_LINE_OVERLAP
            for existing in primary
            if existing.get("boundingBox")
        )
        if not collides:
            kept.append(candidate)

    return kept


def unrotate(
    polygon: list[list[int]] | None,
    degrees: int,
    width: int,
    height: int,
) -> list[list[int]] | None:
    """
    Maps a polygon found in a rotated frame back onto the upright one.

    `width`/`height` are the dimensions *before* rotation, which is the frame
    the caller wants coordinates in.

    Without this a box found on a sideways photograph would be drawn on the
    stored evidence image at ninety degrees to the text it belongs to — worse
    than no box at all, because it looks authoritative.
    """
    if not polygon or degrees % 360 == 0:
        return polygon

    turn = degrees % 360

    def back(x: int, y: int) -> list[int]:
        if turn == 90:
            # Forward was (x, y) -> (height - 1 - y, x).
            return [y, height - 1 - x]
        if turn == 180:
            return [width - 1 - x, height - 1 - y]
        # 270: forward was (x, y) -> (y, width - 1 - x).
        return [width - 1 - y, x]

    return [back(point[0], point[1]) for point in polygon]


def merge_variants(
    primary: list[dict[str, Any]],
    extra: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Folds a second reading of the *same* image into the first.

    Different from `merge_passes`, and the difference matters. There, two
    recognisers were reading different scripts and their scores were not
    comparable, so the primary always won. Here both readings come from the
    same recogniser looking at the same text through a different enhancement,
    so the scores *are* comparable and the more confident reading is the better
    one — a sharpened pass that reads `MRP 315.00` at 0.97 should beat the
    original's `MRP 3l5.OO` at 0.62.

    Lines the first pass never found are added outright. That is the main win:
    a laser-printed batch code invisible to the original and legible after
    contrast enhancement is new text, not a correction.
    """
    kept: list[dict[str, Any]] = list(primary)

    for candidate in extra:
        box = candidate.get("boundingBox")
        if box is None:
            continue

        replaced = False

        for index, existing in enumerate(kept):
            existing_box = existing.get("boundingBox")
            if not existing_box or _overlap(box, existing_box) < SAME_LINE_OVERLAP:
                continue

            # Same printed line, read twice. Keep whichever reading the model
            # was surer of; where neither carries a score, keep what we had,
            # because replacing a reading on no evidence is not an improvement.
            if candidate.get("confidence", 0) > existing.get("confidence", 0):
                kept[index] = candidate
            replaced = True
            break

        if not replaced:
            kept.append(candidate)

    return kept


def quality(lines: list[dict[str, Any]]) -> float:
    """
    How good a read looks, for choosing between passes.

    Line count times mean confidence. Neither alone is enough: confidence on
    its own prefers a pass that found three words perfectly over one that found
    forty declarations well, and line count on its own prefers a pass that
    found sixty fragments of noise.
    """
    if not lines:
        return 0.0

    scored = [line["confidence"] for line in lines if "confidence" in line]
    mean = sum(scored) / len(scored) if scored else 0.5

    return len(lines) * mean
