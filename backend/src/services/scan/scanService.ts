import { randomBytes } from 'node:crypto';

import { evaluateCompliance } from '../../compliance/ruleEngineService';
import type { ComplianceResult } from '../../compliance/types/ComplianceResult';
import { logger } from '../../config/logger';
import { ApiError } from '../../utils/ApiError';
import { extractInformation, type ExtractionResult } from '../extraction';
import { adoptReading, llmEnabled, llmProvider } from '../llm';
import {
  aggregate,
  ocrProvider,
  type AggregateOCRResult,
  type OCRProvider,
  type UnreadImage,
} from '../ocr';

import { toComplianceRequest, type ScanProductContext } from './ComplianceInputAdapter';
import { generateIssues, type ComplianceIssue, type IssueSummary } from './issueGenerator';
import { buildReport, type ComplianceReport } from './reportGenerator';

/**
 * ── THE PIPELINE ────────────────────────────────────────────────────────────
 *
 *   image bytes
 *       ↓  OCRProvider                    (swappable; knows nothing of the law)
 *   raw text + located regions
 *       ↓  InformationExtractionService   (deterministic; the fallback reading)
 *       ↓  LLMProvider + adoptReading     (the reading of record, when a model answers)
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
 * The failure rule is the other thing worth reading here. If the read produces
 * nothing at all, the pipeline stops. It does not carry on with an empty field
 * set, because an empty field set is indistinguishable to the engine from a
 * package with no declarations on it, and the difference between "the OCR
 * service timed out" and "this trader sold unlabelled goods" is the whole
 * difference between a bug and a false accusation. See §31.
 *
 * A read that produces *something* is a different case and is not stopped. One
 * unreadable photograph out of seven is not grounds to throw away the six that
 * read, so those faces are evaluated and the ones that failed are carried on
 * `ocr.unread` and printed on the report, so the inspector knows which faces
 * the declarations were read from before confirming a missing one.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ScanImageInput {
  imageId: string;
  buffer: Buffer;
  mimeType: string;
  /**
   * Which panel of the package this photograph shows — `FRONT`, `BACK`, and so
   * on, as the capture flow recorded it. Feeds the capture-completeness count,
   * which is about faces and not about how many attempts each one took.
   */
  face?: string;
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
  timings: {
    ocrMs: number;
    extractionMs: number;
    /** Absent when no model was asked — which is not the same as one taking 0 ms. */
    llmMs?: number;
    ruleEngineMs: number;
    totalMs: number;
  };
}

function reportId(): string {
  return `RPT-${randomBytes(6).toString('hex').toUpperCase()}`;
}

/**
 * The whole read's budget, across every photograph on the inspection.
 *
 * `OCR_TIMEOUT_MS` bounds one image; nothing bounded the sum, so a seven-image
 * inspection could legitimately ask for seven times it. The client waiting on
 * the other end gives up long before that and reports a timed-out request,
 * while this process carries on and files a report nobody is waiting for.
 *
 * So the read has a deadline of its own, and it is set to fit inside the
 * mobile app's leash (`SCAN_TIMEOUT_MS`, 180s) rather than to a round number.
 * The deadline stops the loop *starting* another photograph, so the read can
 * still overrun by the one already in flight: 105s + `OCR_TIMEOUT_MS` (45s) is
 * 150s, and the rule engine, the report and the save go in the 30s left.
 *
 * Past the deadline the remaining photographs are recorded as unread and the
 * scan is evaluated on what was read — a report drawn from five faces, saying
 * on its own front that it is, beats an error drawn from none.
 */
export const OCR_BUDGET_MS = 105_000;

/**
 * Runs OCR over every image.
 *
 * Sequential rather than parallel: a scan is at most a handful of photographs,
 * cloud OCR is rate-limited per project, and firing four requests at once is
 * how a demo earns a 429 instead of a faster answer.
 *
 * A photograph that cannot be read is recorded and stepped over rather than
 * ending the scan. It used to end it, and the cost was out of all proportion:
 * one curved or dark face that ran past `OCR_TIMEOUT_MS` threw away the six
 * faces that had already been read successfully, and the inspector — who had
 * photographed the package properly — was told the analysis had failed. The
 * read that did happen is evidence, and it is not improved by discarding it.
 *
 * What must not happen is the opposite mistake: quietly evaluating a package
 * on fewer faces than were submitted, as though the missing ones had been read
 * and found blank. Hence `unread`, which travels with the result and is
 * printed in the report.
 */
async function readImages(
  provider: OCRProvider,
  images: ScanImageInput[],
  inspectionId: string,
): Promise<AggregateOCRResult> {
  const startedAt = Date.now();
  const results: Awaited<ReturnType<OCRProvider['extractText']>>[] = [];
  const unread: UnreadImage[] = [];

  /**
   * The first failure, kept for the case where nothing reads at all.
   *
   * When every photograph fails the scan still has to fail, and it has to fail
   * with the reason — `OCR_SERVICE_DOWN` and `OCR_TIMEOUT` send an inspector
   * to two different places.
   */
  let firstFailure: unknown;

  for (const image of images) {
    if (Date.now() - startedAt >= OCR_BUDGET_MS) {
      unread.push({
        imageId: image.imageId,
        code: 'OCR_BUDGET_EXHAUSTED',
        reason: 'Reading the earlier photographs used the time allowed for this scan.',
      });
      continue;
    }

    try {
      results.push(await provider.extractText(image));
    } catch (error) {
      firstFailure ??= error;

      const apiError = error instanceof ApiError ? error : undefined;
      unread.push({
        imageId: image.imageId,
        code: apiError?.errorCode ?? 'OCR_FAILED',
        reason: apiError?.message ?? 'The OCR service could not read this photograph.',
      });

      logger.warn(
        {
          inspectionId,
          imageId: image.imageId,
          errorCode: apiError?.errorCode ?? 'OCR_FAILED',
          provider: provider.name,
        },
        'image could not be read; continuing with the rest of the scan',
      );
    }
  }

  // Nothing read means there is nothing to evaluate, and the reason the first
  // photograph failed is the reason the scan failed.
  if (results.length === 0) {
    throw firstFailure ?? new ApiError(503, 'OCR_FAILED', 'No photograph on this inspection could be read.');
  }

  return aggregate(results, Date.now() - startedAt, unread);
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
    ocr = await readImages(provider, input.images, input.inspectionId);
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

  let extraction = extractInformation(ocr);

  /* ── Stage 2a: the reading of record, from a model ────────────────────── */

  /**
   * The model reads the whole OCR text and returns every declaration it
   * finds, with the camera's damage repaired. Where it answers, its reading
   * replaces the pattern extractor's field for field — see
   * `services/llm/adoptReading.ts` for why all of them and not just the gaps,
   * and for how each value is tied back to the OCR line it came from.
   *
   * It is still allowed to fail. `LLMProvider.read` returns no suggestions
   * instead of throwing on a timeout, an outage or a spent quota, and the
   * scan then proceeds on the extractor's reading with a note saying so.
   *
   * What the stage does *not* do is decide. It says what is printed; the
   * rule engine says what that means.
   */
  let llmMs: number | undefined;
  if (llmEnabled()) {
    const reading = await llmProvider.read({
      text: ocr.rawText,
      category: input.productContext.category,
      inspectionId: input.inspectionId,
    });
    extraction = adoptReading(extraction, reading, ocr);
    llmMs = reading.processingTimeMs;
  }

  /* ── Stage 3: adapt to the engine's contract ──────────────────────────── */

  const adapted = toComplianceRequest({
    inspectionId: input.inspectionId,
    inspectionDate: input.inspectionDate,
    productContext: input.productContext,
    extraction,
    ocr,
    // The images that were *read*, not the images that were submitted. Capture
    // completeness is derived from this count, and counting a photograph the
    // OCR never saw would tell the engine the package was more completely
    // captured than it was — which is how an absent declaration turns into a
    // violation on evidence that does not exist.
    imageIds: ocr.perImage.map((result) => result.imageId),
    images: ocr.perImage.map((result) => ({
      imageId: result.imageId,
      face: input.images.find((image) => image.imageId === result.imageId)?.face,
    })),
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
    llmMs,
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
      llmModel: extraction.llm?.model,
      llmSuggestions: extraction.llm?.suggestions.length,
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
