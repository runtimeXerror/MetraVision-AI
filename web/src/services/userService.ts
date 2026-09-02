import type { InspectorActivity, User } from '@/types/api';

import { get } from './client';

/**
 * Users.
 *
 * The roster is a supervisory view and the backend refuses it below SUPERVISOR,
 * so the inspectors page is route-guarded to match — the guard is a courtesy to
 * the user, not the security boundary.
 */

export function listUsers(): Promise<User[]> {
  return get<User[]>('/users');
}

/**
 * Per-inspector metrics.
 *
 * Served by the analytics aggregation rather than the roster, because it is
 * driven from the user collection outward: an inspector who has filed nothing
 * still appears, which is exactly the row a supervisor needs to notice.
 */
export function listInspectorActivity(filters: Record<string, unknown> = {}): Promise<InspectorActivity[]> {
  return get<InspectorActivity[]>('/analytics/inspector-activity', filters);
}
