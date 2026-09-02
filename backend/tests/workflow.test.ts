import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { resetScenarioRotation } from '../src/services/analysisService';

import { PNG_BYTES, app, inspectionPayload, signIn } from './helpers';

/**
 * The end-to-end workflow: images → analysis → review → finalize → report.
 *
 * The mock analyser rotates scenarios, so each test resets the rotation and
 * drives it deliberately rather than depending on suite ordering.
 */

beforeEach(() => {
  resetScenarioRotation();
});

async function newInspection(auth: string) {
  const response = await request(app)
    .post('/api/inspections')
    .set('Authorization', auth)
    .send(inspectionPayload())
    .expect(201);
  return response.body.data;
}

/**
 * Returns the supertest chain rather than a promise, so callers can append
 * `.expect(...)` — an `async` wrapper here would resolve to a Response and lose
 * the assertion API.
 */
function withImage(auth: string, id: string, type = 'FRONT') {
  return request(app)
    .post(`/api/inspections/${id}/images`)
    .set('Authorization', auth)
    .field('type', type)
    .attach('image', PNG_BYTES, 'label.png');
}

/* ── Images ───────────────────────────────────────────────────────────────── */

describe('inspection images', () => {
  it('accepts a valid image upload', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    const response = await withImage(auth, inspection.id).expect(201);

    expect(response.body.data.images).toHaveLength(1);
    expect(response.body.data.images[0].type).toBe('FRONT');
    expect(response.body.data.images[0].url).toContain('/uploads/');
  });

  it('rejects a non-image file', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/images`)
      .set('Authorization', auth)
      .attach('image', Buffer.from('this is not an image'), {
        filename: 'notes.txt',
        contentType: 'text/plain',
      })
      .expect(415);

    expect(response.body.errorCode).toBe('UNSUPPORTED_MEDIA_TYPE');
  });

  it('rejects a file that claims to be an image but is not', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    // Correct MIME type, wrong bytes — the magic-byte check must catch it.
    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/images`)
      .set('Authorization', auth)
      .attach('image', Buffer.from('definitely not a png'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);

    expect(response.body.errorCode).toBe('INVALID_IMAGE');
  });

  it('rejects an upload with no file', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    await request(app)
      .post(`/api/inspections/${inspection.id}/images`)
      .set('Authorization', auth)
      .field('type', 'FRONT')
      .expect(400);
  });

  it('lists and deletes images', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    const upload = await withImage(auth, inspection.id).expect(201);
    const imageId = upload.body.data.images[0].imageId;

    const list = await request(app)
      .get(`/api/inspections/${inspection.id}/images`)
      .set('Authorization', auth)
      .expect(200);
    expect(list.body.data).toHaveLength(1);

    await request(app)
      .delete(`/api/inspections/${inspection.id}/images/${imageId}`)
      .set('Authorization', auth)
      .expect(200);

    const after = await request(app)
      .get(`/api/inspections/${inspection.id}/images`)
      .set('Authorization', auth)
      .expect(200);
    expect(after.body.data).toHaveLength(0);
  });

  it('will not let another inspector upload to the record', async () => {
    const alice = await signIn({ email: 'ia@legalmetrology.gov.in' });
    const bob = await signIn({ email: 'ib@legalmetrology.gov.in' });

    const inspection = await newInspection(alice.auth);
    await withImage(bob.auth, inspection.id).expect(404);
  });
});

/* ── Analysis ─────────────────────────────────────────────────────────────── */

describe('POST /api/inspections/:id/analyze', () => {
  it('refuses to analyse an inspection with no images', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(400);

    expect(response.body.errorCode).toBe('NO_IMAGES');
  });

  it('produces extracted fields and a compliance verdict', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);
    await withImage(auth, inspection.id).expect(201);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const data = response.body.data;
    expect(data.extractedFields.length).toBeGreaterThan(0);
    expect(data.aiAnalysis.engine).toBe('MOCK');
    expect(data.complianceResult).toBeTruthy();
    expect(['COMPLIANT', 'VIOLATION_DETECTED', 'REVIEW_REQUIRED']).toContain(
      data.complianceResult.status,
    );
    expect(data.status).toBe(data.complianceResult.status);
  });

  it('reports every extracted field with an aiValue and a confidence', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);
    await withImage(auth, inspection.id).expect(201);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    for (const field of response.body.data.extractedFields) {
      expect(field).toHaveProperty('name');
      expect(field).toHaveProperty('aiValue');
      expect(field.confidence).toBeGreaterThanOrEqual(0);
      expect(field.confidence).toBeLessThanOrEqual(1);
      // Nothing is human-verified until an inspector actually reviews it.
      expect(field.reviewAction).toBeUndefined();
    }
  });

  it('detects a violation when a mandatory declaration is absent', async () => {
    const { auth } = await signIn();

    // The rotation's second scenario is the one with missing declarations.
    const first = await newInspection(auth);
    await withImage(auth, first.id).expect(201);
    await request(app)
      .post(`/api/inspections/${first.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const second = await newInspection(auth);
    await withImage(auth, second.id).expect(201);
    const response = await request(app)
      .post(`/api/inspections/${second.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    expect(response.body.data.complianceResult.status).toBe('VIOLATION_DETECTED');
    expect(response.body.data.complianceResult.violations.length).toBeGreaterThan(0);
  });

  it('serialises every field of each violation and check', async () => {
    const { auth } = await signIn();

    // Drive the rotation to the scenario that produces violations.
    const first = await newInspection(auth);
    await withImage(auth, first.id).expect(201);
    await request(app)
      .post(`/api/inspections/${first.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const second = await newInspection(auth);
    await withImage(auth, second.id).expect(201);
    const response = await request(app)
      .post(`/api/inspections/${second.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const { violations, checks } = response.body.data.complianceResult;

    // Regression: these are Mongoose subdocuments, and spreading one yields
    // internal state rather than the schema paths — which silently produced
    // violations with no title, rule reference or severity.
    for (const violation of violations) {
      expect(violation.title).toBeTruthy();
      expect(violation.ruleReference).toBeTruthy();
      expect(violation.severity).toBeTruthy();
      expect(violation.description).toBeTruthy();
      expect(violation.recommendation).toBeTruthy();
      expect(violation.code).toBeTruthy();
    }

    for (const check of checks) {
      expect(check.title).toBeTruthy();
      expect(check.ruleReference).toBeTruthy();
      expect(check.message).toBeTruthy();
      expect(Array.isArray(check.relatedFieldNames)).toBe(true);
    }
  });
});

/* ── Review ───────────────────────────────────────────────────────────────── */

describe('POST /api/inspections/:id/review', () => {
  async function analysed(auth: string) {
    const inspection = await newInspection(auth);
    await withImage(auth, inspection.id).expect(201);
    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);
    return response.body.data;
  }

  it('records an accepted value without overwriting the AI reading', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);
    const field = inspection.extractedFields.find((f: { aiValue: string | null }) => f.aiValue);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({ fieldName: field.name, action: 'ACCEPTED' })
      .expect(200);

    const reviewed = response.body.data.extractedFields.find(
      (f: { name: string }) => f.name === field.name,
    );

    expect(reviewed.reviewAction).toBe('ACCEPTED');
    expect(reviewed.aiValue).toBe(field.aiValue);
    expect(reviewed.humanVerifiedValue).toBe(field.aiValue);
    expect(reviewed.humanVerifiedAt).toBeTruthy();
  });

  it('keeps the AI value intact when the inspector edits a field', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);
    const field = inspection.extractedFields.find((f: { aiValue: string | null }) => f.aiValue);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({
        fieldName: field.name,
        action: 'EDITED',
        value: 'Corrected by inspector',
        comment: 'Print was smudged',
      })
      .expect(200);

    const reviewed = response.body.data.extractedFields.find(
      (f: { name: string }) => f.name === field.name,
    );

    // The whole point: both values survive.
    expect(reviewed.aiValue).toBe(field.aiValue);
    expect(reviewed.humanVerifiedValue).toBe('Corrected by inspector');
    expect(reviewed.reviewAction).toBe('EDITED');
    expect(reviewed.reviewComment).toBe('Print was smudged');
  });

  it('requires a value when the action is EDITED', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);
    const field = inspection.extractedFields[0];

    await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({ fieldName: field.name, action: 'EDITED' })
      .expect(422);
  });

  it('marks a field unavailable', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);
    const field = inspection.extractedFields[0];

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({ fieldName: field.name, action: 'MARKED_UNAVAILABLE' })
      .expect(200);

    const reviewed = response.body.data.extractedFields.find(
      (f: { name: string }) => f.name === field.name,
    );
    expect(reviewed.reviewAction).toBe('MARKED_UNAVAILABLE');
    expect(reviewed.humanVerifiedValue).toBeNull();
  });

  it('accepts a batch of decisions', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);
    const names = inspection.extractedFields
      .slice(0, 2)
      .map((f: { name: string }) => f.name);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({ reviews: names.map((name: string) => ({ fieldName: name, action: 'ACCEPTED' })) })
      .expect(200);

    expect(response.body.data.review.completedFieldCount).toBeGreaterThanOrEqual(2);
  });

  it('404s for a field that is not on the inspection', async () => {
    const { auth } = await signIn();
    const inspection = await analysed(auth);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/review`)
      .set('Authorization', auth)
      .send({ fieldName: 'not_a_real_field', action: 'ACCEPTED' })
      .expect(404);

    expect(response.body.errorCode).toBe('FIELD_NOT_FOUND');
  });
});

/* ── Finalize and report ──────────────────────────────────────────────────── */

describe('finalize and report', () => {
  it('refuses to finalize before analysis', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);

    const response = await request(app)
      .post(`/api/inspections/${inspection.id}/finalize`)
      .set('Authorization', auth)
      .send({})
      .expect(400);

    expect(response.body.errorCode).toBe('ANALYSIS_REQUIRED');
  });

  it('finalizes an analysed inspection and then locks it', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);
    await withImage(auth, inspection.id).expect(201);
    await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const finalized = await request(app)
      .post(`/api/inspections/${inspection.id}/finalize`)
      .set('Authorization', auth)
      .send({ finalNotes: 'Notice issued on site.' })
      .expect(200);

    expect(finalized.body.data.status).toBe('FINALIZED');
    expect(finalized.body.data.finalizedAt).toBeTruthy();
    expect(finalized.body.data.finalNotes).toBe('Notice issued on site.');

    // A filed enforcement record must not be editable afterwards.
    const edit = await request(app)
      .patch(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .send({ notes: 'Trying to change history' })
      .expect(409);
    expect(edit.body.errorCode).toBe('INSPECTION_FINALIZED');

    await request(app)
      .post(`/api/inspections/${inspection.id}/finalize`)
      .set('Authorization', auth)
      .send({})
      .expect(409);
  });

  it('returns a structured report', async () => {
    const { auth } = await signIn();
    const inspection = await newInspection(auth);
    await withImage(auth, inspection.id).expect(201);
    await request(app)
      .post(`/api/inspections/${inspection.id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const response = await request(app)
      .get(`/api/inspections/${inspection.id}/report`)
      .set('Authorization', auth)
      .expect(200);

    const report = response.body.data;
    expect(report.inspectionId).toBe(inspection.inspectionId);
    expect(report).toHaveProperty('inspector');
    expect(report).toHaveProperty('business');
    expect(report).toHaveProperty('product');
    expect(report).toHaveProperty('images');
    expect(report).toHaveProperty('extractedFields');
    expect(report).toHaveProperty('complianceResult');
    expect(report).toHaveProperty('review');
  });
});
