import { isUnreadable, valueOf, type Validator } from './types';

/**
 * Is the declaration there at all?
 *
 * The base case for most of Chapter II, and the place where a distinction the
 * rest of the system depends on gets made: *absent* and *unreadable* are not
 * the same finding. A declaration nobody could read is very likely present; the
 * validator says INDETERMINATE and the decision engine sends it for review. A
 * declaration the extraction stage looked for and did not find is NOT_SATISFIED,
 * and whether that becomes a violation depends on how good the evidence was.
 */
export const presenceValidator: Validator = ({ field, spec }) => {
  const value = valueOf(field);

  if (value !== null) {
    return { outcome: 'SATISFIED', detail: 'The declaration is present on the package.', normalisedValue: value };
  }

  if (isUnreadable(field)) {
    return {
      outcome: 'INDETERMINATE',
      detail: 'The declaration was located but could not be read.',
    };
  }

  return {
    outcome: 'NOT_SATISFIED',
    detail: `No declaration was found. ${spec.expectation}`,
  };
};
