import { create } from 'zustand';

import * as authService from '../services/authService';
import { toApiError } from '../services/api';
import type { ApiError, AuthSession, Inspector } from '../types';

/**
 * Authentication state.
 *
 * Deliberately the only store that survives a sign-out: everything else is
 * cleared by the navigator unmounting when `session` goes null.
 */

/** The subset of the inspector record the profile screen may edit. */
export type ProfilePatch = Partial<{
  name: string;
  phone: string;
  zone: string;
  district: string;
  state: string;
}>;

interface AuthState {
  session: AuthSession | null;
  inspector: Inspector | null;
  /** True while the stored session is being restored on cold start. */
  restoring: boolean;
  submitting: boolean;
  error: ApiError | null;
  /** Pull-to-refresh on the profile screen. Kept apart from `restoring`, which gates the navigator. */
  refreshingProfile: boolean;
  /**
   * Failures from `/users/me` only. A stale profile must not surface as a
   * sign-in error, so it never touches `error`.
   */
  profileError: ApiError | null;

  restore: () => Promise<void>;
  /** Background confirmation of a restored session. See `restore`. */
  verify: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
  refreshProfile: () => Promise<void>;
  updateProfile: (patch: ProfilePatch) => Promise<boolean>;
}

export const useAuthStore = create<AuthState>((set) => ({
  session: null,
  inspector: null,
  restoring: true,
  submitting: false,
  error: null,
  refreshingProfile: false,
  profileError: null,

  /**
   * Cold start.
   *
   * The device's own copy of the session is adopted immediately and the
   * navigator is released; the server's verdict on it arrives afterwards and
   * only ever *removes* a session, never delays one. See the long note at the
   * head of `authService` — this ordering is what makes the app open at once
   * with no signal instead of after a twenty-second splash screen.
   */
  async restore() {
    set({ restoring: true });

    let stored: AuthSession | null = null;
    try {
      stored = await authService.readStoredSession();
    } catch {
      // A keystore that will not read is a signed-out start, never a blocking
      // error — the officer can sign in again.
      stored = null;
    }

    set({ session: stored, inspector: stored?.inspector ?? null, restoring: false });

    if (stored) void useAuthStore.getState().verify();
  },

  /**
   * Confirms the restored session with the server, behind the app.
   *
   * Three outcomes, and only one of them changes what is on screen:
   *
   *   - `valid`       — adopt the server's copy of the inspector record, which
   *                     may carry a jurisdiction a supervisor changed.
   *   - `rejected`    — the account is gone or suspended. Sign out.
   *   - `unreachable` — no verdict. The stored session stands, which is the
   *                     whole point: an officer in a godown stays signed in.
   */
  async verify() {
    const verdict = await authService.verifySession();

    if (verdict.status === 'rejected') {
      set({ session: null, inspector: null });
      return;
    }

    if (verdict.status === 'valid') {
      set((state) => ({
        inspector: verdict.inspector,
        session: state.session ? { ...state.session, inspector: verdict.inspector } : state.session,
      }));
    }
  },

  async login(identifier, password) {
    set({ submitting: true, error: null });
    try {
      const session = await authService.login({ identifier, password });
      set({ session, inspector: session.inspector, submitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), submitting: false });
      return false;
    }
  },

  async logout() {
    await authService.logout();
    set({ session: null, inspector: null, error: null });
  },

  clearError() {
    set({ error: null, profileError: null });
  },

  /**
   * Re-reads the inspector record from `GET /api/users/me`.
   *
   * The signed-in identity is authoritative on the server: a supervisor may
   * change a jurisdiction or suspend an account between sessions, and the copy
   * cached at sign-in would not show it.
   *
   * A failure here leaves the cached inspector on screen rather than blanking
   * it — an inspector in the field with no signal still needs their badge
   * number visible.
   */
  async refreshProfile() {
    set({ refreshingProfile: true, profileError: null });
    try {
      const inspector = await authService.getCurrentUser();
      set((state) => ({
        inspector,
        session: state.session ? { ...state.session, inspector } : state.session,
        refreshingProfile: false,
      }));
    } catch (error) {
      set({ profileError: toApiError(error), refreshingProfile: false });
    }
  },

  /** Persists an edit through `PATCH /api/users/me`, then adopts the server's copy. */
  async updateProfile(patch) {
    set({ submitting: true, profileError: null });
    try {
      const inspector = await authService.updateProfile(patch);
      set((state) => ({
        inspector,
        session: state.session ? { ...state.session, inspector } : state.session,
        submitting: false,
      }));
      return true;
    } catch (error) {
      set({ profileError: toApiError(error), submitting: false });
      return false;
    }
  },
}));

/** Convenience selector — most screens need the inspector, not the session. */
export const useInspector = () => useAuthStore((state) => state.inspector);
