import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';

import { Inspection } from '../models';
import { canAccessAllInspections } from '../middleware/auth';
import { query } from '../middleware/validate';
import { scopeMatch, type AnalyticsScope } from '../services/analyticsService';
import { paginated } from '../utils/respond';
import type { ListProductsQuery } from '../validators/schemas';

/**
 * Products.
 *
 * There is no product collection, and deliberately so: this system inspects
 * *packages presented at a premises*, and the same commodity inspected at two
 * shops is two pieces of evidence, not one product record with a shared state.
 * A product master would also require a catalogue authority the department does
 * not have here.
 *
 * What the dashboard actually needs is the inspection history rolled up by
 * commodity, which is what this returns — grouped on the product name and
 * category recorded at inspection time.
 */

interface ProductRow {
  productKey: string;
  productName: string;
  productCategory?: string;
  brand?: string;
  inspections: number;
  violations: number;
  compliant: number;
  complianceRate: number;
  lastInspectedAt: string;
  businesses: string[];
}

export async function listProducts(req: Request, res: Response): Promise<Response> {
  const params = query<ListProductsQuery>(req);
  const user = req.user!;

  const scope: AnalyticsScope = {
    from: params.from ? new Date(params.from) : undefined,
    to: params.to ? new Date(params.to) : undefined,
    productCategory: params.productCategory,
  };

  if (canAccessAllInspections(user.role)) {
    if (params.inspectorId) scope.inspectorId = params.inspectorId;
  } else {
    scope.inspectorId = user.id;
  }

  const post: PipelineStage[] = [];
  if (params.search) {
    const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    post.push({ $match: { $or: [{ productName: pattern }, { businesses: pattern }] } });
  }

  const [result] = await Inspection.aggregate<{
    items: ProductRow[];
    meta: Array<{ total: number }>;
  }>([
    { $match: { ...scopeMatch(scope), productName: { $nin: [null, ''] } } },
    {
      $group: {
        _id: { name: '$productName', category: '$productCategory' },
        inspections: { $sum: 1 },
        compliant: {
          $sum: { $cond: [{ $eq: ['$complianceResult.status', 'COMPLIANT'] }, 1, 0] },
        },
        violations: {
          $sum: { $size: { $ifNull: ['$complianceResult.violations', []] } },
        },
        assessed: { $sum: { $cond: [{ $ifNull: ['$complianceResult.status', false] }, 1, 0] } },
        lastInspectedAt: { $max: '$createdAt' },
        businesses: { $addToSet: '$business.name' },
      },
    },
    {
      $project: {
        _id: 0,
        // Name plus category, so two commodities that share a name in different
        // categories stay distinct and remain addressable in a URL.
        productKey: {
          $concat: ['$_id.name', '::', { $ifNull: ['$_id.category', 'other'] }],
        },
        productName: '$_id.name',
        productCategory: '$_id.category',
        inspections: 1,
        compliant: 1,
        violations: 1,
        complianceRate: {
          $cond: [
            { $gt: ['$assessed', 0] },
            { $round: [{ $multiply: [{ $divide: ['$compliant', '$assessed'] }, 100] }, 0] },
            0,
          ],
        },
        lastInspectedAt: 1,
        businesses: 1,
      },
    },
    ...post,
    {
      $facet: {
        items: [
          { $sort: { inspections: -1, productName: 1 } },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
        ],
        meta: [{ $count: 'total' }],
      },
    },
  ]);

  const total = result?.meta[0]?.total ?? 0;

  return paginated(res, result?.items ?? [], {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
  });
}
