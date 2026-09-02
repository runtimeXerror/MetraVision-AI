import type { Amendment } from '../types/Amendment';
import type { LegalRule, RuleException, RuleSetMetadata } from '../types/Rule';
import type { RuleConflict } from '../types/RuleConflict';
import { AMENDMENTS } from '../data/amendments';
import { SOURCE_CONFLICTS } from '../data/conflicts';
import { RULE_EXCEPTIONS } from '../data/exceptions';
import { RULE_VERSIONS } from '../data/ruleVersions';
import { checksumOf, ruleSetVersionFrom, type RuleSet } from '../rule-engine/RuleEngine';

/**
 * ── WHERE THE CORPUS COMES FROM ─────────────────────────────────────────────
 *
 * The canonical corpus lives in `src/compliance/data/*.ts` — in the repository,
 * under review, with the reasoning next to the records. Not in the database.
 *
 * That is a deliberate inversion of the usual arrangement, and the reason is
 * that legal data is not application data. A rule version is only trustworthy
 * if someone read the Gazette and wrote it down, and that act should leave a
 * diff, a reviewer and a commit message behind. A row someone typed into a
 * collection at 2 a.m. leaves none of those.
 *
 * The database copy is a *projection*: seeded from these files, queried by the
 * dashboard, never the origin. `loadRuleSet` prefers it when it is populated
 * and current, and falls back to the built-in corpus otherwise, so the engine
 * runs correctly with no database at all — which is what makes it testable as a
 * pure function.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface LoadedCorpus extends RuleSet {
  amendments: Amendment[];
  sourceConflicts: RuleConflict[];
}

/** The date of the most recent notification the corpus knows about. */
export function latestNotificationDate(amendments: Amendment[]): string {
  return amendments.reduce((latest, amendment) => (amendment.notificationDate > latest ? amendment.notificationDate : latest), '1900-01-01');
}

export function buildMetadata(
  rules: LegalRule[],
  exceptions: RuleException[],
  amendments: Amendment[],
  origin: RuleSetMetadata['origin'],
  now: Date = new Date(),
): RuleSetMetadata {
  return {
    ruleSetVersion: ruleSetVersionFrom(latestNotificationDate(amendments)),
    checksum: checksumOf(rules, exceptions),
    origin,
    ruleCount: rules.length,
    exceptionCount: exceptions.length,
    amendmentCount: amendments.length,
    builtAt: now.toISOString(),
  };
}

/**
 * The built-in corpus.
 *
 * Synchronous and dependency-free on purpose: every test in the suite builds
 * one of these, and an engine whose test setup needs a database is an engine
 * whose tests get skipped.
 */
export function builtInCorpus(now?: Date): LoadedCorpus {
  return {
    rules: RULE_VERSIONS,
    exceptions: RULE_EXCEPTIONS,
    amendments: AMENDMENTS,
    sourceConflicts: SOURCE_CONFLICTS,
    metadata: buildMetadata(RULE_VERSIONS, RULE_EXCEPTIONS, AMENDMENTS, 'BUILT_IN', now),
  };
}

/**
 * A corpus assembled from records read out of the database.
 *
 * Kept separate from `builtInCorpus` so the caller decides which to use and the
 * result says which it got — a result whose `origin` is DATABASE and one whose
 * origin is BUILT_IN were produced by different data, and a reader is entitled
 * to know which.
 */
export function corpusFrom(
  rules: LegalRule[],
  exceptions: RuleException[],
  amendments: Amendment[],
  sourceConflicts: RuleConflict[],
  now?: Date,
): LoadedCorpus {
  return {
    rules,
    exceptions,
    amendments,
    sourceConflicts,
    metadata: buildMetadata(rules, exceptions, amendments, 'DATABASE', now),
  };
}
