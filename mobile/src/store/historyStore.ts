import { create } from 'zustand';

import { toApiError } from '../services/api';
import * as inspectionService from '../services/inspectionService';
import type {
  ApiError,
  ComplianceStatus,
  Inspection,
  InspectionSummary,
  ReportStats,
} from '../types';

/**
 * Completed inspections, their filters and the aggregate stats.
 *
 * The read model for Home, History and Reports.
 *
 * Phase 2 change: filtering, searching and the aggregates are all computed by
 * the backend. The store holds one page rather than the whole table, which is
 * what stops the History screen from degrading as an inspector's record count
 * grows.
 */

export type StatusFilter = ComplianceStatus | 'all';
export type DateFilter = 'all' | 'today' | 'week' | 'month';

/**
 * Records per page.
 *
 * Ten, because the list is read on a phone: a page an inspector has to scroll
 * three screens to reach the end of is not a page, and every extra row is a
 * record fetched over a field connection that may never be looked at.
 */
export const PAGE_SIZE = 10;

/**
 * How far back Home's "Recent Inspections" reaches.
 *
 * Seven days. The list is meant to answer "what have I done lately", not to be
 * a second copy of the register — an officer looking for something older wants
 * the History tab's search and filters, not an endless scroll on the home
 * screen.
 */
export const RECENT_WINDOW_DAYS = 7;

interface HistoryState {
  items: InspectionSummary[];

  /**
   * ── THE HOME "RECENT" LIST ──────────────────────────────────────────────
   *
   * Its own slice, with its own page cursor, deliberately not the `items`
   * above.
   *
   * Home shows the last seven days; History shows everything, under whatever
   * search, status and date the inspector has chosen. Driving both from one
   * cursor meant paging on Home moved History, and scoping Home to a week
   * would have silently applied that week to History's filter bar as well.
   *
   * The window is fixed and not a filter: the whole point of the Home list is
   * that it is short and current. Anything older is a page away — the Total
   * tile, or the History tab.
   * ────────────────────────────────────────────────────────────────────────
   */
  recent: InspectionSummary[];
  recentPage: number;
  recentTotalPages: number;
  recentTotal: number;
  recentLoading: boolean;
  stats: ReportStats;
  /** Records matching the filters across every page. */
  total: number;
  page: number;
  totalPages: number;
  loading: boolean;
  /** True on pull-to-refresh, so the list is not replaced by a spinner. */
  refreshing: boolean;
  error: ApiError | null;

  search: string;
  statusFilter: StatusFilter;
  dateFilter: DateFilter;

  load: (options?: { refresh?: boolean }) => Promise<void>;
  loadRecent: (options?: { refresh?: boolean }) => Promise<void>;
  setRecentPage: (page: number) => void;
  loadStats: () => Promise<void>;
  setPage: (page: number) => void;
  setSearch: (search: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setDateFilter: (filter: DateFilter) => void;
  clearFilters: () => void;
  /** Refreshes the list and the aggregates after a write. */
  refreshAll: () => Promise<void>;
  getRecord: (id: string) => Promise<Inspection>;
  reset: () => void;
}

const EMPTY_STATS: ReportStats = {
  totalInspections: 0,
  compliant: 0,
  violations: 0,
  pendingReviews: 0,
  averageScore: 0,
};

function dateFilterToRange(filter: DateFilter): { from?: string } {
  if (filter === 'all') return {};

  const from = new Date();
  from.setHours(0, 0, 0, 0);

  if (filter === 'week') from.setDate(from.getDate() - 7);
  if (filter === 'month') from.setMonth(from.getMonth() - 1);

  return { from: from.toISOString() };
}

/**
 * Debounce handle for search.
 *
 * Without it every keystroke fires a request, and the responses can arrive out
 * of order — leaving the list showing results for a prefix of what was typed.
 */
let searchTimer: ReturnType<typeof setTimeout> | null = null;

export const useHistoryStore = create<HistoryState>((set, get) => ({
  items: [],
  recent: [],
  recentPage: 1,
  recentTotalPages: 1,
  recentTotal: 0,
  recentLoading: false,
  stats: EMPTY_STATS,
  total: 0,
  page: 1,
  totalPages: 1,
  loading: false,
  refreshing: false,
  error: null,

  search: '',
  statusFilter: 'all',
  dateFilter: 'all',

  async load(options = {}) {
    const { refresh } = options;
    set(refresh ? { refreshing: true, error: null } : { loading: true, error: null });

    try {
      const { search, statusFilter, dateFilter, page } = get();
      const result = await inspectionService.listInspections({
        search,
        status: statusFilter,
        page,
        pageSize: PAGE_SIZE,
        ...dateFilterToRange(dateFilter),
      });

      // A filter change can leave the requested page past the end of the new
      // result set — deleting the last record on page 4, say. Falling back to
      // the last page that exists is what stops the list going permanently
      // blank with a pager still pointing at nothing.
      if (result.items.length === 0 && page > result.totalPages) {
        set({ page: result.totalPages });
        await get().load({ refresh });
        return;
      }

      set({
        items: result.items,
        total: result.total,
        totalPages: result.totalPages,
        loading: false,
        refreshing: false,
      });
    } catch (error) {
      set({ error: toApiError(error), loading: false, refreshing: false });
    }
  },

  /**
   * The last seven days, newest first, paged independently of History.
   *
   * `RECENT_WINDOW_DAYS` is applied as a `from` bound on the request rather
   * than by filtering the response, so the page count the pager shows is the
   * real number of pages within the window — filtering client-side would have
   * produced short pages and a pager that overcounted them.
   */
  async loadRecent(options = {}) {
    const { refresh } = options;

    // A refresh leaves the current page on screen rather than replacing it with
    // skeletons — except on the very first load, where there is nothing to
    // leave up and the alternative is a flash of "No inspections yet" before
    // the officer's records arrive.
    if (!refresh || get().recent.length === 0) set({ recentLoading: true });

    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      from.setDate(from.getDate() - RECENT_WINDOW_DAYS);

      const result = await inspectionService.listInspections({
        page: get().recentPage,
        pageSize: PAGE_SIZE,
        from: from.toISOString(),
      });

      // Records ageing out of the window can leave the cursor past the end —
      // the same guard `load` makes, for the same reason.
      if (result.items.length === 0 && get().recentPage > result.totalPages) {
        set({ recentPage: Math.max(1, result.totalPages) });
        await get().loadRecent({ refresh });
        return;
      }

      set({
        recent: result.items,
        recentTotal: result.total,
        recentTotalPages: result.totalPages,
        recentLoading: false,
      });
    } catch (error) {
      // Home already surfaces `error` from the main list; a failure here leaves
      // the previous page up rather than blanking the screen an officer is
      // about to start an inspection from.
      set({ recentLoading: false, error: toApiError(error) });
    }
  },

  setRecentPage(page) {
    const { recentTotalPages, recentPage } = get();
    const next = Math.min(Math.max(page, 1), recentTotalPages);
    if (next === recentPage) return;

    set({ recentPage: next });
    void get().loadRecent();
  },

  async loadStats() {
    try {
      // Aggregates cover every record, not the filtered view — a filter narrows
      // the list, it does not change how many violations exist.
      const stats = await inspectionService.getStats();
      set({ stats });
    } catch {
      // A failed stats call must not blank the list that loaded fine.
    }
  },

  setPage(page) {
    const { totalPages, page: current } = get();
    const next = Math.min(Math.max(page, 1), totalPages);
    if (next === current) return;

    set({ page: next });
    void get().load();
  },

  // Every filter resets to page 1. Narrowing the list while still on page 4
  // would land the inspector on an empty page of a shorter result set.
  setSearch(search) {
    set({ search, page: 1 });

    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void get().load(), 350);
  },

  setStatusFilter(statusFilter) {
    set({ statusFilter, page: 1 });
    void get().load();
  },

  setDateFilter(dateFilter) {
    set({ dateFilter, page: 1 });
    void get().load();
  },

  clearFilters() {
    set({ search: '', statusFilter: 'all', dateFilter: 'all', page: 1 });
    void get().load();
  },

  async refreshAll() {
    await Promise.all([get().load(), get().loadRecent({ refresh: true }), get().loadStats()]);
  },

  async getRecord(id) {
    return inspectionService.getInspection(id);
  },

  reset() {
    if (searchTimer) clearTimeout(searchTimer);
    set({
      items: [],
      recent: [],
      recentPage: 1,
      recentTotalPages: 1,
      recentTotal: 0,
      recentLoading: false,
      stats: EMPTY_STATS,
      total: 0,
      page: 1,
      totalPages: 1,
      loading: false,
      refreshing: false,
      error: null,
      search: '',
      statusFilter: 'all',
      dateFilter: 'all',
    });
  },
}));
