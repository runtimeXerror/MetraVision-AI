import { describe, expect, it } from 'vitest';

import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';
import { evaluate } from '../src/compliance/rule-engine/RuleEngine';
import { parseMonthYear } from '../src/compliance/validators/dateValidator';
import { compliantFields, request } from '../src/compliance/tests/fixtures';

/**
 * ── DATES AS PACKAGES ACTUALLY PRINT THEM ───────────────────────────────────
 *
 * Two things, both found on one photograph of a Haldiram moong dal pack.
 *
 * The pack declares `MFG. DATE : 13/08/26` and `USE BY : 12/01/27`. Every
 * pattern in the date validator required a four-digit year, so both were read
 * off the label, carried through extraction intact, and then reported as
 * declarations that "could not be read as a month and year". A two-digit year
 * is the ordinary form on an Indian coding strip — the space is a few
 * millimetres of foil — so this was not an unusual label.
 *
 * The second is what nobody was asking: whether the date the package declares
 * has already gone by. That is not a Packaged Commodities question and the
 * engine does not answer it as one — see the warning's own text — but it is the
 * first thing an inspector holding the packet wants to know.
 */

const corpus = builtInCorpus();

describe('a two-digit year', () => {
  it('reads as this century', () => {
    expect(parseMonthYear('13/08/26')).toBe('2026-08');
    expect(parseMonthYear('12/01/27')).toBe('2027-01');
    expect(parseMonthYear('01-04-25')).toBe('2025-04');
  });

  it('reads a named month with a short year', () => {
    expect(parseMonthYear('AUG 26')).toBe('2026-08');
  });

  it('still reads the four-digit forms', () => {
    expect(parseMonthYear('03/2026')).toBe('2026-03');
    expect(parseMonthYear('MAR 2026')).toBe('2026-03');
    expect(parseMonthYear('13/08/2026')).toBe('2026-08');
  });

  it('refuses a two-part date with a two-digit year', () => {
    /*
     * `12/01` is December 2001 and January 2012 and the label does not say
     * which. A guess here would be printed on a served document as though the
     * package had declared it.
     */
    expect(parseMonthYear('12/01')).toBeNull();
  });
});

describe('a declared date that has already passed', () => {
  function withBestBefore(value: string) {
    return evaluate(
      request({
        inspectionDate: '2026-09-01',
        fields: { ...compliantFields(), best_before: { value, confidence: 0.95 } },
      }),
      corpus,
    );
  }

  it('is reported, with the date and the inspection date named', () => {
    const warning = withBestBefore('12/01/26').warnings.find(
      (entry) => entry.code === 'DECLARED_DATE_PASSED',
    );

    expect(warning).toBeDefined();
    expect(warning?.message).toContain('2026-01');
    expect(warning?.message).toContain('2026-09-01');
  });

  it('does not claim a contravention of the labelling rules', () => {
    /*
     * Rule 6(1)(da) requires the declaration to be present, and on this package
     * it is. Recording a breach of it because the date has gone by would be a
     * false legal claim in a document served on a dealer — so the observation
     * names the Act that does govern it and stops there.
     */
    const result = withBestBefore('12/01/26');
    const warning = result.warnings.find((entry) => entry.code === 'DECLARED_DATE_PASSED');

    expect(warning?.message).toContain('not a contravention');
    expect(warning?.message).toContain('Food Safety and Standards Act');
    expect(result.checks.find((check) => check.ruleId === 'LM-PC-R6-1-DA')?.status).not.toBe(
      'VIOLATION',
    );
  });

  it('says nothing about a date still in the future', () => {
    const warnings = withBestBefore('12/01/27').warnings;
    expect(warnings.find((entry) => entry.code === 'DECLARED_DATE_PASSED')).toBeUndefined();
  });

  it('says nothing when the declared month is the inspection month', () => {
    // A packet marked September 2026 is not lapsed on any day in September
    // 2026, and the declaration carries no finer grain than that.
    const warnings = withBestBefore('15/09/26').warnings;
    expect(warnings.find((entry) => entry.code === 'DECLARED_DATE_PASSED')).toBeUndefined();
  });

  it('ignores a manufacturing date in the past, which is what one is', () => {
    const result = evaluate(
      request({
        inspectionDate: '2026-09-01',
        fields: { ...compliantFields(), manufacturing_date: { value: '13/08/24', confidence: 0.95 } },
      }),
      corpus,
    );

    expect(result.warnings.find((entry) => entry.code === 'DECLARED_DATE_PASSED')).toBeUndefined();
  });
});
