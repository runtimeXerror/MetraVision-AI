import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inspection } from '../src/models';
import { evaluateCompliance } from '../src/services/complianceService';
import { mockProviderFor } from '../src/services/analysisService';

import { app, signIn, type Signed } from './helpers';

/**
 * The read models the web dashboard is built on.
 *
 * These are aggregations rather than stored documents, so the thing worth
 * testing is that they *agree with the records they summarise* — a dashboard
 * whose totals drift from the register is worse than no dashboard.
 */

/** Builds a realistic, analysed inspection so the aggregations have something to count. */
async function seedInspection(options: {
  owner: Signed;
  scenario: 'compliant' | 'violation' | 'unpriced' | 'low_confidence';
  business: string;
  district?: string;
  finalized?: boolean;
  daysAgo?: number;
}) {
  const provider = mockProviderFor(options.scenario);
  const result = await provider.analyse({
    inspectionId: 'test',
    images: [{ imageId: 'img_test', type: 'FRONT', url: '' }],
    categoryHint: 'packaged_food',
  });

  const compliance = evaluateCompliance({ fields: result.fields, category: 'packaged_food' });

  const createdAt = new Date(Date.now() - (options.daysAgo ?? 0) * 86_400_000);

  return Inspection.create({
    inspectionId: `INS-2026-${Math.floor(Math.random() * 90000 + 10000)}`,
    inspector: options.owner.user._id,
    business: { name: options.business },
    location: { address: 'Test Address', district: options.district ?? 'Pune', state: 'Maharashtra' },
    productCategory: 'packaged_food',
    productName: 'Test Commodity 500 g',
    images: [
      {
        imageId: 'img_test',
        type: 'FRONT',
        storageKey: 'seed/img_test.svg',
        url: '/uploads/seed/img_test.svg',
        mimeType: 'image/svg+xml',
        sizeBytes: 2048,
        createdAt,
      },
    ],
    extractedFields: result.fields.map((field) => ({
      name: field.name,
      label: field.label,
      aiValue: field.aiValue,
      confidence: field.confidence,
      bbox: field.bbox,
      sourceImageId: field.sourceImageId,
      required: field.required,
    })),
    complianceResult: compliance,
    status: options.finalized ? 'FINALIZED' : compliance.status,
    finalizedAt: options.finalized ? createdAt : undefined,
    createdAt,
    updatedAt: createdAt,
  });
}

describe('GET /api/analytics/overview', () => {
  let supervisor: Signed;

  beforeEach(async () => {
    supervisor = await signIn({ role: 'SUPERVISOR' });
  });

  it('returns every section the dashboard renders', async () => {
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Alpha Stores' });

    const response = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', supervisor.auth)
      .expect(200);

    const { data } = response.body;
    expect(data).toHaveProperty('summary');
    expect(data).toHaveProperty('trend');
    expect(data).toHaveProperty('distribution');
    expect(data).toHaveProperty('violationsByCategory');
    expect(data).toHaveProperty('violationTypes');
    expect(data).toHaveProperty('inspectorActivity');
    expect(data).toHaveProperty('districts');
  });

  it('counts the records that exist', async () => {
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Alpha Stores' });
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Beta Traders' });

    const response = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.totalInspections).toBe(2);
    expect(response.body.data.compliant).toBe(1);
    expect(response.body.data.violations).toBe(1);
  });

  it('computes the compliance rate over assessed records only', async () => {
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Alpha Stores' });
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Beta Traders' });

    // A draft has no verdict. Counting it against the rate would make the
    // figure fall whenever an inspector opens a form.
    await request(app)
      .post('/api/inspections')
      .set('Authorization', supervisor.auth)
      .send({ business: { name: 'Draft Shop' }, location: { address: 'Nowhere' } })
      .expect(201);

    const response = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.totalInspections).toBe(3);
    expect(response.body.data.drafts).toBe(1);
    // One compliant of two assessed, not of three total.
    expect(response.body.data.complianceRate).toBe(50);
  });

  it('fills in days with no activity so the trend line is not misleading', async () => {
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Alpha Stores' });

    const response = await request(app)
      .get('/api/analytics/trend?days=7')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data).toHaveLength(7);
    expect(response.body.data.every((point: { date: string }) => Boolean(point.date))).toBe(true);
  });

  it('scopes an inspector to their own records', async () => {
    const inspector = await signIn();
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Supervisor Shop' });
    await seedInspection({ owner: inspector, scenario: 'violation', business: 'Inspector Shop' });

    const mine = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(mine.body.data.totalInspections).toBe(1);

    const all = await request(app)
      .get('/api/analytics/summary')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(all.body.data.totalInspections).toBe(2);
  });

  it('will not let an inspector widen the scope by naming another inspector', async () => {
    const inspector = await signIn();
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Supervisor Shop' });

    // The query parameter is ignored for an inspector — the scope comes from
    // the token, never the URL.
    const response = await request(app)
      .get(`/api/analytics/summary?inspectorId=${supervisor.user.id as string}`)
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.totalInspections).toBe(0);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app).get('/api/analytics/overview').expect(401);
  });
});

describe('GET /api/violations', () => {
  let supervisor: Signed;

  beforeEach(async () => {
    supervisor = await signIn({ role: 'SUPERVISOR' });
  });

  it('returns one row per finding, not per inspection', async () => {
    // The violation scenario omits two mandatory declarations.
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Beta Traders' });

    const response = await request(app)
      .get('/api/violations')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.total).toBe(2);
    expect(response.body.data.items).toHaveLength(2);
  });

  it('gives each finding an addressable identifier', async () => {
    const inspection = await seedInspection({
      owner: supervisor,
      scenario: 'violation',
      business: 'Beta Traders',
    });

    const list = await request(app)
      .get('/api/violations')
      .set('Authorization', supervisor.auth)
      .expect(200);

    const first = list.body.data.items[0];
    expect(first.violationId).toContain(inspection.inspectionId);

    const detail = await request(app)
      .get(`/api/violations/${encodeURIComponent(first.violationId as string)}`)
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(detail.body.data.violation.code).toBe(first.code);
    // The inspection travels with it, so the detail page can show the evidence.
    expect(detail.body.data.inspection.inspectionId).toBe(inspection.inspectionId);
  });

  it('marks a finding resolved once its inspection is filed', async () => {
    await seedInspection({
      owner: supervisor,
      scenario: 'violation',
      business: 'Filed Traders',
      finalized: true,
    });

    const response = await request(app)
      .get('/api/violations')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.items[0].status).toBe('RESOLVED');
  });

  it('filters by severity', async () => {
    // The unpriced scenario omits MRP and net quantity, both graded CRITICAL.
    await seedInspection({ owner: supervisor, scenario: 'unpriced', business: 'Unpriced Mart' });
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Beta Traders' });

    const critical = await request(app)
      .get('/api/violations?severity=CRITICAL')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(critical.body.data.total).toBe(2);
    expect(
      critical.body.data.items.every((row: { severity: string }) => row.severity === 'CRITICAL'),
    ).toBe(true);
  });

  it('aggregates stats that agree with the list', async () => {
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Beta Traders' });

    const [stats, list] = await Promise.all([
      request(app).get('/api/violations/stats').set('Authorization', supervisor.auth).expect(200),
      request(app).get('/api/violations').set('Authorization', supervisor.auth).expect(200),
    ]);

    expect(stats.body.data.total).toBe(list.body.data.total);
  });

  it('hides another inspector’s findings', async () => {
    const inspector = await signIn();
    await seedInspection({ owner: supervisor, scenario: 'violation', business: 'Not Yours' });

    const response = await request(app)
      .get('/api/violations')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.total).toBe(0);
  });

  it('rejects a malformed violation reference', async () => {
    const response = await request(app)
      .get('/api/violations/not-a-reference')
      .set('Authorization', supervisor.auth)
      .expect(400);

    expect(response.body.errorCode).toBe('INVALID_VIOLATION_ID');
  });
});

describe('GET /api/products', () => {
  it('rolls inspections up by commodity', async () => {
    const supervisor = await signIn({ role: 'SUPERVISOR' });

    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Shop One' });
    await seedInspection({ owner: supervisor, scenario: 'compliant', business: 'Shop Two' });

    const response = await request(app)
      .get('/api/products')
      .set('Authorization', supervisor.auth)
      .expect(200);

    // Same commodity at two premises is one row carrying both.
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].inspections).toBe(2);
    expect(response.body.data.items[0].businesses).toHaveLength(2);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app).get('/api/products').expect(401);
  });
});
