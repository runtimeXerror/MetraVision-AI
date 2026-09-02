import type { ConfidenceThresholds, EvidenceReference, ProductContext } from './Evidence';
import type { RuleSeverity, RuleSource, RuleTemporalStatus } from './Rule';

/**
 * ── THE RESULT ──────────────────────────────────────────────────────────────
 *
 * Five states, not two.
 *
 * The temptation in a compliance system is to collapse everything to
 * pass/fail, and the cost of doing so is that "we could not read the label"
 * becomes indistinguishable from "the label is illegal". One of those is a
 * finding against a trader; the other is a finding against the camera. The
 * five states below keep them apart, and `DecisionEngine` is careful never to
 * promote the second into the first.
 *
 * Every check carries the provision it came from, the date that provision came
 * into force, the evidence relied on, and the confidence in that evidence — so
 * a finding can be defended, and an unsound one can be seen to be unsound.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const CHECK_STATUSES = [
  /** The requirement is satisfied. */
  'COMPLIANT',
  /** The requirement is not satisfied, on evidence strong enough to say so. */
  'VIOLATION_DETECTED',
  /** Something is wrong or missing, but the evidence cannot carry a finding. */
  'REVIEW_REQUIRED',
  /** The rule does not reach this package. */
  'NOT_APPLICABLE',
  /** Nothing was captured that could answer the question either way. */
  'INSUFFICIENT_EVIDENCE',
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/** The overall verdict uses the same vocabulary as an individual check. */
export type ComplianceDecision = CheckStatus;

export const NOT_APPLICABLE_REASONS = [
  'RULE_NOT_IN_FORCE_ON_INSPECTION_DATE',
  'CONTEXT_OUT_OF_SCOPE',
  'EXCEPTION_APPLIES',
  'DEFERRED_TO_OTHER_REGULATION',
] as const;
export type NotApplicableReason = (typeof NOT_APPLICABLE_REASONS)[number];

/** Why a check landed where it did. Every value is a distinct, defensible story. */
export const CHECK_REASON_CODES = [
  'REQUIREMENT_SATISFIED',
  'DECLARATION_ABSENT',
  'DECLARATION_ABSENT_LOW_CONFIDENCE',
  'DECLARATION_UNREADABLE',
  'FORMAT_NOT_SATISFIED',
  'FORMAT_NOT_SATISFIED_LOW_CONFIDENCE',
  'VALUE_OUT_OF_RANGE',
  'UNIT_NOT_PERMITTED',
  'CROSS_FIELD_INCOMPLETE',
  'MEASUREMENT_NOT_AVAILABLE',
  'CAPTURE_INCOMPLETE',
  'NO_EVIDENCE_SUPPLIED',
  'RULE_NOT_IN_FORCE',
  'CONTEXT_OUT_OF_SCOPE',
  'EXCEPTION_APPLIES',
  'DEFERRED_TO_OTHER_REGULATION',
] as const;
export type CheckReasonCode = (typeof CHECK_REASON_CODES)[number];

/** The provenance carried on every single check. §20 — nothing is a black box. */
export interface CheckProvenance {
  ruleId: string;
  ruleVersion: string;
  sourceRule: string;
  sourceClause?: string;
  /** When the version relied on came into force. */
  effectiveFrom: string;
  effectiveTo: string | null;
  source: RuleSource;
  /** Notification numbers of every version of this rule superseded before it. */
  supersedes?: string;
}

export interface ComplianceCheck {
  ruleId: string;
  ruleVersion: string;
  status: CheckStatus;
  reasonCode: CheckReasonCode;
  /** One sentence an inspector can read aloud. */
  reason: string;

  field?: string;
  fieldLabel?: string;
  observedValue: string | null;
  /** What the provision requires, in the corpus's own words. */
  expectedRequirement: string;
  /** Verbatim legal text of the version relied on. */
  legalText: string;
  /** This system's reading of it — explicitly not authoritative. */
  machineInterpretation: string;

  /** Confidence in the observation the check was made on. `null` when none applies. */
  confidence: number | null;
  evidence: EvidenceReference[];
  severity: RuleSeverity;

  notApplicableReason?: NotApplicableReason;
  /** The exception that switched the rule off, when one did. */
  appliedExceptionId?: string;

  provenance: CheckProvenance;
}

/** A rule the engine considered, and what it did with it. */
export interface ApplicableRuleSummary {
  ruleId: string;
  ruleVersion: string;
  sourceRule: string;
  sourceClause?: string;
  title: string;
  temporalStatus: RuleTemporalStatus;
  applied: boolean;
  /** Present when `applied` is false. */
  skippedBecause?: NotApplicableReason;
}

export interface ComplianceWarning {
  code: string;
  message: string;
  /** Rules the warning bears on, where it is rule-specific. */
  ruleIds?: string[];
}

export interface ComplianceSummary {
  totalChecks: number;
  compliant: number;
  violations: number;
  reviewRequired: number;
  notApplicable: number;
  insufficientEvidence: number;
  /**
   * Checks that could not be assessed because this phase has no way to take the
   * measurement — letter heights, panel placement, legibility.
   *
   * Counted separately from `insufficientEvidence` because it is a fact about
   * the system rather than about the package. Every package would carry the
   * same count, so letting it drive the headline verdict would make the verdict
   * a constant. It is reported, warned about, and kept out of the decision.
   */
  pendingCapability: number;
}

export interface ComplianceResult {
  inspectionId?: string;
  /** The date the rules were resolved against. */
  inspectionDate: string;
  status: ComplianceDecision;
  summary: ComplianceSummary;
  checks: ComplianceCheck[];
  applicableRules: ApplicableRuleSummary[];
  warnings: ComplianceWarning[];

  /** The corpus this was decided on. A re-run against a newer corpus may differ. */
  ruleSetVersion: string;
  ruleSetChecksum: string;
  /** e.g. `effective rules as of 2026-09-01`. */
  sourceVersion: string;

  engineVersion: string;
  thresholds: ConfidenceThresholds;
  evaluatedAt: string;
  /** Milliseconds. Excluded from the determinism contract, obviously. */
  durationMs: number;
}

/** What gets written to the audit trail. §35. */
export interface ComplianceAuditRecord {
  inspectionId?: string;
  evaluatedAt: string;
  inspectionDate: string;
  ruleSetVersion: string;
  ruleSetChecksum: string;
  engineVersion: string;
  applicableRuleIds: string[];
  /** The exact request, so the evaluation can be replayed. */
  inputSnapshot: {
    productContext: ProductContext;
    fields: Record<string, unknown>;
    evidence?: Record<string, unknown>;
    thresholds: ConfidenceThresholds;
  };
  decision: ComplianceDecision;
  summary: ComplianceSummary;
  checks: ComplianceCheck[];
  evidenceReferences: EvidenceReference[];
}
