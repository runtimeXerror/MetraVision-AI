import { createHash } from 'node:crypto';

import { env } from '../../config/env';

import type { OCRImageInput, OCRProvider, OCRRegion, OCRResult } from './OCRProvider';

/**
 * ── THE MOCK PROVIDER ───────────────────────────────────────────────────────
 *
 * A deterministic OCR provider, so the entire pipeline — extraction, the rule
 * engine, issue generation, the report — is testable in CI on a machine with no
 * API key and no network.
 *
 * The point is not to fake OCR. It is that the *rest* of the system is what
 * this phase delivers, and holding the OCR output fixed is the only way to
 * assert anything about it. A test that says "a package with no price produces
 * a price finding" must not fail because a cloud model read the label slightly
 * differently this morning.
 *
 * The fixtures are written as OCR output, not as clean data: line order follows
 * the label, labels and values sit on the same line the way they are printed,
 * and the low-confidence fixture carries the character confusions a real
 * engine makes on a smudged package (`5O g`, `₹l99`). If the extractor cannot
 * cope with those here, it will not cope with them in the field.
 *
 * Selection order: an explicit `fixture` on the scan request, then
 * `OCR_MOCK_FIXTURE`, then a hash of the image bytes — so the same photograph
 * always yields the same fixture, and a demo is reproducible.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const MOCK_FIXTURE_IDS = [
  'compliant',
  'missing_declarations',
  'imported_no_origin',
  'low_confidence',
  'blank',
] as const;
export type MockFixtureId = (typeof MOCK_FIXTURE_IDS)[number];

/** The frame the fixture boxes are drawn in. A portrait label photograph. */
const SPACE = { width: 900, height: 1400 } as const;

interface FixtureLine {
  text: string;
  /** Omitted where the fixture is modelling a provider that gave no confidence. */
  confidence?: number;
  box: [number, number, number, number];
}

interface Fixture {
  id: MockFixtureId;
  description: string;
  lines: FixtureLine[];
}

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const COMPLIANT: Fixture = {
  id: 'compliant',
  description: 'A fully declared domestic packaged food label.',
  lines: [
    { text: 'AASHIRVAAD', confidence: 0.99, box: [70, 90, 470, 168] },
    { text: 'Select Sharbati Atta', confidence: 0.98, box: [70, 176, 560, 236] },
    { text: 'Whole Wheat Atta', confidence: 0.97, box: [70, 268, 470, 320] },
    { text: 'Net Quantity: 5 kg', confidence: 0.98, box: [70, 344, 430, 400] },
    { text: 'MRP ₹315.00 (incl. of all taxes)', confidence: 0.96, box: [70, 420, 620, 480] },
    { text: 'Unit Sale Price: ₹63.00 per kg', confidence: 0.94, box: [70, 500, 600, 556] },
    {
      text: 'Manufactured by: ITC Limited, Foods Division, 18 Industrial Area, Bengaluru - 560058, Karnataka',
      confidence: 0.95,
      box: [70, 584, 830, 700] },
    { text: 'Mfg. Date: 06/2026', confidence: 0.95, box: [70, 724, 400, 780] },
    { text: 'Best Before: 12 months from packaging - 06/2027', confidence: 0.93, box: [70, 800, 760, 856] },
    {
      text: 'Customer Care: care@itc.in, Toll Free 1800-425-4444',
      confidence: 0.92,
      box: [70, 880, 790, 940] },
    { text: 'FSSAI Lic. No. 10012021000123', confidence: 0.93, box: [70, 964, 540, 1020] },
    { text: 'Country of Origin: India', confidence: 0.96, box: [70, 1044, 460, 1100] },
    { text: 'Vegetarian', confidence: 0.97, box: [700, 90, 850, 146] },
    { text: 'Ingredients: Whole wheat (100%)', confidence: 0.91, box: [70, 1124, 620, 1180] },
  ],
};

const MISSING_DECLARATIONS: Fixture = {
  id: 'missing_declarations',
  description:
    'A domestic snack package with no retail sale price and no consumer care declaration.',
  lines: [
    { text: 'CRISPY BITE', confidence: 0.98, box: [80, 100, 480, 180] },
    { text: 'Mixture Namkeen', confidence: 0.96, box: [80, 192, 450, 252] },
    { text: 'Net Wt. 200 g', confidence: 0.97, box: [80, 288, 380, 348] },
    {
      text: 'Manufactured by: Shree Snacks Pvt Ltd, Plot 22, MIDC, Indore - 452010, Madhya Pradesh',
      confidence: 0.93,
      box: [80, 380, 820, 496] },
    { text: 'Mfg: 03/2026', confidence: 0.94, box: [80, 524, 330, 580] },
    { text: 'Best Before: 09/2026', confidence: 0.92, box: [80, 604, 460, 660] },
    { text: 'Vegetarian', confidence: 0.96, box: [700, 100, 850, 156] },
    { text: 'Store in a cool dry place', confidence: 0.9, box: [80, 684, 520, 740] },
    // No MRP line. No consumer care line. Both absent from the package itself.
  ],
};

const IMPORTED_NO_ORIGIN: Fixture = {
  id: 'imported_no_origin',
  description: 'An imported electronics carton with no country-of-origin declaration.',
  lines: [
    { text: 'SoundCore', confidence: 0.98, box: [64, 96, 420, 170] },
    { text: 'Wireless Earbuds', confidence: 0.97, box: [64, 182, 460, 240] },
    { text: 'Net Quantity: 1 N', confidence: 0.95, box: [64, 276, 400, 332] },
    { text: 'MRP ₹2,499.00 (inclusive of all taxes)', confidence: 0.96, box: [64, 360, 700, 420] },
    {
      text: 'Imported & Marketed by: Tech Retail India Pvt Ltd, Sector 44, Gurugram - 122003, Haryana',
      confidence: 0.92,
      box: [64, 452, 840, 568] },
    { text: 'Mfg. Date: 05/2026', confidence: 0.93, box: [64, 596, 390, 652] },
    {
      text: 'Customer Care: support.in@anker.com, Ph. 1800-000-1234',
      confidence: 0.91,
      box: [64, 680, 810, 740] },
    { text: 'Dimensions: 6.2 x 4.8 x 2.7 cm', confidence: 0.9, box: [64, 768, 560, 824] },
    // No country of origin, which rule 6(1)(b) requires of an imported package.
  ],
};

const LOW_CONFIDENCE: Fixture = {
  id: 'low_confidence',
  description:
    'A smudged cosmetic label — every declaration present, several read too poorly to act on.',
  lines: [
    { text: 'Herbal Glow', confidence: 0.86, box: [88, 112, 420, 184] },
    { text: 'Face Cream', confidence: 0.81, box: [88, 196, 380, 252] },
    // The classic OCR confusions: a capital O for a zero, a lowercase l for a 1.
    { text: 'Net Quantity: 5O g', confidence: 0.44, box: [88, 288, 400, 344] },
    { text: 'M.R.P ₹l99.00 (incl. of all taxes)', confidence: 0.41, box: [88, 372, 640, 432] },
    {
      text: 'Manufactured by: Herbal Glow Cosmetics, Bahadrabad, Haridwar - 249402, Uttarakhand',
      confidence: 0.72,
      box: [88, 464, 830, 580] },
    { text: 'Mfg: 01/2026', confidence: 0.58, box: [88, 608, 330, 664] },
    { text: 'Customer Care: support@herbalglow.in', confidence: 0.76, box: [88, 692, 660, 748] },
    { text: 'Batch No. HG-2026-O', confidence: 0.4, box: [88, 776, 430, 832] },
    { text: 'Country of Origin: India', confidence: 0.79, box: [88, 860, 470, 916] },
  ],
};

/** A photograph that carried no legible text at all. */
const BLANK: Fixture = {
  id: 'blank',
  description: 'A photograph in which nothing readable was found.',
  lines: [],
};

const FIXTURES: Record<MockFixtureId, Fixture> = {
  compliant: COMPLIANT,
  missing_declarations: MISSING_DECLARATIONS,
  imported_no_origin: IMPORTED_NO_ORIGIN,
  low_confidence: LOW_CONFIDENCE,
  blank: BLANK,
};

export function mockFixtures(): Array<{ id: MockFixtureId; description: string; lineCount: number }> {
  return MOCK_FIXTURE_IDS.map((id) => ({
    id,
    description: FIXTURES[id].description,
    lineCount: FIXTURES[id].lines.length,
  }));
}

/** Content-addressed pick, so the same photograph always reads the same way. */
function fixtureFor(buffer: Buffer): Fixture {
  const digest = createHash('sha256').update(buffer).digest();
  const rotating: MockFixtureId[] = ['compliant', 'missing_declarations', 'imported_no_origin', 'low_confidence'];
  const index = (digest[0] ?? 0) % rotating.length;
  return FIXTURES[rotating[index]!];
}

/* ── The provider ─────────────────────────────────────────────────────────── */

export class MockOCRProvider implements OCRProvider {
  readonly name = 'mock';
  readonly version = 'mock-ocr/1.0.0';

  constructor(private readonly forced?: MockFixtureId) {}

  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string | null {
    return null;
  }

  async extractText(image: OCRImageInput): Promise<OCRResult> {
    const startedAt = Date.now();

    const configured = env.OCR_MOCK_FIXTURE as MockFixtureId | '';
    const fixture =
      (this.forced ? FIXTURES[this.forced] : undefined) ??
      (configured && MOCK_FIXTURE_IDS.includes(configured) ? FIXTURES[configured] : undefined) ??
      fixtureFor(image.buffer);

    // A visible pause so the mobile app's processing states are not a flicker
    // during a demo. Never under test, where it is pure wall-clock cost — a few
    // dozen fixture reads at 600 ms each is half a minute of a suite doing
    // nothing.
    if (!env.isTest && env.MOCK_OCR_DELAY_MS > 0) {
      await new Promise((resolve) => setTimeout(resolve, env.MOCK_OCR_DELAY_MS));
    }

    const regions: OCRRegion[] = fixture.lines.map((line) => ({
      text: line.text,
      confidence: line.confidence,
      boundingBox: line.box,
      kind: 'LINE',
      imageId: image.imageId,
    }));

    return {
      rawText: fixture.lines.map((line) => line.text).join('\n'),
      regions,
      provider: this.name,
      providerVersion: `${this.version}#${fixture.id}`,
      processingTimeMs: Date.now() - startedAt,
      imageSize: { ...SPACE },
      confidenceAvailable: regions.some((region) => typeof region.confidence === 'number'),
      imageId: image.imageId,
    };
  }
}

/**
 * A provider that always fails, for exercising the OCR-outage path.
 *
 * §31: a failed read must never be handed to the rule engine as an empty
 * package. This is how that is asserted rather than assumed.
 */
export class FailingOCRProvider implements OCRProvider {
  readonly name = 'failing';
  readonly version = 'failing/1.0.0';

  constructor(private readonly error: Error) {}

  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string | null {
    return null;
  }

  async extractText(_image: OCRImageInput): Promise<OCRResult> {
    throw this.error;
  }
}
