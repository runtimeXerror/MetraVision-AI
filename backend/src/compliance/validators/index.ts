import type { ValidationKind } from '../types/Rule';

import { crossFieldValidator } from './crossFieldValidator';
import { currencyValidator } from './currencyValidator';
import { dateValidator } from './dateValidator';
import { enumValidator } from './enumValidator';
import { evidenceValidator } from './evidenceValidator';
import { formatValidator } from './formatValidator';
import { numericValidator } from './numericValidator';
import { presenceValidator } from './presenceValidator';
import { unitValidator } from './unitValidator';
import type { Validator } from './types';

/**
 * The validator registry.
 *
 * A `Record` keyed by every `ValidationKind`, so adding a kind to the union
 * without writing the validator is a compile error rather than a runtime
 * surprise on some package six months from now.
 */
export const VALIDATORS: Record<ValidationKind, Validator> = {
  required: presenceValidator,
  presence: presenceValidator,
  textFormat: formatValidator,
  regex: formatValidator,
  numeric: numericValidator,
  range: numericValidator,
  unit: unitValidator,
  date: dateValidator,
  currency: currencyValidator,
  enum: enumValidator,
  crossField: crossFieldValidator,
  placement: evidenceValidator,
  fontSize: evidenceValidator,
  readability: evidenceValidator,
};

/** True for the kinds that need a measurement no part of this phase produces. */
export function needsFutureEvidence(kind: ValidationKind): boolean {
  return kind === 'placement' || kind === 'fontSize' || kind === 'readability';
}

export { TABLE_I_2018, tableIRowFor } from './evidenceValidator';
export { parseMonthYear } from './dateValidator';
export { firstNumberIn, decimalPlacesIn } from './numericValidator';
export { unitIn } from './unitValidator';
export * from './types';
