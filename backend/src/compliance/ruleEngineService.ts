import mongoose from 'mongoose';

import { Amendment } from '../models/Amendment';
import { ComplianceEvaluation } from '../models/ComplianceEvaluation';
import { LegalRule } from '../models/LegalRule';
import { RuleConflict } from '../models/RuleConflict';
import { RuleException } from '../models/RuleException';

import { builtInCorpus, corpusFrom, type LoadedCorpus } from './repository/RuleSetLoader';
import { evaluate, toAuditRecord, type EvaluateOptions } from './rule-engine/RuleEngine';
import { validateRuleSet } from './rule-engine/RuleSetValidator';
import type { ComplianceEvaluationRequest } from './types/Evidence';
import type { ComplianceResult } from './types/ComplianceResult';
import type { RuleSetValidationReport } from './types/RuleConflict';
import type { Amendment as AmendmentDTO } from './types/Amendment';
import type { LegalRule as LegalRuleDTO, RuleException as RuleExceptionDTO } from './types/Rule';
import type { RuleConflict as RuleConflictDTO } from './types/RuleConflict';

/**
 * ── THE SERVICE SEAM ────────────────────────────────────────────────────────
 *
 * Everything above this line is pure. This is where the impurity lives: loading
 * the corpus, caching it, and writing the audit record.
 *
 * The cache is keyed on nothing and invalidated by hand, which is correct here
 * — the corpus changes when someone deploys a new data file, not while the
 * process is running. A time-based cache would introduce a window in which two
 * requests arriving a second apart could be judged against different law, which
 * is exactly the non-determinism the engine exists to avoid.
 * ────────────────────────────────────────────────────────────────────────────
 */

let cached: LoadedCorpus | undefined;

function databaseReady(): boolean {
  return mongoose.connection.readyState === 1;
}

/**
 * Loads the corpus, preferring the database projection and falling back to the
 * built-in data.
 *
 * The fallback is not a degraded mode. The built-in corpus *is* the canonical
 * one; the database holds a copy for querying. Falling back means the engine
 * keeps working before the seeder has run, which is what lets the API answer
 * correctly on a cold boot instead of returning an empty rulebook and calling
 * every package compliant.
 */
export async function loadCorpus(options: { refresh?: boolean } = {}): Promise<LoadedCorpus> {
  if (cached && !options.refresh) return cached;

  if (databaseReady()) {
    const [rules, exceptions, amendments, conflicts] = await Promise.all([
      LegalRule.find().lean<LegalRuleDTO[]>(),
      RuleException.find().lean<RuleExceptionDTO[]>(),
      Amendment.find().lean<AmendmentDTO[]>(),
      RuleConflict.find().lean<RuleConflictDTO[]>(),
    ]);

    if (rules.length > 0 && amendments.length > 0) {
      cached = corpusFrom(rules, exceptions, amendments, conflicts);
      return cached;
    }
  }

  cached = builtInCorpus();
  return cached;
}

/** Drops the cache. Call after seeding, so the next request sees the new corpus. */
export function invalidateCorpusCache(): void {
  cached = undefined;
}

export interface EvaluateAndRecordOptions extends EvaluateOptions {
  /** Set false to evaluate without writing an audit record — used by previews. */
  persist?: boolean;
}

/**
 * Evaluates a request and records the result.
 *
 * The audit write is deliberately not inside `evaluate`: the engine stays pure,
 * and a caller who wants a what-if answer — "would this package pass under the
 * rules as they will stand in July 2027?" — can get one without polluting the
 * inspection record.
 */
export async function evaluateCompliance(
  request: ComplianceEvaluationRequest,
  options: EvaluateAndRecordOptions = {},
): Promise<ComplianceResult> {
  const corpus = await loadCorpus();
  const result = evaluate(request, corpus, options);

  if (options.persist !== false && databaseReady()) {
    await ComplianceEvaluation.create(toAuditRecord(request, result));
  }

  return result;
}

/** The rule-set validation report, computed fresh from whatever corpus is loaded. */
export async function ruleSetValidationReport(asOf?: string): Promise<RuleSetValidationReport> {
  const corpus = await loadCorpus();

  return validateRuleSet({
    rules: corpus.rules,
    exceptions: corpus.exceptions,
    amendments: corpus.amendments,
    sourceConflicts: corpus.sourceConflicts,
    ruleSetVersion: corpus.metadata.ruleSetVersion,
    ruleSetChecksum: corpus.metadata.checksum,
    asOf,
  });
}
