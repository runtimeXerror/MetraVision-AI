import type {
  ComplianceCheckDTO,
  ComplianceResultDTO,
  ComplianceStatus,
  ExtractedFieldDTO,
  ProductCategory,
  ViolationDTO,
} from '../types/domain';

import { REVIEW_CONFIDENCE_THRESHOLD, findRequirement, resolveRuleSet, severityFor } from './ruleSets';

/**
 * ── THE COMPLIANCE ABSTRACTION ──────────────────────────────────────────────
 *
 * Turns extracted declarations into a verdict. Deliberately independent of the
 * mobile UI and of the analysis provider: it takes fields in and returns a
 * result, so it can be unit-tested on its own and later replaced wholesale.
 *
 *   Phase 2 (now):  presence + confidence checks against the rule catalogue
 *   Phase 3:        Extracted data → applicable rules → engine → result
 *                   with a versioned rulebook, unit conversion, font-size
 *                   measurement and legal interpretation.
 *
 * What it already gets right, and what Phase 3 must preserve:
 *   - Three verdicts, never pass/fail.
 *   - A missing mandatory declaration outranks uncertainty.
 *   - The inspector's confirmed value takes precedence over the model's read.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ComplianceInput {
  fields: ExtractedFieldDTO[];
  category?: ProductCategory;
}

/**
 * The value of record for a field: the inspector's correction when one exists,
 * otherwise the model's read. A field marked unavailable is authoritatively
 * absent, which is a stronger statement than the model simply not finding it.
 */
export function effectiveValue(field: ExtractedFieldDTO): string | null {
  if (field.reviewAction === 'MARKED_UNAVAILABLE') return null;
  if (field.humanVerifiedValue !== undefined && field.humanVerifiedValue !== null) {
    return field.humanVerifiedValue;
  }
  if (field.reviewAction === 'ACCEPTED') return field.aiValue;
  return field.humanVerifiedValue ?? field.aiValue;
}

/** True when a field still needs an inspector decision. */
export function needsReview(field: ExtractedFieldDTO): boolean {
  if (field.reviewAction) return false;

  const value = field.aiValue;
  const missing = value === null || value.trim() === '';

  if (missing && field.required) return true;
  return field.confidence < REVIEW_CONFIDENCE_THRESHOLD;
}

export function evaluateCompliance(input: ComplianceInput): ComplianceResultDTO {
  const ruleSet = resolveRuleSet(input.category);

  const checks: ComplianceCheckDTO[] = input.fields
    .filter((field) => field.required)
    .map((field) => {
      const requirement = findRequirement(input.category, field.name);
      const value = effectiveValue(field);
      const missing = value === null || value.trim() === '';

      // A value the inspector has confirmed is certain regardless of what the
      // model's confidence was — the human is the authority here.
      const confirmed = field.reviewAction !== undefined;
      const uncertain = !missing && !confirmed && field.confidence < REVIEW_CONFIDENCE_THRESHOLD;

      return {
        code: `LMPCR-${field.name}`,
        title: `${field.label} declared`,
        ruleReference: requirement?.ruleReference ?? 'Rule 6(1)',
        result: missing ? 'FAIL' : uncertain ? 'WARNING' : 'PASS',
        // Graded per declaration — see `severityFor`. An unreadable field is
        // always MINOR: the declaration is present, it just needs confirming.
        severity: missing ? severityFor(field.name) : 'MINOR',
        category: missing ? 'MISSING_DECLARATION' : 'READABILITY',
        expected: requirement?.expectation ?? `${field.label} must be declared on the package.`,
        observed: value,
        message: missing
          ? `${field.label} could not be found on any captured face of the package.`
          : uncertain
            ? `${field.label} was read with low confidence and needs inspector confirmation.`
            : `${field.label} is present and legible.`,
        relatedFieldNames: [field.name],
      } satisfies ComplianceCheckDTO;
    });

  const violations: ViolationDTO[] = checks
    .filter((check) => check.result === 'FAIL')
    .map((check) => {
      const field = input.fields.find((candidate) => candidate.name === check.relatedFieldNames[0]);

      return {
        code: check.code,
        title: check.title.replace(/ declared$/, ' not declared'),
        ruleReference: check.ruleReference,
        category: check.category,
        severity: check.severity,
        description: check.message,
        expected: check.expected,
        observed: check.observed,
        recommendation:
          check.category === 'MISSING_DECLARATION'
            ? 'Issue a notice under the Legal Metrology (Packaged Commodities) Rules and require corrective labelling before further sale.'
            : 'Record the discrepancy and advise the dealer to correct the declaration.',
        bbox: field?.bbox,
        sourceImageId: field?.sourceImageId,
      } satisfies ViolationDTO;
    });

  const warningCount = checks.filter((check) => check.result === 'WARNING').length;

  // A missing mandatory declaration is a finding regardless of how confident
  // the reads on other fields were, so a violation outranks uncertainty.
  let status: ComplianceStatus;
  if (violations.length > 0) status = 'VIOLATION_DETECTED';
  else if (warningCount > 0) status = 'REVIEW_REQUIRED';
  else status = 'COMPLIANT';

  const applicable = checks.filter((check) => check.result !== 'NOT_APPLICABLE');
  const passed = applicable.filter((check) => check.result === 'PASS').length;
  const score =
    applicable.length === 0
      ? 100
      : Math.round(((passed + warningCount * 0.5) / applicable.length) * 100);

  return {
    status,
    score,
    checks,
    violations,
    warnings: [],
    ruleSetId: ruleSet.id,
    ruleSetLabel: ruleSet.label,
    evaluatedAt: new Date().toISOString(),
  };
}

/**
 * Maps a verdict onto the inspection's workflow status.
 *
 * Kept here rather than in the controller so every write path — analyse,
 * review, finalize — agrees on what the record's status should be.
 */
export function statusForVerdict(verdict: ComplianceStatus): 'COMPLIANT' | 'VIOLATION_DETECTED' | 'REVIEW_REQUIRED' {
  return verdict;
}
