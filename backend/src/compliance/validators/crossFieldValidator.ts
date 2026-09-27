import type { CrossFieldValidation } from '../types/Rule';

import { unitIn } from './unitValidator';
import { valueOf, type Validator } from './types';

/**
 * Checks that hold between several declarations rather than within one.
 *
 * Only three relations, and that is deliberate. Every additional relation is an
 * assertion about what the law requires of two fields *together*, and none of
 * those assertions should be invented here — each one has to come from a
 * provision that actually says it. `allPresentTogether` covers rule 4(2); the
 * other two are here because the shape is needed, not because a rule in the
 * current corpus uses them.
 */
export const crossFieldValidator: Validator = ({ allFields, spec }) => {
  const cross = spec as CrossFieldValidation;
  const present = cross.requires.filter((name) => valueOf(allFields[name]) !== null);
  const missing = cross.requires.filter((name) => valueOf(allFields[name]) === null);

  switch (cross.relation) {
    case 'allPresentTogether': {
      if (missing.length === 0) {
        return { outcome: 'SATISFIED', detail: `All of ${cross.requires.join(', ')} are declared.` };
      }
      return { outcome: 'NOT_SATISFIED', detail: `Missing: ${missing.join(', ')}.` };
    }

    case 'anyPresent': {
      if (present.length > 0) {
        return { outcome: 'SATISFIED', detail: `${present.join(', ')} declared.` };
      }
      return { outcome: 'NOT_SATISFIED', detail: `None of ${cross.requires.join(', ')} were declared.` };
    }

    case 'consistentUnits': {
      const units = present
        .map((name) => {
          const field = allFields[name];
          const value = valueOf(field);
          return field?.unit?.trim() ?? (value ? unitIn(value) : null);
        })
        .filter((unit): unit is string => unit !== null)
        .map((unit) => unit.toLowerCase());

      if (units.length < 2) {
        // Nothing to compare is nothing inconsistent.
        return { outcome: 'SATISFIED', detail: 'Fewer than two declarations carried a unit; there is nothing to compare.' };
      }
      const distinct = new Set(units);
      if (distinct.size > 1) {
        return { outcome: 'NOT_SATISFIED', detail: `Inconsistent units across declarations: ${[...distinct].join(', ')}.` };
      }
      return { outcome: 'SATISFIED', detail: `Consistent units (${units[0]}) across declarations.` };
    }

    default: {
      const exhaustive: never = cross.relation;
      void exhaustive;
      return { outcome: 'SATISFIED', detail: 'Unrecognised cross-field relation; not applied.' };
    }
  }
};
