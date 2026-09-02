import { describe, expect, it } from 'vitest';

import { AMENDMENTS } from '../src/compliance/data/amendments';
import { RULE_EXCEPTIONS } from '../src/compliance/data/exceptions';
import { RULE_VERSIONS } from '../src/compliance/data/ruleVersions';
import { SOURCE_CONFLICTS } from '../src/compliance/data/conflicts';
import { builtInCorpus } from '../src/compliance/repository/RuleSetLoader';
import { evaluateCondition, resolvePath } from '../src/compliance/rule-engine/ConditionEvaluator';
import { validateRuleSet } from '../src/compliance/rule-engine/RuleSetValidator';
import type { LegalRule } from '../src/compliance/types/Rule';

/**
 * The corpus's own test suite.
 *
 * A versioned legal corpus fails quietly: two versions in force at once does
 * not throw, it produces confident wrong verdicts. These tests are the thing
 * that makes that failure loud.
 */

const corpus = builtInCorpus();

function report(asOf = '2026-09-01') {
  return validateRuleSet({
    rules: corpus.rules,
    exceptions: corpus.exceptions,
    amendments: corpus.amendments,
    sourceConflicts: corpus.sourceConflicts,
    ruleSetVersion: corpus.metadata.ruleSetVersion,
    ruleSetChecksum: corpus.metadata.checksum,
    asOf,
    now: new Date('2026-09-01T00:00:00.000Z'),
  });
}

describe('the shipped corpus is structurally sound', () => {
  it('reports no structural errors', () => {
    const result = report();
    const errors = result.conflicts.filter((entry) => entry.origin === 'STRUCTURAL' && entry.severity === 'ERROR');

    // Printed so a failure names the defect rather than just the count.
    expect(errors.map((entry) => `${entry.code}: ${entry.message}`)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('gives every rule version a verified official source URL', () => {
    const missing = RULE_VERSIONS.filter((rule) => !rule.source.officialUrl);
    expect(missing.map((rule) => `${rule.ruleId}@${rule.ruleVersion}`)).toEqual([]);
  });

  it('never invents a URL for a notification that could not be retrieved', () => {
    const unverified = AMENDMENTS.filter((entry) => entry.verificationStatus !== 'VERIFIED');

    for (const amendment of unverified) {
      expect(amendment.officialSourceUrl).toBeUndefined();
      expect(amendment.verificationNote).toBeTruthy();
    }
  });

  it('points every rule and exception at a notification in the registry', () => {
    const known = new Set(AMENDMENTS.map((entry) => entry.notificationNumber));

    for (const rule of RULE_VERSIONS) expect(known.has(rule.source.notification)).toBe(true);
    for (const exception of RULE_EXCEPTIONS) expect(known.has(exception.source.notification)).toBe(true);
  });
});

describe('the amendment chain has no holes', () => {
  /**
   * Every notification closes by naming the one before it. That makes the
   * registry a linked list, and a break in it means an amendment nobody knows
   * about — the failure mode that would leave the corpus stating superseded law
   * with complete confidence.
   */
  it('resolves every "last amended vide" citation', () => {
    const known = new Set(AMENDMENTS.map((entry) => entry.notificationNumber));
    const broken = AMENDMENTS.filter(
      (entry) => entry.citesPreviousNotification && !known.has(entry.citesPreviousNotification),
    );

    expect(broken.map((entry) => `${entry.notificationNumber} → ${entry.citesPreviousNotification}`)).toEqual([]);
  });

  it('reaches the principal rules from the newest notification', () => {
    const byNumber = new Map(AMENDMENTS.map((entry) => [entry.notificationNumber, entry]));
    let current = byNumber.get('G.S.R. 418(E)');
    const visited: string[] = [];

    while (current?.citesPreviousNotification) {
      visited.push(current.notificationNumber);
      const next = byNumber.get(current.citesPreviousNotification);
      if (!next || visited.includes(next.notificationNumber)) break;
      current = next;
    }

    expect(current?.notificationNumber).toBe('G.S.R. 202(E)');
  });

  it('resolves every corrigendum it names', () => {
    const known = new Set(AMENDMENTS.map((entry) => entry.notificationNumber));

    for (const amendment of AMENDMENTS) {
      for (const correction of amendment.correctedBy ?? []) {
        expect(known.has(correction)).toBe(true);
      }
    }
  });
});

describe('the validator catches the defects it exists to catch', () => {
  const base = corpus.rules[0] as LegalRule;

  function withRules(rules: LegalRule[]) {
    return validateRuleSet({
      rules,
      exceptions: corpus.exceptions,
      amendments: corpus.amendments,
      ruleSetVersion: 'test',
      ruleSetChecksum: 'test',
      asOf: '2026-09-01',
      now: new Date('2026-09-01T00:00:00.000Z'),
    });
  }

  it('detects two versions in force at once', () => {
    const overlapping: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2020-01-01', effectiveTo: '2025-01-01', supersedes: undefined, supersededBy: undefined },
      { ...base, ruleId: 'X', ruleVersion: 'b', effectiveFrom: '2022-01-01', effectiveTo: null, supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(overlapping).conflicts.some((entry) => entry.code === 'OVERLAPPING_ACTIVE_VERSIONS')).toBe(true);
  });

  it('detects a hole between two versions', () => {
    const gapped: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2020-01-01', effectiveTo: '2021-01-01', supersedes: undefined, supersededBy: undefined },
      { ...base, ruleId: 'X', ruleVersion: 'b', effectiveFrom: '2023-01-01', effectiveTo: null, supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(gapped).conflicts.some((entry) => entry.code === 'GAP_BETWEEN_VERSIONS')).toBe(true);
  });

  it('detects an impossible date range', () => {
    const impossible: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2025-01-01', effectiveTo: '2024-01-01', supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(impossible).conflicts.some((entry) => entry.code === 'IMPOSSIBLE_DATE_RANGE')).toBe(true);
  });

  it('detects a superseded rule still marked active', () => {
    const stale: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2018-01-01', effectiveTo: '2020-01-01', status: 'ACTIVE', supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(stale).conflicts.some((entry) => entry.code === 'SUPERSEDED_RULE_STILL_ACTIVE')).toBe(true);
  });

  it('detects a duplicate version key', () => {
    const duplicated: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2020-01-01', effectiveTo: null, supersedes: undefined, supersededBy: undefined },
      { ...base, ruleId: 'X', ruleVersion: 'a', effectiveFrom: '2020-01-01', effectiveTo: null, supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(duplicated).conflicts.some((entry) => entry.code === 'DUPLICATE_RULE_VERSION')).toBe(true);
  });

  it('detects a missing source URL', () => {
    const unsourced: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', source: { ...base.source, officialUrl: undefined }, supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(unsourced).conflicts.some((entry) => entry.code === 'MISSING_SOURCE_URL')).toBe(true);
  });

  it('detects a reference to an exception that does not exist', () => {
    const dangling: LegalRule[] = [
      { ...base, ruleId: 'X', ruleVersion: 'a', exceptions: ['EX-DOES-NOT-EXIST'], supersedes: undefined, supersededBy: undefined },
    ];

    expect(withRules(dangling).conflicts.some((entry) => entry.code === 'UNKNOWN_EXCEPTION_REFERENCE')).toBe(true);
  });

  it('detects a break in the amendment chain', () => {
    const result = validateRuleSet({
      rules: [],
      exceptions: [],
      amendments: [{ ...corpus.amendments[0]!, citesPreviousNotification: 'G.S.R. 9999(E)' }],
      ruleSetVersion: 'test',
      ruleSetChecksum: 'test',
      now: new Date('2026-09-01T00:00:00.000Z'),
    });

    expect(result.conflicts.some((entry) => entry.code === 'AMENDMENT_CHAIN_BREAK')).toBe(true);
  });

  it('flags a future-effective rule marked active without treating it as an error', () => {
    const result = report();
    const future = result.conflicts.filter((entry) => entry.code === 'FUTURE_RULE_MARKED_ACTIVE');

    // The 2027 country-of-origin version. It is correctly excluded from every
    // evaluation before its date; the status is forward-looking, not wrong.
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((entry) => entry.severity === 'WARNING')).toBe(true);
  });
});

describe('recorded source conflicts', () => {
  it('carries the documents that disagree, and what each says', () => {
    for (const conflict of SOURCE_CONFLICTS) {
      expect(conflict.origin).toBe('SOURCE');
      expect(conflict.message.length).toBeGreaterThan(20);
      expect(conflict.interimResolution).toBeTruthy();
    }
  });

  it('records the G.S.R. 496(E) notification that could not be found', () => {
    const missing = SOURCE_CONFLICTS.find((entry) => entry.subjects.includes('G.S.R. 496(E)'));

    expect(missing?.code).toBe('NOTIFICATION_NOT_FOUND');
    expect(missing?.requiresManualVerification).toBe(true);
  });

  it('records the 29 May / 1 June commencement question on G.S.R. 418(E)', () => {
    const conflict = SOURCE_CONFLICTS.find((entry) => entry.subjects.includes('G.S.R. 418(E)'));

    expect(conflict?.code).toBe('NOTIFICATION_DATE_VS_PUBLICATION_DATE');
    expect(conflict?.interimResolution).toContain('conservative');
  });

  it('surfaces them in the report alongside the structural checks', () => {
    const result = report();
    expect(result.conflicts.filter((entry) => entry.origin === 'SOURCE').length).toBe(SOURCE_CONFLICTS.length);
    // A disagreement between two Gazettes is not a defect this system can fix,
    // so it must not make the corpus invalid.
    expect(result.valid).toBe(true);
  });
});

describe('the condition evaluator is safe against database-stored rules', () => {
  it('refuses to walk the prototype chain', () => {
    expect(resolvePath({}, '__proto__')).toBeUndefined();
    expect(resolvePath({}, 'constructor.prototype')).toBeUndefined();
    expect(evaluateCondition({ op: 'exists', path: 'constructor' }, {})).toBe(false);
  });

  it('treats an uncompilable regex as no match rather than throwing', () => {
    expect(evaluateCondition({ op: 'regex', path: 'a', value: '([' }, { a: 'x' })).toBe(false);
  });

  it('does not fire a numeric comparison against a value that was never read', () => {
    // The exemption for packages over 25 kg must not apply to a package whose
    // quantity nobody recorded.
    expect(evaluateCondition({ op: 'greaterThan', path: 'q', value: 25 }, {})).toBe(false);
    expect(evaluateCondition({ op: 'lessThanOrEqual', path: 'q', value: 10 }, {})).toBe(false);
  });

  it('treats a blank string as absent', () => {
    expect(evaluateCondition({ op: 'exists', path: 'a' }, { a: '   ' })).toBe(false);
    expect(evaluateCondition({ op: 'notExists', path: 'a' }, { a: '' })).toBe(true);
  });

  it('is stable across repeated evaluation of a regex condition', () => {
    // A `g` flag would carry lastIndex between calls and alternate.
    const condition = { op: 'regex' as const, path: 'a', value: '\\d+' };
    const results = [1, 2, 3, 4].map(() => evaluateCondition(condition, { a: 'abc 123' }));
    expect(results).toEqual([true, true, true, true]);
  });
});

describe('the corpus fingerprint', () => {
  it('is stable across loads', () => {
    expect(builtInCorpus().metadata.checksum).toBe(builtInCorpus().metadata.checksum);
  });

  it('names the latest notification in the rule-set version', () => {
    expect(corpus.metadata.ruleSetVersion).toBe('LM-PC-2026-05-29');
  });
});
