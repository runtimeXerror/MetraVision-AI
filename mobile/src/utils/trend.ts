import type { TrendPoint } from '../types';

import { formatShortDate } from './format';

/**
 * Trend bucketing.
 *
 * A year of daily points cannot be drawn on a phone: at 365 columns each mark
 * is sub-pixel, and what renders is noise rather than a trend. Days are summed
 * into at most `maxBuckets` groups instead — summed, never sampled, because
 * dropping days would hide exactly the quiet stretches a supervisor is looking
 * for.
 *
 * Pure and dependency-free, so the same buckets back the on-screen chart and
 * the exported document and the two cannot disagree.
 */

export interface TrendBucket {
  key: string;
  label: string;
  total: number;
  violations: number;
  /** Inclusive span the bucket covers, for the exported table. */
  from: string;
  to: string;
}

export function bucketTrend(points: TrendPoint[], maxBuckets = 14): TrendBucket[] {
  if (points.length === 0) return [];

  const size = Math.max(1, Math.ceil(points.length / maxBuckets));
  const buckets: TrendBucket[] = [];

  for (let start = 0; start < points.length; start += size) {
    const slice = points.slice(start, start + size);
    const first = slice[0]!;
    const last = slice[slice.length - 1]!;

    buckets.push({
      key: first.date,
      label: formatShortDate(first.date),
      total: slice.reduce((sum, point) => sum + point.total, 0),
      violations: slice.reduce((sum, point) => sum + point.violations, 0),
      from: first.date,
      to: last.date,
    });
  }

  return buckets;
}

/** `per day` / `per 7 days` — names what one column actually counts. */
export function bucketCaption(points: TrendPoint[], buckets: TrendBucket[]): string {
  if (buckets.length === 0) return 'Inspections';
  const span = Math.max(1, Math.round(points.length / buckets.length));
  return span === 1 ? 'Inspections per day' : `Inspections per ${span} days`;
}
