import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Inspection } from '../types';

/**
 * Persistence.
 *
 * Two tiers, deliberately separated:
 *
 *   - Credentials go through `expo-secure-store` (Keychain / Keystore).
 *   - Everything else is queued in memory for now.
 *
 * The offline queue below is the *abstraction* Phase 2 needs, not a full sync
 * engine. It records the intent to submit an inspection so that a later phase
 * can drain it against the backend:
 *
 *     Capture offline  ->  Local queue  ->  Sync  ->  Backend
 *
 * Building the real thing now would mean guessing at conflict-resolution rules
 * the backend has not defined yet, so the queue is intentionally shallow.
 */

const TOKEN_KEY = 'lm.auth.token';
const REFRESH_KEY = 'lm.auth.refresh';
const SESSION_KEY = 'lm.auth.session';

/**
 * SecureStore has no web implementation. Falling back to an in-memory map keeps
 * `expo start --web` usable for demos without pretending the value is secure.
 */
const memoryStore = new Map<string, string>();
const isSecureStoreAvailable = Platform.OS !== 'web';

async function setItem(key: string, value: string): Promise<void> {
  if (!isSecureStoreAvailable) {
    memoryStore.set(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function getItem(key: string): Promise<string | null> {
  if (!isSecureStoreAvailable) return memoryStore.get(key) ?? null;
  return SecureStore.getItemAsync(key);
}

async function removeItem(key: string): Promise<void> {
  if (!isSecureStoreAvailable) {
    memoryStore.delete(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/* ── Session ──────────────────────────────────────────────────────────────── */

export async function saveToken(token: string): Promise<void> {
  await setItem(TOKEN_KEY, token);
}

/**
 * Stores both tokens plus the access token's expiry.
 *
 * Written together so a refresh can never leave the pair inconsistent — an
 * access token from one session beside a refresh token from another.
 */
export async function saveTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}): Promise<void> {
  await Promise.all([
    setItem(TOKEN_KEY, tokens.accessToken),
    setItem(REFRESH_KEY, tokens.refreshToken),
  ]);

  // Keep the stored session's tokens in step, so a cold start restores the
  // refreshed pair rather than the one it was issued with.
  const session = await getSession<Record<string, unknown>>();
  if (session) {
    await saveSession({ ...session, ...tokens });
  }
}

export async function getRefreshToken(): Promise<string | null> {
  try {
    return await getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

export async function getToken(): Promise<string | null> {
  try {
    return await getItem(TOKEN_KEY);
  } catch {
    // A corrupt keystore entry must not prevent the app from starting.
    return null;
  }
}

export async function saveSession(session: unknown): Promise<void> {
  await setItem(SESSION_KEY, JSON.stringify(session));
}

export async function getSession<T>(): Promise<T | null> {
  try {
    const raw = await getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await Promise.all([removeItem(TOKEN_KEY), removeItem(REFRESH_KEY), removeItem(SESSION_KEY)]);
}

/* ── Offline queue (abstraction only) ─────────────────────────────────────── */

export interface QueuedInspection {
  id: string;
  inspection: Inspection;
  queuedAt: string;
  attempts: number;
  lastError?: string;
}

const pendingQueue: QueuedInspection[] = [];

export const offlineQueue = {
  /** Records an inspection that could not be submitted. */
  enqueue(inspection: Inspection): QueuedInspection {
    const entry: QueuedInspection = {
      id: inspection.id,
      inspection,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    };
    pendingQueue.push(entry);
    return entry;
  },

  list(): QueuedInspection[] {
    return [...pendingQueue];
  },

  size(): number {
    return pendingQueue.length;
  },

  remove(id: string): void {
    const index = pendingQueue.findIndex((entry) => entry.id === id);
    if (index >= 0) pendingQueue.splice(index, 1);
  },

  /**
   * Drains the queue against the backend.
   *
   * Still a no-op: Phase 2 submits every inspection directly, so nothing is
   * ever enqueued. The shape is kept because offline capture is a genuine
   * field requirement, and the screens already read `size()`. Implementing it
   * means calling this on reconnect and replaying each entry through
   * `inspectionService`, with backoff and conflict handling.
   */
  async sync(): Promise<{ synced: number; failed: number }> {
    return { synced: 0, failed: pendingQueue.length };
  },
};
