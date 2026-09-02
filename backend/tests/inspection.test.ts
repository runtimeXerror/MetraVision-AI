import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { app, inspectionPayload, signIn } from './helpers';

/** Creates an inspection and returns its DTO. */
async function createInspection(auth: string, overrides: Record<string, unknown> = {}) {
  const response = await request(app)
    .post('/api/inspections')
    .set('Authorization', auth)
    .send(inspectionPayload(overrides))
    .expect(201);

  return response.body.data;
}

describe('POST /api/inspections', () => {
  it('creates an inspection with a generated reference', async () => {
    const { auth, user } = await signIn();

    const response = await request(app)
      .post('/api/inspections')
      .set('Authorization', auth)
      .send(inspectionPayload())
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.inspectionId).toMatch(/^INS-\d{4}-\d{5}$/);
    expect(response.body.data.status).toBe('DRAFT');
    expect(response.body.data.business.name).toBe('ABC Store');
    expect(response.body.data.inspector.id).toBe(user.id);
  });

  it('mints a distinct reference for each inspection', async () => {
    const { auth } = await signIn();

    const first = await createInspection(auth);
    const second = await createInspection(auth);

    expect(first.inspectionId).not.toBe(second.inspectionId);
  });

  it('rejects a request with no business name', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .post('/api/inspections')
      .set('Authorization', auth)
      .send({ location: { address: 'Somewhere' } })
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('rejects an unauthenticated request', async () => {
    await request(app).post('/api/inspections').send(inspectionPayload()).expect(401);
  });
});

describe('GET /api/inspections', () => {
  it('returns only the caller’s own inspections', async () => {
    const alice = await signIn({ email: 'alice@legalmetrology.gov.in' });
    const bob = await signIn({ email: 'bob@legalmetrology.gov.in' });

    await createInspection(alice.auth, { business: { name: 'Alice Store' } });
    await createInspection(bob.auth, { business: { name: 'Bob Store' } });

    const response = await request(app)
      .get('/api/inspections')
      .set('Authorization', alice.auth)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].business.name).toBe('Alice Store');
  });

  it('lets a supervisor see every inspection', async () => {
    const inspector = await signIn({ email: 'field@legalmetrology.gov.in' });
    const supervisor = await signIn({
      email: 'super@legalmetrology.gov.in',
      role: 'SUPERVISOR',
      inspectorId: 'LM-SUP-7001',
    });

    await createInspection(inspector.auth);

    const response = await request(app)
      .get('/api/inspections')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(response.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it('paginates', async () => {
    const { auth } = await signIn();

    for (let index = 0; index < 3; index += 1) {
      await createInspection(auth, { business: { name: `Store ${index}` } });
    }

    const response = await request(app)
      .get('/api/inspections?page=1&pageSize=2')
      .set('Authorization', auth)
      .expect(200);

    expect(response.body.data.items).toHaveLength(2);
    expect(response.body.data.total).toBe(3);
    expect(response.body.data.totalPages).toBe(2);
  });

  it('filters by search term', async () => {
    const { auth } = await signIn();

    await createInspection(auth, { business: { name: 'Unique Grocers' } });
    await createInspection(auth, { business: { name: 'Other Shop' } });

    const response = await request(app)
      .get('/api/inspections?search=Unique')
      .set('Authorization', auth)
      .expect(200);

    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].business.name).toBe('Unique Grocers');
  });

  it('filters by status', async () => {
    const { auth } = await signIn();
    await createInspection(auth);

    const drafts = await request(app)
      .get('/api/inspections?status=DRAFT')
      .set('Authorization', auth)
      .expect(200);
    expect(drafts.body.data.items).toHaveLength(1);

    const finalized = await request(app)
      .get('/api/inspections?status=FINALIZED')
      .set('Authorization', auth)
      .expect(200);
    expect(finalized.body.data.items).toHaveLength(0);
  });

  it('rejects an out-of-range page size', async () => {
    const { auth } = await signIn();

    await request(app)
      .get('/api/inspections?pageSize=5000')
      .set('Authorization', auth)
      .expect(422);
  });
});

describe('GET /api/inspections/:id', () => {
  it('retrieves by Mongo id and by human reference', async () => {
    const { auth } = await signIn();
    const inspection = await createInspection(auth);

    const byId = await request(app)
      .get(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .expect(200);
    expect(byId.body.data.inspectionId).toBe(inspection.inspectionId);

    const byReference = await request(app)
      .get(`/api/inspections/${inspection.inspectionId}`)
      .set('Authorization', auth)
      .expect(200);
    expect(byReference.body.data.id).toBe(inspection.id);
  });

  it('hides another inspector’s inspection', async () => {
    const alice = await signIn({ email: 'a@legalmetrology.gov.in' });
    const bob = await signIn({ email: 'b@legalmetrology.gov.in' });

    const inspection = await createInspection(alice.auth);

    // A 404 rather than a 403 — confirming existence would leak the record.
    const response = await request(app)
      .get(`/api/inspections/${inspection.id}`)
      .set('Authorization', bob.auth)
      .expect(404);

    expect(response.body.errorCode).toBe('INSPECTION_NOT_FOUND');
  });

  it('404s for an unknown id', async () => {
    const { auth } = await signIn();

    await request(app)
      .get('/api/inspections/507f1f77bcf86cd799439011')
      .set('Authorization', auth)
      .expect(404);
  });
});

describe('PATCH /api/inspections/:id', () => {
  it('updates mutable fields', async () => {
    const { auth } = await signIn();
    const inspection = await createInspection(auth);

    const response = await request(app)
      .patch(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .send({ notes: 'Updated on site', productName: 'Wheat flour 5 kg' })
      .expect(200);

    expect(response.body.data.notes).toBe('Updated on site');
    expect(response.body.data.productName).toBe('Wheat flour 5 kg');
  });

  it('refuses an empty patch', async () => {
    const { auth } = await signIn();
    const inspection = await createInspection(auth);

    await request(app)
      .patch(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .send({})
      .expect(422);
  });

  it('will not let another inspector edit the record', async () => {
    const alice = await signIn({ email: 'aa@legalmetrology.gov.in' });
    const bob = await signIn({ email: 'bb@legalmetrology.gov.in' });

    const inspection = await createInspection(alice.auth);

    await request(app)
      .patch(`/api/inspections/${inspection.id}`)
      .set('Authorization', bob.auth)
      .send({ notes: 'Tampering' })
      .expect(404);
  });
});

describe('DELETE /api/inspections/:id', () => {
  it('deletes a draft the caller owns', async () => {
    const { auth } = await signIn();
    const inspection = await createInspection(auth);

    await request(app)
      .delete(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .expect(200);

    await request(app)
      .get(`/api/inspections/${inspection.id}`)
      .set('Authorization', auth)
      .expect(404);
  });
});

describe('GET /api/inspections/stats', () => {
  it('aggregates the caller’s records', async () => {
    const { auth } = await signIn();
    await createInspection(auth);
    await createInspection(auth);

    const response = await request(app)
      .get('/api/inspections/stats')
      .set('Authorization', auth)
      .expect(200);

    expect(response.body.data.totalInspections).toBe(2);
    expect(response.body.data).toHaveProperty('compliant');
    expect(response.body.data).toHaveProperty('violations');
  });
});
