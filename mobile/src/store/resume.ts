import type { Inspection } from '../types';

import { fieldsNeedingReview, useAnalysisStore } from './analysisStore';
import { useImageStore } from './imageStore';
import { useInspectionStore } from './inspectionStore';

/**
 * ── PICKING UP A FILED-BUT-UNFINISHED INSPECTION ────────────────────────────
 *
 * An officer can leave declarations unconfirmed. The finalize step offers it,
 * and History lists the records that were left that way.
 *
 * And then the trail stopped. The record opened read-only, with Close and Open
 * Report at the foot of it, and no way back into the work.
 *
 * It stopped there because the review flow reads from the capture stores — the
 * inspection being worked on, the photographs taken for it, the analysis that
 * came back — and a record opened from History populates none of them. All
 * three stores already know how to be filled from outside, because a resumed
 * draft needed exactly that; this is the second caller.
 * ────────────────────────────────────────────────────────────────────────────
 */
export function resumeInspection(inspection: Inspection): void {
  useInspectionStore.getState().hydrate({
    id: inspection.id,
    referenceId: inspection.referenceId,
    createdAt: inspection.createdAt,
    details: inspection.details,
  });

  /*
   * ── EVERY PHOTOGRAPH ON THIS RECORD IS ALREADY ON THE SERVER ────────────
   *
   * `uploaded` maps a local image id to the server id it was sent as, and the
   * quality step uploads whatever is missing from it. This map used to be left
   * empty on a resume, on the reasoning that these photographs were never
   * uploaded *from this device* and inventing a mapping would be inventing a
   * provenance.
   *
   * That held only while a resume could not reach the quality step. Now that
   * an unfinished capture resumes where it stopped, an empty map means every
   * photograph the record already carries is re-sent the moment the officer
   * presses Continue — the exact duplication the quality screen's own filter
   * exists to prevent, arriving by a different door.
   *
   * And nothing is being invented. `toProductImage` files each image under the
   * server's own `imageId`, so id and remote id are the same string here: the
   * identity mapping is the literal truth, and it is what `imageForRemoteId`
   * already falls back to when it finds no mapping at all.
   */
  const uploaded: Record<string, string> = {};
  for (const image of inspection.images) uploaded[image.id] = image.id;

  useImageStore.getState().hydrate(inspection.images, uploaded);

  // The ratings are computed on the device and never travel with the record,
  // so a resumed set arrives without them — and the quality step, which is
  // where an unanalysed record picks up, would draw its panel empty.
  useImageStore.getState().assessQuality();

  if (inspection.analysis) {
    useAnalysisStore.getState().hydrate(inspection.analysis, inspection.scan ?? undefined);
  }
}

/** Where an unfinished record has to be re-entered. */
export type ResumeStep = 'Capture' | 'Quality' | 'Review' | 'Finalize';

/**
 * ── WHERE AN INTERRUPTED INSPECTION PICKS UP ────────────────────────────────
 *
 * Every unfiled record used to lead to one of two places: the review, if the
 * engine had left declarations unsettled, and otherwise the filing step. The
 * second branch is where it broke, because "no declarations to review" is true
 * of a record that has been fully reviewed *and* of one that never got as far
 * as being analysed at all.
 *
 * So an inspection abandoned at the camera — the app closed, the battery gone,
 * a call taken — came back offering "File this inspection", and filing it
 * opened a screen that said "Inspection incomplete. Complete the capture and
 * analysis steps before finalizing", with a Back button. The record could be
 * seen and could not be continued, and there was no other way in: the capture
 * flow starts a new inspection, which is not this one.
 *
 * The step is derived from what the record actually holds rather than from
 * anything remembered about the session that made it, because the session is
 * exactly what was lost:
 *
 *   · no photographs — it stopped at the camera;
 *   · photographs but no analysis — they were taken and never sent;
 *   · an analysis with declarations outstanding — the review;
 *   · everything settled — the filing step, which is where it always went.
 *
 * The one thing this cannot recover is a photograph taken and not uploaded
 * before the app closed: it was never on the record to be read back. The
 * officer is returned to the camera with the premises already filled in, which
 * is the most that can honestly be offered.
 */
export function resumeStepFor(inspection: Inspection): ResumeStep {
  if (inspection.images.length === 0) return 'Capture';
  if (!inspection.analysis) return 'Quality';
  if (fieldsNeedingReview(inspection.analysis).length > 0) return 'Review';
  return 'Finalize';
}
