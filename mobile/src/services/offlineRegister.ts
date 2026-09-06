import type { ComplianceStatus, InspectionListResponse, InspectionSummary } from '../types';

import { readCached, writeCached, RECORD_POOL_LIMIT, type CachedValue } from './offlineCache';

/**
 * ── THE REGISTER, BROWSABLE WITH NO SIGNAL ──────────────────────────────────
 *
 * Caching each *page* of History as it was fetched would have been the smaller
 * change, and it would have produced a bad feature: offline, the officer could
 * revisit exactly the pages they had already looked at, under exactly the
 * filters they had already applied. Change the status chip and the screen goes
 * blank. That is not a register, it is a browser history.
 *
 * So the summaries are pooled instead. Every list response the app receives is
 * merged into one collection of records, newest first, and when there is no
 * connection the search box, the status chips, the date filter and the pager
 * all run against that pool on the device. The officer gets the same screen
 * they get online — it simply says where the data came from and when.
 *
 * The pool fills two ways: passively, from every list the app loads anyway,
 * and once per session from a single deliberate prefetch of a large page (see
 * `historyStore.warmRegister`). One request, and the year's register is on the
 * phone.
 *
 * ── Where offline and online differ, and why ────────────────────────────────
 *
 * Two honest gaps, both consequences of the device holding summaries rather
 * than whole records:
 *
 *   - **Search** covers the reference, the business and the product. The server
 *     also matches the premises address, which the summary does not carry. A
 *     search for a street name finds fewer records offline than online.
 *   - **The status filter** is mirrored exactly, which takes a little care.
 *     `matchesStatus` below reproduces the server's rule value for value; the
 *     awkward one is "review required", where the summary has thrown away the
 *     distinction the server filters on and it has to be reconstructed from two
 *     fields. The comment there explains how.
 *
 * The search gap is not papered over either. Every screen labels a cached
 * result as cached, and an officer who needs the authoritative answer is one
 * pull-to-refresh away from it the moment there is signal.
 * ────────────────────────────────────────────────────────────────────────────
 */

const POOL_KEY = 'register:pool';

export interface RegisterQuery {
  search?: string;
  status?: ComplianceStatus | 'all';
  /** ISO lower bound on `createdAt`, matching the API's `from`. */
  from?: string;
  page: number;
  pageSize: number;
}

/** Reads the pooled register off the device. */
export async function readRegisterPool(
  owner: string,
): Promise<CachedValue<InspectionSummary[]> | null> {
  const cached = await readCached<InspectionSummary[]>(POOL_KEY, owner);
  if (!cached || !Array.isArray(cached.data)) return null;
  return cached;
}

/**
 * Folds a freshly fetched page into the pool.
 *
 * Merged by id with the incoming copy winning, so a record re-fetched after a
 * supervisor amended it replaces the stale one rather than sitting beside it.
 * Sorted newest first and capped, because the pool is read and filtered in a
 * single frame on a mid-range phone and an unbounded one would eventually show
 * as a pause between typing in the search box and the list responding.
 *
 * Returns the merged pool so a caller can use it without a second read.
 */
export async function mergeRegisterPool(
  owner: string,
  incoming: InspectionSummary[],
): Promise<InspectionSummary[]> {
  const existing = (await readRegisterPool(owner))?.data ?? [];

  const byId = new Map<string, InspectionSummary>();
  for (const record of existing) byId.set(record.id, record);
  for (const record of incoming) byId.set(record.id, record);

  const merged = [...byId.values()]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, RECORD_POOL_LIMIT);

  writeCached(POOL_KEY, owner, merged);
  return merged;
}

/**
 * Runs one History query against the pool.
 *
 * Deliberately returns the same `InspectionListResponse` the API does, so the
 * store's offline path sets exactly the state its online path sets and no
 * screen has to know which one it is looking at.
 */
export function queryRegisterPool(
  pool: InspectionSummary[],
  query: RegisterQuery,
): InspectionListResponse {
  const { search, status, from, page, pageSize } = query;

  const needle = search?.trim().toLowerCase();
  const after = from ? Date.parse(from) : null;

  const matched = pool.filter((record) => {
    if (status && status !== 'all' && !matchesStatus(record, status)) return false;
    if (after !== null && Date.parse(record.createdAt) < after) return false;

    if (needle) {
      const haystack = `${record.referenceId} ${record.businessName} ${record.productLabel}`;
      if (!haystack.toLowerCase().includes(needle)) return false;
    }

    return true;
  });

  // Guarded so an empty result still reports one page rather than zero — the
  // same guard `inspectionService.listInspections` makes, and for the same
  // reason: a pager with zero pages has nothing to render and no way back.
  const totalPages = Math.max(Math.ceil(matched.length / pageSize), 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    items: matched.slice(start, start + pageSize),
    total: matched.length,
    page: safePage,
    pageSize,
    totalPages,
  };
}

/**
 * One record against one status chip, matching the server value for value.
 *
 * Two of the three shared values resolve to the verdict and one to the work
 * outstanding: "compliant" and "violation" are findings that survive filing,
 * "review required" is a queue that empties as declarations are answered.
 * Reproducing the server's rule here is what stops the same chip returning
 * different records depending on whether the officer had signal.
 */
function matchesStatus(record: InspectionSummary, status: ComplianceStatus): boolean {
  if (status !== 'review_required') return record.complianceStatus === status;

  /*
   * The server's condition exactly: the analysis asked for review, and at least
   * one declaration still has no ruling on it.
   *
   * This used to test `record.status === 'pending_review'` — the workflow
   * position — which meant a record dropped out of the queue the moment it was
   * filed, whether or not anyone had answered the declarations it was filed
   * with. Filing is not reviewing, and the queue now says so.
   */
  return record.complianceStatus === 'review_required' && record.pendingDeclarations > 0;
}

/**
 * The aggregates, recomputed from the pool.
 *
 * Used only when `/inspections/stats` cannot be reached *and* nothing was ever
 * cached for it — a first offline launch after an install, essentially. It is
 * marked as derived by the caller, because a count taken over the three hundred
 * records the device happens to hold is not the same figure as a count taken
 * over the register, and an officer must not quote one for the other.
 */
export function statsFromPool(pool: InspectionSummary[]): {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  averageScore: number;
} {
  return {
    totalInspections: pool.length,
    compliant: pool.filter((record) => record.complianceStatus === 'compliant').length,
    violations: pool.filter((record) => record.complianceStatus === 'violation').length,
    // The same condition `matchesStatus` uses, so this count and the list
    // behind it can never disagree — including the part that keeps a filed
    // inspection in the queue while declarations on it are still unanswered.
    pendingReviews: pool.filter((record) => matchesStatus(record, 'review_required')).length,
    // Not derivable from a summary — it carries no score — and a zero here is
    // rendered as "—" rather than as an average of nothing.
    averageScore: 0,
  };
}
