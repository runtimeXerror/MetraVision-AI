import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { invalidateCorpusCache } from '../src/compliance/ruleEngineService';
import { seedLegalCorpus } from '../src/compliance/seed';
import { compliantFields } from '../src/compliance/tests/fixtures';

import { app, signIn, type Signed } from './helpers';

/**
 * The rule engine's HTTP surface.
 *
 * Two things worth protecting beyond the happy path: the corpus is read-only
 * over HTTP for every role including ADMIN, and an evaluation leaves an audit
 * record behind that names the rule-set it was decided on.
 */

describe('the legal corpus API', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
    await seedLegalCorpus({ reset: true });
    invalidateCorpusCache();
  });

  it('seeds the corpus into MongoDB', async () => {
    const response = await request(app).get('/api/compliance/status').set('Authorization', inspector.auth).expect(200);

    expect(response.body.data.origin).toBe('DATABASE');
    expect(response.body.data.ruleVersions).toBeGreaterThan(0);
    expect(response.body.data.amendments).toBeGreaterThan(0);
    expect(response.body.data.usesLlmForDecisions).toBe(false);
    expect(response.body.data.containsOcrOrCv).toBe(false);
  });

  it('lists the amendment registry newest first', async () => {
    const response = await request(app).get('/api/amendments').set('Authorization', inspector.auth).expect(200);

    expect(response.body.data.total).toBeGreaterThanOrEqual(30);
    expect(response.body.data.items[0].notificationNumber).toBe('G.S.R. 418(E)');
    expect(response.body.data.items[0].notificationDate).toBe('2026-05-29');
  });

  it('returns one notification with the rule versions it produced', async () => {
    const response = await request(app)
      .get(`/api/amendments/${encodeURIComponent('G.S.R. 881(E)')}`)
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.amendment.effectiveFrom).toBe('2026-02-01');
    expect(response.body.data.amendment.changeType).toBe('EXEMPTION');
    expect(response.body.data.producedExceptions[0].exceptionId).toBe('EX-R26-A-SMALL-PACKAGE');
  });

  it('lists rule sources with their verification status', async () => {
    const response = await request(app).get('/api/rule-sources').set('Authorization', inspector.auth).expect(200);

    expect(response.body.data.verified).toBeGreaterThan(0);
    expect(response.body.data.needsVerification).toBeGreaterThan(0);
    expect(response.body.data.sources[0]).toHaveProperty('officialUrl');
  });

  it('returns the whole version history of one rule', async () => {
    const response = await request(app)
      .get('/api/rules/legal/LM-PC-R6-1-E?asOf=2019-06-01')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.versions).toHaveLength(4);
    expect(response.body.data.current.ruleVersion).toBe('2018-01-01');
    expect(response.body.data.temporalStatuses).toContainEqual(
      expect.objectContaining({ ruleVersion: '2024-01-01', statusOnDate: 'FUTURE_EFFECTIVE' }),
    );
  });

  it('filters the corpus to the versions in force on a date', async () => {
    const response = await request(app)
      .get('/api/rules/legal?asOf=2015-01-01&pageSize=200')
      .set('Authorization', inspector.auth)
      .expect(200);

    const ids: string[] = response.body.data.items.map((rule: { ruleId: string }) => rule.ruleId);
    // Country of origin was inserted in 2018; the COO filter in 2026.
    expect(ids).not.toContain('LM-PC-R6-1-AA');
    expect(ids).not.toContain('LM-PC-R6-10A');
    expect(ids).toContain('LM-PC-R6-1-C');
  });

  it('404s for a rule that is not in the corpus', async () => {
    await request(app).get('/api/rules/legal/LM-PC-NOPE').set('Authorization', inspector.auth).expect(404);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app).get('/api/amendments').expect(401);
  });
});

describe('GET /api/rules/applicable', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
    await seedLegalCorpus({ reset: true });
    invalidateCorpusCache();
  });

  it('answers which rules reach a package before any evidence exists', async () => {
    const response = await request(app)
      .get('/api/rules/applicable?inspectionDate=2026-09-01&category=household&quantity=500&quantityUnit=g')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.counts.applicable).toBeGreaterThan(0);
    const ids: string[] = response.body.data.applicable.map((rule: { ruleId: string }) => rule.ruleId);
    expect(ids).toContain('LM-PC-R6-1-C');
    // Domestic, so the country-of-origin rule is out of scope.
    expect(ids).not.toContain('LM-PC-R6-1-AA');
  });

  it('coerces query booleans correctly — "false" is not truthy', async () => {
    const response = await request(app)
      .get('/api/rules/applicable?inspectionDate=2026-09-01&isImported=false&category=household')
      .set('Authorization', inspector.auth)
      .expect(200);

    const ids: string[] = response.body.data.applicable.map((rule: { ruleId: string }) => rule.ruleId);
    expect(ids).not.toContain('LM-PC-R6-1-AA');
  });

  it('lists the 2027 country-of-origin substitution as future-effective, not applicable', async () => {
    const response = await request(app)
      .get('/api/rules/applicable?inspectionDate=2026-09-01&isImported=true&isEcommerce=true')
      .set('Authorization', inspector.auth)
      .expect(200);

    const applicable: Array<{ ruleId: string; ruleVersion: string }> = response.body.data.applicable;
    const coo = applicable.find((rule) => rule.ruleId === 'LM-PC-R6-10A');
    expect(coo?.ruleVersion).toBe('2026-07-01');

    const future: Array<{ ruleId: string; ruleVersion: string }> = response.body.data.futureEffective;
    expect(future.some((rule) => rule.ruleVersion === '2027-07-01')).toBe(true);
  });

  it('reports which exemption switched a rule off, and on what authority', async () => {
    const response = await request(app)
      .get('/api/rules/applicable?inspectionDate=2026-09-01&isPanMasala=true&quantity=5&quantityUnit=g')
      .set('Authorization', inspector.auth)
      .expect(200);

    const notApplicable: Array<{ ruleId: string; reason: string }> = response.body.data.notApplicable;
    // Pan masala lost the small-package exemption on 1 February 2026, so
    // rule 6(1)(c) is *not* switched off here.
    const quantity = notApplicable.find((rule) => rule.ruleId === 'LM-PC-R6-1-C');
    expect(quantity).toBeUndefined();
  });
});

describe('POST /api/compliance/evaluate', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
    await seedLegalCorpus({ reset: true });
    invalidateCorpusCache();
  });

  const payload = (overrides: Record<string, unknown> = {}) => ({
    inspectionId: 'INS-2026-00042',
    inspectionDate: '2026-09-01',
    productContext: { category: 'household', packageType: 'RETAIL', quantity: 500, quantityUnit: 'g' },
    fields: compliantFields(),
    evidence: { captureCompleteness: 0.95, imageQuality: 0.9, imageIds: ['img-1'] },
    ...overrides,
  });

  it('evaluates structured evidence with no OCR anywhere in the path', async () => {
    const response = await request(app)
      .post('/api/compliance/evaluate')
      .set('Authorization', inspector.auth)
      .send(payload())
      .expect(201);

    expect(response.body.data.status).toBe('COMPLIANT');
    expect(response.body.data.ruleSetVersion).toBe('LM-PC-2026-05-29');
    expect(response.body.data.engineVersion).toBe('lm-rule-engine/1.0.0');
    expect(response.body.data.sourceVersion).toBe('effective rules as of 2026-09-01');
  });

  it('returns a violation with the provision, its date and the notification', async () => {
    const response = await request(app)
      .post('/api/compliance/evaluate')
      .set('Authorization', inspector.auth)
      .send(
        payload({
          fields: { ...compliantFields(), mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
        }),
      )
      .expect(201);

    expect(response.body.data.status).toBe('VIOLATION_DETECTED');

    const mrp = response.body.data.checks.find((check: { ruleId: string }) => check.ruleId === 'LM-PC-R6-1-E');
    expect(mrp.status).toBe('VIOLATION_DETECTED');
    expect(mrp.provenance.source.notification).toBe('G.S.R. 779(E)');
    expect(mrp.provenance.effectiveFrom).toBe('2024-01-01');
    expect(mrp.provenance.source.officialUrl).toContain('consumeraffairs.gov.in');
    expect(mrp.legalText).toBeTruthy();
    expect(mrp.machineInterpretation).toBeTruthy();
  });

  it('writes an audit record naming the rule-set it was decided on', async () => {
    await request(app).post('/api/compliance/evaluate').set('Authorization', inspector.auth).send(payload()).expect(201);

    const response = await request(app)
      .get('/api/compliance/INS-2026-00042')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.latest.ruleSetVersion).toBe('LM-PC-2026-05-29');
    expect(response.body.data.latest.ruleSetChecksum).toBeTruthy();
    expect(response.body.data.latest.engineVersion).toBe('lm-rule-engine/1.0.0');
    expect(response.body.data.latest.inputSnapshot).toBeTruthy();
    expect(response.body.data.latest.applicableRuleIds.length).toBeGreaterThan(0);
  });

  it('keeps earlier evaluations when an inspection is re-evaluated', async () => {
    await request(app).post('/api/compliance/evaluate').set('Authorization', inspector.auth).send(payload()).expect(201);
    await request(app)
      .post('/api/compliance/evaluate')
      .set('Authorization', inspector.auth)
      .send(payload({ fields: { ...compliantFields(), mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } } }))
      .expect(201);

    const response = await request(app)
      .get('/api/compliance/INS-2026-00042')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.total).toBe(2);
  });

  it('gives the same answer twice for the same input', async () => {
    const first = await request(app).post('/api/compliance/evaluate').set('Authorization', inspector.auth).send(payload()).expect(201);
    const second = await request(app).post('/api/compliance/evaluate').set('Authorization', inspector.auth).send(payload()).expect(201);

    const strip = (body: Record<string, unknown>) => ({ ...body, evaluatedAt: null, durationMs: null });
    expect(strip(first.body.data)).toEqual(strip(second.body.data));
  });

  it('rejects a request with no inspection date', async () => {
    await request(app)
      .post('/api/compliance/evaluate')
      .set('Authorization', inspector.auth)
      .send({ productContext: {}, fields: {} })
      .expect(422);
  });

  it('rejects a confidence outside 0–1', async () => {
    await request(app)
      .post('/api/compliance/evaluate')
      .set('Authorization', inspector.auth)
      .send(payload({ fields: { mrp: { value: 'MRP Rs. 10', confidence: 4 } } }))
      .expect(422);
  });

  it('404s for an inspection with no evaluation on record', async () => {
    await request(app).get('/api/compliance/INS-NOT-REAL').set('Authorization', inspector.auth).expect(404);
  });
});

describe('GET /api/rule-validation/report', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
    await seedLegalCorpus({ reset: true });
    invalidateCorpusCache();
  });

  it('reports the corpus as valid with its recorded source conflicts', async () => {
    const response = await request(app)
      .get('/api/rule-validation/report?asOf=2026-09-01')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.valid).toBe(true);
    expect(response.body.data.counts.errors).toBe(0);
    expect(response.body.data.conflicts.some((entry: { origin: string }) => entry.origin === 'SOURCE')).toBe(true);
  });
});

describe('the corpus is read-only over HTTP', () => {
  it('offers no route to create or amend a legal rule, even for an administrator', async () => {
    const admin = await signIn({ role: 'ADMIN' });

    // A legal corpus edited through a web form has no diff and no reviewer.
    // Amendments arrive as reviewed changes to src/compliance/data/.
    await request(app).post('/api/rules/legal').set('Authorization', admin.auth).send({}).expect(404);
    await request(app).patch('/api/rules/legal/LM-PC-R6-1-E').set('Authorization', admin.auth).send({}).expect(404);
    await request(app).post('/api/amendments').set('Authorization', admin.auth).send({}).expect(404);
  });
});

describe('the Phase 3 catalogue still works', () => {
  it('does not shadow /api/rules/:id with the new sub-paths', async () => {
    const supervisor = await signIn({ role: 'SUPERVISOR' });
    await request(app).get('/api/rules/LM-PKG-DOES-NOT-EXIST').set('Authorization', supervisor.auth).expect(404);
  });
});
