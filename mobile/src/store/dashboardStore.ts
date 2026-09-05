import { create } from 'zustand';

import { toApiError } from '../services/api';
import * as analyticsService from '../services/analyticsService';
import { isOfflineFailure, readCached, readThrough } from '../services/offlineCache';
import type { ApiError, DashboardOverview } from '../types';

import { useAuthStore } from './authStore';

/**
 * The compliance and enforcement dashboard.
 *
 * Held apart from `historyStore` on purpose. History is a *page* of records the
 * inspector is browsing; this is an aggregate over the whole window. Deriving
 * one from the other would make every KPI silently describe whatever happened
 * to be loaded in the list.
 */

/**
 * Windows offered by the period selector.
 *
 * `0` is all time, which the API reads as "run the trend from the earliest
 * record this caller can see". Zero rather than a very large number of days,
 * so the request states the intent instead of approximating it — and so the
 * window cannot silently miss a record older than whatever bound was picked.
 *
 * Note this selects the *trend* window only. Every KPI beside the chart is an
 * all-time aggregate already; the period chips have never narrowed them.
 */
export const PERIOD_OPTIONS = [
  { value: 7, label: '7 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
  { value: 365, label: '1 year' },
  { value: 0, label: 'All time' },
] as const;

export type PeriodDays = (typeof PERIOD_OPTIONS)[number]['value'];

interface DashboardState {
  overview: DashboardOverview | null;
  days: PeriodDays;
  loading: boolean;
  /** True on pull-to-refresh, so the dashboard is not replaced by skeletons. */
  refreshing: boolean;
  error: ApiError | null;

  /** True when the figures on screen were read off the device, not the server. */
  fromCache: boolean;
  /** When that saved copy was written. Null whenever the figures are live. */
  cachedAt: string | null;

  load: (options?: { refresh?: boolean }) => Promise<void>;
  setPeriod: (days: PeriodDays) => void;
  reset: () => void;
}

/**
 * One cache entry per window.
 *
 * Keyed by the period, because a summary is only meaningful with its period
 * attached — serving last month's cached figures under the "7 days" chip would
 * be a fabricated number, not a stale one. A window that has never been loaded
 * online simply has nothing cached, and the screen says so.
 */
const overviewKey = (days: PeriodDays) => `dashboard:overview:${days}`;

export const useDashboardStore = create<DashboardState>((set, get) => ({
  overview: null,
  days: 30,
  loading: false,
  refreshing: false,
  error: null,
  fromCache: false,
  cachedAt: null,

  async load(options = {}) {
    const { refresh } = options;
    set(refresh ? { refreshing: true, error: null } : { loading: true, error: null });

    const days = get().days;
    const owner = useAuthStore.getState().inspector?.id ?? null;

    if (!owner) {
      // No session, nothing to scope a cache to. Straight through to the API,
      // which will answer with a 401 the navigator already handles.
      try {
        const overview = await analyticsService.getOverview({ days });
        set({ overview, loading: false, refreshing: false, fromCache: false, cachedAt: null });
      } catch (error) {
        set({ error: toApiError(error), loading: false, refreshing: false });
      }
      return;
    }

    // Paint the saved summary first, so the dashboard is readable while the
    // request is in flight rather than a page of skeletons. Only when there is
    // nothing on screen — a period change deliberately leaves the previous
    // window's figures up, dimmed, and swapping in a cached set on the way
    // would be a flicker through a third state.
    if (!refresh && get().overview === null) {
      const seed = await readCached<DashboardOverview>(overviewKey(days), owner);
      if (seed) set({ overview: seed.data, fromCache: true, cachedAt: seed.savedAt });
    }

    try {
      const { data, fromCache, savedAt } = await readThrough({
        key: overviewKey(days),
        owner,
        fetch: () => analyticsService.getOverview({ days }),
      });

      set({
        overview: data,
        loading: false,
        refreshing: false,
        error: null,
        fromCache,
        cachedAt: savedAt,
      });
    } catch (error) {
      // Offline with nothing saved for this window. The error stands — but it
      // is a truthful one: this particular summary has never been downloaded.
      if (isOfflineFailure(error) && get().overview !== null) {
        set({ loading: false, refreshing: false });
        return;
      }

      set({ error: toApiError(error), loading: false, refreshing: false });
    }
  },

  setPeriod(days) {
    if (get().days === days) return;
    // The previous window's figures stay on screen while the new ones load, so
    // the reader never sees a dashboard that is briefly empty. `loading` is what
    // dims them, and the period chip has already moved.
    set({ days });
    void get().load({ refresh: get().overview !== null });
  },

  reset() {
    set({
      overview: null,
      days: 30,
      loading: false,
      refreshing: false,
      error: null,
      fromCache: false,
      cachedAt: null,
    });
  },
}));
