/**
 * The API contract, as the dashboard consumes it.
 *
 * These mirror `backend/src/types/domain.ts` deliberately rather than importing
 * it: the two projects build independently, and a shared package is the right
 * answer only once there is a third consumer. Where a shape here diverges from
 * the wire, the difference is absorbed in `services/`, never in a component.
 */

/* ── Enumerations ─────────────────────────────────────────────────────────── */

export const USER_ROLES = ['INSPECTOR', 'SUPERVISOR', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'INVITED'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const INSPECTION_STATUSES = [
  'DRAFT',
  'PROCESSING',
  'REVIEW_REQUIRED',
  'COMPLIANT',
  'VIOLATION_DETECTED',
  'FINALIZED',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

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
 * Which engine produced a set of fields.
 *
 * `OCR_API` covers whichever provider sits behind the backend's `OCRProvider`.
 * The console is deliberately not told which — the version string beside it
 * carries the specifics, and a dashboard that branched on the provider would
 * have to be edited every time one was swapped.
 */
export const ANALYSIS_ENGINES = [
  'MOCK',
  'OCR_API',
  'PADDLE_OCR',
  'TESSERACT',
  'VLM',
  'MANUAL',
] as const;
export type AnalysisEngine = (typeof ANALYSIS_ENGINES)[number];

export const VALIDATION_TYPES = [
  'PRESENCE',
  'FORMAT',
  'NUMERIC_RANGE',
  'ENUM',
  'MIN_FONT_SIZE',
  'CROSS_FIELD',
] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];

export const RULE_STATUSES = ['ACTIVE', 'DRAFT', 'RETIRED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/* ── Envelopes ────────────────────────────────────────────────────────────── */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** What `paginated()` returns on the wire: the window flattened beside items. */
export interface Paged<T> extends PaginationMeta {
  items: T[];
}

/* ── Users ────────────────────────────────────────────────────────────────── */

export interface User {
  id: string;
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

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  user: User;
}

/* ── Inspections ──────────────────────────────────────────────────────────── */

export type BBox = [number, number, number, number];

/** The frame `bbox` coordinates are drawn in, so a box can be scaled to any
 *  rendition of the image without guessing the analysed dimensions. */
export interface BBoxSpace {
  width: number;
  height: number;
}

export interface ExtractedField {
  name: string;
  label: string;
  /** What the analyser read. `null` means nothing was found. */
  aiValue: string | null;
  confidence: number;
  bbox?: BBox;
  sourceImageId?: string;
  required: boolean;
  /** Human review, kept strictly separate — `aiValue` is never overwritten. */
  humanVerifiedValue?: string | null;
  humanVerifiedBy?: string;
  humanVerifiedAt?: string;
  reviewAction?: ReviewAction;
  reviewComment?: string;
}

export interface ComplianceCheck {
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

export interface Violation {
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

export interface ComplianceResult {
  status: ComplianceStatus;
  score: number;
  checks: ComplianceCheck[];
  violations: Violation[];
  warnings: string[];
  ruleSetId: string;
  ruleSetLabel: string;
  evaluatedAt: string;
}

export interface AiAnalysis {
  engine: AnalysisEngine;
  engineVersion: string;
  category: { value: ProductCategory; confidence: number };
  origin: 'DOMESTIC' | 'IMPORTED';
  meanConfidence: number;
  processingMs: number;
  imageIds: string[];
  analysedAt: string;
  warnings: string[];
  bboxSpace: BBoxSpace;
}

/* ── The scan record ──────────────────────────────────────────────────────── */

/**
 * How firmly the system will speak about one finding.
 *
 * Not the same axis as `Severity`. Severity is the rule set's grading of the
 * requirement; classification is how good this scan's evidence is about this
 * package. A CRITICAL rule read off a blurred photograph is a REVIEW.
 */
export type IssueClassification = 'POTENTIAL_VIOLATION' | 'REVIEW' | 'INFO';

/** The rule engine's five states, as against the three the older screens use. */
export type LegalStatus =
  | 'COMPLIANT'
  | 'VIOLATION_DETECTED'
  | 'REVIEW_REQUIRED'
  | 'NOT_APPLICABLE'
  | 'INSUFFICIENT_EVIDENCE';

export interface IssueEvidence {
  imageId: string;
  text?: string;
  bbox?: BBox;
  confidence?: number;
}

/**
 * One finding, with the provision it came from.
 *
 * Every legal string is copied from the backend's rule corpus. The dashboard
 * never composes an explanation of the law — one written here would sit beside
 * a real citation with nothing to distinguish it.
 */
export interface ComplianceIssue {
  issueId: string;
  ruleId: string;
  ruleVersion: string;
  field?: string;
  fieldLabel?: string;
  classification: IssueClassification;
  severity: Severity;
  title: string;
  description: string;
  expectedRequirement: string;
  observedValue: string | null;
  reasonCode: string;
  /** `null` where the OCR provider reported none. Never a substituted number. */
  confidence: number | null;
  evidence: IssueEvidence[];
  source: {
    rule: string;
    clause?: string;
    notification: string;
    notificationDate: string;
    officialUrl?: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    verificationStatus: string;
  };
  legalText: string;
  machineInterpretation: string;
}

export interface LegalSummary {
  totalChecks: number;
  compliant: number;
  violations: number;
  reviewRequired: number;
  notApplicable: number;
  insufficientEvidence: number;
  /** Checks needing a physical measurement this version cannot take. */
  pendingCapability: number;
}

export interface LegalCheck {
  ruleId: string;
  ruleVersion: string;
  status: LegalStatus;
  reasonCode: string;
  reason: string;
  field?: string;
  fieldLabel?: string;
  observedValue: string | null;
  expectedRequirement: string;
  legalText: string;
  machineInterpretation: string;
  confidence: number | null;
  evidence: IssueEvidence[];
  severity: Severity;
  provenance: {
    ruleId: string;
    ruleVersion: string;
    sourceRule: string;
    sourceClause?: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    source: { notification: string; notificationDate: string; officialUrl?: string };
  };
}

export interface ScanExtractedField {
  field: string;
  label: string;
  value: string | null;
  confidence?: number;
  status: 'FOUND' | 'NOT_FOUND';
  unit?: string;
  evidence: IssueEvidence[];
  method: string;
  matchedText?: string;
  repaired?: boolean;
}

/**
 * The OCR → extraction → rule-engine record for one inspection.
 *
 * Held alongside `complianceResult` rather than replacing it: that field is the
 * three-state summary the dashboard's older tables and charts read, and this is
 * the engine's own account with its citations and evidence intact. Where the
 * two disagree, this one is right.
 */
export interface ScanRecord {
  ocr: {
    provider: string;
    providerVersion?: string;
    rawText: string;
    lineCount: number;
    characterCount: number;
    confidenceAvailable: boolean;
    regions: Array<{ text: string; confidence?: number; boundingBox?: BBox; imageId: string }>;
    processingMs: number;
    imageIds: string[];
  };
  extraction: {
    engine: string;
    engineVersion: string;
    processingMs: number;
    fields: Record<string, ScanExtractedField>;
    informational: Record<string, ScanExtractedField>;
    contextSignals: Array<{ key: string; value: string | number | boolean; basis: string }>;
    unclaimedLines: string[];
    warnings: string[];
  };
  legal: {
    status: LegalStatus;
    /** The date the rules were resolved against, not the date the scan ran. */
    inspectionDate: string;
    summary: LegalSummary;
    checks: LegalCheck[];
    applicableRules: Array<{
      ruleId: string;
      ruleVersion: string;
      sourceRule: string;
      sourceClause?: string;
      title: string;
      applied: boolean;
      skippedBecause?: string;
    }>;
    warnings: Array<{ code: string; message: string }>;
    issues: ComplianceIssue[];
    issueSummary: {
      total: number;
      potentialViolations: number;
      review: number;
      info: number;
      bySeverity: Record<Severity, number>;
    };
    ruleSetVersion: string;
    ruleSetChecksum: string;
    engineVersion: string;
    evaluatedAt: string;
    durationMs: number;
  };
  report: { reportId: string; generatedAt: string; reportVersion: string };
  /** 0–1. How much of the package the photographs are taken to have covered. */
  captureCompleteness: number;
  contextApplied: Array<{ key: string; value: string | number | boolean; basis: string }>;
  contextOverridden: Array<{ key: string; value: string | number | boolean; basis: string }>;
  timings: Record<string, number>;
  scannedAt: string;
}

export interface ProductImage {
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

export interface Inspection {
  id: string;
  inspectionId: string;
  inspector: { id: string; name: string; inspectorId: string; role: UserRole };
  business: { name: string; ownerName?: string; contact?: string };
  location: { address: string; district?: string; state?: string };
  productCategory?: ProductCategory;
  productName?: string;
  images: ProductImage[];
  extractedFields: ExtractedField[];
  aiAnalysis?: AiAnalysis;
  complianceResult?: ComplianceResult;
  /** Present on inspections that went through the OCR + rule-engine pipeline. */
  scan?: ScanRecord;
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

/* ── Violations (flattened for the violations pages) ──────────────────────── */

export interface ViolationRow {
  /** `<inspection reference>:<finding code>` — stable and URL-addressable. */
  violationId: string;
  inspectionId: string;
  inspectionRef: string;
  code: string;
  title: string;
  description: string;
  ruleReference: string;
  category: ViolationCategory;
  severity: Severity;
  expected: string;
  observed: string | null;
  recommendation: string;
  business: string;
  productName?: string;
  productCategory?: ProductCategory;
  district?: string;
  state?: string;
  address?: string;
  inspector: { id: string; name: string; inspectorId: string };
  status: 'OPEN' | 'RESOLVED';
  inspectionStatus: InspectionStatus;
  detectedAt: string;
  finalizedAt?: string;
}

export interface ViolationDetail {
  violationId: string;
  violation: Violation;
  status: 'OPEN' | 'RESOLVED';
  inspection: Inspection;
}

export interface ViolationStats {
  total: number;
  open: number;
  resolved: number;
  critical: number;
  major: number;
  minor: number;
}

/* ── Products ─────────────────────────────────────────────────────────────── */

export interface ProductRow {
  productKey: string;
  productName: string;
  productCategory?: ProductCategory;
  inspections: number;
  violations: number;
  compliant: number;
  complianceRate: number;
  lastInspectedAt: string;
  businesses: string[];
}

/* ── Rules ────────────────────────────────────────────────────────────────── */

export interface RuleVersion {
  version: number;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo?: string;
  changeNote?: string;
  recordedAt: string;
}

export interface Rule {
  id: string;
  ruleId: string;
  category: string;
  field: string;
  fieldLabel: string;
  title: string;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  ruleReference: string;
  source: string;
  severity: Severity;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string;
  status: RuleStatus;
  appliesToCategories: ProductCategory[];
  history: RuleVersion[];
  createdAt: string;
  updatedAt: string;
}

/* ── Analytics ────────────────────────────────────────────────────────────── */

export interface DashboardSummary {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  finalized: number;
  drafts: number;
  complianceRate: number;
  averageScore: number;
  activeInspectors: number;
  totalViolationFindings: number;
}

export interface TrendPoint {
  date: string;
  total: number;
  compliant: number;
  violations: number;
  reviewRequired: number;
}

export interface DistributionSlice {
  status: string;
  count: number;
}

export interface CategoryBar {
  category: ProductCategory;
  inspections: number;
  violations: number;
}

export interface ViolationTypeBar {
  code: string;
  title: string;
  category: ViolationCategory;
  severity: Severity;
  count: number;
}

export interface InspectorActivity {
  id: string;
  inspectorId: string;
  name: string;
  status: UserStatus;
  district?: string;
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  complianceRate: number;
  lastActivityAt?: string;
}

export interface DistrictRow {
  district: string;
  state?: string;
  inspections: number;
  violations: number;
  complianceRate: number;
  /** Exact counts, so a state total is a sum rather than a mean of rates. */
  assessed: number;
  compliant: number;
}

/** The overview page's single payload — see `analytics.controller.getOverview`. */
export interface DashboardOverview {
  summary: DashboardSummary;
  trend: TrendPoint[];
  distribution: DistributionSlice[];
  violationsByCategory: CategoryBar[];
  violationTypes: ViolationTypeBar[];
  inspectorActivity: InspectorActivity[];
  districts: DistrictRow[];
}

/* ── Reports ──────────────────────────────────────────────────────────────── */

export interface InspectionReport {
  inspectionId: string;
  generatedAt: string;
  inspector: Record<string, unknown>;
  business: Record<string, unknown>;
  product: Record<string, unknown>;
  images: ProductImage[];
  extractedFields: ExtractedField[];
  complianceResult?: ComplianceResult;
  aiAnalysis?: AiAnalysis;
  review?: Record<string, unknown>;
  notes?: string;
  [key: string]: unknown;
}

/* ── Health ───────────────────────────────────────────────────────────────── */

export interface HealthInfo {
  status: string;
  uptimeSeconds: number;
  environment: string;
  database: string;
  analysisProvider: string;
  storageProvider: string;
  /** Which OCR provider is behind the scan pipeline, and whether it is set up. */
  ocr?: { provider: string; version: string; configured: boolean };
  extraction?: { engine: string; version: string };
  usesLlmForDecisions?: boolean;
  phase: string;
}
