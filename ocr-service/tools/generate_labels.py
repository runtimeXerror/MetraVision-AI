"""
── SYNTHETIC BACK PANELS, PHOTOGRAPHED BADLY ────────────────────────────────

    .venv/Scripts/python.exe tools/generate_labels.py

Renders declaration blocks the way Indian packaged commodities actually print
them, then degrades each one the way a phone in a shop actually photographs it,
and writes the ground truth beside it.

── Why this exists, and why not stock photographs ──────────────────────────

The obvious way to test on twenty packages is to pull twenty product images off
the internet. It produces a number and the number is worthless, for a reason
that is structural rather than a matter of picking better images:

  · Every mandatory declaration under rule 6(1) — the MRP, the net quantity,
    the manufacturer's address, the month and year of manufacture, the consumer
    care details — is printed on the BACK panel. Product photography is of the
    front. A front-panel shot carries a brand and sometimes a net quantity, and
    the pipeline being tested is a pipeline for reading the other seven.
  · What is published is a studio render: flat, evenly lit, high resolution,
    dead square to the camera. It has no glare, no curve, no skew, no focus
    falloff. It exercises none of the conditions that break a real reading —
    which are precisely the conditions this project keeps finding bugs in.

So a stock-photo corpus reads at ninety-something per cent and teaches nothing,
which is the same false confidence as a corpus of one package scoring 12/12.

Here the ground truth is known exactly, because the text was placed by this
file. That is the one thing neither a stock photo nor a phone photograph gives
without somebody sitting down with the packet and typing it out — and it is
what makes it possible to say *which* condition broke *which* declaration
rather than that a score went down.

None of this replaces real photographs. It cannot: a synthetic glare is a
gradient, and a real one is a tube light reflecting off foil at an angle no
model of mine predicts. What it does is make the failure modes reproducible, so
a fix can be shown to fix something.

── The degradations ────────────────────────────────────────────────────────

Each is a thing that happens on a shop floor, not an arbitrary filter:

    glare        a tube light on foil or laminate — a blown highlight, which
                 is unrecoverable rather than dim: the strokes are gone
    curve        a bottle, a tube, a pouch that will not lie flat
    skew         a photograph taken at arm's length, not square to the panel
    perspective  the panel photographed from an angle
    dim          a godown at the back of a shop
    soft         a phone that focused on the officer's hand
    noise        JPEG at the quality a camera app actually writes
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

import json
import math
import os
import random
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "testing"

FONT_DIR = Path("C:/Windows/Fonts")
# Condensed and plain sans, which is what packaging actually uses. The bold is
# for the brand line, which is set larger and heavier on every real pack.
FONT_REGULAR = FONT_DIR / "arial.ttf"
FONT_BOLD = FONT_DIR / "arialbd.ttf"
FONT_NARROW = FONT_DIR / "tahoma.ttf"


@dataclass
class Package:
    slug: str
    brand: str
    commodity: str
    category: str
    lines: list[tuple[str, str]]
    """(text, weight) where weight is 'regular' | 'bold' | 'small'."""
    truth: dict[str, str | None]
    conditions: list[str] = field(default_factory=list)


def rupee(amount: str) -> str:
    return f"\u20b9{amount}"


# ── The twenty packages ──────────────────────────────────────────────────────
#
# Chosen to spread across what the rule engine actually branches on: food and
# cosmetic and household, domestic and imported, weight and volume and count,
# and the declaration formats that this project has already been bitten by.

def build_packages() -> list[Package]:
    packs: list[Package] = []

    packs.append(Package(
        slug="atta-5kg",
        brand="SURYA", commodity="Whole Wheat Atta", category="packaged_food",
        lines=[
            ("Whole Wheat Atta", "bold"),
            ("Net Wt. 5 kg", "regular"),
            ("M.R.P. \u20b9 245.00 (incl. of all taxes)", "regular"),
            ("Mfg. Date : 03/2026", "regular"),
            ("Best Before 6 Months from Mfg.", "small"),
            ("Batch No. SA-2603", "regular"),
            ("Manufactured & Packed by:", "small"),
            ("Surya Foods Pvt. Ltd., Plot 42, MIDC,", "small"),
            ("Nashik, Maharashtra - 422007", "small"),
            ("Customer Care: 1800-233-4455", "small"),
            ("Email: care@suryafoods.co.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "5 kg", "mrp": "245.00", "manufacturing_date": "03/2026",
               "batch_number": "SA-2603", "country_of_origin": "India",
               "consumer_care": "care@suryafoods.co.in", "manufacturer": "Surya Foods"},
        conditions=["clean"],
    ))

    packs.append(Package(
        slug="noodles-70g-glare",
        brand="TASTY", commodity="Instant Noodles", category="packaged_food",
        lines=[
            ("Instant Noodles - Masala", "bold"),
            ("Net Qty.: 70 g", "regular"),
            ("MRP \u20b9 14.00", "regular"),
            ("(Incl. of all taxes)", "small"),
            ("MFD 01/2026", "regular"),
            ("Batch No. TN0126", "regular"),
            ("Mktd by: Tasty Foods India Ltd.,", "small"),
            ("Gurugram, Haryana - 122002", "small"),
            ("Consumer Care: 1800-100-2000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "70 g", "mrp": "14.00", "manufacturing_date": "01/2026",
               "batch_number": "TN0126", "country_of_origin": "India"},
        conditions=["glare"],
    ))

    packs.append(Package(
        slug="shampoo-340ml-curve",
        brand="GLOSS", commodity="Anti-Dandruff Shampoo", category="cosmetic",
        lines=[
            ("Anti-Dandruff Shampoo", "bold"),
            ("Net Vol. 340 ml", "regular"),
            ("M.R.P. Rs. 399.00", "regular"),
            ("(Incl. of all taxes)", "small"),
            ("Mfg. Date: 11/2025", "regular"),
            ("Use Before: 36 Months", "small"),
            ("B.No: GL5521", "regular"),
            ("Marketed by Gloss Personal Care Ltd.,", "small"),
            ("Andheri East, Mumbai - 400069", "small"),
            ("care@glosscare.in | 1800-266-1234", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "340 ml", "mrp": "399.00", "manufacturing_date": "11/2025",
               "batch_number": "GL5521", "country_of_origin": "India"},
        conditions=["curve"],
    ))

    packs.append(Package(
        slug="biscuits-200g-skew",
        brand="CRUNCH", commodity="Glucose Biscuits", category="packaged_food",
        lines=[
            ("Glucose Biscuits", "bold"),
            ("Net Weight: 200 g", "regular"),
            ("Maximum Retail Price \u20b9 30.00", "regular"),
            ("Month & Year of Manufacture: 02/2026", "regular"),
            ("Batch No. CR-0226-A", "regular"),
            ("Packed by: Crunch Bakers Pvt Ltd,", "small"),
            ("Vasai, Palghar, Maharashtra - 401208", "small"),
            ("Consumer Complaints: help@crunch.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "200 g", "mrp": "30.00", "manufacturing_date": "02/2026",
               "batch_number": "CR-0226-A", "country_of_origin": "India"},
        conditions=["skew"],
    ))

    packs.append(Package(
        slug="soap-125g-dim",
        brand="PURE", commodity="Bathing Soap", category="personal_care",
        lines=[
            ("Bathing Soap", "bold"),
            ("Net Wt. 125 g", "regular"),
            ("MRP \u20b9 45.00 (incl. of all taxes)", "regular"),
            ("Mfd: 12/2025", "regular"),
            ("Batch: PS1225", "regular"),
            ("Mfd by Pure Hygiene Products,", "small"),
            ("Baddi, Solan, Himachal Pradesh - 173205", "small"),
            ("Consumer Care: consumer@purehygiene.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "125 g", "mrp": "45.00", "manufacturing_date": "12/2025",
               "batch_number": "PS1225", "country_of_origin": "India"},
        conditions=["dim"],
    ))

    packs.append(Package(
        slug="oil-1l-perspective",
        brand="GOLDEN", commodity="Refined Sunflower Oil", category="packaged_food",
        lines=[
            ("Refined Sunflower Oil", "bold"),
            ("Net Volume: 1 L", "regular"),
            ("M.R.P. \u20b9 185.00", "regular"),
            ("(Inclusive of all taxes)", "small"),
            ("Packed On: 02/2026", "regular"),
            ("Best Before 9 Months from Packing", "small"),
            ("Batch No. GO-226", "regular"),
            ("Packed by Golden Oils Ltd.,", "small"),
            ("Kandla SEZ, Gujarat - 370230", "small"),
            ("Customer Care 1800-419-0000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "1 l", "mrp": "185.00", "manufacturing_date": "02/2026",
               "batch_number": "GO-226", "country_of_origin": "India"},
        conditions=["perspective"],
    ))

    packs.append(Package(
        slug="earbuds-imported-soft",
        brand="SONIQ", commodity="Wireless Earbuds", category="electronics",
        lines=[
            ("Wireless Earbuds", "bold"),
            ("Net Qty.: 1 N", "regular"),
            ("MRP \u20b9 2,499.00 (incl. of all taxes)", "regular"),
            ("Imported & Marketed by:", "small"),
            ("Soniq India Pvt Ltd, Sector 44,", "small"),
            ("Gurugram, Haryana - 122003", "small"),
            ("Month & Year of Import: 01/2026", "regular"),
            ("Country of Origin: China", "small"),
            ("Consumer Care: support.in@soniq.com", "small"),
        ],
        truth={"net_quantity": "1 N", "mrp": "2,499.00", "country_of_origin": "China"},
        conditions=["soft"],
    ))

    packs.append(Package(
        slug="detergent-1kg-noise",
        brand="SPARK", commodity="Detergent Powder", category="household",
        lines=[
            ("Detergent Powder", "bold"),
            ("Net Wt. 1 kg", "regular"),
            ("MRP Rs 99/-", "regular"),
            ("Mfg 03/2026", "regular"),
            ("Batch No. SP-303", "regular"),
            ("Mfd by Spark Home Care Pvt Ltd,", "small"),
            ("Bhiwadi, Alwar, Rajasthan - 301019", "small"),
            ("Consumer Care: 1800-123-9000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "1 kg", "mrp": "99", "manufacturing_date": "03/2026",
               "batch_number": "SP-303", "country_of_origin": "India"},
        conditions=["noise"],
    ))

    packs.append(Package(
        slug="tea-250g-glare-skew",
        brand="ASSAM GOLD", commodity="Black Tea", category="packaged_food",
        lines=[
            ("Black Tea - Premium Leaf", "bold"),
            ("Net Wt.: 250 g", "regular"),
            ("Maximum Retail Price \u20b9 160.00", "regular"),
            ("(Incl. of all taxes)", "small"),
            ("Month & Year of Packing: 01/2026", "regular"),
            ("Batch No. AG-0126", "regular"),
            ("Packed by Assam Gold Tea Co.,", "small"),
            ("Dibrugarh, Assam - 786001", "small"),
            ("Email: care@assamgold.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "250 g", "mrp": "160.00", "manufacturing_date": "01/2026",
               "batch_number": "AG-0126", "country_of_origin": "India"},
        conditions=["glare", "skew"],
    ))

    packs.append(Package(
        slug="facecream-50g-curve-dim",
        brand="HERBAL", commodity="Face Cream", category="cosmetic",
        lines=[
            ("Nourishing Face Cream", "bold"),
            ("Net Wt. 50 g", "regular"),
            ("M.R.P. \u20b9 299.00", "regular"),
            ("Mfg. Date : 10/2025", "regular"),
            ("Best Before 24 Months", "small"),
            ("Batch No. HB-1025", "regular"),
            ("Mfd by Herbal Beauty Labs,", "small"),
            ("Haridwar, Uttarakhand - 249403", "small"),
            ("care@herbalbeauty.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "50 g", "mrp": "299.00", "manufacturing_date": "10/2025",
               "batch_number": "HB-1025", "country_of_origin": "India"},
        conditions=["curve", "dim"],
    ))

    # ── The ten that carry a defect on purpose ──────────────────────────────
    #
    # A compliance system is judged on what it does with a bad package, not a
    # good one. Each of these is missing or malforming exactly one mandatory
    # declaration, and the truth records it as absent so a reading that
    # "finds" it is caught as an invention.

    packs.append(Package(
        slug="spices-100g-no-mrp",
        brand="MASALA KING", commodity="Turmeric Powder", category="packaged_food",
        lines=[
            ("Turmeric Powder (Haldi)", "bold"),
            ("Net Wt. 100 g", "regular"),
            ("Mfg. Date: 02/2026", "regular"),
            ("Batch No. MK-0226", "regular"),
            ("Packed by Masala King Foods,", "small"),
            ("Unjha, Mehsana, Gujarat - 384170", "small"),
            ("Consumer Care: 1800-200-3000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "100 g", "mrp": None, "manufacturing_date": "02/2026",
               "batch_number": "MK-0226", "country_of_origin": "India"},
        conditions=["clean"],
    ))

    packs.append(Package(
        slug="juice-1l-no-quantity",
        brand="FRESHO", commodity="Mixed Fruit Juice", category="beverage",
        lines=[
            ("Mixed Fruit Juice", "bold"),
            ("MRP \u20b9 120.00 (incl. of all taxes)", "regular"),
            ("Packed On: 03/2026", "regular"),
            ("Best Before 6 Months from Packing", "small"),
            ("Batch No. FR-0326", "regular"),
            ("Packed by Fresho Beverages Ltd.,", "small"),
            ("Chittoor, Andhra Pradesh - 517001", "small"),
            ("care@fresho.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": None, "mrp": "120.00", "manufacturing_date": "03/2026",
               "batch_number": "FR-0326", "country_of_origin": "India"},
        conditions=["clean"],
    ))

    packs.append(Package(
        slug="toy-imported-no-origin",
        brand="PLAYMAX", commodity="Building Blocks Set", category="other",
        lines=[
            ("Building Blocks Set", "bold"),
            ("Net Qty.: 1 Set", "regular"),
            ("MRP \u20b9 799.00 (incl. of all taxes)", "regular"),
            ("Imported & Marketed by:", "small"),
            ("Playmax Toys India Pvt Ltd,", "small"),
            ("Okhla Phase 2, New Delhi - 110020", "small"),
            ("Month & Year of Import: 12/2025", "regular"),
            ("Consumer Care: 1800-300-4000", "small"),
        ],
        truth={"mrp": "799.00", "country_of_origin": None},
        conditions=["skew"],
    ))

    packs.append(Package(
        slug="ghee-500ml-no-care",
        brand="DESI", commodity="Cow Ghee", category="packaged_food",
        lines=[
            ("Pure Cow Ghee", "bold"),
            ("Net Vol. 500 ml", "regular"),
            ("M.R.P. \u20b9 340.00", "regular"),
            ("Mfg. Date: 01/2026", "regular"),
            ("Batch No. DG-0126", "regular"),
            ("Mfd by Desi Dairy Pvt Ltd,", "small"),
            ("Anand, Gujarat - 388001", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "500 ml", "mrp": "340.00", "manufacturing_date": "01/2026",
               "batch_number": "DG-0126", "consumer_care": None, "country_of_origin": "India"},
        conditions=["glare"],
    ))

    packs.append(Package(
        slug="chips-50g-no-date",
        brand="CRISPY", commodity="Potato Chips", category="packaged_food",
        lines=[
            ("Potato Chips - Salted", "bold"),
            ("Net Wt. 50 g", "regular"),
            ("MRP \u20b9 20.00 (incl. of all taxes)", "regular"),
            ("Batch No. CP-9921", "regular"),
            ("Mfd by Crispy Snacks Pvt Ltd,", "small"),
            ("Rai, Sonipat, Haryana - 131029", "small"),
            ("Consumer Care: 1800-500-6000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "50 g", "mrp": "20.00", "manufacturing_date": None,
               "batch_number": "CP-9921", "country_of_origin": "India"},
        conditions=["curve"],
    ))

    packs.append(Package(
        slug="handwash-750ml-tiny-print",
        brand="SAFEGUARD", commodity="Liquid Handwash", category="household",
        lines=[
            ("Liquid Handwash Refill", "bold"),
            ("Net Vol. 750 ml", "small"),
            ("MRP \u20b9 199.00 (incl. of all taxes)", "small"),
            ("Mfg. Date: 02/2026", "small"),
            ("Batch No. SG-0226", "small"),
            ("Mfd by Safeguard Home Ltd, Baddi,", "small"),
            ("Solan, Himachal Pradesh - 173205", "small"),
            ("care@safeguardhome.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "750 ml", "mrp": "199.00", "manufacturing_date": "02/2026",
               "batch_number": "SG-0226", "country_of_origin": "India"},
        conditions=["soft"],
    ))

    packs.append(Package(
        slug="rice-10kg-perspective-glare",
        brand="ANNAPURNA", commodity="Basmati Rice", category="packaged_food",
        lines=[
            ("Basmati Rice - Premium", "bold"),
            ("Net Wt. 10 kg", "regular"),
            ("Maximum Retail Price \u20b9 1,250.00", "regular"),
            ("(Incl. of all taxes)", "small"),
            ("Month & Year of Packing: 01/2026", "regular"),
            ("Batch No. AN-0126", "regular"),
            ("Packed by Annapurna Agro Ltd.,", "small"),
            ("Karnal, Haryana - 132001", "small"),
            ("Consumer Care: 1800-600-7000", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "10 kg", "mrp": "1,250.00", "manufacturing_date": "01/2026",
               "batch_number": "AN-0126", "country_of_origin": "India"},
        conditions=["perspective", "glare"],
    ))

    packs.append(Package(
        slug="toothpaste-100g-noise-dim",
        brand="DENTAL", commodity="Toothpaste", category="personal_care",
        lines=[
            ("Anticavity Toothpaste", "bold"),
            ("Net Wt. 100 g", "regular"),
            ("M.R.P. \u20b9 95.00", "regular"),
            ("Mfg: 12/2025", "regular"),
            ("Use Before 30 Months", "small"),
            ("B.No. DT1225", "regular"),
            ("Mfd by Dental Care India Pvt Ltd,", "small"),
            ("Guwahati, Assam - 781017", "small"),
            ("Consumer Care: care@dentalcare.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "100 g", "mrp": "95.00", "manufacturing_date": "12/2025",
               "batch_number": "DT1225", "country_of_origin": "India"},
        conditions=["noise", "dim"],
    ))

    packs.append(Package(
        slug="honey-500g-curve-skew",
        brand="APIS", commodity="Natural Honey", category="packaged_food",
        lines=[
            ("Natural Honey", "bold"),
            ("Net Wt. 500 g", "regular"),
            ("MRP \u20b9 275.00 (incl. of all taxes)", "regular"),
            ("Packed On 02/2026", "regular"),
            ("Best Before 18 Months", "small"),
            ("Batch No. AP-0226", "regular"),
            ("Packed by Apis Naturals Pvt Ltd,", "small"),
            ("Roorkee, Uttarakhand - 247667", "small"),
            ("care@apisnaturals.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "500 g", "mrp": "275.00", "manufacturing_date": "02/2026",
               "batch_number": "AP-0226", "country_of_origin": "India"},
        conditions=["curve", "skew"],
    ))

    packs.append(Package(
        slug="coffee-200g-all-conditions",
        brand="ARABICA", commodity="Instant Coffee", category="beverage",
        lines=[
            ("Instant Coffee Powder", "bold"),
            ("Net Wt. 200 g", "regular"),
            ("M.R.P. \u20b9 450.00 (incl. of all taxes)", "regular"),
            ("Month & Year of Manufacture: 01/2026", "regular"),
            ("Best Before 24 Months from Mfg.", "small"),
            ("Batch No. AR-0126", "regular"),
            ("Mfd by Arabica Coffee Works,", "small"),
            ("Chikmagalur, Karnataka - 577101", "small"),
            ("Consumer Care: 1800-700-8000", "small"),
            ("Email: care@arabicaworks.in", "small"),
            ("Country of Origin: India", "small"),
        ],
        truth={"net_quantity": "200 g", "mrp": "450.00", "manufacturing_date": "01/2026",
               "batch_number": "AR-0126", "country_of_origin": "India"},
        conditions=["glare", "curve", "skew", "noise"],
    ))

    return packs


# ── Rendering ────────────────────────────────────────────────────────────────

W, H = 1400, 1800


def render(pack: Package) -> Image.Image:
    """The flat panel, before anything is done to it."""
    image = Image.new("RGB", (W, H), (247, 245, 240))
    draw = ImageDraw.Draw(image)

    bold = ImageFont.truetype(str(FONT_BOLD), 96)
    heading = ImageFont.truetype(str(FONT_BOLD), 54)
    regular = ImageFont.truetype(str(FONT_REGULAR), 46)
    small = ImageFont.truetype(str(FONT_NARROW), 34)

    # A colour band at the top, as nearly every pack has.
    draw.rectangle([0, 0, W, 300], fill=(28, 62, 110))
    draw.text((70, 90), pack.brand, font=bold, fill=(255, 255, 255))

    y = 380
    for text, weight in pack.lines:
        font = heading if weight == "bold" else regular if weight == "regular" else small
        draw.text((70, y), text, font=font, fill=(24, 24, 24))
        y += (78 if weight == "bold" else 64 if weight == "regular" else 48)

    # A barcode block, because every pack has one and it is the noise the
    # extractor has to not mistake for a batch number.
    bx, by = 70, H - 260
    rng = random.Random(pack.slug)
    for i in range(80):
        if rng.random() > 0.45:
            draw.rectangle([bx + i * 7, by, bx + i * 7 + 4, by + 140], fill=(0, 0, 0))
    draw.text((bx, by + 150), "8 901234 567890", font=small, fill=(24, 24, 24))

    return image


# ── Degradations ─────────────────────────────────────────────────────────────

def add_glare(array: np.ndarray, seed: int) -> np.ndarray:
    """
    A blown highlight, not a bright patch.

    The distinction is the whole point: a tube light on laminate does not dim
    the print underneath, it saturates the sensor and the strokes are gone. So
    this drives the centre to full white rather than merely lightening it.
    """
    rng = random.Random(seed)
    h, w = array.shape[:2]
    cx = int(w * rng.uniform(0.35, 0.75))
    cy = int(h * rng.uniform(0.30, 0.65))
    radius = int(min(h, w) * rng.uniform(0.22, 0.34))

    yy, xx = np.ogrid[:h, :w]
    distance = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    mask = np.clip(1.0 - distance / radius, 0, 1) ** 1.4

    out = array.astype(np.float32)
    out = out + mask[..., None] * (255.0 - out) * 0.97
    return np.clip(out, 0, 255).astype(np.uint8)


def add_curve(array: np.ndarray) -> np.ndarray:
    """A cylinder: the panel wrapped round a bottle, compressed at the edges."""
    h, w = array.shape[:2]
    map_x = np.zeros((h, w), np.float32)
    map_y = np.zeros((h, w), np.float32)

    for x in range(w):
        # Map the flat x onto the visible arc of a cylinder, so the middle
        # stretches and the edges crowd — which is what makes edge text
        # unreadable however sharp the photograph is.
        theta = (x / w - 0.5) * math.pi * 0.86
        source = (math.sin(theta) / math.sin(math.pi * 0.43) * 0.5 + 0.5) * w
        map_x[:, x] = source

    for y in range(h):
        map_y[y, :] = y

    return cv2.remap(array, map_x, map_y, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def add_skew(array: np.ndarray, seed: int) -> np.ndarray:
    rng = random.Random(seed + 1)
    angle = rng.uniform(-7.5, 7.5)
    h, w = array.shape[:2]
    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(array, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)


def add_perspective(array: np.ndarray, seed: int) -> np.ndarray:
    rng = random.Random(seed + 2)
    h, w = array.shape[:2]
    shift = rng.uniform(0.06, 0.13)

    source = np.float32([[0, 0], [w, 0], [w, h], [0, h]])
    target = np.float32([
        [w * shift, h * shift * 0.4],
        [w * (1 - shift * 0.3), 0],
        [w, h],
        [w * shift * 0.5, h * (1 - shift * 0.3)],
    ])
    matrix = cv2.getPerspectiveTransform(source, target)
    return cv2.warpPerspective(array, matrix, (w, h), borderMode=cv2.BORDER_REPLICATE)


def add_dim(array: np.ndarray) -> np.ndarray:
    """The back of a shop: less light and less contrast, not just darker."""
    out = array.astype(np.float32)
    out = (out - 128) * 0.55 + 128
    out = out * 0.62
    return np.clip(out, 0, 255).astype(np.uint8)


def add_soft(array: np.ndarray) -> np.ndarray:
    return cv2.GaussianBlur(array, (0, 0), 2.1)


def add_noise(array: np.ndarray, seed: int) -> np.ndarray:
    rng = np.random.default_rng(seed)
    noisy = array.astype(np.float32) + rng.normal(0, 7.5, array.shape)
    return np.clip(noisy, 0, 255).astype(np.uint8)


def degrade(image: Image.Image, conditions: list[str], seed: int) -> Image.Image:
    array = cv2.cvtColor(np.array(image), cv2.COLOR_RGB2BGR)

    # Geometry first, then light, then the sensor — the order a camera does it.
    if "curve" in conditions:
        array = add_curve(array)
    if "perspective" in conditions:
        array = add_perspective(array, seed)
    if "skew" in conditions:
        array = add_skew(array, seed)
    if "dim" in conditions:
        array = add_dim(array)
    if "glare" in conditions:
        array = add_glare(array, seed)
    if "soft" in conditions:
        array = add_soft(array)
    if "noise" in conditions:
        array = add_noise(array, seed)

    return Image.fromarray(cv2.cvtColor(array, cv2.COLOR_BGR2RGB))


def main() -> None:
    if not FONT_REGULAR.exists():
        raise SystemExit(f"No font at {FONT_REGULAR}")

    packages = build_packages()
    OUT.mkdir(parents=True, exist_ok=True)

    for index, pack in enumerate(packages):
        folder = OUT / pack.slug
        folder.mkdir(parents=True, exist_ok=True)

        flat = render(pack)
        photographed = degrade(flat, pack.conditions, seed=index * 17 + 3)

        # Written at the quality a phone camera app actually saves, because
        # JPEG ringing around small text is itself one of the things the
        # recogniser has to survive.
        photographed.save(folder / "back.jpg", quality=82, subsampling=2)

        (folder / "truth.json").write_text(
            json.dumps(
                {
                    "package": f"{pack.brand} {pack.commodity}",
                    "category": pack.category,
                    "conditions": pack.conditions,
                    "declarations": pack.truth,
                    "note": "Synthetic. Ground truth is exact — this text was placed by "
                            "tools/generate_labels.py, not read off a packet.",
                },
                indent=2,
            ),
            encoding="utf-8",
        )

        print(f"  {pack.slug:38} {', '.join(pack.conditions)}")

    print(f"\n{len(packages)} packages written to {OUT}")


if __name__ == "__main__":
    main()
