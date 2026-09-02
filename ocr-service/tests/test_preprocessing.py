"""
Decoding and correction, tested without loading a model.

The case that matters most is the first one: a phone photograph carries its
rotation in an EXIF flag, and a decoder that ignores it hands the model a
sideways label, which reads as nothing at all.
"""

import io
import sys
from pathlib import Path

import pytest
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.image_preprocessing import (  # noqa: E402
    MAX_EDGE_PX,
    InvalidImageError,
    enhance,
    prepare,
)


def encode(image: Image.Image, fmt: str = "JPEG") -> bytes:
    buffer = io.BytesIO()
    image.save(buffer, format=fmt)
    return buffer.getvalue()


class TestPrepare:
    def test_decodes_a_plain_jpeg(self):
        prepared = prepare(encode(Image.new("RGB", (800, 600), (250, 250, 250))))

        assert (prepared.width, prepared.height) == (800, 600)
        assert (prepared.original_width, prepared.original_height) == (800, 600)
        assert prepared.scale == 1.0
        # BGR, three channels, which is what PaddleOCR consumes.
        assert prepared.array.shape == (600, 800, 3)

    def test_downscales_an_oversized_photograph(self):
        prepared = prepare(encode(Image.new("RGB", (4000, 3000), (250, 250, 250))))

        assert max(prepared.width, prepared.height) == MAX_EDGE_PX
        assert (prepared.original_width, prepared.original_height) == (4000, 3000)
        # The factor the boxes are mapped back by, so the overlay lands on the
        # original image rather than on the working copy.
        assert prepared.scale == pytest.approx(2.0, abs=0.01)
        assert any(step.startswith("downscale") for step in prepared.steps)

    def test_leaves_a_normal_photograph_untouched(self):
        prepared = prepare(encode(Image.new("RGB", (900, 1200), (250, 250, 250))))

        # No enhancement on the first pass. Aggressive preprocessing costs
        # recall on a label photographed in a shop.
        assert prepared.steps == []

    def test_flattens_transparency_onto_white(self):
        # A PNG label with an alpha channel otherwise composites onto black,
        # and black text disappears into it.
        transparent = Image.new("RGBA", (400, 300), (255, 255, 255, 0))
        prepared = prepare(encode(transparent, fmt="PNG"))

        assert "flatten-alpha" in prepared.steps
        assert prepared.array.shape == (300, 400, 3)

    def test_decodes_an_iphone_heic_photograph(self):
        from services.image_preprocessing import HEIF_SUPPORTED

        if not HEIF_SUPPORTED:
            pytest.skip("pillow-heif is not installed")

        buffer = io.BytesIO()
        Image.new("RGB", (800, 600), (250, 250, 250)).save(buffer, format="HEIF", quality=85)

        # HEIC is an iPhone's default, and the backend's magic-byte check lets
        # it through — so failing here would tell an inspector to retake a
        # photograph that was perfectly good.
        prepared = prepare(buffer.getvalue())

        assert (prepared.width, prepared.height) == (800, 600)

    def test_flags_an_image_too_small_for_small_print(self):
        prepared = prepare(encode(Image.new("RGB", (200, 150), (250, 250, 250))))

        # Reported, not rejected: the backend says why a read was thin rather
        # than refusing the inspector's photograph outright.
        assert prepared.low_resolution is True

    def test_applies_exif_orientation(self):
        # Orientation 6 is a portrait photograph stored as landscape — by far
        # the most common phone case.
        image = Image.new("RGB", (800, 600), (250, 250, 250))
        exif = image.getexif()
        exif[274] = 6

        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", exif=exif)
        prepared = prepare(buffer.getvalue())

        assert (prepared.width, prepared.height) == (600, 800)
        assert "exif-orientation" in prepared.steps

    @pytest.mark.parametrize(
        "data, reason",
        [
            (b"", "empty upload"),
            (b"this is not an image at all", "plain text"),
            (encode(Image.new("RGB", (100, 100)))[:40], "truncated jpeg"),
        ],
    )
    def test_rejects_anything_that_is_not_a_decodable_image(self, data, reason):
        # Must raise rather than return an empty read: an empty read reaches the
        # rule engine as a package with no declarations on it.
        with pytest.raises(InvalidImageError):
            prepare(data)


class TestEnhance:
    def test_lifts_contrast_without_changing_the_frame(self):
        prepared = prepare(encode(Image.new("RGB", (400, 300), (140, 138, 132))))
        enhanced = enhance(prepared)

        assert enhanced.array.shape == prepared.array.shape
        assert (enhanced.original_width, enhanced.original_height) == (400, 300)
        assert "clahe-contrast" in enhanced.steps

    def test_preserves_the_earlier_steps(self):
        prepared = prepare(encode(Image.new("RGB", (4000, 3000), (200, 200, 200))))
        enhanced = enhance(prepared)

        assert any(step.startswith("downscale") for step in enhanced.steps)
        assert enhanced.scale == prepared.scale


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
