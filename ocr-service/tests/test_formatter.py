"""
The wire format, tested without loading a model.

These are the rules that decide whether a trader gets a finding recorded
against them, so they are asserted directly rather than inferred from an
end-to-end read:

  · a confidence the engine did not supply is never invented;
  · text is never cleaned up, because the rules test wording;
  · boxes are mapped back to the original photograph's frame, because that is
    the image an inspector sees the overlay on.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from utils import formatter  # noqa: E402


class TestLine:
    def test_reports_a_confidence_the_engine_supplied(self):
        entry = formatter.line("MRP 315.00", 0.9712, [[10, 20], [90, 20], [90, 50], [10, 50]])

        assert entry["text"] == "MRP 315.00"
        assert entry["confidence"] == 0.9712

    def test_omits_confidence_entirely_when_there_is_none(self):
        entry = formatter.line("MRP 315.00", None, [[10, 20], [90, 20], [90, 50], [10, 50]])

        # Not 0.0, not 1.0 — absent. The rule engine reads an absent confidence
        # as "reliability unknown" and routes a failed check to review; a
        # default would turn that unknown into a violation.
        assert "confidence" not in entry

    def test_keeps_the_text_exactly_as_printed(self):
        # Rule 6 tests wording. Expanding "M.R.P." or normalising the currency
        # symbol changes what the rule engine is shown.
        entry = formatter.line("M.R.P. ₹315.00 (incl. of all taxes)", 0.9, None)

        assert entry["text"] == "M.R.P. ₹315.00 (incl. of all taxes)"

    def test_trims_surrounding_whitespace_only(self):
        entry = formatter.line("  Net Quantity: 5 kg  ", 0.9, None)

        assert entry["text"] == "Net Quantity: 5 kg"

    def test_drops_a_line_with_no_text(self):
        assert formatter.line("   ", 0.9, None) is None
        assert formatter.line("", 0.9, None) is None

    def test_derives_the_enclosing_rectangle_from_the_polygon(self):
        # A quadrilateral from text photographed at an angle. The rectangle is
        # what an overlay can actually draw.
        entry = formatter.line("tilted", 0.9, [[10, 20], [92, 25], [90, 55], [8, 50]])

        assert entry["boundingBox"] == {"x": 8, "y": 20, "width": 84, "height": 35}
        assert entry["polygon"] == [[10, 20], [92, 25], [90, 55], [8, 50]]

    def test_maps_coordinates_back_to_the_original_frame(self):
        # The read happened on a 2x downscaled copy; the stored evidence image
        # is the original, so the boxes have to be scaled back onto it.
        entry = formatter.line("scaled", 0.9, [[10, 20], [50, 20], [50, 40], [10, 40]], scale=2.0)

        assert entry["boundingBox"] == {"x": 20, "y": 40, "width": 80, "height": 40}

    def test_survives_a_malformed_polygon(self):
        entry = formatter.line("text", 0.9, "not-a-polygon")

        assert entry["text"] == "text"
        assert "boundingBox" not in entry


class TestReadingOrder:
    def test_sorts_top_to_bottom_then_left_to_right(self):
        lines = [
            {"text": "third", "boundingBox": {"x": 10, "y": 200, "width": 50, "height": 20}},
            {"text": "first", "boundingBox": {"x": 10, "y": 10, "width": 50, "height": 20}},
            {"text": "second", "boundingBox": {"x": 90, "y": 12, "width": 50, "height": 20}},
        ]

        # "second" sits beside "first", two pixels lower. Ordering by raw y
        # would interleave the columns of a two-column label.
        assert [entry["text"] for entry in formatter.reading_order(lines)] == [
            "first",
            "second",
            "third",
        ]

    def test_puts_boxless_lines_last_rather_than_dropping_them(self):
        lines = [
            {"text": "nowhere"},
            {"text": "somewhere", "boundingBox": {"x": 0, "y": 5, "width": 10, "height": 10}},
        ]

        assert [entry["text"] for entry in formatter.reading_order(lines)] == [
            "somewhere",
            "nowhere",
        ]


class TestMergePasses:
    def _box(self, x, y, w=100, h=30):
        return {"x": x, "y": y, "width": w, "height": h}

    def test_keeps_a_secondary_line_that_does_not_overlap(self):
        primary = [{"text": "MRP 315.00", "boundingBox": self._box(0, 0)}]
        secondary = [{"text": "अधिकतम", "boundingBox": self._box(0, 200)}]

        merged = formatter.merge_passes(primary, secondary)

        assert len(merged) == 2

    def test_discards_a_secondary_line_sitting_on_a_primary_one(self):
        primary = [{"text": "MRP 315.00", "boundingBox": self._box(0, 0)}]
        # A Devanagari recogniser re-reading the same Latin line, badly.
        secondary = [{"text": "MRP315OO", "boundingBox": self._box(2, 1)}]

        merged = formatter.merge_passes(primary, secondary)

        assert len(merged) == 1
        assert merged[0]["text"] == "MRP 315.00"

    def test_never_lets_a_secondary_reading_replace_a_primary_one(self):
        # The scores come from two different recognisers and are not comparable,
        # so a higher secondary confidence must not win.
        primary = [{"text": "MRP 315.00", "confidence": 0.6, "boundingBox": self._box(0, 0)}]
        secondary = [{"text": "WRONG", "confidence": 0.99, "boundingBox": self._box(0, 0)}]

        merged = formatter.merge_passes(primary, secondary)

        assert [entry["text"] for entry in merged] == ["MRP 315.00"]

    def test_ignores_a_secondary_line_with_no_geometry(self):
        primary = [{"text": "MRP", "boundingBox": self._box(0, 0)}]

        # Without a box there is no way to tell whether it duplicates a primary
        # reading, and a duplicate declaration is worse than a missing one.
        assert formatter.merge_passes(primary, [{"text": "unplaced"}]) == primary



class TestUnrotate:
    """
    Boxes found on a rotated pass have to come home.

    A box left in the rotated frame is drawn on the stored photograph at ninety
    degrees to the text it belongs to, which is worse than no box: it looks
    authoritative and points at the wrong thing.
    """

    def test_maps_a_90_degree_box_back(self):
        # Forward: (x, y) -> (height - 1 - y, x) for a clockwise quarter turn.
        # A point at (10, 20) in a 200x100 original lands at (79, 10).
        assert formatter.unrotate([[79, 10]], 90, 200, 100) == [[10, 20]]

    def test_maps_a_180_degree_box_back(self):
        assert formatter.unrotate([[189, 79]], 180, 200, 100) == [[10, 20]]

    def test_maps_a_270_degree_box_back(self):
        assert formatter.unrotate([[20, 189]], 270, 200, 100) == [[10, 20]]

    def test_leaves_an_unrotated_box_alone(self):
        assert formatter.unrotate([[10, 20]], 0, 200, 100) == [[10, 20]]

    def test_survives_a_missing_polygon(self):
        assert formatter.unrotate(None, 90, 200, 100) is None


class TestMergeVariants:
    def _line(self, text, confidence, x, y=0):
        return {
            "text": text,
            "confidence": confidence,
            "boundingBox": {"x": x, "y": y, "width": 100, "height": 30},
        }

    def test_prefers_the_more_confident_reading_of_the_same_line(self):
        # Same printed line read twice through different enhancements. Unlike
        # `merge_passes`, these scores are comparable — one recogniser, one
        # image — so the surer reading wins.
        original = [self._line("MRP 3l5.OO", 0.62, 0)]
        sharpened = [self._line("MRP 315.00", 0.97, 2)]

        merged = formatter.merge_variants(original, sharpened)

        assert [entry["text"] for entry in merged] == ["MRP 315.00"]

    def test_keeps_the_earlier_reading_when_the_variant_is_less_sure(self):
        original = [self._line("MRP 315.00", 0.97, 0)]
        worse = [self._line("MRP 3I5.OO", 0.41, 2)]

        assert formatter.merge_variants(original, worse)[0]["text"] == "MRP 315.00"

    def test_adds_a_line_no_earlier_pass_found(self):
        # The main win: a laser-printed batch code invisible in the original and
        # legible after contrast enhancement is new text, not a correction.
        original = [self._line("MRP 315.00", 0.95, 0, 0)]
        enhanced = [self._line("Batch XY7742", 0.88, 0, 400)]

        merged = formatter.merge_variants(original, enhanced)

        assert len(merged) == 2

    def test_ignores_a_variant_line_with_no_geometry(self):
        original = [self._line("MRP 315.00", 0.95, 0)]

        assert formatter.merge_variants(original, [{"text": "unplaced"}]) == original


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
