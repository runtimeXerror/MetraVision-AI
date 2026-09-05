import { create } from 'zustand';

import { REVIEW_CONFIDENCE_THRESHOLD } from '../constants/rules';
import { scanProduct, type AnalysisStageKey } from '../services/aiService';
import { toApiError } from '../services/api';
import { reviewField as submitReview, uploadImage } from '../services/inspectionService';
import {
  ApiError,
  type AIAnalysis,
  type ExtractedField,
  type ProductImage,
  type ReviewAction,
  type ScanRecord,
} from '../types';

/**
 * Analysis run + human review state.
 *
 * The store holds the model's output and the inspector's corrections side by
 * side without ever collapsing one into the other — `aiValue` stays untouched
 * for the life of the record, on the device and in MongoDB alike.
 *
 * Phase 2 change: review decisions are posted to the backend, which re-evaluates
 * compliance and returns the updated record. The store no longer recomputes the
 * verdict locally — the server is the authority, so the mobile app and the
 * future dashboard can never disagree about a record's status.
 */

type RunStatus = 'idle' | 'running' | 'success' | 'error';

interface AnalysisState {
  status: RunStatus;
  /** Stages completed so far, in order. */
  completedStages: AnalysisStageKey[];
  analysis: AIAnalysis | null;
  /**
   * The rule engine's own account of the scan — five states, its citations, its
   * evidence — held beside the three-state summary rather than folded into it.
   * `analysis` is what the older screens read; this is what a finding is shown
   * from, because only this carries the provision it came from.
   */
  scan: ScanRecord | null;
  error: ApiError | null;
  /** Field key currently being re-analysed, if any. */
  reanalysing: string | null;
  /** True while a review decision is being submitted. */
  submitting: boolean;

  /**
   * Runs the scan.
   *
   * Accepts a missing id rather than requiring the caller to check for one,
   * because the caller that did check simply returned — leaving the analysis
   * screen on its spinner with no error, no result and, since that screen
   * offers a way back only once something has failed, no way off it either.
   * A run that cannot start is a failed run and has to say so.
   */
  run: (inspectionId: string | null, images: ProductImage[]) => Promise<boolean>;
  /** Records the inspector's decision on one field. */
  reviewField: (
    inspectionId: string,
    key: string,
    action: ReviewAction,
    value: string | null,
    comment?: string,
  ) => Promise<boolean>;
  /** Uploads a fresh photograph for a field and re-runs the analysis. */
  reanalyse: (inspectionId: string, key: string, image: ProductImage) => Promise<void>;
  /** Loads a stored analysis when opening a past inspection. */
  hydrate: (analysis: AIAnalysis, scan?: ScanRecord) => void;
  clearError: () => void;
  reset: () => void;
}

export const useAnalysisStore = create<AnalysisState>((set, get) => ({
  status: 'idle',
  completedStages: [],
  analysis: null,
  scan: null,
  error: null,
  reanalysing: null,
  submitting: false,

  async run(inspectionId, images) {
    set({ status: 'running', completedStages: [], error: null, analysis: null, scan: null });

    if (!inspectionId) {
      // The draft reached this screen without a server record — the create in
      // step 1 never landed, or the store was reset under it. Nothing can be
      // scanned, and saying so is what lets the inspector back out and retry.
      set({
        status: 'error',
        error: new ApiError(
          'validation',
          'This inspection has not been saved to the server yet, so it cannot be analysed. Go back and continue from the images again.',
          { retryable: false },
        ),
      });
      return false;
    }

    try {
      const { analysis, scan } = await scanProduct(inspectionId, images, {
        onStage: (stage) => {
          set((state) =>
            state.completedStages.includes(stage)
              ? state
              : { completedStages: [...state.completedStages, stage] },
          );
        },
      });

      set({ analysis, scan: scan ?? null, status: 'success' });
      return true;
    } catch (error) {
      set({ error: toApiError(error), status: 'error' });
      return false;
    }
  },

  async reviewField(inspectionId, key, action, value, comment) {
    set({ submitting: true, error: null });

    try {
      const inspection = await submitReview(inspectionId, key, action, value, comment);

      // The response carries the re-evaluated compliance result, so the result
      // screen updates without a second round trip.
      if (inspection.analysis) set({ analysis: inspection.analysis });

      set({ submitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), submitting: false });
      return false;
    }
  },

  async reanalyse(inspectionId, key, image) {
    set({ reanalysing: key, error: null });

    try {
      await uploadImage(inspectionId, image);

      const { analysis, scan } = await scanProduct(inspectionId, [image], {});
      set({ analysis, scan: scan ?? null, reanalysing: null });
    } catch (error) {
      set({ error: toApiError(error), reanalysing: null });
    }
  },

  hydrate(analysis, scan) {
    set({ analysis, scan: scan ?? null, status: 'success', completedStages: [], error: null });
  },

  clearError() {
    set({ error: null });
  },

  reset() {
    set({
      status: 'idle',
      completedStages: [],
      analysis: null,
      scan: null,
      error: null,
      reanalysing: null,
      submitting: false,
    });
  },
}));

/* ── Derived helpers ──────────────────────────────────────────────────────── */

/** The value of record: the inspector's correction when present, else the model's. */
export function effectiveValue(field: ExtractedField): string | null {
  if (field.reviewAction === 'marked_unavailable') return null;
  return field.humanValue ?? field.aiValue;
}

/**
 * Fields the inspector still needs to decide on.
 *
 * The threshold is duplicated from the backend's rule catalogue so the UI can
 * mark a field for review without waiting for a round trip; the server remains
 * the authority for the resulting verdict.
 */
export function fieldsNeedingReview(analysis: AIAnalysis | null): ExtractedField[] {
  if (!analysis) return [];

  return analysis.fields.filter((field) => {
    if (field.reviewAction) return false; // Already decided.
    const missing = field.aiValue === null || field.aiValue.trim() === '';
    if (missing && field.required) return true;
    return field.confidence < REVIEW_CONFIDENCE_THRESHOLD;
  });
}

export function isReviewComplete(analysis: AIAnalysis | null): boolean {
  return fieldsNeedingReview(analysis).length === 0;
}
