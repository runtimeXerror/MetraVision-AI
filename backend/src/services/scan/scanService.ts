import { randomBytes } from 'node:crypto';

import { evaluateCompliance } from '../../compliance/ruleEngineService';
import type { ComplianceResult } from '../../compliance/types/ComplianceResult';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { extractInformation, type ExtractionResult } from '../extraction';
import { aggregate, ocrProvider, type AggregateOCRResult, type OCRProvider } from '../ocr';

import { toComplianceRequest, type ScanProductContext } from './ComplianceInputAdapter';
import { generateIssues, type ComplianceIssue, type IssueSummary } from './issueGenerator';
import { buildReport, type ComplianceReport } from './reportGenerator';

/**
 * ── THE PIPELINE ────────────────────────────────────────────────────────────
 *
 *   image bytes
 *       ↓  OCRProvider                    (swappable; knows nothing of the law)
 *   raw text + located regions
 *       ↓  InformationExtractionService   (deterministic; knows nothing of the law)
 *   structured fields + evidence
 *       ↓  ComplianceInputAdapter         (translates; decides nothing)
 *   ComplianceEvaluationRequest
 *       ↓  existing rule engine           (the only thing that decides)
 *   ComplianceResult
 *       ↓  issue generation + report
 *
 * Each arrow is a one-way dependency and each stage is replaceable without the
 * next one noticing. The stage that matters most is the one this file does not
 * contain: the rule engine is imported, not reimplemented, and its result is
 * passed on unchanged.
 *
 * The failure rule is the other thing worth reading here. If OCR fails, the
 * pipeline stops. It does not carry on with an empty field set, because an
 * empty field set is indistinguishable to the engine from a package with no
 * declarations on it, and the difference between "the OCR service timed out"
 * and "this trader sold unlabelled goods" is the whole difference between a
 * bug and a false accusation. See §31.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ScanImageInput {
  imageId: string;
  buffer: Buffer;
  mimeType: string;
}

export interface RunScanInput {
  inspectionId: string;
  inspectionDate: string;
  productContext: ScanProductContext;
  images: ScanImageInput[];
  /** Overrides the configured provider. Used by tests and the seed script. */
  provider?: OCRProvider;
  /** Written into the audit record. `false` for a preview. */
  persistEvaluation?: boolean;
}

export interface ScanOutcome {
  ocr: AggregateOCRResult;
  extraction: ExtractionResult;
  compliance: ComplianceResult;
  issues: ComplianceIssue[];
  issueSummary: IssueSummary;
  report: ComplianceReport;
  captureCompleteness: number;
  contextApplied: Array<{ key: string; value: string | number | boolean; basis: string }>;
  contextOverridden: Array<{ key: string; value: string | number | boolean; basis: string }>;
  timings: { ocrMs: number; extractionMs: number; ruleEngineMs: number; totalMs: number };
}

function reportId(): string {
  return `RPT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

/**
 * Runs OCR over every image.
 *
 * Sequential rather than parallel: a scan is at most a handful of photographs,
 * cloud OCR is rate-limited per project, and firing four requests at once is
 * how a demo earns a 429 instead of a faster answer.
 */
async function readImages(
  provider: OCRProvider,
  images: ScanImageInput[],
): Promise<AggregateOCRResult> {
  const startedAt = Date.now();
  const results = [];

  for (const image of images) {
    results.push(await provider.extractText(image));
  }

  return aggregate(results, Date.now() - startedAt);
}

/**
 * The whole pipeline for one inspection.
 *
 * Pure with respect to persistence except for the rule engine's own audit
 * write, which `evaluateCompliance` owns. The caller stores the images and the
 * inspection record; this decides nothing about how either is stored.
 */
export async function runScan(input: RunScanInput): Promise<ScanOutcome> {
  const startedAt = Date.now();
  const provider = input.provider ?? ocrProvider;

  if (input.images.length === 0) {
    throw ApiError.badRequest('Submit at least one image of the package.', 'NO_IMAGES');
  }

  /* ── Stage 1: read ────────────────────────────────────────────────────── */

  let ocr: AggregateOCRResult;
  try {
    ocr = await readImages(provider, input.images);
  } catch (error) {
    // Re-thrown with the scan's own code so a client can tell a failed read
    // from a failed evaluation, and so nothing downstream ever runs on a read
    // that did not happen.
    if (error instanceof ApiError) {
      logger.warn(
        { inspectionId: input.inspectionId, errorCode: error.errorCode, provider: provider.name },
        'scan aborted: OCR did not complete',
      );
      throw error;
    }
    logger.error({ inspectionId: input.inspectionId }, 'scan aborted: unexpected OCR failure');
    throw new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.');
  }

  const ocrMs = ocr.processingTimeMs;

  if (ocr.rawText.trim() === '') {
    /**
     * The read succeeded and found nothing.
     *
     * Not an error — a photograph of a blank surface legitimately reads as
     * nothing — but the rule engine is still not run. Evaluating a package
     * whose every field is absent would produce a full sheet of findings that
     * are facts about the photograph, and the summary would look identical to a
     * genuinely unlabelled package.
     */
    logger.info(
      { inspectionId: input.inspectionId, provider: provider.name, images: input.images.length },
      'scan produced no readable text',
    );
    throw new ApiError(
      422,
      'NO_TEXT_DETECTED',
      'No readable text was found in the submitted image. Move closer to the label, avoid glare, and try again.',
    );
  }

  /* ── Stage 2: extract ─────────────────────────────────────────────────── */

  const extraction = extractInformation(ocr);

  /* ── Stage 3: adapt to the engine's contract ──────────────────────────── */

  const adapted = toComplianceRequest({
    inspectionId: input.inspectionId,
    inspectionDate: input.inspectionDate,
    productContext: input.productContext,
    extraction,
    ocr,
    imageIds: input.images.map((image) => image.imageId),
  });

  /* ── Stage 4: the existing rule engine ────────────────────────────────── */

  const engineStartedAt = Date.now();
  let compliance: ComplianceResult;
  try {
    compliance = await evaluateCompliance(adapted.request, {
      persist: input.persistEvaluation !== false,
    });
  } catch (error) {
    logger.error({ inspectionId: input.inspectionId, err: error }, 'rule engine evaluation failed');
    throw ApiError.serviceUnavailable(
      'The compliance rules could not be evaluated for this scan. The scan has not been recorded.',
      'RULE_ENGINE_FAILED',
    );
  }
  const ruleEngineMs = Date.now() - engineStartedAt;

  /* ── Stage 5: issues and report ───────────────────────────────────────── */

  const { issues, summary: issueSummary } = generateIssues(compliance, input.inspectionId);

  const timings = {
    ocrMs,
    extractionMs: extraction.processingTimeMs,
    ruleEngineMs,
    totalMs: Date.now() - startedAt,
  };

  const contextApplied = adapted.appliedSignals.map((signal) => ({
    key: signal.key,
    value: signal.value,
    basis: signal.basis,
  }));

  const report = buildReport({
    inspectionId: input.inspectionId,
    reportId: reportId(),
    generatedAt: new Date().toISOString(),
    inspectionDate: adapted.request.inspectionDate,
    images: [],
    ocr,
    extraction,
    compliance,
    issues,
    issueSummary,
    captureCompleteness: adapted.captureCompleteness,
    contextApplied,
    timings,
  });

  logger.info(
    {
      inspectionId: input.inspectionId,
      ocrProvider: ocr.provider,
      ocrProviderVersion: ocr.providerVersion,
      images: input.images.length,
      lines: ocr.regions.length,
      decision: compliance.status,
      ruleSetVersion: compliance.ruleSetVersion,
      issues: issues.length,
      ...timings,
    },
    'scan complete',
  );

  return {
    ocr,
    extraction,
    compliance,
    issues,
    issueSummary,
    report,
    captureCompleteness: adapted.captureCompleteness,
    contextApplied,
    contextOverridden: adapted.overriddenSignals.map((signal) => ({
      key: signal.key,
      value: signal.value,
      basis: signal.basis,
    })),
    timings,
  };
}
