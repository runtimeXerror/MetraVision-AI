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
 * Keeping these in one place means a status can never render as `violation`
 * in one screen and "Violation Detected" in another, and a new enum member
 * causes a TypeScript error here rather than a blank label at runtime.
 */

export const complianceStatusLabels: Record<ComplianceStatus, string> = {
  compliant: 'Compliant',
  violation: 'Violation Detected',
};

export const complianceStatusTones: Record<ComplianceStatus, Tone> = {
  compliant: 'success',
  violation: 'danger',
};

export const complianceStatusIcons: Record<ComplianceStatus, 'shield-checkmark' | 'alert-circle'> =
  {
    compliant: 'shield-checkmark',
    violation: 'alert-circle',
  };

export const inspectionStatusLabels: Record<InspectionStatus, string> = {
  draft: 'Draft',
  analysing: 'Analysing',
  analysed: 'Analysed',
  finalized: 'Finalized',
};

export const inspectionStatusTones: Record<InspectionStatus, Tone> = {
  draft: 'neutral',
  analysing: 'info',
  analysed: 'info',
  finalized: 'success',
};

/**
 * Ordered as the picker renders them: the categories inspected most often
 * under the Packaged Commodities Rules come first, and `other` stays last.
 */
export const productCategoryLabels: Record<ProductCategory, string> = {
  food: 'Packaged Food',
  beverage: 'Beverage',
  personal_care: 'Personal Care & Toiletries',
  cosmetic: 'Cosmetic',
  household: 'Household & Cleaning',
  pharmaceutical: 'Pharmaceutical',
  medical_device: 'Medical Device',
  apparel: 'Apparel & Textiles',
  footwear: 'Footwear',
  electronics: 'Electronics',
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
  not_applicable: 'N/A',
};

export const checkResultTones: Record<CheckResult, Tone> = {
  pass: 'success',
  fail: 'danger',
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
  name: 'MetraVision AI',
  shortName: 'MetraVision',
  department: 'Department of Legal Metrology',
  /** Shown in the profile screen and in the analysis disclosure. */
  phase: 'Phase 4 - OCR, extraction and the rule engine connected end to end',
  version: '1.0.0',
} as const;
