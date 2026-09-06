import { describe, expect, it } from 'vitest';

import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';
import { evaluate } from '../src/compliance/rule-engine/RuleEngine';
import { absenceStrength, effectiveConfidence } from '../src/compliance/rule-engine/DecisionEngine';
import { compliantFields, request, STRONG_EVIDENCE, WEAK_EVIDENCE } from '../src/compliance/tests/fixtures';
import type { ComplianceCheck } from '../src/compliance/types/ComplianceResult';

/**
 * Evidence handling.
 *
 * The distinction this file protects is the one that separates an enforcement
 * system from a guessing machine: a missing declaration is only a finding when
 * the evidence is good enough to say the declaration is missing, rather than
 * good enough only to say nobody found it.
 */

const corpus = builtInCorpus();

function check(checks: ComplianceCheck[], ruleId: string): ComplianceCheck | undefined {
  return checks.find((entry) => entry.ruleId === ruleId);
}

describe('a well-declared package on good evidence', () => {
  it('comes back compliant', () => {
    const result = evaluate(request(), corpus);
    expect(result.status).toBe('COMPLIANT');
    expect(result.summary.violations).toBe(0);
    expect(result.summary.reviewRequired).toBe(0);
  });

  it('records the provision, its commencement date and the notification on every check', () => {
    const mrp = check(evaluate(request(), corpus).checks, 'LM-PC-R6-1-E');

    expect(mrp?.provenance.sourceRule).toBe('Rule 6');
    expect(mrp?.provenance.sourceClause).toBe('6(1)(e)');
    expect(mrp?.provenance.effectiveFrom).toBe('2024-01-01');
    expect(mrp?.provenance.source.notification).toBe('G.S.R. 779(E)');
    expect(mrp?.provenance.source.officialUrl).toContain('consumeraffairs.gov.in');
    expect(mrp?.legalText.length).toBeGreaterThan(0);
    expect(mrp?.machineInterpretation.length).toBeGreaterThan(0);
  });

  it('carries the evidence reference and confidence through to the check', () => {
    // Checked on a non-food package: for a food article rule 6(1)(a) hands the
    // manufacturer declaration to the Food Safety and Standards Act — see the
    // next test — so the check would carry no confidence of its own.
    const result = evaluate(
      request({ productContext: { category: 'household', packageType: 'RETAIL', quantity: 500, quantityUnit: 'g' } }),
      corpus,
    );
    const manufacturer = check(result.checks, 'LM-PC-R6-1-A');

    expect(manufacturer?.status).toBe('COMPLIANT');
    expect(manufacturer?.evidence[0]?.imageId).toBe('img-back-001');
    expect(manufacturer?.evidence[0]?.bbox).toEqual([40, 120, 520, 190]);
    expect(manufacturer?.confidence).toBeCloseTo(0.96);
  });

  it('hands the manufacturer declaration on a food package to the FSS Act', () => {
    const manufacturer = check(evaluate(request(), corpus).checks, 'LM-PC-R6-1-A');

    expect(manufacturer?.status).toBe('NOT_APPLICABLE');
    expect(manufacturer?.notApplicableReason).toBe('DEFERRED_TO_OTHER_REGULATION');
    expect(manufacturer?.reason).toContain('Food Safety and Standards Act, 2006');
  });

  it('counts the unmeasurable typography checks separately from the verdict', () => {
    const result = evaluate(request(), corpus);

    // Reported and visible, but not allowed to decide — every package would
    // carry the same count.
    expect(result.summary.pendingCapability).toBeGreaterThan(0);
    expect(result.status).toBe('COMPLIANT');
  });
});

describe('a missing declaration', () => {
  const missingMrp = (evidence: typeof STRONG_EVIDENCE, absenceConfidence?: number) =>
    request({
      fields: { ...compliantFields(), mrp: { value: null, status: 'NOT_FOUND', absenceConfidence } },
      evidence,
    });

  it('is a violation when the package was captured thoroughly and the absence is confident', () => {
    const result = evaluate(missingMrp(STRONG_EVIDENCE, 0.95), corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.status).toBe('VIOLATION_DETECTED');
    expect(mrp?.reasonCode).toBe('DECLARATION_ABSENT');
    expect(result.status).toBe('VIOLATION_DETECTED');
  });

  it('is only a review when the absence itself is uncertain', () => {
    const result = evaluate(missingMrp(STRONG_EVIDENCE, 0.4), corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.status).toBe('REVIEW_REQUIRED');
    expect(mrp?.reasonCode).toBe('DECLARATION_ABSENT_LOW_CONFIDENCE');
  });

  it('is only a review when barely any of the package was photographed', () => {
    // Even with a confident absence: a declaration cannot be missing from a
    // face nobody captured.
    const result = evaluate(missingMrp(WEAK_EVIDENCE, 0.99), corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.status).toBe('REVIEW_REQUIRED');
    expect(mrp?.reasonCode).toBe('CAPTURE_INCOMPLETE');
  });

  it('is only a review when nothing said how thoroughly the package was examined', () => {
    const result = evaluate(
      request({
        fields: { ...compliantFields(), mrp: { value: null, status: 'NOT_FOUND' } },
        evidence: undefined,
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('REVIEW_REQUIRED');
    expect(result.warnings.some((warning) => warning.code === 'CAPTURE_COMPLETENESS_UNKNOWN')).toBe(true);
  });

  it('is a violation when an inspector recorded it as absent, whatever the capture', () => {
    const result = evaluate(
      request({
        fields: { ...compliantFields(), mrp: { value: null, status: 'HUMAN_MARKED_ABSENT' } },
        evidence: STRONG_EVIDENCE,
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('VIOLATION_DETECTED');
  });
});

describe('a declaration that was read but is wrong', () => {
  it('is a violation on a confident read', () => {
    const result = evaluate(
      request({
        inspectionDate: '2019-06-01',
        // In 2019 the clause required the words "maximum retail price" or "MRP".
        fields: { ...compliantFields(), mrp: { value: 'Rs. 499.00', confidence: 0.97, status: 'FOUND' } },
      }),
      corpus,
    );

    const mrp = check(result.checks, 'LM-PC-R6-1-E');
    expect(mrp?.status).toBe('VIOLATION_DETECTED');
    expect(mrp?.reasonCode).toBe('FORMAT_NOT_SATISFIED');
  });

  it('is a review on an uncertain read', () => {
    const result = evaluate(
      request({
        inspectionDate: '2019-06-01',
        fields: { ...compliantFields(), mrp: { value: 'Rs. 499.00', confidence: 0.55, status: 'FOUND' } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.reasonCode).toBe('FORMAT_NOT_SATISFIED_LOW_CONFIDENCE');
  });

  it('is a review when no confidence was reported at all', () => {
    const result = evaluate(
      request({
        inspectionDate: '2019-06-01',
        fields: { ...compliantFields(), mrp: { value: 'Rs. 499.00', status: 'FOUND' } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('REVIEW_REQUIRED');
  });

  it('passes the same declaration in 2025, when the words were no longer required', () => {
    // G.S.R. 779(E) replaced the 2017 wording with "in Indian currency" from
    // 1 January 2024. Same evidence, different law, different answer.
    const result = evaluate(
      request({
        inspectionDate: '2025-06-01',
        fields: { ...compliantFields(), mrp: { value: 'Rs. 499.00', confidence: 0.97, status: 'FOUND' } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('COMPLIANT');
  });
});

describe('an unreadable declaration', () => {
  it('is a review, never a violation — it is very likely there', () => {
    const result = evaluate(
      request({
        fields: { ...compliantFields(), mrp: { value: null, status: 'UNREADABLE', confidence: 0.2 } },
      }),
      corpus,
    );

    const mrp = check(result.checks, 'LM-PC-R6-1-E');
    expect(mrp?.status).toBe('REVIEW_REQUIRED');
    expect(mrp?.reasonCode).toBe('DECLARATION_UNREADABLE');
  });
});

describe('a compliant-looking read on evidence too weak to rely on', () => {
  it('does not establish compliance either', () => {
    // The mirror image of the violation case. Passing a package on a
    // 0.3-confidence read is as indefensible as failing it on one.
    const result = evaluate(
      request({
        fields: { ...compliantFields(), mrp: { value: 'MRP Rs. 499.00 (incl. of all taxes)', confidence: 0.3, status: 'FOUND' } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('REVIEW_REQUIRED');
  });
});

describe('checks awaiting computer vision', () => {
  it('reports the letter-height rule as insufficient evidence, not as a pass', () => {
    const height = check(evaluate(request(), corpus).checks, 'LM-PC-R7-2');

    expect(height?.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(height?.reasonCode).toBe('MEASUREMENT_NOT_AVAILABLE');
  });

  it('names the measurement it is waiting for', () => {
    const result = evaluate(request(), corpus);
    const warning = result.warnings.find((entry) => entry.code === 'MEASUREMENT_NOT_AVAILABLE');

    // The field, not the prose. The message is printed in a report served on a
    // dealer and no longer names an internal property; which measurement the
    // engine wants is carried beside it, where a diagnostic can read it.
    expect(warning?.measurement).toBe('heightMm');
    expect(warning?.message).toContain('measured on the package');
  });

  it('applies Table-I once a measurement is supplied', () => {
    // The engine is ready for the evidence; nothing produces it yet. Supplying
    // it by hand shows the thresholds are wired and correct.
    const result = evaluate(
      request({
        fields: {
          ...compliantFields(),
          net_quantity: {
            value: '500 g',
            unit: 'g',
            confidence: 0.95,
            status: 'FOUND',
            evidence: [
              {
                imageId: 'img-front-001',
                measurements: { heightMm: 0.8, principalDisplayPanelAreaCm2: 120 },
              },
            ],
          },
        },
      }),
      corpus,
    );

    // 120 cm² falls in the 100 < A ≤ 500 row, which requires 2.5 mm.
    const height = check(result.checks, 'LM-PC-R7-2');
    expect(height?.status).toBe('VIOLATION_DETECTED');
    expect(height?.reason).toContain('2.5 mm');
  });

  it('uses the corrigendum-corrected 2.0 mm figure, not the 1.5 mm as first printed', () => {
    const result = evaluate(
      request({
        fields: {
          ...compliantFields(),
          net_quantity: {
            value: '5 g',
            unit: 'g',
            confidence: 0.95,
            status: 'FOUND',
            evidence: [{ imageId: 'img-front-001', measurements: { heightMm: 1.2, principalDisplayPanelAreaCm2: 30 } }],
          },
        },
      }),
      corpus,
    );

    // A ≤ 50 requires 1.0 mm normally. 1.2 mm clears it.
    expect(check(result.checks, 'LM-PC-R7-2')?.status).toBe('COMPLIANT');
  });
});

describe('confidence helpers', () => {
  it('treats a human verification as certain', () => {
    expect(effectiveConfidence({ value: 'x', status: 'HUMAN_VERIFIED', confidence: 0.1 })).toBe(1);
  });

  it('returns null when no confidence was reported', () => {
    expect(effectiveConfidence({ value: 'x' })).toBeNull();
  });

  it('falls back to capture completeness when no absence confidence was given', () => {
    expect(absenceStrength({ value: null }, { captureCompleteness: 0.8 })).toBe(0.8);
  });

  it('treats an unexamined package as no evidence of absence at all', () => {
    expect(absenceStrength({ value: null }, undefined)).toBe(0);
  });
});

describe('determinism', () => {
  it('produces byte-identical results for the same input', () => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    const input = request();

    const a = evaluate(input, corpus, { now });
    const b = evaluate(input, corpus, { now });

    // durationMs is wall-clock and excluded by design.
    expect(JSON.stringify({ ...a, durationMs: 0 })).toBe(JSON.stringify({ ...b, durationMs: 0 }));
  });

  it('does not depend on the order rules were loaded in', () => {
    const now = new Date('2026-09-01T10:00:00.000Z');
    const reversed = { ...corpus, rules: [...corpus.rules].reverse(), exceptions: [...corpus.exceptions].reverse() };

    const a = evaluate(request(), corpus, { now });
    const b = evaluate(request(), reversed, { now });

    expect(a.checks.map((entry) => `${entry.ruleId}:${entry.status}`)).toEqual(
      b.checks.map((entry) => `${entry.ruleId}:${entry.status}`),
    );
  });
});

describe('the result explains itself', () => {
  it('answers what failed, why, under which rule, from when, on what evidence', () => {
    const result = evaluate(
      request({
        fields: { ...compliantFields(), net_quantity: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );

    const quantity = check(result.checks, 'LM-PC-R6-1-C');

    expect(quantity?.field).toBe('net_quantity'); // WHAT
    expect(quantity?.reason).toBeTruthy(); // WHY
    expect(quantity?.provenance.sourceClause).toBe('6(1)(c)'); // WHICH
    expect(quantity?.provenance.effectiveFrom).toBe('2011-04-01'); // WHEN
    expect(quantity?.evidence).toBeDefined(); // WHAT EVIDENCE
    expect(quantity?.confidence).toBeDefined(); // WHAT CONFIDENCE
    expect(quantity?.provenance.source.officialUrl).toBeTruthy(); // TRACEABLE
  });

  it('never marks a package compliant when no rule was assessed', () => {
    const result = evaluate(
      request({
        productContext: { isInstitutionalConsumer: true },
        fields: {},
        evidence: STRONG_EVIDENCE,
      }),
      corpus,
    );

    expect(result.status).not.toBe('COMPLIANT');
  });
});
