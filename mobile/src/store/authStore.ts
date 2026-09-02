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

  async restore() {
    set({ restoring: true });
    try {
      const session = await authService.restoreSession();
      set({ session, inspector: session?.inspector ?? null, restoring: false });
    } catch {
      // A failed restore is just a signed-out start, never a blocking error.
      set({ session: null, inspector: null, restoring: false });
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
