import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { seedRules } from '../src/seed/seedRules';

import { app, signIn, type Signed } from './helpers';

/**
 * The rule repository.
 *
 * The behaviour worth protecting here is the versioning contract: amending a
 * rule must never destroy the text it replaces. An inspection carried out under
 * the old wording has to remain defensible, and that is only true if the old
 * wording still exists.
 */

describe('GET /api/rules', () => {
  let supervisor: Signed;

  beforeEach(async () => {
    supervisor = await signIn({ role: 'SUPERVISOR' });
    await seedRules();
  });

  it('lists the seeded catalogue', async () => {
    const response = await request(app)
      .get('/api/rules')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.total).toBeGreaterThan(0);
    expect(response.body.data.items[0]).toHaveProperty('ruleId');
    expect(response.body.data.items[0]).toHaveProperty('requirement');
    expect(response.body.data.items[0]).toHaveProperty('ruleReference');
  });

  it('is readable by an inspector — they are entitled to see the provision', async () => {
    const inspector = await signIn();

    const response = await request(app)
      .get('/api/rules')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(response.body.data.total).toBeGreaterThan(0);
  });

  it('retrieves by human reference as well as by id', async () => {
    const list = await request(app)
      .get('/api/rules')
      .set('Authorization', supervisor.auth)
      .expect(200);

    const rule = list.body.data.items[0];

    const byId = await request(app)
      .get(`/api/rules/${rule.id as string}`)
      .set('Authorization', supervisor.auth)
      .expect(200);

    const byReference = await request(app)
      .get(`/api/rules/${rule.ruleId as string}`)
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(byId.body.data.ruleId).toBe(byReference.body.data.ruleId);
  });

  it('filters by search term', async () => {
    const response = await request(app)
      .get('/api/rules?search=net%20quantity')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.total).toBeGreaterThan(0);
  });

  it('404s for an unknown rule', async () => {
    await request(app)
      .get('/api/rules/LM-PKG-DOES-NOT-EXIST')
      .set('Authorization', supervisor.auth)
      .expect(404);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app).get('/api/rules').expect(401);
  });
});

describe('rule authoring', () => {
  let admin: Signed;

  beforeEach(async () => {
    admin = await signIn({ role: 'ADMIN' });
  });

  const payload = {
    ruleId: 'LM-TEST-001',
    category: 'Mandatory Declarations',
    field: 'test_field',
    fieldLabel: 'Test Declaration',
    title: 'Test Declaration — Rule 9(9)',
    requirement: 'The package must carry a test declaration.',
    validationType: 'PRESENCE',
    ruleReference: 'Rule 9(9)',
    severity: 'MAJOR',
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z').toISOString(),
  };

  it('lets an administrator create a rule', async () => {
    const response = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    expect(response.body.data.ruleId).toBe('LM-TEST-001');
    expect(response.body.data.version).toBe(1);
    expect(response.body.data.history).toHaveLength(0);
  });

  it('refuses a duplicate identifier', async () => {
    await request(app).post('/api/rules').set('Authorization', admin.auth).send(payload).expect(201);

    const response = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(409);

    expect(response.body.errorCode).toBe('RULE_EXISTS');
  });

  it('refuses creation by a supervisor', async () => {
    const supervisor = await signIn({ role: 'SUPERVISOR' });

    await request(app)
      .post('/api/rules')
      .set('Authorization', supervisor.auth)
      .send(payload)
      .expect(403);
  });

  it('validates the requirement text', async () => {
    const response = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send({ ...payload, requirement: 'no' })
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('retains the outgoing text when the requirement is amended', async () => {
    const created = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    const response = await request(app)
      .patch(`/api/rules/${created.body.data.id as string}`)
      .set('Authorization', admin.auth)
      .send({
        requirement: 'The package must carry a test declaration in 3mm type.',
        changeNote: 'Amended by notification of March 2026.',
      })
      .expect(200);

    const rule = response.body.data;

    expect(rule.version).toBe(2);
    expect(rule.requirement).toContain('3mm');

    // The superseded wording survives, with the window it applied to.
    expect(rule.history).toHaveLength(1);
    expect(rule.history[0].version).toBe(1);
    expect(rule.history[0].requirement).toBe(payload.requirement);
    expect(rule.history[0].effectiveTo).toBeTruthy();
    expect(rule.history[0].changeNote).toContain('notification');
  });

  it('does not mint a version for a metadata-only edit', async () => {
    const created = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    const response = await request(app)
      .patch(`/api/rules/${created.body.data.id as string}`)
      .set('Authorization', admin.auth)
      .send({ title: 'A clearer title' })
      .expect(200);

    expect(response.body.data.version).toBe(1);
    expect(response.body.data.history).toHaveLength(0);
    expect(response.body.data.title).toBe('A clearer title');
  });

  it('refuses an amendment by a supervisor', async () => {
    const created = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    const supervisor = await signIn({ role: 'SUPERVISOR' });

    await request(app)
      .patch(`/api/rules/${created.body.data.id as string}`)
      .set('Authorization', supervisor.auth)
      .send({ requirement: 'Something entirely different from before.' })
      .expect(403);
  });

  it('retires a rule without deleting it', async () => {
    const created = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    const retired = await request(app)
      .post(`/api/rules/${created.body.data.id as string}/status`)
      .set('Authorization', admin.auth)
      .send({ status: 'RETIRED' })
      .expect(200);

    expect(retired.body.data.status).toBe('RETIRED');
    expect(retired.body.data.effectiveTo).toBeTruthy();

    // A rule that produced findings has to stay readable.
    await request(app)
      .get(`/api/rules/${created.body.data.id as string}`)
      .set('Authorization', admin.auth)
      .expect(200);
  });

  it('refuses an empty patch', async () => {
    const created = await request(app)
      .post('/api/rules')
      .set('Authorization', admin.auth)
      .send(payload)
      .expect(201);

    await request(app)
      .patch(`/api/rules/${created.body.data.id as string}`)
      .set('Authorization', admin.auth)
      .send({})
      .expect(422);
  });
});

describe('seeded rule catalogue', () => {
  it('grades a missing price as more serious than a missing commodity name', async () => {
    const admin = await signIn({ role: 'ADMIN' });
    await seedRules();

    const response = await request(app)
      .get('/api/rules?pageSize=200')
      .set('Authorization', admin.auth)
      .expect(200);

    const rules = response.body.data.items as Array<{ field: string; severity: string }>;

    const mrp = rules.find((rule) => rule.field === 'mrp');
    const commodityName = rules.find((rule) => rule.field === 'commodity_name');

    expect(mrp?.severity).toBe('CRITICAL');
    expect(commodityName?.severity).toBe('MINOR');
  });

  it('is idempotent — reseeding does not duplicate the catalogue', async () => {
    const admin = await signIn({ role: 'ADMIN' });

    await seedRules();
    const first = await request(app)
      .get('/api/rules?pageSize=200')
      .set('Authorization', admin.auth)
      .expect(200);

    await seedRules();
    const second = await request(app)
      .get('/api/rules?pageSize=200')
      .set('Authorization', admin.auth)
      .expect(200);

    expect(second.body.data.total).toBe(first.body.data.total);
  });
});
