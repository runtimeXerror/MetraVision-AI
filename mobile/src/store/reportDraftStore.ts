import { create } from 'zustand';

import type { ProductCategory, Report } from '../types';

/**
 * ── REPORT AMENDMENTS ───────────────────────────────────────────────────────
 * The officer's corrections to a report, held for the exported document.
 *
 * These do **not** overwrite the inspection. A finalized inspection is an
 * enforcement record and the API refuses to mutate one — deliberately, because
 * a record that can be edited after it is filed cannot be relied on as
 * evidence. So an amendment is layered over the record at export time and
 * printed *beside* the original value, never in place of it: the PDF shows both
 * what was recorded and what the officer corrected it to, and the stored
 * inspection is untouched either way.
 *
 * That is what makes the editor safe to hand to an officer. The alternative —
 * writing edits back into the record — would quietly destroy the provenance the
 * whole application is built to preserve.
 * ────────────────────────────────────────────────────────────────────────────
 */

export interface ReportAmendment {
  businessName?: string;
  location?: string;
  district?: string;
  state?: string;
  productName?: string;
  productCategory?: ProductCategory;
  /** Declaration key → the officer's corrected value. */
  fieldValues?: Record<string, string>;
  inspectorNotes?: string;
  finalNotes?: string;
  /** Free-text note explaining the amendment, printed under the attestation. */
  amendmentNote?: string;
  amendedAt: string;
  amendedBy: string;
}

/** The editable surface, before it is stamped with who and when. */
export type ReportAmendmentDraft = Omit<ReportAmendment, 'amendedAt' | 'amendedBy'>;

interface ReportDraftState {
  /** Keyed by inspection id — an officer may have several reports open. */
  amendments: Record<string, ReportAmendment>;

  get: (inspectionId: string) => ReportAmendment | undefined;
  save: (inspectionId: string, draft: ReportAmendmentDraft, amendedBy: string) => void;
  clear: (inspectionId: string) => void;
  reset: () => void;
}

export const useReportDraftStore = create<ReportDraftState>((set, get) => ({
  amendments: {},

  get(inspectionId) {
    return get().amendments[inspectionId];
  },

  save(inspectionId, draft, amendedBy) {
    const cleaned = pruneEmpty(draft);

    // An amendment that changes nothing is not an amendment. Dropping it keeps
    // "Amended" off a report where the officer opened the editor and backed out.
    if (Object.keys(cleaned).length === 0) {
      get().clear(inspectionId);
      return;
    }

    set((state) => ({
      amendments: {
        ...state.amendments,
        [inspectionId]: { ...cleaned, amendedAt: new Date().toISOString(), amendedBy },
      },
    }));
  },

  clear(inspectionId) {
    set((state) => {
      const next = { ...state.amendments };
      delete next[inspectionId];
      return { amendments: next };
    });
  },

  reset() {
    set({ amendments: {} });
  },
}));

/** Drops blank strings and an empty field map, so they never count as edits. */
function pruneEmpty(draft: ReportAmendmentDraft): ReportAmendmentDraft {
  const result: ReportAmendmentDraft = {};

  for (const [key, value] of Object.entries(draft)) {
    if (value === undefined || value === null) continue;

    if (key === 'fieldValues') {
      const values = value as Record<string, string>;
      const kept = Object.fromEntries(
        Object.entries(values).filter(([, entry]) => entry.trim().length > 0),
      );
      if (Object.keys(kept).length > 0) result.fieldValues = kept;
      continue;
    }

    if (typeof value === 'string' && value.trim().length === 0) continue;
    (result as Record<string, unknown>)[key] = value;
  }

  return result;
}

/**
 * Builds the editable starting point from a report.
 *
 * Pre-filled with what is on record rather than left blank, so the officer is
 * correcting a value they can see rather than retyping the whole document —
 * and so an untouched field saves as "unchanged" instead of as an amendment to
 * the empty string.
 */
export function draftFromReport(
  report: Report,
  existing?: ReportAmendment,
): ReportAmendmentDraft {
  const { details, analysis } = { ...report.snapshot, analysis: report.snapshot.analysis };

  const fieldValues: Record<string, string> = {};
  for (const field of analysis?.fields ?? []) {
    fieldValues[field.key] =
      existing?.fieldValues?.[field.key] ?? field.humanValue ?? field.aiValue ?? '';
  }

  return {
    businessName: existing?.businessName ?? details.businessName,
    location: existing?.location ?? details.location,
    district: existing?.district ?? details.district ?? '',
    state: existing?.state ?? details.state ?? '',
    productName: existing?.productName ?? details.productName ?? '',
    productCategory: existing?.productCategory ?? details.productCategory,
    fieldValues,
    inspectorNotes: existing?.inspectorNotes ?? details.inspectorNotes ?? '',
    finalNotes: existing?.finalNotes ?? report.snapshot.finalNotes ?? '',
    amendmentNote: existing?.amendmentNote ?? '',
  };
}

/**
 * Narrows a draft to only what actually differs from the record.
 *
 * Without this every save would record every field as amended, and the report
 * would print "amended from" beside values nobody touched.
 */
export function changedFields(
  report: Report,
  draft: ReportAmendmentDraft,
): ReportAmendmentDraft {
  const { details, analysis, finalNotes } = report.snapshot;
  const changed: ReportAmendmentDraft = {};

  const compare = <K extends keyof ReportAmendmentDraft>(
    key: K,
    original: string | undefined,
  ) => {
    const next = draft[key];
    if (typeof next !== 'string') return;
    if (next.trim() === (original ?? '').trim()) return;
    changed[key] = next.trim() as ReportAmendmentDraft[K];
  };

  compare('businessName', details.businessName);
  compare('location', details.location);
  compare('district', details.district);
  compare('state', details.state);
  compare('productName', details.productName);
  compare('inspectorNotes', details.inspectorNotes);
  compare('finalNotes', finalNotes);
  compare('amendmentNote', undefined);

  if (draft.productCategory && draft.productCategory !== details.productCategory) {
    changed.productCategory = draft.productCategory;
  }

  const fieldValues: Record<string, string> = {};
  for (const field of analysis?.fields ?? []) {
    const next = draft.fieldValues?.[field.key];
    if (next === undefined) continue;

    const original = field.humanValue ?? field.aiValue ?? '';
    if (next.trim() !== original.trim()) fieldValues[field.key] = next.trim();
  }
  if (Object.keys(fieldValues).length > 0) changed.fieldValues = fieldValues;

  return changed;
}
