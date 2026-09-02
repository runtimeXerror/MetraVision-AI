import { create } from 'zustand';

import { toApiError } from '../services/api';
import { createInspection, updateInspection } from '../services/inspectionService';
import type { ApiError, InspectionDetails, ProductCategory } from '../types';

/**
 * The inspection currently being captured.
 *
 * Only the draft lives here — completed records belong to `historyStore`. The
 * split matters: the capture flow mutates this store on every keystroke, and a
 * list of finished inspections should not re-render because of that.
 *
 * Phase 2 change: the record is created on the backend when the inspector
 * leaves step 1, so `id` and `referenceId` are the server's. Everything after
 * that step addresses the record by its server id.
 */

interface InspectionState {
  /** Server id, once the draft has been created. */
  id: string | null;
  /** Server-issued reference, e.g. `INS-2026-00001`. */
  referenceId: string | null;
  createdAt: string | null;
  details: InspectionDetails;
  /** Populated at the finalize step. */
  finalNotes: string;
  /** Validation errors keyed by field name. */
  errors: Partial<Record<keyof InspectionDetails, string>>;
  /** True while the create/update call is in flight. */
  saving: boolean;
  error: ApiError | null;

  setDetail: <K extends keyof InspectionDetails>(key: K, value: InspectionDetails[K]) => void;
  setCategory: (category: ProductCategory | undefined) => void;
  setFinalNotes: (notes: string) => void;
  setErrors: (errors: InspectionState['errors']) => void;
  /**
   * Creates the record on the backend, or updates it if the inspector went
   * back and edited step 1. Returns the server id, or null on failure.
   */
  persist: () => Promise<string | null>;
  /**
   * Restores a saved draft.
   *
   * Deliberately does not touch `errors` or `saving`: those describe the
   * current session's attempt to submit, not the work being restored, and a
   * validation error carried over from before a crash would point at a field
   * the inspector has not touched yet.
   */
  hydrate: (draft: {
    id: string | null;
    referenceId: string | null;
    createdAt: string | null;
    details: InspectionDetails;
  }) => void;
  clearError: () => void;
  reset: () => void;
}

const EMPTY_DETAILS: InspectionDetails = {
  businessName: '',
  location: '',
  productCategory: undefined,
  productName: '',
  inspectorNotes: '',
};

export const useInspectionStore = create<InspectionState>((set, get) => ({
  id: null,
  referenceId: null,
  createdAt: null,
  details: EMPTY_DETAILS,
  finalNotes: '',
  errors: {},
  saving: false,
  error: null,

  setDetail(key, value) {
    set((state) => ({
      details: { ...state.details, [key]: value },
      // Clearing the error as the inspector types keeps the form from nagging.
      errors: { ...state.errors, [key]: undefined },
    }));
  },

  setCategory(category) {
    set((state) => ({ details: { ...state.details, productCategory: category } }));
  },

  setFinalNotes(finalNotes) {
    set({ finalNotes });
  },

  setErrors(errors) {
    set({ errors });
  },

  async persist() {
    const { id, details } = get();
    set({ saving: true, error: null });

    try {
      // Going back to step 1 and continuing again must not create a second
      // record, so an existing draft is patched rather than re-created.
      const inspection = id
        ? await updateInspection(id, details)
        : await createInspection(details);

      set({
        id: inspection.id,
        referenceId: inspection.referenceId,
        createdAt: inspection.createdAt,
        saving: false,
      });

      return inspection.id;
    } catch (error) {
      set({ error: toApiError(error), saving: false });
      return null;
    }
  },

  hydrate(draft) {
    set({
      id: draft.id,
      referenceId: draft.referenceId,
      createdAt: draft.createdAt,
      details: draft.details,
      errors: {},
      error: null,
      saving: false,
    });
  },

  clearError() {
    set({ error: null });
  },

  reset() {
    set({
      id: null,
      referenceId: null,
      createdAt: null,
      details: EMPTY_DETAILS,
      finalNotes: '',
      errors: {},
      saving: false,
      error: null,
    });
  },
}));
