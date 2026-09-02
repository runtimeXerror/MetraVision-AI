import { create } from 'zustand';

import { toApiError } from '../services/api';
import * as analyticsService from '../services/analyticsService';
import type { ApiError, DashboardOverview } from '../types';

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

  load: (options?: { refresh?: boolean }) => Promise<void>;
  setPeriod: (days: PeriodDays) => void;
  reset: () => void;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  overview: null,
  days: 30,
  loading: false,
  refreshing: false,
  error: null,

  async load(options = {}) {
    const { refresh } = options;
    set(refresh ? { refreshing: true, error: null } : { loading: true, error: null });

    try {
      const overview = await analyticsService.getOverview({ days: get().days });
      set({ overview, loading: false, refreshing: false });
    } catch (error) {
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
    set({ overview: null, days: 30, loading: false, refreshing: false, error: null });
  },
}));
