import { assetUrl } from '../constants/config';
import type {
  AIAnalysis,
  AuthSession,
  BoundingBox,
  ComplianceCheck,
  ComplianceResult,
  ComplianceStatus,
  ExtractedField,
  ImageSide,
  Inspection,
  InspectionStatus,
  InspectionSummary,
  Inspector,
  ProductCategory,
  ProductImage,
  ReviewAction,
  Severity,
  UserRole,
  Violation,
  ViolationCategory,
  CheckResult,
  ComplianceIssue,
  IssueClassification,
  LegalStatus,
  ScanRecord,
} from '../types';

/**
 * ── THE WIRE ↔ DOMAIN BOUNDARY ──────────────────────────────────────────────
 *
 * The backend speaks UPPER_SNAKE on the wire; the mobile app's screens and
 * components were built in Phase 1 against lowercase domain unions. Translating
 * here, in one file, is what let Phase 2 connect a real API without editing a
 * single screen, badge, label map or style.
 *
 * The alternative — renaming the mobile enums to match the wire — would have
 * touched every screen and every constant in `constants/labels.ts` for no
 * behavioural gain, and would couple the UI's vocabulary to the transport's.
 * ────────────────────────────────────────────────────────────────────────────
 */

/* ── Wire shapes ──────────────────────────────────────────────────────────── */

export interface UserDTO {
  id: string;
  inspectorId: string;
  name: string;
  email: string;
  phone?: string;
  role: 'INSPECTOR' | 'SUPERVISOR' | 'ADMIN';
  status: 'ACTIVE' | 'SUSPENDED' | 'INVITED';
  department: string;
  zone?: string;
  district?: string;
  state?: string;
  avatarColor?: string;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionDTO {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: UserDTO;
}

export interface InspectionDTO {
  id: string;
  inspectionId: string;
  inspector: { id: string; name: string; inspectorId: string; role: string };
  business: { name: string; ownerName?: string; contact?: string };
  location: { address: string; district?: string; state?: string; pincode?: string };
  productCategory?: string;
  productName?: string;
  images: Array<{
    imageId: string;
    type: string;
    url: string;
    mimeType: string;
    sizeBytes: number;
    width?: number;
    height?: number;
    createdAt: string;
  }>;
  extractedFields: Array<{
    name: string;
    label: string;
    aiValue: string | null;
    confidence: number;
    bbox?: [number, number, number, number];
    sourceImageId?: string;
    required: boolean;
    humanVerifiedValue?: string | null;
    humanVerifiedBy?: string;
    humanVerifiedAt?: string;
    reviewAction?: string;
    reviewComment?: string;
  }>;
  aiAnalysis?: {
    engine: string;
    engineVersion: string;
    category: { value: string; confidence: number };
    origin: string;
    meanConfidence: number;
    processingMs: number;
    imageIds: string[];
    analysedAt: string;
    warnings: string[];
    bboxSpace: { width: number; height: number };
  };
  /**
   * The scan record.
   *
   * Typed loosely against the wire — the backend owns these shapes and they
   * carry legal text verbatim, so re-declaring every field here would create a
   * second definition that silently drops whatever the first one added.
   */
  scan?: {
    ocr: {
      provider: string;
      providerVersion?: string;
      lineCount: number;
      confidenceAvailable: boolean;
      processingMs: number;
    };
    extraction: { engine: string; engineVersion: string; warnings: string[] };
    legal: {
      status: string;
      summary: Record<string, number>;
      issues: unknown[];
      warnings: Array<{ code: string; message: string }>;
      ruleSetVersion: string;
      ruleSetChecksum: string;
      engineVersion: string;
    };
    report: { reportId: string };
    captureCompleteness: number;
    scannedAt: string;
  };
  complianceResult?: {
    status: string;
    score: number;
    checks: Array<{
      code: string;
      title: string;
      ruleReference: string;
      result: string;
      severity: string;
      category: string;
      expected: string;
      observed: string | null;
      message: string;
      relatedFieldNames: string[];
    }>;
    violations: Array<{
      code: string;
      title: string;
      ruleReference: string;
      category: string;
      severity: string;
      description: string;
      expected: string;
      observed: string | null;
      recommendation: string;
      bbox?: [number, number, number, number];
      sourceImageId?: string;
    }>;
    warnings: string[];
    ruleSetId: string;
    ruleSetLabel: string;
    evaluatedAt: string;
  };
  review?: { completedFieldCount: number; pendingFieldCount: number; lastReviewedAt?: string };
  notes?: string;
  finalNotes?: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

/* ── Enum translation ─────────────────────────────────────────────────────── */

const ROLE_IN: Record<string, UserRole> = {
  INSPECTOR: 'inspector',
  SUPERVISOR: 'supervisor',
  ADMIN: 'admin',
};

const CATEGORY_IN: Record<string, ProductCategory> = {
  packaged_food: 'food',
  beverage: 'beverage',
  personal_care: 'personal_care',
  cosmetic: 'cosmetic',
  household: 'household',
  pharmaceutical: 'pharmaceutical',
  medical_device: 'medical_device',
  apparel: 'apparel',
  footwear: 'footwear',
  electronics: 'electronics',
  other: 'other',
};

const CATEGORY_OUT: Record<ProductCategory, string> = {
  food: 'packaged_food',
  beverage: 'beverage',
  personal_care: 'personal_care',
  cosmetic: 'cosmetic',
  household: 'household',
  pharmaceutical: 'pharmaceutical',
  medical_device: 'medical_device',
  apparel: 'apparel',
  footwear: 'footwear',
  electronics: 'electronics',
  other: 'other',
};

const COMPLIANCE_IN: Record<string, ComplianceStatus> = {
  COMPLIANT: 'compliant',
  VIOLATION_DETECTED: 'violation',
  REVIEW_REQUIRED: 'review_required',
};

const COMPLIANCE_OUT: Record<ComplianceStatus, string> = {
  compliant: 'COMPLIANT',
  violation: 'VIOLATION_DETECTED',
  review_required: 'REVIEW_REQUIRED',
};

/**
 * The backend's status enum folds workflow position and verdict together.
 * The mobile app keeps them apart, so a verdict-bearing status collapses to
 * `pending_review` here and the verdict is read off `complianceResult`.
 */
const STATUS_IN: Record<string, InspectionStatus> = {
  DRAFT: 'draft',
  PROCESSING: 'analysing',
  REVIEW_REQUIRED: 'pending_review',
  COMPLIANT: 'pending_review',
  VIOLATION_DETECTED: 'pending_review',
  FINALIZED: 'finalized',
};

const SIDE_IN: Record<string, ImageSide> = {
  FRONT: 'front',
  BACK: 'back',
  SIDE: 'side',
  ADDITIONAL: 'additional',
};

const SIDE_OUT: Record<ImageSide, string> = {
  front: 'FRONT',
  back: 'BACK',
  side: 'SIDE',
  additional: 'ADDITIONAL',
};

const REVIEW_IN: Record<string, ReviewAction> = {
  ACCEPTED: 'accepted',
  EDITED: 'edited',
  MARKED_UNAVAILABLE: 'marked_unavailable',
};

const REVIEW_OUT: Record<ReviewAction, string> = {
  accepted: 'ACCEPTED',
  edited: 'EDITED',
  marked_unavailable: 'MARKED_UNAVAILABLE',
};

const CHECK_IN: Record<string, CheckResult> = {
  PASS: 'pass',
  FAIL: 'fail',
  WARNING: 'warning',
  NOT_APPLICABLE: 'not_applicable',
};

const SEVERITY_IN: Record<string, Severity> = {
  CRITICAL: 'critical',
  MAJOR: 'major',
  MINOR: 'minor',
};

const VIOLATION_CATEGORY_IN: Record<string, ViolationCategory> = {
  MISSING_DECLARATION: 'missing_declaration',
  INCORRECT_DECLARATION: 'incorrect_declaration',
  READABILITY: 'readability',
  PLACEMENT: 'placement',
  QUANTITY: 'quantity',
  PRICING: 'pricing',
  TRACEABILITY: 'traceability',
};

/* ── Public conversions ───────────────────────────────────────────────────── */

export const toWireCategory = (category?: ProductCategory): string | undefined =>
  category ? CATEGORY_OUT[category] : undefined;

export const toWireSide = (side: ImageSide): string => SIDE_OUT[side];

export const toWireReviewAction = (action: ReviewAction): string => REVIEW_OUT[action];

export const toWireComplianceStatus = (status: ComplianceStatus): string =>
  COMPLIANCE_OUT[status];

/* The inbound direction of the same tables, for payloads that carry a bare enum
   rather than a whole record — the analytics aggregates are all of that shape. */

export const toCategory = (value?: string | null): ProductCategory =>
  (value ? CATEGORY_IN[value] : undefined) ?? 'other';

export const toComplianceStatus = (value?: string | null): ComplianceStatus =>
  (value ? COMPLIANCE_IN[value] : undefined) ?? 'review_required';

export const toSeverity = (value?: string | null): Severity =>
  (value ? SEVERITY_IN[value] : undefined) ?? 'minor';

export const toViolationCategory = (value?: string | null): ViolationCategory =>
  (value ? VIOLATION_CATEGORY_IN[value] : undefined) ?? 'missing_declaration';

export function toInspector(dto: UserDTO): Inspector {
  return {
    id: dto.id,
    employeeId: dto.inspectorId,
    name: dto.name,
    email: dto.email,
    phone: dto.phone,
    role: ROLE_IN[dto.role] ?? 'inspector',
    department: dto.department,
    zone: dto.zone,
    district: dto.district,
    state: dto.state,
    avatarColor: dto.avatarColor,
    lastLoginAt: dto.lastLoginAt,
    createdAt: dto.createdAt,
  };
}

export function toAuthSession(dto: AuthSessionDTO): AuthSession {
  return {
    token: dto.accessToken,
    refreshToken: dto.refreshToken,
    expiresAt: dto.expiresAt,
    inspector: toInspector(dto.user),
  };
}

/**
 * Converts a pixel bbox into the normalised 0–1 box the evidence overlay draws
 * with, using the coordinate space the analysis reported. Without that space a
 * box would be meaningless at any other rendering size.
 */
function toBoundingBox(
  bbox: [number, number, number, number] | undefined,
  space: { width: number; height: number } | undefined,
): BoundingBox | undefined {
  if (!bbox || !space || space.width <= 0 || space.height <= 0) return undefined;

  const [x1, y1, x2, y2] = bbox;
  if (x2 <= x1 || y2 <= y1) return undefined;

  return {
    x: x1 / space.width,
    y: y1 / space.height,
    width: (x2 - x1) / space.width,
    height: (y2 - y1) / space.height,
  };
}

function toProductImage(dto: InspectionDTO['images'][number]): ProductImage {
  return {
    id: dto.imageId,
    // Stored URLs are relative to the API origin; seeded records carry none.
    uri: dto.url ? (assetUrl(dto.url) ?? '') : '',
    side: SIDE_IN[dto.type] ?? 'front',
    source: 'camera',
    width: dto.width,
    height: dto.height,
    fileSize: dto.sizeBytes,
    capturedAt: dto.createdAt,
  };
}

function toExtractedField(
  dto: InspectionDTO['extractedFields'][number],
  space: { width: number; height: number } | undefined,
): ExtractedField {
  return {
    key: dto.name,
    label: dto.label,
    aiValue: dto.aiValue,
    confidence: dto.confidence,
    boundingBox: toBoundingBox(dto.bbox, space),
    sourceImageId: dto.sourceImageId,
    required: dto.required,
    // `humanValue` mirrors the backend's `humanVerifiedValue`; both live beside
    // `aiValue` rather than replacing it.
    humanValue: dto.humanVerifiedValue ?? null,
    reviewAction: dto.reviewAction ? REVIEW_IN[dto.reviewAction] : undefined,
    reviewComment: dto.reviewComment,
    reviewedAt: dto.humanVerifiedAt,
    reviewedBy: dto.humanVerifiedBy,
  };
}

function toComplianceResult(
  dto: NonNullable<InspectionDTO['complianceResult']>,
  space: { width: number; height: number } | undefined,
): ComplianceResult {
  const checks: ComplianceCheck[] = dto.checks.map((check) => ({
    code: check.code,
    title: check.title,
    ruleReference: check.ruleReference,
    result: CHECK_IN[check.result] ?? 'not_applicable',
    severity: SEVERITY_IN[check.severity] ?? 'minor',
    category: VIOLATION_CATEGORY_IN[check.category] ?? 'missing_declaration',
    expected: check.expected,
    observed: check.observed,
    message: check.message,
    relatedFieldKeys: check.relatedFieldNames,
  }));

  const violations: Violation[] = dto.violations.map((violation) => ({
    id: violation.code,
    code: violation.code,
    title: violation.title,
    ruleReference: violation.ruleReference,
    category: VIOLATION_CATEGORY_IN[violation.category] ?? 'missing_declaration',
    severity: SEVERITY_IN[violation.severity] ?? 'major',
    description: violation.description,
    expected: violation.expected,
    observed: violation.observed,
    recommendation: violation.recommendation,
    evidenceBox: toBoundingBox(violation.bbox, space),
    sourceImageId: violation.sourceImageId,
  }));

  return {
    status: COMPLIANCE_IN[dto.status] ?? 'review_required',
    score: dto.score,
    checks,
    violations,
    warnings: dto.warnings,
    ruleSetId: dto.ruleSetId,
    ruleSetLabel: dto.ruleSetLabel,
  };
}

export function toAnalysis(dto: InspectionDTO): AIAnalysis | undefined {
  if (!dto.aiAnalysis || !dto.complianceResult) return undefined;

  const space = dto.aiAnalysis.bboxSpace;

  return {
    id: `${dto.id}:analysis`,
    engine: (dto.aiAnalysis.engine.toLowerCase() as AIAnalysis['engine']) ?? 'mock',
    engineVersion: dto.aiAnalysis.engineVersion,
    category: CATEGORY_IN[dto.aiAnalysis.category.value] ?? 'other',
    categoryConfidence: dto.aiAnalysis.category.confidence,
    origin: dto.aiAnalysis.origin === 'IMPORTED' ? 'imported' : 'domestic',
    fields: dto.extractedFields.map((field) => toExtractedField(field, space)),
    compliance: toComplianceResult(dto.complianceResult, space),
    meanConfidence: dto.aiAnalysis.meanConfidence,
    processingMs: dto.aiAnalysis.processingMs,
    imageIds: dto.aiAnalysis.imageIds,
    analysedAt: dto.aiAnalysis.analysedAt,
  };
}

const LEGAL_STATUS_IN: Record<string, LegalStatus> = {
  COMPLIANT: 'compliant',
  VIOLATION_DETECTED: 'violation_detected',
  REVIEW_REQUIRED: 'review_required',
  NOT_APPLICABLE: 'not_applicable',
  INSUFFICIENT_EVIDENCE: 'insufficient_evidence',
};

const CLASSIFICATION_IN: Record<string, IssueClassification> = {
  POTENTIAL_VIOLATION: 'potential_violation',
  REVIEW: 'review',
  INFO: 'info',
};

/**
 * The scan record.
 *
 * Note what is *not* translated: the legal text, the requirement, the
 * notification number and the clause pass through byte for byte. Rewriting a
 * citation on the way to a screen is how a report ends up quoting a provision
 * that does not say what the app claims it says.
 */
export function toScanRecord(dto: InspectionDTO): ScanRecord | undefined {
  if (!dto.scan) return undefined;

  const { legal } = dto.scan;

  const issues: ComplianceIssue[] = (legal.issues as ComplianceIssue[]).map((issue) => ({
    ...issue,
    classification:
      CLASSIFICATION_IN[issue.classification as unknown as string] ?? 'review',
  }));

  return {
    ocr: dto.scan.ocr,
    extraction: dto.scan.extraction,
    status: LEGAL_STATUS_IN[legal.status] ?? 'review_required',
    summary: {
      totalChecks: legal.summary.totalChecks ?? 0,
      compliant: legal.summary.compliant ?? 0,
      violations: legal.summary.violations ?? 0,
      reviewRequired: legal.summary.reviewRequired ?? 0,
      notApplicable: legal.summary.notApplicable ?? 0,
      insufficientEvidence: legal.summary.insufficientEvidence ?? 0,
      pendingCapability: legal.summary.pendingCapability ?? 0,
    },
    issues,
    warnings: legal.warnings.map((warning) => warning.message),
    ruleSetVersion: legal.ruleSetVersion,
    ruleSetChecksum: legal.ruleSetChecksum,
    engineVersion: legal.engineVersion,
    captureCompleteness: dto.scan.captureCompleteness,
    reportId: dto.scan.report.reportId,
    scannedAt: dto.scan.scannedAt,
  };
}

export function toInspection(dto: InspectionDTO): Inspection {
  return {
    id: dto.id,
    referenceId: dto.inspectionId,
    inspectorId: dto.inspector.id,
    inspectorName: dto.inspector.name,
    details: {
      businessName: dto.business.name,
      location: dto.location.address,
      productCategory: dto.productCategory ? CATEGORY_IN[dto.productCategory] : undefined,
      productName: dto.productName,
      inspectorNotes: dto.notes,
    },
    images: dto.images.map(toProductImage),
    analysis: toAnalysis(dto),
    scan: toScanRecord(dto),
    status: STATUS_IN[dto.status] ?? 'draft',
    complianceStatus: dto.complianceResult
      ? (COMPLIANCE_IN[dto.complianceResult.status] ?? 'review_required')
      : undefined,
    finalNotes: dto.finalNotes,
    createdAt: dto.createdAt,
    updatedAt: dto.updatedAt,
    finalizedAt: dto.finalizedAt,
  };
}

export function toInspectionSummary(dto: InspectionDTO): InspectionSummary {
  return {
    id: dto.id,
    referenceId: dto.inspectionId,
    businessName: dto.business.name,
    productLabel: dto.productName ?? 'Packaged Product',
    complianceStatus: dto.complianceResult
      ? (COMPLIANCE_IN[dto.complianceResult.status] ?? 'review_required')
      : 'review_required',
    status: STATUS_IN[dto.status] ?? 'draft',
    imageCount: dto.images.length,
    violationCount: dto.complianceResult?.violations.length ?? 0,
    createdAt: dto.createdAt,
  };
}
