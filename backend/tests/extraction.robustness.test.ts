import { describe, expect, it } from 'vitest';

import { extractInformation } from '../src/services/extraction';
import type { AggregateOCRResult } from '../src/services/ocr';

/**
 * ── WHAT THE CAMERA ACTUALLY HANDS THE EXTRACTOR ────────────────────────────
 *
 * The corpus scores whole photographs and there is one of them, so it says
 * nothing about the case this suite exists for: a reading that arrived
 * *damaged*.
 *
 * PaddleOCR on a flat, matte, well-lit English label is close to perfect — the
 * corpus package proves that much. A packaged commodity in a shop is not that.
 * It is a foil pouch under a tube light, a curved PET bottle, a crimped tube, a
 * carton with the MRP sticker half over the printed one, and text set in six
 * point. What comes back is recognisable and wrong in specific, repeatable
 * ways, and every one of the readings below is a shape seen on real Indian
 * packaging:
 *
 *   · the rupee sign, which almost nothing reads reliably — it returns as
 *     `2`, `7`, `R`, `T`, `$` or simply vanishes;
 *   · `O` for `0` and `l` for `1`, which turns `500 g` into `5OO g` and
 *     `₹199.00` into `₹l99.00`;
 *   · two declarations merged onto one line, because the gap between them was
 *     narrower than the detector's word spacing;
 *   · a label and its value split across two lines, or sitting in the next
 *     column;
 *   · barcode digits, batch codes and stray single characters arriving as
 *     lines of their own — the corpus reading has `M`, `:`, `e` and
 *     `1060600942` in it, and those are the *good* conditions.
 *
 * ── What each test is for ───────────────────────────────────────────────────
 *
 * Two failures are possible and they are not equally bad.
 *
 *   · **A miss** — the declaration is on the package and the extractor did not
 *     find it. Costly, because the rule engine then has to decide whether an
 *     absence is a violation, and on a well-photographed package it will say
 *     it is.
 *   · **A wrong value** — the extractor returned something, and it is not what
 *     the package says. Far worse: it is a figure that reaches a report, and a
 *     barcode recorded as a batch number or a net weight read as an MRP is a
 *     finding nobody can defend.
 *
 * So a test that cannot yet pass asserts the *absence* of a wrong answer as
 * well as the presence of a right one. Extracting nothing is a poor outcome;
 * extracting `1060600942` as the MRP is a defect.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * A label, as the OCR stage would hand it over.
 *
 * Lines are laid out one under another at a plausible size, because the
 * extractor reads geometry as well as text — it pairs a label with the value
 * to its right or below it, and a helper that stacked everything at the same
 * coordinate would test a code path no photograph produces.
 */
function label(lines: string[], options: { confidence?: number } = {}): AggregateOCRResult {
  const confidence = options.confidence ?? 0.96;

  const regions = lines.map((text, index) => ({
    text,
    confidence,
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

/**
 * The value the extractor settled on, or undefined where it found nothing.
 *
 * Both buckets, because the split between them is about what the *rule engine*
 * is fed, not about what was read: `batch_number` and `ingredients` carry
 * `engineField: false` and land in `informational`, and they are still
 * declarations printed on the package and still reach the report.
 */
function valueOf(ocr: AggregateOCRResult, field: string): string | undefined {
  const extraction = extractInformation(ocr);
  const record = extraction.fields[field] ?? extraction.informational[field];
  return record?.value ?? undefined;
}

/**
 * The noise every real reading carries.
 *
 * Prepended to several cases below so a test that passes on five clean lines
 * does not pass by accident when the same five arrive with a barcode and a
 * stray colon around them.
 */
const NOISE = ['M', '8901234567890', ':', 'e', '1060600942', 'HideNothing.'];

/* ── MRP — rule 6(1)(e) ───────────────────────────────────────────────────── */

describe('maximum retail price, as it is actually printed', () => {
  const CASES: Array<{ what: string; lines: string[]; amount: string }> = [
    {
      what: 'the rupee sign read as a 7',
      lines: ['MRP: 7 199.00', '(Incl. of all taxes)'],
      amount: '199.00',
    },
    {
      what: 'the rupee sign read as a 2',
      lines: ['M.R.P. 2 45.00 (incl. of all taxes)'],
      amount: '45.00',
    },
    {
      what: 'the rupee sign read as an R',
      lines: ['MRP R 250.00'],
      amount: '250.00',
    },
    {
      what: 'the rupee sign missing entirely',
      lines: ['Maximum Retail Price 120.00 (incl. of all taxes)'],
      amount: '120.00',
    },
    { what: 'the older Rs. form', lines: ['M.R.P. Rs. 85.00'], amount: '85.00' },
    { what: 'Rs with no stop and a slash', lines: ['MRP Rs 60/-'], amount: '60' },
    {
      what: 'a one read as a lowercase L',
      lines: ['MRP ₹ l99.00 (incl. of all taxes)'],
      amount: '199.00',
    },
    {
      what: 'the label and the amount on separate lines',
      lines: ['Maximum Retail Price', '₹ 340.00', '(Incl. of all taxes)'],
      amount: '340.00',
    },
    {
      what: 'merged with the net quantity on one line',
      lines: ['Net Qty.: 500 g   MRP: ₹150.00'],
      amount: '150.00',
    },
  ];

  for (const { what, lines, amount } of CASES) {
    it(`reads the price when ${what}`, () => {
      const value = valueOf(label([...NOISE, ...lines]), 'mrp');
      expect(value, 'nothing extracted').toBeDefined();
      expect(value).toContain(amount);
    });
  }

  it('never takes a barcode or a batch code for a price', () => {
    // No MRP anywhere on this face — it is on the carton. Anything returned
    // here came from the noise, and would reach a report as the package's price.
    const value = valueOf(label([...NOISE, 'Net Wt. 200 g', 'For MRP refer to carton']), 'mrp');

    if (value !== undefined) {
      expect(value).not.toContain('8901234567890');
      expect(value).not.toContain('1060600942');
    }
  });
});

/* ── Net quantity — rule 6(1)(c) ──────────────────────────────────────────── */

describe('net quantity, as it is actually printed', () => {
  const CASES: Array<{ what: string; lines: string[]; expected: string }> = [
    { what: 'Net Wt. with a stop', lines: ['Net Wt. 500 g'], expected: '500 g' },
    { what: 'Net Qty in capitals', lines: ['NET QTY: 1 kg'], expected: '1 kg' },
    { what: 'no space before the unit', lines: ['Net Quantity: 250g'], expected: '250 g' },
    { what: 'the estimated-sign suffix', lines: ['Net Weight: 100 g ℮'], expected: '100 g' },
    { what: 'millilitres on a bottle', lines: ['Net Vol. 750 ml'], expected: '750 ml' },
    { what: 'a zero read as a capital O', lines: ['Net Wt. 5OO g'], expected: '500 g' },
    {
      what: 'the label and the amount on separate lines',
      lines: ['Net Quantity', '200 g'],
      expected: '200 g',
    },
    {
      what: 'a count rather than a weight',
      lines: ['Net Qty.: 10 N'],
      expected: '10 N',
    },
  ];

  for (const { what, lines, expected } of CASES) {
    it(`reads the quantity when ${what}`, () => {
      const value = valueOf(label([...NOISE, ...lines]), 'net_quantity');
      expect(value, 'nothing extracted').toBeDefined();
      expect(value).toBe(expected);
    });
  }

  it('does not mistake a serving size for the net quantity', () => {
    const value = valueOf(
      label([...NOISE, 'Serving size: 30 g', 'Net Wt. 500 g', 'Per 100 g: Energy 380 kcal']),
      'net_quantity',
    );

    expect(value).toBe('500 g');
  });
});

/* ── Dates — rule 6(1)(d) ─────────────────────────────────────────────────── */

describe('manufacturing and packing dates, as they are actually printed', () => {
  const CASES: Array<{ what: string; lines: string[]; contains: string }> = [
    { what: 'MFD with a slash', lines: ['MFD: 03/2026'], contains: '03/2026' },
    { what: 'Mfg. Date spelled out', lines: ['Mfg. Date : MAR 2026'], contains: '2026' },
    { what: 'a packed-on date', lines: ['PKD 03-2026'], contains: '03' },
    { what: 'month and year words', lines: ['Date of Manufacture: March 2026'], contains: '2026' },
    {
      what: 'the label and the date on separate lines',
      lines: ['Month & Year of Manufacture', '04/2026'],
      contains: '04/2026',
    },
  ];

  for (const { what, lines, contains } of CASES) {
    it(`reads the date when ${what}`, () => {
      const value = valueOf(label([...NOISE, ...lines]), 'manufacturing_date');
      expect(value, 'nothing extracted').toBeDefined();
      expect(value).toContain(contains);
    });
  }

  it('does not read a best-before period as a manufacturing date', () => {
    const extraction = extractInformation(
      label([...NOISE, 'Best Before 12 Months from Mfg.', 'MFD 01/2026']),
    );

    expect(extraction.fields.manufacturing_date?.value).toContain('01/2026');
  });
});

/* ── Batch — rule 6(1) ────────────────────────────────────────────────────── */

describe('batch identification, as it is actually printed', () => {
  const CASES: Array<{ what: string; lines: string[]; contains: string }> = [
    { what: 'Batch No. spelled out', lines: ['Batch No. ABC1234'], contains: 'ABC1234' },
    { what: 'the abbreviated B.No form', lines: ['B.No: 4521'], contains: '4521' },
    { what: 'a lot number', lines: ['LOT : X99A'], contains: 'X99A' },
  ];

  for (const { what, lines, contains } of CASES) {
    it(`reads the batch when ${what}`, () => {
      const value = valueOf(label([...NOISE, ...lines]), 'batch_number');
      expect(value, 'nothing extracted').toBeDefined();
      expect(value).toContain(contains);
    });
  }

  it('does not record a barcode as the batch number', () => {
    // The barcode is the longest digit run on most packages, and it is not a
    // batch code. Recording it as one puts an invented identifier on a report.
    const value = valueOf(label([...NOISE, 'Net Wt. 200 g']), 'batch_number');

    if (value !== undefined) {
      expect(value).not.toContain('8901234567890');
    }
  });
});

/* ── Consumer care — rule 6(1) ────────────────────────────────────────────── */

describe('consumer care, as it is actually printed', () => {
  it('reads an email address given under a heading', () => {
    const value = valueOf(
      label([...NOISE, 'For Consumer Complaints / Queries', 'Email: care@example.co.in']),
      'consumer_care',
    );

    expect(value).toContain('care@example.co.in');
  });

  it('reads a toll-free number', () => {
    const value = valueOf(
      label([...NOISE, 'Consumer Care: 1800-123-4567', 'Mon-Sat 9am-6pm']),
      'consumer_care',
    );

    expect(value).toContain('1800');
  });

  it('reads a mobile number written with the country code', () => {
    const value = valueOf(
      label([...NOISE, 'Customer Care', 'Mobile : +91 97723 46555']),
      'consumer_care',
    );

    expect(value).toContain('97723');
  });
});

/* ── Country of origin — rule 6(1)(aa) ────────────────────────────────────── */

describe('country of origin, as it is actually printed', () => {
  it('reads it on the same line as its label', () => {
    expect(valueOf(label([...NOISE, 'Country of Origin: India']), 'country_of_origin')).toContain(
      'India',
    );
  });

  it('reads it when the label and the value are on separate lines', () => {
    expect(valueOf(label([...NOISE, 'Country of Origin', 'India']), 'country_of_origin')).toContain(
      'India',
    );
  });

  it('reads an imported package', () => {
    expect(
      valueOf(label([...NOISE, 'Country of Origin : China']), 'country_of_origin'),
    ).toContain('China');
  });
});

/* ── Noise ────────────────────────────────────────────────────────────────── */

describe('a reading that is mostly noise', () => {
  it('extracts nothing rather than guessing', () => {
    // A photograph of the wrong face, or one too blurred to read. Every field
    // must come back empty: this is exactly where an extractor that reaches for
    // the nearest plausible string does its damage, because the rule engine
    // will treat whatever it returns as what the package declares.
    const extraction = extractInformation(label(NOISE));

    for (const [name, record] of Object.entries({
      ...extraction.fields,
      ...extraction.informational,
    })) {
      expect(record.value, `${name} was invented from noise`).toBeFalsy();
    }
  });

  it('keeps every unread line rather than discarding it', () => {
    // Nothing the camera read may be silently dropped — an officer looking at
    // why a declaration was missed needs to see what was actually on the face.
    const extraction = extractInformation(label([...NOISE, 'Net Wt. 200 g']));
    expect(extraction.unclaimedLines.join(' ')).toContain('8901234567890');
  });
});

/* ── Two labels under one heading ─────────────────────────────────────────── */

/**
 * ── THE NEXT LABEL IS NOT THIS ONE'S VALUE ──────────────────────────────────
 *
 * Indian packs routinely put two declarations under a single heading:
 *
 *     BATCH NO. & MFG DATE: 80/23/000
 *
 * The batch matcher stops at `BATCH NO.` and what follows it is `& MFG DATE:`
 * — the rest of the heading. That has two runs of letters in it, which was all
 * the old guard asked for, so it was accepted; RPT-2026-00015 went out to a
 * dealer recording their batch number as the string "& MFG DATE:".
 *
 * Worse than wrong on its own: accepting it stops the search, because the
 * neighbour lookup only runs when the label's own line yielded nothing.
 */
describe('a heading that names two declarations', () => {
  const COMBINED = ['BATCH NO. & MFG DATE: 80/23/000'];

  it('never records the second label as the first label\'s value', () => {
    const batch = valueOf(label([...NOISE, ...COMBINED]), 'batch_number');
    if (batch !== undefined) {
      expect(batch.toUpperCase()).not.toContain('MFG');
      expect(batch.toUpperCase()).not.toContain('DATE');
    }
  });

  it('does not record a bare label run as a manufacturing date', () => {
    const mfg = valueOf(label([...NOISE, 'MFG DATE & BATCH NO.', '80/23/000']), 'manufacturing_date');
    if (mfg !== undefined) {
      expect(mfg.toUpperCase()).not.toContain('BATCH');
    }
  });

  /**
   * The value on the same line survives the strip.
   *
   * Rejecting the whole line would have been the easy fix and the wrong one:
   * the code the dealer needs is printed right there after the second heading.
   */
  it('keeps the value printed after the second heading', () => {
    const batch = valueOf(label([...NOISE, ...COMBINED]), 'batch_number');
    expect(batch, 'the value on the line was thrown away').toBeDefined();
    expect(batch).toContain('80/23/000');
  });

  /**
   * The other half of the guard: a short scrap that is *not* label vocabulary
   * is still a real reading, and must not be eaten along with the heading.
   */
  it('still accepts a short value that is not label vocabulary', () => {
    const batch = valueOf(label([...NOISE, 'BATCH NO.: ALPHA']), 'batch_number');
    expect(batch, 'a real short reading was rejected').toBeDefined();
    expect(batch?.toUpperCase()).toContain('ALPHA');
  });
});
