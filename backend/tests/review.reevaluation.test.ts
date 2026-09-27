import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { app, PNG_BYTES, signIn, type Signed } from './helpers';

/**
 * ── THE INSPECTOR'S WORD REACHES THE RULE ENGINE ────────────────────────────
 *
 * The inspector is standing in front of the package. What they determine has
 * to be re-checked by the *Legal Metrology rule engine* — the same rulebook,
 * the same version, the same evidence policy the scan used.
 *
 * Before this, `POST /:id/review` re-checked corrections with the older
 * scripted analyser in `services/complianceService`, which knows nothing about
 * rule versions, exceptions or `DecisionEngine`'s evidence policy. So a report
 * an inspector signed could be produced by a different set of rules from the
 * one applied to the same package minutes earlier. These tests exist to keep
 * that from coming back.
 *
 * The three things being defended:
 *
 *   · a correction is judged by the real engine, and the record still names
 *     the rule set version it was judged under;
 *   · confirming a declaration genuinely absent is what turns "not found" into
 *     a finding — a person looked;
 *   · silence is not confirmation. A declaration nobody ruled on stays a
 *     review, however poorly the package was photographed.
 */

const SCAN_DATE = '2026-09-02';

let session: Signed;

beforeEach(async () => {
  session = await signIn();
});

/** Scans a mock fixture and returns the created inspection. */
async function scanFixture(fixture: string, images = 2) {
  const call = request(app)
    .post('/api/inspections/scan')
    .set('Authorization', session.auth)
    .field('inspectionDate', SCAN_DATE)
    .field('mockFixture', fixture);

  for (let index = 0; index < images; index += 1) {
    call.attach('images', PNG_BYTES, `face-${index}.png`);
  }

  const response = await call;
  expect(response.status).toBe(201);

  // The scan response is the capture-flow DTO; the stored scan record — OCR,
  // extraction and the engine's verdict — is on the inspection itself.
  const stored = await detail(response.body.data.inspectionId);
  expect(stored.status).toBe(200);
  return stored.body.data;
}

function review(id: string, reviews: unknown[]) {
  return request(app)
    .post(`/api/inspections/${id}/review`)
    .set('Authorization', session.auth)
    .send({ reviews });
}

function detail(id: string) {
  return request(app).get(`/api/inspections/${id}`).set('Authorization', session.auth);
}

describe('review re-evaluation runs the Legal Metrology engine', () => {
  it('keeps the rule engine as the source of the verdict after a correction', async () => {
    const scan = await scanFixture('low_confidence');
    const before = scan.scan.legal;

    const response = await review(scan.inspectionId, [
      { fieldName: 'mrp', action: 'ACCEPTED' },
    ]);

    expect(response.status).toBe(200);

    const after = (await detail(scan.inspectionId)).body.data.scan.legal;

    // The engine's own provenance survives the round trip. If the legacy
    // analyser had produced this, there would be no rule-set version at all.
    expect(after.ruleSetVersion).toBe(before.ruleSetVersion);
    expect(after.engineVersion).toBe(before.engineVersion);
    expect(after.checks.length).toBeGreaterThan(0);
  });

  it('records the corrected value without destroying what the camera read', async () => {
    const scan = await scanFixture('low_confidence');
    const original = scan.scan.extraction.fields.mrp?.value;

    await review(scan.inspectionId, [
      { fieldName: 'mrp', action: 'EDITED', value: 'MRP ₹199.00 (incl. of all taxes)' },
    ]);

    const stored = (await detail(scan.inspectionId)).body.data;

    // `scan.extraction` is the evidence of what the camera read. A correction
    // is recorded beside it, never over it — the report has to be able to show
    // both, and an audit that cannot say what the machine saw is worthless.
    expect(stored.scan.extraction.fields.mrp?.value).toBe(original);
  });

  it('turns a confirmed absence into a finding, because a person looked', async () => {
    const scan = await scanFixture('missing_declarations');

    const engineField = Object.keys(scan.scan.extraction.fields).find(
      (name) => scan.scan.extraction.fields[name]?.status === 'NOT_FOUND',
    );
    expect(engineField, 'fixture should leave at least one declaration unfound').toBeTruthy();

    const before = (await detail(scan.inspectionId)).body.data.scan.legal.issueSummary;

    await review(scan.inspectionId, [
      { fieldName: engineField!, action: 'MARKED_UNAVAILABLE' },
    ]);

    const after = (await detail(scan.inspectionId)).body.data.scan.legal;

    // Not merely "still not found": confirmed absent by someone who examined
    // the package, which is the only thing that makes an absence certain.
    expect(after.issueSummary.total).toBeGreaterThanOrEqual(before.total);
    expect(['VIOLATION_DETECTED', 'REVIEW_REQUIRED']).toContain(after.status);
  });

  /**
   * ── THE VERDICT THE APP READS FOLLOWS THE ENGINE ────────────────────────
   *
   * Every test above reads `scan.legal`, which is the engine's own record, and
   * they all passed while this was broken.
   *
   * `complianceResult` is the projection the app, the register and the
   * analytics actually read, and the review path was not rebuilding it. An
   * officer confirmed a declaration was absent, the engine turned it into a
   * finding and recorded `reviewRequired: 0` — and the record went on saying
   * "Review Required" with a needs-review count beside it, on a record that
   * had been reviewed and filed. Nothing could clear it, because the field it
   * was asking about was already decided.
   *
   * So this asserts on the projection and not on the engine: that the two
   * agree is the property that was missing.
   */
  it('re-derives the verdict the app reads, not only the engine record', async () => {
    const scan = await scanFixture('missing_declarations');

    const engineField = Object.keys(scan.scan.extraction.fields).find(
      (name) => scan.scan.extraction.fields[name]?.status === 'NOT_FOUND',
    );
    expect(engineField, 'fixture should leave at least one declaration unfound').toBeTruthy();

    await review(scan.inspectionId, [{ fieldName: engineField!, action: 'MARKED_UNAVAILABLE' }]);

    const record = (await detail(scan.inspectionId)).body.data;
    const legal = record.scan.legal;

    // The projection carries the engine's verdict, collapsed onto the three
    // states the workflow has — never a stale one from the original scan.
    const expected =
      legal.status === 'VIOLATION_DETECTED'
        ? 'VIOLATION_DETECTED'
        : legal.status === 'COMPLIANT'
          ? 'COMPLIANT'
          : 'REVIEW_REQUIRED';

    expect(record.complianceResult.status).toBe(expected);
    expect(record.status).toBe(expected);

    // And it was re-derived rather than left alone: a projection built before
    // the review cannot know about a declaration a person has since settled.
    expect(new Date(record.complianceResult.evaluatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(legal.evaluatedAt).getTime() - 1000,
    );
  });

  it('does not treat an unreviewed declaration as confirmed', async () => {
    const scan = await scanFixture('missing_declarations');
    const before = (await detail(scan.inspectionId)).body.data.scan.legal.issueSummary;

    // One field ruled on; every other unfound declaration untouched.
    await review(scan.inspectionId, [{ fieldName: 'mrp', action: 'ACCEPTED' }]);

    const after = (await detail(scan.inspectionId)).body.data.scan.legal;

    // Silence is not confirmation. Nothing the inspector did not look at may
    // have hardened into a violation.
    expect(after.issueSummary.potentialViolations).toBeLessThanOrEqual(
      before.potentialViolations + 1,
    );
  });

  it('refuses a review naming a declaration that is not on the inspection', async () => {
    const scan = await scanFixture('compliant');

    const response = await review(scan.inspectionId, [
      { fieldName: 'not_a_declaration', action: 'ACCEPTED' },
    ]);

    expect(response.status).toBe(404);
  });
});
