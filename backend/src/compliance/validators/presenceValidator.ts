import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Is the declaration there at all?
 *
 * The base case for most of Chapter II. A declaration the reading did not
 * find — or located and could not read — is NOT_SATISFIED: it goes on the
 * record as not declared, with the rule it fails, for the inspector to confirm
 * or correct against the package. The two are told apart in the detail so the
 * officer knows which it was.
 */
export const presenceValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);

  if (value !== null) {
    return { outcome: 'SATISFIED', detail: 'The declaration is present on the package.', normalisedValue: value };
  }

  if (isUnreadable(field)) {
    return {
      outcome: 'NOT_SATISFIED',
      detail: 'The declaration was located but could not be read.',
    };
  }

  return {
    outcome: 'NOT_SATISFIED',
    detail: `No declaration was found. ${spec.expectation}`,
  };
};
