import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import {
  ANALYSIS_ENGINES,
  CHECK_RESULTS,
  COMPLIANCE_STATUSES,
  IMAGE_TYPES,
  INSPECTION_STATUSES,
  PACKAGE_ORIGINS,
  PRODUCT_CATEGORIES,
  REVIEW_ACTIONS,
  SEVERITIES,
  VIOLATION_CATEGORIES,
  type AnalysisEngine,
  type CheckResult,
  type ComplianceStatus,
  type ImageType,
  type InspectionDTO,
  type InspectionStatus,
  type PackageOrigin,
  type ProductCategory,
  type ReviewAction,
  type ScanRecordDTO,
  type Severity,
  type UserRole,
  type ViolationCategory,
} from '../types/domain';

/**
 * The inspection record.
 *
 * Images, extracted fields, the analysis and the compliance result are all
 * embedded rather than referenced. An inspection is read as a whole — the
 * detail screen and the report both need every part — and it is never large
 * enough to approach the 16 MB document limit, since images are stored as URLs
 * and not as binary.
 */

/* ── Embedded shapes ──────────────────────────────────────────────────────── */

export interface InspectionImageAttrs {
  imageId: string;
  type: ImageType;
  /** Storage key; resolved to a URL by the storage provider on read. */
  storageKey: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: Date;
}

export interface ExtractedFieldAttrs {
  name: string;
  label: string;
  aiValue: string | null;
  confidence: number;
  bbox?: number[];
  sourceImageId?: string;
  required: boolean;
  humanVerifiedValue?: string | null;
  humanVerifiedBy?: Types.ObjectId;
  humanVerifiedAt?: Date;
  reviewAction?: ReviewAction;
  reviewComment?: string;
}

export interface ComplianceCheckAttrs {
  code: string;
  title: string;
  ruleReference: string;
  result: CheckResult;
  severity: Severity;
  category: ViolationCategory;
  expected: string;
  observed: string | null;
  message: string;
  relatedFieldNames: string[];
}

export interface ViolationAttrs {
  code: string;
  title: string;
  ruleReference: string;
  category: ViolationCategory;
  severity: Severity;
  description: string;
  expected: string;
  observed: string | null;
  recommendation: string;
  bbox?: number[];
  sourceImageId?: string;
}

export interface InspectionAttrs {
  inspectionId: string;
  inspector: Types.ObjectId;
  business: { name: string; ownerName?: string; contact?: string };
  location: {
    address: string;
    district?: string;
    state?: string;
    /** Six-digit Indian PIN, from the reverse-geocode or typed by the inspector. */
    pincode?: string;
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
  };
  productCategory?: ProductCategory;
  productName?: string;
  images: InspectionImageAttrs[];
  extractedFields: ExtractedFieldAttrs[];
  aiAnalysis?: {
    engine: AnalysisEngine;
    engineVersion: string;
    categoryValue: ProductCategory;
    categoryConfidence: number;
    origin: PackageOrigin;
    meanConfidence: number;
    processingMs: number;
    imageIds: string[];
    analysedAt: Date;
    warnings: string[];
    bboxSpaceWidth: number;
    bboxSpaceHeight: number;
  };
  complianceResult?: {
    status: ComplianceStatus;
    score: number;
    checks: ComplianceCheckAttrs[];
    violations: ViolationAttrs[];
    warnings: string[];
    ruleSetId: string;
    ruleSetLabel: string;
    evaluatedAt: Date;
  };
  /**
   * The OCR → extraction → rule-engine record for a scanned inspection.
   *
   * Stored whole and never recomputed. `complianceResult` above is a lossy
   * projection of `scan.legal` for the screens that predate the rule engine;
   * where the two disagree, this is the one that is right. See
   * `services/scan/legacyProjection.ts`.
   *
   * Every stage records the version of whatever produced it, so an inspection
   * from last March can be told apart from the same package scanned today with
   * a different OCR provider and a corpus that has since gained an amendment.
   */
  scan?: ScanRecordAttrs;

  notes?: string;
  finalNotes?: string;
  status: InspectionStatus;
  lastReviewedAt?: Date;
  finalizedAt?: Date;
}

export interface ScanRecordAttrs {
  ocr: {
    provider: string;
    providerVersion?: string;
    /** The full text, so a re-extraction never needs the images again. */
    rawText: string;
    lineCount: number;
    characterCount: number;
    confidenceAvailable: boolean;
    /** Located lines. Capped on write — see `MAX_STORED_REGIONS`. */
    regions: unknown[];
    processingMs: number;
    imageIds: string[];
  };
  extraction: {
    engine: string;
    engineVersion: string;
    processingMs: number;
    fields: Record<string, unknown>;
    informational: Record<string, unknown>;
    contextSignals: unknown[];
    unclaimedLines: string[];
    warnings: string[];
  };
  legal: {
    status: string;
    /**
     * The date the rules were resolved against — not the date the evaluation
     * ran. Stored because a report regenerated a year later must state the law
     * as it stood on the day of the inspection, and `evaluatedAt` is the wrong
     * date for that in every case where the two differ.
     */
    inspectionDate: string;
    summary: Record<string, unknown>;
    checks: unknown[];
    applicableRules: unknown[];
    warnings: unknown[];
    issues: unknown[];
    issueSummary: Record<string, unknown>;
    thresholds: Record<string, unknown>;
    ruleSetVersion: string;
    ruleSetChecksum: string;
    engineVersion: string;
    evaluatedAt: Date;
    durationMs: number;
  };
  report: {
    reportId: string;
    generatedAt: Date;
    reportVersion: string;
  };
  captureCompleteness: number;
  contextApplied: unknown[];
  contextOverridden: unknown[];
  timings: Record<string, number>;
  scannedAt: Date;
}

export interface InspectionDocument extends HydratedDocument<InspectionAttrs> {
  toDTO(baseUrl?: string): InspectionDTO;
}

type InspectionModel = Model<InspectionAttrs, Record<string, never>, InspectionDocument>;

/* ── Sub-schemas ──────────────────────────────────────────────────────────── */

const imageSchema = new Schema<InspectionImageAttrs>(
  {
    imageId: { type: String, required: true },
    type: { type: String, enum: IMAGE_TYPES, required: true },
    // Empty for a record with no stored photograph — seeded demo inspections
    // carry image slots without bytes behind them, and Mongoose treats '' as
    // missing, so these cannot be `required`.
    storageKey: { type: String, default: '' },
    url: { type: String, default: '' },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: Number,
    height: Number,
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const extractedFieldSchema = new Schema<ExtractedFieldAttrs>(
  {
    name: { type: String, required: true },
    label: { type: String, required: true },
    // `null` is meaningful — it records that the analyser found nothing, which
    // is different from the field never having been examined.
    aiValue: { type: String, default: null },
    confidence: { type: Number, required: true, min: 0, max: 1 },
    bbox: { type: [Number], validate: (v: number[]) => v.length === 0 || v.length === 4 },
    sourceImageId: String,
    required: { type: Boolean, default: true },
    humanVerifiedValue: { type: String, default: undefined },
    humanVerifiedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    humanVerifiedAt: Date,
    reviewAction: { type: String, enum: REVIEW_ACTIONS },
    reviewComment: String,
  },
  { _id: false },
);

const checkSchema = new Schema<ComplianceCheckAttrs>(
  {
    code: { type: String, required: true },
    title: { type: String, required: true },
    ruleReference: { type: String, required: true },
    result: { type: String, enum: CHECK_RESULTS, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    category: { type: String, enum: VIOLATION_CATEGORIES, required: true },
    expected: { type: String, required: true },
    observed: { type: String, default: null },
    message: { type: String, required: true },
    relatedFieldNames: { type: [String], default: [] },
  },
  { _id: false },
);

const violationSchema = new Schema<ViolationAttrs>(
  {
    code: { type: String, required: true },
    title: { type: String, required: true },
    ruleReference: { type: String, required: true },
    category: { type: String, enum: VIOLATION_CATEGORIES, required: true },
    severity: { type: String, enum: SEVERITIES, required: true },
    description: { type: String, required: true },
    expected: { type: String, required: true },
    observed: { type: String, default: null },
    recommendation: { type: String, required: true },
    bbox: { type: [Number] },
    sourceImageId: String,
  },
  { _id: false },
);

/** Narrows a stored number array to the 4-tuple the DTO declares. */
function toBBox(bbox?: number[]): [number, number, number, number] | undefined {
  if (!bbox || bbox.length !== 4) return undefined;
  return [bbox[0]!, bbox[1]!, bbox[2]!, bbox[3]!];
}

/* ── Root schema ──────────────────────────────────────────────────────────── */

const inspectionSchema = new Schema<InspectionAttrs, InspectionModel, InspectionDocument>(
  {
    inspectionId: { type: String, required: true, unique: true, trim: true },
    inspector: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    business: {
      name: { type: String, required: true, trim: true },
      ownerName: { type: String, trim: true },
      contact: { type: String, trim: true },
    },
    location: {
      address: { type: String, required: true, trim: true },
      district: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, trim: true },
      // Where the device was standing when the inspection was opened. Kept
      // beside the address rather than replacing it: an inspector may correct
      // the address a reverse-geocode got wrong, and the fix itself is the
      // evidence of where the officer actually was.
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
      accuracyM: { type: Number, min: 0 },
    },
    productCategory: { type: String, enum: PRODUCT_CATEGORIES },
    productName: { type: String, trim: true },
    images: { type: [imageSchema], default: [] },
    extractedFields: { type: [extractedFieldSchema], default: [] },
    aiAnalysis: {
      type: new Schema(
        {
          engine: { type: String, enum: ANALYSIS_ENGINES, required: true },
          engineVersion: { type: String, required: true },
          categoryValue: { type: String, enum: PRODUCT_CATEGORIES, required: true },
          categoryConfidence: { type: Number, required: true },
          origin: { type: String, enum: PACKAGE_ORIGINS, default: 'DOMESTIC' },
          meanConfidence: { type: Number, required: true },
          processingMs: { type: Number, required: true },
          imageIds: { type: [String], default: [] },
          analysedAt: { type: Date, default: Date.now },
          warnings: { type: [String], default: [] },
          bboxSpaceWidth: { type: Number, default: 800 },
          bboxSpaceHeight: { type: Number, default: 1000 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    complianceResult: {
      type: new Schema(
        {
          status: { type: String, enum: COMPLIANCE_STATUSES, required: true },
          score: { type: Number, required: true, min: 0, max: 100 },
          checks: { type: [checkSchema], default: [] },
          violations: { type: [violationSchema], default: [] },
          warnings: { type: [String], default: [] },
          ruleSetId: { type: String, required: true },
          ruleSetLabel: { type: String, required: true },
          evaluatedAt: { type: Date, default: Date.now },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /**
     * The scan record, stored as `Mixed`.
     *
     * The engine's own types are the schema here, and re-declaring them in
     * Mongoose would give the project two definitions of a compliance check
     * that could drift apart — the newer of which would silently strip fields
     * the other had added. `minimize: false` on the root schema keeps empty
     * objects rather than deleting them, which matters for a `summary` whose
     * counts are all legitimately zero.
     */
    scan: { type: Schema.Types.Mixed, default: undefined },

    notes: { type: String, trim: true },
    finalNotes: { type: String, trim: true },
    status: { type: String, enum: INSPECTION_STATUSES, default: 'DRAFT', required: true },
    lastReviewedAt: Date,
    finalizedAt: Date,
  },
  // `minimize: false` so an all-zero compliance summary inside `scan` survives
  // the write instead of being deleted as an empty object.
  { timestamps: true, minimize: false },
);

/**
 * Indexes.
 *
 * The compound `inspector + createdAt` index serves the History screen's
 * default query (an inspector's own records, newest first) from the index
 * alone. The text index backs search across reference, business and product.
 */
inspectionSchema.index({ inspector: 1, createdAt: -1 });
inspectionSchema.index({ status: 1, createdAt: -1 });
inspectionSchema.index({ productCategory: 1 });
inspectionSchema.index({ createdAt: -1 });
inspectionSchema.index({ 'business.name': 1 });
inspectionSchema.index({ 'complianceResult.status': 1 });
// The dashboard filters scanned inspections by the engine's own verdict, which
// has five states where `complianceResult.status` has three.
inspectionSchema.index({ 'scan.legal.status': 1, createdAt: -1 });
inspectionSchema.index({ 'scan.legal.ruleSetVersion': 1 });
inspectionSchema.index(
  { inspectionId: 'text', 'business.name': 'text', productName: 'text', 'location.address': 'text' },
  { name: 'inspection_search', weights: { inspectionId: 10, 'business.name': 5, productName: 3 } },
);

inspectionSchema.methods.toDTO = function toDTO(): InspectionDTO {
  const inspector = this.inspector as unknown as
    | { _id: Types.ObjectId; name?: string; inspectorId?: string; role?: UserRole }
    | Types.ObjectId;

  const populated = typeof inspector === 'object' && 'name' in inspector ? inspector : null;

  const pendingFieldCount = this.extractedFields.filter((field) => !field.reviewAction).length;
  const completedFieldCount = this.extractedFields.length - pendingFieldCount;

  return {
    id: this.id as string,
    inspectionId: this.inspectionId,
    inspector: {
      id: String(populated?._id ?? inspector),
      name: populated?.name ?? 'Unknown inspector',
      inspectorId: populated?.inspectorId ?? '—',
      role: populated?.role ?? 'INSPECTOR',
    },
    business: {
      name: this.business.name,
      ownerName: this.business.ownerName,
      contact: this.business.contact,
    },
    location: {
      address: this.location.address,
      district: this.location.district,
      state: this.location.state,
      pincode: this.location.pincode,
      latitude: this.location.latitude,
      longitude: this.location.longitude,
      accuracyM: this.location.accuracyM,
    },
    productCategory: this.productCategory,
    productName: this.productName,
    images: this.images.map((image) => ({
      imageId: image.imageId,
      inspectionId: this.inspectionId,
      type: image.type,
      url: image.url,
      mimeType: image.mimeType,
      sizeBytes: image.sizeBytes,
      width: image.width,
      height: image.height,
      createdAt: image.createdAt.toISOString(),
    })),
    extractedFields: this.extractedFields.map((field) => ({
      name: field.name,
      label: field.label,
      aiValue: field.aiValue,
      confidence: field.confidence,
      bbox: toBBox(field.bbox),
      sourceImageId: field.sourceImageId,
      required: field.required,
      humanVerifiedValue: field.humanVerifiedValue,
      humanVerifiedBy: field.humanVerifiedBy ? String(field.humanVerifiedBy) : undefined,
      humanVerifiedAt: field.humanVerifiedAt?.toISOString(),
      reviewAction: field.reviewAction,
      reviewComment: field.reviewComment,
    })),
    aiAnalysis: this.aiAnalysis
      ? {
          engine: this.aiAnalysis.engine,
          engineVersion: this.aiAnalysis.engineVersion,
          category: {
            value: this.aiAnalysis.categoryValue,
            confidence: this.aiAnalysis.categoryConfidence,
          },
          origin: this.aiAnalysis.origin,
          meanConfidence: this.aiAnalysis.meanConfidence,
          processingMs: this.aiAnalysis.processingMs,
          imageIds: this.aiAnalysis.imageIds,
          analysedAt: this.aiAnalysis.analysedAt.toISOString(),
          warnings: this.aiAnalysis.warnings,
          bboxSpace: {
            width: this.aiAnalysis.bboxSpaceWidth,
            height: this.aiAnalysis.bboxSpaceHeight,
          },
        }
      : undefined,
    complianceResult: this.complianceResult
      ? {
          status: this.complianceResult.status,
          score: this.complianceResult.score,
          // Fields are copied explicitly rather than spread: these are Mongoose
          // subdocuments, and `{ ...subdoc }` yields internal state instead of
          // the schema paths.
          checks: this.complianceResult.checks.map((check) => ({
            code: check.code,
            title: check.title,
            ruleReference: check.ruleReference,
            result: check.result,
            severity: check.severity,
            category: check.category,
            expected: check.expected,
            observed: check.observed,
            message: check.message,
            relatedFieldNames: [...check.relatedFieldNames],
          })),
          violations: this.complianceResult.violations.map((violation) => ({
            code: violation.code,
            title: violation.title,
            ruleReference: violation.ruleReference,
            category: violation.category,
            severity: violation.severity,
            description: violation.description,
            expected: violation.expected,
            observed: violation.observed,
            recommendation: violation.recommendation,
            sourceImageId: violation.sourceImageId,
            bbox: toBBox(violation.bbox),
          })),
          warnings: this.complianceResult.warnings,
          ruleSetId: this.complianceResult.ruleSetId,
          ruleSetLabel: this.complianceResult.ruleSetLabel,
          evaluatedAt: this.complianceResult.evaluatedAt.toISOString(),
        }
      : undefined,
    // Passed through as stored. The scan record is written once by the scan
    // pipeline and read whole; reshaping it here would be a second place where
    // its structure is defined.
    scan: this.scan
      ? ({
          ...(this.scan as unknown as Record<string, unknown>),
          legal: {
            ...(this.scan.legal as unknown as Record<string, unknown>),
            evaluatedAt: new Date(this.scan.legal.evaluatedAt).toISOString(),
          },
          report: {
            ...(this.scan.report as unknown as Record<string, unknown>),
            generatedAt: new Date(this.scan.report.generatedAt).toISOString(),
          },
          scannedAt: new Date(this.scan.scannedAt).toISOString(),
        } as unknown as ScanRecordDTO)
      : undefined,
    review: {
      completedFieldCount,
      pendingFieldCount,
      lastReviewedAt: this.lastReviewedAt?.toISOString(),
    },
    notes: this.notes,
    finalNotes: this.finalNotes,
    status: this.status,
    createdAt: (this.get('createdAt') as Date).toISOString(),
    updatedAt: (this.get('updatedAt') as Date).toISOString(),
    finalizedAt: this.finalizedAt?.toISOString(),
  };
};

export const Inspection = model<InspectionAttrs, InspectionModel>('Inspection', inspectionSchema);
