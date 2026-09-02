import type { CheckReasonCode, CheckStatus, ComplianceDecision, ComplianceSummary } from '../types/ComplianceResult';
import type { ConfidenceThresholds, EvidenceContext, ExtractedField } from '../types/Evidence';
import type { ValidatorResult } from '../validators/types';

/**
 * ── FROM "WHAT THE VALIDATOR FOUND" TO "WHAT WE ARE PREPARED TO SAY" ────────
 *
 * The validators answer a question about a value. This turns that answer into a
 * position an enforcement system is willing to defend, and the difference
 * between the two is evidence.
 *
 * The rule the prompt sets out, and the reason for it:
 *
 *     field missing + strong evidence   → potential violation
 *     field missing + weak evidence     → review required
 *
 * A missing MRP on a package photographed from every side in good light is a
 * finding. The same missing MRP on one blurred photograph of the front face is
 * a statement about the photograph. Both look identical at the point where the
 * extraction stage hands over `{ value: null }` — which is why the input
 * contract carries `absenceConfidence` and `captureCompleteness`, and why they
 * are consulted here rather than anywhere else.
 *
 * Every threshold is configurable and none is law. They are an evidentiary
 * policy, and a department that wants to be more or less cautious than the
 * defaults should be able to say so without touching this file.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface DecisionInput {
  validator: ValidatorResult;
  field?: ExtractedField;
  evidence?: EvidenceContext;
  thresholds: ConfidenceThresholds;
  /** True for placement / fontSize / readability, which have no measurements yet. */
  awaitingFutureEvidence: boolean;
}

export interface Decision {
  status: CheckStatus;
  reasonCode: CheckReasonCode;
  /** Confidence in the observation the decision rests on. `null` when none applies. */
  confidence: number | null;
}

/**
 * How confident we are in the observation.
 *
 * A human verification outranks everything: an inspector who has looked at the
 * package and recorded what it says is not a 0.94 probability. Everything else
 * falls back to the model's own confidence, and to a deliberately pessimistic
 * default when it did not supply one — an extraction stage that reports no
 * confidence has told us nothing about how much to trust it, and treating
 * silence as certainty is how a system starts issuing notices on guesses.
 */
export function effectiveConfidence(field: ExtractedField | undefined): number | null {
  if (!field) return null;
  if (field.status === 'HUMAN_VERIFIED' || field.status === 'HUMAN_MARKED_ABSENT') return 1;
  if (typeof field.confidence === 'number') {
    return Math.min(1, Math.max(0, field.confidence));
  }
  return null;
}

/**
 * How confident we are that a declaration is genuinely absent.
 *
 * Distinct from confidence in a value, and it has to be: not finding something
 * is weak evidence that it is not there. A human marking the field unavailable
 * is conclusive; an explicit `absenceConfidence` is used as given; otherwise we
 * fall back on how completely the package was captured, which is the only
 * signal left and is the right one — a declaration cannot be missing from a
 * face nobody photographed.
 */
export function absenceStrength(field: ExtractedField | undefined, evidence: EvidenceContext | undefined): number {
  if (field?.status === 'HUMAN_MARKED_ABSENT') return 1;
  if (typeof field?.absenceConfidence === 'number') {
    return Math.min(1, Math.max(0, field.absenceConfidence));
  }
  if (typeof evidence?.captureCompleteness === 'number') {
    return Math.min(1, Math.max(0, evidence.captureCompleteness));
  }
  // Nothing said how thoroughly the package was examined. Not enough to
  // support a finding of absence.
  return 0;
}

export function decide(input: DecisionInput): Decision {
  const { validator, field, evidence, thresholds, awaitingFutureEvidence } = input;
  const confidence = effectiveConfidence(field);

  if (validator.outcome === 'SATISFIED') {
    // A read too weak to act on cannot establish compliance either. Saying a
    // package passed on a 0.3-confidence read is the mirror image of failing
    // it on one, and just as indefensible.
    if (confidence !== null && confidence < thresholds.weak) {
      return { status: 'REVIEW_REQUIRED', reasonCode: 'DECLARATION_UNREADABLE', confidence };
    }
    return { status: 'COMPLIANT', reasonCode: 'REQUIREMENT_SATISFIED', confidence };
  }

  if (validator.outcome === 'INDETERMINATE') {
    if (awaitingFutureEvidence) {
      return { status: 'INSUFFICIENT_EVIDENCE', reasonCode: 'MEASUREMENT_NOT_AVAILABLE', confidence };
    }
    if (validator.missingMeasurement) {
      return { status: 'INSUFFICIENT_EVIDENCE', reasonCode: 'MEASUREMENT_NOT_AVAILABLE', confidence };
    }
    if (!field) {
      return { status: 'INSUFFICIENT_EVIDENCE', reasonCode: 'NO_EVIDENCE_SUPPLIED', confidence };
    }
    return { status: 'REVIEW_REQUIRED', reasonCode: 'DECLARATION_UNREADABLE', confidence };
  }

  /* ── NOT_SATISFIED: the only branch that can produce a finding ─────────── */

  const valueWasRead = field?.value !== null && field?.value !== undefined && String(field.value).trim() !== '';

  if (!valueWasRead) {
    // The declaration is absent. Whether that is a violation turns entirely on
    // how good a look we had at the package.
    const strength = absenceStrength(field, evidence);
    const captureSeen = evidence?.captureCompleteness;

    if (typeof captureSeen === 'number' && captureSeen < thresholds.minimumCaptureCompleteness) {
      return { status: 'REVIEW_REQUIRED', reasonCode: 'CAPTURE_INCOMPLETE', confidence };
    }

    if (strength >= thresholds.absenceSufficient) {
      return { status: 'VIOLATION_DETECTED', reasonCode: 'DECLARATION_ABSENT', confidence };
    }

    return { status: 'REVIEW_REQUIRED', reasonCode: 'DECLARATION_ABSENT_LOW_CONFIDENCE', confidence };
  }

  // A value was read and it does not meet the requirement. Whether we act on
  // that depends on whether we trust the read.
  if (confidence !== null && confidence < thresholds.sufficient) {
    return { status: 'REVIEW_REQUIRED', reasonCode: 'FORMAT_NOT_SATISFIED_LOW_CONFIDENCE', confidence };
  }

  if (confidence === null) {
    // No confidence was reported at all. The value is there and wrong, but
    // nothing tells us how reliable the reading is, so this is a question for
    // a person rather than a finding.
    return { status: 'REVIEW_REQUIRED', reasonCode: 'FORMAT_NOT_SATISFIED_LOW_CONFIDENCE', confidence };
  }

  return { status: 'VIOLATION_DETECTED', reasonCode: 'FORMAT_NOT_SATISFIED', confidence };
}

/**
 * The overall verdict.
 *
 * Ordered by what an enforcement officer needs to see first. A single violation
 * outranks any amount of uncertainty elsewhere — a package with one missing
 * mandatory declaration and six unreadable ones is a violation, not a review.
 * Below that, an open question outranks silence.
 *
 * The one subtlety is `MEASUREMENT_NOT_AVAILABLE`. Those checks are pending a
 * capability nothing in this phase has, so *every* package carries three or
 * four of them. Letting them set the headline would make the verdict a
 * constant — every package in the country would come back
 * INSUFFICIENT_EVIDENCE, which tells an inspector nothing about the package and
 * everything about the roadmap. They are counted, warned about, and visible on
 * their own checks; they do not decide.
 *
 * Insufficiency for any *other* reason — nothing was captured, no evidence was
 * supplied — still decides, because that is a fact about this inspection.
 */
export function summarise(
  checks: Array<{ status: CheckStatus; reasonCode: CheckReasonCode }>,
): { decision: ComplianceDecision; summary: ComplianceSummary } {
  const pending = checks.filter((check) => check.reasonCode === 'MEASUREMENT_NOT_AVAILABLE');
  const decisive = checks.filter((check) => check.reasonCode !== 'MEASUREMENT_NOT_AVAILABLE');

  const summary: ComplianceSummary = {
    totalChecks: checks.length,
    compliant: checks.filter((check) => check.status === 'COMPLIANT').length,
    violations: checks.filter((check) => check.status === 'VIOLATION_DETECTED').length,
    reviewRequired: checks.filter((check) => check.status === 'REVIEW_REQUIRED').length,
    notApplicable: checks.filter((check) => check.status === 'NOT_APPLICABLE').length,
    insufficientEvidence: checks.filter((check) => check.status === 'INSUFFICIENT_EVIDENCE').length,
    pendingCapability: pending.length,
  };

  const decisiveInsufficient = decisive.filter((check) => check.status === 'INSUFFICIENT_EVIDENCE').length;
  const decisiveCompliant = decisive.filter((check) => check.status === 'COMPLIANT').length;

  let decision: ComplianceDecision;
  if (summary.violations > 0) decision = 'VIOLATION_DETECTED';
  else if (summary.reviewRequired > 0) decision = 'REVIEW_REQUIRED';
  else if (decisiveInsufficient > 0) decision = 'INSUFFICIENT_EVIDENCE';
  else if (decisiveCompliant > 0) decision = 'COMPLIANT';
  // Nothing was assessed: every rule was out of scope, exempt, or pending a
  // measurement. Calling that COMPLIANT would put a clean verdict on a package
  // no rule ever looked at.
  else if (pending.length > 0) decision = 'INSUFFICIENT_EVIDENCE';
  else decision = 'NOT_APPLICABLE';

  return { decision, summary };
}

/** Merges caller-supplied thresholds over the defaults, clamped to 0–1. */
export function resolveThresholds(
  defaults: ConfidenceThresholds,
  overrides?: Partial<ConfidenceThresholds>,
): ConfidenceThresholds {
  const clamp = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

  return {
    sufficient: clamp(overrides?.sufficient, defaults.sufficient),
    weak: clamp(overrides?.weak, defaults.weak),
    absenceSufficient: clamp(overrides?.absenceSufficient, defaults.absenceSufficient),
    minimumCaptureCompleteness: clamp(overrides?.minimumCaptureCompleteness, defaults.minimumCaptureCompleteness),
  };
}
