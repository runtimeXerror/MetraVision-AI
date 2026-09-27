/**
 * Domain enumerations.
 *
 * These string unions are the contract between the mobile app and the Phase 2
 * backend / web dashboard. They are intentionally plain `as const` arrays rather
 * than TypeScript `enum`s so the same file can be copied into `shared/` later and
 * consumed by Node, Next.js and React Native without a build step.
 */

/** RBAC roles, ordered least → most privileged. */
export const USER_ROLES = ['inspector', 'senior_inspector', 'supervisor', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * Product category drives *which* declarations are required. Phase 2's rule
 * engine resolves the applicable rule set from this value — the UI must never
 * assume a fixed checklist.
 */
export const PRODUCT_CATEGORIES = [
  'food',
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

/** Where the package was manufactured — imports carry extra obligations. */
export const PACKAGE_ORIGINS = ['domestic', 'imported'] as const;
export type PackageOrigin = (typeof PACKAGE_ORIGINS)[number];

/**
 * Overall verdict.
 *
 * Two-valued, as on the server. There used to be a third, `review_required`,
 * for the cases the engine would not decide — and it leaked into every count
 * and every badge as an amber non-answer. A scan is either compliant or it is
 * not; the inspector who confirms the declarations and files the record is
 * the review.
 */
export const COMPLIANCE_STATUSES = ['compliant', 'violation'] as const;
export type ComplianceStatus = (typeof COMPLIANCE_STATUSES)[number];

/** Result of one deterministic rule check. */
export const CHECK_RESULTS = ['pass', 'fail', 'not_applicable'] as const;
export type CheckResult = (typeof CHECK_RESULTS)[number];

export const SEVERITIES = ['critical', 'major', 'minor'] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Lifecycle of the inspection record itself (distinct from its verdict). */
export const INSPECTION_STATUSES = ['draft', 'analysing', 'analysed', 'finalized'] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** Which face of the package an image shows. */
export const IMAGE_SIDES = ['front', 'back', 'side', 'additional'] as const;
export type ImageSide = (typeof IMAGE_SIDES)[number];

/** How an image entered the inspection. */
export const IMAGE_SOURCES = ['camera', 'gallery'] as const;
export type ImageSource = (typeof IMAGE_SOURCES)[number];

/** Per-image quality metric outcome. */
export const QUALITY_RATINGS = ['good', 'warning', 'poor'] as const;
export type QualityRating = (typeof QUALITY_RATINGS)[number];

/** What the inspector decided about a single extracted field. */
export const REVIEW_ACTIONS = ['accepted', 'edited', 'marked_unavailable'] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** Broad grouping used by violation analytics. */
export const VIOLATION_CATEGORIES = [
  'missing_declaration',
  'incorrect_declaration',
  'readability',
  'placement',
  'quantity',
  'pricing',
  'traceability',
] as const;
export type ViolationCategory = (typeof VIOLATION_CATEGORIES)[number];

/**
 * Which engine produced a set of fields.
 *
 * Persisted on every record, so an inspection read by the scripted analyser
 * stays distinguishable from one read by a real OCR engine long after the
 * cut-over. `ocr_api` covers whichever provider sits behind the backend's
 * `OCRProvider` — the app is deliberately not told which, and does not need to
 * be, since the version string beside it carries the specifics.
 */
export const ANALYSIS_ENGINES = [
  'mock',
  'ocr_api',
  'paddle_ocr',
  'tesseract',
  'vlm',
  'manual',
] as const;
export type AnalysisEngine = (typeof ANALYSIS_ENGINES)[number];

/** Visual tone shared by badges, chips and field values. */
export type Tone = 'success' | 'danger' | 'warning' | 'info' | 'neutral';
