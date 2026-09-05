import mongoose, { type PipelineStage } from 'mongoose';

import { Inspection, User } from '../models';
import {
  statusFilterField,
  type InspectionStatus,
  type ProductCategory,
  type Severity,
  type ViolationCategory,
} from '../types/domain';

/**
 * Dashboard aggregations.
 *
 * Every figure the web dashboard renders is computed here, in MongoDB, over
 * the same collection the mobile app writes to. The alternative — shipping
 * inspections to the browser and counting them there — would put a second,
 * silently diverging definition of "compliance rate" in the client, and would
 * not survive the first thousand records.
 *
 * Each function takes the same `AnalyticsScope`, so a filter applied on the
 * dashboard means the same thing to every chart on it.
 */

export interface AnalyticsScope {
  /** Set for an inspector; absent for supervisors and admins. */
  inspectorId?: string;
  from?: Date;
  to?: Date;
  productCategory?: ProductCategory;
  district?: string;
  state?: string;
  status?: string;
}

/** Translates a scope into the `$match` every pipeline starts with. */
export function scopeMatch(scope: AnalyticsScope): PipelineStage.Match['$match'] {
  const match: Record<string, unknown> = {};

  if (scope.inspectorId) {
    // `aggregate` does not cast strings the way `find` does — an un-cast id
    // matches nothing at all, silently.
    match.inspector = new mongoose.Types.ObjectId(scope.inspectorId);
  }
  if (scope.productCategory) match.productCategory = scope.productCategory;
  if (scope.district) match['location.district'] = scope.district;
  if (scope.state) match['location.state'] = scope.state;
  // Same rule as the inspection list, and applied through the same helper so
  // the two cannot drift: a dashboard narrowed to "violations" must cover the
  // filed ones, or every chart on the page quietly excludes closed enforcement.
  if (scope.status && scope.status !== 'ALL') {
    match[statusFilterField(scope.status as InspectionStatus)] = scope.status;
  }

  if (scope.from || scope.to) {
    const range: Record<string, Date> = {};
    if (scope.from) range.$gte = scope.from;
    if (scope.to) range.$lte = scope.to;
    match.createdAt = range;
  }

  return match;
}

export interface DashboardSummary {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  finalized: number;
  drafts: number;
  /** Percentage of *assessed* inspections found compliant, 0–100. */
  complianceRate: number;
  averageScore: number;
  activeInspectors: number;
  totalViolationFindings: number;
}

/**
 * The KPI row.
 *
 * `complianceRate` is deliberately computed over assessed records only. A
 * dashboard that counts drafts as non-compliant reports a rate that falls
 * whenever an inspector opens a form, which is not a compliance signal.
 */
export async function getSummary(scope: AnalyticsScope): Promise<DashboardSummary> {
  const match = scopeMatch(scope);

  const [aggregate] = await Inspection.aggregate<{
    totalInspections: number;
    compliant: number;
    violations: number;
    reviewRequired: number;
    pendingReviews: number;
    finalized: number;
    drafts: number;
    assessed: number;
    scoreSum: number;
    scoreCount: number;
    violationFindings: number;
  }>([
    { $match: match },
    {
      $group: {
        _id: null,
        totalInspections: { $sum: 1 },
        compliant: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'COMPLIANT'] }, 1, 0] },
        },
        violations: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'VIOLATION_DETECTED'] }, 1, 0] },
        },
        reviewRequired: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'REVIEW_REQUIRED'] }, 1, 0] },
        },
        pendingReviews: { $sum: { $cond: [{ $eq: ['$status', 'REVIEW_REQUIRED'] }, 1, 0] } },
        finalized: { $sum: { $cond: [{ $eq: ['$status', 'FINALIZED'] }, 1, 0] } },
        drafts: { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
        assessed: { $sum: { $cond: [{ $ifNull: ['$complianceResult.status', false] }, 1, 0] } },
        scoreSum: { $sum: { $ifNull: ['$complianceResult.score', 0] } },
        scoreCount: { $sum: { $cond: [{ $ifNull: ['$complianceResult.score', false] }, 1, 0] } },
        violationFindings: {
          $sum: { $size: { $ifNull: ['$complianceResult.violations', []] } },
        },
      },
    },
  ]);

  const activeInspectors = await User.countDocuments({ role: 'INSPECTOR', status: 'ACTIVE' });

  const assessed = aggregate?.assessed ?? 0;

  return {
    totalInspections: aggregate?.totalInspections ?? 0,
    compliant: aggregate?.compliant ?? 0,
    violations: aggregate?.violations ?? 0,
    pendingReviews: aggregate?.pendingReviews ?? 0,
    finalized: aggregate?.finalized ?? 0,
    drafts: aggregate?.drafts ?? 0,
    complianceRate: assessed > 0 ? Math.round(((aggregate?.compliant ?? 0) / assessed) * 100) : 0,
    averageScore:
      aggregate && aggregate.scoreCount > 0
        ? Math.round(aggregate.scoreSum / aggregate.scoreCount)
        : 0,
    activeInspectors,
    totalViolationFindings: aggregate?.violationFindings ?? 0,
  };
}

export interface TrendPoint {
  date: string;
  total: number;
  compliant: number;
  violations: number;
  reviewRequired: number;
}

/**
 * Inspections over time.
 *
 * Buckets are filled in for days with no activity: a line chart that simply
 * omits quiet days draws a straight line through them and misrepresents the
 * gap as steady work.
 */
/**
 * The furthest back an all-time trend will reach.
 *
 * The series carries one point per day, so an unbounded window makes the
 * response grow with the age of the deployment — a decade of daily points is
 * three thousand objects on a field connection, for a chart the client then
 * collapses into fourteen columns anyway. Five years covers "all time" for any
 * realistic use of this system while keeping the payload bounded.
 */
const MAX_TREND_DAYS = 5 * 365;

export async function getTrend(scope: AnalyticsScope, days = 30): Promise<TrendPoint[]> {
  const to = scope.to ?? new Date();

  /**
   * `days === 0` is all time: run from the earliest record this caller can
   * see, rather than from a fixed offset.
   *
   * Scoped by `scopeMatch`, so an inspector's all-time starts at their own
   * first inspection and not at the department's.
   */
  let from = scope.from;

  if (!from) {
    if (days === 0) {
      const [earliest] = await Inspection.find(scopeMatch(scope))
        .sort({ createdAt: 1 })
        .limit(1)
        .select('createdAt')
        .lean<Array<{ createdAt: Date }>>();

      const floor = new Date(to.getTime() - (MAX_TREND_DAYS - 1) * 86_400_000);
      // No records at all: a single day, rather than five years of zeroes.
      from = earliest ? new Date(Math.max(earliest.createdAt.getTime(), floor.getTime())) : to;
    } else {
      from = new Date(to.getTime() - (days - 1) * 86_400_000);
    }
  }

  const rows = await Inspection.aggregate<{
    _id: string;
    total: number;
    compliant: number;
    violations: number;
    reviewRequired: number;
  }>([
    { $match: { ...scopeMatch(scope), createdAt: { $gte: from, $lte: to } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: 1 },
        compliant: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'COMPLIANT'] }, 1, 0] },
        },
        violations: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'VIOLATION_DETECTED'] }, 1, 0] },
        },
        reviewRequired: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'REVIEW_REQUIRED'] }, 1, 0] },
        },
      },
    },
  ]);

  const byDate = new Map(rows.map((row) => [row._id, row]));
  const points: TrendPoint[] = [];

  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= to) {
    const key = cursor.toISOString().slice(0, 10);
    const row = byDate.get(key);
    points.push({
      date: key,
      total: row?.total ?? 0,
      compliant: row?.compliant ?? 0,
      violations: row?.violations ?? 0,
      reviewRequired: row?.reviewRequired ?? 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return points;
}

export interface DistributionSlice {
  status: string;
  count: number;
}

/** Compliant / violation / review-required split, for the donut. */
export async function getComplianceDistribution(
  scope: AnalyticsScope,
): Promise<DistributionSlice[]> {
  const rows = await Inspection.aggregate<{ _id: string | null; count: number }>([
    { $match: scopeMatch(scope) },
    { $group: { _id: '$complianceResult.status', count: { $sum: 1 } } },
  ]);

  const counts = new Map(rows.map((row) => [row._id ?? 'NOT_ASSESSED', row.count]));

  return ['COMPLIANT', 'VIOLATION_DETECTED', 'REVIEW_REQUIRED', 'NOT_ASSESSED'].map((status) => ({
    status,
    count: counts.get(status) ?? 0,
  }));
}

export interface CategoryBar {
  category: string;
  inspections: number;
  violations: number;
}

/** Violations by product category, against the volume inspected in each. */
export async function getViolationsByCategory(scope: AnalyticsScope): Promise<CategoryBar[]> {
  const rows = await Inspection.aggregate<{
    _id: ProductCategory | null;
    inspections: number;
    violations: number;
  }>([
    { $match: scopeMatch(scope) },
    {
      $group: {
        _id: '$productCategory',
        inspections: { $sum: 1 },
        violations: {
          $sum: { $size: { $ifNull: ['$complianceResult.violations', []] } },
        },
      },
    },
    { $sort: { violations: -1 } },
  ]);

  return rows
    .filter((row) => row._id)
    .map((row) => ({
      category: row._id as string,
      inspections: row.inspections,
      violations: row.violations,
    }));
}

export interface ViolationTypeBar {
  code: string;
  title: string;
  category: ViolationCategory;
  severity: Severity;
  count: number;
}

/**
 * The most frequently raised findings.
 *
 * This is the chart that answers "what is actually going wrong in the market",
 * which is the question an enforcement supervisor is being asked upward.
 */
export async function getCommonViolationTypes(
  scope: AnalyticsScope,
  limit = 8,
): Promise<ViolationTypeBar[]> {
  return Inspection.aggregate<ViolationTypeBar>([
    { $match: scopeMatch(scope) },
    { $unwind: '$complianceResult.violations' },
    {
      $group: {
        _id: '$complianceResult.violations.code',
        title: { $first: '$complianceResult.violations.title' },
        category: { $first: '$complianceResult.violations.category' },
        severity: { $first: '$complianceResult.violations.severity' },
        count: { $sum: 1 },
      },
    },
    { $sort: { count: -1 } },
    { $limit: limit },
    {
      $project: {
        _id: 0,
        code: '$_id',
        title: 1,
        category: 1,
        severity: 1,
        count: 1,
      },
    },
  ]);
}

export interface InspectorActivityRow {
  inspectorId: string;
  id: string;
  name: string;
  status: string;
  district?: string;
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  complianceRate: number;
  lastActivityAt?: string;
}

/**
 * Per-inspector activity.
 *
 * Driven from the user collection rather than from inspections, so an inspector
 * who has filed nothing still appears — a roster with silent gaps is exactly
 * what a supervisor needs to see.
 */
export async function getInspectorActivity(
  scope: AnalyticsScope,
): Promise<InspectorActivityRow[]> {
  const match = scopeMatch(scope);

  const rows = await User.aggregate<{
    _id: mongoose.Types.ObjectId;
    inspectorId: string;
    name: string;
    status: string;
    district?: string;
    totalInspections: number;
    compliant: number;
    violations: number;
    pendingReviews: number;
    lastActivityAt?: Date;
  }>([
    { $match: { role: 'INSPECTOR' } },
    {
      $lookup: {
        from: 'inspections',
        let: { userId: '$_id' },
        pipeline: [
          { $match: { ...match, $expr: { $eq: ['$inspector', '$$userId'] } } },
          {
            $group: {
              _id: null,
              totalInspections: { $sum: 1 },
              compliant: {
                $sum: { $cond: [{ $eq: ['$complianceResult.status', 'COMPLIANT'] }, 1, 0] },
              },
              violations: {
                $sum: {
                  $cond: [{ $eq: ['$complianceResult.status', 'VIOLATION_DETECTED'] }, 1, 0],
                },
              },
              pendingReviews: {
                $sum: { $cond: [{ $eq: ['$status', 'REVIEW_REQUIRED'] }, 1, 0] },
              },
              lastActivityAt: { $max: '$createdAt' },
            },
          },
        ],
        as: 'agg',
      },
    },
    { $unwind: { path: '$agg', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        inspectorId: 1,
        name: 1,
        status: 1,
        district: 1,
        totalInspections: { $ifNull: ['$agg.totalInspections', 0] },
        compliant: { $ifNull: ['$agg.compliant', 0] },
        violations: { $ifNull: ['$agg.violations', 0] },
        pendingReviews: { $ifNull: ['$agg.pendingReviews', 0] },
        lastActivityAt: '$agg.lastActivityAt',
      },
    },
    { $sort: { totalInspections: -1, name: 1 } },
  ]);

  return rows.map((row) => {
    const assessed = row.compliant + row.violations;
    return {
      id: row._id.toString(),
      inspectorId: row.inspectorId,
      name: row.name,
      status: row.status,
      district: row.district,
      totalInspections: row.totalInspections,
      compliant: row.compliant,
      violations: row.violations,
      pendingReviews: row.pendingReviews,
      complianceRate: assessed > 0 ? Math.round((row.compliant / assessed) * 100) : 0,
      lastActivityAt: row.lastActivityAt?.toISOString(),
    };
  });
}

export interface DistrictRow {
  district: string;
  state?: string;
  inspections: number;
  violations: number;
  complianceRate: number;
  /** Assessed and compliant counts, so a caller grouping these rows into a
   *  state total can sum exact figures rather than average the percentages —
   *  a mean of rates over unequal denominators is not the rate of the whole. */
  assessed: number;
  compliant: number;
}

/**
 * Geographic summary.
 *
 * Returned as rows rather than as anything map-shaped: without authoritative
 * district boundaries, a choropleth would be decoration. The shape carries the
 * district name a real map layer would join on when one is added.
 */
export async function getDistrictSummary(scope: AnalyticsScope): Promise<DistrictRow[]> {
  const rows = await Inspection.aggregate<{
    _id: { district?: string; state?: string };
    inspections: number;
    compliant: number;
    violations: number;
    assessed: number;
  }>([
    { $match: scopeMatch(scope) },
    {
      $group: {
        _id: { district: '$location.district', state: '$location.state' },
        inspections: { $sum: 1 },
        compliant: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'COMPLIANT'] }, 1, 0] },
        },
        violations: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'VIOLATION_DETECTED'] }, 1, 0] },
        },
        assessed: { $sum: { $cond: [{ $ifNull: ['$complianceResult.status', false] }, 1, 0] } },
      },
    },
    { $sort: { inspections: -1 } },
  ]);

  return rows
    .filter((row) => row._id.district)
    .map((row) => ({
      district: row._id.district as string,
      state: row._id.state,
      inspections: row.inspections,
      violations: row.violations,
      complianceRate: row.assessed > 0 ? Math.round((row.compliant / row.assessed) * 100) : 0,
      assessed: row.assessed,
      compliant: row.compliant,
    }));
}
