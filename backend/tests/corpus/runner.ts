import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

import { runScan, type ScanImageInput, type ScanOutcome } from '../../src/services/scan';
import {
  ocrProvider,
  type OCRImageInput,
  type OCRProvider,
  type OCRResult,
} from '../../src/services/ocr';

/**
 * ── THE LABEL CORPUS ────────────────────────────────────────────────────────
 *
 * Real photographs of real packages, each with a hand-written statement of
 * what the package actually says, scored by running the real pipeline.
 *
 * The reason this exists is that fixing extraction one package at a time does
 * not converge. Every label that came in exposed four defects; fixing them
 * risked four others in labels nobody was looking at any more, and there was
 * no way to tell — so the honest answer to "is it better than last week" was a
 * shrug. A number that goes up is worth more than any single fix.
 *
 * Two things are measured, and the second matters more:
 *
 *   accuracy       — how many declarations were read as printed
 *   false findings — how many violations were recorded against a package that
 *                    does declare the thing
 *
 * A missed declaration wastes an inspector's minute. A false finding is an
 * accusation, and one of those destroys the credibility of every report the
 * system has ever issued. They are not weighted the same and the scorecard
 * does not average them together.
 *
 * ── WHY THE OCR IS CACHED ───────────────────────────────────────────────────
 *
 * Reading thirty labels through the real sidecar takes minutes and needs it
 * running. Almost every defect found so far has been in *extraction* — the
 * stage after OCR — so the recorded reading is replayed by default and the
 * whole pipeline downstream of it runs for real, in milliseconds. Re-record
 * with `--live --record` when the OCR itself changes.
 * ────────────────────────────────────────────────────────────────────────────
 */

/* ── What a case declares ─────────────────────────────────────────────────── */

/**
 * How a field's expected value is stated.
 *
 * A plain string is compared as printed, loosely enough to survive the
 * punctuation an OCR pass moves around. `contains` is for the long ones — an
 * address is not worth transcribing exactly, but it is worth insisting that
 * the town and the PIN survived. `null` asserts absence, which is the whole
 * point on a package that declares its price on the carton.
 */
export type Expectation = string | null | { contains: string[] };

export interface CaseSpec {
  /** Human name of the package, for the scorecard. */
  package: string;
  /** Category as the capture flow would record it, since rules depend on it. */
  category?: string;
  inspectionDate?: string;
  images: Array<{ file: string; face: string }>;
  /** Keyed by field name — engine fields and informational alike. */
  fields: Record<string, Expectation>;
  /** Declarations the label says are printed on the carton, crimp or outer. */
  declaredElsewhere?: string[];
  /**
   * Fields that must never come back as a potential violation.
   *
   * The strongest assertion in the file, and the reason to write a case at
   * all: this package declares these, so a finding against them is the system
   * accusing a compliant trader.
   */
  mustNotViolate?: string[];
  /** Free text. Why this package is in the corpus, what is unusual about it. */
  notes?: string;
}

export interface LabelCase extends CaseSpec {
  /** Directory name — the case's id in the scorecard. */
  slug: string;
  dir: string;
}

/* ── Loading ──────────────────────────────────────────────────────────────── */

/**
 * Where the cases live.
 *
 * Resolved by walking up from the working directory rather than from
 * `__dirname`, which is not the same thing under every runner this is invoked
 * by: vitest gives the module's own directory, and `tsx` on an `.mts` entry
 * gives `data:text`, so the corpus silently looked empty when run from the
 * CLI. The walk makes both work, and `npm run corpus` from a subdirectory too.
 */
export const CORPUS_DIR = (() => {
  let dir = process.cwd();

  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = join(dir, 'tests', 'corpus');
    if (existsSync(candidate)) return candidate;
    dir = join(dir, '..');
  }

  return join(process.cwd(), 'tests', 'corpus');
})();

/** Every case directory holding an `expected.json`, in name order. */
export function loadCases(dir: string = CORPUS_DIR): LabelCase[] {
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((entry) => !entry.startsWith('_') && !entry.startsWith('.'))
    .filter((entry) => statSync(join(dir, entry)).isDirectory())
    .filter((entry) => existsSync(join(dir, entry, 'expected.json')))
    .sort()
    .map((slug) => {
      const caseDir = join(dir, slug);
      const spec = JSON.parse(readFileSync(join(caseDir, 'expected.json'), 'utf8')) as CaseSpec;
      return { ...spec, slug, dir: caseDir };
    });
}

/**
 * A stable id for one photograph.
 *
 * Derived from the file name so a recorded reading still matches its image
 * after the cache is regenerated, and so a diff of `ocr.json` is readable.
 */
export function imageIdFor(file: string): string {
  return `img_${basename(file, extname(file)).replace(/[^A-Za-z0-9]+/g, '_')}`;
}

/* ── The recorded reading ─────────────────────────────────────────────────── */

interface OCRCache {
  recordedAt: string;
  provider: string;
  providerVersion?: string;
  /** Hash of the image bytes, so a replaced photograph is detected. */
  images: Array<OCRResult & { sourceHash: string }>;
}

const cachePath = (labelCase: LabelCase): string => join(labelCase.dir, 'ocr.json');

function hashOf(buffer: Buffer): string {
  return createHash('sha1').update(buffer).digest('hex').slice(0, 16);
}

/**
 * Replays a recorded reading.
 *
 * Everything downstream — extraction, the adapter, the rule engine, the issue
 * generator — runs exactly as it does in production. Only the sidecar is
 * substituted, which is the point of `OCRProvider` existing at all.
 */
class ReplayOCRProvider implements OCRProvider {
  readonly name: string;
  readonly version: string;

  constructor(private readonly cache: OCRCache) {
    this.name = cache.provider;
    this.version = cache.providerVersion ?? 'recorded';
  }

  extractText(image: OCRImageInput): Promise<OCRResult> {
    const recorded = this.cache.images.find((entry) => entry.imageId === image.imageId);

    if (!recorded) {
      return Promise.reject(
        new Error(
          `No recorded reading for ${image.imageId}. Re-record with: npm run corpus -- --live --record`,
        ),
      );
    }

    return Promise.resolve(recorded);
  }

  isConfigured(): boolean {
    return true;
  }

  configurationHint(): string | null {
    return null;
  }
}

/* ── Running one case ─────────────────────────────────────────────────────── */

export interface RunOptions {
  /** Read the photographs through the configured OCR provider, not the cache. */
  live?: boolean;
  /** Write the reading back to `ocr.json`. Implies `live`. */
  record?: boolean;
}

export interface CaseRun {
  labelCase: LabelCase;
  outcome?: ScanOutcome;
  /** Set when the scan could not complete at all. */
  error?: string;
  /** True when the reading came from the sidecar rather than the cache. */
  live: boolean;
}

export async function runCase(labelCase: LabelCase, options: RunOptions = {}): Promise<CaseRun> {
  const live = options.live === true || options.record === true;

  const images: ScanImageInput[] = labelCase.images.map((image) => {
    const path = join(labelCase.dir, image.file);
    if (!existsSync(path)) {
      throw new Error(`${labelCase.slug}: expected.json names ${image.file}, which is not there.`);
    }

    return {
      imageId: imageIdFor(image.file),
      buffer: readFileSync(path),
      mimeType: extname(image.file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
      face: image.face,
    };
  });

  let provider: OCRProvider;

  if (live) {
    provider = ocrProvider;
  } else {
    const path = cachePath(labelCase);
    if (!existsSync(path)) {
      return {
        labelCase,
        live: false,
        error: 'No recorded reading. Run: npm run corpus -- --live --record',
      };
    }

    const cache = JSON.parse(readFileSync(path, 'utf8')) as OCRCache;

    // A photograph swapped under a stale reading would score the old picture.
    for (const image of images) {
      const recorded = cache.images.find((entry) => entry.imageId === image.imageId);
      if (recorded && recorded.sourceHash !== hashOf(image.buffer)) {
        return {
          labelCase,
          live: false,
          error: `${image.imageId} has changed since it was recorded. Re-record with --live --record`,
        };
      }
    }

    provider = new ReplayOCRProvider(cache);
  }

  const readings: OCRResult[] = [];
  const recordingProvider: OCRProvider = {
    name: provider.name,
    version: provider.version,
    isConfigured: () => provider.isConfigured(),
    configurationHint: () => provider.configurationHint(),
    extractText: async (image) => {
      const result = await provider.extractText(image);
      readings.push(result);
      return result;
    },
  };

  let run: CaseRun;

  try {
    const outcome = await runScan({
      inspectionId: `CORPUS-${labelCase.slug}`,
      inspectionDate: labelCase.inspectionDate ?? '2026-01-01',
      productContext: labelCase.category ? { category: labelCase.category } : {},
      images,
      provider: recordingProvider,
      // Nothing about a corpus run belongs in the audit trail.
      persistEvaluation: false,
    });

    run = { labelCase, outcome, live };
  } catch (error) {
    run = { labelCase, live, error: error instanceof Error ? error.message : String(error) };
  }

  if (options.record && readings.length > 0) {
    const byId = new Map(images.map((image) => [image.imageId, hashOf(image.buffer)]));

    const cache: OCRCache = {
      recordedAt: new Date().toISOString(),
      provider: provider.name,
      providerVersion: provider.version,
      images: readings.map((reading) => ({
        ...reading,
        sourceHash: byId.get(reading.imageId) ?? '',
      })),
    };

    writeFileSync(cachePath(labelCase), `${JSON.stringify(cache, null, 2)}\n`, 'utf8');
  }

  return run;
}

/* ── Scoring ──────────────────────────────────────────────────────────────── */

export interface FieldScore {
  field: string;
  ok: boolean;
  expected: Expectation;
  actual: string | null;
}

export interface CaseScore {
  slug: string;
  package: string;
  error?: string;
  fields: FieldScore[];
  correct: number;
  total: number;
  /** Fields the case says are declared, which came back as a violation anyway. */
  falseViolations: string[];
  /** Declarations the label points elsewhere for, that the system did not spot. */
  missedPointers: string[];
}

/**
 * Loose enough to survive OCR, strict enough to catch a wrong reading.
 *
 * Case and surrounding punctuation are ignored, and runs of whitespace are
 * collapsed: `50 g` and `50 G.` are the same declaration, and no inspector
 * would say otherwise. Nothing beyond that is normalised — `249403` and
 * `24940` are different PIN codes and the corpus has to notice.
 */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .trim();
}

function matches(expected: Expectation, actual: string | null): boolean {
  if (expected === null) return actual === null || actual.trim() === '';
  if (actual === null) return false;

  if (typeof expected === 'string') return normalise(actual) === normalise(expected);

  const haystack = normalise(actual);
  return expected.contains.every((needle) => haystack.includes(normalise(needle)));
}

/** The value the pipeline produced for a field, from either bucket. */
function actualValue(outcome: ScanOutcome, field: string): string | null {
  const record = outcome.extraction.fields[field] ?? outcome.extraction.informational[field];
  const value = record?.value;
  return value === undefined || value === null || String(value).trim() === '' ? null : String(value);
}

export function scoreCase(run: CaseRun): CaseScore {
  const { labelCase, outcome } = run;

  const base: CaseScore = {
    slug: labelCase.slug,
    package: labelCase.package,
    fields: [],
    correct: 0,
    total: Object.keys(labelCase.fields).length,
    falseViolations: [],
    missedPointers: [],
  };

  if (!outcome) return { ...base, error: run.error ?? 'the scan produced no result', correct: 0 };

  const fields: FieldScore[] = Object.entries(labelCase.fields).map(([field, expected]) => {
    const actual = actualValue(outcome, field);
    return { field, expected, actual, ok: matches(expected, actual) };
  });

  const violated = new Set(
    outcome.issues
      .filter((issue) => issue.classification === 'POTENTIAL_VIOLATION')
      .map((issue) => issue.field)
      .filter((field): field is string => typeof field === 'string'),
  );

  const declared = new Set(outcome.extraction.declaredElsewhere);

  return {
    ...base,
    fields,
    correct: fields.filter((field) => field.ok).length,
    falseViolations: (labelCase.mustNotViolate ?? []).filter((field) => violated.has(field)),
    missedPointers: (labelCase.declaredElsewhere ?? []).filter((field) => !declared.has(field)),
  };
}

export interface CorpusScore {
  cases: CaseScore[];
  correct: number;
  total: number;
  falseViolations: number;
  failed: number;
}

export function summarise(scores: CaseScore[]): CorpusScore {
  return {
    cases: scores,
    correct: scores.reduce((sum, score) => sum + score.correct, 0),
    total: scores.reduce((sum, score) => sum + score.total, 0),
    falseViolations: scores.reduce((sum, score) => sum + score.falseViolations.length, 0),
    failed: scores.filter((score) => score.error).length,
  };
}

/** Runs and scores every case. */
export async function scoreCorpus(
  options: RunOptions & { only?: string } = {},
): Promise<CorpusScore> {
  const cases = loadCases().filter(
    (labelCase) => !options.only || labelCase.slug.includes(options.only),
  );

  const scores: CaseScore[] = [];
  for (const labelCase of cases) {
    scores.push(scoreCase(await runCase(labelCase, options)));
  }

  return summarise(scores);
}
