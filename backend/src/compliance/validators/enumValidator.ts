import type { EnumValidation } from '../types/Rule';

import { isUnreadable, valueOf, type Validator } from './types';

/** A declaration that must be one of a fixed set of values. */
export const enumValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);
  const enumSpec = spec as EnumValidation;

  if (value === null) {
    if (isUnreadable(field)) {
      // Located but not legible: recorded as not declared, for the inspector to
      // confirm on the package. There is no third state to put it in.
      return { outcome: 'NOT_SATISFIED', detail: 'The declaration was located but could not be read.' };
    }
    return { outcome: 'NOT_SATISFIED', detail: `No declaration was found. ${spec.expectation}` };
  }

  const matches = enumSpec.allowed.some((candidate) =>
    enumSpec.caseSensitive ? candidate === value : candidate.toLowerCase() === value.toLowerCase(),
  );

  if (!matches) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: `"${value}" is not one of the permitted values (${enumSpec.allowed.join(', ')}).`,
      normalisedValue: value,
    };
  }

  return { outcome: 'SATISFIED', detail: `Declared as "${value}".`, normalisedValue: value };
};
