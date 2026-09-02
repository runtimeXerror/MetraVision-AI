import type { EvidenceValidation } from '../types/Rule';

import type { EvidenceReference } from '../types/Evidence';

import { valueOf, type Validator } from './types';

/**
 * ── THE VALIDATORS THAT ARE WAITING FOR COMPUTER VISION ─────────────────────
 *
 * Placement, font size and readability. All three need a measurement taken off
 * an image, and no part of this system takes one — by design, this phase adds
 * no OCR, no CV, no model.
 *
 * So this validator is honest about it. If the required measurement is on the
 * evidence, it applies the threshold. If it is not, it returns INDETERMINATE
 * and names what is missing, and `DecisionEngine` turns that into
 * INSUFFICIENT_EVIDENCE — never a violation, and never a pass either.
 *
 * The second half of that matters more than it looks. The tempting shortcut is
 * to skip these rules and let the package come back COMPLIANT. That would tell
 * an inspector the letter heights were checked and found adequate, on the
 * strength of nothing at all. Reporting them as unmeasured keeps the gap
 * visible, and it is what makes the corpus honest about what it can currently
 * do — the thresholds are all in place and traceable to Table-I as corrected
 * by G.S.R. 1373(E); only the measuring is missing.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Table-I as substituted by G.S.R. 629(E) and corrected by G.S.R. 1373(E). */
export const TABLE_I_2018: Array<{ maxAreaCm2: number | null; minHeightMm: number; minHeightMoldedMm: number }> = [
  { maxAreaCm2: 50, minHeightMm: 1.0, minHeightMoldedMm: 2.0 },
  { maxAreaCm2: 100, minHeightMm: 1.5, minHeightMoldedMm: 3.0 },
  { maxAreaCm2: 500, minHeightMm: 2.5, minHeightMoldedMm: 4.0 },
  { maxAreaCm2: 2500, minHeightMm: 4.0, minHeightMoldedMm: 6.0 },
  { maxAreaCm2: null, minHeightMm: 6.0, minHeightMoldedMm: 6.0 },
];

/** The Table-I row for a principal display panel of the given area. */
export function tableIRowFor(areaCm2: number): { minHeightMm: number; minHeightMoldedMm: number } {
  for (const row of TABLE_I_2018) {
    if (row.maxAreaCm2 === null || areaCm2 <= row.maxAreaCm2) {
      return { minHeightMm: row.minHeightMm, minHeightMoldedMm: row.minHeightMoldedMm };
    }
  }
  // Unreachable: the last row has an open upper bound. Present so the function
  // is total without a non-null assertion.
  return { minHeightMm: 6.0, minHeightMoldedMm: 6.0 };
}

/**
 * The evidence these checks measure against.
 *
 * Rule 7 governs "any numeral and letter in the declaration required under
 * these rules" — every declaration, not one nominated field. So a rule with no
 * `field` of its own is measured against the evidence for *all* fields, and a
 * rule that names a field is measured against that field's evidence alone.
 */
function evidenceFor(input: Parameters<Validator>[0]): EvidenceReference[] {
  if (input.field) return input.field.evidence ?? [];
  return Object.values(input.allFields).flatMap((entry) => entry.evidence ?? []);
}

/**
 * The measurement to test against.
 *
 * For a minimum-height rule the answer is the *smallest* character measured:
 * "shall not be less than" is breached by the smallest one, and taking the
 * first or the average would let an undersized declaration hide behind a
 * well-set one.
 */
function smallestMeasurement(
  references: EvidenceReference[],
  key: 'heightMm' | 'widthMm' | 'legibility',
): number | undefined {
  const values = references
    .map((reference) => reference.measurements?.[key])
    .filter((value): value is number => typeof value === 'number');

  return values.length > 0 ? Math.min(...values) : undefined;
}

/** The panel area, which is a property of the package rather than of a character. */
function panelArea(references: EvidenceReference[]): number | undefined {
  for (const reference of references) {
    const value = reference.measurements?.principalDisplayPanelAreaCm2;
    if (typeof value === 'number') return value;
  }
  return undefined;
}

export const evidenceValidator: Validator = (input) => {
  const { spec } = input;
  const evidenceSpec = spec as EvidenceValidation;
  const references = evidenceFor(input);

  switch (evidenceSpec.kind) {
    case 'fontSize': {
      const height = smallestMeasurement(references, 'heightMm');
      const width = smallestMeasurement(references, 'widthMm');
      const area = panelArea(references);

      if (evidenceSpec.requiresMeasurement === 'widthMm') {
        if (width === undefined || height === undefined) {
          return {
            outcome: 'INDETERMINATE',
            detail: 'Letter width and height have not been measured. This check needs image measurements that are not produced in this phase.',
            missingMeasurement: width === undefined ? 'widthMm' : 'heightMm',
          };
        }
        if (width < height / 3) {
          return {
            outcome: 'NOT_SATISFIED',
            detail: `Letter width ${width} mm is less than one third of the height ${height} mm.`,
          };
        }
        return { outcome: 'SATISFIED', detail: `Letter width ${width} mm is at least one third of the height ${height} mm.` };
      }

      if (height === undefined) {
        return {
          outcome: 'INDETERMINATE',
          detail: 'Character height has not been measured. This check needs image measurements that are not produced in this phase.',
          missingMeasurement: 'heightMm',
        };
      }

      // A fixed floor, where the rule states one outright rather than by table.
      if (evidenceSpec.minimumMm !== undefined) {
        if (height < evidenceSpec.minimumMm) {
          return { outcome: 'NOT_SATISFIED', detail: `Character height ${height} mm is below the required ${evidenceSpec.minimumMm} mm.` };
        }
        return { outcome: 'SATISFIED', detail: `Character height ${height} mm meets the required ${evidenceSpec.minimumMm} mm.` };
      }

      if (area === undefined) {
        return {
          outcome: 'INDETERMINATE',
          detail:
            'The area of the principal display panel has not been measured, so the applicable Table-I row cannot be selected.',
          missingMeasurement: 'principalDisplayPanelAreaCm2',
        };
      }

      const row = tableIRowFor(area);
      if (height < row.minHeightMm) {
        return {
          outcome: 'NOT_SATISFIED',
          detail: `Character height ${height} mm is below the ${row.minHeightMm} mm required by Table-I for a principal display panel of ${area} cm².`,
        };
      }
      return {
        outcome: 'SATISFIED',
        detail: `Character height ${height} mm meets the ${row.minHeightMm} mm required by Table-I for a principal display panel of ${area} cm².`,
      };
    }

    case 'placement': {
      const panels = references
        .map((reference) => reference.measurements?.panel)
        .filter((panel): panel is NonNullable<typeof panel> => panel !== undefined);

      if (panels.length === 0) {
        return {
          outcome: 'INDETERMINATE',
          detail: 'The face the declaration appears on has not been identified. This check needs image analysis that is not produced in this phase.',
          missingMeasurement: 'panel',
        };
      }

      const required = evidenceSpec.panel ?? 'ANY_FACE';
      if (required === 'ANY_FACE') {
        return { outcome: 'SATISFIED', detail: 'The declaration appears on a captured face of the package.' };
      }
      if (panels.includes('PRINCIPAL_DISPLAY_PANEL')) {
        return { outcome: 'SATISFIED', detail: 'The declaration appears on the principal display panel.' };
      }
      return {
        outcome: 'NOT_SATISFIED',
        detail: `The declaration was found on ${panels.join(', ')} rather than on the principal display panel.`,
      };
    }

    case 'readability': {
      const legibility = smallestMeasurement(references, 'legibility');
      if (legibility === undefined) {
        return {
          outcome: 'INDETERMINATE',
          detail: 'Legibility has not been scored. This check needs image-quality analysis that is not produced in this phase.',
          missingMeasurement: 'legibility',
        };
      }
      if (legibility < 0.5) {
        return { outcome: 'NOT_SATISFIED', detail: `The declaration scored ${legibility.toFixed(2)} for legibility.` };
      }
      return {
        outcome: 'SATISFIED',
        detail: `The declaration is legible (${legibility.toFixed(2)}).`,
        normalisedValue: valueOf(input.field) ?? undefined,
      };
    }

    default: {
      const exhaustive: never = evidenceSpec.kind;
      void exhaustive;
      return { outcome: 'INDETERMINATE', detail: 'Unrecognised evidence-based validation.' };
    }
  }
};
