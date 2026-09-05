import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { Inspection } from '../src/models';
import { mockProviderFor } from '../src/services/analysisService';
import { evaluateCompliance } from '../src/services/complianceService';
import type { ComplianceStatus } from '../src/types/domain';

import { app, signIn, type Signed } from './helpers';

/**
 * ── THE STATUS FILTER, AND THE RECORDS IT USED TO LOSE ──────────────────────
 *
 * `INSPECTION_STATUSES` carries workflow position and verdict in one enum, and
 * `inspection.status` is overwritten with `FINALIZED` the moment a record is
 * filed. The list filter read that column, so `?status=VIOLATION_DETECTED`
 * returned only the violations that had *not* been filed yet — and since filing
 * is how an inspection ends, every closed violation fell out of the register's
 * own filter and stayed out.
 *
 * Nothing about it looked broken. The list rendered, the pager worked, and the
 * count simply disagreed with the "Violations" tile the officer had tapped to
 * get there — a tile counted from `complianceResult.status`, which had held the
 * verdict correctly the whole time.
 *
 * These tests fix the two halves of that in place: a filed violation is still a
 * violation, and the number on the tile is the number in the list.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** An analysed inspection, optionally filed. Mirrors `dashboard.test.ts`. */
async function seedInspection(options: {
  owner: Signed;
  scenario: 'compliant' | 'violation' | 'low_confidence';
  business: string;
  finalized?: boolean;
  /**
   * Forces the verdict.
   *
   * Used only for the REVIEW_REQUIRED case. The mock scenarios are written to
   * exercise the compliance engine and none of them currently settles on that
   * verdict — `low_confidence` reads a smudged MRP and the engine calls it a
   * violation. Pinning the verdict keeps this file testing the *filter*, and
   * leaves what the engine decides to the rule-engine suites, where a change
   * in that decision should show up.
   */
  verdict?: ComplianceStatus;
}) {
  const provider = mockProviderFor(options.scenario);
  const result = await provider.analyse({
    inspectionId: 'test',
    images: [{ imageId: 'img_test', type: 'FRONT', url: '' }],
    categoryHint: 'packaged_food',
  });

  const evaluated = evaluateCompliance({ fields: result.fields, category: 'packaged_food' });
  const compliance = options.verdict ? { ...evaluated, status: options.verdict } : evaluated;

  return Inspection.create({
    inspectionId: `INS-2026-${Math.floor(Math.random() * 90000 + 10000)}`,
    inspector: options.owner.user._id,
    business: { name: options.business },
    location: { address: 'Test Address', district: 'Pune', state: 'Maharashtra' },
    productCategory: 'packaged_food',
    productName: 'Test Commodity 500 g',
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
    // Exactly what `finalizeInspection` does: the workflow column is
    // overwritten, and `complianceResult.status` keeps the verdict.
    status: options.finalized ? 'FINALIZED' : compliance.status,
    finalizedAt: options.finalized ? new Date() : undefined,
  });
}

function references(body: { data: { items: Array<{ inspectionId: string }> } }): string[] {
  return body.data.items.map((item) => item.inspectionId);
}

describe('GET /api/inspections?status=', () => {
  let inspector: Signed;

  beforeEach(async () => {
    inspector = await signIn();
  });

  it('returns a violation that has been finalized', async () => {
    const open = await seedInspection({
      owner: inspector,
      scenario: 'violation',
      business: 'Open Violation Store',
    });
    const filed = await seedInspection({
      owner: inspector,
      scenario: 'violation',
      business: 'Filed Violation Store',
      finalized: true,
    });

    // Guards the premise: the two records genuinely differ on the column the
    // filter used to read, and agree on the one it reads now. Without this the
    // test could pass for the wrong reason.
    expect(open.status).toBe('VIOLATION_DETECTED');
    expect(filed.status).toBe('FINALIZED');
    expect(filed.complianceResult?.status).toBe('VIOLATION_DETECTED');

    const response = await request(app)
      .get('/api/inspections')
      .query({ status: 'VIOLATION_DETECTED' })
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(references(response.body).sort()).toEqual(
      [open.inspectionId, filed.inspectionId].sort(),
    );
    expect(response.body.data.total).toBe(2);
  });

  it('returns a compliant record that has been finalized', async () => {
    const filed = await seedInspection({
      owner: inspector,
      scenario: 'compliant',
      business: 'Filed Compliant Store',
      finalized: true,
    });

    const response = await request(app)
      .get('/api/inspections')
      .query({ status: 'COMPLIANT' })
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(references(response.body)).toEqual([filed.inspectionId]);
  });

  it('agrees with the counts on /inspections/stats', async () => {
    await seedInspection({ owner: inspector, scenario: 'violation', business: 'V1' });
    await seedInspection({ owner: inspector, scenario: 'violation', business: 'V2', finalized: true });
    await seedInspection({ owner: inspector, scenario: 'compliant', business: 'C1', finalized: true });

    const stats = await request(app)
      .get('/api/inspections/stats')
      .set('Authorization', inspector.auth)
      .expect(200);

    for (const [status, expected] of [
      ['VIOLATION_DETECTED', stats.body.data.violations],
      ['COMPLIANT', stats.body.data.compliant],
    ] as const) {
      const list = await request(app)
        .get('/api/inspections')
        .query({ status })
        .set('Authorization', inspector.auth)
        .expect(200);

      // The tile and the list it opens. This is the assertion the whole fix
      // exists for.
      expect(list.body.data.total).toBe(expected);
    }
  });

  /**
   * `REVIEW_REQUIRED` is deliberately *not* treated as a verdict here.
   *
   * It is the only one of the three shared values that names a queue rather
   * than a finding — the work still sitting on the officer's desk — and the
   * "Pending Reviews" tile counts it the same way. A filed record has been
   * reviewed, whatever the engine's own verdict on it was, so it does not
   * belong in that list. See `statusFilterField`.
   */
  it('excludes a filed record from the review queue', async () => {
    const open = await seedInspection({
      owner: inspector,
      scenario: 'low_confidence',
      business: 'Awaiting Review Store',
      verdict: 'REVIEW_REQUIRED',
    });
    const filed = await seedInspection({
      owner: inspector,
      scenario: 'low_confidence',
      business: 'Reviewed And Filed Store',
      finalized: true,
      verdict: 'REVIEW_REQUIRED',
    });

    expect(open.status).toBe('REVIEW_REQUIRED');
    expect(filed.complianceResult?.status).toBe('REVIEW_REQUIRED');

    const response = await request(app)
      .get('/api/inspections')
      .query({ status: 'REVIEW_REQUIRED' })
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(references(response.body)).toEqual([open.inspectionId]);

    const stats = await request(app)
      .get('/api/inspections/stats')
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(stats.body.data.pendingReviews).toBe(1);
  });

  it('still filters on the workflow column for a workflow-only status', async () => {
    const filed = await seedInspection({
      owner: inspector,
      scenario: 'violation',
      business: 'Filed Store',
      finalized: true,
    });
    await seedInspection({ owner: inspector, scenario: 'violation', business: 'Open Store' });

    const response = await request(app)
      .get('/api/inspections')
      .query({ status: 'FINALIZED' })
      .set('Authorization', inspector.auth)
      .expect(200);

    expect(references(response.body)).toEqual([filed.inspectionId]);
  });
});
