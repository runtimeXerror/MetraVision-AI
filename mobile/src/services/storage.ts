import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Inspection } from '../types';

/**
 * Credentials.
 *
 * Tokens and the stored session go through `expo-secure-store` (Keychain /
 * Keystore). Nothing else belongs in here.
 *
 * ── WHERE THE OTHER KINDS OF PERSISTENCE LIVE ───────────────────────────────
 *
 *   - `offlineCache` / `offlineRegister` — the officer's register, reports and
 *     label photographs, written to the document directory so every *read* in
 *     the app works with no connection.
 *   - `draftService` — one unfinished capture, so a form survives the app dying
 *     mid-inspection.
 *
 * Both are reads and drafts. Neither files anything.
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

/* ── Offline queue (still an abstraction, and deliberately so) ────────────── */

/**
 * ── WHY OFFLINE *WRITES* WERE NOT BUILT ─────────────────────────────────────
 *
 * Offline reading is implemented — `offlineCache` holds the register, the
 * reports and their photographs, and every screen serves from it when there is
 * no signal. Filing deliberately stops at the network's edge, and this queue
 * stays a stub.
 *
 * Three of the four things an inspection needs are not on the phone. The
 * reference number is issued by the server and is what makes the record
 * citable. The photographs are read by the PaddleOCR service. The verdict is
 * made by the Legal Metrology rule engine against a rule set that is versioned
 * server-side. A queued inspection would be a record with no reference, no
 * extraction and no finding — and it would file itself, unattended, from
 * wherever the officer's phone happened to regain signal, hours after they left
 * the premises and with nobody present to stand behind it.
 *
 * That is not a caching problem, it is an evidentiary one. If offline filing is
 * wanted later it needs a design of its own: provisional local references
 * reconciled on sync, a queued record that is visibly *not yet filed*, and a
 * rule about who is accountable for a finding produced by a machine after the
 * fact. None of that should be arrived at by extending a cache.
 * ────────────────────────────────────────────────────────────────────────────
 */

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
