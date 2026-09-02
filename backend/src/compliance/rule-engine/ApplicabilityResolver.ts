import type { ComplianceEvaluationRequest } from '../types/Evidence';
import type { LegalRule } from '../types/Rule';

import { evaluateCondition, type EvaluationContext } from './ConditionEvaluator';

/**
 * ── WHICH RULES REACH THIS PACKAGE ──────────────────────────────────────────
 *
 * Runs before any validation, and answers the question the prompt puts first:
 * which rules apply here?
 *
 * The alternative — running every rule against every package and letting the
 * validators sort it out — produces a result sheet in which a jar of jam has
 * been checked against the country-of-origin rule for imported goods and
 * "passed", which is not what passing means. A rule that does not reach a
 * package cannot be satisfied by it, and saying otherwise is a category error
 * that gets baked into every downstream count and chart.
 *
 * So an out-of-scope rule is reported as NOT_APPLICABLE, with the reason, and
 * is excluded from the compliance score.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ApplicabilityDecision {
  rule: LegalRule;
  applicable: boolean;
}

/**
 * The object conditions are evaluated against.
 *
 * Deliberately shallow and explicit. `productContext.*` for what the package
 * is, `fields.*` for what was read off it, `evidence.*` for how well it was
 * captured. A condition can name nothing else, which means reading a rule tells
 * you exactly what it depends on.
 */
export function buildEvaluationContext(request: ComplianceEvaluationRequest): EvaluationContext {
  const fields: Record<string, unknown> = {};

  for (const [name, field] of Object.entries(request.fields)) {
    // Conditions ask "was this declared?", so a field present in the payload
    // but carrying no value must read as absent. Exposing the raw object would
    // make `{ op: 'exists', path: 'fields.mrp' }` true for a field the
    // extraction stage explicitly reported as not found.
    fields[name] = field.value ?? null;
  }

  return {
    inspectionDate: request.inspectionDate,
    productContext: { ...request.productContext },
    fields,
    evidence: { ...(request.evidence ?? {}) },
  };
}

/** Evaluates each rule's `applicability` — and its `conditions`, where it has them. */
export function resolveApplicability(rules: LegalRule[], context: EvaluationContext): ApplicabilityDecision[] {
  return rules.map((rule) => {
    if (!evaluateCondition(rule.applicability, context)) {
      return { rule, applicable: false };
    }
    if (rule.conditions && !evaluateCondition(rule.conditions, context)) {
      return { rule, applicable: false };
    }
    return { rule, applicable: true };
  });
}
