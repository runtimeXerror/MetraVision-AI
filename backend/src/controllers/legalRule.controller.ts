import type { Request, Response } from 'express';

import { buildEvaluationContext, resolveApplicability } from '../compliance/rule-engine/ApplicabilityResolver';
import { resolveExceptionFor } from '../compliance/rule-engine/ExceptionResolver';
import {
  futureEffectiveRules,
  resolveExceptionVersions,
  resolveRuleVersions,
  temporalStatusOf,
  toIsoDate,
  versionHistory,
} from '../compliance/rule-engine/VersionResolver';
import { loadCorpus, ruleSetValidationReport } from '../compliance/ruleEngineService';
import type { LegalRule } from '../compliance/types/Rule';
import { query } from '../middleware/validate';
import { ApiError } from '../utils/ApiError';
import { ok, paginated } from '../utils/respond';
import type {
  ApplicableRulesQuery,
  ListAmendmentsQuery,
  ListLegalRulesQuery,
  RuleHistoryQuery,
  ValidationReportQuery,
} from '../validators/complianceSchemas';

/**
 * Read access to the legal corpus.
 *
 * Read-only, for everyone including administrators. There is no route here that
 * writes a rule, and that is a design decision rather than an omission: a
 * versioned legal corpus edited through an HTTP endpoint has no diff, no
 * reviewer and no record of who transcribed which Gazette. Amendments arrive as
 * changes to `src/compliance/data/`, through review, and the seeder projects
 * them — see `docs/legal-rule-engine.md`.
 */

function matchesSearch(rule: LegalRule, needle: string): boolean {
  const haystack = [rule.ruleId, rule.title, rule.requirement, rule.sourceRule, rule.sourceClause, rule.legalText, rule.field]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle.toLowerCase());
}

export async function listLegalRules(req: Request, res: Response): Promise<Response> {
  const params = query<ListLegalRulesQuery>(req);
  const corpus = await loadCorpus();

  let rules = params.asOf ? resolveRuleVersions(corpus.rules, params.asOf) : [...corpus.rules];

  if (params.ruleId) rules = rules.filter((rule) => rule.ruleId === params.ruleId);
  if (params.sourceRule) rules = rules.filter((rule) => rule.sourceRule.toLowerCase() === params.sourceRule?.toLowerCase());
  if (params.category) rules = rules.filter((rule) => rule.category === params.category);
  if (params.field) rules = rules.filter((rule) => rule.field === params.field);
  if (params.notification) rules = rules.filter((rule) => rule.source.notification === params.notification);
  if (params.status && params.status !== 'ALL') rules = rules.filter((rule) => rule.status === params.status);
  if (params.search) rules = rules.filter((rule) => matchesSearch(rule, params.search as string));

  rules.sort((a, b) => `${a.ruleId}@${a.ruleVersion}`.localeCompare(`${b.ruleId}@${b.ruleVersion}`));

  const total = rules.length;
  const page = rules.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);

  return paginated(res, page, {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  });
}

/**
 * One rule, with every version of it.
 *
 * The history is the interesting part: it is the amendment trail of a single
 * requirement, and it answers "what did this say in March 2023?" without the
 * caller having to know which notification changed it.
 */
export async function getLegalRule(req: Request, res: Response): Promise<Response> {
  const { ruleId } = req.params as { ruleId: string };
  const corpus = await loadCorpus();

  const versions = versionHistory(corpus.rules, ruleId);
  if (versions.length === 0) {
    throw ApiError.notFound(`No rule with identifier "${ruleId}" is in the corpus.`, 'LEGAL_RULE_NOT_FOUND');
  }

  const asOf = query<RuleHistoryQuery>(req)?.asOf ?? new Date().toISOString();
  const current = resolveRuleVersions(versions, asOf).at(0);

  return ok(res, {
    ruleId,
    asOf: toIsoDate(asOf),
    current: current ?? null,
    temporalStatuses: versions.map((version) => ({
      ruleVersion: version.ruleVersion,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      declaredStatus: version.status,
      statusOnDate: temporalStatusOf(version, asOf),
    })),
    versions,
    ruleSetVersion: corpus.metadata.ruleSetVersion,
  });
}

/**
 * `GET /api/rules/applicable` — which rules reach a package described by the
 * query, on a given date.
 *
 * Answers the applicability question on its own, without any extracted
 * evidence. Useful before an inspection: it tells an inspector what the package
 * in front of them has to carry, which is a different question from whether it
 * does.
 */
export async function listApplicableRules(req: Request, res: Response): Promise<Response> {
  const params = query<ApplicableRulesQuery>(req);
  const corpus = await loadCorpus();
  const inspectionDate = toIsoDate(params.inspectionDate);

  const { inspectionDate: _ignored, ...productContext } = params;
  const context = buildEvaluationContext({
    inspectionDate,
    productContext,
    fields: {},
  });

  const effective = resolveRuleVersions(corpus.rules, inspectionDate);
  const exceptions = resolveExceptionVersions(corpus.exceptions, inspectionDate);
  const decisions = resolveApplicability(effective, context);

  const applicable: unknown[] = [];
  const notApplicable: unknown[] = [];

  for (const { rule, applicable: inScope } of decisions) {
    const summary = {
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      sourceRule: rule.sourceRule,
      sourceClause: rule.sourceClause ?? rule.sourceSubRule,
      title: rule.title,
      field: rule.field,
      category: rule.category,
      severity: rule.severity,
      requirement: rule.requirement,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
      source: rule.source,
    };

    if (!inScope) {
      notApplicable.push({ ...summary, reason: 'CONTEXT_OUT_OF_SCOPE' });
      continue;
    }

    const exception = resolveExceptionFor(rule, exceptions, context);
    if (exception.suppressed) {
      notApplicable.push({
        ...summary,
        reason: exception.deferred ? 'DEFERRED_TO_OTHER_REGULATION' : 'EXCEPTION_APPLIES',
        exceptionId: exception.exception?.exceptionId,
        exceptionTitle: exception.exception?.title,
        deferTo: exception.deferTo,
        exceptionSource: exception.exception?.source,
      });
      continue;
    }

    applicable.push({ ...summary, viaException: exception.exception?.exceptionId });
  }

  // Shown, never applied: rules already notified that bite later. An inspector
  // asking "what will change?" should not have to read the Gazette.
  const upcoming = futureEffectiveRules(corpus.rules, inspectionDate).map((rule) => ({
    ruleId: rule.ruleId,
    ruleVersion: rule.ruleVersion,
    sourceRule: rule.sourceRule,
    sourceClause: rule.sourceClause ?? rule.sourceSubRule,
    title: rule.title,
    effectiveFrom: rule.effectiveFrom,
    source: rule.source,
  }));

  return ok(res, {
    inspectionDate,
    productContext,
    ruleSetVersion: corpus.metadata.ruleSetVersion,
    ruleSetChecksum: corpus.metadata.checksum,
    applicable,
    notApplicable,
    futureEffective: upcoming,
    counts: {
      applicable: applicable.length,
      notApplicable: notApplicable.length,
      futureEffective: upcoming.length,
    },
  });
}

export async function listAmendments(req: Request, res: Response): Promise<Response> {
  const params = query<ListAmendmentsQuery>(req);
  const corpus = await loadCorpus();

  let amendments = [...corpus.amendments];

  if (params.changeType) amendments = amendments.filter((entry) => entry.changeType === params.changeType);
  if (params.verified !== undefined) amendments = amendments.filter((entry) => entry.verified === params.verified);
  if (params.affectsRule) {
    amendments = amendments.filter((entry) => entry.affectedRules.some((rule) => rule.toLowerCase() === params.affectsRule?.toLowerCase()));
  }
  if (params.search) {
    const needle = params.search.toLowerCase();
    amendments = amendments.filter((entry) =>
      [entry.notificationNumber, entry.title, entry.summary].join(' ').toLowerCase().includes(needle),
    );
  }

  // Newest first — the order anyone reading an amendment registry wants.
  amendments.sort((a, b) => b.notificationDate.localeCompare(a.notificationDate));

  const total = amendments.length;
  const page = amendments.slice((params.page - 1) * params.pageSize, params.page * params.pageSize);

  return paginated(res, page, {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  });
}

export async function getAmendment(req: Request, res: Response): Promise<Response> {
  const { notification } = req.params as { notification: string };
  const corpus = await loadCorpus();

  const decoded = decodeURIComponent(notification);
  const amendment = corpus.amendments.find(
    (entry) => entry.notificationNumber.toLowerCase() === decoded.toLowerCase(),
  );

  if (!amendment) {
    throw ApiError.notFound(`No notification "${decoded}" is in the amendment registry.`, 'AMENDMENT_NOT_FOUND');
  }

  // What this notification actually produced in the corpus — the link between
  // the ledger and the rules that evaluate.
  const producedRules = corpus.rules.filter((rule) => rule.source.notification === amendment.notificationNumber);
  const producedExceptions = corpus.exceptions.filter((entry) => entry.source.notification === amendment.notificationNumber);

  return ok(res, {
    amendment,
    producedRuleVersions: producedRules.map((rule) => ({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      sourceClause: rule.sourceClause ?? rule.sourceSubRule,
      title: rule.title,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
    })),
    producedExceptions: producedExceptions.map((entry) => ({
      exceptionId: entry.exceptionId,
      title: entry.title,
      effect: entry.effect,
      effectiveFrom: entry.effectiveFrom,
      effectiveTo: entry.effectiveTo,
    })),
  });
}

/**
 * `GET /api/rule-sources` — the provenance index.
 *
 * Derived from the amendment registry rather than stored separately, so a
 * source and the notification it belongs to cannot disagree. The brief lists
 * `rule_sources` as a collection; one source of truth beats two that agree
 * until they don't.
 */
export async function listRuleSources(_req: Request, res: Response): Promise<Response> {
  const corpus = await loadCorpus();

  const sources = corpus.amendments
    .map((amendment) => {
      const ruleCount = corpus.rules.filter((rule) => rule.source.notification === amendment.notificationNumber).length;
      const exceptionCount = corpus.exceptions.filter((entry) => entry.source.notification === amendment.notificationNumber).length;

      return {
        authority: 'Department of Consumer Affairs, Ministry of Consumer Affairs, Food and Public Distribution',
        notification: amendment.notificationNumber,
        notificationDate: amendment.notificationDate,
        publicationDate: amendment.publicationDate,
        title: amendment.title,
        officialUrl: amendment.officialSourceUrl,
        verificationStatus: amendment.verificationStatus,
        verificationNote: amendment.verificationNote,
        changeType: amendment.changeType,
        ruleVersionsProduced: ruleCount,
        exceptionsProduced: exceptionCount,
      };
    })
    .sort((a, b) => b.notificationDate.localeCompare(a.notificationDate));

  return ok(res, {
    ruleSetVersion: corpus.metadata.ruleSetVersion,
    origin: corpus.metadata.origin,
    total: sources.length,
    verified: sources.filter((source) => source.verificationStatus === 'VERIFIED').length,
    needsVerification: sources.filter((source) => source.verificationStatus !== 'VERIFIED').length,
    missingUrl: sources.filter((source) => !source.officialUrl).length,
    sources,
  });
}

export async function getValidationReport(req: Request, res: Response): Promise<Response> {
  const params = query<ValidationReportQuery>(req);
  const report = await ruleSetValidationReport(params.asOf);
  return ok(res, report);
}
