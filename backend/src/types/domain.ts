/**
 * Domain enumerations and wire shapes.
 *
 * These are the API contract. The mobile app maps them onto its own display
 * types in `mobile/src/services/mappers.ts`; the Phase 3 web dashboard will
 * consume them directly. Uppercase snake case is used on the wire so a value
 * read from a log or a Mongo shell is unambiguous.
 */

/* ── Users ────────────────────────────────────────────────────────────────── */

export const USER_ROLES = ['INSPECTOR', 'SUPERVISOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'INVITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

/** Ordered least → most privileged, for `atLeast` comparisons. */
export const ROLE_RANK: Record<UserRole, number> = {
  INSPECTOR: 0,
  SUPERVISOR: 1,
  ADMIN: 2,
};

/* ── Inspections ──────────────────────────────────────────────────────────── */

/**
 * Inspection lifecycle.
 *
 * Note this single enum carries both workflow position (DRAFT, PROCESSING,
 * FINALIZED) and verdict (COMPLIANT, VIOLATION_DETECTED, REVIEW_REQUIRED),
 * as specified. `complianceResult.status` holds the verdict independently, so
 * a FINALIZED record has not lost what it was finalized as.
 */
export const INSPECTION_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'REVIEW_REQUIRED',
  'COMPLIANT',
  'VIOLATION_DETECTED',
  'FINALIZED',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** The verdict alone, independent of workflow position. */
export const COMPLIANCE_STATUSES = ['COMPLIANT', 'VIOLATION_DETECTED', 'REVIEW_REQUIRED'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/**
 * ── WHICH FIELD A `?status=` FILTER MEANS ───────────────────────────────────
 *
 * `INSPECTION_STATUSES` overlaps `COMPLIANCE_STATUSES` on three values, and
 * `inspection.status` is overwritten with `FINALIZED` when a record is filed.
 * So a filter written as `{ status: 'VIOLATION_DETECTED' }` matched only the
 * inspections that had *not* been finalized yet — every filed violation
 * disappeared from it, permanently, which is the opposite of what a register is
 * for. The verdict was never lost; it lives on in `complianceResult.status`.
 * The filter was simply reading the wrong field.
 *
 * The bug had teeth because it was silent and it grew. Home shows a
 * "Violations" tile counted from `complianceResult.status`, and tapping it
 * opens the list filtered by this parameter — so an officer tapping "12" was
 * shown however many of those twelve happened to be unfiled, with nothing to
 * say where the rest had gone. Since filing is the normal end of an inspection,
 * the gap widened with every record closed.
 *
 * This resolves each of the three shared values to the field its label
 * actually means:
 *
 *   COMPLIANT, VIOLATION_DETECTED → the verdict.
 *       "Show me the violations" means all of them. Whether the paperwork is
 *       closed does not change what was found.
 *
 *   REVIEW_REQUIRED → the work that is actually left.
 *       "Review required" is a queue, not a finding: it is what still sits on
 *       the officer's desk.
 *
 *       This read the workflow column, on the assumption that filing a record
 *       means having reviewed it. That assumption is false, and the app is what
 *       makes it false: an inspector can finalize an inspection with
 *       declarations still unruled — there are good reasons to, in a market,
 *       with a queue behind you — and the moment they did, the record left the
 *       queue and there was no way back to the declarations it had never
 *       answered. The work was not done; it was only unlisted.
 *
 *       So the queue asks the question it means: does this inspection still
 *       have a declaration nobody has ruled on? `extractedFields.reviewAction`
 *       is set when an inspector accepts, corrects or marks one unavailable, so
 *       its absence is exactly "not yet looked at" — and a record drops out of
 *       the queue when the last declaration is answered, which is the only
 *       thing that should take it out.
 *
 * DRAFT, PROCESSING and FINALIZED are workflow-only and were never ambiguous.
 * ────────────────────────────────────────────────────────────────────────────
 */
const VERDICT_FILTER_FIELDS = {
  COMPLIANT: 'complianceResult.status',
  VIOLATION_DETECTED: 'complianceResult.status',
} as const;

/**
 * The database filter for one status, as a fragment to merge into a query.
 *
 * Returns a fragment rather than a field name because the review queue is not
 * a single-column test any more — it is a verdict and an outstanding
 * declaration together, and a helper that can only name one column cannot say
 * that.
 */
/**
 * The same queue, as an aggregation expression.
 *
 * `statusFilter` answers it for `find`; the dashboard counts it with `$group`,
 * and the two must agree or the tile disagrees with the list it opens. Written
 * once here so they cannot drift apart again — which is the exact failure this
 * module's header records for the verdict filters.
 */
export function isPendingReviewExpr(): Record<string, unknown> {
  return {
    $and: [
      { $eq: ['$complianceResult.status', 'REVIEW_REQUIRED'] },
      {
        $gt: [
          {
            $size: {
              $filter: {
                input: { $ifNull: ['$extractedFields', []] },
                cond: { $not: [{ $ifNull: ['$$this.reviewAction', false] }] },
              },
            },
          },
          0,
        ],
      },
    ],
  };
}

export function statusFilter(status: InspectionStatus): Record<string, unknown> {
  if (status === 'REVIEW_REQUIRED') {
    return {
      'complianceResult.status': 'REVIEW_REQUIRED',
      extractedFields: { $elemMatch: { reviewAction: { $exists: false } } },
    };
  }

  const field = VERDICT_FILTER_FIELDS[status as keyof typeof VERDICT_FILTER_FIELDS] ?? 'status';
  return { [field]: status };
}

/**
 * The commodity classes an inspector picks from.
 *
 * Ordered by how often they are actually inspected under the Packaged
 * Commodities Rules, because this is rendered as a list and the common case
 * should not be a scroll away. `other` stays last, and stays: a category list
 * that forces a wrong choice is worse than one that admits it does not know.
 *
 * Adding a value here is safe — every schema, the Mongoose enum and both
 * clients derive from this array. Renaming or removing one is not: the rule
 * engine matches `productContext.category` by string
 * (`compliance/data/exceptions.ts` keys off `packaged_food` and `cosmetic`),
 * and inspections already in the database carry the old value.
 */
export const PRODUCT_CATEGORIES = [
  'packaged_food',
  'beverage',
  'personal_care',
  'cosmetic',
  'household',
  'pharmaceutical',
  'medical_device',
  'apparel',
  'footwear',
  'electronics',
  'other',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const PACKAGE_ORIGINS = ['DOMESTIC', 'IMPORTED'] as const;
export type PackageOrigin = (typeof PACKAGE_ORIGINS)[number];

export const IMAGE_TYPES = ['FRONT', 'BACK', 'SIDE', 'ADDITIONAL'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

export const REVIEW_ACTIONS = ['ACCEPTED', 'EDITED', 'MARKED_UNAVAILABLE'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export const CHECK_RESULTS = ['PASS', 'FAIL', 'WARNING', 'NOT_APPLICABLE'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VIOLATION_CATEGORIES = [
  'MISSING_DECLARATION',
  'INCORRECT_DECLARATION',
  'READABILITY',
  'PLACEMENT',
  'QUANTITY',
  'PRICING',
  'TRACEABILITY',
] as const;
export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number];

/**
 * Which engine produced a set of fields. `MOCK` is the only Phase 2 value;
 * persisting it means historical inspections stay auditable once the real OCR
 * service goes live and starts writing `PADDLE_OCR` or `VLM`.
 */
export const ANALYSIS_ENGINES = [
  'MOCK',
  /** A cloud OCR API behind `OCRProvider`, e.g. Google Cloud Vision. */
  'OCR_API',
  'PADDLE_OCR',
  'TESSERACT',
  'VLM',
  'MANUAL',
] as const;
export type AnalysisEngine = (typeof ANALYSIS_ENGINES)[number];

/* ── Value shapes ─────────────────────────────────────────────────────────── */

/** `[x1, y1, x2, y2]` in pixels, relative to the analysis coordinate space. */
export type BBox = [number, number, number, number];

/**
 * The frame `BBox` coordinates are expressed in.
 *
 * Sent explicitly so a client can normalise a box against the rendition of the
 * image it happens to be displaying, at whatever size. Phase 3 sets this to the
 * real dimensions the OCR engine analysed.
 */
export interface BBoxSpace {
  width: number;
  height: number;
}

export interface ExtractedFieldDTO {
  /** Machine key, e.g. `net_quantity`. */
  name: string;
  label: string;
  /** What the analyser read. `null` means nothing was found. */
  aiValue: string | null;
  confidence: number;
  bbox?: BBox;
  sourceImageId?: string;
  required: boolean;

  /**
   * Human review. Kept strictly separate from `aiValue`, which is never
   * overwritten — the evidence trail and the Phase 3 training signal both
   * depend on being able to see what the model read *and* what the inspector
   * determined.
   */
  humanVerifiedValue?: string | null;
  humanVerifiedBy?: string;
  humanVerifiedAt?: string;
  reviewAction?: ReviewAction;
  reviewComment?: string;
}

export interface ComplianceCheckDTO {
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

export interface ViolationDTO {
  code: string;
  title: string;
  ruleReference: string;
  category: ViolationCategory;
  severity: Severity;
  description: string;
  expected: string;
  observed: string | null;
  recommendation: string;
  bbox?: BBox;
  sourceImageId?: string;
}

export interface ComplianceResultDTO {
  status: ComplianceStatus;
  /** 0–100. */
  score: number;
  checks: ComplianceCheckDTO[];
  violations: ViolationDTO[];
  warnings: string[];
  ruleSetId: string;
  ruleSetLabel: string;
  evaluatedAt: string;
}

export interface AiAnalysisDTO {
  engine: AnalysisEngine;
  engineVersion: string;
  category: { value: ProductCategory; confidence: number };
  origin: PackageOrigin;
  meanConfidence: number;
  processingMs: number;
  imageIds: string[];
  analysedAt: string;
  warnings: string[];
  /** Coordinate space every `bbox` on this analysis is relative to. */
  bboxSpace: BBoxSpace;
}

export interface InspectionImageDTO {
  imageId: string;
  inspectionId: string;
  type: ImageType;
  url: string;
  mimeType: string;
  sizeBytes: number;
  width?: number;
  height?: number;
  createdAt: string;
}

/**
 * The scan record, as it crosses the wire.
 *
 * `legal` is the rule engine's own `ComplianceResult` plus the issues derived
 * from it; `extraction` and `ocr` are what produced its input. The clients read
 * this for the result screen, the evidence panel and the inspection detail
 * page. `complianceResult` remains the summary the older screens consume.
 */
export interface ScanRecordDTO {
  ocr: {
    provider: string;
    providerVersion?: string;
    rawText: string;
    lineCount: number;
    characterCount: number;
    confidenceAvailable: boolean;
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
    evaluatedAt: string;
    durationMs: number;
  };
  report: { reportId: string; generatedAt: string; reportVersion: string };
  captureCompleteness: number;
  contextApplied: unknown[];
  contextOverridden: unknown[];
  timings: Record<string, number>;
  scannedAt: string;
}

export interface InspectionDTO {
  id: string;
  /** Human-facing reference, e.g. `INS-2026-00001`. */
  inspectionId: string;
  inspector: { id: string; name: string; inspectorId: string; role: UserRole };
  business: { name: string; ownerName?: string; contact?: string };
  location: {
    address: string;
    district?: string;
    state?: string;
    /** Six-digit Indian PIN, reverse-geocoded or typed. */
    pincode?: string;
    /** GPS fix taken when the inspection was opened, if the device gave one. */
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
  };
  productCategory?: ProductCategory;
  productName?: string;
  images: InspectionImageDTO[];
  extractedFields: ExtractedFieldDTO[];
  aiAnalysis?: AiAnalysisDTO;
  complianceResult?: ComplianceResultDTO;
  /**
   * The full OCR -> extraction -> rule-engine record, present on inspections
   * created through `POST /api/inspections/scan`.
   *
   * Deliberately typed loosely at this boundary: its parts are owned by the
   * compliance module and the scan services, and re-declaring their shapes
   * here would give the project two definitions that can drift.
   */
  scan?: ScanRecordDTO;
  review?: {
    completedFieldCount: number;
    pendingFieldCount: number;
    lastReviewedAt?: string;
  };
  /**
   * Determinations recorded after the inspection was filed.
   *
   * Absent where there are none. See `AmendmentAttrs` on the model for why
   * these sit beside the filed record rather than inside it.
   */
  amendments?: Array<{
    fieldName: string;
    recordedValue: string | null;
    action: ReviewAction;
    value: string | null;
    comment?: string;
    amendedAt: string;
  }>;
  lastAmendedAt?: string;
  notes?: string;
  finalNotes?: string;
  status: InspectionStatus;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

export interface UserDTO {
  id: string;
  /** Departmental badge number, e.g. `LM-INS-4471`. */
  inspectorId: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  status: UserStatus;
  department: string;
  zone?: string;
  district?: string;
  state?: string;
  avatarColor?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokensDTO {
  accessToken: string;
  refreshToken: string;
  /** ISO timestamp at which `accessToken` stops being accepted. */
  expiresAt: string;
}

export interface AuthSessionDTO extends AuthTokensDTO {
  user: UserDTO;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface StatsDTO {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  finalized: number;
  averageScore: number;
}
