import type { ExtractedField, ProductContext } from '../types/Evidence';
import type { ValidationSpec } from '../types/Rule';

/**
 * The validator contract.
 *
 * Three outcomes, never two. `INDETERMINATE` is the one that earns its keep:
 * it is how a validator says "I could not tell", which is the honest answer
 * when a font-height rule is handed a photograph and no measurement. Collapsing
 * it into `NOT_SATISFIED` is how a compliance system starts issuing notices
 * because the camera was too far away.
 *
 * A validator never decides a compliance status. It reports what it found about
 * one value; `DecisionEngine` weighs that against the confidence in the value
 * and turns the pair into a verdict. Keeping the two apart is what lets the
 * confidence policy be configuration rather than something threaded through
 * fourteen validators.
 */

export const VALIDATOR_OUTCOMES = ['SATISFIED', 'NOT_SATISFIED', 'INDETERMINATE'] as const;
export type ValidatorOutcome = (typeof VALIDATOR_OUTCOMES)[number];

export interface ValidatorInput {
  /** The field this rule governs. `undefined` when the request carried none. */
  field?: ExtractedField;
  /** The field's key, for cross-field lookups and messages. */
  fieldName?: string;
  /** Every field in the request, for `crossField`. */
  allFields: Record<string, ExtractedField>;
  productContext: ProductContext;
  spec: ValidationSpec;
  /** ISO date, for date validators that must not accept a future month. */
  inspectionDate: string;
}

export interface ValidatorResult {
  outcome: ValidatorOutcome;
  /** One clause explaining the outcome; becomes part of the check's reason. */
  detail: string;
  /**
   * Set when the outcome is INDETERMINATE because a measurement is missing.
   * Names the measurement, so the future CV service has a concrete list of what
   * this engine is waiting for.
   */
  missingMeasurement?: string;
  /** The value as the validator understood it, normalised where it could be. */
  normalisedValue?: string;
}

export type Validator = (input: ValidatorInput) => ValidatorResult;

/** The value a validator should test: `null` when the field is absent or blank. */
export function valueOf(field: ExtractedField | undefined): string | null {
  if (!field) return null;
  if (field.value === null || field.value === undefined) return null;
  const text = String(field.value).trim();
  return text === '' ? null : text;
}

/** True when the extraction stage said the value could not be read, as opposed to not being there. */
export function isUnreadable(field: ExtractedField | undefined): boolean {
  return field?.status === 'UNREADABLE';
}
