import type { LegalRule, RuleException, RuleTemporalStatus } from '../types/Rule';

/**
 * ── DATE-AWARE VERSION RESOLUTION ───────────────────────────────────────────
 *
 * The single place that decides which text of a rule was the law on a given
 * day. Everything else in the engine treats its answer as settled.
 *
 * The window is half-open — `effectiveFrom <= date < effectiveTo` — which is
 * what makes a chain of versions tile the timeline without overlapping. The
 * day a new version takes effect is the day the old one stops: G.S.R. 881(E)
 * comes into force on 1 February 2026, so 31 January 2026 gets the old rule 26
 * and 1 February 2026 gets the new one, with no day belonging to both and no
 * day belonging to neither.
 *
 * Dates are compared as ISO date strings, not as `Date` objects. A gazette
 * commencement is a calendar date in India, not an instant; parsing
 * "2026-02-01" into a Date makes it midnight UTC, which is 05:30 on 1 February
 * in Delhi — so an inspection recorded at 02:00 IST on the 1st would resolve to
 * the *previous* version. Lexicographic comparison of `YYYY-MM-DD` strings has
 * no timezone to get wrong.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Extracts `YYYY-MM-DD` from an ISO date or date-time, rejecting anything else. */
export function toIsoDate(value: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
  if (!match?.[1]) {
    throw new Error(`Not an ISO date: "${value}". Expected YYYY-MM-DD or a full ISO timestamp.`);
  }
  return match[1];
}

/** True when `date` falls in the half-open window `[from, to)`. */
export function isInForceOn(from: string, to: string | null, date: string): boolean {
  const day = toIsoDate(date);
  if (toIsoDate(from) > day) return false;
  if (to !== null && toIsoDate(to) <= day) return false;
  return true;
}

/** Where a record stands relative to a date, without consulting its stored status. */
export function temporalStatusOf(
  record: { effectiveFrom: string; effectiveTo: string | null; status: string },
  date: string,
): RuleTemporalStatus {
  if (record.status === 'DRAFT') return 'NOT_LAW';
  const day = toIsoDate(date);
  if (toIsoDate(record.effectiveFrom) > day) return 'FUTURE_EFFECTIVE';
  if (record.effectiveTo !== null && toIsoDate(record.effectiveTo) <= day) return 'EXPIRED';
  return 'IN_FORCE';
}

/**
 * The version of each rule that was in force on `date`.
 *
 * Note what is *not* consulted: `status`. A record marked ACTIVE whose window
 * closed last year is not selected, and a record marked SUPERSEDED whose window
 * covers the date is. Deciding on dates alone is what stops a stale status
 * field from quietly changing a verdict — and `RuleSetValidator` reports the
 * disagreement rather than the engine papering over it.
 *
 * The one exception is DRAFT, which is not law at all and is never selected.
 */
export function resolveRuleVersions(rules: LegalRule[], date: string): LegalRule[] {
  const day = toIsoDate(date);
  const selected = new Map<string, LegalRule>();

  for (const rule of rules) {
    if (rule.status === 'DRAFT') continue;
    if (!isInForceOn(rule.effectiveFrom, rule.effectiveTo, day)) continue;

    const existing = selected.get(rule.ruleId);
    if (!existing) {
      selected.set(rule.ruleId, rule);
      continue;
    }

    // Two versions in force on the same day is a corpus defect that
    // RuleSetValidator reports as OVERLAPPING_ACTIVE_VERSIONS. Until it is
    // fixed, take the one that came into force later: it is the more recent
    // statement of the law, and picking arbitrarily would make the engine
    // non-deterministic, which is worse than picking wrongly.
    if (toIsoDate(rule.effectiveFrom) > toIsoDate(existing.effectiveFrom)) {
      selected.set(rule.ruleId, rule);
    }
  }

  // Sorted so the engine's output order never depends on input order.
  return [...selected.values()].sort((a, b) => a.ruleId.localeCompare(b.ruleId));
}

/** The same resolution, for exceptions. */
export function resolveExceptionVersions(exceptions: RuleException[], date: string): RuleException[] {
  const day = toIsoDate(date);
  const selected = new Map<string, RuleException>();

  for (const exception of exceptions) {
    if (exception.status === 'DRAFT') continue;
    if (!isInForceOn(exception.effectiveFrom, exception.effectiveTo, day)) continue;

    const existing = selected.get(exception.exceptionId);
    if (!existing || toIsoDate(exception.effectiveFrom) > toIsoDate(existing.effectiveFrom)) {
      selected.set(exception.exceptionId, exception);
    }
  }

  return [...selected.values()].sort((a, b) => a.exceptionId.localeCompare(b.exceptionId));
}

/** Every version of one rule, oldest first — the amendment history of a requirement. */
export function versionHistory(rules: LegalRule[], ruleId: string): LegalRule[] {
  return rules
    .filter((rule) => rule.ruleId === ruleId)
    .sort((a, b) => toIsoDate(a.effectiveFrom).localeCompare(toIsoDate(b.effectiveFrom)));
}

/** Rules whose first version has not yet come into force on `date`. */
export function futureEffectiveRules(rules: LegalRule[], date: string): LegalRule[] {
  const day = toIsoDate(date);
  return rules
    .filter((rule) => rule.status !== 'DRAFT' && toIsoDate(rule.effectiveFrom) > day)
    .sort((a, b) => toIsoDate(a.effectiveFrom).localeCompare(toIsoDate(b.effectiveFrom)));
}
