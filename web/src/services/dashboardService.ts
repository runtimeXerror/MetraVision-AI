import type {
  CategoryBar,
  DashboardOverview,
  DashboardSummary,
  DistributionSlice,
  DistrictRow,
  InspectorActivity,
  TrendPoint,
  ViolationTypeBar,
} from '@/types/api';

import { get } from './client';

/**
 * Dashboard analytics.
 *
 * Every figure is aggregated in MongoDB and arrives ready to render. The
 * dashboard deliberately does no arithmetic over inspection records: a second
 * definition of "compliance rate" living in the browser would drift from the
 * one the API reports, and only one of them can be right.
 */

export interface AnalyticsFilters {
  from?: string;
  to?: string;
  productCategory?: string;
  district?: string;
  state?: string;
  status?: string;
  inspectorId?: string;
  days?: number;
}

/** One request for the whole overview page — see `getOverview` on the API. */
export function getOverview(filters: AnalyticsFilters = {}): Promise<DashboardOverview> {
  return get<DashboardOverview>('/analytics/overview', filters as Record<string, unknown>);
}

export function getSummary(filters: AnalyticsFilters = {}): Promise<DashboardSummary> {
  return get<DashboardSummary>('/analytics/summary', filters as Record<string, unknown>);
}

export function getTrend(filters: AnalyticsFilters = {}): Promise<TrendPoint[]> {
  return get<TrendPoint[]>('/analytics/trend', filters as Record<string, unknown>);
}

export function getDistribution(filters: AnalyticsFilters = {}): Promise<DistributionSlice[]> {
  return get<DistributionSlice[]>('/analytics/distribution', filters as Record<string, unknown>);
}

export function getViolationsByCategory(filters: AnalyticsFilters = {}): Promise<CategoryBar[]> {
  return get<CategoryBar[]>('/analytics/violations-by-category', filters as Record<string, unknown>);
}

export function getViolationTypes(filters: AnalyticsFilters = {}): Promise<ViolationTypeBar[]> {
  return get<ViolationTypeBar[]>('/analytics/violation-types', filters as Record<string, unknown>);
}

export function getInspectorActivity(filters: AnalyticsFilters = {}): Promise<InspectorActivity[]> {
  return get<InspectorActivity[]>('/analytics/inspector-activity', filters as Record<string, unknown>);
}

export function getDistricts(filters: AnalyticsFilters = {}): Promise<DistrictRow[]> {
  return get<DistrictRow[]>('/analytics/districts', filters as Record<string, unknown>);
}
