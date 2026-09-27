import type { TextFormatValidation } from '../types/Rule';

import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Pattern and keyword checks on a declaration's text.
 *
 * `mustContainAny` is what makes the MRP rule work: from 1 January 2018 the
 * clause required the declaration to *say* it is the maximum retail price, and
 * a bare "₹120" does not. The check is a substring test rather than a regex so
 * a rule author cannot accidentally write a catastrophically backtracking
 * pattern into the database.
 *
 * Where a regex is supplied it is compiled by the shared helper, which strips
 * stateful flags — see `ConditionEvaluator` for why that matters.
 */
function compile(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, (flags ?? '').replace(/[gy]/g, ''));
  } catch {
    return null;
  }
}

export const formatValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const format = spec as TextFormatValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      // Located but not legible: recorded as not declared, for the inspector to
      // confirm on the package. There is no third state to put it in.
      return { outcome: 'NOT_SATISFIED', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const haystack = value.toLowerCase();

  if (format.mustContainAll) {
    const missing = format.mustContainAll.filter((needle) => !haystack.includes(needle.toLowerCase()));
    if (missing.length > 0) {
      return {
        outcome: 'NOT_SATISFIED',
        detail: `The declaration does not include ${missing.map((entry) => `"${entry}"`).join(', ')}.`,
        normalisedValue: value,
      };
    }
  }

  if (format.mustContainAny && format.mustContainAny.length > 0) {
    const found = format.mustContainAny.some((needle) => haystack.includes(needle.toLowerCase()));
    if (!found) {
      return {
        outcome: 'NOT_SATISFIED',
        detail: `The declaration does not include any of ${format.mustContainAny.map((entry) => `"${entry}"`).join(', ')}.`,
        normalisedValue: value,
      };
    }
  }

  const regex = compile(format.pattern, format.flags);
  if (!regex) {
    // A rule whose pattern will not compile is a corpus defect, reported by
    // RuleSetValidator. It must not become a finding against a trader.
    return {
      outcome: 'SATISFIED',
      detail: 'The declaration is present. The rule\'s format pattern is not valid and could not be applied.',
      normalisedValue: value,
    };
  }

  if (!regex.test(value)) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `The declaration does not match the required form. ${spec.expectation}`,
      normalisedValue: value,
    };
  }

  return { outcome: 'SATISFIED', detail: 'The declaration matches the required form.', normalisedValue: value };
};
