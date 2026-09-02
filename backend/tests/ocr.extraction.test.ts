import { describe, expect, it } from 'vitest';

import { extractInformation } from '../src/services/extraction';
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

  it('flags a generic name identified by layout rather than by a label', async () => {
    const extraction = extractInformation(await readFixture('compliant'));

    expect(extraction.fields.commodity_name?.method).toBe('HEURISTIC');
    expect(extraction.warnings.join(' ')).toMatch(/generic name was identified by layout/i);
  });
});
