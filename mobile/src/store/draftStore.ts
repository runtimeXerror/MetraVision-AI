import { create } from 'zustand';

import {
  clearDraft,
  readDraft,
  saveDraft,
  type DraftStep,
  type RestoredDraft,
} from '../services/draftService';

import { useImageStore } from './imageStore';
import { useInspectionStore } from './inspectionStore';

/**
 * ── AN INTERRUPTED CAPTURE IS NOT RESUMED ───────────────────────────────────
 *
 * Closing the app part-way through an inspection abandons it. Reopening starts
 * a new one, with an empty form.
 *
 * This used to persist the capture and offer to continue it. That is the wrong
 * default for this particular job: an inspection is a record of one officer at
 * one premises at one time, and the gap across an app restart is unbounded —
 * the officer may have left the shop, or the day. Restoring a half-finished
 * capture invites a photograph taken at one address to be filed against
 * another, and a report is evidence, so a stale field is worse than an absent
 * one.
 *
 * So any draft left behind is cleared at launch rather than offered. Nothing
 * asks the inspector to make this judgement, because the safe answer is always
 * the same one.
 *
 * The store and `draftService` are kept — the writing side is simply switched
 * off — so this is a decision that can be revisited without rebuilding the
 * capture flow. `resume()` has no caller and stays only for that.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface DraftState {
  /** The unfinished inspection found at launch, until acted on. */
  pending: RestoredDraft | null;
  /** True once the check has run, so the UI does not flash a resume card. */
  checked: boolean;
  /** The step the autosave records. Set by each capture screen on focus. */
  step: DraftStep;

  /** Clears anything left by a previous session. Called once at launch. */
  discardStale: () => Promise<void>;
  setStep: (step: DraftStep) => void;
  /** Loads the draft back into the capture stores. Returns where to navigate. */
  resume: () => DraftStep | null;
  /** Throws the draft away. The inspector asked; nothing else calls this. */
  discard: () => Promise<void>;
  /** Called when an inspection is filed, so a finished capture stops resurfacing. */
  complete: () => Promise<void>;
  reset: () => void;
}

export const useDraftStore = create<DraftState>((set, get) => ({
  pending: null,
  checked: false,
  step: 'Capture',

  async discardStale() {
    // Not read back first. Whatever it holds is being thrown away, and reading
    // it would only put a previous premises' details somewhere they could be
    // shown by mistake.
    await clearDraft();
    set({ pending: null, checked: true });
  },

  setStep(step) {
    if (get().step === step) return;
    set({ step });
  },

  resume() {
    const pending = get().pending;
    if (!pending) return null;

    const { snapshot } = pending;

    useInspectionStore.getState().hydrate({
      id: snapshot.id,
      referenceId: snapshot.referenceId,
      createdAt: snapshot.createdAt,
      details: snapshot.details,
    });
    useImageStore.getState().hydrate(snapshot.images, snapshot.uploaded);

    set({ pending: null, step: snapshot.step });
    return snapshot.step;
  },

  async discard() {
    await clearDraft();
    // The capture stores are cleared too, or a discarded draft's details would
    // still be sitting in the form the inspector starts fresh from.
    useInspectionStore.getState().reset();
    useImageStore.getState().reset();
    set({ pending: null, step: 'Capture' });
  },

  async complete() {
    await clearDraft();
    set({ pending: null, step: 'Capture' });
  },

  reset() {
    set({ pending: null, checked: false, step: 'Capture' });
  },
}));

/* ── Autosave ─────────────────────────────────────────────────────────────── */

/**
 * Debounce, so a form does not write a file on every keystroke.
 *
 * Long enough to coalesce typing, short enough that the window in which work
 * can be lost is smaller than the time it takes to notice a phone has died.
 */
const AUTOSAVE_DEBOUNCE_MS = 800;

let timer: ReturnType<typeof setTimeout> | null = null;
let inspectorId: string | null = null;

function scheduleSave(): void {
  if (!inspectorId) return;
  if (timer) clearTimeout(timer);

  timer = setTimeout(() => {
    const inspection = useInspectionStore.getState();
    const images = useImageStore.getState().images;

    // Nothing worth restoring yet: an empty form is not a draft, and writing
    // one would make the resume card appear after merely opening the tab.
    const started =
      images.length > 0 ||
      inspection.details.businessName.trim() !== '' ||
      inspection.details.location.trim() !== '';

    if (!started) return;

    void saveDraft({
      inspectorId: inspectorId!,
      id: inspection.id,
      referenceId: inspection.referenceId,
      createdAt: inspection.createdAt,
      details: inspection.details,
      images,
      uploaded: useImageStore.getState().uploaded,
      step: useDraftStore.getState().step,
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Starts watching the capture stores for the signed-in inspector.
 *
 * Called on sign-in and torn down on sign-out — the subscriptions are what
 * write the draft, and one left running after a sign-out would attribute the
 * next officer's typing to the previous one's id.
 */
export function startDraftAutosave(id: string): () => void {
  /**
   * Switched off.
   *
   * An interrupted capture is no longer resumed (see the note at the top of
   * this file), so writing the draft would only leave a previous premises'
   * details on disk for something to read back by mistake. The subscriptions
   * below are what would write it; they are left in place, unused, because the
   * decision not to resume is a policy one and this is where it is undone.
   *
   *   const unsubscribeInspection = useInspectionStore.subscribe(scheduleSave);
   *   const unsubscribeImages = useImageStore.subscribe(scheduleSave);
   *
   * `scheduleSave` and `saveDraft` are referenced here so the compiler still
   * type-checks them, rather than letting them rot into code that no longer
   * compiles by the time anyone wants it back.
   */
  void id;
  void scheduleSave;

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    inspectorId = null;
  };
}
