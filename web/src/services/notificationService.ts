import type { DashboardSummary } from '@/types/api';

import { getSummary } from './dashboardService';

/**
 * Notifications.
 *
 * The backend has no notification store yet, and inventing one in the browser
 * would mean a bell that shows numbers nothing else in the system agrees with.
 *
 * So these are *derived* from live data rather than mocked: each item restates
 * a figure the API already reports and links to the page that proves it. When a
 * real notification endpoint exists, only `list()` changes — the shape and the
 * consumers stay as they are.
 */

export type NotificationTone = 'review' | 'violation' | 'info';

export interface AppNotification {
  id: string;
  tone: NotificationTone;
  title: string;
  detail: string;
  href: string;
}

export function buildFromSummary(summary: DashboardSummary): AppNotification[] {
  const items: AppNotification[] = [];

  if (summary.pendingReviews > 0) {
    items.push({
      id: 'pending-reviews',
      tone: 'review',
      title: `${summary.pendingReviews} inspection${summary.pendingReviews === 1 ? '' : 's'} awaiting review`,
      detail: 'Declarations were read with low confidence and need human verification.',
      href: '/reviews',
    });
  }

  if (summary.totalViolationFindings > 0) {
    items.push({
      id: 'violations',
      tone: 'violation',
      title: `${summary.totalViolationFindings} violation finding${summary.totalViolationFindings === 1 ? '' : 's'} on record`,
      detail: 'Across all inspections in the current filter range.',
      href: '/violations',
    });
  }

  if (summary.drafts > 0) {
    items.push({
      id: 'drafts',
      tone: 'info',
      title: `${summary.drafts} inspection${summary.drafts === 1 ? '' : 's'} still in draft`,
      detail: 'Started in the field but not yet submitted for analysis.',
      href: '/inspections?status=DRAFT',
    });
  }

  return items;
}

/**
 * ── THE BELL REPORTS A DAY, NOT ALL TIME ────────────────────────────────────
 *
 * This asked for the unfiltered summary, so the bell counted every draft and
 * every finding ever recorded. On a system a few weeks old that is a number
 * that only grows, and a badge that is permanently lit tells an officer
 * nothing about what changed since they last looked.
 *
 * A day is the window a shift actually works to.
 */
const WINDOW_HOURS = 24;

function since(): string {
  return new Date(Date.now() - WINDOW_HOURS * 60 * 60 * 1000).toISOString();
}

export async function list(): Promise<AppNotification[]> {
  return buildFromSummary(await getSummary({ from: since() }));
}

/* ── Clearing ─────────────────────────────────────────────────────────────── */

/**
 * These notifications are derived from live figures, not stored events, so
 * there is nothing on the server to mark as read — and inventing a store here
 * would give the bell a state the rest of the system does not share.
 *
 * Clearing is therefore what it honestly can be: this browser stops showing
 * *these* items. Two things bring them back, and both are deliberate.
 *
 *   · The figures change. The signature below is the ids and their counts, so
 *     a new finding or another draft is a different set and is shown again. A
 *     clear that survived new work would be a bell that hides the thing it
 *     exists to report.
 *   · A day passes, matching the window the bell reports on.
 */
const CLEARED_KEY = 'lm.notifications.cleared';

function signatureOf(items: AppNotification[]): string {
  return items.map((item) => `${item.id}:${item.title}`).join('|');
}

export function clear(items: AppNotification[]): void {
  try {
    localStorage.setItem(
      CLEARED_KEY,
      JSON.stringify({ at: Date.now(), signature: signatureOf(items) }),
    );
  } catch {
    // A browser with storage disabled simply keeps showing them, which is the
    // safe direction to fail in.
  }
}

export function isCleared(items: AppNotification[]): boolean {
  try {
    const raw = localStorage.getItem(CLEARED_KEY);
    if (!raw) return false;
    const { at, signature } = JSON.parse(raw) as { at: number; signature: string };
    if (Date.now() - at > WINDOW_HOURS * 60 * 60 * 1000) return false;
    return signature === signatureOf(items);
  } catch {
    return false;
  }
}
