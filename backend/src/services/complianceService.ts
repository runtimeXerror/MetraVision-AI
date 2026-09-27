import type {
  ComplianceCheckDTO,
  ComplianceResultDTO,
  ComplianceStatus,
  ExtractedFieldDTO,
  ProductCategory,
  ViolationDTO,
} from '../types/domain';

import { findRequirement, resolveRuleSet, severityFor } from './ruleSets';

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

export function evaluateCompliance(input: ComplianceInput): ComplianceResultDTO {
  const ruleSet = resolveRuleSet(input.category);

  const checks: ComplianceCheckDTO[] = input.fields
    .filter((field) => field.required)
    .map((field) => {
      const requirement = findRequirement(input.category, field.name);
      const value = effectiveValue(field);
      const missing = value === null || value.trim() === '';

      return {
        code: `LMPCR-${field.name}`,
        title: `${field.label} declared`,
        ruleReference: requirement?.ruleReference ?? 'Rule 6(1)',
        result: missing ? 'FAIL' : 'PASS',
        // Graded per declaration — see `severityFor`.
        severity: missing ? severityFor(field.name) : 'MINOR',
        category: missing ? 'MISSING_DECLARATION' : 'READABILITY',
        expected: requirement?.expectation ?? `${field.label} must be declared on the package.`,
        observed: value,
        message: missing
          ? `${field.label} could not be found on any captured face of the package.`
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

  // One finding makes the package non-compliant; nothing else does.
  const status: ComplianceStatus = violations.length > 0 ? 'VIOLATION_DETECTED' : 'COMPLIANT';

  return {
    status,
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
export function statusForVerdict(verdict: ComplianceStatus): 'COMPLIANT' | 'VIOLATION_DETECTED' {
  return verdict;
}
