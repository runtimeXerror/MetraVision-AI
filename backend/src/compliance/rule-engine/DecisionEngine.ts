import type { CheckReasonCode, CheckStatus, ComplianceDecision, ComplianceSummary } from '../types/ComplianceResult';
import type { ExtractedField } from '../types/Evidence';
import type { ValidatorResult } from '../validators/types';

/**
 * ── FROM "WHAT THE VALIDATOR FOUND" TO "WHAT THE RECORD SAYS" ───────────────
 *
 * The validators answer a question about a value. This turns that answer into
 * one of two positions on the check — the requirement is met, or it is not —
 * and nothing in between.
 *
 *     validator SATISFIED      → COMPLIANT
 *     validator NOT_SATISFIED  → VIOLATION_DETECTED
 *
 * There is no confidence gate and no capture-completeness gate. Both used to
 * route a doubtful reading to a "review required" state, and that state was
 * doing work nobody needed done: the inspector who finalizes the record looks
 * at every declaration anyway, and a package that came back "review required"
 * on six of eight declarations told them nothing they could act on. A
 * declaration the reading did not find is recorded as not declared, with the
 * rule it fails, and the inspector confirms or corrects it against the package
 * in their hand. Their correction re-runs the engine on the corrected value.
 *
 * `INDETERMINATE` survives for exactly one reason — a rule that turns on a
 * physical measurement no photograph can supply — and `RuleEngine` never lets
 * such a rule reach this function. Anything else a validator could not decide
 * has been settled inside the validator, in favour of the trader where a value
 * was read and against the package where nothing was.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface DecisionInput {
  validator: ValidatorResult;
  field?: ExtractedField;
}

export interface Decision {
  status: CheckStatus;
  reasonCode: CheckReasonCode;
  /** The reader's confidence in the observation, where it gave one. Informational. */
  confidence: number | null;
}

/**
 * The confidence carried on the check.
 *
 * A human verification is recorded as 1: an inspector who has looked at the
 * package and recorded what it says is not a 0.94 probability. Otherwise the
 * reader's own figure, or `null` when it gave none. Never consulted by
 * `decide` — it is printed beside the finding, not weighed against it.
 */
export function effectiveConfidence(field: ExtractedField | undefined): number | null {
  if (!field) return null;
  if (field.status === 'HUMAN_VERIFIED' || field.status === 'HUMAN_MARKED_ABSENT') return 1;
  if (typeof field.confidence === 'number') {
    return Math.min(1, Math.max(0, field.confidence));
  }
  return null;
}

export function decide(input: DecisionInput): Decision {
  const { validator, field } = input;
  const confidence = effectiveConfidence(field);

  if (validator.outcome === 'SATISFIED') {
    return { status: 'COMPLIANT', reasonCode: 'REQUIREMENT_SATISFIED', confidence };
  }

  if (validator.outcome === 'INDETERMINATE') {
    // Only a measurement rule can still say this, and `RuleEngine` filters
    // those out before evaluation. Reaching here is a corpus or validator
    // defect, and the safe reading of a defect is the one that accuses nobody.
    return { status: 'COMPLIANT', reasonCode: 'REQUIREMENT_SATISFIED', confidence };
  }

  /* ── NOT_SATISFIED ────────────────────────────────────────────────────── */

  const valueWasRead = field?.value !== null && field?.value !== undefined && String(field.value).trim() !== '';

  if (!valueWasRead) {
    return {
      status: 'VIOLATION_DETECTED',
      reasonCode: field?.status === 'UNREADABLE' ? 'DECLARATION_UNREADABLE' : 'DECLARATION_ABSENT',
      confidence,
    };
  }

  return { status: 'VIOLATION_DETECTED', reasonCode: 'FORMAT_NOT_SATISFIED', confidence };
}

/**
 * The overall verdict.
 *
 * One violation makes the package non-compliant, whatever else passed. With no
 * violation, one compliant check makes it compliant. With neither — every rule
 * out of scope, exempt, or waiting on a measurement — nothing was assessed,
 * and the verdict says so rather than putting a clean bill on a package no
 * rule looked at.
 */
export function summarise(
  checks: Array<{ status: CheckStatus; reasonCode: CheckReasonCode }>,
  pendingCapability = 0,
): { decision: ComplianceDecision; summary: ComplianceSummary } {
  const summary: ComplianceSummary = {
    totalChecks: checks.length,
    compliant: checks.filter((check) => check.status === 'COMPLIANT').length,
    violations: checks.filter((check) => check.status === 'VIOLATION_DETECTED').length,
    notApplicable: checks.filter((check) => check.status === 'NOT_APPLICABLE').length,
    pendingCapability,
  };

  let decision: ComplianceDecision;
  if (summary.violations > 0) decision = 'VIOLATION_DETECTED';
  else if (summary.compliant > 0) decision = 'COMPLIANT';
  else decision = 'NOT_APPLICABLE';

  return { decision, summary };
}
