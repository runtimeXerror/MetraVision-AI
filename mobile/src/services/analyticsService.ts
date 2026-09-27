import type {
  CategoryBreakdown,
  ComplianceSlice,
  DashboardOverview,
  DashboardSummary,
  DistrictActivity,
  Inspector,
  InspectorActivity,
  TrendPoint,
  ViolationTypeCount,
} from '../types';

import { request } from './api';
import { dashboardToHtml } from './documents/dashboardDocument';
import type { DocumentSource } from './exportService';
import { toCategory, toComplianceStatus, toSeverity, toViolationCategory } from './mappers';

/**
 * Dashboard analytics.
 *
 * The backend already aggregates every figure the dashboard shows and scopes it
 * from the caller's token — an inspector receives their own numbers, a
 * supervisor the department's. Nothing here re-derives a total from a list,
 * because a page of records is not the population the KPI describes.
 */

interface OverviewDTO {
  summary: DashboardSummary;
  trend: TrendPoint[];
  distribution: Array<{ status: string; count: number }>;
  violationsByCategory: Array<{ category: string; inspections: number; violations: number }>;
  violationTypes: Array<{
    code: string;
    title: string;
    category: string;
    severity: string;
    count: number;
  }>;
  inspectorActivity: Array<{
    id: string;
    inspectorId: string;
    name: string;
    status: string;
    district?: string;
    totalInspections: number;
    compliant: number;
    violations: number;
    complianceRate: number;
    lastActivityAt?: string;
  }>;
  districts: DistrictActivity[];
}

export interface OverviewQuery {
  /** Window length in days. Also fixes the trend's bucket count. */
  days?: number;
  from?: string;
  to?: string;
}

/** `YYYY-MM-DD` for a date `days` before `to`. */
function windowStart(to: Date, days: number): string {
  const from = new Date(to);
  from.setDate(from.getDate() - (days - 1));
  from.setHours(0, 0, 0, 0);
  return from.toISOString();
}

/**
 * Fetches everything the dashboard renders in one round trip.
 *
 * Seven parallel requests would each re-run the same match and could paint the
 * page in stages, with the KPI row describing one window while a chart below it
 * still described the last.
 */
export async function getOverview(query: OverviewQuery = {}): Promise<DashboardOverview> {
  const days = query.days ?? 30;
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ?? windowStart(to, days);

  const dto = await request<OverviewDTO>('/analytics/overview', {
    query: { days, from, to: to.toISOString() },
  });

  return {
    summary: dto.summary,
    trend: dto.trend ?? [],
    distribution: (dto.distribution ?? []).map(toSlice),
    violationsByCategory: (dto.violationsByCategory ?? []).map(
      (row): CategoryBreakdown => ({
        category: toCategory(row.category),
        inspections: row.inspections,
        violations: row.violations,
      }),
    ),
    violationTypes: (dto.violationTypes ?? []).map(
      (row): ViolationTypeCount => ({
        code: row.code,
        title: row.title,
        category: toViolationCategory(row.category),
        severity: toSeverity(row.severity),
        count: row.count,
      }),
    ),
    inspectorActivity: (dto.inspectorActivity ?? []).map(
      (row): InspectorActivity => ({
        id: row.id,
        employeeId: row.inspectorId,
        name: row.name,
        district: row.district,
        totalInspections: row.totalInspections,
        compliant: row.compliant,
        violations: row.violations,
        complianceRate: row.complianceRate,
        lastActivityAt: row.lastActivityAt,
      }),
    ),
    districts: dto.districts ?? [],
    period: { days, from, to: to.toISOString() },
    generatedAt: new Date().toISOString(),
  };
}

/**
 * `NOT_ASSESSED` is carried through rather than folded into a verdict.
 * Attributing an unassessed record to "review required" would inflate a figure
 * a supervisor acts on.
 */
function toSlice(row: { status: string; count: number }): ComplianceSlice {
  return {
    status: row.status === 'NOT_ASSESSED' ? 'not_assessed' : toComplianceStatus(row.status),
    count: row.count,
  };
}

/**
 * The dashboard as an exportable document.
 *
 * The window is baked into the file name, because a summary is only meaningful
 * with its period attached — two files called `Compliance Summary.pdf` covering
 * different months are indistinguishable in a folder, and that is exactly how a
 * quarter's figures end up being quoted for a week.
 */
export function dashboardDocument(
  overview: DashboardOverview,
  inspector?: Inspector | null,
): DocumentSource {
  const from = overview.period.from.slice(0, 10);
  const to = overview.period.to.slice(0, 10);

  return {
    baseName: `Compliance Summary ${from} to ${to}`,
    html: () => dashboardToHtml(overview, inspector),
  };
}
