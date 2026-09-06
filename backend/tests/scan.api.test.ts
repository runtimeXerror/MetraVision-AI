import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Inspection } from '../src/models/Inspection';
import { ComplianceEvaluation } from '../src/models/ComplianceEvaluation';
import * as ocr from '../src/services/ocr';
import { FailingOCRProvider, mockProviderFor } from '../src/services/ocr';
import { captureCompletenessFor } from '../src/services/scan';
import * as scanService from '../src/services/scan/scanService';
import { ApiError } from '../src/utils/ApiError';

import { app, PNG_BYTES, signIn, type Signed } from './helpers';

/**
 * ── THE ACCEPTANCE TEST ─────────────────────────────────────────────────────
 *
 *   image → OCR → extraction → rule engine → issues → report → API response
 *
 * Driven through the real HTTP endpoint with real authentication, a real
 * database and the real rule engine. Only the OCR provider is substituted, by
 * pinning a mock fixture — which is the whole reason `OCRProvider` exists.
 * ────────────────────────────────────────────────────────────────────────────
 */

const SCAN_DATE = '2026-09-02';

let session: Signed;

beforeEach(async () => {
  session = await signIn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

interface ScanOptions {
  images?: number;
  fixture?: string;
  productContext?: Record<string, unknown>;
  inspectionDate?: string;
}

function scan(options: ScanOptions = {}) {
  const { images = 1, fixture = 'compliant', productContext, inspectionDate = SCAN_DATE } = options;

  const call = request(app)
    .post('/api/inspections/scan')
    .set('Authorization', session.auth)
    .field('inspectionDate', inspectionDate);

  if (fixture) call.field('mockFixture', fixture);
  if (productContext) call.field('productContext', JSON.stringify(productContext));

  for (let index = 0; index < images; index += 1) {
    call.attach(images === 1 ? 'image' : 'images', PNG_BYTES, `face-${index}.png`);
  }

  return call;
}

describe('POST /api/inspections/scan — authentication and validation', () => {
  it('rejects an unauthenticated scan', async () => {
    await request(app)
      .post('/api/inspections/scan')
      .field('inspectionDate', SCAN_DATE)
      .attach('image', PNG_BYTES, 'label.png')
      .expect(401);
  });

  it('rejects a scan with no image', async () => {
    const response = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', SCAN_DATE)
      .expect(400);

    expect(response.body.errorCode).toBe('NO_FILE');
  });

  it('rejects a missing or malformed inspection date', async () => {
    const missing = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .attach('image', PNG_BYTES, 'label.png')
      .expect(422);

    expect(missing.body.errorCode).toBe('VALIDATION_FAILED');

    await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', 'last Tuesday')
      .attach('image', PNG_BYTES, 'label.png')
      .expect(422);
  });

  it('rejects a file that is not an image, whatever it claims to be', async () => {
    const response = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', SCAN_DATE)
      // A declared MIME type is a claim; the magic bytes are the fact.
      .attach('image', Buffer.from('#!/bin/sh\nrm -rf /'), {
        filename: 'payload.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(response.body.errorCode).toBe('INVALID_IMAGE');
  });

  it('rejects an unsupported image format at the door', async () => {
    const response = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', SCAN_DATE)
      .attach('image', PNG_BYTES, { filename: 'label.gif', contentType: 'image/gif' })
      .expect(415);

    expect(response.body.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects an unknown mock fixture rather than silently scanning something else', async () => {
    const response = await scan({ fixture: 'does-not-exist' }).expect(400);
    expect(response.body.errorCode).toBe('MOCK_FIXTURE_UNKNOWN');
  });
});

describe('POST /api/inspections/scan — the full pipeline', () => {
  it('returns OCR, extraction, compliance and report in one response', async () => {
    const response = await scan({ fixture: 'compliant', images: 4 }).expect(201);
    const body = response.body.data;

    expect(response.body.success).toBe(true);
    expect(body.inspectionId).toMatch(/^INS-\d{4}-\d{5}$/);

    // OCR
    expect(body.ocr.provider).toBe('mock');
    expect(body.ocr.rawText).toContain('AASHIRVAAD');
    expect(body.ocr.regions.length).toBeGreaterThan(0);
    expect(body.ocr.regions[0].boundingBox).toHaveLength(4);

    // Extraction
    expect(body.extractedData.fields.mrp.value).toBe('MRP ₹315.00 (incl. of all taxes)');
    expect(body.extractedData.fields.net_quantity.unit).toBe('kg');
    expect(body.extractedData.fields.mrp.evidence[0].imageId).toBeTruthy();

    // Compliance — from the existing engine, unmodified.
    expect(body.compliance.status).toBe('COMPLIANT');
    expect(body.compliance.engineVersion).toBe('lm-rule-engine/1.0.0');
    expect(body.compliance.ruleSetVersion).toMatch(/^LM-PC-/);
    expect(body.compliance.checks.length).toBeGreaterThan(0);
    expect(body.compliance.headline).toBe('NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED');

    // Report
    expect(body.report.available).toBe(true);
    expect(body.report.reportId).toMatch(/^RPT-/);
    expect(body.report.disclaimer).toMatch(/reviewed by an authorized inspector/i);

    // Observability
    expect(body.timings.ocrMs).toBeGreaterThanOrEqual(0);
    expect(body.timings.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('never leaks the OCR credential or endpoint to the client', async () => {
    const response = await scan().expect(201);
    const serialised = JSON.stringify(response.body);

    expect(serialised).not.toMatch(/googleapis\.com/i);
    expect(serialised).not.toMatch(/OCR_API_KEY|private_key|Bearer /);
  });

  it('produces a violation report for a package missing a mandatory declaration', async () => {
    const response = await scan({ fixture: 'missing_declarations', images: 4 }).expect(201);
    const body = response.body.data;

    expect(body.compliance.status).toBe('VIOLATION_DETECTED');
    expect(body.compliance.headline).toBe('POTENTIAL NON-COMPLIANCE DETECTED');

    const mrp = body.compliance.issues.find(
      (issue: { field?: string }) => issue.field === 'mrp',
    );
    expect(mrp.classification).toBe('POTENTIAL_VIOLATION');
    expect(mrp.severity).toBe('CRITICAL');
    expect(mrp.source.clause).toBe('6(1)(e)');
    expect(mrp.source.notification).toMatch(/G\.S\.R\./);
  });

  it('produces a review-required report from a single photograph of the same package', async () => {
    const response = await scan({ fixture: 'missing_declarations', images: 1 }).expect(201);
    const body = response.body.data;

    // Same package, one face photographed: the absence is a question, not a
    // finding. This is the §16 requirement, asserted end to end.
    expect(body.compliance.status).toBe('REVIEW_REQUIRED');
    expect(body.compliance.summary.violations).toBe(0);
    expect(body.evidence.captureCompleteness).toBeLessThan(0.7);
  });

  it('shows which facts about the package were inferred from the label', async () => {
    const response = await scan({ fixture: 'imported_no_origin', images: 4 }).expect(201);
    const applied = response.body.data.evidence.contextApplied as Array<{ key: string; basis: string }>;

    expect(applied.map((entry) => entry.key)).toContain('isImported');
    expect(applied.find((entry) => entry.key === 'isImported')?.basis).toBeTruthy();
  });
});

describe('persistence and audit', () => {
  it('records the inspection with the full scan and the legacy projection', async () => {
    const response = await scan({ fixture: 'missing_declarations', images: 4 }).expect(201);
    const inspection = await Inspection.findOne({ inspectionId: response.body.data.inspectionId });

    expect(inspection).not.toBeNull();
    expect(inspection!.status).toBe('VIOLATION_DETECTED');

    // The engine's result, whole.
    expect(inspection!.scan?.legal.status).toBe('VIOLATION_DETECTED');
    expect(inspection!.scan?.legal.ruleSetVersion).toMatch(/^LM-PC-/);
    expect(inspection!.scan?.legal.ruleSetChecksum).toHaveLength(16);
    expect(inspection!.scan?.ocr.provider).toBe('mock');
    expect(inspection!.scan?.ocr.rawText.length).toBeGreaterThan(0);
    expect(inspection!.scan?.extraction.engineVersion).toBeTruthy();

    // …and the projection the existing screens read.
    expect(inspection!.complianceResult?.status).toBe('VIOLATION_DETECTED');
    expect(inspection!.complianceResult!.violations.length).toBeGreaterThan(0);
    expect(inspection!.extractedFields.length).toBeGreaterThan(0);
  });

  it('writes an audit record that can replay the evaluation', async () => {
    const response = await scan({ fixture: 'compliant', images: 4 }).expect(201);
    const evaluation = await ComplianceEvaluation.findOne({
      inspectionId: response.body.data.inspectionId,
    });

    expect(evaluation).not.toBeNull();
    expect(evaluation!.engineVersion).toBe('lm-rule-engine/1.0.0');
    expect(evaluation!.ruleSetChecksum).toHaveLength(16);
    expect(evaluation!.inputSnapshot.fields).toBeTruthy();
    expect(evaluation!.inputSnapshot.thresholds).toBeTruthy();
  });

  it('makes the scan visible in history and in the stats the dashboard reads', async () => {
    await scan({ fixture: 'missing_declarations', images: 4 }).expect(201);

    const list = await request(app)
      .get('/api/inspections')
      .set('Authorization', session.auth)
      .expect(200);

    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].scan).toBeTruthy();
    expect(list.body.data.items[0].scan.legal.status).toBe('VIOLATION_DETECTED');

    const stats = await request(app)
      .get('/api/inspections/stats')
      .set('Authorization', session.auth)
      .expect(200);

    expect(stats.body.data.totalInspections).toBe(1);
    expect(stats.body.data.violations).toBe(1);
  });
});

describe('GET /api/inspections/:id/report', () => {
  it('serves the JSON report with every section the brief requires', async () => {
    const scanned = await scan({ fixture: 'missing_declarations', images: 4 }).expect(201);

    const response = await request(app)
      .get(`/api/inspections/${scanned.body.data.inspectionId}/report`)
      .set('Authorization', session.auth)
      .expect(200);

    const report = response.body.data;

    expect(report.inspectionId).toBe(scanned.body.data.inspectionId);
    expect(report.generatedAt).toBeTruthy();
    expect(report.product).toBeTruthy();
    expect(report.images.length).toBe(4);
    expect(report.ocrSummary.provider).toBe('mock');
    expect(report.extractedFields.length).toBeGreaterThan(0);
    expect(report.rulesEvaluated.length).toBeGreaterThan(0);
    expect(report.checks.passed).toBeDefined();
    expect(report.checks.failed.length).toBeGreaterThan(0);
    expect(report.checks.reviewRequired).toBeDefined();
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues[0].evidence).toBeDefined();
    expect(report.sources.length).toBeGreaterThan(0);
    expect(report.overall.status).toBe('VIOLATION_DETECTED');
    expect(report.limitations.length).toBeGreaterThan(0);
    expect(report.disclaimer).toMatch(/automated compliance screening/i);
    expect(report.provenance.ruleSetVersion).toMatch(/^LM-PC-/);
  });

  it('serves the printable HTML report', async () => {
    const scanned = await scan({ fixture: 'compliant', images: 4 }).expect(201);

    const response = await request(app)
      .get(`/api/inspections/${scanned.body.data.inspectionId}/report?format=html`)
      .set('Authorization', session.auth)
      .expect(200);

    expect(response.headers['content-type']).toMatch(/html/);
    expect(response.text).toContain('NO COMPLIANCE ISSUES DETECTED IN THE CHECKS PERFORMED');
    expect(response.text).not.toMatch(/100% compliant/i);
  });

  it('does not serve one inspector’s report to another', async () => {
    const scanned = await scan().expect(201);
    const other = await signIn();

    await request(app)
      .get(`/api/inspections/${scanned.body.data.inspectionId}/report`)
      .set('Authorization', other.auth)
      .expect(404);
  });

  it('lets a supervisor read any report', async () => {
    const scanned = await scan().expect(201);
    const supervisor = await signIn({ role: 'SUPERVISOR' });

    await request(app)
      .get(`/api/inspections/${scanned.body.data.inspectionId}/report`)
      .set('Authorization', supervisor.auth)
      .expect(200);
  });
});

describe('failure paths', () => {
  it('fails the scan when OCR is unavailable, and never evaluates empty data', async () => {
    vi.spyOn(scanService, 'runScan');
    vi.spyOn(ocr, 'ocrProvider', 'get').mockReturnValue(
      new FailingOCRProvider(new ApiError(503, 'OCR_FAILED', 'The OCR service is unavailable. Please try again.')),
    );

    const response = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', SCAN_DATE)
      .attach('image', PNG_BYTES, 'label.png')
      .expect(503);

    expect(response.body.errorCode).toBe('SCAN_FAILED');
    expect(response.body.message).toMatch(/OCR service is unavailable/i);
    expect(response.body.details.cause).toBe('OCR_FAILED');

    // Nothing was evaluated: an empty field set must never reach the engine.
    expect(await ComplianceEvaluation.countDocuments()).toBe(0);

    // …and the record survives in DRAFT so the inspector can retry.
    const inspection = await Inspection.findOne({ inspectionId: response.body.details.inspectionId });
    expect(inspection?.status).toBe('DRAFT');
    expect(inspection?.images.length).toBe(1);
    expect(inspection?.scan).toBeUndefined();
  });

  it('refuses to evaluate a photograph in which nothing was readable', async () => {
    const response = await scan({ fixture: 'blank' }).expect(422);

    expect(response.body.errorCode).toBe('SCAN_FAILED');
    expect(response.body.details.cause).toBe('NO_TEXT_DETECTED');
    expect(await ComplianceEvaluation.countDocuments()).toBe(0);
  });

  it('does not return an internal stack trace when the rule engine fails', async () => {
    vi.spyOn(scanService, 'runScan').mockRejectedValue(new Error('mongo exploded at line 42'));

    const response = await request(app)
      .post('/api/inspections/scan')
      .set('Authorization', session.auth)
      .field('inspectionDate', SCAN_DATE)
      .attach('image', PNG_BYTES, 'label.png')
      .expect(500);

    expect(response.body.errorCode).toBe('SCAN_FAILED');
    expect(JSON.stringify(response.body)).not.toMatch(/mongo exploded|at Object\.|\.ts:\d+/);
  });

  it('reports the scan pipeline’s configuration without exposing a credential', async () => {
    const response = await request(app)
      .get('/api/inspections/scan/status')
      .set('Authorization', session.auth)
      .expect(200);

    expect(response.body.data.ocrProvider).toBe('mock');
    expect(response.body.data.usesLlmForDecisions).toBe(false);
    expect(response.body.data.decisionsMadeBy).toBe('lm-rule-engine');
    expect(JSON.stringify(response.body)).not.toMatch(/key|secret|credential/i);
  });
});

describe('POST /api/inspections/:id/scan — scanning images already on record', () => {
  /** The capture flow: create, upload faces one at a time, then scan. */
  async function captured(images = 4): Promise<string> {
    const create = await request(app)
      .post('/api/inspections')
      .set('Authorization', session.auth)
      .send({
        business: { name: 'Sharma General Store' },
        location: { address: 'MG Road, Pune' },
        productCategory: 'packaged_food',
      })
      .expect(201);

    const id = create.body.data.inspectionId as string;

    // A different face each time, which is what the capture flow asks an
    // inspector for. Capture completeness counts faces, so four photographs of
    // one panel is not the same evidence as four photographs of four.
    const faces = ['FRONT', 'BACK', 'SIDE', 'ADDITIONAL'] as const;

    for (let index = 0; index < images; index += 1) {
      await request(app)
        .post(`/api/inspections/${id}/images`)
        .set('Authorization', session.auth)
        .field('type', faces[index % faces.length]!)
        .attach('image', PNG_BYTES, `face-${index}.png`)
        .expect(201);
    }

    return id;
  }

  it('runs the pipeline over the stored photographs and returns the inspection', async () => {
    const id = await captured();

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'missing_declarations' })
      .expect(200);

    const dto = response.body.data;

    expect(dto.inspectionId).toBe(id);
    expect(dto.status).toBe('VIOLATION_DETECTED');
    expect(dto.scan.legal.status).toBe('VIOLATION_DETECTED');
    expect(dto.scan.ocr.provider).toBe('mock');
    expect(dto.extractedFields.length).toBeGreaterThan(0);
    expect(dto.complianceResult.violations.length).toBeGreaterThan(0);
  });

  it('can be re-run, and the later verdict replaces the earlier one', async () => {
    const id = await captured();

    await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'missing_declarations' })
      .expect(200);

    const second = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'compliant' })
      .expect(200);

    expect(second.body.data.scan.legal.status).toBe('COMPLIANT');

    // Both evaluations survive: an earlier verdict is never overwritten in the
    // audit trail, only superseded.
    expect(await ComplianceEvaluation.countDocuments({ inspectionId: id })).toBe(2);
  });

  it('refuses to scan an inspection with no images', async () => {
    const create = await request(app)
      .post('/api/inspections')
      .set('Authorization', session.auth)
      .send({ business: { name: 'Empty' }, location: { address: 'Nowhere' } })
      .expect(201);

    const response = await request(app)
      .post(`/api/inspections/${create.body.data.inspectionId}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE })
      .expect(400);

    expect(response.body.errorCode).toBe('NO_IMAGES');
  });

  it('leaves the record retryable rather than stuck in PROCESSING when the scan fails', async () => {
    const id = await captured(1);

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'blank' })
      .expect(422);

    expect(response.body.errorCode).toBe('SCAN_FAILED');

    const after = await Inspection.findOne({ inspectionId: id });
    expect(after?.status).not.toBe('PROCESSING');
    expect(after?.images.length).toBe(1);
  });

  it('refuses a second scan while the first is still running', async () => {
    const id = await captured(1);

    // What the record looks like for the seconds a scan is in flight. A second
    // scan starting here used to run to completion and then fail to save,
    // because the first had already moved the document version on — and the
    // inspector was shown INTERNAL_ERROR for it.
    await Inspection.updateOne({ inspectionId: id }, { $set: { status: 'PROCESSING' } });

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'compliant' })
      .expect(409);

    expect(response.body.errorCode).toBe('SCAN_IN_PROGRESS');
  });

  it('takes over a record left in PROCESSING by a scan that never finished', async () => {
    const id = await captured(1);

    // A process killed mid-scan leaves this behind. The lock has to expire, or
    // the record could never be scanned again.
    await Inspection.updateOne(
      { inspectionId: id },
      { $set: { status: 'PROCESSING', updatedAt: new Date(Date.now() - 60 * 60 * 1000) } },
      { timestamps: false },
    );

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'compliant' })
      .expect(200);

    expect(response.body.data.scan.legal.status).toBe('COMPLIANT');
  });

  it('reports on the faces it could read when one photograph fails', async () => {
    const id = await captured(4);

    /**
     * One face the OCR cannot get through, three it can.
     *
     * This is the failure an inspector actually meets: a curved bottle or a
     * dark MRP box runs past `OCR_TIMEOUT_MS` while the other faces read in
     * seconds. It used to sink the whole scan — three good reads discarded,
     * and "Analysis could not be completed" on a package that had been
     * photographed properly.
     */
    let seen = 0;
    const flaky = mockProviderFor('compliant');
    vi.spyOn(ocr, 'ocrProvider', 'get').mockReturnValue({
      ...flaky,
      name: flaky.name,
      version: flaky.version,
      isConfigured: () => true,
      configurationHint: () => null,
      extractText: async (image) => {
        seen += 1;
        if (seen === 2) {
          throw new ApiError(504, 'OCR_TIMEOUT', 'The OCR service did not respond within 45 seconds.');
        }
        return flaky.extractText(image);
      },
    });

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE })
      .expect(200);

    const dto = response.body.data;

    // The report exists, and it rests on the three faces that were read.
    expect(dto.scan.ocr.imageIds.length).toBe(3);
    expect(dto.scan.ocr.unread.length).toBe(1);
    expect(dto.scan.ocr.unread[0].code).toBe('OCR_TIMEOUT');

    // The inspector is told, rather than left to wonder why a declaration on
    // the missing face is absent from the report.
    expect(dto.aiAnalysis.warnings[0]).toMatch(/1 of 4 photographs could not be read/);

    // And the engine was told the package was less completely captured than
    // four photographs would imply — this is what keeps an unread face from
    // becoming a missing declaration.
    expect(dto.scan.captureCompleteness).toBe(captureCompletenessFor(3));

    const after = await Inspection.findOne({ inspectionId: id });
    expect(after?.status).not.toBe('PROCESSING');
  });

  it('fails the scan only when no photograph at all could be read', async () => {
    const id = await captured(3);

    vi.spyOn(ocr, 'ocrProvider', 'get').mockReturnValue(
      new FailingOCRProvider(new ApiError(504, 'OCR_TIMEOUT', 'The OCR service did not respond.')),
    );

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE })
      .expect(504);

    // The reason survives: OCR_TIMEOUT and OCR_SERVICE_DOWN send an inspector
    // to two different places.
    expect(response.body.errorCode).toBe('SCAN_FAILED');
    expect(response.body.details.cause).toBe('OCR_TIMEOUT');
    expect(response.body.details.retryable).toBe(true);

    const after = await Inspection.findOne({ inspectionId: id });
    expect(after?.status).toBe('DRAFT');
    expect(after?.scan).toBeUndefined();
  });

  it('does not accuse a trader on three photographs of one panel', async () => {
    const create = await request(app)
      .post('/api/inspections')
      .set('Authorization', session.auth)
      .send({
        business: { name: 'Smart Bazar' },
        location: { address: 'MG Road, Pune' },
        productCategory: 'cosmetic',
      })
      .expect(201);

    const id = create.body.data.inspectionId as string;

    // What an inspector does with a small curved bottle: three goes at the
    // same panel, trying to get the print in focus. Counted as photographs
    // that was 0.85 capture completeness, past the engine's floor, and every
    // declaration printed on a face nobody had photographed came back as a
    // violation. It is one face of evidence, and three attempts at it.
    for (let index = 0; index < 3; index += 1) {
      await request(app)
        .post(`/api/inspections/${id}/images`)
        .set('Authorization', session.auth)
        .field('type', 'FRONT')
        .attach('image', PNG_BYTES, `attempt-${index}.png`)
        .expect(201);
    }

    const response = await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', session.auth)
      .send({ inspectionDate: SCAN_DATE, mockFixture: 'missing_declarations' })
      .expect(200);

    const dto = response.body.data;

    expect(dto.scan.captureCompleteness).toBe(captureCompletenessFor(1));
    expect(dto.scan.evidence?.facesCaptured ?? dto.scan.legal.status).toBeDefined();

    // A declaration that was not found is a question for the inspector, not a
    // finding against the trader.
    expect(dto.scan.legal.status).not.toBe('VIOLATION_DETECTED');
    expect(
      dto.scan.legal.issues.filter(
        (issue: { classification: string }) => issue.classification === 'POTENTIAL_VIOLATION',
      ),
    ).toHaveLength(0);
  });

  it('will not scan another inspector’s record', async () => {
    const id = await captured(1);
    const other = await signIn();

    await request(app)
      .post(`/api/inspections/${id}/scan`)
      .set('Authorization', other.auth)
      .send({ inspectionDate: SCAN_DATE })
      .expect(404);
  });
});
