import type { UnitValidation } from '../types/Rule';

import { firstNumberIn } from './numericValidator';
import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Net quantity: a number and a standard unit.
 *
 * What this validator does *not* do is worth stating. Rule 6(1)(c) requires
 * the net quantity to be declared in a standard unit; it does not follow that
 * the engine can say the declared quantity is wrong. That needs a weighing
 * instrument and the Fifth Schedule sampling procedure, not a photograph. So
 * the check is about the form of the declaration — that a quantity was declared
 * and that its unit is one the rules recognise — and nothing here ever asserts
 * that a package is short.
 */

/** Trailing unit token, e.g. `500 g` → `g`, `1.5kg` → `kg`. */
export function unitIn(text: string): string | null {
  const match = /(?:\d|\s)\s*([A-Za-z.]+)\s*$/.exec(text.trim());
  const unit = match?.[1]?.replace(/\.$/, '');
  return unit && unit.length > 0 ? unit : null;
}

export const unitValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const unitSpec = spec as UnitValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      // Located but not legible: recorded as not declared, for the inspector to
      // confirm on the package. There is no third state to put it in.
      return { outcome: 'NOT_SATISFIED', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const quantity = firstNumberIn(value);
  if (quantity === null) {
    return { outcome: 'NOT_SATISFIED', detail: 'The net quantity declaration does not contain a number.', normalisedValue: value };
  }

  // An explicit unit on the field beats one parsed out of the text: the
  // extraction stage separated them, and re-deriving it would throw that away.
  const unit = field?.unit?.trim() ?? unitIn(value);

  if (!unit) {
    if (!unitSpec.unitRequired) {
      return { outcome: 'SATISFIED', detail: 'A net quantity is declared.', normalisedValue: value };
    }
    return {
      outcome: 'NOT_SATISFIED',
      detail: 'The net quantity is declared without a unit of weight or measure.',
      normalisedValue: value,
    };
  }

  const permitted = unitSpec.allowedUnits.some((candidate) => candidate.toLowerCase() === unit.toLowerCase());
  if (!permitted) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `"${unit}" is not one of the standard units this declaration may use (${unitSpec.allowedUnits.join(', ')}).`,
      normalisedValue: value,
    };
  }

  return {
    outcome: 'SATISFIED',
    detail: `Net quantity declared as ${quantity} ${unit}, in a standard unit.`,
    normalisedValue: `${quantity} ${unit}`,
  };
};
