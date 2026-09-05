import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inspection } from '../src/models';
import { mockProviderFor } from '../src/services/analysisService';
import { evaluateCompliance } from '../src/services/complianceService';

import { app, signIn, type Signed } from './helpers';

/**
 * ── REVIEWING A DECLARATION AFTER THE RECORD WAS FILED ──────────────────────
 *
 * An officer may finalize with declarations still awaiting confirmation; the
 * finalize step offers it, and it is the right default, because a record filed
 * as "pending review" beats an inspection abandoned on a phone when the shop is
 * closing. Until now that was a one-way door: the record was FINALIZED, every
 * write path refused it, and the determination the officer meant to make had
 * nowhere to go.
 *
 * These tests pin the two halves of the way back, and the second matters more
 * than the first:
 *
 *   · an amendment is recorded, with its author and its time;
 *   · and *nothing that was filed changes*. Not the extracted values, not the
 *     verdict, not the status. A filed enforcement record that shifts under a
 *     later edit is not a record of anything, and the whole design rests on
 *     this holding.
 * ────────────────────────────────────────────────────────────────────────────
 */

async function fileInspection(owner: Signed) {
  const provider = mockProviderFor('low_confidence');
  const result = await provider.analyse({
    inspectionId: 'test',
    images: [{ imageId: 'img_test', type: 'FRONT', url: '' }],
    categoryHint: 'cosmetic',
  });

  const compliance = evaluateCompliance({ fields: result.fields, category: 'cosmetic' });

  return Inspection.create({
    inspectionId: `INS-2026-${Math.floor(Math.random() * 90000 + 10000)}`,
    inspector: owner.user._id,
    business: { name: 'Filed Without Review Store' },
    location: { address: 'Test Address', district: 'Pune', state: 'Maharashtra' },
    productCategory: 'cosmetic',
    productName: 'Test Cream 50 g',
    images: [],
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
    // Filed, with nothing reviewed — the case this endpoint exists for.
    status: 'FINALIZED',
    finalizedAt: new Date(),
  });
}

describe('POST /api/inspections/:id/amendments', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
  });

  it('records a determination against a filed inspection', async () => {
    const filed = await fileInspection(inspector);

    const response = await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({ fieldName: 'mrp', action: 'EDITED', value: '₹199.00', comment: 'Read off the carton.' })
      .expect(200);

    const [amendment] = response.body.data.amendments;

    expect(amendment.fieldName).toBe('mrp');
    expect(amendment.action).toBe('EDITED');
    expect(amendment.value).toBe('₹199.00');
    expect(amendment.comment).toBe('Read off the carton.');
    expect(amendment.amendedAt).toBeTruthy();
    // What the record said before the officer came back to it, so the report
    // can print both without re-deriving one of them.
    expect(amendment).toHaveProperty('recordedValue');
    expect(response.body.data.lastAmendedAt).toBeTruthy();
  });

  it('leaves the filed record exactly as it was filed', async () => {
    const filed = await fileInspection(inspector);

    const before = {
      status: filed.status,
      verdict: filed.complianceResult?.status,
      score: filed.complianceResult?.score,
      mrp: filed.extractedFields.find((field) => field.name === 'mrp')?.aiValue,
      reviewAction: filed.extractedFields.find((field) => field.name === 'mrp')?.reviewAction,
    };

    await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({ fieldName: 'mrp', action: 'MARKED_UNAVAILABLE' })
      .expect(200);

    const after = await Inspection.findById(filed.id);

    // This is the assertion the design rests on.
    expect(after!.status).toBe(before.status);
    expect(after!.complianceResult?.status).toBe(before.verdict);
    expect(after!.complianceResult?.score).toBe(before.score);

    const mrp = after!.extractedFields.find((field) => field.name === 'mrp');
    expect(mrp?.aiValue).toBe(before.mrp);
    expect(mrp?.reviewAction).toBe(before.reviewAction);
    expect(mrp?.humanVerifiedValue).toBeUndefined();
  });

  it('appends rather than replacing, so the sequence is readable', async () => {
    const filed = await fileInspection(inspector);

    for (const value of ['₹150.00', '₹199.00']) {
      await request(app)
        .post(`/api/inspections/${filed.id}/amendments`)
        .set('Authorization', inspector.auth)
        .send({ fieldName: 'mrp', action: 'EDITED', value })
        .expect(200);
    }

    const after = await Inspection.findById(filed.id);
    expect(after!.amendments).toHaveLength(2);
    expect(after!.amendments?.[0]?.value).toBe('₹150.00');
    expect(after!.amendments?.[1]?.value).toBe('₹199.00');
  });

  it('takes a batch, so a whole review can be filed in one go', async () => {
    const filed = await fileInspection(inspector);

    const response = await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({
        amendments: [
          { fieldName: 'mrp', action: 'ACCEPTED' },
          { fieldName: 'net_quantity', action: 'EDITED', value: '50 g' },
        ],
      })
      .expect(200);

    expect(response.body.data.amendments).toHaveLength(2);
  });

  it('refuses an inspection that has not been filed', async () => {
    const open = await fileInspection(inspector);
    open.status = 'REVIEW_REQUIRED';
    await open.save();

    const response = await request(app)
      .post(`/api/inspections/${open.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({ fieldName: 'mrp', action: 'ACCEPTED' })
      .expect(409);

    // Not a refusal of the intent — a redirection to the endpoint that edits an
    // open record properly. Two places to record one determination would be the
    // worse outcome.
    expect(response.body.errorCode).toBe('INSPECTION_NOT_FINALIZED');
  });

  it('refuses a declaration that is not on the record', async () => {
    const filed = await fileInspection(inspector);

    const response = await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({ fieldName: 'not_a_declaration', action: 'ACCEPTED' })
      .expect(404);

    expect(response.body.errorCode).toBe('FIELD_NOT_FOUND');
  });

  it('will not let one inspector amend another’s record', async () => {
    const other = await signIn({ email: 'other@legalmetrology.gov.in' });
    const filed = await fileInspection(inspector);

    // A 404 rather than a 403, matching `loadInspection`: confirming the record
    // exists would leak that a colleague filed an inspection at that reference.
    await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', other.auth)
      .send({ fieldName: 'mrp', action: 'ACCEPTED' })
      .expect(404);
  });

  it('requires a value when the determination is an edit', async () => {
    const filed = await fileInspection(inspector);

    await request(app)
      .post(`/api/inspections/${filed.id}/amendments`)
      .set('Authorization', inspector.auth)
      .send({ fieldName: 'mrp', action: 'EDITED' })
      .expect(422);
  });
});
