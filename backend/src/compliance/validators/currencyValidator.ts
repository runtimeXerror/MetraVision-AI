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

export const currencyValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const currency = spec as CurrencyValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      return { outcome: 'INDETERMINATE', detail: 'The declaration was located but could not be read.' };
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
