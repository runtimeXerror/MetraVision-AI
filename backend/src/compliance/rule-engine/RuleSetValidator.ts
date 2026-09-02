import type { Amendment } from '../types/Amendment';
import type { LegalRule, RuleException } from '../types/Rule';
import type { ConflictSeverity, RuleConflict, RuleSetValidationReport } from '../types/RuleConflict';

import { invalidRegexesIn } from './ConditionEvaluator';
import { toIsoDate } from './VersionResolver';

/**
 * ── VALIDATING THE CORPUS ITSELF ────────────────────────────────────────────
 *
 * Everything here is a check on the rulebook, not on a package.
 *
 * A versioned legal corpus fails quietly. Two versions of rule 6(1)(e) in force
 * on the same day does not throw; it produces confident, wrong verdicts, and it
 * produces them consistently, which is worse than producing them intermittently.
 * The same goes for a version chain with a hole in it, a rule marked ACTIVE
 * whose window closed in 2018, and a substantive requirement whose only source
 * is an unverified secondary summary.
 *
 * So the corpus gets its own test suite, and it runs on demand through
 * `GET /api/rule-validation/report` rather than only in CI — the data changes
 * when a notification is published, which is not when anyone is running tests.
 *
 * Severity is meaningful. ERROR means a package could be judged wrongly today.
 * WARNING means the corpus is incomplete or unverified in a way that matters
 * but does not currently change a verdict. INFO is provenance worth knowing.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ValidateRuleSetInput {
  rules: LegalRule[];
  exceptions: RuleException[];
  amendments: Amendment[];
  /** Recorded disagreements between official documents, merged into the report. */
  sourceConflicts?: RuleConflict[];
  ruleSetVersion: string;
  ruleSetChecksum: string;
  /** The date "future" and "expired" are judged against. Defaults to today. */
  asOf?: string;
  /** Injected so the report is reproducible in tests. */
  now?: Date;
}

function conflict(
  id: string,
  code: RuleConflict['code'],
  severity: ConflictSeverity,
  message: string,
  subjects: string[],
  requiresManualVerification = false,
): RuleConflict {
  return { conflictId: id, origin: 'STRUCTURAL', code, severity, message, subjects, requiresManualVerification };
}

const versionKey = (rule: LegalRule): string => `${rule.ruleId}@${rule.ruleVersion}`;
const exceptionKey = (exception: RuleException): string => `${exception.exceptionId}@${exception.effectiveFrom}`;

/** Half-open windows `[aFrom, aTo)` and `[bFrom, bTo)` share at least one day. */
function windowsOverlap(aFrom: string, aTo: string | null, bFrom: string, bTo: string | null): boolean {
  const aEnd = aTo ?? '9999-12-31';
  const bEnd = bTo ?? '9999-12-31';
  return aFrom < bEnd && bFrom < aEnd;
}

export function validateRuleSet(input: ValidateRuleSetInput): RuleSetValidationReport {
  const { rules, exceptions, amendments } = input;
  const now = input.now ?? new Date();
  const asOf = toIsoDate(input.asOf ?? now.toISOString());
  const conflicts: RuleConflict[] = [];
  let counter = 0;
  const nextId = (): string => `STRUCT-${String(++counter).padStart(3, '0')}`;

  /* ── Per-record checks ────────────────────────────────────────────────── */

  const seenVersions = new Set<string>();

  for (const rule of rules) {
    const key = versionKey(rule);

    if (seenVersions.has(key)) {
      conflicts.push(
        conflict(
          nextId(),
          'DUPLICATE_RULE_VERSION',
          'ERROR',
          `Two records share the version key ${key}. Version resolution would pick between them arbitrarily.`,
          [key],
        ),
      );
    }
    seenVersions.add(key);

    if (!rule.effectiveFrom) {
      conflicts.push(conflict(nextId(), 'MISSING_EFFECTIVE_FROM', 'ERROR', `${key} has no effectiveFrom and can never be resolved.`, [key]));
    }

    if (rule.effectiveTo !== null && rule.effectiveFrom && toIsoDate(rule.effectiveTo) <= toIsoDate(rule.effectiveFrom)) {
      conflicts.push(
        conflict(
          nextId(),
          'IMPOSSIBLE_DATE_RANGE',
          'ERROR',
          `${key} ends on ${rule.effectiveTo}, on or before it begins on ${rule.effectiveFrom}. It is in force on no day at all.`,
          [key],
        ),
      );
    }

    if (rule.status === 'ACTIVE' && rule.effectiveTo !== null && toIsoDate(rule.effectiveTo) <= asOf) {
      conflicts.push(
        conflict(
          nextId(),
          'SUPERSEDED_RULE_STILL_ACTIVE',
          'ERROR',
          `${key} is marked ACTIVE but its window closed on ${rule.effectiveTo}. Resolution goes by date, so this is a mislabelled record rather than a wrong verdict — but the label is wrong.`,
          [key],
        ),
      );
    }

    if (rule.status === 'ACTIVE' && toIsoDate(rule.effectiveFrom) > asOf) {
      conflicts.push(
        conflict(
          nextId(),
          'FUTURE_RULE_MARKED_ACTIVE',
          'WARNING',
          `${key} is marked ACTIVE but does not come into force until ${rule.effectiveFrom}. It is correctly excluded from evaluations before that date; the status is forward-looking, not current.`,
          [key],
        ),
      );
    }

    if (!rule.source.officialUrl) {
      conflicts.push(
        conflict(
          nextId(),
          'MISSING_SOURCE_URL',
          rule.source.verificationStatus === 'VERIFIED' ? 'ERROR' : 'WARNING',
          `${key} cites ${rule.source.notification} but carries no official source URL.`,
          [key, rule.source.notification],
          true,
        ),
      );
    }

    if (!rule.source.notificationDate) {
      conflicts.push(conflict(nextId(), 'MISSING_NOTIFICATION_DATE', 'ERROR', `${key} cites ${rule.source.notification} with no notification date.`, [key]));
    }

    if (rule.source.verificationStatus !== 'VERIFIED' && rule.category !== 'PROCEDURAL' && rule.category !== 'REGISTRATION') {
      conflicts.push(
        conflict(
          nextId(),
          'UNVERIFIED_SUBSTANTIVE_RULE',
          'WARNING',
          `${key} states a substantive requirement but its source ${rule.source.notification} is ${rule.source.verificationStatus}.`,
          [key, rule.source.notification],
          true,
        ),
      );
    }

    // A rule naming an exception that does not exist would silently never be
    // exempted — the failure is invisible at evaluation time.
    for (const exceptionId of rule.exceptions) {
      if (!exceptions.some((entry) => entry.exceptionId === exceptionId)) {
        conflicts.push(
          conflict(nextId(), 'UNKNOWN_EXCEPTION_REFERENCE', 'ERROR', `${key} names exception ${exceptionId}, which is not in the corpus.`, [key, exceptionId]),
        );
      }
    }

    const badRegexes = [...invalidRegexesIn(rule.applicability), ...(rule.conditions ? invalidRegexesIn(rule.conditions) : [])];
    for (const pattern of badRegexes) {
      conflicts.push(
        conflict(nextId(), 'CONTRADICTORY_EXCEPTIONS', 'ERROR', `${key} carries a condition regex that will not compile: /${pattern}/.`, [key]),
      );
    }

    if (rule.supersedes && !rules.some((entry) => entry.ruleId === rule.ruleId && entry.ruleVersion === rule.supersedes)) {
      conflicts.push(
        conflict(nextId(), 'DANGLING_SUPERSEDES', 'ERROR', `${key} says it supersedes version ${rule.supersedes}, which does not exist.`, [key]),
      );
    }
    if (rule.supersededBy && !rules.some((entry) => entry.ruleId === rule.ruleId && entry.ruleVersion === rule.supersededBy)) {
      conflicts.push(
        conflict(nextId(), 'DANGLING_SUPERSEDED_BY', 'ERROR', `${key} says it is superseded by version ${rule.supersededBy}, which does not exist.`, [key]),
      );
    }

    if (!amendments.some((entry) => entry.notificationNumber === rule.source.notification)) {
      conflicts.push(
        conflict(
          nextId(),
          'RULE_WITHOUT_AMENDMENT_RECORD',
          'ERROR',
          `${key} cites ${rule.source.notification}, which has no entry in the amendment registry.`,
          [key, rule.source.notification],
        ),
      );
    }
  }

  /* ── Per-rule chain checks ────────────────────────────────────────────── */

  const byRuleId = new Map<string, LegalRule[]>();
  for (const rule of rules) {
    byRuleId.set(rule.ruleId, [...(byRuleId.get(rule.ruleId) ?? []), rule]);
  }

  for (const [ruleId, versions] of byRuleId) {
    const ordered = [...versions].sort((a, b) => toIsoDate(a.effectiveFrom).localeCompare(toIsoDate(b.effectiveFrom)));

    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        if (!a || !b) continue;
        if (a.status === 'DRAFT' || b.status === 'DRAFT') continue;

        if (windowsOverlap(toIsoDate(a.effectiveFrom), a.effectiveTo && toIsoDate(a.effectiveTo), toIsoDate(b.effectiveFrom), b.effectiveTo && toIsoDate(b.effectiveTo))) {
          conflicts.push(
            conflict(
              nextId(),
              'OVERLAPPING_ACTIVE_VERSIONS',
              'ERROR',
              `${versionKey(a)} and ${versionKey(b)} are both in force between ${
                toIsoDate(a.effectiveFrom) > toIsoDate(b.effectiveFrom) ? a.effectiveFrom : b.effectiveFrom
              } and the earlier of their end dates. Exactly one version of a rule may be in force on any day.`,
              [versionKey(a), versionKey(b)],
            ),
          );
        }
      }
    }

    // A hole in the chain: version A ends before version B begins, so for the
    // days in between the requirement simply does not exist in the corpus.
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = ordered[i];
      const next = ordered[i + 1];
      if (!current || !next) continue;
      if (current.effectiveTo === null) continue;

      if (toIsoDate(current.effectiveTo) < toIsoDate(next.effectiveFrom)) {
        conflicts.push(
          conflict(
            nextId(),
            'GAP_BETWEEN_VERSIONS',
            'WARNING',
            `${ruleId} has no version in force between ${current.effectiveTo} and ${next.effectiveFrom}. An inspection dated in that window would find no rule — which may be correct if the provision was genuinely absent, and is a defect otherwise.`,
            [versionKey(current), versionKey(next)],
            true,
          ),
        );
      }
    }
  }

  /* ── Exceptions ───────────────────────────────────────────────────────── */

  const seenExceptions = new Set<string>();
  const byExceptionId = new Map<string, RuleException[]>();

  for (const exception of exceptions) {
    const key = exceptionKey(exception);
    if (seenExceptions.has(key)) {
      conflicts.push(conflict(nextId(), 'DUPLICATE_RULE_VERSION', 'ERROR', `Two exception records share the key ${key}.`, [key]));
    }
    seenExceptions.add(key);
    byExceptionId.set(exception.exceptionId, [...(byExceptionId.get(exception.exceptionId) ?? []), exception]);

    if (exception.effectiveTo !== null && toIsoDate(exception.effectiveTo) <= toIsoDate(exception.effectiveFrom)) {
      conflicts.push(conflict(nextId(), 'IMPOSSIBLE_DATE_RANGE', 'ERROR', `${key} ends on or before it begins.`, [key]));
    }

    if (exception.effect === 'PARTIAL_EXEMPTION' && (exception.survivingRequirements?.length ?? 0) === 0) {
      conflicts.push(
        conflict(
          nextId(),
          'CONTRADICTORY_EXCEPTIONS',
          'ERROR',
          `${key} is a PARTIAL_EXEMPTION with no surviving requirements, which makes it indistinguishable from a full exemption while claiming not to be.`,
          [key],
        ),
      );
    }

    if (exception.effect === 'DEFER_TO_OTHER_REGULATION' && !exception.deferTo) {
      conflicts.push(conflict(nextId(), 'CONTRADICTORY_EXCEPTIONS', 'ERROR', `${key} defers to another regulation without naming it.`, [key]));
    }

    for (const ruleId of exception.survivingRequirements ?? []) {
      if (!byRuleId.has(ruleId)) {
        conflicts.push(
          conflict(nextId(), 'UNKNOWN_EXCEPTION_REFERENCE', 'ERROR', `${key} names ${ruleId} as a surviving requirement, but no such rule exists.`, [key, ruleId]),
        );
      }
    }

    for (const ruleId of exception.ruleIds) {
      if (!byRuleId.has(ruleId)) {
        conflicts.push(conflict(nextId(), 'UNKNOWN_EXCEPTION_REFERENCE', 'ERROR', `${key} targets ${ruleId}, which is not in the corpus.`, [key, ruleId]));
      }
    }

    if (!amendments.some((entry) => entry.notificationNumber === exception.source.notification)) {
      conflicts.push(
        conflict(nextId(), 'RULE_WITHOUT_AMENDMENT_RECORD', 'ERROR', `${key} cites ${exception.source.notification}, which is not in the amendment registry.`, [key]),
      );
    }

    /**
     * Supersession references, in the `EX-ID@YYYY-MM-DD` form the data files
     * use. A dangling one means an exemption claims to replace a text that is
     * not in the corpus, so the history it asserts cannot be read back — which
     * is exactly the claim the corpus exists to support.
     *
     * A reference to a *different* exceptionId is legitimate and not flagged:
     * rule 26(d)'s farm-produce exemption was genuinely carried into rule 3 as
     * a different record when the clause was omitted.
     */
    for (const [field, reference] of [
      ['supersedes', exception.supersedes],
      ['supersededBy', exception.supersededBy],
    ] as const) {
      if (!reference) continue;
      if (exceptions.some((entry) => exceptionKey(entry) === reference)) continue;

      const [referencedId] = reference.split('@');
      conflicts.push(
        conflict(
          nextId(),
          field === 'supersedes' ? 'DANGLING_SUPERSEDES' : 'DANGLING_SUPERSEDED_BY',
          'ERROR',
          `${key} names ${reference} as its ${field}, but no exemption version with that key exists${
            referencedId && byExceptionId.has(referencedId) ? ' — the id is known but not at that date.' : '.'
          }`,
          [key, reference],
        ),
      );
    }
  }

  for (const [exceptionId, versions] of byExceptionId) {
    const ordered = [...versions].sort((a, b) => toIsoDate(a.effectiveFrom).localeCompare(toIsoDate(b.effectiveFrom)));
    for (let i = 0; i < ordered.length; i += 1) {
      for (let j = i + 1; j < ordered.length; j += 1) {
        const a = ordered[i];
        const b = ordered[j];
        if (!a || !b) continue;
        if (windowsOverlap(toIsoDate(a.effectiveFrom), a.effectiveTo && toIsoDate(a.effectiveTo), toIsoDate(b.effectiveFrom), b.effectiveTo && toIsoDate(b.effectiveTo))) {
          conflicts.push(
            conflict(
              nextId(),
              'CONTRADICTORY_EXCEPTIONS',
              'ERROR',
              `Exception ${exceptionId} has two versions in force at once (${a.effectiveFrom} and ${b.effectiveFrom}). One package would be exempt under two different texts.`,
              [exceptionKey(a), exceptionKey(b)],
            ),
          );
        }
      }
    }
  }

  /* ── The amendment registry ───────────────────────────────────────────── */

  const seenNotifications = new Set<string>();
  for (const amendment of amendments) {
    if (seenNotifications.has(amendment.notificationNumber)) {
      conflicts.push(
        conflict(nextId(), 'DUPLICATE_NOTIFICATION', 'ERROR', `${amendment.notificationNumber} appears twice in the amendment registry.`, [amendment.notificationNumber]),
      );
    }
    seenNotifications.add(amendment.notificationNumber);

    if (!amendment.notificationDate) {
      conflicts.push(conflict(nextId(), 'MISSING_NOTIFICATION_DATE', 'ERROR', `${amendment.notificationNumber} has no notification date.`, [amendment.notificationNumber]));
    }

    if (!amendment.officialSourceUrl) {
      conflicts.push(
        conflict(
          nextId(),
          'MISSING_SOURCE_URL',
          amendment.verified ? 'ERROR' : 'WARNING',
          `${amendment.notificationNumber} has no official source URL${amendment.verificationNote ? ' — see its verification note.' : '.'}`,
          [amendment.notificationNumber],
          true,
        ),
      );
    }

    // The linked list. A notification whose predecessor is absent means the
    // registry has a hole, and a hole is an amendment nobody knows about.
    if (amendment.citesPreviousNotification && !seenNotifications.has(amendment.citesPreviousNotification)) {
      const known = amendments.some((entry) => entry.notificationNumber === amendment.citesPreviousNotification);
      if (!known) {
        conflicts.push(
          conflict(
            nextId(),
            'AMENDMENT_CHAIN_BREAK',
            'ERROR',
            `${amendment.notificationNumber} cites ${amendment.citesPreviousNotification} as the previous amendment, but that notification is not in the registry. An amendment is missing.`,
            [amendment.notificationNumber, amendment.citesPreviousNotification],
            true,
          ),
        );
      }
    }

    for (const correction of amendment.correctedBy ?? []) {
      if (!amendments.some((entry) => entry.notificationNumber === correction)) {
        conflicts.push(
          conflict(nextId(), 'AMENDMENT_CHAIN_BREAK', 'WARNING', `${amendment.notificationNumber} names corrigendum ${correction}, which is not in the registry.`, [
            amendment.notificationNumber,
            correction,
          ]),
        );
      }
    }
  }

  const all = [...conflicts, ...(input.sourceConflicts ?? [])];

  const counts = {
    rules: rules.length,
    exceptions: exceptions.length,
    amendments: amendments.length,
    errors: all.filter((entry) => entry.severity === 'ERROR').length,
    warnings: all.filter((entry) => entry.severity === 'WARNING').length,
    info: all.filter((entry) => entry.severity === 'INFO').length,
  };

  return {
    ruleSetVersion: input.ruleSetVersion,
    ruleSetChecksum: input.ruleSetChecksum,
    generatedAt: now.toISOString(),
    // Only structural errors invalidate the corpus. A recorded disagreement
    // between two Gazette notifications is not something this system can fix,
    // and refusing to run until the Government reissues a notification would
    // be a strange definition of "valid".
    valid: conflicts.filter((entry) => entry.severity === 'ERROR').length === 0,
    counts,
    conflicts: all,
  };
}
