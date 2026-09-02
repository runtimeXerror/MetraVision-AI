import type { Request, Response } from 'express';
import type { PipelineStage } from 'mongoose';

import { Inspection } from '../models';
import { canAccessAllInspections } from '../middleware/auth';
import { query } from '../middleware/validate';
import { scopeMatch, type AnalyticsScope } from '../services/analyticsService';
import { ApiError } from '../utils/ApiError';
import { ok, paginated } from '../utils/respond';
import type { ListViolationsQuery } from '../validators/schemas';

/**
 * Violations.
 *
 * A violation is not its own collection: it is a finding on an inspection's
 * compliance result, and it has no meaning detached from the inspection that
 * produced it. Giving it a table would mean two records that can disagree about
 * what was found.
 *
 * So the list is an `$unwind` over the embedded findings, projected into a flat
 * row. The composite `violationId` — `<inspection reference>:<finding code>` —
 * is stable and addressable without storing anything new.
 */

interface ViolationRow {
  violationId: string;
  inspectionId: string;
  inspectionRef: string;
  code: string;
  title: string;
  description: string;
  ruleReference: string;
  category: string;
  severity: string;
  expected: string;
  observed: string | null;
  recommendation: string;
  business: string;
  productName?: string;
  productCategory?: string;
  district?: string;
  state?: string;
  address?: string;
  inspector: { id: string; name: string; inspectorId: string };
  /** OPEN while the inspection is still live; RESOLVED once it is filed. */
  status: 'OPEN' | 'RESOLVED';
  inspectionStatus: string;
  detectedAt: string;
  finalizedAt?: string;
}

function scopeFrom(req: Request): AnalyticsScope {
  const params = query<ListViolationsQuery>(req);
  const user = req.user!;

  const scope: AnalyticsScope = {
    from: params.from ? new Date(params.from) : undefined,
    to: params.to ? new Date(params.to) : undefined,
    productCategory: params.productCategory,
    district: params.district,
    state: params.state,
  };

  if (canAccessAllInspections(user.role)) {
    if (params.inspectorId) scope.inspectorId = params.inspectorId;
  } else {
    scope.inspectorId = user.id;
  }

  return scope;
}

/** The shared `$unwind` + projection, used by both the list and the detail. */
function violationPipeline(match: PipelineStage.Match['$match']): PipelineStage[] {
  return [
    { $match: { ...match, 'complianceResult.violations.0': { $exists: true } } },
    { $unwind: '$complianceResult.violations' },
    {
      $lookup: {
        from: 'users',
        localField: 'inspector',
        foreignField: '_id',
        as: 'inspectorDoc',
      },
    },
    { $unwind: { path: '$inspectorDoc', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 0,
        violationId: {
          $concat: ['$inspectionId', ':', '$complianceResult.violations.code'],
        },
        inspectionId: { $toString: '$_id' },
        inspectionRef: '$inspectionId',
        code: '$complianceResult.violations.code',
        title: '$complianceResult.violations.title',
        description: '$complianceResult.violations.description',
        ruleReference: '$complianceResult.violations.ruleReference',
        category: '$complianceResult.violations.category',
        severity: '$complianceResult.violations.severity',
        expected: '$complianceResult.violations.expected',
        observed: '$complianceResult.violations.observed',
        recommendation: '$complianceResult.violations.recommendation',
        business: '$business.name',
        productName: '$productName',
        productCategory: '$productCategory',
        district: '$location.district',
        state: '$location.state',
        address: '$location.address',
        inspector: {
          id: { $toString: '$inspectorDoc._id' },
          name: '$inspectorDoc.name',
          inspectorId: '$inspectorDoc.inspectorId',
        },
        status: {
          $cond: [{ $eq: ['$status', 'FINALIZED'] }, 'RESOLVED', 'OPEN'],
        },
        inspectionStatus: '$status',
        detectedAt: '$complianceResult.evaluatedAt',
        finalizedAt: '$finalizedAt',
      },
    },
  ];
}

export async function listViolations(req: Request, res: Response): Promise<Response> {
  const params = query<ListViolationsQuery>(req);
  const match = scopeMatch(scopeFrom(req));

  const post: PipelineStage[] = [];

  if (params.severity) post.push({ $match: { severity: params.severity } });
  if (params.category) post.push({ $match: { category: params.category } });
  if (params.status) post.push({ $match: { status: params.status } });

  if (params.search) {
    const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    post.push({
      $match: {
        $or: [
          { violationId: pattern },
          { inspectionRef: pattern },
          { business: pattern },
          { title: pattern },
          { productName: pattern },
        ],
      },
    });
  }

  const severityOrder = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };

  // `$facet` keeps the count and the page in one round trip; splitting them
  // would re-run the unwind twice for every request.
  const [result] = await Inspection.aggregate<{
    items: ViolationRow[];
    meta: Array<{ total: number }>;
  }>([
    ...violationPipeline(match),
    ...post,
    {
      $addFields: {
        severityRank: {
          $switch: {
            branches: [
              { case: { $eq: ['$severity', 'CRITICAL'] }, then: severityOrder.CRITICAL },
              { case: { $eq: ['$severity', 'MAJOR'] }, then: severityOrder.MAJOR },
            ],
            default: severityOrder.MINOR,
          },
        },
      },
    },
    {
      $facet: {
        items: [
          // Newest first, and within a day the gravest finding leads.
          { $sort: { detectedAt: -1, severityRank: 1 } },
          { $skip: (params.page - 1) * params.pageSize },
          { $limit: params.pageSize },
          { $unset: 'severityRank' },
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

/**
 * One violation, with the inspection it was found on.
 *
 * The detail page shows the finding beside the evidence — images, extracted
 * fields, the full compliance result — so the whole inspection is returned
 * rather than making the client fetch it separately and stitch the two.
 */
export async function getViolation(req: Request, res: Response): Promise<Response> {
  const { id } = req.params as { id: string };

  // `INS-2026-00001:V-MISSING-FSSAI` — split on the last colon so a code
  // containing one is still parsed correctly.
  const separator = id.lastIndexOf(':');
  if (separator < 1) {
    throw ApiError.badRequest(
      'A violation reference looks like INS-2026-00001:CODE.',
      'INVALID_VIOLATION_ID',
    );
  }

  const inspectionRef = id.slice(0, separator);
  const code = id.slice(separator + 1);

  const inspection = await Inspection.findOne({ inspectionId: inspectionRef }).populate(
    'inspector',
    'name inspectorId role',
  );

  if (!inspection) {
    throw ApiError.notFound('That violation could not be found.', 'VIOLATION_NOT_FOUND');
  }

  const user = req.user!;
  if (!canAccessAllInspections(user.role) && inspection.inspector.toString() !== user.id) {
    throw ApiError.forbidden('You do not have access to this violation.');
  }

  const dto = inspection.toDTO();
  const violation = dto.complianceResult?.violations.find((entry) => entry.code === code);

  if (!violation) {
    throw ApiError.notFound('That violation could not be found.', 'VIOLATION_NOT_FOUND');
  }

  return ok(res, {
    violationId: `${inspectionRef}:${code}`,
    violation,
    status: dto.status === 'FINALIZED' ? 'RESOLVED' : 'OPEN',
    inspection: dto,
  });
}

/** Headline counts for the violations page. */
export async function getViolationStats(req: Request, res: Response): Promise<Response> {
  const match = scopeMatch(scopeFrom(req));

  const [result] = await Inspection.aggregate<{
    total: number;
    open: number;
    resolved: number;
    critical: number;
    major: number;
    minor: number;
  }>([
    ...violationPipeline(match),
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        open: { $sum: { $cond: [{ $eq: ['$status', 'OPEN'] }, 1, 0] } },
        resolved: { $sum: { $cond: [{ $eq: ['$status', 'RESOLVED'] }, 1, 0] } },
        critical: { $sum: { $cond: [{ $eq: ['$severity', 'CRITICAL'] }, 1, 0] } },
        major: { $sum: { $cond: [{ $eq: ['$severity', 'MAJOR'] }, 1, 0] } },
        minor: { $sum: { $cond: [{ $eq: ['$severity', 'MINOR'] }, 1, 0] } },
      },
    },
    { $project: { _id: 0 } },
  ]);

  return ok(res, {
    total: result?.total ?? 0,
    open: result?.open ?? 0,
    resolved: result?.resolved ?? 0,
    critical: result?.critical ?? 0,
    major: result?.major ?? 0,
    minor: result?.minor ?? 0,
  });
}
