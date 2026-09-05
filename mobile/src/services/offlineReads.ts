import { useAuthStore } from '../store/authStore';
import type { Inspection, Report } from '../types';

import { getInspection } from './inspectionService';
import { ensureImageCached, readThrough, type ReadThroughResult } from './offlineCache';
import { getReport } from './reportService';

/**
 * The two single-record reads, backed by the device.
 *
 * `historyStore` owns the list; these two are the screens that open one record,
 * and they are the ones that matter most in the field. An officer standing in
 * front of a dealer, arguing about a finding from last month, is not going to
 * be somewhere with signal — they are going to be in the same godown where the
 * finding was made.
 *
 * Both return the read-through result rather than the bare value, so the screen
 * can say *this is the copy saved at 09:14 this morning* instead of presenting
 * a stored record as a live one.
 */

/** Whose records these are. Null when nobody is signed in. */
function owner(): string | null {
  return useAuthStore.getState().inspector?.id ?? null;
}

/** One whole inspection, cached on the way past. */
export async function loadInspection(id: string): Promise<ReadThroughResult<Inspection>> {
  const inspectorId = owner();

  if (!inspectorId) {
    return { data: await getInspection(id), fromCache: false, savedAt: null };
  }

  const result = await readThrough({
    key: `inspection:${id}`,
    owner: inspectorId,
    fetch: () => getInspection(id),
  });

  if (!result.fromCache) void cacheImages(result.data);
  return result;
}

/**
 * One report, cached on the way past.
 *
 * The report is a snapshot the backend takes at issue time, which is exactly
 * what makes it safe to keep: re-reading it from the device next month
 * reproduces the document that was issued, not a re-render of a record that has
 * moved on since.
 */
export async function loadReport(id: string): Promise<ReadThroughResult<Report>> {
  const inspectorId = owner();

  if (!inspectorId) {
    return { data: await getReport(id), fromCache: false, savedAt: null };
  }

  const result = await readThrough({
    key: `report:${id}`,
    owner: inspectorId,
    fetch: () => getReport(id),
  });

  if (!result.fromCache) void cacheImages(result.data.snapshot);
  return result;
}

/**
 * Pulls the record's label photographs down beside it.
 *
 * Only after a *live* read, and never awaited. A report whose evidence images
 * are grey boxes is not the document an officer shows a dealer — but neither is
 * one that took ten seconds to open because it was fetching four megabytes of
 * JPEG before rendering. So the record paints immediately and the photographs
 * arrive behind it, which is also exactly what happens today over the network.
 *
 * Sequential rather than parallel, matching `uploadImages` and for the same
 * reason: four simultaneous multi-megabyte transfers on a field connection is
 * how you get four timeouts instead of four images.
 */
async function cacheImages(inspection: Inspection): Promise<void> {
  for (const image of inspection.images) {
    if (!image.uri) continue;
    await ensureImageCached(image.uri);
  }
}
