import type { DateValidation } from '../types/Rule';

import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Month-and-year declarations.
 *
 * Rule 6(1)(d) asks for a month and a year, not a full date, and packages write
 * it every way people write dates: `03/2026`, `MAR 2026`, `03-2026`, sometimes
 * with a day attached. The validator accepts the shapes the rule permits and
 * normalises to `YYYY-MM` so the "not in the future" test has something
 * unambiguous to compare.
 *
 * The future test exists because a manufacturing date after the inspection is
 * the one date error a photograph really can establish. Everything else about
 * the date — whether it is the *true* date of manufacture — is beyond what any
 * label inspection can determine, and the validator does not pretend otherwise.
 */

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

/** `YYYY-MM`, or `null` when the text carries no recognisable month and year. */
export function parseMonthYear(text: string): string | null {
  const cleaned = text.trim().replace(/^(mfg|mfd|manufactured|packed|pkd|best before|use by|exp)\.?\s*[:.-]?\s*/i, '');

  // MMM YYYY / MMM-YYYY — checked first, since a named month is unambiguous.
  const named = /([A-Za-z]{3,9})\s*[\s/.-]\s*(\d{4})/.exec(cleaned);
  if (named?.[1] && named[2]) {
    const month = MONTH_NAMES[named[1].toLowerCase()];
    if (month) return `${named[2]}-${String(month).padStart(2, '0')}`;
  }

  // DD/MM/YYYY — three groups, so the middle one is the month.
  const full = /\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/.exec(cleaned);
  if (full?.[2] && full[3]) {
    const month = Number(full[2]);
    if (month >= 1 && month <= 12) return `${full[3]}-${String(month).padStart(2, '0')}`;
  }

  // MM/YYYY.
  const short = /\b(\d{1,2})[/.-](\d{4})\b/.exec(cleaned);
  if (short?.[1] && short[2]) {
    const month = Number(short[1]);
    if (month >= 1 && month <= 12) return `${short[2]}-${String(month).padStart(2, '0')}`;
  }

  // YYYY-MM, as an extraction stage might already have normalised it.
  const iso = /\b(\d{4})-(\d{1,2})\b/.exec(cleaned);
  if (iso?.[1] && iso[2]) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${iso[1]}-${String(month).padStart(2, '0')}`;
  }

  return null;
}

export const dateValidator: Validator = ({ field, spec, inspectionDate }) => {
  const value = valueOf(field);
  const dateSpec = spec as DateValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      return { outcome: 'INDETERMINATE', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const monthYear = parseMonthYear(value);
  if (!monthYear) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `"${value}" could not be read as a month and year. Accepted forms: ${dateSpec.formats.join(', ')}.`,
      normalisedValue: value,
    };
  }

  if (dateSpec.notInFuture) {
    const inspectionMonth = inspectionDate.slice(0, 7);
    if (monthYear > inspectionMonth) {
      return {
        outcome: 'NOT_SATISFIED',
        detail: `The declared month (${monthYear}) is later than the inspection month (${inspectionMonth}).`,
        normalisedValue: monthYear,
      };
    }
  }

  return { outcome: 'SATISFIED', detail: `Declared as ${monthYear}.`, normalisedValue: monthYear };
};
