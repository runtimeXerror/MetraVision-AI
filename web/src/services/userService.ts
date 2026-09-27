import type { InspectorActivity, User } from '@/types/api';

import { get, post } from './client';

export interface EnrolInspectorInput {
  name: string;
  email: string;
  role?: 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN';
  phone?: string;
  district?: string;
  state?: string;
}

export interface EnrolledInspector {
  user: User;
  /** Returned once and never stored in the clear. See `createInspector`. */
  temporaryPassword: string;
  /** `NOT_SENT` until the mail step exists; the console hands it over instead. */
  delivery: 'NOT_SENT' | 'SENT';
}

/**
 * Enrols an officer.
 *
 * No password is sent: the badge number and a temporary password are generated
 * on the server, and the password comes back in this one response because there
 * is nowhere else it can be read from afterwards.
 */
export function createInspector(input: EnrolInspectorInput): Promise<EnrolledInspector> {
  return post<EnrolledInspector>('/users', input);
}

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
