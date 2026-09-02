import type { AuthSession, HealthInfo, User } from '@/types/api';

import { get, post, patch } from './client';
import { clearSession, readSession, writeSession, writeUser } from './session';

/**
 * Authentication.
 *
 * The dashboard uses the *same* backend authentication as the mobile app —
 * there is deliberately no second identity system. A supervisor's credentials
 * work in both, and revoking an account revokes it everywhere.
 */

export async function login(identifier: string, password: string): Promise<AuthSession> {
  const session = await post<AuthSession>('/auth/login', { identifier, password });
  writeSession(session);
  return session;
}

/**
 * Confirms a stored session is still valid.
 *
 * Called once on boot. Returns the *server's* copy of the user rather than the
 * cached one, so a role or status changed since sign-in takes effect on the
 * next page load instead of persisting until the token expires.
 */
export async function restore(): Promise<User | null> {
  if (!readSession()) return null;

  const user = await get<User>('/auth/me');
  writeUser(user);
  return user;
}

export async function logout(): Promise<void> {
  const session = readSession();
  try {
    await post('/auth/logout', session?.refreshToken ? { refreshToken: session.refreshToken } : {});
  } catch {
    // A failed revoke must not trap the user in the app; the local session is
    // cleared either way.
  }
  clearSession();
}

export function getProfile(): Promise<User> {
  return get<User>('/users/me');
}

export async function updateProfile(input: Partial<Pick<User, 'name' | 'phone' | 'zone' | 'district' | 'state'>>): Promise<User> {
  const user = await patch<User>('/users/me', input);
  writeUser(user);
  return user;
}

export function changePassword(currentPassword: string, newPassword: string): Promise<unknown> {
  return post('/users/me/password', { currentPassword, newPassword });
}

/** Backs the connectivity indicator in Settings. */
export function health(): Promise<HealthInfo> {
  return get<HealthInfo>('/health');
}
