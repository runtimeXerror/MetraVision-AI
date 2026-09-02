import type { NumericValidation } from '../types/Rule';

import { isUnreadable, valueOf, type Validator } from './types';

/**
 * ── READING A WRITTEN AMOUNT ────────────────────────────────────────────────
 *
 * Indian packages group digits in the lakh style — `₹1,24,999.00` — and the
 * naive reading of that string is a number with five decimal places written by
 * a trader who has broken rule 6(11). It is not; it is one lakh twenty-four
 * thousand nine hundred and ninety-nine rupees, written exactly as prices are
 * written in India.
 *
 * So separators are resolved before anything is counted, by a rule that covers
 * both conventions found on Indian labels:
 *
 *   • A full stop, where one is present, is the decimal point. Every comma is
 *     then digit grouping, however it is spaced.
 *   • With commas only, the run after the last comma decides: exactly three
 *     digits is a grouped thousand (`2,499` is two and a half thousand rupees,
 *     with no paise); one or two digits is a decimal comma (`24,00`).
 *
 * This is shared by both helpers deliberately. Having `firstNumberIn` strip
 * grouping and `decimalPlacesIn` not strip it is what produced a
 * "more than two decimal places" finding against a correctly printed
 * `₹2,499.00`, which is a finding against a trader for the way India writes
 * numbers.
 * ────────────────────────────────────────────────────────────────────────────
 */
interface WrittenAmount {
  /** The integer part with grouping removed. */
  whole: string;
  /** The digits actually written after the decimal separator. */
  fraction: string;
  negative: boolean;
}

function readAmount(text: string): WrittenAmount | null {
  const match = /-?\d[\d.,]*/.exec(text);
  if (!match) return null;

  // A trailing separator is punctuation, not part of the number: "₹120." ends
  // a sentence.
  const token = match[0].replace(/[.,]+$/, '');
  const negative = token.startsWith('-');
  const digits = negative ? token.slice(1) : token;

  const lastDot = digits.lastIndexOf('.');
  if (lastDot !== -1) {
    return {
      whole: digits.slice(0, lastDot).replace(/,/g, ''),
      fraction: digits.slice(lastDot + 1).replace(/[^0-9]/g, ''),
      negative,
    };
  }

  const lastComma = digits.lastIndexOf(',');
  if (lastComma !== -1) {
    const tail = digits.slice(lastComma + 1);
    if (tail.length === 3) {
      // Grouped thousands, no fractional part.
      return { whole: digits.replace(/,/g, ''), fraction: '', negative };
    }
    return { whole: digits.slice(0, lastComma).replace(/,/g, ''), fraction: tail, negative };
  }

  return { whole: digits, fraction: '', negative };
}

/** Pulls the first number out of a declaration, ignoring currency marks and units. */
export function firstNumberIn(text: string): number | null {
  const amount = readAmount(text);
  if (!amount || amount.whole === '') return null;

  const parsed = Number(`${amount.negative ? '-' : ''}${amount.whole}${amount.fraction ? `.${amount.fraction}` : ''}`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Decimal places actually written, which is not the same as the parsed value's precision. */
export function decimalPlacesIn(text: string): number {
  return readAmount(text)?.fraction.length ?? 0;
}

export const numericValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const numeric = spec as NumericValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      return { outcome: 'INDETERMINATE', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const parsed = firstNumberIn(value);
  if (parsed === null) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: 'The declaration does not contain a number.',
      normalisedValue: value,
    };
  }

  if (numeric.integerOnly && !Number.isInteger(parsed)) {
    return { outcome: 'NOT_SATISFIED', detail: `${parsed} is not a whole number.`, normalisedValue: value };
  }

  if (numeric.min !== undefined && parsed < numeric.min) {
    return { outcome: 'NOT_SATISFIED', detail: `${parsed} is below the minimum of ${numeric.min}.`, normalisedValue: value };
  }

  if (numeric.max !== undefined && parsed > numeric.max) {
    return { outcome: 'NOT_SATISFIED', detail: `${parsed} is above the maximum of ${numeric.max}.`, normalisedValue: value };
  }

  if (numeric.maxDecimals !== undefined && decimalPlacesIn(value) > numeric.maxDecimals) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `The declaration carries more than ${numeric.maxDecimals} decimal places.`,
      normalisedValue: value,
    };
  }

  return { outcome: 'SATISFIED', detail: 'The declared value is within the permitted range.', normalisedValue: value };
};
