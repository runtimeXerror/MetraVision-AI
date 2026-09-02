import { ApiError, type AuthSession, type LoginRequest } from '../types';

import { request } from './api';
import { toAuthSession, toInspector, type AuthSessionDTO, type UserDTO } from './mappers';
import { clearSession, getSession, saveSession, saveToken, saveTokens } from './storage';

/**
 * Authentication.
 *
 * Phase 2 talks to the backend; the session shape the store consumes is
 * unchanged from Phase 1, which is why no screen needed editing.
 */

async function persist(session: AuthSession): Promise<void> {
  await saveToken(session.token);
  if (session.refreshToken) {
    await saveTokens({
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
    });
  }
  await saveSession(session);
}

/**
 * Signs an inspector in.
 *
 * @throws {ApiError} kind `validation` for empty input, `unauthorized` for bad
 *         credentials, `network` when the backend is unreachable.
 */
export async function login(credentials: LoginRequest): Promise<AuthSession> {
  const identifier = credentials.identifier.trim();

  if (!identifier || !credentials.password) {
    throw new ApiError('validation', 'Enter your credentials to sign in.', { retryable: false });
  }

  const dto = await request<AuthSessionDTO>('/auth/login', {
    method: 'POST',
    body: { identifier, password: credentials.password },
    anonymous: true,
  });

  const session = toAuthSession(dto);
  await persist(session);
  return session;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthSession> {
  const dto = await request<AuthSessionDTO>('/auth/register', {
    method: 'POST',
    body: input,
    anonymous: true,
  });

  const session = toAuthSession(dto);
  await persist(session);
  return session;
}

/**
 * Restores a stored session on cold start.
 *
 * Returns `null` rather than throwing when nothing is stored or the session has
 * expired — a signed-out state is not an error condition.
 *
 * A stored session whose access token has lapsed is still worth keeping: the
 * refresh token usually outlives it by weeks, so the identity is confirmed
 * against `/auth/me`, which transparently refreshes through `api.ts`.
 */
export async function restoreSession(): Promise<AuthSession | null> {
  const stored = await getSession<AuthSession>();
  if (!stored) return null;

  try {
    const user = await request<UserDTO>('/auth/me');
    const session: AuthSession = { ...stored, inspector: toInspector(user) };
    await saveSession(session);
    return session;
  } catch (error) {
    const apiError = error as ApiError;

    // Only a rejected identity clears the session. A network failure must not
    // sign an inspector out — they may be mid-inspection with no signal.
    if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
      await clearSession();
      return null;
    }

    if (new Date(stored.expiresAt).getTime() > Date.now()) return stored;
    return stored;
  }
}

export async function logout(): Promise<void> {
  const stored = await getSession<AuthSession>();

  try {
    await request('/auth/logout', {
      method: 'POST',
      body: stored?.refreshToken ? { refreshToken: stored.refreshToken } : {},
    });
  } catch {
    // A failed revoke must not trap the inspector in the app; the local
    // session is cleared regardless.
  }

  await clearSession();
}

export async function getCurrentUser(): Promise<AuthSession['inspector']> {
  const user = await request<UserDTO>('/users/me');
  return toInspector(user);
}

export async function updateProfile(
  patch: Partial<{ name: string; phone: string; zone: string; district: string; state: string }>,
): Promise<AuthSession['inspector']> {
  const user = await request<UserDTO>('/users/me', { method: 'PATCH', body: patch });
  return toInspector(user);
}

export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await request('/users/me/password', {
    method: 'POST',
    body: { currentPassword, newPassword },
  });

  // The backend revokes every session on a password change.
  await clearSession();
}

/**
 * Password reset.
 *
 * Not implemented server-side in Phase 2 — the endpoint is planned alongside
 * the departmental mail relay. Throwing a clear message beats a silent success
 * that leaves an inspector waiting for an email that will never arrive.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  if (!email.trim()) {
    throw new ApiError('validation', 'Enter the email address on your account.', {
      retryable: false,
    });
  }

  throw new ApiError(
    'server',
    'Password reset is handled by your zonal supervisor in this release. Contact them to have your password reset.',
    { retryable: false },
  );
}
