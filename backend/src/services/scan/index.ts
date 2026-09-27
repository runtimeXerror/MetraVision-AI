export { runScan, OCR_BUDGET_MS } from './scanService';
export type { RunScanInput, ScanImageInput, ScanOutcome } from './scanService';

export { captureCompletenessFor, toComplianceRequest } from './ComplianceInputAdapter';
export type { AdapterInput, AdapterOutput, ScanProductContext } from './ComplianceInputAdapter';

export { generateIssues, ISSUE_CLASSIFICATIONS } from './issueGenerator';
export type { ComplianceIssue, IssueClassification, IssueSummary } from './issueGenerator';

export { buildReport, renderReportHtml, REPORT_DISCLAIMER, REPORT_VERSION } from './reportGenerator';
export type { ComplianceReport, ReportInput } from './reportGenerator';

export {
  toLegacyChecks,
  toLegacyFields,
  toLegacyStatus,
  toLapsedDateFinding,
  toLegacyViolations,
} from './legacyProjection';

export {
  reevaluateWithVerifiedFields,
  applyVerifications,
  type FieldVerification,
  type ReevaluationInput,
  type ReevaluationOutcome,
  type VerificationAction,
} from './verifiedReevaluation';
