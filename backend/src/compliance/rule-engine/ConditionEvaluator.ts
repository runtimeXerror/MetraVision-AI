import type { ConditionValue, RuleCondition } from '../types/Rule';

/**
 * ── THE CONDITION EVALUATOR ─────────────────────────────────────────────────
 *
 * Walks a `RuleCondition` tree against an evaluation context and returns a
 * boolean. That is the whole job, and the constraint on how it does it is the
 * interesting part.
 *
 * Rule conditions are stored in a database and are, from this code's point of
 * view, untrusted input. So there is no expression language here, no
 * `new Function`, no `eval`, and no way for a condition to name anything but a
 * property path. The worst a malformed or hostile condition can do is evaluate
 * to `false`.
 *
 * Two details that look like paranoia and are not:
 *
 *   - Path traversal refuses `__proto__`, `constructor` and `prototype`. A
 *     condition of `{ op: 'exists', path: 'constructor.prototype' }` would
 *     otherwise be true for every context, which is a quiet way to make a rule
 *     apply to everything.
 *   - Regexes are compiled with the `g` flag stripped. A global regex carries
 *     `lastIndex` between calls, so the same rule against the same value would
 *     alternate between matching and not matching. In an engine whose whole
 *     promise is determinism, that is not a subtle bug.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Anything a condition may be evaluated against. */
export type EvaluationContext = Record<string, unknown>;

const FORBIDDEN_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Reads a dotted path out of the context.
 *
 * Returns `undefined` for a missing path and for any path that tries to walk
 * into the prototype chain — the two are deliberately indistinguishable to the
 * caller, so a blocked path behaves exactly like an absent one.
 */
export function resolvePath(context: EvaluationContext, path: string): unknown {
  if (path.length === 0) return undefined;

  let current: unknown = context;

  for (const segment of path.split('.')) {
    if (segment.length === 0 || FORBIDDEN_PATH_SEGMENTS.has(segment)) return undefined;
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

/** `undefined`, `null` and `''` all count as absent. A blank declaration is no declaration. */
function isAbsent(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

function compileRegex(pattern: string, flags?: string): RegExp | null {
  try {
    // `g` and `y` are stateful across calls; strip them so evaluation is pure.
    const safeFlags = (flags ?? '').replace(/[gy]/g, '');
    return new RegExp(pattern, safeFlags);
  } catch {
    // A rule with an uncompilable pattern must not take the whole evaluation
    // down. It simply never matches, and RuleSetValidator reports it.
    return null;
  }
}

/** Loose equality across the scalar types a condition may carry. */
function scalarEquals(observed: unknown, expected: ConditionValue): boolean {
  if (expected === null) return observed === null || observed === undefined;
  if (typeof observed === typeof expected) return observed === expected;

  // A context value read from JSON may be a string where the rule says number,
  // or vice versa. Compare as strings rather than silently failing to match.
  if (
    (typeof observed === 'string' || typeof observed === 'number' || typeof observed === 'boolean') &&
    (typeof expected === 'string' || typeof expected === 'number' || typeof expected === 'boolean')
  ) {
    return String(observed).toLowerCase() === String(expected).toLowerCase();
  }

  return false;
}

/** `null` when the value is not usable as a number — never `NaN`, which compares false everywhere. */
function asNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function evaluateCondition(condition: RuleCondition, context: EvaluationContext): boolean {
  switch (condition.op) {
    case 'always':
      return true;
    case 'never':
      return false;

    case 'all':
      return condition.conditions.every((child) => evaluateCondition(child, context));
    case 'any':
      return condition.conditions.some((child) => evaluateCondition(child, context));
    case 'not':
      return !evaluateCondition(condition.condition, context);

    case 'exists':
      return !isAbsent(resolvePath(context, condition.path));
    case 'notExists':
      return isAbsent(resolvePath(context, condition.path));

    case 'equals':
      return scalarEquals(resolvePath(context, condition.path), condition.value);
    case 'notEquals':
      return !scalarEquals(resolvePath(context, condition.path), condition.value);

    case 'contains': {
      const observed = resolvePath(context, condition.path);
      if (Array.isArray(observed)) {
        return observed.some((entry) => scalarEquals(entry, condition.value));
      }
      if (typeof observed !== 'string' || condition.value === null) return false;
      return observed.toLowerCase().includes(String(condition.value).toLowerCase());
    }

    case 'in':
      return condition.values.some((candidate) => scalarEquals(resolvePath(context, condition.path), candidate));
    case 'notIn':
      return !condition.values.some((candidate) => scalarEquals(resolvePath(context, condition.path), candidate));

    case 'greaterThan':
    case 'lessThan':
    case 'greaterThanOrEqual':
    case 'lessThanOrEqual': {
      const observed = asNumber(resolvePath(context, condition.path));
      const expected = asNumber(condition.value);
      // A comparison against something that is not a number is false, not an
      // error. An exemption keyed on quantity must not fire on a package whose
      // quantity was never read.
      if (observed === null || expected === null) return false;

      if (condition.op === 'greaterThan') return observed > expected;
      if (condition.op === 'lessThan') return observed < expected;
      if (condition.op === 'greaterThanOrEqual') return observed >= expected;
      return observed <= expected;
    }

    case 'regex': {
      const observed = resolvePath(context, condition.path);
      if (typeof observed !== 'string' || condition.value === null) return false;
      const regex = compileRegex(String(condition.value));
      return regex ? regex.test(observed) : false;
    }

    default: {
      // Exhaustiveness: adding an operator to the union without handling it
      // here is a compile error rather than a silent `false` at runtime.
      const exhaustive: never = condition;
      void exhaustive;
      return false;
    }
  }
}

/**
 * Collects every property path a condition reads.
 *
 * Used by `RuleSetValidator` to report conditions that depend on context the
 * request never supplies — a rule that can never fire is as much a defect as
 * one that always does, and far harder to notice.
 */
export function conditionPaths(condition: RuleCondition): string[] {
  switch (condition.op) {
    case 'always':
    case 'never':
      return [];
    case 'all':
    case 'any':
      return condition.conditions.flatMap(conditionPaths);
    case 'not':
      return conditionPaths(condition.condition);
    default:
      return [condition.path];
  }
}

/** Every regex a condition would compile, for validation. Invalid ones are reported. */
export function invalidRegexesIn(condition: RuleCondition): string[] {
  if (condition.op === 'all' || condition.op === 'any') {
    return condition.conditions.flatMap(invalidRegexesIn);
  }
  if (condition.op === 'not') return invalidRegexesIn(condition.condition);
  if (condition.op === 'regex' && condition.value !== null) {
    return compileRegex(String(condition.value)) ? [] : [String(condition.value)];
  }
  return [];
}
