import type { CurrencyValidation } from '../types/Rule';

import { decimalPlacesIn, firstNumberIn } from './numericValidator';
import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Price declarations.
 *
 * The `mustContainAny` list on the spec is what encodes the change G.S.R.
 * 629(E) made in 2018 and G.S.R. 779(E) unwound in 2024: for six years the
 * clause required the declaration to identify itself as a *maximum retail
 * price*, and a bare amount was not enough. Because the requirement lives on
 * the rule version rather than in this file, an inspection dated 2019 and one
 * dated 2025 get different answers from the same code — which is the point.
 */

const RUPEE_MARKERS = ['₹', 'rs', 'rs.', 'inr', 'rupees'];

/**
 * The declaration saying what it is, in the forms a pack prints it.
 *
 * `MRP` is allowed a trailing stray character because that is where the rupee
 * sign was: `MRP ₹` comes back as `MRPT` and `MRP?` from two frames of the
 * same panel.
 */
const NAMES_ITSELF_A_PRICE =
  /\bm\.?\s?r\.?\s?p\.?\s*[₹?t]?\b|\bmaximum\s+retail\s+price\b|\bretail\s+sale\s+price\b|\bunit\s*(?:sale|retail)?\s*price\b/i;

export const currencyValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const currency = spec as CurrencyValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      // Located but not legible: recorded as not declared, for the inspector to
      // confirm on the package. There is no third state to put it in.
      return { outcome: 'NOT_SATISFIED', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const amount = firstNumberIn(value);
  if (amount === null) {
    return { outcome: 'NOT_SATISFIED', detail: 'The price declaration does not contain an amount.', normalisedValue: value };
  }

  if (amount < 0) {
    return { outcome: 'NOT_SATISFIED', detail: 'The declared price is negative.', normalisedValue: value };
  }

  const haystack = value.toLowerCase();
  const hasCurrencyMarker = RUPEE_MARKERS.some((marker) => haystack.includes(marker));
  if (!hasCurrencyMarker) {
    /**
     * ── ONE GLYPH IS NOT ENOUGH TO ACCUSE SOMEBODY ──────────────────────────
     *
     * The rupee sign is the least reliably recognised character on an Indian
     * label — a recent addition to most fonts, printed small, and returned as
     * `7`, `2`, `R`, `T`, `?` or nothing at all. The extraction stage says so
     * in as many words beside its own `MISREAD_RUPEE` repair.
     *
     * So a price declaration that names itself — `MRP 299.00`, `Maximum Retail
     * Price 299.00` — and carries an amount, but whose marker did not survive
     * the camera, presents two possibilities that this evidence cannot
     * separate: the pack omitted the marker, or the recogniser lost it. A
     * ₹299 cleanser was reported as declaring its price in the wrong form on
     * exactly that basis, and the pack prints `MRP ₹ 299.00`.
     *
     * Where the declaration does not even name itself, the finding stands: a
     * bare number with no marker and no wording is not a price declaration in
     * any reading of it.
     */
    if (NAMES_ITSELF_A_PRICE.test(value)) {
      // Taken as satisfied. A declaration headed MRP with an amount after it
      // is a retail price in Indian currency on any reading a dealer would
      // recognise, and the one glyph the camera loses most is not grounds to
      // say otherwise.
      return {
        outcome: 'SATISFIED',
        detail:
          'The declaration is labelled as a price and carries an amount. No currency ' +
          'marker was read — the rupee sign is often lost in a photograph.',
        normalisedValue: value,
      };
    }

    return {
      outcome: 'NOT_SATISFIED',
      detail: 'The price is declared without an Indian currency marker (₹, Rs. or INR).',
      normalisedValue: value,
    };
  }

  if (currency.mustContainAny && currency.mustContainAny.length > 0) {
    const found = currency.mustContainAny.some((needle) => haystack.includes(needle.toLowerCase()));
    if (!found) {
      return {
        outcome: 'NOT_SATISFIED',
        detail: `The declaration does not identify itself as required — expected one of ${currency.mustContainAny
          .map((entry) => `"${entry}"`)
          .join(', ')}.`,
        normalisedValue: value,
      };
    }
  }

  if (currency.maxDecimals !== undefined && decimalPlacesIn(value) > currency.maxDecimals) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `The price carries more than ${currency.maxDecimals} decimal places.`,
      normalisedValue: value,
    };
  }

  return { outcome: 'SATISFIED', detail: `Declared as ₹${amount.toFixed(2)}.`, normalisedValue: value };
};
