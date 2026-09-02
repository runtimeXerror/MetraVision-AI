import type { Request, Response } from 'express';

import { canAccessAllInspections } from '../middleware/auth';
import { query } from '../middleware/validate';
import * as analytics from '../services/analyticsService';
import type { AnalyticsScope } from '../services/analyticsService';
import { ok } from '../utils/respond';
import type { AnalyticsQuery } from '../validators/schemas';

/**
 * Dashboard analytics.
 *
 * Read-only, and scoped by the same rule as every other list in the API: an
 * inspector sees their own work, a supervisor or admin sees the department's.
 * The scope is derived here from the token rather than accepted from the query
 * string, so a caller cannot widen it by editing a URL.
 */

function scopeFrom(req: Request): AnalyticsScope {
  const params = query<AnalyticsQuery>(req);
  const user = req.user!;

  const scope: AnalyticsScope = {
    from: params.from ? new Date(params.from) : undefined,
    to: params.to ? new Date(params.to) : undefined,
    productCategory: params.productCategory,
    district: params.district,
    state: params.state,
    status: params.status,
  };

  if (canAccessAllInspections(user.role)) {
    // A supervisor may narrow to one inspector; an inspector may not widen.
    if (params.inspectorId) scope.inspectorId = params.inspectorId;
  } else {
    scope.inspectorId = user.id;
  }

  return scope;
}

export async function getSummary(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getSummary(scopeFrom(req)));
}

export async function getTrend(req: Request, res: Response): Promise<Response> {
  const params = query<AnalyticsQuery>(req);
  return ok(res, await analytics.getTrend(scopeFrom(req), params.days));
}

export async function getDistribution(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getComplianceDistribution(scopeFrom(req)));
}

export async function getViolationsByCategory(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getViolationsByCategory(scopeFrom(req)));
}

export async function getViolationTypes(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getCommonViolationTypes(scopeFrom(req)));
}

export async function getInspectorActivity(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getInspectorActivity(scopeFrom(req)));
}

export async function getDistricts(req: Request, res: Response): Promise<Response> {
  return ok(res, await analytics.getDistrictSummary(scopeFrom(req)));
}

/**
 * Everything the overview page needs, in one round trip.
 *
 * The dashboard would otherwise open with seven parallel requests, each
 * re-running the same `$match` — and each able to arrive in a different order
 * and paint the page in stages.
 */
export async function getOverview(req: Request, res: Response): Promise<Response> {
  const scope = scopeFrom(req);
  const params = query<AnalyticsQuery>(req);

  const [summary, trend, distribution, byCategory, violationTypes, inspectors, districts] =
    await Promise.all([
      analytics.getSummary(scope),
      analytics.getTrend(scope, params.days),
      analytics.getComplianceDistribution(scope),
      analytics.getViolationsByCategory(scope),
      analytics.getCommonViolationTypes(scope),
      analytics.getInspectorActivity(scope),
      analytics.getDistrictSummary(scope),
    ]);

  return ok(res, {
    summary,
    trend,
    distribution,
    violationsByCategory: byCategory,
    violationTypes,
    inspectorActivity: inspectors,
    districts,
  });
}
