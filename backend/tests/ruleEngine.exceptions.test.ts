import { describe, expect, it } from 'vitest';

import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';
import { evaluate } from '../src/compliance/rule-engine/RuleEngine';
import {
  compliantFields,
  importedEcommerce,
  medicalDevice,
  request,
  smallSachet,
  STRONG_EVIDENCE,
} from '../src/compliance/tests/fixtures';
import type { ComplianceCheck } from '../src/compliance/types/ComplianceResult';

/**
 * The exception engine.
 *
 * Three effects that behave differently, and the tests exist to hold them
 * apart: a full exemption switches a rule off, a partial exemption leaves named
 * requirements standing, and a cross-regulation reference hands the question to
 * another instrument without excusing the package from answering it.
 */

const corpus = builtInCorpus();

function check(checks: ComplianceCheck[], ruleId: string): ComplianceCheck | undefined {
  return checks.find((entry) => entry.ruleId === ruleId);
}

describe('the pan masala carve-out', () => {
  /**
   * G.S.R. 881(E) does not exempt pan masala — it withdraws an exemption from
   * it. A 5 g sachet was outside the rules on 31 January 2026 and inside them
   * on 1 February 2026, and the engine has to get the direction right.
   */

  const panMasalaSachet = () =>
    request({
      productContext: smallSachet({ isPanMasala: true, commodityType: 'pan_masala' }),
      fields: { mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      evidence: STRONG_EVIDENCE,
    });

  it('exempts a 5 g pan masala sachet the day before the amendment', () => {
    const result = evaluate({ ...panMasalaSachet(), inspectionDate: '2026-01-31' }, corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.status).toBe('NOT_APPLICABLE');
    expect(mrp?.appliedExceptionId).toBe('EX-R26-A-SMALL-PACKAGE');
  });

  it('does not exempt the same sachet on the day the amendment commences', () => {
    const result = evaluate({ ...panMasalaSachet(), inspectionDate: '2026-02-01' }, corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.status).toBe('VIOLATION_DETECTED');
    expect(mrp?.reasonCode).toBe('DECLARATION_ABSENT');
    expect(mrp?.provenance.source.notification).toBe('G.S.R. 779(E)');
  });

  it('still exempts a 5 g sachet of something else', () => {
    const result = evaluate(
      {
        ...panMasalaSachet(),
        inspectionDate: '2026-02-01',
        productContext: smallSachet({ isPanMasala: false }),
      },
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('NOT_APPLICABLE');
  });

  it('cites the notification and its commencement date on the check', () => {
    const result = evaluate({ ...panMasalaSachet(), inspectionDate: '2026-01-31' }, corpus);
    const mrp = check(result.checks, 'LM-PC-R6-1-E');

    expect(mrp?.reason).toContain('G.S.R. 385(E)');
    expect(mrp?.reason).toContain('2016-01-01');
  });
});

describe('the tobacco carve-out, which the pan masala one follows', () => {
  it('exempts a 5 g sachet in 2015 and not in 2016', () => {
    const tobacco = request({
      productContext: smallSachet({ isTobaccoProduct: true }),
      fields: { mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
    });

    expect(check(evaluate({ ...tobacco, inspectionDate: '2015-12-31' }, corpus).checks, 'LM-PC-R6-1-E')?.status).toBe(
      'NOT_APPLICABLE',
    );
    expect(check(evaluate({ ...tobacco, inspectionDate: '2016-01-01' }, corpus).checks, 'LM-PC-R6-1-E')?.status).toBe(
      'VIOLATION_DETECTED',
    );
  });
});

describe('medical devices — cross-regulation, not exemption', () => {
  /**
   * G.S.R. 778(E) redirects the letter-height and letter-width requirements for
   * medical-device packages to the Medical Devices Rules, 2017. It does not
   * exempt the package from declaring anything, and applying Table-I to it
   * anyway would be applying a rule that was expressly taken away.
   */

  const device = () =>
    request({
      inspectionDate: '2026-09-01',
      productContext: medicalDevice(),
      fields: compliantFields(),
    });

  it('does not apply the Packaged Commodities letter-height rule', () => {
    const result = evaluate(device(), corpus);
    const height = check(result.checks, 'LM-PC-R7-2');

    expect(height?.status).toBe('NOT_APPLICABLE');
    expect(height?.notApplicableReason).toBe('DEFERRED_TO_OTHER_REGULATION');
    expect(height?.reason).toContain('Medical Devices Rules, 2017');
  });

  it('does the same for the letter-width rule', () => {
    const width = check(evaluate(device(), corpus).checks, 'LM-PC-R7-3');

    expect(width?.status).toBe('NOT_APPLICABLE');
    expect(width?.notApplicableReason).toBe('DEFERRED_TO_OTHER_REGULATION');
  });

  it('applied Table-I before the 2025 amendment', () => {
    // Before G.S.R. 778(E) there was no hand-off, so the rule reached the
    // package — and resolved to insufficient evidence, since nothing measures.
    const before = evaluate({ ...device(), inspectionDate: '2025-10-23' }, corpus);
    const height = check(before.checks, 'LM-PC-R7-2');

    expect(height?.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(height?.reasonCode).toBe('MEASUREMENT_NOT_AVAILABLE');
  });

  it('withholds the rule 26(c) drug exemption from a medical device', () => {
    // The 2017 proviso: "no exemption shall be applicable to medical devices
    // declared as drugs". A device that is also a formulation stays regulated.
    const result = evaluate(
      {
        ...device(),
        productContext: medicalDevice({ isDrugFormulation: true }),
        fields: { net_quantity: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      },
      corpus,
    );

    const quantity = check(result.checks, 'LM-PC-R6-1-C');
    expect(quantity?.status).toBe('VIOLATION_DETECTED');
  });

  it('does exempt a drug formulation that is not a medical device', () => {
    const result = evaluate(
      {
        ...device(),
        productContext: { category: 'other', packageType: 'RETAIL', isDrugFormulation: true },
        fields: { net_quantity: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      },
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-C')?.status).toBe('NOT_APPLICABLE');
  });
});

describe('partial exemptions leave requirements standing', () => {
  it('keeps the price and consumer-care declarations on loose-sold garments', () => {
    const result = evaluate(
      request({
        inspectionDate: '2026-09-01',
        productContext: {
          category: 'apparel',
          packageType: 'RETAIL',
          isGarmentOrHosiery: true,
          isSoldLoose: true,
        },
        fields: {
          mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 },
          commodity_name: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 },
        },
      }),
      corpus,
    );

    // Surviving under the rule 26(f) proviso — still checked, still failed.
    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('VIOLATION_DETECTED');
    // Not among the four survivors — switched off.
    expect(check(result.checks, 'LM-PC-R6-1-B')?.status).toBe('NOT_APPLICABLE');
  });

  it('does not apply the garment exemption to a garment that is not sold loose', () => {
    const result = evaluate(
      request({
        productContext: { category: 'apparel', packageType: 'RETAIL', isGarmentOrHosiery: true, isSoldLoose: false },
        fields: { commodity_name: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-B')?.status).toBe('VIOLATION_DETECTED');
  });
});

describe('scope exclusions under rule 3', () => {
  it('excludes a package meant for an institutional consumer', () => {
    const result = evaluate(
      request({
        productContext: { category: 'packaged_food', isInstitutionalConsumer: true, quantity: 500, quantityUnit: 'g' },
        fields: { mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('NOT_APPLICABLE');
  });

  it('excludes a package over 25 kg', () => {
    const result = evaluate(
      request({
        productContext: { category: 'other', packageType: 'RETAIL', quantity: 30, quantityUnit: 'kg' },
        fields: { mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('NOT_APPLICABLE');
  });

  it('does not exclude a 25 kg package — the threshold is "more than"', () => {
    const result = evaluate(
      request({
        productContext: { category: 'other', packageType: 'RETAIL', quantity: 25, quantityUnit: 'kg' },
        fields: { mrp: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-E')?.status).toBe('VIOLATION_DETECTED');
  });
});

describe('applicability by context', () => {
  it('does not check country of origin on a domestic package', () => {
    const result = evaluate(request(), corpus);
    const coo = check(result.checks, 'LM-PC-R6-1-AA');

    expect(coo?.status).toBe('NOT_APPLICABLE');
    expect(coo?.notApplicableReason).toBe('CONTEXT_OUT_OF_SCOPE');
  });

  it('checks it on an imported one', () => {
    const result = evaluate(
      request({
        productContext: importedEcommerce(),
        fields: { country_of_origin: { value: 'Vietnam', confidence: 0.95, status: 'FOUND' } },
      }),
      corpus,
    );

    expect(check(result.checks, 'LM-PC-R6-1-AA')?.status).toBe('COMPLIANT');
  });

  it('checks the country-of-origin filter only for imported goods sold online', () => {
    const online = evaluate(
      request({
        inspectionDate: '2026-09-01',
        productContext: importedEcommerce(),
        fields: { coo_filter: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );
    expect(check(online.checks, 'LM-PC-R6-10A')?.status).toBe('VIOLATION_DETECTED');

    const offline = evaluate(
      request({
        inspectionDate: '2026-09-01',
        productContext: importedEcommerce({ isEcommerce: false }),
        fields: { coo_filter: { value: null, status: 'NOT_FOUND', absenceConfidence: 0.95 } },
      }),
      corpus,
    );
    expect(check(offline.checks, 'LM-PC-R6-10A')?.status).toBe('NOT_APPLICABLE');
  });

  it('never evaluates a registration rule against package evidence', () => {
    const result = evaluate(request(), corpus);

    for (const ruleId of ['LM-PC-R27-2-D', 'LM-PC-R27-5', 'LM-PC-R4-EXPL2']) {
      expect(check(result.checks, ruleId)?.status).toBe('NOT_APPLICABLE');
    }
  });
});
