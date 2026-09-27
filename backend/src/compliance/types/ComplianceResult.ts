import type { EvidenceReference, ProductContext } from './Evidence';
import type { RuleSeverity, RuleSource, RuleTemporalStatus } from './Rule';

/**
 * ── THE RESULT ──────────────────────────────────────────────────────────────
 *
 * Two answers per rule, and a third that is not an answer.
 *
 * A rule that reaches the package is either satisfied or it is not. There is
 * no "review required" and no "insufficient evidence": the inspector who
 * finalizes the record is the review, and a declaration the reading did not
 * find is recorded as not declared — with the rule it contravenes — for that
 * inspector to confirm or correct on the package in front of them.
 *
 * `NOT_APPLICABLE` is the third value, and it is not a verdict. It says the
 * rule did not reach this package on the facts recorded — out of scope, exempt,
 * or handed to another regulation.
 *
 * Every check carries the provision it came from, the date that provision came
 * into force, and the evidence relied on — so a finding can be defended, and an
 * unsound one can be seen to be unsound.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const CHECK_STATUSES = [
  /** The requirement is satisfied. */
  'COMPLIANT',
  /** The requirement is not satisfied. */
  'VIOLATION_DETECTED',
  /** The rule does not reach this package. */
  'NOT_APPLICABLE',
] as const;
export type CheckStatus = (typeof CHECK_STATUSES)[number];

/**
 * The overall verdict uses the same vocabulary as an individual check.
 * `NOT_APPLICABLE` only when no rule reached the package at all.
 */
export type ComplianceDecision = CheckStatus;

export const NOT_APPLICABLE_REASONS = [
  'RULE_NOT_IN_FORCE_ON_INSPECTION_DATE',
  'CONTEXT_OUT_OF_SCOPE',
  'EXCEPTION_APPLIES',
  'DEFERRED_TO_OTHER_REGULATION',
  /**
   * The rule turns on a physical measurement — a letter height in millimetres,
   * which panel a declaration sits on — that a photograph cannot supply. Such
   * a rule is listed as considered and not evaluated; it never becomes a check.
   */
  'MEASUREMENT_NOT_AVAILABLE',
] as const;
export type NotApplicableReason = (typeof NOT_APPLICABLE_REASONS)[number];

/** Why a check landed where it did. Every value is a distinct, defensible story. */
export const CHECK_REASON_CODES = [
  'REQUIREMENT_SATISFIED',
  'DECLARATION_ABSENT',
  'DECLARATION_UNREADABLE',
  'FORMAT_NOT_SATISFIED',
  'VALUE_OUT_OF_RANGE',
  'UNIT_NOT_PERMITTED',
  'CROSS_FIELD_INCOMPLETE',
  'MEASUREMENT_NOT_AVAILABLE',
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

  /**
   * The OCR's confidence in the reading the check was made on, where one was
   * reported. Informational — it never changes the outcome.
   */
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
  /**
   * Addressed to the officer reading the report.
   *
   * It is printed verbatim in a document served on a dealer, so it says what
   * they should do and never what the software cannot do. Anything that names
   * an internal field belongs beside it as data, not inside it as prose.
   */
  message: string;
  /** Rules the warning bears on, where it is rule-specific. */
  ruleIds?: string[];
  /**
   * The measurement the engine is waiting for, for MEASUREMENT_NOT_AVAILABLE.
   *
   * Machine-readable on purpose: the diagnostics and the tests need to know
   * *which* measurement, and the message no longer says.
   */
  measurement?: string;
}

export interface ComplianceSummary {
  totalChecks: number;
  compliant: number;
  violations: number;
  notApplicable: number;
  /**
   * Rules that were in force and in scope but could not be evaluated because
   * this system has no way to take the measurement — letter heights, panel
   * placement, legibility. They produce no check and are not in `totalChecks`;
   * the count is kept so a reader knows they were considered.
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
  };
  decision: ComplianceDecision;
  summary: ComplianceSummary;
  checks: ComplianceCheck[];
  evidenceReferences: EvidenceReference[];
}
