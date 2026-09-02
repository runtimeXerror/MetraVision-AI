import { describe, expect, it } from 'vitest';

import {
  futureEffectiveRules,
  isInForceOn,
  resolveExceptionVersions,
  resolveRuleVersions,
  temporalStatusOf,
  versionHistory,
} from '../src/compliance/rule-engine/VersionResolver';
import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';

/**
 * Date-aware rule resolution.
 *
 * The behaviour under test is the one the whole phase turns on: an inspection
 * is judged against the law as it stood on the day of the inspection, and never
 * against a version that had not yet commenced or had already been replaced.
 */

const corpus = builtInCorpus();

function versionInForce(ruleId: string, date: string): string | undefined {
  return resolveRuleVersions(corpus.rules, date).find((rule) => rule.ruleId === ruleId)?.ruleVersion;
}

describe('window arithmetic', () => {
  it('includes the first day and excludes the last', () => {
    // Half-open, so consecutive versions tile the timeline with no day
    // belonging to both and no day belonging to neither.
    expect(isInForceOn('2026-02-01', '2026-03-01', '2026-02-01')).toBe(true);
    expect(isInForceOn('2026-02-01', '2026-03-01', '2026-02-28')).toBe(true);
    expect(isInForceOn('2026-02-01', '2026-03-01', '2026-03-01')).toBe(false);
    expect(isInForceOn('2026-02-01', '2026-03-01', '2026-01-31')).toBe(false);
  });

  it('treats a null end date as still in force', () => {
    expect(isInForceOn('2011-04-01', null, '2099-01-01')).toBe(true);
  });

  it('compares calendar dates, not instants', () => {
    // A commencement is a date in India, not a UTC timestamp. Parsing to a
    // Date would put "2026-02-01" at 05:30 IST and resolve an 02:00 IST
    // inspection to the previous version.
    expect(isInForceOn('2026-02-01', null, '2026-02-01T02:00:00+05:30')).toBe(true);
  });
});

describe('selecting the version in force', () => {
  it('picks the 2011 text before the first amendment', () => {
    expect(versionInForce('LM-PC-R6-1-E', '2015-06-01')).toBe('2011-04-01');
  });

  it('switches on the exact day an amendment commences', () => {
    // G.S.R. 858(E) was published on 7 September 2016.
    expect(versionInForce('LM-PC-R6-1-E', '2016-09-06')).toBe('2011-04-01');
    expect(versionInForce('LM-PC-R6-1-E', '2016-09-07')).toBe('2016-09-07');
  });

  it('picks the 2017 amendment only from its commencement date, not its notification date', () => {
    // G.S.R. 629(E) is dated 23 June 2017 but commences 1 January 2018. A
    // system keyed on notification dates would apply it six months early.
    expect(versionInForce('LM-PC-R6-1-E', '2017-12-31')).toBe('2016-09-07');
    expect(versionInForce('LM-PC-R6-1-E', '2018-01-01')).toBe('2018-01-01');
  });

  it('applies the 2021 amendment from 2024, after nine deferrals', () => {
    // G.S.R. 779(E) was notified in November 2021 to commence April 2022, and
    // was pushed to 1 January 2024. Anything else would apply it two years
    // early against packages that were lawful at the time.
    expect(versionInForce('LM-PC-R6-1-E', '2023-12-31')).toBe('2018-01-01');
    expect(versionInForce('LM-PC-R6-1-E', '2024-01-01')).toBe('2024-01-01');
  });

  it('never returns two versions of the same rule', () => {
    for (const date of ['2011-04-01', '2013-06-06', '2018-01-01', '2024-01-01', '2026-09-01', '2028-01-01']) {
      const resolved = resolveRuleVersions(corpus.rules, date);
      const ids = resolved.map((rule) => rule.ruleId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('returns nothing for a rule before its first version exists', () => {
    // Rule 6(1)(aa) — country of origin — was inserted by G.S.R. 629(E).
    expect(versionInForce('LM-PC-R6-1-AA', '2017-12-31')).toBeUndefined();
    expect(versionInForce('LM-PC-R6-1-AA', '2018-01-01')).toBe('2018-01-01');
  });

  it('follows a requirement across a change of provision number', () => {
    // The promotional-group obligation moved from rule 5(2) to rule 4(2) when
    // rule 5 was omitted. It is one requirement, continuously in force.
    const before = resolveRuleVersions(corpus.rules, '2023-12-31').find((rule) => rule.ruleId === 'LM-PC-PROMO-GROUP');
    const after = resolveRuleVersions(corpus.rules, '2024-01-01').find((rule) => rule.ruleId === 'LM-PC-PROMO-GROUP');

    expect(before?.sourceRule).toBe('Rule 5');
    expect(after?.sourceRule).toBe('Rule 4');
    expect(after?.supersedes).toBe(before?.ruleVersion);
  });
});

describe('the 2026 country-of-origin sequence', () => {
  /**
   * The edge case the brief singles out. G.S.R. 128(E) inserts rule 6(10A) with
   * effect from 1 July 2026; G.S.R. 312(E), notified two months earlier in
   * April 2026, substitutes it — but only from 1 July 2027.
   *
   * A system that resolved by notification date would apply the 2027 text
   * throughout 2026, and would do it confidently.
   */

  it('is not in force before 1 July 2026', () => {
    expect(versionInForce('LM-PC-R6-10A', '2026-06-30')).toBeUndefined();
  });

  it('applies the G.S.R. 128(E) text from 1 July 2026', () => {
    expect(versionInForce('LM-PC-R6-10A', '2026-07-01')).toBe('2026-07-01');
  });

  it('still applies the 2026 text on the project reference date', () => {
    const rule = resolveRuleVersions(corpus.rules, '2026-09-01').find((entry) => entry.ruleId === 'LM-PC-R6-10A');
    expect(rule?.ruleVersion).toBe('2026-07-01');
    expect(rule?.source.notification).toBe('G.S.R. 128(E)');
  });

  it('still applies the 2026 text on the last day before the substitution', () => {
    expect(versionInForce('LM-PC-R6-10A', '2027-06-30')).toBe('2026-07-01');
  });

  it('applies the G.S.R. 312(E) text from 1 July 2027', () => {
    const rule = resolveRuleVersions(corpus.rules, '2027-07-01').find((entry) => entry.ruleId === 'LM-PC-R6-10A');
    expect(rule?.ruleVersion).toBe('2027-07-01');
    expect(rule?.source.notification).toBe('G.S.R. 312(E)');
  });

  it('reports the 2027 version as future-effective in 2026', () => {
    const upcoming = futureEffectiveRules(corpus.rules, '2026-09-01');
    const coo = upcoming.find((rule) => rule.ruleId === 'LM-PC-R6-10A');

    expect(coo?.ruleVersion).toBe('2027-07-01');
    expect(temporalStatusOf(coo!, '2026-09-01')).toBe('FUTURE_EFFECTIVE');
  });
});

describe('exception versions resolve by date the same way', () => {
  it('picks the tobacco-only carve-out before February 2026', () => {
    const exceptions = resolveExceptionVersions(corpus.exceptions, '2026-01-31');
    const small = exceptions.find((entry) => entry.exceptionId === 'EX-R26-A-SMALL-PACKAGE');

    expect(small?.effectiveFrom).toBe('2016-01-01');
    expect(small?.source.notification).toBe('G.S.R. 385(E)');
  });

  it('picks the pan-masala carve-out from 1 February 2026', () => {
    const exceptions = resolveExceptionVersions(corpus.exceptions, '2026-02-01');
    const small = exceptions.find((entry) => entry.exceptionId === 'EX-R26-A-SMALL-PACKAGE');

    expect(small?.effectiveFrom).toBe('2026-02-01');
    expect(small?.source.notification).toBe('G.S.R. 881(E)');
  });

  it('never has two versions of one exception in force', () => {
    for (const date of ['2011-04-01', '2012-07-01', '2016-01-01', '2024-01-01', '2026-02-01', '2026-09-01']) {
      const resolved = resolveExceptionVersions(corpus.exceptions, date);
      const ids = resolved.map((entry) => entry.exceptionId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('version history', () => {
  it('returns every text of rule 26(a) in order', () => {
    const history = corpus.exceptions
      .filter((entry) => entry.exceptionId === 'EX-R26-A-SMALL-PACKAGE')
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));

    expect(history.map((entry) => entry.effectiveFrom)).toEqual(['2011-04-01', '2012-07-01', '2016-01-01', '2026-02-01']);
  });

  it('returns the amendment trail of a rule oldest first', () => {
    const history = versionHistory(corpus.rules, 'LM-PC-R6-1-E');
    expect(history.map((rule) => rule.ruleVersion)).toEqual(['2011-04-01', '2016-09-07', '2018-01-01', '2024-01-01']);
  });

  it('marks a superseded version as expired on a later date', () => {
    const [first] = versionHistory(corpus.rules, 'LM-PC-R6-1-E');
    expect(temporalStatusOf(first!, '2026-09-01')).toBe('EXPIRED');
  });
});
