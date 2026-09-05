import { ApiError, type AuthSession, type LoginRequest } from '../types';

import { request } from './api';
import { clearOfflineCache } from './offlineCache';
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
 * ── COLD START, IN TWO STEPS ────────────────────────────────────────────────
 *
 * Reading the stored session and confirming it with the server used to be one
 * call, and the navigator waited on all of it before rendering anything.
 *
 * That is fine on a desk. In the field it was the whole problem: with no
 * signal, `/auth/me` sat on the full request timeout before failing, and the
 * app showed twenty seconds of splash screen and *then* the officer's own
 * records — which had been on the device the entire time. To anyone holding
 * the phone, the app had simply not started.
 *
 * So the two halves are separated, and only the first one gates the UI.
 *
 *   1. `readStoredSession` — the device's own copy. No network, no waiting.
 *   2. `verifySession`     — the server's verdict on it, in the background.
 *
 * Trusting the device first is not a weakening of the check. The session is
 * still confirmed on every launch, and a revoked or suspended account is still
 * signed out the moment the server says so; the difference is that the officer
 * is looking at their register while that happens instead of at a spinner. The
 * tokens themselves are signed and short-lived, so the stored copy cannot
 * outlive its own authority for long, and no *write* can succeed on a session
 * the server has stopped accepting — only reading what the phone already had.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** How long the background session check waits. See `verifySession`. */
const SESSION_VERIFY_TIMEOUT_MS = 8_000;

/**
 * The stored session, straight off the device.
 *
 * Returns `null` when there is nothing stored — a signed-out start is not an
 * error condition. Never touches the network, so it resolves in the same frame
 * whether or not there is a connection.
 */
export async function readStoredSession(): Promise<AuthSession | null> {
  return getSession<AuthSession>();
}

/** What the server said about the identity the device is holding. */
export type SessionVerdict =
  /** Confirmed, with the server's copy of the inspector record. */
  | { status: 'valid'; inspector: AuthSession['inspector'] }
  /** Refused — the account is gone, suspended, or the tokens are dead. */
  | { status: 'rejected' }
  /** The server could not be reached. Says nothing about the session. */
  | { status: 'unreachable' };

/**
 * Confirms the stored identity against `/auth/me`.
 *
 * An access token that has lapsed is not a rejection: the refresh token usually
 * outlives it by weeks, and `api.ts` refreshes and replays transparently. Only
 * an answer from the server saying *no* counts.
 *
 * A short leash on purpose. This runs behind an app the officer is already
 * using; leaving it on the full timeout would hold a request open across the
 * first screen they interact with, for a check whose result — on a bad
 * connection — is going to be `unreachable` either way.
 */
export async function verifySession(): Promise<SessionVerdict> {
  try {
    const user = await request<UserDTO>('/auth/me', { timeoutMs: SESSION_VERIFY_TIMEOUT_MS });
    const inspector = toInspector(user);

    const stored = await getSession<AuthSession>();
    if (stored) await saveSession({ ...stored, inspector });

    return { status: 'valid', inspector };
  } catch (error) {
    const apiError = error as ApiError;

    // Only a rejected identity clears the session. A network failure must not
    // sign an inspector out — they may be mid-inspection with no signal, and
    // signing them out would take their register with it.
    if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
      await clearSession();
      return { status: 'rejected' };
    }

    return { status: 'unreachable' };
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

  // And the register that was cached for offline reading. Handsets are shared
  // on a shift: every cached entry is owner-checked before it is served, but
  // refusing to read a file is not the same as not leaving it on the device.
  clearOfflineCache();
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
