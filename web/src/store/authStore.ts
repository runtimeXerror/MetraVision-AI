import { create } from 'zustand';

import { authService } from '@/services';
import { readSession } from '@/services/session';
import { toApiError, type ApiError } from '@/services/client';
import type { User, UserRole } from '@/types/api';

/**
 * Authentication state.
 *
 * The only global store in the app. Everything else the dashboard shows is
 * server state and belongs to TanStack Query — duplicating it here would mean
 * two caches to invalidate and one of them going stale.
 */

interface AuthState {
  user: User | null;
  /** True while a stored session is being confirmed on boot. */
  restoring: boolean;
  submitting: boolean;
  error: ApiError | null;

  restore: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (user: User) => void;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  // Seeded from storage so a refresh does not flash the login page before the
  // /auth/me round trip completes.
  user: readSession()?.user ?? null,
  restoring: true,
  submitting: false,
  error: null,

  async restore() {
    set({ restoring: true });
    try {
      const user = await authService.restore();
      set({ user, restoring: false });
    } catch (error) {
      const apiError = toApiError(error);
      // Only a rejected identity signs the user out. A backend that is simply
      // unreachable must not discard a valid session.
      if (apiError.kind === 'unauthorized' || apiError.kind === 'forbidden') {
        set({ user: null, restoring: false });
      } else {
        set({ restoring: false });
      }
    }
  },

  async login(identifier, password) {
    set({ submitting: true, error: null });
    try {
      const session = await authService.login(identifier, password);
      set({ user: session.user, submitting: false });
      return true;
    } catch (error) {
      set({ error: toApiError(error), submitting: false });
      return false;
    }
  },

  async logout() {
    await authService.logout();
    set({ user: null, error: null });
  },

  setUser(user) {
    set({ user });
  },

  clearError() {
    set({ error: null });
  },
}));

/* ── Role helpers ─────────────────────────────────────────────────────────── */

const RANK: Record<UserRole, number> = { INSPECTOR: 0, SUPERVISOR: 1, ADMIN: 2 };

export function atLeast(role: UserRole | undefined, minimum: UserRole): boolean {
  return role !== undefined && RANK[role] >= RANK[minimum];
}

export const useUser = () => useAuthStore((state) => state.user);
export const useRole = () => useAuthStore((state) => state.user?.role);
export const useIsAdmin = () => useAuthStore((state) => state.user?.role === 'ADMIN');
export const useIsSupervisor = () => useAuthStore((state) => atLeast(state.user?.role, 'SUPERVISOR'));
