"""
── PREPROCESSING ───────────────────────────────────────────────────────────

What this module does *not* do is the important part.

PP-OCRv5's detector was trained on photographs, not on scans. It already
handles moderate blur, uneven lighting, perspective and low contrast, and the
usual "clean it up first" pipeline — greyscale, Otsu threshold, denoise,
sharpen — measurably *hurts* it: binarising a foil packet destroys the faint
strokes of small print, and unsharp masking turns JPEG noise into glyphs. On a
label photographed in a shop, aggressive preprocessing costs recall.

So only two things happen unconditionally, and both are corrections rather
than enhancements:

  · EXIF orientation. A phone stores the sensor's frame plus a rotation flag.
    Decoders that ignore the flag hand the model a sideways label, and a
    sideways label reads as nothing. This is the single highest-value step in
    the file.
  · Downscale. Beyond ~2000px on the long edge the detector gains nothing and
    inference time grows with the pixel count. A 12 MP phone photograph is 4x
    slower for the same text.

Enhancement (CLAHE on the luminance channel) exists but is *not* applied on
the first pass. It is held back for the retry in `ocr_service`, so it only
ever runs on an image that already failed to read — where making things worse
is not a risk, because nothing is what we already have.

The caller keeps the original bytes. Nothing here is destructive to the stored
evidence; these arrays are inputs to the model and are then discarded.
────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import io
from dataclasses import dataclass, field, replace

import cv2
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

# HEIC/HEIF is what an iPhone camera produces by default, and the backend's
# magic-byte check already lets it through — so without this an inspector on an
# iPhone would be told to retake a photograph that was perfectly good. Pillow
# has no HEIC support of its own; this registers the decoder.
try:
    from pillow_heif import register_heif_opener

    register_heif_opener()
    HEIF_SUPPORTED = True
except ImportError:  # pragma: no cover - only when the optional wheel is absent
    HEIF_SUPPORTED = False


class InvalidImageError(ValueError):
    """The bytes are not a decodable image. Distinct from "decoded, but empty"."""


# Beyond this the detector stops gaining accuracy and starts costing seconds.
MAX_EDGE_PX = 2000

# Below this a photograph is too small for small print to survive detection at
# all. Not rejected — reported, so the backend can say why a read was thin.
MIN_EDGE_PX = 320


@dataclass
class PreparedImage:
    """A model-ready array plus the record of what was done to get there."""

    array: np.ndarray
    """BGR, which is what PaddleOCR consumes when handed an ndarray."""

    width: int
    height: int
    original_width: int
    original_height: int
    steps: list[str] = field(default_factory=list)
    low_resolution: bool = False

    @property
    def scale(self) -> float:
        """Factor to map a coordinate in `array` back to the original frame."""
        return self.original_width / self.width if self.width else 1.0


def prepare(data: bytes) -> PreparedImage:
    """
    Decodes and minimally corrects an uploaded image.

    Raises `InvalidImageError` for anything that is not a decodable image —
    a truncated upload, a PDF renamed to .jpg, a zero-byte file.
    """
    if not data:
        raise InvalidImageError("The image is empty.")

    try:
        pil = Image.open(io.BytesIO(data))
        # Forces a full decode now rather than lazily mid-inference, so a
        # truncated file fails here with a clear error instead of deep inside
        # Paddle with a stack trace.
        pil.load()
    except UnidentifiedImageError as exc:
        raise InvalidImageError("The file is not a recognised image format.") from exc
    except OSError as exc:
        raise InvalidImageError("The image is corrupted or truncated.") from exc

    steps: list[str] = []

    # EXIF first, before anything reads the dimensions — a 90° rotation swaps
    # width and height, and every box we later report is in this frame.
    corrected = ImageOps.exif_transpose(pil)
    if corrected is not pil and corrected.size != pil.size:
        steps.append("exif-orientation")
    pil = corrected or pil

    # Flatten transparency onto white. A PNG label with an alpha channel
    # otherwise composites onto black and the black text vanishes into it.
    if pil.mode in ("RGBA", "LA", "P"):
        pil = pil.convert("RGBA")
        flattened = Image.new("RGB", pil.size, (255, 255, 255))
        flattened.paste(pil, mask=pil.split()[-1])
        pil = flattened
        steps.append("flatten-alpha")
    elif pil.mode != "RGB":
        pil = pil.convert("RGB")

    original_width, original_height = pil.size

    longest = max(pil.size)
    if longest > MAX_EDGE_PX:
        ratio = MAX_EDGE_PX / longest
        pil = pil.resize(
            (max(1, round(pil.width * ratio)), max(1, round(pil.height * ratio))),
            # LANCZOS rather than the default: downscaling small print with a
            # cheaper filter aliases strokes together and the recogniser reads
            # "rn" where the label says "m".
            Image.Resampling.LANCZOS,
        )
        steps.append(f"downscale-{MAX_EDGE_PX}px")

    array = cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)

    return PreparedImage(
        array=array,
        width=pil.width,
        height=pil.height,
        original_width=original_width,
        original_height=original_height,
        steps=steps,
        low_resolution=max(original_width, original_height) < MIN_EDGE_PX,
    )


def enhance(image: PreparedImage) -> PreparedImage:
    """
    The retry pass: local contrast, applied only after a read found nothing.

    CLAHE on the L channel of LAB, so contrast is lifted per-region without
    touching hue — a global histogram stretch blows out the printed area of a
    label photographed against a bright background, which is precisely the
    case that failed the first time.

    Deliberately conservative: clipLimit 2.0 and 8x8 tiles. Higher values
    recover a little more faint text and start inventing edges in JPEG blocks.
    """
    lab = cv2.cvtColor(image.array, cv2.COLOR_BGR2LAB)
    lightness, a_channel, b_channel = cv2.split(lab)

    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    merged = cv2.merge((clahe.apply(lightness), a_channel, b_channel))

    return PreparedImage(
        array=cv2.cvtColor(merged, cv2.COLOR_LAB2BGR),
        width=image.width,
        height=image.height,
        original_width=image.original_width,
        original_height=image.original_height,
        steps=[*image.steps, "clahe-contrast"],
        low_resolution=image.low_resolution,
    )


# ── VARIANTS AND ROTATION ───────────────────────────────────────────────────
#
# Everything below exists for one reason: a label photographed in a shop is
# often not a label the detector can read on the first attempt. Curved bottles
# throw the text out of plane, a foil sachet blows the contrast, an MRP box is
# laser-printed dark-on-dark, and a phone held sideways produces a label rotated
# ninety degrees that no per-line orientation classifier will fix.
#
# The response is to read the image more than once and keep the best of what
# comes back — not to "clean up" the image and hope. That is the important
# distinction: a variant is an *additional* attempt, never a replacement. The
# original is always read too, so a transform that destroys faint print can
# only ever add nothing, never take a reading away.
#
# The cost is real, which is why `ocr_service` runs these conditionally rather
# than always. See the note there.


def sharpen(image: PreparedImage) -> PreparedImage:
    """
    An unsharp mask, for print that has gone soft.

    Helps most on the case it was added for: small type photographed slightly
    out of focus, where the strokes are present but smeared into each other.

    Deliberately mild — amount 1.5 against a 3px blur. Pushed harder it starts
    turning JPEG ringing into strokes, and the recogniser reads those as
    punctuation inside a price.
    """
    blurred = cv2.GaussianBlur(image.array, (0, 0), 3)
    sharpened = cv2.addWeighted(image.array, 1.5, blurred, -0.5, 0)

    return replace(image, array=sharpened, steps=[*image.steps, "sharpen"])


def upscale(image: PreparedImage, factor: float = 2.0) -> PreparedImage:
    """
    Enlarges the image so small print occupies more pixels.

    The recogniser has a minimum height below which a character simply has too
    few pixels to identify, and a batch code printed in 1mm type on a 2000px
    photograph can fall under it. Interpolating adds no information, but it does
    give the network the input size it was trained for, which in practice is
    what recovers the line.

    CUBIC rather than LANCZOS here: upscaling with LANCZOS rings around
    high-contrast edges, and printed text is nothing but high-contrast edges.

    `scale` is updated so boxes still map back to the original photograph —
    getting that wrong would put every evidence overlay in the wrong place.
    """
    enlarged = cv2.resize(
        image.array, None, fx=factor, fy=factor, interpolation=cv2.INTER_CUBIC
    )

    return replace(
        image,
        array=enlarged,
        width=enlarged.shape[1],
        height=enlarged.shape[0],
        steps=[*image.steps, f"upscale-{factor:g}x"],
    )


def denoise(image: PreparedImage) -> PreparedImage:
    """
    Edge-preserving denoise, for photographs taken in poor light.

    Bilateral rather than Gaussian: a Gaussian blur removes the noise and the
    thin strokes with it. This keeps the edges that are the text.
    """
    return replace(
        image,
        array=cv2.bilateralFilter(image.array, d=5, sigmaColor=60, sigmaSpace=60),
        steps=[*image.steps, "denoise"],
    )


def rotate(image: PreparedImage, degrees: int) -> PreparedImage:
    """
    Rotates by a right angle.

    Only 90/180/270, because those are lossless and cover the case this is for:
    a photograph whose EXIF orientation was absent or wrong, so the whole label
    is on its side. PaddleOCR's text-line orientation classifier handles a line
    printed upside down; it does not handle the entire image being rotated.

    The frame changes, so `width`/`height` are swapped for the odd multiples.
    Boxes found in a rotated frame are mapped back by `ocr_service` before they
    reach the caller.
    """
    if degrees % 360 == 0:
        return image

    codes = {
        90: cv2.ROTATE_90_CLOCKWISE,
        180: cv2.ROTATE_180,
        270: cv2.ROTATE_90_COUNTERCLOCKWISE,
    }
    rotated = cv2.rotate(image.array, codes[degrees % 360])

    return replace(
        image,
        array=rotated,
        width=rotated.shape[1],
        height=rotated.shape[0],
        steps=[*image.steps, f"rotate-{degrees}"],
    )
