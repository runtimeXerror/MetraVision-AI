import { Directory, File, Paths } from 'expo-file-system';

import type { InspectionDetails, ProductImage } from '../types';

/**
 * ── THE UNFINISHED INSPECTION ───────────────────────────────────────────────
 *
 * A capture in progress, written to the device so it survives the app dying.
 *
 * The case this exists for is the ordinary one in the field: an inspector is
 * three photographs into a package when the battery gives out, the OS reclaims
 * the app, or the signal drops in the middle of an upload. Before this, all of
 * that lived in memory — the business name they typed, the faces they had
 * already photographed, the category they picked — and the next launch began
 * from an empty form with the shopkeeper still standing there.
 *
 * Two rules govern it, and both are about not deciding for the inspector.
 *
 * **A draft is never filed by itself.** Nothing here submits, uploads or
 * finalises. Restoring a draft puts the officer back on the screen they left
 * with the data they had; every step after that is still theirs to take. An
 * inspection that filed itself because a phone rebooted would be an enforcement
 * record nobody chose to create.
 *
 * **A draft is never discarded by itself either.** It is cleared when the
 * inspector finishes the inspection or explicitly discards it, and at no other
 * time. Silently dropping work to keep the storage tidy is the same mistake in
 * the other direction.
 *
 * Written to the *document* directory rather than the cache: the cache is
 * exactly what the OS reclaims when a device is short of space, which is
 * disproportionately the moment this feature is needed.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Bumped when the shape changes, so an old draft is dropped and not misread. */
const DRAFT_VERSION = 1;

const DRAFT_FILE = 'inspection-draft.json';

export interface DraftSnapshot {
  version: number;
  /**
   * The inspector this draft belongs to.
   *
   * Checked before a draft is ever offered. Handsets are shared between
   * officers on a shift, and resuming somebody else's half-finished inspection
   * would attribute their work — and any finding that came out of it — to
   * whoever happened to sign in next.
   */
  inspectorId: string;
  /** Server id and reference, once step 1 has created the record. */
  id: string | null;
  referenceId: string | null;
  createdAt: string | null;
  details: InspectionDetails;
  images: ProductImage[];
  /**
   * Local image id → server image id, for photographs already uploaded.
   *
   * Carried in the draft so a resumed capture does not send them again — the
   * same duplication `imageStore.uploaded` exists to prevent, which a restart
   * would otherwise walk straight back into.
   */
  uploaded: Record<string, string>;
  /** Route the inspector was on, so they resume where they stopped. */
  step: DraftStep;
  savedAt: string;
}

export const DRAFT_STEPS = ['Capture', 'Quality', 'Analysis'] as const;
export type DraftStep = (typeof DRAFT_STEPS)[number];

export interface RestoredDraft {
  snapshot: DraftSnapshot;
  /**
   * Images whose files no longer exist on disk.
   *
   * Photographs live in the OS cache between capture and upload, and the OS is
   * free to clear it. They are reported rather than quietly dropped: an
   * inspector resuming a four-image capture needs to be told two are gone, or
   * they will finalise a record thinner than the one they built.
   */
  missingImages: number;
}

function draftFile(): File {
  return new File(new Directory(Paths.document), DRAFT_FILE);
}

/**
 * Writes the draft.
 *
 * Failures are swallowed deliberately. This runs on a debounce behind ordinary
 * typing, and a full disk must not surface as an error dialog over a form the
 * inspector is in the middle of — the cost of a failed write is the feature not
 * working, which is where they were before it existed.
 */
export async function saveDraft(snapshot: Omit<DraftSnapshot, 'version' | 'savedAt'>): Promise<void> {
  try {
    const payload: DraftSnapshot = {
      ...snapshot,
      version: DRAFT_VERSION,
      savedAt: new Date().toISOString(),
    };

    draftFile().write(JSON.stringify(payload));
  } catch {
    // Intentionally silent — see above.
  }
}

/**
 * Reads the draft back, if there is one for this inspector.
 *
 * Returns `null` rather than throwing for every reason a draft might not be
 * usable: none saved, written by an older version of the app, or belonging to
 * a different officer. A draft that cannot be trusted is the same as no draft.
 */
export async function readDraft(inspectorId: string): Promise<RestoredDraft | null> {
  let snapshot: DraftSnapshot;

  try {
    const file = draftFile();
    if (!file.exists) return null;

    snapshot = JSON.parse(await file.text()) as DraftSnapshot;
  } catch {
    return null;
  }

  if (snapshot?.version !== DRAFT_VERSION) return null;
  if (snapshot.inspectorId !== inspectorId) return null;
  if (!Array.isArray(snapshot.images)) return null;

  // A draft holding nothing is not worth offering to resume.
  const hasContent =
    snapshot.images.length > 0 ||
    snapshot.details?.businessName?.trim() !== '' ||
    snapshot.details?.location?.trim() !== '';
  if (!hasContent) return null;

  /**
   * Drop photographs whose files have gone.
   *
   * Checked here rather than at render time, so the capture screen is never
   * handed a URI that will fail to load and show as a grey box the inspector
   * cannot diagnose.
   */
  const surviving: ProductImage[] = [];
  for (const image of snapshot.images) {
    try {
      if (new File(image.uri).exists) surviving.push(image);
    } catch {
      // An unreadable URI counts as missing.
    }
  }

  return {
    snapshot: { ...snapshot, images: surviving, uploaded: snapshot.uploaded ?? {} },
    missingImages: snapshot.images.length - surviving.length,
  };
}

/** Removes the draft. Called on finish or on an explicit discard, never on a timer. */
export async function clearDraft(): Promise<void> {
  try {
    const file = draftFile();
    if (file.exists) file.delete();
  } catch {
    // A draft that will not delete is re-offered next launch, which is
    // recoverable; throwing here would break the flow that was completing.
  }
}
