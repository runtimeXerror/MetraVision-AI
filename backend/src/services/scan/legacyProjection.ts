import type { ComplianceCheck, ComplianceResult } from '../../compliance/types/ComplianceResult';
import type {
  ComplianceCheckAttrs,
  ExtractedFieldAttrs,
  ViolationAttrs,
} from '../../models/Inspection';
import type { CheckResult, ComplianceStatus, ViolationCategory } from '../../types/domain';
import type { ExtractionResult } from '../extraction';

import type { ComplianceIssue } from './issueGenerator';

/**
 * ── KEEPING THE REST OF THE APPLICATION WORKING ─────────────────────────────
 *
 * The scan writes two things onto an inspection: the full rule-engine result,
 * which is the record of what was decided and why, and this — a projection of
 * it into the shape the History screen, the dashboard tiles, the violations
 * page and the analytics aggregations were already built against.
 *
 * The projection is lossy and deliberately so; it is a summary, not a second
 * source of truth. Nothing reads it to make a decision. Where the two ever
 * disagree the rule-engine result is right, which is why the scan result is
 * stored whole beside it rather than being reconstructed from this.
 *
 * The alternative was to rewrite five screens and three aggregation pipelines
 * to speak the engine's five-state vocabulary. That is worth doing eventually.
 * It is not worth doing in the same change that first connects a camera to the
 * rulebook.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The engine has five states; the existing schema has three.
 *
 * Everything that is not a clean pass and not a finding becomes
 * REVIEW_REQUIRED, which is the honest collapse: `INSUFFICIENT_EVIDENCE` and
 * `NOT_APPLICABLE` both mean "a person still has to look", and neither may be
 * shown to a supervisor as a pass.
 */
export function toLegacyStatus(status: ComplianceResult['status']): ComplianceStatus {
  if (status === 'VIOLATION_DETECTED') return 'VIOLATION_DETECTED';
  if (status === 'COMPLIANT') return 'COMPLIANT';
  return 'REVIEW_REQUIRED';
}

const RESULT_BY_STATUS: Record<ComplianceCheck['status'], CheckResult> = {
  COMPLIANT: 'PASS',
  VIOLATION_DETECTED: 'FAIL',
  REVIEW_REQUIRED: 'WARNING',
  INSUFFICIENT_EVIDENCE: 'WARNING',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

const CATEGORY_BY_FIELD: Record<string, ViolationCategory> = {
  mrp: 'PRICING',
  unit_sale_price: 'PRICING',
  net_quantity: 'QUANTITY',
  dimensions: 'QUANTITY',
  manufacturer: 'TRACEABILITY',
  consumer_care: 'TRACEABILITY',
  country_of_origin: 'TRACEABILITY',
  manufacturing_date: 'TRACEABILITY',
  best_before: 'TRACEABILITY',
};

const ABSENCE_REASONS = new Set([
  'DECLARATION_ABSENT',
  'DECLARATION_ABSENT_LOW_CONFIDENCE',
  'CROSS_FIELD_INCOMPLETE',
]);

const READABILITY_REASONS = new Set([
  'DECLARATION_UNREADABLE',
  'CAPTURE_INCOMPLETE',
  'NO_EVIDENCE_SUPPLIED',
]);

function categoryFor(check: ComplianceCheck): ViolationCategory {
  if (ABSENCE_REASONS.has(check.reasonCode)) return 'MISSING_DECLARATION';
  if (READABILITY_REASONS.has(check.reasonCode)) return 'READABILITY';
  if (check.reasonCode === 'MEASUREMENT_NOT_AVAILABLE') return 'PLACEMENT';
  return (check.field ? CATEGORY_BY_FIELD[check.field] : undefined) ?? 'INCORRECT_DECLARATION';
}

/**
 * A 0–100 score, over the checks that were actually decided.
 *
 * Checks the engine could not assess — those waiting on a measurement no part
 * of this system takes — are excluded from both halves of the fraction. Leaving
 * them in would drag every package toward the same score and make the number
 * describe the roadmap rather than the label.
 */
export function scoreFor(result: ComplianceResult): number {
  const decisive = result.checks.filter(
    (check) => check.status !== 'NOT_APPLICABLE' && check.reasonCode !== 'MEASUREMENT_NOT_AVAILABLE',
  );

  if (decisive.length === 0) return 0;

  const passed = decisive.filter((check) => check.status === 'COMPLIANT').length;
  return Math.round((passed / decisive.length) * 100);
}

export function toLegacyChecks(result: ComplianceResult): ComplianceCheckAttrs[] {
  return result.checks.map((check) => ({
    code: `${check.ruleId}@${check.ruleVersion}`,
    title: check.provenance.sourceClause ?? check.provenance.sourceRule,
    ruleReference: `${check.provenance.sourceClause ?? check.provenance.sourceRule} — ${check.provenance.source.notification}`,
    result: RESULT_BY_STATUS[check.status],
    severity: check.severity,
    category: categoryFor(check),
    expected: check.expectedRequirement,
    observed: check.observedValue,
    message: check.reason,
    relatedFieldNames: check.field ? [check.field] : [],
  }));
}

/**
 * Violations, for the dashboard's violations register.
 *
 * Only `POTENTIAL_VIOLATION` issues cross over. A review is not a violation,
 * and a register that mixes the two would report the camera's uncertainty as
 * enforcement activity.
 */
export function toLegacyViolations(issues: ComplianceIssue[]): ViolationAttrs[] {
  return issues
    .filter((issue) => issue.classification === 'POTENTIAL_VIOLATION')
    .map((issue) => ({
      code: `${issue.ruleId}@${issue.ruleVersion}`,
      title: issue.title,
      ruleReference: `${issue.source.clause ?? issue.source.rule} — ${issue.source.notification}`,
      category:
        (issue.field ? CATEGORY_BY_FIELD[issue.field] : undefined) ??
        (issue.reasonCode.startsWith('DECLARATION_ABSENT') ? 'MISSING_DECLARATION' : 'INCORRECT_DECLARATION'),
      severity: issue.severity,
      description: issue.description,
      expected: issue.expectedRequirement,
      observed: issue.observedValue,
      // The corpus's own words about what the provision requires. No advice is
      // written here that the rule set did not supply.
      recommendation: `Confirm against the package and, if the declaration is genuinely absent or non-conforming, proceed under ${issue.source.clause ?? issue.source.rule} (${issue.source.notification}).`,
      bbox: issue.evidence[0]?.bbox ? [...issue.evidence[0].bbox] : undefined,
      sourceImageId: issue.evidence[0]?.imageId,
    }));
}

/**
 * The extracted-field list the review screen and the evidence overlay read.
 *
 * `required` is taken from whether a rule actually reached this field on this
 * package, rather than from a static list — a country-of-origin declaration is
 * required of an imported package and not of a domestic one, and the engine is
 * the only thing that knows which this is.
 */
export function toLegacyFields(
  extraction: ExtractionResult,
  result: ComplianceResult,
): ExtractedFieldAttrs[] {
  const assessed = new Set(
    result.checks
      .filter((check) => check.status !== 'NOT_APPLICABLE' && check.field)
      .map((check) => check.field!),
  );

  const records = [...Object.values(extraction.fields), ...Object.values(extraction.informational)];

  return records.map((record) => ({
    name: record.field,
    label: record.label,
    aiValue: record.value,
    // The schema requires a number here. `0` records "no confidence was
    // reported", and the scan result beside it keeps the distinction between
    // that and a genuine zero.
    confidence: record.confidence ?? 0,
    bbox: record.evidence[0]?.bbox ? [...record.evidence[0].bbox] : undefined,
    sourceImageId: record.evidence[0]?.imageId,
    required: assessed.has(record.field),
  }));
}
