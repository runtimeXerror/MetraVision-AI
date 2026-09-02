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

export const PRODUCT_CATEGORIES = [
  'packaged_food',
  'beverage',
  'cosmetic',
  'household',
  'apparel',
  'electronics',
  'medical_device',
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
