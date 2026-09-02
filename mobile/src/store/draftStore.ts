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
 * ── RESUME OR START FRESH ───────────────────────────────────────────────────
 *
 * Holds the draft found at launch, and the two things an inspector can do
 * about it.
 *
 * The decision is deliberately theirs. The app does not resume automatically —
 * an officer who has moved to a different shop should not find the previous
 * package's business name already in the form — and it does not discard
 * automatically either. It reports what it found and waits.
 *
 * The autosave is a subscription rather than a call sprinkled through the
 * capture screens. Screens that have to remember to save are screens that
 * eventually forget, and the one that forgets is the one an inspector loses
 * work on.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface DraftState {
  /** The unfinished inspection found at launch, until acted on. */
  pending: RestoredDraft | null;
  /** True once the check has run, so the UI does not flash a resume card. */
  checked: boolean;
  /** The step the autosave records. Set by each capture screen on focus. */
  step: DraftStep;

  check: (inspectorId: string) => Promise<void>;
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

  async check(inspectorId) {
    const pending = await readDraft(inspectorId);
    set({ pending, checked: true });
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
  inspectorId = id;

  const unsubscribeInspection = useInspectionStore.subscribe(scheduleSave);
  const unsubscribeImages = useImageStore.subscribe(scheduleSave);

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    inspectorId = null;
    unsubscribeInspection();
    unsubscribeImages();
  };
}
