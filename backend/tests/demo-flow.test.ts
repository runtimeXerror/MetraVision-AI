import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inspection } from '../src/models/Inspection';
import { User } from '../src/models/User';
import { resetScenarioRotation } from '../src/services/analysisService';
import { seedDatabase } from '../src/seed/seed';

import { PNG_BYTES, app } from './helpers';

/**
 * The Phase 2 acceptance test.
 *
 * Walks the entire demo chain against the real Express app and a real MongoDB:
 *
 *   login → home → create → upload → analyze → extracted fields
 *         → compliance result → review → finalize → report → history → detail
 *
 * Everything else in the suite tests one endpoint's behaviour; this asserts the
 * journey holds together, which is the thing a demo actually exercises.
 */

beforeEach(() => {
  resetScenarioRotation();
});

describe('Phase 2 end-to-end demo flow', () => {
  it('carries an inspection from sign-in to a filed report', async () => {
    /* ── Seed ────────────────────────────────────────────────────────────── */
    const seeded = await seedDatabase({ reset: true });
    expect(seeded.users).toBe(5);
    expect(seeded.inspections).toBeGreaterThanOrEqual(20);

    const roles = await User.find().distinct('role');
    expect(roles.sort()).toEqual(['ADMIN', 'INSPECTOR', 'SUPERVISOR']);

    /* ── 1. Login ────────────────────────────────────────────────────────── */
    const login = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'LM-INS-4471', password: 'Inspector@123' })
      .expect(200);

    const auth = `Bearer ${login.body.data.accessToken}`;
    expect(login.body.data.user.name).toBe('Ravi Sharma');
    expect(login.body.data.refreshToken).toBeTruthy();

    /* ── 2. Home: stats and recent records ───────────────────────────────── */
    const stats = await request(app)
      .get('/api/inspections/stats')
      .set('Authorization', auth)
      .expect(200);

    expect(stats.body.data.totalInspections).toBeGreaterThan(0);

    const home = await request(app)
      .get('/api/inspections?pageSize=5')
      .set('Authorization', auth)
      .expect(200);

    // An inspector sees only their own records, not all 22 seeded.
    expect(home.body.data.items.length).toBeLessThanOrEqual(5);
    expect(home.body.data.total).toBeLessThan(seeded.inspections);

    /* ── 3. Create ───────────────────────────────────────────────────────── */
    const created = await request(app)
      .post('/api/inspections')
      .set('Authorization', auth)
      .send({
        business: { name: 'ABC Store' },
        location: { address: 'Demo Location' },
        productCategory: 'packaged_food',
        notes: 'Initial inspection',
      })
      .expect(201);

    const id = created.body.data.id as string;
    const reference = created.body.data.inspectionId as string;

    expect(reference).toMatch(/^INS-\d{4}-\d{5}$/);
    expect(created.body.data.status).toBe('DRAFT');

    /* ── 4. Upload images ────────────────────────────────────────────────── */
    for (const type of ['FRONT', 'BACK'] as const) {
      await request(app)
        .post(`/api/inspections/${id}/images`)
        .set('Authorization', auth)
        .field('type', type)
        .attach('image', PNG_BYTES, 'label.png')
        .expect(201);
    }

    const images = await request(app)
      .get(`/api/inspections/${id}/images`)
      .set('Authorization', auth)
      .expect(200);

    expect(images.body.data).toHaveLength(2);
    expect(images.body.data[0].url).toContain('/uploads/');

    /* ── 5. Analyze ──────────────────────────────────────────────────────── */
    const analysed = await request(app)
      .post(`/api/inspections/${id}/analyze`)
      .set('Authorization', auth)
      .send({})
      .expect(200);

    const analysis = analysed.body.data.aiAnalysis;
    const compliance = analysed.body.data.complianceResult;

    expect(analysis.engine).toBe('MOCK');
    expect(analysis.bboxSpace).toEqual({ width: 800, height: 1000 });
    expect(analysed.body.data.extractedFields.length).toBeGreaterThan(0);

    /* ── 6. Extracted fields carry evidence ──────────────────────────────── */
    const withValue = analysed.body.data.extractedFields.filter(
      (field: { aiValue: string | null }) => field.aiValue !== null,
    );
    expect(withValue.length).toBeGreaterThan(0);

    for (const field of withValue) {
      expect(field.bbox).toHaveLength(4);
      expect(field.sourceImageId).toBeTruthy();
      expect(field.confidence).toBeGreaterThan(0);
    }

    /* ── 7. Compliance result is fully populated ─────────────────────────── */
    expect(['COMPLIANT', 'VIOLATION_DETECTED', 'REVIEW_REQUIRED']).toContain(compliance.status);
    expect(compliance.ruleSetLabel).toBeTruthy();
    expect(compliance.checks.length).toBeGreaterThan(0);

    for (const check of compliance.checks) {
      expect(check.title).toBeTruthy();
      expect(check.ruleReference).toBeTruthy();
    }

    /* ── 8. Review — AI and human values stay separate ───────────────────── */
    const target = withValue[0];

    const reviewed = await request(app)
      .post(`/api/inspections/${id}/review`)
      .set('Authorization', auth)
      .send({
        fieldName: target.name,
        action: 'EDITED',
        value: 'Inspector corrected value',
        comment: 'Print was smudged on the pack',
      })
      .expect(200);

    const reviewedField = reviewed.body.data.extractedFields.find(
      (field: { name: string }) => field.name === target.name,
    );

    // The whole point of the review model: both readings survive.
    expect(reviewedField.aiValue).toBe(target.aiValue);
    expect(reviewedField.humanVerifiedValue).toBe('Inspector corrected value');
    expect(reviewedField.reviewAction).toBe('EDITED');
    expect(reviewedField.humanVerifiedBy).toBeTruthy();
    expect(reviewedField.humanVerifiedAt).toBeTruthy();

    /* ── 9. Finalize ─────────────────────────────────────────────────────── */
    const finalized = await request(app)
      .post(`/api/inspections/${id}/finalize`)
      .set('Authorization', auth)
      .send({ finalNotes: 'Notice issued on site.' })
      .expect(200);

    expect(finalized.body.data.status).toBe('FINALIZED');
    expect(finalized.body.data.finalizedAt).toBeTruthy();

    // A filed enforcement record is immutable.
    await request(app)
      .patch(`/api/inspections/${id}`)
      .set('Authorization', auth)
      .send({ notes: 'tamper' })
      .expect(409);

    /* ── 10. Report ──────────────────────────────────────────────────────── */
    const report = await request(app)
      .get(`/api/inspections/${id}/report`)
      .set('Authorization', auth)
      .expect(200);

    expect(report.body.data.inspectionId).toBe(reference);
    expect(report.body.data.notes).toContain('Notice issued on site.');
    expect(report.body.data.images).toHaveLength(2);
    expect(report.body.data.complianceResult).toBeTruthy();

    /* ── 11. History reflects the new record ─────────────────────────────── */
    const history = await request(app)
      .get(`/api/inspections?search=${encodeURIComponent(reference)}`)
      .set('Authorization', auth)
      .expect(200);

    expect(history.body.data.items).toHaveLength(1);
    expect(history.body.data.items[0].status).toBe('FINALIZED');

    /* ── 12. Detail view ─────────────────────────────────────────────────── */
    const detail = await request(app)
      .get(`/api/inspections/${reference}`)
      .set('Authorization', auth)
      .expect(200);

    expect(detail.body.data.id).toBe(id);
    expect(detail.body.data.business.name).toBe('ABC Store');
    expect(detail.body.data.review.completedFieldCount).toBeGreaterThanOrEqual(1);

    /* ── 13. Persisted, not just echoed ──────────────────────────────────── */
    const stored = await Inspection.findById(id);
    expect(stored?.status).toBe('FINALIZED');
    expect(stored?.extractedFields.length).toBeGreaterThan(0);

    const storedField = stored?.extractedFields.find((field) => field.name === target.name);
    expect(storedField?.aiValue).toBe(target.aiValue);
    expect(storedField?.humanVerifiedValue).toBe('Inspector corrected value');
  }, 60_000);

  it('keeps a supervisor’s view broader than an inspector’s', async () => {
    await seedDatabase({ reset: true });

    const inspector = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'LM-INS-4471', password: 'Inspector@123' })
      .expect(200);

    const supervisor = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'LM-SUP-1204', password: 'Supervisor@123' })
      .expect(200);

    const own = await request(app)
      .get('/api/inspections?pageSize=100')
      .set('Authorization', `Bearer ${inspector.body.data.accessToken}`)
      .expect(200);

    const all = await request(app)
      .get('/api/inspections?pageSize=100')
      .set('Authorization', `Bearer ${supervisor.body.data.accessToken}`)
      .expect(200);

    expect(all.body.data.total).toBeGreaterThan(own.body.data.total);
  }, 60_000);
});
