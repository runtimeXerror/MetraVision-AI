import type { AuthSession, User } from '@/types/api';

/**
 * Session storage.
 *
 * `sessionStorage`, not `localStorage`: this is a shared-workstation tool in a
 * departmental office, and a token that survives the browser closing is a token
 * that outlives the person who signed in. The cost is re-authenticating in a
 * new tab, which is the correct trade for an enforcement console.
 *
 * Reads are wrapped because a browser with site data blocked throws on access
 * rather than returning null.
 */

const KEY = 'metravision.session';

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
}

export function readSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

export function writeSession(session: AuthSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // A blocked store is not fatal — the session simply lasts for this page.
  }
}

/** Replaces just the tokens after a refresh, keeping the cached user. */
export function writeTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}): void {
  const current = readSession();
  if (!current) return;
  writeSession({ ...current, ...tokens });
}

/** Updates the cached user after a profile read, keeping the tokens. */
export function writeUser(user: User): void {
  const current = readSession();
  if (!current) return;
  writeSession({ ...current, user });
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
