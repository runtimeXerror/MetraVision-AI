"""
The real engine, against real images.

Slow — these load the pretrained weights and run inference, so the whole file
is marked `slow` and skipped by default:

    pytest tests/                 # fast: formatter + preprocessing only
    pytest tests/ -m slow         # loads the model and reads images

The labels are rendered rather than photographed, which makes them a
regression test and not an accuracy benchmark: they prove the pipeline reads,
locates and scores text, and that a blank surface is distinguished from a
failure. What they cannot prove is field accuracy on a crumpled foil packet
under a shop light. Judge that on real photographs.
"""

import sys
from pathlib import Path

import pytest
from PIL import Image, ImageDraw, ImageFilter, ImageFont

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

pytestmark = pytest.mark.slow

# The declarations a Legal Metrology check actually needs off this label.
DECLARATIONS = [
    "5 kg",
    "315.00",
    "ITC Limited",
    "560058",
    "06/2026",
    "1800-425-4444",
    "India",
]

LINES = [
    ("AASHIRVAAD", 54),
    ("Select Sharbati Atta", 40),
    ("Net Quantity: 5 kg", 34),
    ("MRP Rs.315.00 (incl. of all taxes)", 32),
    ("Manufactured by: ITC Limited, Foods Division,", 26),
    ("18 Industrial Area, Bengaluru - 560058, Karnataka", 26),
    ("Mfg. Date: 06/2026", 28),
    ("Best Before: 12 months from packaging", 26),
    ("Customer Care: care@itc.in, Toll Free 1800-425-4444", 24),
    ("FSSAI Lic. No. 10012021000123", 26),
    ("Country of Origin: India", 30),
]


def _font(size: int):
    for name in ("arial.ttf", "segoeui.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def label(scale: float = 1.0, bg=(250, 248, 240), fg=(25, 25, 25)) -> Image.Image:
    width, height = int(900 * scale), int(1100 * scale)
    image = Image.new("RGB", (width, height), bg)
    draw = ImageDraw.Draw(image)

    y = 80 * scale
    for text, size in LINES:
        draw.text((70 * scale, y), text, fill=fg, font=_font(max(6, int(size * scale))))
        y += (size + 26) * scale

    return image


def encode(image: Image.Image) -> bytes:
    import io

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88)
    return buffer.getvalue()


@pytest.fixture(scope="module")
def read():
    """Loads the weights once for the whole module."""
    from services import ocr_service

    ocr_service.warm_up()
    return ocr_service.read


def found(result, tokens=DECLARATIONS) -> list[str]:
    text = result["fullText"].lower()
    return [token for token in tokens if token.lower() not in text]


class TestReadsALabel:
    @pytest.mark.parametrize(
        "name, image",
        [
            ("clear", label()),
            ("low resolution", label(scale=0.42)),
            ("small print", label(scale=0.62)),
            ("blurry", label().filter(ImageFilter.GaussianBlur(radius=2.2))),
            ("rotated 12 degrees", label().rotate(-12, expand=True, fillcolor=(250, 248, 240))),
            ("low contrast", label(bg=(140, 138, 132), fg=(105, 103, 99))),
        ],
    )
    def test_finds_every_mandatory_declaration(self, read, name, image):
        result = read(encode(image))

        assert result["success"] is True
        assert found(result) == [], f"{name}: declarations not read"

    def test_reports_a_box_and_a_confidence_for_every_line(self, read):
        result = read(encode(label()))

        assert result["lines"], "expected at least one line"
        for line in result["lines"]:
            # Both are load-bearing downstream: the boxes draw the evidence
            # overlay, the confidences route a weak check to review.
            assert "boundingBox" in line, f"no box on {line['text']!r}"
            assert "confidence" in line, f"no confidence on {line['text']!r}"
            assert 0.0 <= line["confidence"] <= 1.0

    def test_boxes_sit_inside_the_original_frame(self, read):
        # A 4000px photograph is read on a downscaled copy; if the boxes were
        # not mapped back, they would land outside the stored evidence image.
        big = label().resize((3600, 4400), Image.Resampling.LANCZOS)
        result = read(encode(big))

        width = result["metadata"]["imageWidth"]
        height = result["metadata"]["imageHeight"]
        assert (width, height) == (3600, 4400)

        for line in result["lines"]:
            box = line["boundingBox"]
            assert 0 <= box["x"] <= width
            assert 0 <= box["y"] <= height
            assert box["x"] + box["width"] <= width + 2
            assert box["y"] + box["height"] <= height + 2

    def test_returns_lines_in_reading_order(self, read):
        result = read(encode(label()))

        tops = [line["boundingBox"]["y"] for line in result["lines"]]
        assert tops == sorted(tops), "lines are not top-to-bottom"

    def test_reads_a_currency_symbol_and_a_decimal_price(self, read):
        result = read(encode(label()))

        assert "315.00" in result["fullText"]

    def test_reports_the_models_it_actually_used(self, read):
        result = read(encode(label()))

        # Provenance: a finding has to be attributable to the model that
        # produced the reading it rests on.
        assert result["metadata"]["models"]
        assert result["metadata"]["engine"] == "paddleocr"


class TestReadsNothing:
    def test_a_blank_surface_succeeds_with_no_lines(self, read):
        result = read(encode(Image.new("RGB", (900, 1200), (245, 243, 238))))

        # THE distinction the whole pipeline rests on. Not an error: an error
        # here would be indistinguishable from an outage, and an outage
        # reported as an empty label becomes a violation against a trader.
        assert result["success"] is True
        assert result["lines"] == []
        assert result["fullText"] == ""
        assert result["metadata"]["meanConfidence"] is None

    def test_tries_harder_before_giving_up(self, read):
        result = read(encode(Image.new("RGB", (900, 1200), (245, 243, 238))))

        passes = result["metadata"]["passes"]

        # A blank surface reads as nothing, so every extra pass is attempted —
        # the enhancements, and then the rotations, because an image that reads
        # as nothing may simply be sideways. They can only add readings: the
        # original pass is kept and merged with, never replaced.
        assert passes[0] == "original"
        assert "clahe" in passes
        assert any(entry.startswith("rotate-") for entry in passes)

        # And it still concludes, correctly, that there is nothing there.
        assert result["lines"] == []


class TestFailures:
    @pytest.mark.parametrize("data", [b"", b"not an image", b"\xff\xd8\xff\xe0truncated"])
    def test_undecodable_bytes_raise_rather_than_read_as_empty(self, read, data):
        from services.image_preprocessing import InvalidImageError

        with pytest.raises(InvalidImageError):
            read(data)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "-m", "slow"]))
