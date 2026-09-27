import { create } from 'zustand';

import { toApiError } from '../services/api';
import * as inspectionService from '../services/inspectionService';
import { isOfflineFailure, readThrough } from '../services/offlineCache';
import {
  mergeRegisterPool,
  queryRegisterPool,
  readRegisterPool,
  statsFromPool,
  type RegisterQuery,
} from '../services/offlineRegister';
import type {
  ApiError,
  ComplianceStatus,
  InspectionListResponse,
  InspectionSummary,
  ReportStats,
} from '../types';

import { useAuthStore } from './authStore';

/**
 * Completed inspections, their filters and the aggregate stats.
 *
 * The read model for Home, History and Reports.
 *
 * Phase 2 change: filtering, searching and the aggregates are all computed by
 * the backend. The store holds one page rather than the whole table, which is
 * what stops the History screen from degrading as an inspector's record count
 * grows.
 *
 * ── OFFLINE ─────────────────────────────────────────────────────────────────
 *
 * Every load here is stale-while-revalidate against the device.
 *
 *   1. Paint whatever the phone already has, immediately.
 *   2. Ask the server.
 *   3. Adopt its answer, and save it for next time.
 *
 * Step 1 is what makes the app usable on one bar of signal, not merely on
 * none: the register is on screen while the request is still in flight, rather
 * than behind a skeleton for however long the connection takes. Step 3 is what
 * makes step 1 possible tomorrow.
 *
 * When step 2 fails *because nothing was reached* — and only then; a 403 is an
 * answer, not an outage — the cached page stands and `fromCache` goes true.
 * Every screen that shows this data shows that flag, because a saved copy
 * presented as a live one is how an officer ends up quoting last week's figure
 * to a supervisor.
 * ────────────────────────────────────────────────────────────────────────────
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

/**
 * How many records the one deliberate prefetch pulls down.
 *
 * A hundred, in a single request, once per signed-in session. Everything else
 * the pool holds arrives passively from lists the officer was loading anyway —
 * but "passively" means an officer who has only ever looked at page one has
 * only page one when the signal goes, and the whole point of this work is that
 * they walk into the godown holding their register rather than the first ten
 * rows of it.
 *
 * One request rather than ten pages of ten: the cost is a single round trip on
 * the connection the officer still has, and it buys every subsequent search,
 * filter and page turn with no connection at all.
 */
const WARM_PAGE_SIZE = 100;

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

  /** True when what is on screen was read off the device, not the server. */
  fromCache: boolean;
  /** When that saved copy was written. Null whenever the data is live. */
  cachedAt: string | null;
  /**
   * True when the four Overview counts were computed from the records the
   * device happens to hold rather than returned by `/inspections/stats`.
   *
   * Kept separate from `fromCache` because it is a weaker claim: a cached
   * *stats* payload is still the register's own figure, just an old one,
   * whereas a derived count is an aggregate over a subset and must never be
   * read out as the total.
   */
  statsAreDerived: boolean;

  search: string;
  statusFilter: StatusFilter;
  dateFilter: DateFilter;

  load: (options?: { refresh?: boolean }) => Promise<void>;
  loadRecent: (options?: { refresh?: boolean }) => Promise<void>;
  setRecentPage: (page: number) => void;
  loadStats: () => Promise<void>;
  /** Pulls one large page so the whole register is browsable offline. */
  warmRegister: () => Promise<void>;
  setPage: (page: number) => void;
  setSearch: (search: string) => void;
  setStatusFilter: (filter: StatusFilter) => void;
  setDateFilter: (filter: DateFilter) => void;
  clearFilters: () => void;
  /** Refreshes the list and the aggregates after a write. */
  refreshAll: () => Promise<void>;
  reset: () => void;
}

const EMPTY_STATS: ReportStats = {
  totalInspections: 0,
  compliant: 0,
  violations: 0,
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

/** The start of Home's fixed seven-day window. */
function recentWindowStart(): string {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - RECENT_WINDOW_DAYS);
  return from.toISOString();
}

/**
 * Whose register this is.
 *
 * Every cache entry is written under the signed-in officer's id and refused to
 * anyone else — handsets are shared on a shift. No id means no session, and
 * with no session there is nothing to cache or serve.
 */
function owner(): string | null {
  return useAuthStore.getState().inspector?.id ?? null;
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

  fromCache: false,
  cachedAt: null,
  statsAreDerived: false,

  search: '',
  statusFilter: 'all',
  dateFilter: 'all',

  async load(options = {}) {
    const { refresh } = options;
    set(refresh ? { refreshing: true, error: null } : { loading: true, error: null });

    const { search, statusFilter, dateFilter, page } = get();
    const range = dateFilterToRange(dateFilter);
    const poolQuery: RegisterQuery = {
      search,
      status: statusFilter,
      from: range.from,
      page,
      pageSize: PAGE_SIZE,
    };

    // Step 1: paint what the device has, before asking anyone. Only on a cold
    // list — a pull-to-refresh already has the previous page on screen, and
    // replacing it with a cached one on the way to a fresh one would be a
    // visible flicker backwards.
    if (!refresh && get().items.length === 0) await seedFromPool(set, poolQuery);

    try {
      const result = await inspectionService.listInspections({
        search,
        status: statusFilter,
        page,
        pageSize: PAGE_SIZE,
        ...range,
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
        error: null,
        fromCache: false,
        cachedAt: null,
      });

      void poolAdd(result.items);
    } catch (error) {
      await settleOffline(set, error, poolQuery, (result) =>
        set({
          items: result.items,
          total: result.total,
          totalPages: result.totalPages,
          page: result.page,
        }),
      );
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

    const from = recentWindowStart();
    const poolQuery: RegisterQuery = { from, page: get().recentPage, pageSize: PAGE_SIZE };

    // Same stale-while-revalidate as `load`. Home is the first screen an
    // officer sees after launch, so this is the one that decides whether the
    // app "opens" with their work in it or with a spinner.
    if (get().recent.length === 0) {
      const cached = await readPoolPage(poolQuery);
      if (cached) {
        set({
          recent: cached.result.items,
          recentTotal: cached.result.total,
          recentTotalPages: cached.result.totalPages,
          fromCache: true,
          cachedAt: cached.savedAt,
        });
      }
    }

    try {
      const result = await inspectionService.listInspections({
        page: get().recentPage,
        pageSize: PAGE_SIZE,
        from,
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
        fromCache: false,
        cachedAt: null,
      });

      void poolAdd(result.items);
    } catch (error) {
      if (!isOfflineFailure(error)) {
        // Home already surfaces `error` from the main list; a failure here
        // leaves the previous page up rather than blanking the screen an
        // officer is about to start an inspection from.
        set({ recentLoading: false, error: toApiError(error) });
        return;
      }

      const cached = await readPoolPage(poolQuery);
      if (!cached) {
        set({ recentLoading: false, error: toApiError(error) });
        return;
      }

      // The register was on the device all along. This is not an error state
      // and must not be dressed as one.
      set({
        recent: cached.result.items,
        recentTotal: cached.result.total,
        recentTotalPages: cached.result.totalPages,
        recentPage: cached.result.page,
        recentLoading: false,
        error: null,
        fromCache: true,
        cachedAt: cached.savedAt,
      });
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
    const id = owner();
    if (!id) return;

    try {
      // Aggregates cover every record, not the filtered view — a filter narrows
      // the list, it does not change how many violations exist.
      const { data } = await readThrough({
        key: 'stats',
        owner: id,
        fetch: () => inspectionService.getStats(),
      });

      // Cached or live, this is the register's own figure — `fromCache` on the
      // store already says how fresh the screen is. `statsAreDerived` is the
      // stronger warning, reserved for a count computed from the pool below.
      set({ stats: data, statsAreDerived: false });
    } catch (error) {
      if (!isOfflineFailure(error)) return; // A failed stats call must not blank the list that loaded fine.

      // Nothing was ever cached for the aggregates — a first launch with no
      // signal. The pool can still answer three of the four counts, so the
      // Overview shows something true about the records on the device rather
      // than four zeroes, and says that is what it is.
      const pool = await readRegisterPool(id);
      if (!pool) return;

      set({ stats: statsFromPool(pool.data), statsAreDerived: true });
    }
  },

  /**
   * One large unfiltered page, so the whole register is on the device.
   *
   * Fire-and-forget: nothing waits on it and no failure surfaces. It runs after
   * the screens have their first page, so a slow prefetch never delays the app,
   * and offline it fails in four seconds against the shortened timeout and
   * leaves the existing pool untouched.
   */
  async warmRegister() {
    const id = owner();
    if (!id) return;

    try {
      const result = await inspectionService.listInspections({
        page: 1,
        pageSize: WARM_PAGE_SIZE,
      });

      await mergeRegisterPool(id, result.items);
    } catch {
      // The pool keeps whatever it already held. Warming is an optimisation,
      // not a step any screen depends on.
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
    // After the screens have what they need, top the pool up for the next time
    // there is no signal.
    void get().warmRegister();
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
      fromCache: false,
      cachedAt: null,
      statsAreDerived: false,
      search: '',
      statusFilter: 'all',
      dateFilter: 'all',
    });
  },
}));

/* ── Shared offline plumbing ──────────────────────────────────────────────── */

type Setter = (partial: Partial<HistoryState>) => void;

/** Runs one query against the pooled register, if there is a pool. */
async function readPoolPage(
  query: RegisterQuery,
): Promise<{ result: InspectionListResponse; savedAt: string } | null> {
  const id = owner();
  if (!id) return null;

  const pool = await readRegisterPool(id);
  if (!pool || pool.data.length === 0) return null;

  return { result: queryRegisterPool(pool.data, query), savedAt: pool.savedAt };
}

/** Paints the cached page while the real request is still in flight. */
async function seedFromPool(set: Setter, query: RegisterQuery): Promise<void> {
  const cached = await readPoolPage(query);
  if (!cached) return;

  set({
    items: cached.result.items,
    total: cached.result.total,
    totalPages: cached.result.totalPages,
    fromCache: true,
    cachedAt: cached.savedAt,
  });
}

/** Folds a fetched page into the pool. Never allowed to fail a load. */
async function poolAdd(items: InspectionSummary[]): Promise<void> {
  const id = owner();
  if (!id || items.length === 0) return;
  await mergeRegisterPool(id, items);
}

/**
 * Decides what a failed list load means, and settles the store accordingly.
 *
 * An answer from the server — rejected, forbidden, not found — is an error and
 * is shown as one. Nothing reached at all is not: if the device holds the
 * register, the officer sees it, labelled and dated, with no error anywhere on
 * the screen. That distinction is the entire difference between an app that
 * works in the field and one that only works at a desk.
 */
async function settleOffline(
  set: Setter,
  error: unknown,
  query: RegisterQuery,
  apply: (result: InspectionListResponse) => void,
): Promise<void> {
  if (!isOfflineFailure(error)) {
    set({ error: toApiError(error), loading: false, refreshing: false });
    return;
  }

  const cached = await readPoolPage(query);

  if (!cached) {
    set({ error: toApiError(error), loading: false, refreshing: false });
    return;
  }

  apply(cached.result);
  set({
    loading: false,
    refreshing: false,
    error: null,
    fromCache: true,
    cachedAt: cached.savedAt,
  });
}
