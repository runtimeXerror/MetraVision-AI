import type { Inspection } from '../types';

import { useAnalysisStore } from './analysisStore';
import { useImageStore } from './imageStore';
import { useInspectionStore } from './inspectionStore';

/**
 * ── PICKING UP A FILED-BUT-UNFINISHED INSPECTION ────────────────────────────
 *
 * An officer can leave declarations unreviewed. The finalize step offers it and
 * the Home screen counts what is waiting — "Pending Reviews", four hundred
 * pixels wide, tappable, opening the list of records that still need work.
 *
 * And then the trail stopped. The record opened read-only, with Close and Open
 * Report at the foot of it, and no way back into the review that the tile had
 * just sent the officer to do. The one number on the home screen that is a
 * to-do list led nowhere.
 *
 * It stopped there because the review flow reads from the capture stores — the
 * inspection being worked on, the photographs taken for it, the analysis that
 * came back — and a record opened from History populates none of them. All
 * three stores already know how to be filled from outside, because a resumed
 * draft needed exactly that; this is the second caller.
 *
 * ── What is deliberately not carried over ──────────────────────────────────
 *
 * `uploaded`, the local-id → server-id map, is left empty. There are no local
 * ids: these photographs were uploaded from some other device, or from this one
 * days ago, and inventing a mapping would be inventing a provenance.
 * `imageForRemoteId` already handles it — a hydrated image carries the server's
 * own id, and it falls through to matching on that.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function resumeInspection(inspection: Inspection): void {
  useInspectionStore.getState().hydrate({
    id: inspection.id,
    referenceId: inspection.referenceId,
    createdAt: inspection.createdAt,
    details: inspection.details,
  });

  useImageStore.getState().hydrate(inspection.images);

  if (inspection.analysis) {
    useAnalysisStore.getState().hydrate(inspection.analysis, inspection.scan ?? undefined);
  }
}
