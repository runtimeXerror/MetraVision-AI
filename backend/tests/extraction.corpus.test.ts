import { describe, expect, it } from 'vitest';

import { extractInformation } from '../src/services/extraction';
import type { AggregateOCRResult, OCRRegion } from '../src/services/ocr';

/**
 * ── THE LABEL CORPUS ────────────────────────────────────────────────────────
 *
 * How the extractor copes with the way declarations are *actually printed*,
 * across commodity types, rather than with one packet that happened to be
 * photographed.
 *
 * The point is breadth. India's packaged commodities run from a 200g namkeen
 * pouch to a 1.5L beverage to a 30-tablet strip to a pair of shoes, and every
 * category has its own conventions for the same legal declaration:
 *
 *      Net Qty: 200g          Net Wt. 1 kg          Contents: 500ml
 *      MRP ₹315.00            M.R.P. Rs. 60/-       ₹99 (incl. of all taxes)
 *      Mfg. Date: 06/2026     MFD JUN 2026          Packed on 06/26
 *
 * A rule-based extractor is only as good as the forms it knows, so the forms
 * are enumerated here and failures are visible rather than discovered on a
 * demo. Every case below is a real printing convention, not an invention.
 *
 * These are text fixtures, not images: OCR is exercised separately in
 * `ocr-service/tests`. What is under test here is the step *after* reading —
 * turning a line of label text into a named declaration.
 *
 * ── Why this file exists at all ────────────────────────────────────────────
 *
 * A single-character bug in digit repair silently ate the unit in `200g`,
 * turning it into `2009`. Every packet printing its net quantity closed up —
 * which is most of them — lost the declaration, and the extractor then claimed
 * a number from the nutrition table instead. It survived because the fixtures
 * all wrote `500 g` with a space. Breadth is the test that would have caught
 * it, so breadth is what this file adds.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Builds an OCR result from label lines, laid out as a single column. */
function label(lines: string[]): AggregateOCRResult {
  const regions: OCRRegion[] = lines.map((text, index) => ({
    text,
    confidence: 0.95,
    boundingBox: [60, 100 + index * 70, 60 + text.length * 18, 150 + index * 70],
    kind: 'LINE' as const,
    imageId: 'img_1',
  }));

  return {
    provider: 'paddleocr',
    rawText: lines.join('\n'),
    regions,
    perImage: [
      {
        rawText: lines.join('\n'),
        regions,
        provider: 'paddleocr',
        confidenceAvailable: true,
        imageId: 'img_1',
        imageSize: { width: 900, height: 1400 },
      },
    ],
    processingTimeMs: 1,
    confidenceAvailable: true,
  };
}

function valueOf(lines: string[], field: string): string | null {
  const result = extractInformation(label(lines));
  return result.fields[field]?.value ?? result.informational[field]?.value ?? null;
}

/* ── Net quantity ─────────────────────────────────────────────────────────── */

describe('net quantity, as printed across commodity types', () => {
  const cases: Array<[label: string, lines: string[], expected: string]> = [
    ['closed-up grams (namkeen pouch)', ['Net Qty: 200g'], '200 g'],
    ['spaced grams', ['NET QUANTITY: 500 g'], '500 g'],
    ['net weight, no colon', ['Net Wt. 1kg'], '1 kg'],
    ['gm spelling (spice pack)', ['Net Weight: 250 gm'], '250 g'],
    ['millilitres closed up (shampoo)', ['Net Vol. 500ml'], '500 ml'],
    ['capital ML (beverage)', ['Net Content: 250ML'], '250 ml'],
    ['decimal litres', ['Net Qty. 1.5 L'], '1.5 l'],
    ['contents wording', ['Contents: 100 g'], '100 g'],
    ['count, not weight (tablets)', ['Net Quantity: 30 Tablets'], '30 Tablets'],
    ['pieces (biscuits)', ['Net Qty 12 pcs'], '12 pcs'],
    ['pairs (footwear)', ['Net Quantity: 1 Pair'], '1 pair'],
    ['milligrams (pharma)', ['Net Qty: 500mg'], '500 mg'],
  ];

  it.each(cases)('reads %s', (_name, lines, expected) => {
    expect(valueOf(lines, 'net_quantity')).toBe(expected);
  });

  it('never takes a nutrition-table figure as the declaration', () => {
    // The failure that started this file: the label and its value are separate
    // detections, and the panel above carries plausible "<number> g" strings.
    const value = valueOf(
      [
        'NUTRITIONAL INFORMATION',
        'Per 100g',
        'Protein',
        '22.2 g',
        'Total Fat',
        '17.3 g',
        'NET QUANTITY: 200g',
      ],
      'net_quantity',
    );

    expect(value).toBe('200 g');
  });
});

/* ── MRP ──────────────────────────────────────────────────────────────────── */

describe('maximum retail price, as printed', () => {
  const cases: Array<[label: string, lines: string[], contains: string]> = [
    ['rupee symbol with paise', ['MRP ₹315.00 (incl. of all taxes)'], '315.00'],
    ['M.R.P. with stops and Rs.', ['M.R.P. Rs. 60/-'], '60'],
    ['colon and inclusive wording', ['MRP: Rs.99 (incl. of all taxes)'], '99'],
    ['thousands separator', ['Maximum Retail Price ₹1,250.00'], '1,250.00'],
    ['spaced Rs with decimals', ['M.R.P Rs 45.50 Incl. of all taxes'], '45.50'],
    ['retail sale price wording', ['Retail Sale Price: ₹250'], '250'],
  ];

  it.each(cases)('reads %s', (_name, lines, contains) => {
    const value = valueOf(lines, 'mrp');
    expect(value, `expected MRP containing ${contains}`).toContain(contains);
  });

  it('keeps the whole declaration, not just the amount', () => {
    // Rule 6(1)(e) as it stood 2018–2024 tested the wording, so the phrase
    // "incl. of all taxes" has to survive into the rule engine.
    expect(valueOf(['MRP ₹315.00 (incl. of all taxes)'], 'mrp')).toContain('incl');
  });

  it('does not mistake a per-unit price for the MRP', () => {
    const value = valueOf(['Unit Sale Price: ₹63.00 per kg', 'MRP ₹315.00'], 'mrp');
    expect(value).toContain('315.00');
  });
});

/* ── Dates ────────────────────────────────────────────────────────────────── */

describe('manufacture and packing dates, as printed', () => {
  const cases: Array<[label: string, lines: string[]]> = [
    ['slashed month and year', ['Mfg. Date: 06/2026']],
    ['two-digit year', ['MFD: 06/26']],
    ['month name', ['Packed on: JUN 2026']],
    ['hyphenated', ['Date of Manufacture: 06-2026']],
    ['packed in wording', ['Packed in 06/2026']],
    ['manufactured on', ['Manufactured on 06/2026']],
  ];

  it.each(cases)('reads %s', (_name, lines) => {
    const value = valueOf(lines, 'manufacturing_date');
    expect(value, 'expected a date to be extracted').toBeTruthy();
    expect(value).toMatch(/06|JUN/i);
  });
});

/* ── Manufacturer, packer, importer ───────────────────────────────────────── */

describe('rule 6(1)(a) name and address, as printed', () => {
  it('reads a manufacturer with a multi-line address', () => {
    const value = valueOf(
      [
        'Manufactured by: ABC Foods Pvt Ltd,',
        'Plot 5, MIDC Industrial Area,',
        'Pune - 411001, Maharashtra',
      ],
      'manufacturer',
    );

    expect(value).toContain('ABC Foods');
    // The address is the declaration, not just the company name — an address
    // truncated at the first line fails rule 6(1)(a) for the wrong reason.
    expect(value).toContain('411001');
  });

  it('reads a marketed-by declaration', () => {
    expect(valueOf(['Marketed by: XYZ Consumer Ltd, Mumbai - 400001'], 'manufacturer')).toContain(
      'XYZ Consumer',
    );
  });

  it('reads a packed-by declaration', () => {
    expect(valueOf(['Packed by: Sunrise Packers, Nashik - 422001'], 'manufacturer')).toContain(
      'Sunrise Packers',
    );
  });

  it('records an importer separately for an imported package', () => {
    expect(valueOf(['Imported by: Global Traders Pvt Ltd, Delhi - 110020'], 'importer')).toContain(
      'Global Traders',
    );
  });
});

/* ── Consumer care and origin ─────────────────────────────────────────────── */

describe('consumer care and country of origin, as printed', () => {
  const care: Array<[label: string, lines: string[]]> = [
    ['email form', ['Customer Care: care@example.in']],
    ['toll-free number', ['Consumer Complaints: 1800-123-4567']],
    ['combined', ['For queries contact: consumer.care@abc.in, 1800-425-4444']],
  ];

  it.each(care)('reads consumer care in %s', (_name, lines) => {
    expect(valueOf(lines, 'consumer_care')).toBeTruthy();
  });

  it('reads an explicit country of origin', () => {
    expect(valueOf(['Country of Origin: India'], 'country_of_origin')).toContain('India');
  });

  it('reads a "Made in" declaration', () => {
    expect(valueOf(['Made in India'], 'country_of_origin')).toContain('India');
  });
});

/* ── Bilingual and Hindi-only declarations ────────────────────────────────── */

describe('Devanagari declarations', () => {
  /**
   * These four all returned nothing before, and not because the wording was
   * unusual: every Hindi label pattern in the table was written with `\b`, and
   * JavaScript's `\b` is ASCII-only, so none of them could ever match. A
   * package declaring its net quantity solely in Hindi had that declaration
   * reported missing — an absence that was really a blind spot in the reader.
   */
  it('reads a Hindi net quantity and canonicalises the unit', () => {
    // "शुद्ध मात्रा" = net quantity, "ग्राम" = gram.
    expect(valueOf(['शुद्ध मात्रा 200 ग्राम'], 'net_quantity')).toBe('200 g');
  });

  it('reads a Hindi net weight', () => {
    expect(valueOf(['शुद्ध वजन 500 ग्राम'], 'net_quantity')).toBe('500 g');
  });

  it('reads a Hindi MRP', () => {
    expect(valueOf(['अधिकतम खुदरा मूल्य ₹315.00'], 'mrp')).toContain('315.00');
  });

  it('reads a Hindi manufacturer declaration', () => {
    expect(valueOf(['निर्माता: ABC Foods Pvt Ltd, Pune - 411001'], 'manufacturer')).toContain(
      'ABC Foods',
    );
  });

  it('reads a bilingual label, preferring neither script', () => {
    const result = extractInformation(
      label(['MRP ₹315.00 (incl. of all taxes)', 'शुद्ध मात्रा 5 किलोग्राम']),
    );

    expect(result.fields.mrp?.value).toContain('315.00');
    expect(result.fields.net_quantity?.value).toBe('5 kg');
  });
});

/* ── OCR noise ────────────────────────────────────────────────────────────── */

describe('declarations surviving recogniser confusions', () => {
  /**
   * Every case here was observed on a real photographed packet. A recogniser
   * confusion that hides a declaration is worse than one that garbles it: a
   * garbled value goes to review, a hidden one is reported as missing and
   * becomes a violation against a trader who complied.
   */
  it('reads a quantity through a Q-for-O confusion', () => {
    expect(valueOf(['NET OUANTITY: 200g'], 'net_quantity')).toBe('200 g');
  });

  it('reads a price through an s-for-5 confusion in "Rs."', () => {
    // Seen twice on the first real packet this system read: "Rs.60.00" came
    // back as "R5.60.00", the line stopped looking like a price at all, and
    // the MRP check had nothing to test.
    expect(valueOf(['MRP R5.60.00'], 'mrp')).toContain('60.00');
  });

  it('repairs digits inside a quantity without eating the unit', () => {
    expect(valueOf(['Net Qty: 2O0g'], 'net_quantity')).toBe('200 g');
  });

  it('leaves ordinary words alone', () => {
    // The guard that keeps digit repair from turning "Oil" into "0i1".
    expect(valueOf(['Sunflower Oil', 'Net Qty: 1 L'], 'net_quantity')).toBe('1 l');
  });
});

/* ── Whole labels, by category ────────────────────────────────────────────── */

describe('complete labels across commodity categories', () => {
  /** Every mandatory declaration a category's label carries, read in one pass. */
  function coverage(lines: string[], expected: string[]): string[] {
    const result = extractInformation(label(lines));
    return expected.filter((field) => {
      const record = result.fields[field] ?? result.informational[field];
      return !record || record.status !== 'FOUND';
    });
  }

  it('reads a packaged food label', () => {
    const missing = coverage(
      [
        'AASHIRVAAD Select Atta',
        'Net Qty: 5kg',
        'MRP ₹315.00 (incl. of all taxes)',
        'Manufactured by: ITC Limited, Bengaluru - 560058',
        'Mfg. Date: 06/2026',
        'Customer Care: care@itc.in',
        'Country of Origin: India',
      ],
      ['net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care', 'country_of_origin'],
    );

    expect(missing).toEqual([]);
  });

  it('reads a beverage label', () => {
    const missing = coverage(
      [
        'REAL Mixed Fruit Juice',
        'Net Vol. 1L',
        'M.R.P. Rs. 120/-',
        'Packed by: Dabur India Ltd, Ghaziabad - 201010',
        'Packed on: 05/2026',
        'Consumer Care: 1800-103-1644',
      ],
      ['net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care'],
    );

    expect(missing).toEqual([]);
  });

  it('reads a personal-care label', () => {
    const missing = coverage(
      [
        'Clinic Plus Shampoo',
        'Net Content: 340ml',
        'MRP ₹199 (incl. of all taxes)',
        'Manufactured by: Hindustan Unilever Ltd, Mumbai - 400099',
        'Mfg. Date: 04/2026',
        'Customer Care: care@hul.co.in',
      ],
      ['net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care'],
    );

    expect(missing).toEqual([]);
  });

  it('reads a pharmaceutical strip', () => {
    const missing = coverage(
      [
        'Paracetamol Tablets IP 500mg',
        'Net Qty: 15 Tablets',
        'M.R.P. Rs. 30.50',
        'Manufactured by: Cipla Ltd, Goa - 403722',
        'Mfg. Date: 03/2026',
      ],
      ['net_quantity', 'mrp', 'manufacturer', 'manufacturing_date'],
    );

    expect(missing).toEqual([]);
  });

  it('reads a household cleaning label', () => {
    const missing = coverage(
      [
        'Surf Excel Easy Wash',
        'Net Wt. 1kg',
        'MRP ₹110 (incl. of all taxes)',
        'Marketed by: Hindustan Unilever Ltd, Mumbai - 400099',
        'Packed on 02/2026',
        'Customer Care: 1800-227-575',
      ],
      ['net_quantity', 'mrp', 'manufacturer', 'manufacturing_date', 'consumer_care'],
    );

    expect(missing).toEqual([]);
  });

  it('reads an imported electronics label', () => {
    const missing = coverage(
      [
        'Wireless Mouse Model M220',
        'Net Quantity: 1 N',
        'MRP ₹1,295.00 (incl. of all taxes)',
        'Imported by: Logitech India Pvt Ltd, Bengaluru - 560001',
        'Country of Origin: China',
        'Mfg. Date: 01/2026',
      ],
      ['net_quantity', 'mrp', 'importer', 'country_of_origin', 'manufacturing_date'],
    );

    expect(missing).toEqual([]);
  });
});
