import type { Paged, ViolationDetail, ViolationRow, ViolationStats } from '@/types/api';

import { get } from './client';

/**
 * Violations.
 *
 * A violation is a finding on an inspection, not a record of its own — the
 * backend flattens the embedded findings into addressable rows keyed by
 * `<inspection reference>:<code>`.
 */

export interface ViolationFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  severity?: string;
  category?: string;
  status?: string;
  productCategory?: string;
  district?: string;
  state?: string;
  inspectorId?: string;
  from?: string;
  to?: string;
}

export function listViolations(filters: ViolationFilters = {}): Promise<Paged<ViolationRow>> {
  return get<Paged<ViolationRow>>('/violations', filters as Record<string, unknown>);
}

export function getViolationStats(filters: ViolationFilters = {}): Promise<ViolationStats> {
  return get<ViolationStats>('/violations/stats', filters as Record<string, unknown>);
}

export function getViolation(violationId: string): Promise<ViolationDetail> {
  return get<ViolationDetail>(`/violations/${encodeURIComponent(violationId)}`);
}
