import type { LegalRule, RuleException } from '../types/Rule';

import { evaluateCondition, type EvaluationContext } from './ConditionEvaluator';

/**
 * ── THE EXCEPTION ENGINE ────────────────────────────────────────────────────
 *
 * Decides, for one rule and one package, whether an exemption switches the
 * rule off — and if so, which one and on what authority.
 *
 * Three effects, and the difference between them matters:
 *
 *   NOT_APPLICABLE             the rule does not reach the package at all
 *   PARTIAL_EXEMPTION          most of the rules fall away, but a named few
 *                              survive and are still checked
 *   DEFER_TO_OTHER_REGULATION  another instrument supplies the requirement
 *
 * The middle one is where a naive implementation goes wrong. Rule 26(f) exempts
 * loose-sold garments — and then requires four declarations anyway. Treating it
 * as a plain exemption drops four live obligations; treating it as no exemption
 * at all raises findings on a dozen that no longer apply. It has to be modelled
 * as what it is.
 *
 * The third is not an exemption either. A medical-device package still has to
 * carry declarations; the Medical Devices Rules, 2017 say how. The engine hands
 * off and records which instrument took over, rather than passing the package.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ExceptionOutcome {
  /** The exception that fired, if any. */
  exception?: RuleException;
  /** True when the rule must not be evaluated at all. */
  suppressed: boolean;
  /** True when another instrument supplies the requirement. */
  deferred: boolean;
  /** The instrument that took over, when `deferred`. */
  deferTo?: string;
}

const NOT_EXCEPTED: ExceptionOutcome = { suppressed: false, deferred: false };

/** Does this exception even cover this rule? */
function coversRule(exception: RuleException, rule: LegalRule): boolean {
  if (exception.ruleIds.length > 0) {
    return exception.ruleIds.includes(rule.ruleId);
  }

  // An empty `ruleIds` means the exception is scoped rather than targeted —
  // rule 26 exempts "these rules", not a numbered list.
  if (exception.scope?.category && exception.scope.category !== rule.category) return false;
  if (exception.scope?.sourceRule && exception.scope.sourceRule !== rule.sourceRule) return false;

  // A rule that names its exceptions is only reached by those it names, plus
  // any whose scope covers it. Without this, an exception scoped to
  // DECLARATION would silently reach a rule that never listed it.
  return rule.exceptions.includes(exception.exceptionId) || exception.scope !== undefined;
}

/**
 * Applies the exceptions in force to one rule.
 *
 * Order of precedence, when more than one fires:
 *
 *   1. DEFER_TO_OTHER_REGULATION — the strongest statement, because it says
 *      this instrument is not the one that answers the question.
 *   2. NOT_APPLICABLE — the rule does not reach the package.
 *   3. PARTIAL_EXEMPTION — falls away only if this rule is not among the
 *      survivors.
 *
 * Deterministic on ties: exceptions arrive sorted by id from
 * `resolveExceptionVersions`, and the first match of the highest-precedence
 * effect wins.
 */
export function resolveExceptionFor(
  rule: LegalRule,
  exceptions: RuleException[],
  context: EvaluationContext,
): ExceptionOutcome {
  const firing = exceptions.filter(
    (exception) => coversRule(exception, rule) && evaluateCondition(exception.condition, context),
  );

  if (firing.length === 0) return NOT_EXCEPTED;

  const deferral = firing.find((exception) => exception.effect === 'DEFER_TO_OTHER_REGULATION');
  if (deferral) {
    return {
      exception: deferral,
      suppressed: true,
      deferred: true,
      deferTo: deferral.deferTo,
    };
  }

  const exemption = firing.find((exception) => exception.effect === 'NOT_APPLICABLE');
  if (exemption) {
    return { exception: exemption, suppressed: true, deferred: false };
  }

  const partial = firing.find((exception) => exception.effect === 'PARTIAL_EXEMPTION');
  if (partial) {
    const survives = partial.survivingRequirements?.includes(rule.ruleId) ?? false;
    // A surviving requirement is still checked — the exception is recorded on
    // the result so the reader can see the rule was reached *through* it.
    return { exception: partial, suppressed: !survives, deferred: false };
  }

  return NOT_EXCEPTED;
}

/**
 * Exceptions that fire on this package regardless of any particular rule.
 *
 * Reported on the result so an inspector can see "this package is exempt under
 * rule 26(a)" as a fact about the package, not only as a reason attached to
 * fourteen separate checks.
 */
export function firingExceptions(exceptions: RuleException[], context: EvaluationContext): RuleException[] {
  return exceptions.filter((exception) => evaluateCondition(exception.condition, context));
}
