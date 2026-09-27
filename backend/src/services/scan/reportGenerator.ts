import type { ComplianceCheck, ComplianceResult } from '../../compliance/types/ComplianceResult';
import type { ExtractedFieldRecord, ExtractionResult } from '../extraction';
import type { AggregateOCRResult } from '../ocr';

import type { ComplianceIssue, IssueSummary } from './issueGenerator';

/**
 * ── THE REPORT ──────────────────────────────────────────────────────────────
 *
 * The document an inspector reads and, eventually, defends.
 *
 * Its central obligation is stated in §21 and §42 of the brief and enforced
 * here: a clean scan produces "no compliance issues detected in the checks
 * performed", never "compliant". The distinction is not pedantry. This system
 * checks a photograph against the subset of the Packaged Commodities Rules it
 * has implemented; it cannot weigh the package, cannot measure letter heights,
 * cannot see faces nobody photographed, and cannot read a rule that is not in
 * its corpus. A report that says "100% compliant" claims all of that, and the
 * first time one is produced for a package that is in fact unlawful, every
 * report this system has ever issued becomes worthless.
 *
 * So the headline is a statement about the checks, the counts say exactly which
 * checks were performed and which were not, and the limitations are part of the
 * report rather than a footnote under it.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const REPORT_DISCLAIMER =
  'The system provides automated compliance screening based on the information detected from the submitted package image and the rules implemented in the system. Results should be reviewed by an authorized inspector where evidence is incomplete or uncertain.';

export const REPORT_VERSION = 'lm-scan-report/1.0.0';

export interface ReportInput {
  inspectionId: string;
  reportId: string;
  generatedAt: string;
  inspectionDate: string;
  inspector?: { id: string; name: string; inspectorId: string };
  business?: { name: string; ownerName?: string; contact?: string };
  /**
   * The whole recorded location, not a summary of it.
   *
   * This carried only address, district and state, and the caller narrowed the
   * inspection's location to those three fields to match. The PIN and the GPS
   * fix were dropped on the way into the report — so a record whose pincode
   * and coordinates were sitting in the database printed "PIN code —" and a
   * blank fix, and the document said the department knew less about where the
   * inspection happened than it actually did.
   *
   * A report is evidence of which premises were inspected. Everything the
   * record holds about that travels with it.
   */
  location?: {
    address: string;
    district?: string;
    state?: string;
    pincode?: string;
    latitude?: number;
    longitude?: number;
    accuracyM?: number;
  };
  images: Array<{ imageId: string; url: string; type: string; mimeType: string; sizeBytes: number }>;
  ocr: AggregateOCRResult;
  extraction: ExtractionResult;
  compliance: ComplianceResult;
  issues: ComplianceIssue[];
  issueSummary: IssueSummary;
  captureCompleteness: number;
  contextApplied: Array<{ key: string; value: string | number | boolean; basis: string }>;
  timings: {
    ocrMs: number;
    extractionMs: number;
    /** Absent when no model was asked — which is not the same as one taking 0 ms. */
    llmMs?: number;
    ruleEngineMs: number;
    totalMs: number;
  };
}

export interface ComplianceReport {
  reportVersion: string;
  reportId: string;
  inspectionId: string;
  generatedAt: string;
  inspectionDate: string;

  inspector?: ReportInput['inspector'];
  business?: ReportInput['business'];
  location?: ReportInput['location'];

  product: {
    name: string | null;
    brand: string | null;
    commodityName: string | null;
    netQuantity: string | null;
    mrp: string | null;
    countryOfOrigin: string | null;
  };

  images: ReportInput['images'];

  ocrSummary: {
    provider: string;
    providerVersion?: string;
    lineCount: number;
    characterCount: number;
    confidenceAvailable: boolean;
    meanRegionConfidence: number | null;
    processingTimeMs: number;
  };

  extractedFields: Array<{
    field: string;
    label: string;
    value: string | null;
    status: string;
    confidence: number | null;
    method: string;
    unit?: string;
    evidenceCount: number;
    /** Verbatim OCR text behind the value. */
    sourceText?: string;
  }>;

  informationalFields: ComplianceReport['extractedFields'];

  rulesEvaluated: Array<{
    ruleId: string;
    ruleVersion: string;
    sourceRule: string;
    sourceClause?: string;
    title: string;
    applied: boolean;
    skippedBecause?: string;
  }>;

  checks: {
    passed: ComplianceCheck[];
    failed: ComplianceCheck[];
    notApplicable: ComplianceCheck[];
  };

  issues: ComplianceIssue[];
  issueSummary: IssueSummary;

  /** Distinct notifications the applied rules came from, for the citation list. */
  sources: Array<{
    notification: string;
    notificationDate: string;
    officialUrl?: string;
    verificationStatus: string;
    ruleIds: string[];
  }>;

  overall: {
    status: ComplianceResult['status'];
    /** Wording safe to show to a citizen or a trader. Never "compliant". */
    headline: string;
    summary: ComplianceResult['summary'];
  };

  provenance: {
    engineVersion: string;
    ruleSetVersion: string;
    ruleSetChecksum: string;
    ocrProvider: string;
    ocrProviderVersion?: string;
    extractionEngine: string;
    extractionEngineVersion: string;
    captureCompleteness: number;
    contextApplied: ReportInput['contextApplied'];
    timings: ReportInput['timings'];
  };

  limitations: string[];
  disclaimer: string;
  warnings: string[];
}

/**
 * The headline.
 *
 * The clean case is the one that matters. `NO COMPLIANCE ISSUES DETECTED IN THE
 * CHECKS PERFORMED` is longer and less satisfying than "COMPLIANT", and it is
 * the only one of the two this system is entitled to print.
 */
function headlineFor(result: ComplianceResult): string {
  switch (result.status) {
    case 'VIOLATION_DETECTED':
      return 'POTENTIAL NON-COMPLIANCE DETECTED';
    case 'NOT_APPLICABLE':
      return 'NO IMPLEMENTED RULE APPLIED TO THIS PACKAGE';
    case 'COMPLIANT':
    default:
      return 'NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED';
  }
}

/**
 * What this report does not establish.
 *
 * Assembled from what actually happened in this scan rather than boilerplate,
 * so the list narrows as the system gains capabilities and as a scan gets
 * better evidence. A limitation that is always printed is one nobody reads.
 */
function limitationsFor(input: ReportInput): string[] {
  const limitations: string[] = [
    'This screening covers only the requirements implemented in the rule set named above. It is not a complete audit of the Legal Metrology (Packaged Commodities) Rules, 2011 or of any other law.',
    'Findings rest on what was legible in the submitted photographs. A declaration present on the package but not captured or not readable cannot be assessed.',
  ];

  if (input.compliance.summary.pendingCapability > 0) {
    limitations.push(
      `${input.compliance.summary.pendingCapability} check${
        input.compliance.summary.pendingCapability === 1 ? '' : 's'
      } could not be assessed because they need a physical measurement — letter height, panel placement or legibility — that this version does not take from an image.`,
    );
  }

  if (input.ocr.unread.length > 0) {
    limitations.push(
      `${input.ocr.unread.length} of the ${
        input.ocr.unread.length + input.ocr.perImage.length
      } submitted photograph${
        input.ocr.unread.length + input.ocr.perImage.length === 1 ? '' : 's'
      } could not be read (${[...new Set(input.ocr.unread.map((image) => image.reason))].join(
        ' ',
      )}) and contributed no evidence. Anything declared only on those faces is absent from this report.`,
    );
  }

  if (!input.ocr.confidenceAvailable) {
    limitations.push(
      'The OCR provider returned no per-reading confidence. Every value has therefore been treated as of unknown reliability, which routes failed checks to review rather than to a finding.',
    );
  }

  limitations.push(
    'The system cannot weigh or measure the commodity, so it never asserts that a declared quantity is inaccurate — only that a declaration is present, absent, or not in a standard unit.',
  );

  if (input.contextApplied.length > 0) {
    limitations.push(
      'Some facts about the package were inferred from the label rather than supplied by the inspector; they are listed under provenance and change which rules were applied.',
    );
  }

  return limitations;
}

function toReportField(record: ExtractedFieldRecord): ComplianceReport['extractedFields'][number] {
  return {
    field: record.field,
    label: record.label,
    value: record.value,
    status: record.status,
    confidence: record.confidence ?? null,
    method: record.method,
    unit: record.unit,
    evidenceCount: record.evidence.length,
    sourceText: record.matchedText,
  };
}

export function buildReport(input: ReportInput): ComplianceReport {
  const { compliance, extraction, ocr } = input;

  const byStatus = (status: ComplianceCheck['status']): ComplianceCheck[] =>
    compliance.checks.filter((check) => check.status === status);

  const confidences = ocr.regions
    .map((region) => region.confidence)
    .filter((value): value is number => typeof value === 'number');

  const sources = new Map<string, ComplianceReport['sources'][number]>();
  for (const check of compliance.checks) {
    const key = check.provenance.source.notification;
    const existing = sources.get(key);
    if (existing) {
      if (!existing.ruleIds.includes(check.ruleId)) existing.ruleIds.push(check.ruleId);
      continue;
    }
    sources.set(key, {
      notification: key,
      notificationDate: check.provenance.source.notificationDate,
      officialUrl: check.provenance.source.officialUrl,
      verificationStatus: check.provenance.source.verificationStatus,
      ruleIds: [check.ruleId],
    });
  }

  const value = (key: string): string | null => extraction.fields[key]?.value ?? null;
  const informational = (key: string): string | null => extraction.informational[key]?.value ?? null;

  return {
    reportVersion: REPORT_VERSION,
    reportId: input.reportId,
    inspectionId: input.inspectionId,
    generatedAt: input.generatedAt,
    inspectionDate: input.inspectionDate,

    inspector: input.inspector,
    business: input.business,
    location: input.location,

    product: {
      name: informational('product_name'),
      brand: informational('brand'),
      commodityName: value('commodity_name'),
      netQuantity: value('net_quantity'),
      mrp: value('mrp'),
      countryOfOrigin: value('country_of_origin'),
    },

    images: input.images,

    ocrSummary: {
      provider: ocr.provider,
      providerVersion: ocr.providerVersion,
      lineCount: ocr.regions.length,
      characterCount: ocr.rawText.length,
      confidenceAvailable: ocr.confidenceAvailable,
      meanRegionConfidence:
        confidences.length > 0
          ? confidences.reduce((sum, entry) => sum + entry, 0) / confidences.length
          : null,
      processingTimeMs: ocr.processingTimeMs,
    },

    extractedFields: Object.values(extraction.fields).map(toReportField),
    informationalFields: Object.values(extraction.informational).map(toReportField),

    rulesEvaluated: compliance.applicableRules.map((rule) => ({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      sourceRule: rule.sourceRule,
      sourceClause: rule.sourceClause,
      title: rule.title,
      applied: rule.applied,
      skippedBecause: rule.skippedBecause,
    })),

    checks: {
      passed: byStatus('COMPLIANT'),
      failed: byStatus('VIOLATION_DETECTED'),
      notApplicable: byStatus('NOT_APPLICABLE'),
    },

    issues: input.issues,
    issueSummary: input.issueSummary,
    sources: [...sources.values()].sort((a, b) => a.notificationDate.localeCompare(b.notificationDate)),

    overall: {
      status: compliance.status,
      headline: headlineFor(compliance),
      summary: compliance.summary,
    },

    provenance: {
      engineVersion: compliance.engineVersion,
      ruleSetVersion: compliance.ruleSetVersion,
      ruleSetChecksum: compliance.ruleSetChecksum,
      ocrProvider: ocr.provider,
      ocrProviderVersion: ocr.providerVersion,
      extractionEngine: extraction.engine,
      extractionEngineVersion: extraction.engineVersion,
      captureCompleteness: input.captureCompleteness,
      contextApplied: input.contextApplied,
      timings: input.timings,
    },

    limitations: limitationsFor(input),
    disclaimer: REPORT_DISCLAIMER,
    warnings: [...compliance.warnings.map((warning) => warning.message), ...extraction.warnings],
  };
}

/* ── HTML rendering ───────────────────────────────────────────────────────── */

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const STATUS_TONE: Record<string, string> = {
  COMPLIANT: 'ok',
  VIOLATION_DETECTED: 'bad',
  NOT_APPLICABLE: 'muted',
};

function checkRows(checks: ComplianceCheck[]): string {
  if (checks.length === 0) return '<tr><td colspan="4" class="muted">None.</td></tr>';

  return checks
    .map(
      (check) => `<tr>
        <td><strong>${escapeHtml(check.provenance.sourceClause ?? check.provenance.sourceRule)}</strong><br><span class="muted">${escapeHtml(check.ruleId)} @ ${escapeHtml(check.ruleVersion)}</span></td>
        <td>${escapeHtml(check.fieldLabel ?? check.field ?? '—')}</td>
        <td><span class="pill ${STATUS_TONE[check.status] ?? 'muted'}">${escapeHtml(check.status.replace(/_/g, ' '))}</span></td>
        <td>${escapeHtml(check.reason)}${
          check.observedValue ? `<br><span class="muted">Observed: ${escapeHtml(check.observedValue)}</span>` : ''
        }</td>
      </tr>`,
    )
    .join('');
}

/**
 * A self-contained HTML report.
 *
 * No external stylesheet, font or script: the file has to render from a saved
 * copy on a laptop with no network, because that is where a report gets read
 * when it matters. It is also what `expo-print` on the mobile app turns into a
 * PDF, so the two formats cannot drift apart.
 */
export function renderReportHtml(report: ComplianceReport): string {
  const issueBlocks = report.issues
    .map(
      (issue, index) => `<section class="issue ${issue.classification === 'POTENTIAL_VIOLATION' ? 'bad' : 'warn'}">
        <h3>${index + 1}. ${escapeHtml(issue.title)}</h3>
        <p class="tags">
          <span class="pill ${issue.classification === 'POTENTIAL_VIOLATION' ? 'bad' : 'warn'}">${escapeHtml(issue.classification.replace(/_/g, ' '))}</span>
          <span class="pill muted">Rule grading: ${escapeHtml(issue.severity)}</span>
          ${issue.fieldLabel ? `<span class="pill muted">${escapeHtml(issue.fieldLabel)}</span>` : ''}
        </p>
        <p>${escapeHtml(issue.description)}</p>
        <dl>
          <dt>Requirement</dt><dd>${escapeHtml(issue.expectedRequirement)}</dd>
          <dt>Observed</dt><dd>${issue.observedValue ? escapeHtml(issue.observedValue) : '<span class="muted">Nothing detected</span>'}</dd>
          <dt>Rule</dt><dd>${escapeHtml(issue.source.clause ?? issue.source.rule)} — ${escapeHtml(issue.source.notification)} (${escapeHtml(issue.source.notificationDate)}), in force from ${escapeHtml(issue.source.effectiveFrom)}</dd>
          ${issue.source.officialUrl ? `<dt>Official source</dt><dd><a href="${escapeHtml(issue.source.officialUrl)}">${escapeHtml(issue.source.officialUrl)}</a></dd>` : ''}
          <dt>Confidence in the reading</dt><dd>${issue.confidence === null ? 'Not reported by the OCR provider' : `${Math.round(issue.confidence * 100)}%`}</dd>
          <dt>Evidence</dt><dd>${
            issue.evidence.length === 0
              ? '<span class="muted">No located evidence</span>'
              : issue.evidence
                  .map((entry) => `“${escapeHtml(entry.text ?? '')}” <span class="muted">(${escapeHtml(entry.imageId)})</span>`)
                  .join('<br>')
          }</dd>
        </dl>
        <details><summary>Legal text relied on</summary><blockquote>${escapeHtml(issue.legalText)}</blockquote>
        <p class="muted"><strong>How this system read it:</strong> ${escapeHtml(issue.machineInterpretation)}</p></details>
      </section>`,
    )
    .join('');

  const fieldRows = report.extractedFields
    .map(
      (field) => `<tr>
        <td>${escapeHtml(field.label)}</td>
        <td>${field.value ? escapeHtml(field.value) : '<span class="muted">Not detected</span>'}</td>
        <td>${field.confidence === null ? '<span class="muted">n/a</span>' : `${Math.round(field.confidence * 100)}%`}</td>
        <td class="muted">${escapeHtml(field.method.replace(/_/g, ' ').toLowerCase())}</td>
      </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Compliance screening report ${escapeHtml(report.inspectionId)}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px; font: 14px/1.55 -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; color: #16202c; background: #f6f8fa; }
  main { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #dfe5ec; border-radius: 10px; padding: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: .06em; color: #5a6b7f; margin: 32px 0 10px; border-bottom: 1px solid #e6ebf1; padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 0 0 8px; }
  .muted { color: #7a8798; }
  .headline { margin: 20px 0; padding: 16px 18px; border-radius: 8px; border: 1px solid; font-weight: 600; font-size: 16px; }
  .headline.ok { background: #edf9f0; border-color: #b6e2c3; color: #1d6b35; }
  .headline.bad { background: #fdeeee; border-color: #f0bcbc; color: #97231f; }
  .headline.warn { background: #fff7e8; border-color: #f2d9a4; color: #8a5a10; }
  .headline.muted { background: #f2f4f7; border-color: #dfe5ec; color: #4a5a6c; }
  .counts { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
  .count { flex: 1 1 130px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; }
  .count b { display: block; font-size: 22px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #edf1f5; vertical-align: top; }
  th { font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: #6b7a8c; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill.ok { background: #e4f6ea; color: #1d6b35; }
  .pill.bad { background: #fbe4e4; color: #97231f; }
  .pill.warn { background: #fdf1dc; color: #8a5a10; }
  .pill.muted { background: #eef1f5; color: #55637a; }
  .issue { border: 1px solid #e6ebf1; border-left-width: 4px; border-radius: 8px; padding: 16px; margin: 12px 0; }
  .issue.bad { border-left-color: #d24b45; }
  .issue.warn { border-left-color: #d99a2b; }
  .tags { display: flex; gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
  dl { margin: 10px 0 0; display: grid; grid-template-columns: 190px 1fr; gap: 4px 12px; font-size: 13px; }
  dt { color: #6b7a8c; }
  dd { margin: 0; }
  blockquote { margin: 8px 0; padding: 10px 14px; border-left: 3px solid #dfe5ec; background: #f8fafc; font-style: italic; }
  .disclaimer { margin-top: 28px; padding: 14px 16px; border: 1px dashed #c9d3de; border-radius: 8px; background: #f8fafc; font-size: 13px; }
  ul { margin: 8px 0; padding-left: 20px; }
  @media print { body { background: #fff; padding: 0; } main { border: 0; } }
</style></head>
<body><main>
  <p class="muted">Department of Legal Metrology · automated screening</p>
  <h1>Compliance screening report</h1>
  <p class="muted">${escapeHtml(report.inspectionId)} · report ${escapeHtml(report.reportId)} · generated ${escapeHtml(report.generatedAt)}</p>

  <div class="headline ${STATUS_TONE[report.overall.status] ?? 'muted'}">${escapeHtml(report.overall.headline)}</div>

  <div class="counts">
    <div class="count"><b>${report.overall.summary.totalChecks}</b><span class="muted">Checks performed</span></div>
    <div class="count"><b>${report.overall.summary.compliant}</b><span class="muted">Passed</span></div>
    <div class="count"><b>${report.overall.summary.violations}</b><span class="muted">Potential violations</span></div>
    <div class="count"><b>${report.extractedFields.filter((field) => field.value !== null).length}</b><span class="muted">Declarations read</span></div>
  </div>

  <h2>Inspection</h2>
  <table>
    <tr><th>Inspection date</th><td>${escapeHtml(report.inspectionDate)}</td></tr>
    ${report.inspector ? `<tr><th>Inspector</th><td>${escapeHtml(report.inspector.name)} (${escapeHtml(report.inspector.inspectorId)})</td></tr>` : ''}
    ${report.business ? `<tr><th>Business</th><td>${escapeHtml(report.business.name)}</td></tr>` : ''}
    ${report.location ? `<tr><th>Location</th><td>${escapeHtml(report.location.address)}</td></tr>` : ''}
    <tr><th>Images</th><td>${report.images.length} submitted · ${Math.round(report.provenance.captureCompleteness * 100)}% of the package taken as captured</td></tr>
  </table>

  <h2>Product</h2>
  <table>
    <tr><th>Name</th><td>${escapeHtml(report.product.name ?? '—')}</td></tr>
    <tr><th>Commodity</th><td>${escapeHtml(report.product.commodityName ?? '—')}</td></tr>
    <tr><th>Net quantity</th><td>${escapeHtml(report.product.netQuantity ?? '—')}</td></tr>
    <tr><th>Retail sale price</th><td>${escapeHtml(report.product.mrp ?? '—')}</td></tr>
    <tr><th>Country of origin</th><td>${escapeHtml(report.product.countryOfOrigin ?? '—')}</td></tr>
  </table>

  <h2>Text recognition</h2>
  <table>
    <tr><th>Provider</th><td>${escapeHtml(report.ocrSummary.provider)}${report.ocrSummary.providerVersion ? ` (${escapeHtml(report.ocrSummary.providerVersion)})` : ''}</td></tr>
    <tr><th>Lines read</th><td>${report.ocrSummary.lineCount} · ${report.ocrSummary.characterCount} characters</td></tr>
    <tr><th>Mean confidence</th><td>${report.ocrSummary.meanRegionConfidence === null ? 'Not reported by the provider' : `${Math.round(report.ocrSummary.meanRegionConfidence * 100)}%`}</td></tr>
  </table>

  <h2>Declarations detected</h2>
  <table>
    <thead><tr><th>Declaration</th><th>Detected value</th><th>Confidence</th><th>How</th></tr></thead>
    <tbody>${fieldRows}</tbody>
  </table>

  <h2>Issues (${report.issues.length})</h2>
  ${
    report.issues.length === 0
      ? '<p class="muted">No issues were raised by the checks performed. This is not a statement that the package complies with every legal requirement — see the limitations below.</p>'
      : issueBlocks
  }

  <h2>Every check performed</h2>
  <table>
    <thead><tr><th>Provision</th><th>Declaration</th><th>Result</th><th>Reason</th></tr></thead>
    <tbody>${checkRows(report.checks.failed)}${checkRows(report.checks.passed)}${checkRows(report.checks.notApplicable)}</tbody>
  </table>

  <h2>Sources relied on</h2>
  <table>
    <thead><tr><th>Notification</th><th>Dated</th><th>Verification</th><th>Official source</th></tr></thead>
    <tbody>${report.sources
      .map(
        (source) => `<tr><td>${escapeHtml(source.notification)}</td><td>${escapeHtml(source.notificationDate)}</td><td>${escapeHtml(
          source.verificationStatus,
        )}</td><td>${source.officialUrl ? `<a href="${escapeHtml(source.officialUrl)}">link</a>` : '<span class="muted">—</span>'}</td></tr>`,
      )
      .join('')}</tbody>
  </table>

  <h2>Provenance</h2>
  <table>
    <tr><th>Rule set</th><td>${escapeHtml(report.provenance.ruleSetVersion)} · checksum ${escapeHtml(report.provenance.ruleSetChecksum)}</td></tr>
    <tr><th>Rule engine</th><td>${escapeHtml(report.provenance.engineVersion)}</td></tr>
    <tr><th>OCR</th><td>${escapeHtml(report.provenance.ocrProvider)} ${escapeHtml(report.provenance.ocrProviderVersion ?? '')}</td></tr>
    <tr><th>Extraction</th><td>${escapeHtml(report.provenance.extractionEngine)} ${escapeHtml(report.provenance.extractionEngineVersion)}</td></tr>
    <tr><th>Processing</th><td>OCR ${report.provenance.timings.ocrMs} ms · extraction ${report.provenance.timings.extractionMs} ms${
      typeof report.provenance.timings.llmMs === 'number'
        ? ` · model ${report.provenance.timings.llmMs} ms`
        : ''
    } · rules ${report.provenance.timings.ruleEngineMs} ms · total ${report.provenance.timings.totalMs} ms</td></tr>
    ${
      report.provenance.contextApplied.length > 0
        ? `<tr><th>Inferred about the package</th><td>${report.provenance.contextApplied
            .map((entry) => `${escapeHtml(entry.key)} = ${escapeHtml(entry.value)} <span class="muted">(${escapeHtml(entry.basis)})</span>`)
            .join('<br>')}</td></tr>`
        : ''
    }
  </table>

  ${
    report.warnings.length > 0
      ? `<h2>Notes</h2><ul>${report.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>`
      : ''
  }

  <h2>Limitations</h2>
  <ul>${report.limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul>

  <p class="disclaimer">${escapeHtml(report.disclaimer)}</p>
</main></body></html>`;
}
