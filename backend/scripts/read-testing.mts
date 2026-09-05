import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { runScan } from '../src/services/scan';
import { ocrProvider } from '../src/services/ocr';
import type { ScanImageInput } from '../src/services/scan';

/**
 * ── READ A FOLDER OF PACKETS, AND SAY WHAT WAS READ ─────────────────────────
 *
 *     npm run testing
 *     npm run testing -- --only maggi
 *
 * Point it at photographs of real packages and it runs the whole pipeline —
 * PaddleOCR, extraction, the Legal Metrology rule engine — printing what each
 * declaration came back as and what the engine decided.
 *
 * ── Why this is not the corpus ─────────────────────────────────────────────
 *
 * `npm run corpus` *scores*. It compares what was read against a hand-written
 * statement of what the package actually says, and a score is only worth
 * anything because that statement was written by a person reading the packet.
 *
 * This does not score, because it has nothing to score against. It reports.
 * That is the right tool for the first pass over twenty new packets: you have
 * the packet in your hand, the reading is on the screen, and you can see in a
 * second which declarations came back wrong. Writing twenty `expected.json`
 * files before finding out whether anything works at all is the wrong order.
 *
 * When a package reads badly, that is the one worth promoting into the corpus —
 * see `tests/corpus/README.md`. A corpus case is a permanent guard: it fails
 * the build if a later change breaks that package again. Everything here is
 * transient by design.
 *
 * ── What it needs ──────────────────────────────────────────────────────────
 *
 * The OCR sidecar on :8001. Nothing else — no database, no server, no login.
 * ────────────────────────────────────────────────────────────────────────────
 */

const ROOT = resolve(process.cwd(), '..', 'testing');
const IMAGE_TYPES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic']);

const only = process.argv.includes('--only')
  ? process.argv[process.argv.indexOf('--only') + 1]?.toLowerCase()
  : undefined;

if (!existsSync(ROOT)) {
  console.error(`No testing folder at ${ROOT}. Create it and put one folder per package inside.`);
  process.exit(1);
}

/**
 * Which face a photograph shows, from its file name.
 *
 * The face is not cosmetic: `captureCompleteness` is derived from how much of
 * the package was photographed, and the rule engine will not record a
 * declaration as *missing* from a package it has only seen one side of. A folder
 * of files called `1.jpg`, `2.jpg` would therefore be judged as one face seen
 * four times, so the name is read for a hint and everything unrecognised counts
 * as an additional face rather than as another front.
 */
function faceOf(file: string): ScanImageInput['face'] {
  const name = file.toLowerCase();
  if (name.includes('front')) return 'FRONT';
  if (name.includes('back')) return 'BACK';
  if (name.includes('side')) return 'SIDE';
  return 'ADDITIONAL';
}

const packages = readdirSync(ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_') && !entry.name.startsWith('.'))
  .map((entry) => entry.name)
  .filter((name) => !only || name.toLowerCase().includes(only))
  .sort();

if (packages.length === 0) {
  console.log(`Nothing to read in ${ROOT}.`);
  console.log('Make one folder per package and put its photographs inside. See testing/README.md.');
  process.exit(0);
}

console.log(`Reading ${packages.length} package(s) from testing/\n`);

/**
 * Scoring, where the folder says what the package holds.
 *
 * A `truth.json` beside the photographs turns a readout into a measurement.
 * Three outcomes, and they are deliberately not weighted the same:
 *
 *   · **correct** — the value is there and matches.
 *   · **missed** — the declaration is on the package and came back empty.
 *     Costly: the rule engine then has to decide whether an absence is a
 *     violation, and on a well-photographed package it will say it is.
 *   · **wrong** — a value came back and it is not what the package says, or a
 *     value came back for a declaration the package does not carry at all.
 *     The worst outcome by a distance: it is a figure that reaches a report,
 *     and an invented MRP is an accusation nobody can defend.
 *
 * So `wrong` is reported separately and never folded into an accuracy figure.
 * A system that reads eighteen of twenty correctly and invents two is not a
 * ninety-per-cent system.
 */
interface Truth {
  package: string;
  conditions?: string[];
  declarations: Record<string, string | null>;
}

function loadTruth(dir: string): Truth | undefined {
  const path = join(dir, 'truth.json');
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Truth;
  } catch {
    return undefined;
  }
}

/**
 * Whether a reading carries the expected value.
 *
 * Containment rather than equality, because the extractor deliberately keeps
 * the declaration's own wording: rule 6(1)(e) required the price to identify
 * itself as a maximum retail price, so `mrp` comes back as
 * "M.R.P. ₹245.00 (incl. of all taxes)" and the fact being checked is the 245.
 * Case and spacing are normalised for the same reason.
 */
function matches(read: string, expected: string): boolean {
  const flat = (value: string) => value.toLowerCase().replace(/[\s,]/g, '');
  return flat(read).includes(flat(expected));
}

let correct = 0;
let missed = 0;
let wrong = 0;
let scored = 0;

let readCount = 0;
let declarationCount = 0;

for (const slug of packages) {
  const dir = join(ROOT, slug);
  const files = readdirSync(dir).filter((file) => IMAGE_TYPES.has(extname(file).toLowerCase()));

  if (files.length === 0) {
    console.log(`${slug}\n  no images in this folder\n`);
    continue;
  }

  const images: ScanImageInput[] = files.map((file, index) => ({
    imageId: `img_${index}_${file.replace(/\W+/g, '_')}`,
    buffer: readFileSync(join(dir, file)),
    mimeType: extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg',
    face: faceOf(file),
  }));

  process.stdout.write(`${slug} — ${files.length} image(s), reading…`);

  try {
    const outcome = await runScan({
      inspectionId: `TESTING-${slug}`,
      inspectionDate: new Date().toISOString().slice(0, 10),
      productContext: {},
      images,
      provider: ocrProvider,
      // Nothing about a scratch read belongs in the audit trail.
      persistEvaluation: false,
    });

    process.stdout.write('\r'.padEnd(60, ' '));
    console.log(`\r${slug}`);
    console.log(`  ${outcome.ocr.lineCount} lines read · verdict ${outcome.compliance.status}`);

    const fields = { ...outcome.extraction.fields, ...outcome.extraction.informational };
    const truth = loadTruth(dir);

    // Where truth is known, report against it and say nothing about the
    // declarations it does not mention — a synthetic panel carries what it was
    // told to carry, and scoring the rest would score the generator.
    const names = truth
      ? Object.keys(truth.declarations).sort()
      : Object.keys(fields).sort();

    for (const name of names) {
      const value = fields[name]?.value ?? null;
      declarationCount += 1;
      if (value) readCount += 1;

      if (!truth) {
        console.log(`    ${name.padEnd(22)} ${value ? `"${String(value).slice(0, 52)}"` : '— not found'}`);
        continue;
      }

      const expected = truth.declarations[name] ?? null;
      scored += 1;

      let mark: string;
      if (expected === null) {
        // The package does not carry it. Reading one is an invention.
        if (value === null) {
          mark = '  ok  not on pack';
          correct += 1;
        } else {
          mark = '  WRONG  invented';
          wrong += 1;
        }
      } else if (value === null) {
        mark = '  MISS';
        missed += 1;
      } else if (matches(String(value), expected)) {
        mark = '  ok';
        correct += 1;
      } else {
        mark = `  WRONG  expected ${expected}`;
        wrong += 1;
      }

      console.log(
        `    ${name.padEnd(22)} ${(value ? `"${String(value).slice(0, 40)}"` : '—').padEnd(44)}${mark}`,
      );
    }

    const failed = outcome.compliance.checks.filter((check) => check.status === 'VIOLATION_DETECTED');
    if (failed.length > 0) {
      console.log(`  findings: ${failed.map((check) => check.ruleId).join(', ')}`);
    }
    console.log('');
  } catch (error) {
    process.stdout.write('\r'.padEnd(60, ' '));
    console.log(`\r${slug}`);
    console.log(`  FAILED — ${error instanceof Error ? error.message : String(error)}`);
    console.log('  Is the OCR sidecar running on :8001?  npm run dev:ocr\n');
  }
}

console.log('─'.repeat(72));

if (scored > 0) {
  console.log(`  correct   ${String(correct).padStart(3)}  of ${scored} declarations with known truth`);
  console.log(`  missed    ${String(missed).padStart(3)}  on the package and not read`);
  console.log(`  wrong     ${String(wrong).padStart(3)}  read as something the package does not say`);
  console.log('');
  console.log(`  ${Math.round((correct / scored) * 100)}% correct.`);

  if (wrong > 0) {
    console.log('');
    console.log('  Every WRONG above is worth more attention than every MISS: a missed');
    console.log('  declaration is a gap, an invented one is a figure that reaches a report.');
  }
} else {
  console.log(`${readCount} of ${declarationCount} declaration slots came back with a value.`);
  console.log('');
  console.log('That fraction is not an accuracy figure — a value can be read and be wrong.');
  console.log('Put a truth.json beside the photographs to have this scored, or check each');
  console.log('one against the packet in your hand.');
}

console.log('');
console.log('Where a package reads badly, promote it into backend/tests/corpus/ so the');
console.log('build fails if a later change breaks it again.');
