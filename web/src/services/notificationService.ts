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

export async function list(): Promise<AppNotification[]> {
  return buildFromSummary(await getSummary());
}
