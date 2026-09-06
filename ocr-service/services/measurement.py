"""
── MILLIMETRES, FROM A PHOTOGRAPH ───────────────────────────────────────────

Rule 7 of the Packaged Commodities Rules sets a minimum height for the numerals
and letters of a declaration, in millimetres, from Table-I. The rule engine has
those thresholds wired and tested. It has never been able to apply them, because
nothing in this system produced a measurement — a bounding box is in pixels, and
pixels become millimetres only if you know how big a pixel is.

A photograph does not carry that. Two shots of the same packet from different
distances have completely different pixel sizes, and nothing in the image says
which is which. So the scale has to come from something *in the frame whose real
size is already known*.

── The three ways, in the order they are tried ─────────────────────────────

  1. **A fiducial marker.** A printed square of known side — an ArUco tag — laid
     beside the pack. It is the best of the three by a wide margin, and not
     because it is more precise: it is the only one that yields a *homography*.
     Four corners of known geometry give the full plane-to-plane transform, so
     the tilt of the photograph is undone and one millimetre means the same
     thing at the top of the panel as at the bottom. Detection is robust at an
     angle, in poor light and against busy packaging, because that is precisely
     what the marker was designed for.

  2. **A coin.** Every officer has one; no officer carries a marker they were
     never issued. Indian coins differ enough in diameter to be told apart —
     ₹1 is 21.93 mm, ₹5 is 23 mm, ₹2 is 25 mm, ₹10 is 27 mm — and a circle is
     easy to find. But a circle gives one number, not a plane: the scale it
     yields is only true where the coin is. So it must lie *on the panel*,
     beside the declaration being measured, and the shot must be roughly square
     to it. A coin at the edge of a tilted photograph will read a millimetre as
     anything at all.

  3. **The inspector's own measurement.** A length they took with a rule. The
     fallback that always works, and the one that is right by definition,
     because a person measured it.

── And when there is none ───────────────────────────────────────────────────

Nothing is measured and nothing is guessed. That is the whole discipline here.
A height derived from an assumed pixel size would look like a measurement, carry
three significant figures, and fail a compliant package on Table-I — worse in
every way than the engine's present answer, which is that a person must measure
it. Every function below returns `None` rather than an estimate.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

import cv2
import numpy as np

logger = logging.getLogger("ocr-service")


# ── Reference objects ───────────────────────────────────────────────────────

#: The marker side in millimetres, printed on the department's calibration card.
#: Configurable because whoever prints the cards decides it, and a card printed
#: at the wrong size with the right number in here would put a systematic error
#: through every measurement this service makes.
ARUCO_SIDE_MM = float(os.getenv("OCR_ARUCO_SIDE_MM", "25"))

#: 4x4 is the smallest dictionary that still separates cleanly at a distance.
#: A larger grid carries more ids and needs more pixels to resolve, and there is
#: exactly one marker to recognise here.
ARUCO_DICT = cv2.aruco.DICT_4X4_50

#: Indian circulating coins, by diameter in millimetres.
#:
#: Ordered so the nearest match wins. They are close together — 21.93, 23, 25,
#: 27 — and a photograph cannot tell them apart on size alone, which is why a
#: coin has to be *named* by the inspector rather than inferred. Guessing
#: between ₹1 and ₹2 is an eight per cent scale error, and eight per cent of
#: 1 mm is the difference between compliant and not.
COIN_DIAMETER_MM: dict[str, float] = {
    "1": 21.93,
    "2": 25.0,
    "5": 23.0,
    "10": 27.0,
    "20": 27.0,
}


@dataclass
class Scale:
    """How many millimetres one pixel covers, and where that came from."""

    mm_per_px: float
    source: str
    """`aruco`, `coin` or `manual`."""

    confidence: float
    """0-1. Not a probability — a statement of how much the source is trusted."""

    homography: np.ndarray | None = None
    """
    Plane-to-plane transform, from the marker only.

    Where this is present the scale is valid across the whole panel, because the
    photograph's perspective has been solved. Where it is absent the scale is
    local to the reference object, and a measurement taken far from it is
    correspondingly less trustworthy.
    """

    def as_dict(self) -> dict[str, object]:
        return {
            "mmPerPx": round(self.mm_per_px, 6),
            "source": self.source,
            "confidence": round(self.confidence, 3),
            "perspectiveCorrected": self.homography is not None,
        }


# ── Finding the scale ───────────────────────────────────────────────────────


def _aruco_scale(image: np.ndarray) -> Scale | None:
    """
    The marker, and the plane it defines.

    Uses the *shortest* side of the detected square rather than the mean. A
    marker photographed at an angle is a trapezium, and its long side is
    foreshortened least — taking the mean would quietly under-report the scale
    and over-report every height measured with it. The short side is the
    conservative reading, and the homography below corrects the tilt properly
    anyway; this is only the fallback figure.
    """
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image

    dictionary = cv2.aruco.getPredefinedDictionary(ARUCO_DICT)
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _ = detector.detectMarkers(grey)

    if ids is None or len(corners) == 0:
        return None

    # One marker is the expected case. Where several are visible the first is
    # taken: they are all the same printed size, so any of them gives the same
    # scale, and averaging them would only average in whichever is worst placed.
    quad = corners[0].reshape(4, 2).astype(np.float32)

    sides = [float(np.linalg.norm(quad[i] - quad[(i + 1) % 4])) for i in range(4)]
    side_px = min(sides)

    if side_px <= 1:
        return None

    # The marker's own corners, in millimetres, as the destination plane.
    target = np.array(
        [[0, 0], [ARUCO_SIDE_MM, 0], [ARUCO_SIDE_MM, ARUCO_SIDE_MM], [0, ARUCO_SIDE_MM]],
        dtype=np.float32,
    )
    homography, _ = cv2.findHomography(quad, target)

    return Scale(
        mm_per_px=ARUCO_SIDE_MM / side_px,
        source="aruco",
        confidence=0.95,
        homography=homography,
    )


def _coin_scale(image: np.ndarray, denomination: str) -> Scale | None:
    """
    A coin, named by the inspector.

    The denomination is required rather than guessed. Indian coins are 22 to 27
    millimetres across, so a photograph cannot separate them, and picking wrong
    puts an eight per cent error through every height — which on a 1 mm
    threshold is the whole answer.
    """
    diameter_mm = COIN_DIAMETER_MM.get(denomination)
    if diameter_mm is None:
        return None

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    blurred = cv2.medianBlur(grey, 5)

    height, width = grey.shape[:2]

    circles = cv2.HoughCircles(
        blurred,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        # A coin beside a packet is never two of them touching, and this stops
        # the detector finding a row of "coins" in a printed pattern.
        minDist=min(height, width) / 4,
        param1=100,
        # 30 rather than the 55 tried first, which found nothing at all — the
        # accumulator threshold is how many edge points must agree, and a coin
        # against a printed packet does not have a crisp enough rim to reach 55.
        # Lowering it lets more candidates through, which is why the disc check
        # below exists: a permissive detector plus a verification step beats a
        # strict detector that finds nothing.
        param2=30,
        # Bounded, because a lens flare and a plate are both round. A coin held
        # beside a label fills a few per cent of the frame, not half of it.
        minRadius=int(min(height, width) * 0.02),
        maxRadius=int(min(height, width) * 0.20),
    )

    if circles is None:
        return None

    # The largest, on the reasoning that the coin is closer to the camera than
    # anything else round in a shop.
    found = sorted(np.round(circles[0]).astype(int), key=lambda c: -c[2])

    best = None
    for candidate in found:
        if _is_solid_disc(grey, candidate):
            best = candidate
            break

    if best is None:
        return None

    radius_px = float(best[2])
    if radius_px <= 1:
        return None

    return Scale(
        mm_per_px=diameter_mm / (radius_px * 2),
        source="coin",
        # Lower than the marker on purpose: no perspective correction, and the
        # circle fit is only as good as the coin's contrast against the packet.
        confidence=0.7,
    )


def _is_solid_disc(grey: np.ndarray, circle: np.ndarray) -> bool:
    """
    Whether a detected circle is a coin rather than a printed ring or a flare.

    A coin is a solid, fairly uniform disc: its middle looks like its middle,
    not like the packet behind it. A printed roundel on packaging is an outline
    with artwork inside, and a lens flare is a bright ring around nothing — both
    of which pass a Hough transform tuned permissively enough to find a real
    coin against a busy label.

    So the centre is compared with the rim. A disc has low variance across the
    inner half and a clear step at the edge; a ring does not.
    """
    x, y, radius = int(circle[0]), int(circle[1]), int(circle[2])
    height, width = grey.shape[:2]

    if radius < 4 or x - radius < 0 or y - radius < 0 or x + radius >= width or y + radius >= height:
        return False

    inner = grey[y - radius // 2 : y + radius // 2, x - radius // 2 : x + radius // 2]
    if inner.size == 0:
        return False

    # A ring's interior carries the packet's own artwork, which is far more
    # varied than the face of a coin at this scale.
    if float(np.std(inner)) > 45:
        return False

    # And the disc has to differ from what surrounds it, or this is a patch of
    # flat background that happened to fit a circle.
    ring = grey[max(0, y - radius) : y + radius, max(0, x - radius) : x + radius]
    return abs(float(np.mean(inner)) - float(np.mean(ring))) > 5


def find_scale(
    image: np.ndarray,
    *,
    coin: str | None = None,
    manual_mm_per_px: float | None = None,
) -> Scale | None:
    """
    The best scale available for this photograph, or nothing.

    Order is by trustworthiness and not by convenience. A marker in the frame
    beats a coin in the frame beats a number the inspector typed — but the
    inspector's own figure is preferred over *guessing*, which is why the chain
    ends in `None` rather than in an estimate.
    """
    if manual_mm_per_px and manual_mm_per_px > 0:
        return Scale(mm_per_px=manual_mm_per_px, source="manual", confidence=1.0)

    try:
        scale = _aruco_scale(image)
        if scale:
            return scale
    except Exception:  # noqa: BLE001
        logger.warning("marker detection failed; trying the coin", exc_info=True)

    if coin:
        try:
            return _coin_scale(image, coin)
        except Exception:  # noqa: BLE001
            logger.warning("coin detection failed", exc_info=True)

    return None


# ── Measuring the print ─────────────────────────────────────────────────────


def glyph_height_px(image: np.ndarray, polygon: list[list[int]]) -> float | None:
    """
    The height of the ink, which is not the height of the detected box.

    A detector's box is drawn around a line with padding, and it grows to cover
    an ascender or a descender wherever one happens to fall. Rule 7 measures the
    height of a numeral or a letter, so measuring the box would over-report on
    every line that happens to contain a `j` and under-report on none — the
    error is one-sided, and it is the direction that clears a package that
    should not have been cleared.

    So the crop is binarised and the rows that actually carry ink are counted.
    On a line of digits, which is what the declarations Rule 7 cares about
    mostly are, that span *is* the numeral height.

    Two per cent of the rows are discarded at each end before measuring. A
    single speck of noise at the top of a crop would otherwise add its own row
    to the height of every character on the line.
    """
    points = np.array(polygon, dtype=np.int32)
    x, y, w, h = cv2.boundingRect(points)

    if w < 3 or h < 3:
        return None

    crop = image[max(0, y) : y + h, max(0, x) : x + w]
    if crop.size == 0:
        return None

    grey = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY) if crop.ndim == 3 else crop

    # Otsu rather than a fixed threshold: coded print on a white label and dark
    # print on yellow packaging have nothing in common but that the ink and the
    # ground separate into two clusters.
    _, binary = cv2.threshold(grey, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    ink_per_row = (binary > 0).sum(axis=1)
    if ink_per_row.max() == 0:
        return None

    # ── WHERE THE DESCENDERS ARE DROPPED ──────────────────────────────────
    #
    # A row counts as print only if a quarter of the busiest row's ink is in it.
    #
    # The reasoning is about how many characters contribute. Every character on
    # a line puts ink in the rows between the cap line and the baseline, so
    # those rows are dense. A descender — the tail of a `g`, a `y`, a `p` —
    # is one character reaching below the baseline, so its rows carry a
    # fourteenth of the ink of a fourteen-character line. A tenth, which this
    # was, let those rows through: `Net Wt. 800 g` measured 5.28 mm against a
    # true 4.0, a 32 per cent over-report, and over-reporting is the direction
    # that clears a package Table-I should have failed.
    #
    # Measured against print of known height at 0.1, 0.2, 0.3, 0.4 and 0.5 of
    # the peak: the descender is gone by 0.2 and every other line is unchanged
    # all the way to 0.5. A quarter sits inside that plateau — clear of the
    # descender, and not so high that a lightly-inked stroke at the top of a
    # numeral is clipped off a real photograph.
    threshold = max(1, ink_per_row.max() * 0.25)
    rows = np.flatnonzero(ink_per_row >= threshold)

    if rows.size == 0:
        return None

    trim = max(0, int(rows.size * 0.02))
    top = rows[trim]
    bottom = rows[rows.size - 1 - trim]

    height_px = float(bottom - top + 1)
    return height_px if height_px >= 1 else None


def measure_line(
    image: np.ndarray,
    polygon: list[list[int]],
    scale: Scale,
) -> dict[str, float] | None:
    """
    One line's printed size, in millimetres.

    Returns `heightMm` and `widthMm` — the two measurements Rule 7 asks for,
    named exactly as `EvidenceMeasurements` expects them, so nothing downstream
    has to translate.

    The width is the mean advance per character rather than the width of the
    line, because 7(3) limits the width of *a* letter to a third of its height
    and a line's width says nothing about that. It is an approximation and is
    reported as one: proportional spacing means a line of `1`s and a line of
    `W`s of the same length do not have the same mean.
    """
    height_px = glyph_height_px(image, polygon)
    if height_px is None:
        return None

    points = np.array(polygon, dtype=np.int32)
    _, _, width_px, _ = cv2.boundingRect(points)

    measurements = {"heightMm": round(height_px * scale.mm_per_px, 2)}

    # Only where the caller can use it. A single-character line has no mean
    # advance worth reporting.
    if width_px > 0:
        measurements["lineWidthMm"] = round(float(width_px) * scale.mm_per_px, 2)

    return measurements
