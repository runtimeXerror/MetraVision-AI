import { describe, expect, it } from 'vitest';

import { extractInformation } from '../src/services/extraction';
import { toComplianceRequest } from '../src/services/scan';
import { canonicalUnit, firstAmount, repairDigits, unifyCurrency } from '../src/services/extraction/normalise';
import {
  aggregate,
  FailingOCRProvider,
  MockOCRProvider,
  type AggregateOCRResult,
  type MockFixtureId,
} from '../src/services/ocr';
import { ApiError } from '../src/utils/ApiError';

/**
 * The OCR adapter, the normalisation and the field extraction.
 *
 * Everything here runs without a database, a network or a credential — which is
 * the point of `MockOCRProvider` and the reason the extractor takes an
 * `AggregateOCRResult` rather than reaching for a provider itself.
 */

async function readFixture(fixture: MockFixtureId, images = 1): Promise<AggregateOCRResult> {
  const provider = new MockOCRProvider(fixture);
  const results = [];

  for (let index = 0; index < images; index += 1) {
    results.push(
      await provider.extractText({
        imageId: `img_${index}`,
        buffer: Buffer.from(`image-${index}`),
        mimeType: 'image/png',
      }),
    );
  }

  return aggregate(results, 1);
}

describe('OCR provider adapter', () => {
  it('normalises a provider response into the common OCRResult shape', async () => {
    const result = await new MockOCRProvider('compliant').extractText({
      imageId: 'img_1',
      buffer: Buffer.from('x'),
      mimeType: 'image/png',
    });

    expect(result.provider).toBe('mock');
    expect(result.rawText).toContain('AASHIRVAAD');
    expect(result.regions.length).toBeGreaterThan(5);
    expect(result.imageSize).toEqual({ width: 900, height: 1400 });

    for (const region of result.regions) {
      expect(region.imageId).toBe('img_1');
      expect(region.boundingBox).toHaveLength(4);
    }
  });

  it('reports whether the provider supplied confidence, and never invents one', async () => {
    const withConfidence = await readFixture('compliant');
    expect(withConfidence.confidenceAvailable).toBe(true);

    // The mock's blank fixture returns no regions at all, so there is nothing
    // to be confident about — and the flag says so rather than defaulting true.
    const blank = await readFixture('blank');
    expect(blank.confidenceAvailable).toBe(false);
    expect(blank.rawText).toBe('');
  });

  it('aggregates several images into one result, preserving each image id', async () => {
    const merged = await readFixture('compliant', 3);
    const imageIds = new Set(merged.regions.map((region) => region.imageId));

    expect(imageIds).toEqual(new Set(['img_0', 'img_1', 'img_2']));
    expect(merged.perImage).toHaveLength(3);
  });

  it('surfaces a provider failure as an error rather than an empty read', async () => {
    const provider = new FailingOCRProvider(new ApiError(503, 'OCR_FAILED', 'boom'));

    await expect(
      provider.extractText({ imageId: 'img_1', buffer: Buffer.from('x'), mimeType: 'image/png' }),
    ).rejects.toThrow('boom');
  });
});

describe('normalisation', () => {
  it('unifies every rupee spelling', () => {
    expect(unifyCurrency('Rs. 120')).toBe('₹ 120');
    expect(unifyCurrency('INR 120')).toBe('₹ 120');
    expect(unifyCurrency('₹120')).toBe('₹120');
  });

  it('repairs OCR digit confusions only inside numbers', () => {
    expect(repairDigits('5O g')).toEqual({ text: '50 g', repaired: true });
    expect(repairDigits('₹l99.00')).toEqual({ text: '₹199.00', repaired: true });

    // The guard that matters: this substitution must never touch words.
    expect(repairDigits('Oil of Olay')).toEqual({ text: 'Oil of Olay', repaired: false });
    expect(repairDigits('Bengaluru - 560058')).toEqual({
      text: 'Bengaluru - 560058',
      repaired: false,
    });
    expect(repairDigits('Batch No. HG-2026-O')).toEqual({
      text: 'Batch No. HG-2026-O',
      repaired: false,
    });
  });

  it('reads Indian digit grouping', () => {
    expect(firstAmount('₹2,499.00')).toBe(2499);
    expect(firstAmount('1,24,999')).toBe(124999);
  });

  it('canonicalises the unit spellings found on packages', () => {
    expect(canonicalUnit('gm')).toBe('g');
    expect(canonicalUnit('GMS')).toBe('g');
    expect(canonicalUnit('Ltr')).toBe('l');
    expect(canonicalUnit('N')).toBe('N');
    expect(canonicalUnit('furlong')).toBeNull();
  });
});

describe('field extraction', () => {
  it('extracts the MRP declaration whole, so the rule can inspect its wording', async () => {
    const extraction = extractInformation(await readFixture('compliant'));
    const mrp = extraction.fields.mrp!;

    expect(mrp.status).toBe('FOUND');
    // Not just "315.00": rule 6(1)(e) between 2018 and 2024 required the
    // declaration to say it is the maximum retail price.
    expect(mrp.value).toBe('MRP ₹315.00 (incl. of all taxes)');
    expect(mrp.method).toBe('LABEL_MATCH');
    expect(mrp.evidence[0]?.bbox).toHaveLength(4);
  });

  it('keeps the unit sale price out of the MRP field', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.unit_sale_price?.value).toBe('Unit Sale Price: ₹63.00 per kg');
    expect(extraction.fields.mrp?.value).not.toContain('per kg');
  });

  it('extracts net quantity as a number and a standard unit', async () => {
    const extraction = extractInformation(await readFixture('compliant'));
    const quantity = extraction.fields.net_quantity!;

    expect(quantity.value).toBe('5 kg');
    expect(quantity.unit).toBe('kg');
  });

  it('extracts a count-based net quantity', async () => {
    const extraction = extractInformation(await readFixture('imported_no_origin'));

    expect(extraction.fields.net_quantity?.value).toBe('1 N');
    expect(extraction.fields.net_quantity?.unit).toBe('N');
  });

  it('extracts the manufacturer declaration with its address', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.manufacturer?.value).toContain('ITC Limited');
    expect(extraction.fields.manufacturer?.value).toContain('560058');
  });

  it('treats an importer declaration as satisfying the rule 6(1)(a) field', async () => {
    const extraction = extractInformation(await readFixture('imported_no_origin'));

    expect(extraction.fields.manufacturer?.status).toBe('FOUND');
    expect(extraction.fields.manufacturer?.value).toContain('Tech Retail India');
    // …and records the importer separately, for the report.
    expect(extraction.informational.importer?.status).toBe('FOUND');
  });

  it('extracts consumer care details', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.consumer_care?.value).toContain('care@itc.in');
    expect(extraction.fields.consumer_care?.value).toContain('1800-425-4444');
  });

  it('extracts dates as month and year', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.manufacturing_date?.value).toBe('06/2026');
    // "Best Before: 12 months from packaging - 06/2027" — the date, not the
    // shelf life.
    expect(extraction.fields.best_before?.value).toBe('06/2027');
  });

  it('does not let a best-before line become a manufacturing date', async () => {
    const extraction = extractInformation(await readFixture('missing_declarations'));

    expect(extraction.fields.manufacturing_date?.value).toBe('03/2026');
    expect(extraction.fields.best_before?.value).toBe('09/2026');
  });

  it('extracts country of origin', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.country_of_origin?.value).toBe('India');
  });

  it('maps the vegetarian mark onto the rule set’s permitted values', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.veg_nonveg_mark?.value).toBe('VEGETARIAN');
  });

  it('reports a declaration it could not find as NOT_FOUND, and asserts nothing more', async () => {
    const extraction = extractInformation(await readFixture('missing_declarations'));

    expect(extraction.fields.mrp?.status).toBe('NOT_FOUND');
    expect(extraction.fields.mrp?.value).toBeNull();
    expect(extraction.fields.mrp?.evidence).toEqual([]);
    // Crucially: no confidence, and no claim about absence. Those belong to the
    // rule engine, which weighs them against how much of the package was seen.
    expect(extraction.fields.mrp?.confidence).toBeUndefined();
  });

  it('carries the provider’s confidence through, and discounts a repaired read', async () => {
    const extraction = extractInformation(await readFixture('low_confidence'));

    // The fixture reads "₹l99.00" at 0.41. Repaired to ₹199.00 and reported at
    // a lower confidence than the provider gave, never a higher one.
    expect(extraction.fields.mrp?.value).toBe('M.R.P ₹199.00 (incl. of all taxes)');
    expect(extraction.fields.mrp?.repaired).toBe(true);
    expect(extraction.fields.mrp?.confidence).toBeLessThan(0.41);
  });

  it('never fabricates a confidence when the provider supplied none', () => {
    const extraction = extractInformation({
      provider: 'stub',
      rawText: 'MRP ₹120\nNet Quantity: 500 g',
      regions: [
        { text: 'MRP ₹120', imageId: 'img_1' },
        { text: 'Net Quantity: 500 g', imageId: 'img_1' },
      ],
      perImage: [],
      processingTimeMs: 1,
      confidenceAvailable: false,
      unread: [],
    });

    expect(extraction.fields.mrp?.value).toBe('MRP ₹120');
    expect(extraction.fields.mrp?.confidence).toBeUndefined();
    expect(extraction.fields.net_quantity?.confidence).toBeUndefined();
  });

  it('reports facts that change which rules apply, with their basis', async () => {
    const extraction = extractInformation(await readFixture('imported_no_origin'));
    const imported = extraction.contextSignals.find((signal) => signal.key === 'isImported');

    expect(imported?.value).toBe(true);
    expect(imported?.basis).toMatch(/importer/i);
    expect(imported?.evidence.length).toBeGreaterThan(0);
  });

  it('keeps every line that no field claimed', async () => {
    const extraction = extractInformation(await readFixture('missing_declarations'));

    expect(extraction.unclaimedLines).toContain('Store in a cool dry place');
  });

  it('flags a generic name identified without a printed label', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    // Rule 6(1)(b) is never printed with a label in front of it, so the name
    // is always a heuristic and always warned about — whether it was found by
    // layout, as it once was, or by the commodity vocabulary, as it is now.
    expect(extraction.fields.commodity_name?.method).toBe('HEURISTIC');
    expect(extraction.warnings.join(' ')).toMatch(
      /generic name was identified from the word .+ printed on the package/i,
    );
  });
});

/**
 * ── A TWO-COLUMN DECLARATION BLOCK, PHOTOGRAPHED SIDEWAYS ───────────────────
 *
 * Every case below is taken from one real scan: a NIVEA roll-on whose back
 * panel prints its keys in a left column and their values in a right one, on a
 * cylindrical bottle photographed on its side. The report it produced named a
 * batch number of ":", a manufacturing date of "(P) &", and a brand of
 * "anacur: Beirhi Co." — a misread of the blur where the label curved away.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe('a two-column declaration block', () => {
  /** Upright text: a box per line, laid out as printed. */
  function upright(
    entries: Array<{ text: string; x: number; y: number; w?: number; confidence?: number }>,
  ): AggregateOCRResult {
    const regions = entries.map((entry) => ({
      text: entry.text,
      confidence: entry.confidence ?? 0.99,
      boundingBox: [entry.x, entry.y, entry.x + (entry.w ?? entry.text.length * 14), entry.y + 30] as [
        number,
        number,
        number,
        number,
      ],
      kind: 'LINE' as const,
      imageId: 'img_1',
    }));

    return {
      provider: 'stub',
      rawText: entries.map((entry) => entry.text).join('\n'),
      regions,
      perImage: [
        {
          rawText: entries.map((entry) => entry.text).join('\n'),
          regions,
          provider: 'stub',
          confidenceAvailable: true,
          imageId: 'img_1',
          imageSize: { width: 1200, height: 1600 },
        },
      ],
      processingTimeMs: 1,
      confidenceAvailable: true,
      unread: [],
    };
  }

  /**
   * The same page turned ninety degrees, the way a camera sees a bottle lying
   * on its side: reading runs down the image, and successive printed lines
   * march towards smaller x.
   */
  function sideways(
    entries: Array<{ text: string; x: number; y: number; w?: number; confidence?: number }>,
  ): AggregateOCRResult {
    const flat = upright(entries);
    const turn = (region: (typeof flat.regions)[number]): typeof region => {
      const [x1, y1, x2, y2] = region.boundingBox as [number, number, number, number];
      return { ...region, boundingBox: [2000 - y2, x1, 2000 - y1, x2] as [number, number, number, number] };
    };

    const regions = flat.regions.map(turn);
    return { ...flat, regions, perImage: [{ ...flat.perImage[0]!, regions }] };
  }

  const BLOCK = [
    { text: 'Batch No.:', x: 100, y: 100 },
    { text: '861363777', x: 300, y: 100 },
    { text: 'MFD.(P) &', x: 100, y: 150 },
    { text: '03/26 E03/29', x: 300, y: 150 },
    { text: 'Use Before (E):', x: 100, y: 200 },
    { text: 'Moo 17, Soi Industrial Estate', x: 100, y: 400 },
  ];

  it('reads a value from the column beside its label', () => {
    const result = extractInformation(upright(BLOCK));

    expect(result.informational.batch_number?.value).toBe('861363777');
    expect(result.fields.manufacturing_date?.value).toBe('03/26');
  });

  it('reads the same block when the package was photographed sideways', () => {
    const result = extractInformation(sideways(BLOCK));

    // The geometry is measured in the text's own frame, so turning the camera
    // must not change what the label says.
    expect(result.informational.batch_number?.value).toBe('861363777');
    expect(result.fields.manufacturing_date?.value).toBe('03/26');
  });

  it('never records the rest of the label as the value', () => {
    // The value column is gone — it was legible only on another photograph.
    // The keys remain, and each leaves a tail behind: ":", "(P) &", "(E):".
    const result = extractInformation(
      upright(BLOCK.filter((entry) => entry.x === 100)),
    );

    // Not ":", and not the factory address sitting under the block either.
    expect(result.informational.batch_number?.value ?? null).toBeNull();
    expect(result.fields.manufacturing_date?.value ?? null).toBeNull();
    expect(result.fields.best_before?.value ?? null).toBeNull();
  });

  it('does not name a product from a line it could barely read', () => {
    const result = extractInformation(
      upright([
        { text: 'anacur: Beirhi Co.', x: 100, y: 60, confidence: 0.53 },
        { text: 'NIVEA CARE Executive at above address or.', x: 100, y: 100 },
        { text: 'COS052/13. For Query/Feedback: Contact', x: 100, y: 140 },
        { text: 'Net Content: 50 ml', x: 100, y: 180 },
      ]),
    );

    // The back of a package carries no product name. Finding none is right.
    expect(result.informational.brand?.value ?? null).toBeNull();
    expect(result.informational.product_name?.value ?? null).toBeNull();
    // …and the declaration that *is* printed there is still read.
    expect(result.fields.net_quantity?.value).toBe('50 ml');
  });

  it('follows an address down the page, not down the recogniser’s output order', () => {
    // The recogniser emitted this block bottom-up, as it does for sideways
    // text. Walking by index continued the address into the price beside it.
    const result = extractInformation(
      sideways([
        { text: 'Imported & Marketed by:', x: 100, y: 100 },
        { text: 'NIVEA India Pvt. Ltd., 4th Floor,', x: 100, y: 140 },
        { text: 'AGH, Phoenix Market City, Kurla (W),', x: 100, y: 180 },
        { text: 'Mumbai, Maharashtra - 400070.', x: 100, y: 220 },
        { text: '249, 4.98/ml', x: 600, y: 100 },
      ]),
    );

    const manufacturer = result.fields.manufacturer?.value ?? '';
    expect(manufacturer).toContain('NIVEA India Pvt. Ltd.');
    expect(manufacturer).toContain('Mumbai, Maharashtra');
    expect(manufacturer).not.toContain('4.98/ml');
  });
});

/**
 * ── WHEN THE PACKAGE SAYS WHERE THE DECLARATION IS ──────────────────────────
 *
 * A tube inside a carton prints a pointer instead of repeating the carton's
 * declarations. Read as declarations, those sentences cost three false
 * violations against a real Minimalist moisturizer whose label had told the
 * inspector exactly where to look.
 * ────────────────────────────────────────────────────────────────────────────
 */
describe('declarations printed elsewhere on the package', () => {
  function label(lines: string[]): AggregateOCRResult {
    const regions = lines.map((text, index) => ({
      text,
      confidence: 0.99,
      boundingBox: [100, 100 + index * 40, 100 + text.length * 12, 130 + index * 40] as [
        number,
        number,
        number,
        number,
      ],
      kind: 'LINE' as const,
      imageId: 'img_1',
    }));

    return {
      provider: 'stub',
      rawText: lines.join('\n'),
      regions,
      perImage: [
        {
          rawText: lines.join('\n'),
          regions,
          provider: 'stub',
          confidenceAvailable: true,
          imageId: 'img_1',
          imageSize: { width: 1200, height: 1600 },
        },
      ],
      processingTimeMs: 1,
      confidenceAvailable: true,
      unread: [],
    };
  }

  const TUBE = [
    'Product Information:',
    'For the manufacturing date, batch no. & Use before date-',
    'refer to the crimp',
    'For MRP, refer to the carton',
    'Net weight: 50 g / 1.76 oz.',
  ];

  it('never reads a pointer sentence as the declaration it points at', () => {
    const result = extractInformation(label(TUBE));

    // Was "& Use before date-", "date-" and nothing respectively.
    expect(result.informational.batch_number?.value ?? null).toBeNull();
    expect(result.fields.best_before?.value ?? null).toBeNull();
    expect(result.fields.manufacturing_date?.value ?? null).toBeNull();

    // …and the declaration that really is on the tube still reads.
    expect(result.fields.net_quantity?.value).toBe('50 g');
  });

  it('names the declarations the package says are elsewhere', () => {
    const result = extractInformation(label(TUBE));

    // The crimp sentence wraps across two lines and only the second carries
    // the pointer, so neither line means anything on its own.
    expect([...result.declaredElsewhere].sort()).toEqual([
      'batch_number',
      'best_before',
      'manufacturing_date',
      'mrp',
    ]);
    expect(result.warnings.some((warning) => warning.includes('printed elsewhere'))).toBe(true);
  });

  it('tells the engine those declarations are not absent', () => {
    const extraction = extractInformation(label(TUBE));
    const ocr = label(TUBE);

    const { request } = toComplianceRequest({
      inspectionId: 'INS-TEST',
      inspectionDate: '2026-09-04',
      productContext: {},
      extraction,
      ocr,
      imageIds: ['img_1'],
    });

    // Zero absence confidence is what stops a violation being recorded on a
    // declaration the label has positively located somewhere else.
    expect(request.fields.mrp?.absenceConfidence).toBe(0);
    expect(request.fields.manufacturing_date?.absenceConfidence).toBe(0);

    // A declaration nothing said anything about keeps the old behaviour: the
    // engine falls back to capture completeness rather than being told.
    expect(request.fields.country_of_origin?.absenceConfidence).toBeUndefined();
  });
});
