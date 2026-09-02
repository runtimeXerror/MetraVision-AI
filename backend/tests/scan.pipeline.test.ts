import { describe, expect, it } from 'vitest';

import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';
import { evaluate } from '../src/compliance/rule-engine/RuleEngine';
import { extractInformation } from '../src/services/extraction';
import { aggregate, MockOCRProvider, type MockFixtureId } from '../src/services/ocr';
import {
  buildReport,
  captureCompletenessFor,
  generateIssues,
  renderReportHtml,
  scoreFor,
  toComplianceRequest,
  toLegacyStatus,
  toLegacyViolations,
  type ComplianceReport,
} from '../src/services/scan';

/**
 * The pipeline below the HTTP layer: adapter → existing rule engine → issues →
 * report.
 *
 * No database and no server, so these assert the reasoning rather than the
 * plumbing. `scan.api.test.ts` covers the endpoint.
 */

const corpus = builtInCorpus();

interface PipelineOptions {
  images?: number;
  productContext?: Record<string, unknown>;
  inspectionDate?: string;
}

async function pipeline(fixture: MockFixtureId, options: PipelineOptions = {}) {
  const { images = 1, productContext = {}, inspectionDate = '2026-09-02' } = options;

  const provider = new MockOCRProvider(fixture);
  const results = [];
  for (let index = 0; index < images; index += 1) {
    results.push(
      await provider.extractText({
        imageId: `img_${index}`,
        buffer: Buffer.from(`image-${index}`),
        mimeType: 'image/png',
      }),
    );
  }

  const ocr = aggregate(results, 5);
  const extraction = extractInformation(ocr);

  const adapted = toComplianceRequest({
    inspectionId: 'INS-2026-00001',
    inspectionDate,
    productContext: { category: 'packaged_food', packageType: 'RETAIL', ...productContext },
    extraction,
    ocr,
    imageIds: results.map((result) => result.imageId),
  });

  const compliance = evaluate(adapted.request, corpus, { now: new Date('2026-09-02T00:00:00Z') });
  const { issues, summary: issueSummary } = generateIssues(compliance, 'INS-2026-00001');

  const report = buildReport({
    inspectionId: 'INS-2026-00001',
    reportId: 'RPT-TEST',
    generatedAt: '2026-09-02T10:00:00.000Z',
    inspectionDate,
    images: [],
    ocr,
    extraction,
    compliance,
    issues,
    issueSummary,
    captureCompleteness: adapted.captureCompleteness,
    contextApplied: adapted.appliedSignals.map((signal) => ({
      key: signal.key,
      value: signal.value,
      basis: signal.basis,
    })),
    timings: { ocrMs: 5, extractionMs: 1, ruleEngineMs: 2, totalMs: 8 },
  });

  return { ocr, extraction, adapted, compliance, issues, issueSummary, report };
}

describe('rule engine adapter', () => {
  it('produces the engine’s own request shape without a trace of OCR in it', async () => {
    const { adapted } = await pipeline('compliant');

    expect(adapted.request.inspectionDate).toBe('2026-09-02');
    expect(adapted.request.fields.mrp).toMatchObject({ status: 'FOUND' });
    expect(adapted.request.fields.net_quantity).toMatchObject({ unit: 'kg' });
    expect(adapted.request.evidence?.extractionEngine).toContain('mock');
  });

  it('omits absenceConfidence entirely for a field it did not find', async () => {
    const { adapted } = await pipeline('missing_declarations');
    const mrp = adapted.request.fields.mrp!;

    expect(mrp.status).toBe('NOT_FOUND');
    expect(mrp.value).toBeNull();
    // The engine falls back to captureCompleteness. Setting a number here would
    // be this layer asserting how sure it is about a face it never saw.
    expect(mrp.absenceConfidence).toBeUndefined();
  });

  it('derives capture completeness from the number of photographs', async () => {
    expect(captureCompletenessFor(0)).toBe(0);
    expect(captureCompletenessFor(1)).toBeLessThan(0.7);
    expect(captureCompletenessFor(4)).toBeGreaterThanOrEqual(0.9);

    const one = await pipeline('compliant', { images: 1 });
    const four = await pipeline('compliant', { images: 4 });

    expect(four.adapted.captureCompleteness).toBeGreaterThan(one.adapted.captureCompleteness);
  });

  it('lets the caller’s own context override an inference, and records the disagreement', async () => {
    const { adapted } = await pipeline('imported_no_origin', {
      productContext: { isImported: false },
    });

    expect(adapted.request.productContext.isImported).toBe(false);
    expect(adapted.overriddenSignals.map((signal) => signal.key)).toContain('isImported');
  });

  it('adopts an inference only where the caller said nothing, and says why', async () => {
    const { adapted } = await pipeline('imported_no_origin');

    expect(adapted.request.productContext.isImported).toBe(true);
    expect(adapted.appliedSignals.find((signal) => signal.key === 'isImported')?.basis).toMatch(
      /importer/i,
    );
  });
});

describe('§16 — a declaration OCR did not find is not automatically a violation', () => {
  it('sends a missing declaration for review when only part of the package was captured', async () => {
    const { compliance, issues } = await pipeline('missing_declarations', { images: 1 });

    expect(compliance.status).toBe('REVIEW_REQUIRED');
    expect(compliance.summary.violations).toBe(0);

    const mrp = issues.find((issue) => issue.field === 'mrp')!;
    expect(mrp.classification).toBe('REVIEW');
  });

  it('records the same absence as a potential violation once the package was captured properly', async () => {
    const { compliance, issues } = await pipeline('missing_declarations', { images: 4 });

    expect(compliance.status).toBe('VIOLATION_DETECTED');

    const mrp = issues.find((issue) => issue.field === 'mrp')!;
    expect(mrp.classification).toBe('POTENTIAL_VIOLATION');
    expect(mrp.reasonCode).toBe('DECLARATION_ABSENT');
  });

  it('sends a weakly-read value for review rather than acting on it', async () => {
    const { compliance, issues } = await pipeline('low_confidence', { images: 4 });

    const mrp = issues.find((issue) => issue.field === 'mrp')!;
    expect(mrp.classification).toBe('REVIEW');
    expect(mrp.reasonCode).toBe('DECLARATION_UNREADABLE');
    expect(compliance.summary.reviewRequired).toBeGreaterThan(0);
  });
});

describe('issue generation', () => {
  it('copies the rule’s own citation and never writes a legal explanation', async () => {
    const { issues } = await pipeline('missing_declarations', { images: 4 });
    const mrp = issues.find((issue) => issue.field === 'mrp')!;

    expect(mrp.source.clause).toBe('6(1)(e)');
    expect(mrp.source.notification).toMatch(/G\.S\.R\./);
    expect(mrp.source.officialUrl).toBeTruthy();
    expect(mrp.legalText.length).toBeGreaterThan(30);
    expect(mrp.machineInterpretation.length).toBeGreaterThan(30);
  });

  it('uses the corpus’s severity and derives the classification from the check', async () => {
    const { issues } = await pipeline('missing_declarations', { images: 4 });
    const mrp = issues.find((issue) => issue.field === 'mrp')!;

    // The corpus grades rule 6(1)(e) CRITICAL. That grading is carried, not made.
    expect(mrp.severity).toBe('CRITICAL');
    expect(mrp.classification).toBe('POTENTIAL_VIOLATION');
  });

  it('never labels a review as a violation, whatever the rule’s grading', async () => {
    const { issues } = await pipeline('low_confidence', { images: 4 });

    for (const issue of issues.filter((entry) => entry.classification === 'REVIEW')) {
      expect(issue.reasonCode).not.toBe('DECLARATION_ABSENT');
    }
  });

  it('produces a stable issue id for the same finding on the same inspection', async () => {
    const first = await pipeline('missing_declarations', { images: 4 });
    const second = await pipeline('missing_declarations', { images: 4 });

    expect(first.issues.map((issue) => issue.issueId)).toEqual(
      second.issues.map((issue) => issue.issueId),
    );
  });

  it('orders findings before questions', async () => {
    const { issues } = await pipeline('low_confidence', { images: 4 });
    const ranks = issues.map((issue) =>
      issue.classification === 'POTENTIAL_VIOLATION' ? 0 : issue.classification === 'REVIEW' ? 1 : 2,
    );

    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('the report', () => {
  const headline = (report: ComplianceReport): string => report.overall.headline;

  it('never claims compliance on a clean scan', async () => {
    const { report, compliance } = await pipeline('compliant', { images: 4 });

    expect(compliance.status).toBe('COMPLIANT');
    expect(headline(report)).toBe('NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED');
    expect(headline(report)).not.toMatch(/100%/);
    expect(JSON.stringify(report)).not.toMatch(/100% (?:legally )?compliant/i);
    expect(JSON.stringify(report)).not.toMatch(/legally guaranteed/i);
  });

  it('reports what was checked, passed, failed and skipped', async () => {
    const { report } = await pipeline('compliant', { images: 4 });

    expect(report.overall.summary.totalChecks).toBeGreaterThan(0);
    expect(report.checks.passed.length).toBe(report.overall.summary.compliant);
    expect(report.checks.failed.length).toBe(report.overall.summary.violations);
    expect(report.checks.reviewRequired.length).toBe(report.overall.summary.reviewRequired);
    expect(report.checks.notApplicable.length).toBe(report.overall.summary.notApplicable);
  });

  it('carries the disclaimer and the limitations that actually applied', async () => {
    const { report } = await pipeline('compliant', { images: 1 });

    expect(report.disclaimer).toMatch(/reviewed by an authorized inspector/i);
    expect(report.limitations.join(' ')).toMatch(/Only part of the package was captured/i);
    expect(report.limitations.join(' ')).toMatch(/cannot weigh or measure/i);
  });

  it('reports a violation with its evidence and rule reference', async () => {
    const { report } = await pipeline('missing_declarations', { images: 4 });

    expect(headline(report)).toBe('POTENTIAL NON-COMPLIANCE DETECTED');
    expect(report.issueSummary.potentialViolations).toBeGreaterThan(0);
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.sources[0]?.notification).toMatch(/G\.S\.R\./);
  });

  it('reports a review-required scan without asserting a violation', async () => {
    const { report } = await pipeline('missing_declarations', { images: 1 });

    expect(headline(report)).toBe('INSPECTOR REVIEW REQUIRED');
    expect(report.issueSummary.potentialViolations).toBe(0);
    expect(report.issueSummary.review).toBeGreaterThan(0);
  });

  it('records the exact rule set, engine and OCR provider the verdict rests on', async () => {
    const { report } = await pipeline('compliant', { images: 4 });

    expect(report.provenance.ruleSetVersion).toMatch(/^LM-PC-\d{4}-\d{2}-\d{2}$/);
    expect(report.provenance.ruleSetChecksum).toHaveLength(16);
    expect(report.provenance.engineVersion).toBe('lm-rule-engine/1.0.0');
    expect(report.provenance.ocrProvider).toBe('mock');
    expect(report.provenance.extractionEngine).toBe('rule-based-extractor');
  });

  it('renders self-contained HTML carrying the same verdict', async () => {
    const { report } = await pipeline('missing_declarations', { images: 4 });
    const html = renderReportHtml(report);

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('POTENTIAL NON-COMPLIANCE DETECTED');
    expect(html).toContain(report.disclaimer);
    // Self-contained: nothing to fetch, so it renders from a saved copy offline.
    expect(html).not.toMatch(/<script|<link[^>]+stylesheet/i);
  });

  it('escapes text into the HTML rather than interpolating it', async () => {
    const { report } = await pipeline('compliant', { images: 1 });
    const injected: ComplianceReport = {
      ...report,
      product: { ...report.product, name: '<img src=x onerror=alert(1)>' },
    };

    const html = renderReportHtml(injected);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});

describe('the projection the older screens read', () => {
  it('collapses five states into three without promoting anything to a pass', async () => {
    expect(toLegacyStatus('COMPLIANT')).toBe('COMPLIANT');
    expect(toLegacyStatus('VIOLATION_DETECTED')).toBe('VIOLATION_DETECTED');
    expect(toLegacyStatus('REVIEW_REQUIRED')).toBe('REVIEW_REQUIRED');
    expect(toLegacyStatus('INSUFFICIENT_EVIDENCE')).toBe('REVIEW_REQUIRED');
    expect(toLegacyStatus('NOT_APPLICABLE')).toBe('REVIEW_REQUIRED');
  });

  it('keeps reviews out of the violations register', async () => {
    const { issues } = await pipeline('low_confidence', { images: 4 });
    const violations = toLegacyViolations(issues);

    expect(violations.length).toBe(
      issues.filter((issue) => issue.classification === 'POTENTIAL_VIOLATION').length,
    );
    expect(violations.length).toBeLessThan(issues.length);
  });

  it('scores over decided checks only', async () => {
    const clean = await pipeline('compliant', { images: 4 });
    const bad = await pipeline('missing_declarations', { images: 4 });

    expect(scoreFor(clean.compliance)).toBe(100);
    expect(scoreFor(bad.compliance)).toBeLessThan(100);
  });
});

describe('the same package on two dates', () => {
  /**
   * The rule engine resolves every provision against the inspection date. This
   * asserts the scan pipeline hands that date through untouched — an
   * inspection backdated to 2015 must be judged on the law of 2015.
   */
  it('is judged against the law in force on the inspection date', async () => {
    const modern = await pipeline('compliant', { images: 4, inspectionDate: '2026-09-02' });
    const historic = await pipeline('compliant', { images: 4, inspectionDate: '2015-06-01' });

    expect(historic.compliance.inspectionDate).toBe('2015-06-01');
    expect(historic.compliance.checks.length).toBeGreaterThan(0);

    const modernRules = new Set(modern.compliance.checks.map((check) => `${check.ruleId}@${check.ruleVersion}`));
    const historicRules = new Set(
      historic.compliance.checks.map((check) => `${check.ruleId}@${check.ruleVersion}`),
    );

    // The corpus has amended rules since 2015, so the two evaluations cannot
    // have relied on the same set of rule versions.
    expect(historicRules).not.toEqual(modernRules);
  });
});
