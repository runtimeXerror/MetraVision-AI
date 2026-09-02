import type { Request, Response } from 'express';
import mongoose, { type FilterQuery, type SortOrder } from 'mongoose';

import { canAccessAllInspections } from '../middleware/auth';
import { query } from '../middleware/validate';
import { Inspection, type InspectionAttrs, type InspectionDocument } from '../models/Inspection';
import { analyseInspection } from '../services/analysisService';
import { evaluateCompliance, needsReview } from '../services/complianceService';
import type { ProductCategory, StatsDTO } from '../types/domain';
import { ApiError } from '../utils/ApiError';
import { nextInspectionReference } from '../utils/referenceId';
import { created, ok, paginated } from '../utils/respond';
import type { ListInspectionsQuery } from '../validators/schemas';

/**
 * Inspection lifecycle.
 *
 * Authorisation rule, applied by `loadInspection` on every single-record route:
 * an inspector reaches only their own records; a supervisor or admin reaches
 * the whole jurisdiction. Enforcing it in one loader rather than per handler is
 * what stops a new endpoint from quietly forgetting the check.
 */

async function loadInspection(req: Request): Promise<InspectionDocument> {
  const { id } = req.params as { id: string };

  // The route accepts either a Mongo id or a human reference.
  const filter: FilterQuery<InspectionAttrs> = /^[0-9a-fA-F]{24}$/.test(id)
    ? { _id: id }
    : { inspectionId: id.toUpperCase() };

  const inspection = await Inspection.findOne(filter).populate('inspector', 'name inspectorId role');

  if (!inspection) {
    throw ApiError.notFound('That inspection could not be found.', 'INSPECTION_NOT_FOUND');
  }

  const user = req.user!;
  const ownerId = String(
    (inspection.inspector as unknown as { _id?: unknown })?._id ?? inspection.inspector,
  );

  if (ownerId !== user.id && !canAccessAllInspections(user.role)) {
    // Deliberately a 404, not a 403: confirming the record exists would leak
    // that another inspector filed an inspection at that reference.
    throw ApiError.notFound('That inspection could not be found.', 'INSPECTION_NOT_FOUND');
  }

  return inspection;
}

/** Guards the write paths — a filed record is not editable. */
function assertMutable(inspection: InspectionDocument): void {
  if (inspection.status === 'FINALIZED') {
    throw ApiError.conflict(
      'This inspection has been finalized and can no longer be modified.',
      'INSPECTION_FINALIZED',
    );
  }
}

/* ── Create / read / update / delete ──────────────────────────────────────── */

export async function createInspection(req: Request, res: Response): Promise<Response> {
  const body = req.body as {
    business: { name: string; ownerName?: string; contact?: string };
    location: {
      address: string;
      district?: string;
      state?: string;
      latitude?: number;
      longitude?: number;
      accuracyM?: number;
    };
    productCategory?: ProductCategory;
    productName?: string;
    notes?: string;
  };

  const inspection = await Inspection.create({
    inspectionId: await nextInspectionReference(),
    inspector: req.user!.id,
    business: body.business,
    location: body.location,
    productCategory: body.productCategory,
    productName: body.productName,
    notes: body.notes,
    images: [],
    extractedFields: [],
    status: 'DRAFT',
  });

  await inspection.populate('inspector', 'name inspectorId role');
  return created(res, inspection.toDTO(), 'Inspection created successfully');
}

export async function listInspections(req: Request, res: Response): Promise<Response> {
  const params = query<ListInspectionsQuery>(req);
  const user = req.user!;

  const filter: FilterQuery<InspectionAttrs> = {};

  // Scope first: an inspector never sees another inspector's records.
  if (canAccessAllInspections(user.role)) {
    if (params.inspectorId) filter.inspector = params.inspectorId;
  } else {
    filter.inspector = user.id;
  }

  if (params.status && params.status !== 'ALL') filter.status = params.status;
  if (params.productCategory) filter.productCategory = params.productCategory;

  // Jurisdiction. These were accepted by the query string and then dropped by
  // the schema, so a narrowed request came back as the whole register and the
  // caller had no way to tell — the worst kind of filter bug, because the page
  // looks like it worked.
  if (params.district) filter['location.district'] = params.district;
  if (params.state) filter['location.state'] = params.state;

  if (params.from || params.to) {
    filter.createdAt = {};
    if (params.from) Object.assign(filter.createdAt, { $gte: new Date(params.from) });
    if (params.to) Object.assign(filter.createdAt, { $lte: new Date(params.to) });
  }

  if (params.search) {
    // A regex OR rather than $text: it matches partial tokens, which is what an
    // inspector typing half a reference number actually expects.
    const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(escaped, 'i');
    filter.$or = [
      { inspectionId: pattern },
      { 'business.name': pattern },
      { productName: pattern },
      { 'location.address': pattern },
    ];
  }

  const sort: Record<string, SortOrder> =
    params.sort === 'oldest'
      ? { createdAt: 1 }
      : params.sort === 'score'
        ? { 'complianceResult.score': 1 }
        : { createdAt: -1 };

  const [items, total] = await Promise.all([
    Inspection.find(filter)
      .populate('inspector', 'name inspectorId role')
      .sort(sort)
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize),
    Inspection.countDocuments(filter),
  ]);

  return paginated(
    res,
    items.map((item) => item.toDTO()),
    {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
    },
  );
}

export async function getInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);
  return ok(res, inspection.toDTO());
}

export async function updateInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);
  assertMutable(inspection);

  const body = req.body as Record<string, unknown>;

  if (body.business) Object.assign(inspection.business, body.business);
  if (body.location) Object.assign(inspection.location, body.location);
  if (body.productCategory !== undefined) {
    inspection.productCategory = body.productCategory as ProductCategory;
  }
  if (body.productName !== undefined) inspection.productName = body.productName as string;
  if (body.notes !== undefined) inspection.notes = body.notes as string;

  await inspection.save();
  return ok(res, inspection.toDTO(), 'Inspection updated successfully');
}

export async function deleteInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  // A finalized inspection is an enforcement record. Only an admin may remove
  // one, and even then it is a deliberate administrative act.
  if (inspection.status === 'FINALIZED' && req.user!.role !== 'ADMIN') {
    throw ApiError.forbidden('A finalized inspection can only be deleted by an administrator.');
  }

  await inspection.deleteOne();
  return ok(res, { deleted: true, inspectionId: inspection.inspectionId }, 'Inspection deleted');
}

/* ── Analysis ─────────────────────────────────────────────────────────────── */

export async function analyzeInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);
  assertMutable(inspection);

  if (inspection.images.length === 0) {
    throw ApiError.badRequest(
      'Upload at least one product image before running the analysis.',
      'NO_IMAGES',
    );
  }

  const { categoryHint } = req.body as { categoryHint?: ProductCategory };

  inspection.status = 'PROCESSING';
  await inspection.save();

  try {
    const result = await analyseInspection({
      inspectionId: inspection.inspectionId,
      images: inspection.images.map((image) => ({
        imageId: image.imageId,
        type: image.type,
        url: image.url,
      })),
      categoryHint: categoryHint ?? inspection.productCategory,
    });

    const category = result.analysis.category.value;

    inspection.extractedFields = result.fields.map((field) => ({
      name: field.name,
      label: field.label,
      aiValue: field.aiValue,
      confidence: field.confidence,
      bbox: field.bbox ? [...field.bbox] : undefined,
      sourceImageId: field.sourceImageId,
      required: field.required,
    }));

    inspection.aiAnalysis = {
      engine: result.analysis.engine,
      engineVersion: result.analysis.engineVersion,
      categoryValue: category,
      categoryConfidence: result.analysis.category.confidence,
      origin: result.analysis.origin,
      meanConfidence: result.analysis.meanConfidence,
      processingMs: result.analysis.processingMs,
      imageIds: inspection.images.map((image) => image.imageId),
      analysedAt: new Date(),
      warnings: result.analysis.warnings,
      bboxSpaceWidth: result.analysis.bboxSpace.width,
      bboxSpaceHeight: result.analysis.bboxSpace.height,
    };

    // The inspector's own categorisation wins if they set one; otherwise adopt
    // what the analyser inferred, since the rule set follows from it.
    if (!inspection.productCategory) inspection.productCategory = category;

    const compliance = evaluateCompliance({
      fields: result.fields,
      category: inspection.productCategory,
    });

    inspection.complianceResult = {
      ...compliance,
      warnings: [...compliance.warnings, ...result.analysis.warnings],
      evaluatedAt: new Date(),
    };

    inspection.status = compliance.status;
    await inspection.save();

    return ok(res, inspection.toDTO(), 'Analysis complete');
  } catch (error) {
    // Never strand the record in PROCESSING — an inspector would have no way
    // to retry from the mobile app.
    inspection.status = inspection.extractedFields.length > 0 ? 'REVIEW_REQUIRED' : 'DRAFT';
    await inspection.save();
    throw error;
  }
}

/* ── Review ───────────────────────────────────────────────────────────────── */

interface ReviewDecision {
  fieldName: string;
  action: 'ACCEPTED' | 'EDITED' | 'MARKED_UNAVAILABLE';
  value?: string | null;
  comment?: string;
}

export async function reviewInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);
  assertMutable(inspection);

  const body = req.body as ReviewDecision | { reviews: ReviewDecision[] };
  const decisions: ReviewDecision[] = 'reviews' in body ? body.reviews : [body];

  const now = new Date();

  for (const decision of decisions) {
    const field = inspection.extractedFields.find((item) => item.name === decision.fieldName);

    if (!field) {
      throw ApiError.notFound(
        `No extracted field named "${decision.fieldName}" on this inspection.`,
        'FIELD_NOT_FOUND',
      );
    }

    /**
     * `aiValue` is never touched. The inspector's determination is written to
     * `humanVerifiedValue` beside it, so the record always shows both what the
     * model read and what a human concluded.
     */
    field.reviewAction = decision.action;
    field.humanVerifiedBy = req.user!.id as unknown as typeof field.humanVerifiedBy;
    field.humanVerifiedAt = now;
    if (decision.comment !== undefined) field.reviewComment = decision.comment;

    if (decision.action === 'ACCEPTED') {
      field.humanVerifiedValue = field.aiValue;
    } else if (decision.action === 'EDITED') {
      field.humanVerifiedValue = decision.value ?? null;
    } else {
      field.humanVerifiedValue = null;
    }
  }

  inspection.lastReviewedAt = now;

  // Re-evaluate: a correction can turn a REVIEW_REQUIRED into a COMPLIANT, and
  // marking a mandatory declaration unavailable turns it into a violation.
  const compliance = evaluateCompliance({
    fields: inspection.extractedFields.map((field) => ({
      name: field.name,
      label: field.label,
      aiValue: field.aiValue,
      confidence: field.confidence,
      required: field.required,
      humanVerifiedValue: field.humanVerifiedValue,
      reviewAction: field.reviewAction,
      bbox: undefined,
    })),
    category: inspection.productCategory,
  });

  inspection.complianceResult = {
    ...compliance,
    warnings: inspection.complianceResult?.warnings ?? [],
    evaluatedAt: now,
  };
  inspection.status = compliance.status;

  await inspection.save();
  return ok(res, inspection.toDTO(), 'Review recorded');
}

/* ── Finalize ─────────────────────────────────────────────────────────────── */

export async function finalizeInspection(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);

  if (inspection.status === 'FINALIZED') {
    throw ApiError.conflict('This inspection has already been finalized.', 'ALREADY_FINALIZED');
  }

  if (!inspection.complianceResult) {
    throw ApiError.badRequest(
      'Run the analysis before finalizing this inspection.',
      'ANALYSIS_REQUIRED',
    );
  }

  const { finalNotes } = req.body as { finalNotes?: string };

  if (finalNotes !== undefined) inspection.finalNotes = finalNotes;
  inspection.status = 'FINALIZED';
  inspection.finalizedAt = new Date();

  await inspection.save();
  return ok(res, inspection.toDTO(), 'Inspection finalized successfully');
}

/* ── Stats ────────────────────────────────────────────────────────────────── */

export async function getStats(req: Request, res: Response): Promise<Response> {
  const user = req.user!;

  // `aggregate` does not cast like `find` does, so the id has to be a real
  // ObjectId here — a string silently matches nothing.
  const scope: FilterQuery<InspectionAttrs> = canAccessAllInspections(user.role)
    ? {}
    : { inspector: new mongoose.Types.ObjectId(user.id) };

  const [aggregate] = await Inspection.aggregate<{
    totalInspections: number;
    compliant: number;
    violations: number;
    pendingReviews: number;
    finalized: number;
    scoreSum: number;
    scoreCount: number;
  }>([
    { $match: scope },
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
        pendingReviews: {
          $sum: { $cond: [{ $eq: ['$status', 'REVIEW_REQUIRED'] }, 1, 0] },
        },
        finalized: { $sum: { $cond: [{ $eq: ['$status', 'FINALIZED'] }, 1, 0] } },
        scoreSum: { $sum: { $ifNull: ['$complianceResult.score', 0] } },
        scoreCount: {
          $sum: { $cond: [{ $ifNull: ['$complianceResult.score', false] }, 1, 0] },
        },
      },
    },
  ]);

  const stats: StatsDTO = {
    totalInspections: aggregate?.totalInspections ?? 0,
    compliant: aggregate?.compliant ?? 0,
    violations: aggregate?.violations ?? 0,
    pendingReviews: aggregate?.pendingReviews ?? 0,
    finalized: aggregate?.finalized ?? 0,
    averageScore:
      aggregate && aggregate.scoreCount > 0
        ? Math.round(aggregate.scoreSum / aggregate.scoreCount)
        : 0,
  };

  return ok(res, stats);
}

/* ── Report ───────────────────────────────────────────────────────────────── */

export async function getReport(req: Request, res: Response): Promise<Response> {
  const inspection = await loadInspection(req);
  const dto = inspection.toDTO();

  if (!dto.complianceResult) {
    throw ApiError.badRequest(
      'This inspection has not been analysed, so no report can be issued.',
      'ANALYSIS_REQUIRED',
    );
  }

  const pending = inspection.extractedFields.filter((field) =>
    needsReview({
      name: field.name,
      label: field.label,
      aiValue: field.aiValue,
      confidence: field.confidence,
      required: field.required,
      reviewAction: field.reviewAction,
    }),
  ).length;

  /**
   * A report is a *snapshot* shaped for presentation, not a second copy of the
   * inspection document. PDF rendering is Phase 3; this is the structured
   * payload that renderer will consume.
   */
  return ok(res, {
    inspectionId: dto.inspectionId,
    generatedAt: new Date().toISOString(),
    inspector: dto.inspector,
    business: dto.business,
    location: dto.location,
    product: {
      category: dto.productCategory,
      name: dto.productName,
      origin: dto.aiAnalysis?.origin,
    },
    images: dto.images,
    extractedFields: dto.extractedFields,
    aiAnalysis: dto.aiAnalysis,
    complianceResult: dto.complianceResult,
    review: { ...dto.review, pendingFieldCount: pending },
    notes: [dto.notes, dto.finalNotes].filter(Boolean),
    status: dto.status,
    createdAt: dto.createdAt,
    finalizedAt: dto.finalizedAt,
  });
}

export { loadInspection };
