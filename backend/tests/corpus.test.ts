import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCases, runCase, scoreCase, summarise } from './corpus/runner';

/**
 * ── THE RATCHET ─────────────────────────────────────────────────────────────
 *
 * The corpus scored as a test, so a change that reads one label better and
 * three worse cannot land quietly.
 *
 * Two assertions, and they are not the same kind of assertion:
 *
 *   · No false finding, ever. A violation recorded against a package that
 *     does carry the declaration is a defect, not a score, and one failure
 *     fails the suite.
 *
 *   · Accuracy does not go down. The baseline lives in `corpus/baseline.json`
 *     and is meant to be raised deliberately, by a commit that says why.
 *
 * With no cases in the corpus this passes trivially. That is the intended
 * behaviour for a fresh checkout, and the reason the scorecard prints how to
 * add one instead of failing.
 *
 * These run against the *recorded* readings, not the OCR sidecar — see
 * `corpus/README.md`. Reading thirty labels for real takes minutes and needs a
 * service running, neither of which belongs in `npm test`.
 * ────────────────────────────────────────────────────────────────────────────
 */

const BASELINE_PATH = join(__dirname, 'corpus', 'baseline.json');

interface Baseline {
  fieldsCorrect: number;
  fieldsTotal: number;
  note?: string;
}

async function baseline(): Promise<Baseline | undefined> {
  try {
    const { readFileSync } = await import('node:fs');
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Baseline;
  } catch {
    return undefined;
  }
}

describe('the label corpus', () => {
  const cases = loadCases();

  it.runIf(cases.length > 0)(
    'never records a finding against a declaration the package carries',
    async () => {
      const scores = [];
      for (const labelCase of cases) scores.push(scoreCase(await runCase(labelCase)));

      const accused = scores
        .filter((score) => score.falseViolations.length > 0)
        .map((score) => `${score.slug}: ${score.falseViolations.join(', ')}`);

      // Named rather than counted: which package and which declaration is the
      // whole of the information needed to go and fix it.
      expect(accused).toEqual([]);
    },
    120_000,
  );

  it.runIf(cases.length > 0)(
    'reads at least as many declarations as the recorded baseline',
    async () => {
      const scores = [];
      for (const labelCase of cases) scores.push(scoreCase(await runCase(labelCase)));

      const total = summarise(scores);
      const recorded = await baseline();

      if (!recorded) {
        // First run on a fresh corpus. Nothing to compare against; the score is
        // printed so it can be written down.
        // eslint-disable-next-line no-console -- the number is the output.
        console.log(
          `corpus: ${total.correct}/${total.total} fields — write this to tests/corpus/baseline.json`,
        );
        return;
      }

      // Compared as a rate, so adding a hard package to the corpus does not
      // fail the build for having made the average worse.
      const rate = total.total === 0 ? 1 : total.correct / total.total;
      const was = recorded.fieldsTotal === 0 ? 1 : recorded.fieldsCorrect / recorded.fieldsTotal;

      expect(
        rate,
        `corpus accuracy fell from ${Math.round(was * 100)}% to ${Math.round(rate * 100)}% ` +
          `(${total.correct}/${total.total}). Run: npm run corpus -- --verbose`,
      ).toBeGreaterThanOrEqual(was - 0.001);
    },
    120_000,
  );

  it('loads without a corpus present', () => {
    // The guard the two tests above rely on: a fresh checkout has no cases and
    // must still have a green suite.
    expect(Array.isArray(cases)).toBe(true);
  });
});
