"""
── DOES IT ACTUALLY MEASURE? ────────────────────────────────────────────────

The only way to know is to photograph something whose size is already known, and
the only way to know *that* is to draw it.

Each test below renders a panel at a chosen millimetres-per-pixel, puts a marker
or a coin in it at its true size, and then asks the module to work out the scale
it was drawn at. The answer is checked against the number the renderer used.

That is the whole point. A measurement stage that is never checked against a
known length is a stage that produces confident numbers of unknown truth, and on
a Rule 7 check a confident wrong number fails a compliant package.
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import cv2
import numpy as np
import pytest

from services.measurement import (
    ARUCO_SIDE_MM,
    COIN_DIAMETER_MM,
    Scale,
    find_scale,
    glyph_height_px,
    measure_line,
)

# A plausible field photograph: a 2000 px panel covering about 20 cm.
MM_PER_PX = 0.1


def blank(width: int = 1600, height: int = 1000) -> np.ndarray:
    return np.full((height, width, 3), 245, dtype=np.uint8)


def draw_marker(canvas: np.ndarray, at: tuple[int, int], mm_per_px: float) -> np.ndarray:
    """The department's calibration marker, drawn at its true printed size."""
    side_px = int(round(ARUCO_SIDE_MM / mm_per_px))

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_4X4_50)
    marker = cv2.aruco.generateImageMarker(dictionary, 7, side_px)

    x, y = at
    canvas[y : y + side_px, x : x + side_px] = cv2.cvtColor(marker, cv2.COLOR_GRAY2BGR)
    return canvas


def draw_text(canvas: np.ndarray, text: str, at: tuple[int, int], height_px: int) -> None:
    """Text drawn so its capital height is `height_px`, as closely as a font allows."""
    scale = height_px / 22.0
    cv2.putText(canvas, text, at, cv2.FONT_HERSHEY_SIMPLEX, scale, (20, 20, 20), max(1, height_px // 12))


class TestScaleFromMarker:
    def test_reads_the_scale_it_was_drawn_at(self) -> None:
        canvas = draw_marker(blank(), (80, 80), MM_PER_PX)

        scale = find_scale(canvas)

        assert scale is not None, "the marker was not found"
        assert scale.source == "aruco"
        # Two per cent, which is the rasterisation of the marker itself. Tighter
        # than that would be testing the drawing, not the measuring.
        assert scale.mm_per_px == pytest.approx(MM_PER_PX, rel=0.02)

    def test_solves_the_plane_so_a_tilted_shot_is_usable(self) -> None:
        canvas = draw_marker(blank(), (300, 200), MM_PER_PX)
        scale = find_scale(canvas)

        assert scale is not None
        # The homography is the whole reason a marker beats a coin: with it, a
        # millimetre means the same thing across the panel rather than only
        # beside the reference.
        assert scale.homography is not None

    def test_finds_nothing_in_a_photograph_with_no_reference(self) -> None:
        canvas = blank()
        draw_text(canvas, "MRP 398.00", (100, 300), 40)

        # And says so, rather than assuming a pixel size. An invented scale is
        # the one outcome this module exists to prevent.
        assert find_scale(canvas) is None


class TestScaleFromCoin:
    def test_reads_the_scale_from_a_named_coin(self) -> None:
        canvas = blank()
        radius_px = int(round(COIN_DIAMETER_MM["5"] / 2 / MM_PER_PX))
        cv2.circle(canvas, (400, 500), radius_px, (60, 60, 60), -1)

        scale = find_scale(canvas, coin="5")

        assert scale is not None, "the coin was not found"
        assert scale.source == "coin"
        assert scale.mm_per_px == pytest.approx(MM_PER_PX, rel=0.06)

    def test_refuses_a_coin_it_was_not_told_the_value_of(self) -> None:
        canvas = blank()
        cv2.circle(canvas, (400, 500), 115, (60, 60, 60), -1)

        # Indian coins are 22 to 27 mm across; a photograph cannot tell them
        # apart, and guessing between ₹1 and ₹2 is an eight per cent error on
        # every height measured with it.
        assert find_scale(canvas) is None
        assert find_scale(canvas, coin="not-a-coin") is None

    def test_prefers_the_marker_when_both_are_present(self) -> None:
        canvas = draw_marker(blank(), (80, 80), MM_PER_PX)
        cv2.circle(canvas, (900, 600), 200, (60, 60, 60), -1)

        scale = find_scale(canvas, coin="5")

        assert scale is not None
        assert scale.source == "aruco"


class TestGlyphHeight:
    def test_measures_the_ink_and_not_the_box(self) -> None:
        canvas = blank(900, 400)
        draw_text(canvas, "398.00", (60, 220), 60)

        # A polygon far larger than the print, the way a detector's box is
        # padded. If this measured the box it would return the box's height.
        polygon = [[40, 120], [800, 120], [800, 300], [40, 300]]
        height = glyph_height_px(canvas, polygon)

        assert height is not None
        assert height == pytest.approx(60, rel=0.2)
        assert height < 120, "measured the padded box rather than the print"

    def test_returns_nothing_for_a_crop_with_no_print(self) -> None:
        canvas = blank(400, 200)
        assert glyph_height_px(canvas, [[10, 10], [390, 10], [390, 190], [10, 190]]) is None


class TestEndToEnd:
    def test_a_known_height_comes_back_in_millimetres(self) -> None:
        """
        The whole chain, against a height chosen in advance.

        3 mm of print, drawn at a known scale, with a marker beside it — the
        answer has to be 3 mm. This is the test the Rule 7 checks rest on: every
        threshold in Table-I is a number in millimetres, and if this is wrong
        they are all wrong in the same direction.
        """
        target_mm = 3.0
        height_px = int(round(target_mm / MM_PER_PX))

        canvas = draw_marker(blank(1600, 700), (60, 60), MM_PER_PX)
        draw_text(canvas, "398.00", (500, 450), height_px)

        scale = find_scale(canvas)
        assert scale is not None

        measured = measure_line(canvas, [[480, 380], [1100, 380], [1100, 500], [480, 500]], scale)

        assert measured is not None
        # A fifth, which is the honest tolerance for a rendered stroke measured
        # through a threshold. It is well inside the gaps in Table-I — the rows
        # step 1, 1.5, 2.5, 4, 6 mm — which is what the number has to resolve.
        assert measured["heightMm"] == pytest.approx(target_mm, rel=0.2)

    def test_reports_where_the_scale_came_from(self) -> None:
        canvas = draw_marker(blank(), (80, 80), MM_PER_PX)
        scale = find_scale(canvas)

        assert scale is not None
        record = scale.as_dict()

        # Carried onto the record, because a measurement whose provenance is not
        # stated is a measurement nobody can check. A marker and a typed number
        # are not the same evidence.
        assert record["source"] == "aruco"
        assert record["perspectiveCorrected"] is True
        assert isinstance(record["mmPerPx"], float)
