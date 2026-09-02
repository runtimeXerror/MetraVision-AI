import type {
  CheckResult,
  ComplianceStatus,
  ImageSide,
  InspectionStatus,
  ProductCategory,
  QualityRating,
  Severity,
  Tone,
  UserRole,
  ViolationCategory,
} from '../types';

/**
 * Display strings and tones for every domain enum.
 *
 * Keeping these in one place means a status can never render as `review_required`
 * in one screen and "Needs review" in another, and a new enum member causes a
 * TypeScript error here rather than a blank label at runtime.
 */

export const complianceStatusLabels: Record<ComplianceStatus, string> = {
  compliant: 'Compliant',
  violation: 'Violation Detected',
  review_required: 'Review Required',
};

export const complianceStatusTones: Record<ComplianceStatus, Tone> = {
  compliant: 'success',
  violation: 'danger',
  review_required: 'warning',
};

export const complianceStatusIcons: Record<
  ComplianceStatus,
  'shield-checkmark' | 'alert-circle' | 'help-circle'
> = {
  compliant: 'shield-checkmark',
  violation: 'alert-circle',
  review_required: 'help-circle',
};

export const inspectionStatusLabels: Record<InspectionStatus, string> = {
  draft: 'Draft',
  analysing: 'Analysing',
  pending_review: 'Pending Review',
  finalized: 'Finalized',
};

export const inspectionStatusTones: Record<InspectionStatus, Tone> = {
  draft: 'neutral',
  analysing: 'info',
  pending_review: 'warning',
  finalized: 'success',
};

export const productCategoryLabels: Record<ProductCategory, string> = {
  food: 'Food',
  beverage: 'Beverage',
  cosmetic: 'Cosmetic',
  household: 'Household',
  apparel: 'Apparel',
  electronics: 'Electronics',
  medical_device: 'Medical Device',
  other: 'Other',
};

export const imageSideLabels: Record<ImageSide, string> = {
  front: 'Front',
  back: 'Back',
  side: 'Side',
  additional: 'Additional Label',
};

export const qualityRatingLabels: Record<QualityRating, string> = {
  good: 'Good',
  warning: 'Warning',
  poor: 'Poor',
};

export const qualityRatingTones: Record<QualityRating, Tone> = {
  good: 'success',
  warning: 'warning',
  poor: 'danger',
};

export const checkResultLabels: Record<CheckResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  warning: 'Warning',
  not_applicable: 'N/A',
};

export const checkResultTones: Record<CheckResult, Tone> = {
  pass: 'success',
  fail: 'danger',
  warning: 'warning',
  not_applicable: 'neutral',
};

export const severityLabels: Record<Severity, string> = {
  critical: 'Critical',
  major: 'Major',
  minor: 'Minor',
};

export const severityTones: Record<Severity, Tone> = {
  critical: 'danger',
  major: 'warning',
  minor: 'neutral',
};

export const violationCategoryLabels: Record<ViolationCategory, string> = {
  missing_declaration: 'Missing Declaration',
  incorrect_declaration: 'Incorrect Declaration',
  readability: 'Readability',
  placement: 'Placement',
  quantity: 'Net Quantity',
  pricing: 'Pricing',
  traceability: 'Traceability',
};

export const userRoleLabels: Record<UserRole, string> = {
  inspector: 'Field Inspector',
  senior_inspector: 'Senior Inspector',
  supervisor: 'Supervisor',
  admin: 'Administrator',
};

/**
 * Demo login, shown on the sign-in screen so a judge can get in without being
 * told the password. Mirrors `backend/src/seed/seed.ts` — change both together.
 */
export const DEMO_CREDENTIALS = {
  identifier: 'LM-INS-4471',
  email: 'ravi.sharma@legalmetrology.gov.in',
  password: 'Inspector@123',
} as const;

export const APP_META = {
  name: 'LM Compliance Scanner',
  shortName: 'LM Scanner',
  department: 'Department of Legal Metrology',
  /** Shown in the profile screen and in the analysis disclosure. */
  phase: 'Phase 2 - Backend connected, simulated analysis',
  version: '1.0.0',
} as const;
