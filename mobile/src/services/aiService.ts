import { ApiError, type AIAnalysis, type ProductImage, type ScanRecord } from '../types';

import { request } from './api';
import { toAnalysis, toScanRecord, toWireCategory, type InspectionDTO } from './mappers';

/**
 * ── THE AI ABSTRACTION ──────────────────────────────────────────────────────
 *
 * The only place in the app that knows how a product analysis is produced.
 * Screens call `analyzeProduct()` and receive an `AIAnalysis`; they have no
 * idea what produced it.
 *
 *   Phase 1:  analyzeProduct() → scripted scenarios, on device
 *   Phase 2:  analyzeProduct() → POST /inspections/:id/analyze
 *             (the backend ran a scripted analyser; no OCR)
 *   Phase 4B: analyzeProduct() → POST /inspections/:id/scan      ← current
 *             (real OCR → field extraction → the Legal Metrology rule engine)
 *
 * The cut-over to a real pipeline was this one function and the stage labels
 * below. No screen changed, because no screen ever knew where an `AIAnalysis`
 * came from — which is the entire point of routing every caller through here.
 *
 * The same holds for what comes next: replacing the cloud OCR provider with a
 * locally hosted model is a change on the server, behind `OCRProvider`, and
 * nothing in this file will notice.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The stages the processing screen reports, in order.
 *
 * These name what the backend pipeline actually does, so an inspector watching
 * the screen is being told the truth about where their photograph is. The
 * backend answers in one call and does not stream progress, so the list is
 * advanced optimistically — see `analyzeProduct`.
 */
export const ANALYSIS_STAGES = [
  { key: 'received', label: 'Image received' },
  { key: 'scanning', label: 'Scanning the label' },
  { key: 'extraction', label: 'Extracting declarations' },
  { key: 'rules', label: 'Checking legal rules' },
  { key: 'report', label: 'Preparing the report' },
] as const;

export type AnalysisStageKey = (typeof ANALYSIS_STAGES)[number]['key'];

export interface AnalyzeOptions {
  /** Called as each stage completes, so the UI can advance its checklist. */
  onStage?: (stage: AnalysisStageKey, index: number) => void;
  signal?: AbortSignal;
  categoryHint?: string;
}

/**
 * Scans an inspection's uploaded images: OCR, extraction, then the rule engine.
 *
 * The backend performs the work in one call and does not stream progress, so
 * the stage checklist is advanced optimistically while the request is in
 * flight and settled when it returns. The alternative — a frozen checklist for
 * four seconds — reads as a hung app.
 *
 * @throws {ApiError} `validation` when nothing has been uploaded,
 *         `analysis_failed` when the engine could not produce a result.
 */
/**
 * How long each stage stays visibly in progress.
 *
 * Five stages, so the checklist takes about three and a half seconds — long
 * enough to read, short enough that an inspector standing in a shop is not
 * waiting on an animation. Lower it and the stages stop registering; raise it
 * and the app is inventing delay.
 */
const MIN_STAGE_MS = 700;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ScanOutcome {
  analysis: AIAnalysis;
  /** The rule engine's own record. Absent only if the backend returned none. */
  scan?: ScanRecord;
}

export async function scanProduct(
  inspectionId: string,
  images: ProductImage[],
  options: AnalyzeOptions = {},
): Promise<ScanOutcome> {
  const { onStage, signal, categoryHint } = options;

  if (images.length === 0) {
    throw new ApiError('validation', 'Capture at least one product image before analysing.', {
      retryable: false,
    });
  }

  /**
   * The checklist is walked at a readable pace while the request runs.
   *
   * The two are deliberately in parallel, not in sequence: the work starts on
   * the first line below and the stages tick over beside it, so the floor this
   * imposes is `MIN_STAGE_MS x stages` and not that *plus* the round trip.
   *
   * There is a floor at all because the previous version dumped every
   * remaining stage the instant the response landed. Against a fast backend
   * that meant the first stage appeared and the other four completed in the
   * same frame — the inspector saw a flash, not a process, and a screen that
   * finishes before it can be read is one that gets tapped through without
   * being looked at. The stages name real work; they are worth showing.
   *
   * The last stage is the exception: it is only ticked once the response is
   * genuinely in hand, so the checklist can never claim to have finished work
   * the server has not returned.
   */
  const pending = request<InspectionDTO>(`/inspections/${inspectionId}/scan`, {
    method: 'POST',
    body: {
      inspectionDate: new Date().toISOString().slice(0, 10),
      productContext: categoryHint
        ? { category: toWireCategory(categoryHint as never) }
        : undefined,
    },
    signal,
  });

  /**
   * A failure short-circuits the walk rather than making the inspector sit
   * through three seconds of invented progress before being told it failed.
   *
   * The extra `catch` is there to stop the rejection being flagged as
   * unhandled while the loop below is still sleeping — the error itself is
   * re-thrown by the `await` at the end.
   */
  let failed = false;
  pending.catch(() => {
    failed = true;
  });

  for (let index = 0; index < ANALYSIS_STAGES.length - 1; index += 1) {
    // Sleep first: the stage is *in progress* for this interval, and is ticked
    // at the end of it.
    await delay(MIN_STAGE_MS);
    if (failed) break;

    const stage = ANALYSIS_STAGES[index];
    if (stage) onStage?.(stage.key, index);
  }

  if (!failed) await delay(MIN_STAGE_MS);

  // Throws here if the request failed, carrying the real error.
  const dto = await pending;

  const analysis = toAnalysis(dto);
  if (!analysis) {
    throw new ApiError('analysis_failed', 'The analysis returned no result. Please retry.');
  }

  // Every stage is now genuinely complete, the last one included.
  for (let index = 0; index < ANALYSIS_STAGES.length; index += 1) {
    const stage = ANALYSIS_STAGES[index];
    if (stage) onStage?.(stage.key, index);
  }

  return { analysis, scan: toScanRecord(dto) };
}

/**
 * The three-state summary alone.
 *
 * Kept for callers that only need the verdict and the fields. The rule engine's
 * own account — its five states, its citations, its evidence — is on the `scan`
 * half of `scanProduct`'s result, and a caller that wants to show a finding
 * should read that rather than inferring one from this.
 */
export async function analyzeProduct(
  inspectionId: string,
  images: ProductImage[],
  options: AnalyzeOptions = {},
): Promise<AIAnalysis> {
  const { analysis } = await scanProduct(inspectionId, images, options);
  return analysis;
}

/**
 * Re-runs the analysis after the inspector uploads a better photograph during
 * review. The image is uploaded first, then the whole inspection is re-analysed
 * — the backend owns which fields that changes.
 */
export async function reanalyze(inspectionId: string): Promise<ScanOutcome> {
  const dto = await request<InspectionDTO>(`/inspections/${inspectionId}/scan`, {
    method: 'POST',
    body: { inspectionDate: new Date().toISOString().slice(0, 10) },
  });

  const analysis = toAnalysis(dto);
  if (!analysis) {
    throw new ApiError('analysis_failed', 'The analysis returned no result. Please retry.');
  }

  return { analysis, scan: toScanRecord(dto) };
}
