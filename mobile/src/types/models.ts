import type {
  AnalysisEngine,
  CheckResult,
  ComplianceStatus,
  ImageSide,
  ImageSource,
  InspectionStatus,
  PackageOrigin,
  ProductCategory,
  QualityRating,
  ReviewAction,
  Severity,
  UserRole,
  ViolationCategory,
} from './enums';

/* ── People ───────────────────────────────────────────────────────────────── */

export interface Inspector {
  id: string;
  /** Human-facing badge number, e.g. `LM-INS-4471`. */
  employeeId: string;
  name: string;
  email: string;
  phone?: string;
  role: UserRole;
  department: string;
  zone?: string;
  district?: string;
  state?: string;
  /** Seed colour for the avatar monogram. */
  avatarColor?: string;
  lastLoginAt?: string;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  refreshToken?: string;
  /** ISO timestamp. The auth store treats a past value as signed-out. */
  expiresAt: string;
  inspector: Inspector;
}

/* ── Images ───────────────────────────────────────────────────────────────── */

export interface ImageQuality {
  sharpness: QualityRating;
  lighting: QualityRating;
  textVisibility: QualityRating;
  glare: QualityRating;
  /** 0–1. A single roll-up used to sort and to gate the Continue button. */
  overallScore: number;
  /** Human-readable notes shown under the metric list. */
  notes: string[];
}

export interface ProductImage {
  id: string;
  /** Local `file://` URI in Phase 1; a remote URL once uploads exist. */
  uri: string;
  side: ImageSide;
  source: ImageSource;
  width?: number;
  height?: number;
  fileSize?: number;
  capturedAt: string;
  /** Populated by the quality check step; undefined until then. */
  quality?: ImageQuality;
}

/* ── Analysis ─────────────────────────────────────────────────────────────── */

/**
 * Normalised box (0–1 relative to image dimensions) so it survives resizing and
 * can be drawn over any rendition of the source image.
 */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * One declaration read off the label.
 *
 * `aiValue` and `humanValue` are kept as separate fields for the whole lifetime
 * of the record. Overwriting the model's output with the inspector's correction
 * would destroy the evidence trail and the training signal Phase 3 needs.
 */
export interface ExtractedField {
  /** Stable machine key, e.g. `net_quantity`. */
  key: string;
  /** Display name, e.g. `Net Quantity`. */
  label: string;
  /** What the model read. `null` means the model found nothing. */
  aiValue: string | null;
  /** 0–1. Drives the confidence pill and the review-required threshold. */
  confidence: number;
  /** Where on the label it was read from. */
  boundingBox?: BoundingBox;
  /** Which image the value came from. */
  sourceImageId?: string;
  /** Whether this declaration is mandatory for the resolved category. */
  required: boolean;
  /** Set once an inspector reviews the field; null until then. */
  humanValue?: string | null;
  reviewAction?: ReviewAction;
  reviewComment?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface ComplianceCheck {
  /** Rule code, e.g. `LMPCR-6-1-e`. */
  code: string;
  title: string;
  /** Citation shown to the inspector, e.g. `Rule 6(1)(e)`. */
  ruleReference: string;
  result: CheckResult;
  severity: Severity;
  category: ViolationCategory;
  /** What the rule demands. */
  expected: string;
  /** What was actually found — `null` when the declaration is absent. */
  observed: string | null;
  /** Plain-language explanation for the report. */
  message: string;
  /** Field keys this check drew on. */
  relatedFieldKeys: string[];
}

export interface Violation {
  id: string;
  code: string;
  title: string;
  ruleReference: string;
  category: ViolationCategory;
  severity: Severity;
  description: string;
  expected: string;
  observed: string | null;
  recommendation: string;
  evidenceBox?: BoundingBox;
  sourceImageId?: string;
}

export interface ComplianceResult {
  status: ComplianceStatus;
  /** 0–100. A weighted roll-up of the checks. */
  score: number;
  checks: ComplianceCheck[];
  violations: Violation[];
  /** Non-blocking advisories, e.g. "MRP font may be below 3 mm". */
  warnings: string[];
  /** Which rule set the engine resolved for this category. */
  ruleSetId: string;
  ruleSetLabel: string;
}

/**
 * The complete output of one analysis run.
 *
 * Phase 1 fills this from `src/services/mock/mockAnalysis.ts`; Phase 2 fills the
 * exact same shape from the backend. Nothing in the UI knows the difference.
 */
export interface AIAnalysis {
  id: string;
  engine: AnalysisEngine;
  engineVersion: string;
  /** Category the model inferred — the inspector can override it. */
  category: ProductCategory;
  categoryConfidence: number;
  origin: PackageOrigin;
  fields: ExtractedField[];
  compliance: ComplianceResult;
  /** Mean field confidence, 0–1. */
  meanConfidence: number;
  processingMs: number;
  imageIds: string[];
  analysedAt: string;
  /** Populated instead of the rest when a run fails. */
  error?: string;
}

/* ── The legal layer ──────────────────────────────────────────────────────── */

/**
 * How firmly the system is prepared to speak about one finding.
 *
 * Deliberately not the same vocabulary as `Severity`. Severity is the rule
 * set's grading of the *requirement* — how serious it is to sell goods with no
 * declared price. Classification is how good this scan's evidence is about
 * *this* package. A CRITICAL rule read from a blurred photograph is a `review`,
 * not a violation, and collapsing the two is how a compliance app starts
 * accusing traders of things the camera could not see.
 */
export type IssueClassification = 'potential_violation' | 'review' | 'info';

/** Where a declaration was read, so an inspector can check it on the photograph. */
export interface IssueEvidence {
  imageId: string;
  /** Verbatim text the OCR stage read at this location. */
  text?: string;
  /** `[x1, y1, x2, y2]` in the pixel space of the source image. */
  bbox?: [number, number, number, number];
  confidence?: number;
}

/**
 * One finding from the rule engine, with the provision it came from.
 *
 * Every legal field here — the requirement, the clause, the notification, the
 * legal text — is copied verbatim from the backend's rule corpus. The app never
 * composes a legal explanation of its own, because one composed here would sit
 * next to a real citation with nothing to tell them apart.
 */
export interface ComplianceIssue {
  issueId: string;
  ruleId: string;
  ruleVersion: string;
  field?: string;
  fieldLabel?: string;
  classification: IssueClassification;
  /** The rule set's grading of the requirement, carried through untouched. */
  severity: Severity;
  title: string;
  description: string;
  expectedRequirement: string;
  observedValue: string | null;
  reasonCode: string;
  /** `null` when the OCR provider reported none — never a substituted number. */
  confidence: number | null;
  evidence: IssueEvidence[];
  source: {
    rule: string;
    clause?: string;
    notification: string;
    notificationDate: string;
    officialUrl?: string;
    effectiveFrom: string;
  };
  legalText: string;
  machineInterpretation: string;
}

/** The rule engine's five states, as the app spells them. */
export type LegalStatus =
  | 'compliant'
  | 'violation_detected'
  | 'review_required'
  | 'not_applicable'
  | 'insufficient_evidence';

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

/**
 * The OCR → extraction → rule-engine record for one scan.
 *
 * Held beside `AIAnalysis` rather than folded into it: `AIAnalysis` is the
 * three-state summary every existing screen was built against, and this is the
 * engine's own account, in its own vocabulary, with its citations intact.
 */
export interface ScanRecord {
  ocr: {
    provider: string;
    providerVersion?: string;
    /**
     * Every line the recogniser read, newline-separated, in reading order.
     *
     * Kept so an officer can answer the question the declaration list cannot:
     * when a mandatory declaration is missing, was it not printed on the
     * package, or was it printed and not read? Those are a finding and a defect
     * respectively, and nothing else on the record tells them apart.
     */
    rawText?: string;
    lineCount: number;
    confidenceAvailable: boolean;
    processingMs: number;
  };
  extraction: {
    engine: string;
    engineVersion: string;
    /** Lines no declaration claimed. Absent on records written before it was kept. */
    unclaimedLines?: string[];
    warnings: string[];
  };
  status: LegalStatus;
  summary: LegalSummary;
  issues: ComplianceIssue[];
  warnings: string[];
  /** The exact corpus the verdict rests on, so it can be reproduced. */
  ruleSetVersion: string;
  ruleSetChecksum: string;
  engineVersion: string;
  /** 0–1. How much of the package the photographs are taken to have covered. */
  captureCompleteness: number;
  reportId: string;
  scannedAt: string;
}

/* ── Inspection ───────────────────────────────────────────────────────────── */

export interface InspectionDetails {
  businessName: string;
  /** Street address — typed, or filled from a reverse-geocoded GPS fix. */
  location: string;
  /** Resolved from the fix, and editable: a reverse-geocode is a guess. */
  district?: string;
  state?: string;
  /** Six-digit PIN, resolved from the fix and editable for the same reason. */
  pincode?: string;
  /** The fix itself, kept even when the address above is corrected by hand. */
  latitude?: number;
  longitude?: number;
  accuracyM?: number;
  productCategory?: ProductCategory;
  productName?: string;
  inspectorNotes?: string;
}

export interface Inspection {
  id: string;
  /** Human-facing reference, e.g. `INS-2026-001`. */
  referenceId: string;
  inspectorId: string;
  inspectorName: string;
  details: InspectionDetails;
  images: ProductImage[];
  analysis?: AIAnalysis;
  /** Present on inspections that went through the OCR + rule-engine pipeline. */
  scan?: ScanRecord;
  status: InspectionStatus;
  /** Mirrors `analysis.compliance.status` once analysis has run. */
  complianceStatus?: ComplianceStatus;
  /** Notes added at the finalize step, distinct from the notes at intake. */
  finalNotes?: string;
  createdAt: string;
  updatedAt: string;
  finalizedAt?: string;
}

/** Compact shape used by list screens. */
export interface InspectionSummary {
  id: string;
  referenceId: string;
  businessName: string;
  productLabel: string;
  complianceStatus: ComplianceStatus;
  status: InspectionStatus;
  imageCount: number;
  violationCount: number;
  /**
   * Declarations nobody has ruled on yet.
   *
   * What the review queue is actually filtered by, here and on the server. A
   * record leaves the queue when this reaches zero — not when it is filed,
   * because an inspection can be filed with declarations still unanswered and
   * those answers are still owed.
   */
  pendingDeclarations: number;
  createdAt: string;
}

/* ── Reporting ────────────────────────────────────────────────────────────── */

export interface ReportStats {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  /** 0–100, mean compliance score across finalized inspections. */
  averageScore: number;
}

export interface Report {
  id: string;
  referenceId: string;
  title: string;
  inspectionId: string;
  generatedBy: string;
  generatedAt: string;
  /**
   * Denormalised copy of the inspection at issue time, so a report stays
   * accurate even if the underlying record is later amended.
   */
  snapshot: Inspection;
}

/* ── Dashboard analytics ──────────────────────────────────────────────────── */

/**
 * The KPI row behind the dashboard.
 *
 * `complianceRate` is computed over *assessed* records only. Counting drafts as
 * non-compliant would make the rate fall every time an inspector opens a form,
 * which is activity, not a compliance signal.
 */
export interface DashboardSummary {
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  finalized: number;
  drafts: number;
  /** 0–100, over assessed records. */
  complianceRate: number;
  /** 0–100, mean compliance score. */
  averageScore: number;
  activeInspectors: number;
  /** Total findings raised, which exceeds `violations` — one record can carry many. */
  totalViolationFindings: number;
}

/** One day of the enforcement trend. */
export interface TrendPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  total: number;
  compliant: number;
  violations: number;
  reviewRequired: number;
}

/**
 * A slice of the compliance split.
 *
 * `not_assessed` is carried explicitly rather than dropped: a dashboard that
 * silently omits unassessed records reports a split over a denominator the
 * reader cannot see.
 */
export interface ComplianceSlice {
  status: ComplianceStatus | 'not_assessed';
  count: number;
}

/** Violations against the volume inspected in one product category. */
export interface CategoryBreakdown {
  category: ProductCategory;
  inspections: number;
  violations: number;
}

/** How often one finding is raised — "what is actually going wrong out there". */
export interface ViolationTypeCount {
  code: string;
  title: string;
  category: ViolationCategory;
  severity: Severity;
  count: number;
}

/** Per-officer enforcement activity. */
export interface InspectorActivity {
  id: string;
  /** Badge number, e.g. `LM-INS-4471`. */
  employeeId: string;
  name: string;
  district?: string;
  totalInspections: number;
  compliant: number;
  violations: number;
  pendingReviews: number;
  /** 0–100. */
  complianceRate: number;
  lastActivityAt?: string;
}

/** Geographic rollup. Rows rather than anything map-shaped — see the backend note. */
export interface DistrictActivity {
  district: string;
  state?: string;
  inspections: number;
  violations: number;
  /** 0–100. */
  complianceRate: number;
  assessed: number;
  compliant: number;
}

/** Everything the dashboard renders, fetched in one round trip. */
export interface DashboardOverview {
  summary: DashboardSummary;
  trend: TrendPoint[];
  distribution: ComplianceSlice[];
  violationsByCategory: CategoryBreakdown[];
  violationTypes: ViolationTypeCount[];
  inspectorActivity: InspectorActivity[];
  districts: DistrictActivity[];
  /** The window these figures cover, so an export can state its own scope. */
  period: { days: number; from: string; to: string };
  generatedAt: string;
}
