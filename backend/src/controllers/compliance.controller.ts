import type { Request, Response } from 'express';

import { evaluateCompliance, loadCorpus } from '../compliance/ruleEngineService';
import type { ComplianceEvaluationRequest } from '../compliance/types/Evidence';
import { ComplianceEvaluation } from '../models/ComplianceEvaluation';
import { ApiError } from '../utils/ApiError';
import { created, ok } from '../utils/respond';
import type { EvaluateComplianceBody } from '../validators/complianceSchemas';

/**
 * The compliance API.
 *
 * `POST /api/compliance/evaluate` takes structured evidence and returns a
 * verdict. It does no extraction of its own and never will — the request *is*
 * the seam between whatever produces evidence and the layer that reasons about
 * the law.
 */

export async function evaluate(req: Request, res: Response): Promise<Response> {
  const body = req.body as EvaluateComplianceBody;

  const request: ComplianceEvaluationRequest = {
    inspectionId: body.inspectionId,
    inspectionDate: body.inspectionDate,
    productContext: body.productContext,
    fields: body.fields,
    evidence: body.evidence,
    options: body.options,
  };

  const result = await evaluateCompliance(request);

  // 201: the evaluation is a record that now exists, not a lookup.
  return created(res, result, `Evaluated against ${result.ruleSetVersion} as in force on ${result.inspectionDate}.`);
}

/**
 * The evaluations recorded for an inspection, newest first.
 *
 * A list rather than a single record, because re-evaluating is legitimate — an
 * inspector corrects a field, or a transcription error in the corpus is fixed —
 * and the earlier verdict must not vanish when it happens. Each carries the
 * rule-set version and checksum it was decided on, so two entries that differ
 * can be told apart: the evidence changed, or the law did.
 */
export async function getEvaluations(req: Request, res: Response): Promise<Response> {
  const { inspectionId } = req.params as { inspectionId: string };

  const evaluations = await ComplianceEvaluation.find({ inspectionId }).sort({ evaluatedAt: -1 }).limit(50).lean();

  if (evaluations.length === 0) {
    throw ApiError.notFound(`No compliance evaluation has been recorded for inspection "${inspectionId}".`, 'EVALUATION_NOT_FOUND');
  }

  const [latest] = evaluations;

  return ok(res, {
    inspectionId,
    latest,
    history: evaluations,
    total: evaluations.length,
  });
}

/** What the engine is, and which corpus it is currently running. */
export async function getEngineStatus(_req: Request, res: Response): Promise<Response> {
  const corpus = await loadCorpus();

  return ok(res, {
    engineVersion: 'lm-rule-engine/1.0.0',
    ruleSetVersion: corpus.metadata.ruleSetVersion,
    ruleSetChecksum: corpus.metadata.checksum,
    origin: corpus.metadata.origin,
    ruleVersions: corpus.metadata.ruleCount,
    distinctRules: new Set(corpus.rules.map((rule) => rule.ruleId)).size,
    exceptions: corpus.metadata.exceptionCount,
    amendments: corpus.metadata.amendmentCount,
    recordedSourceConflicts: corpus.sourceConflicts.length,
    deterministic: true,
    usesLlmForDecisions: false,
    containsOcrOrCv: false,
  });
}
