/**
 * The corpus scorecard.
 *
 *   npm run corpus                      score against the recorded readings
 *   npm run corpus -- --live            read the photographs through the sidecar
 *   npm run corpus -- --live --record   …and save the readings for next time
 *   npm run corpus -- --case minimalist just the cases whose slug matches
 *   npm run corpus -- --verbose         print every field, not only the misses
 *
 * See `tests/corpus/README.md` for how to add a package.
 */

import { loadCases, scoreCase, runCase, summarise, type CaseScore } from '../tests/corpus/runner';

const argv = process.argv.slice(2);
const has = (flag: string): boolean => argv.includes(flag);
const value = (flag: string): string | undefined => {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
};

const live = has('--live') || has('--record');
const record = has('--record');
const verbose = has('--verbose');
const only = value('--case');

/* ── Formatting ───────────────────────────────────────────────────────────── */

const RESET = '[0m';
const paint = (code: string, text: string): string =>
  process.stdout.isTTY ? `${code}${text}${RESET}` : text;

const red = (text: string): string => paint('[31m', text);
const green = (text: string): string => paint('[32m', text);
const yellow = (text: string): string => paint('[33m', text);
const dim = (text: string): string => paint('[2m', text);
const bold = (text: string): string => paint('[1m', text);

const pad = (text: string, width: number): string =>
  text.length >= width ? text.slice(0, width) : text.padEnd(width);

function show(value: string | null): string {
  if (value === null) return dim('not detected');
  return JSON.stringify(value.length > 52 ? `${value.slice(0, 52)}…` : value);
}

function expectedOf(score: CaseScore['fields'][number]): string {
  const { expected } = score;
  if (expected === null) return dim('nothing');
  if (typeof expected === 'string') return JSON.stringify(expected);
  return `contains ${expected.contains.map((part) => JSON.stringify(part)).join(' + ')}`;
}

/* ── Run ──────────────────────────────────────────────────────────────────── */

const cases = loadCases().filter((labelCase) => !only || labelCase.slug.includes(only));

if (cases.length === 0) {
  console.log(`
No cases in the corpus yet.

Add one:

  backend/tests/corpus/<package-slug>/
      front.jpg
      back.jpg
      expected.json      ← what the package actually says, written by hand

Then record the reading once:

  npm run corpus -- --live --record

See backend/tests/corpus/README.md.
`);
  process.exit(0);
}

console.log(
  `\n${bold('Label corpus')} — ${cases.length} package${cases.length === 1 ? '' : 's'}, ` +
    `${live ? 'reading through the OCR sidecar' : 'replaying recorded readings'}` +
    `${record ? ', recording' : ''}\n`,
);

const scores: CaseScore[] = [];

for (const labelCase of cases) {
  process.stdout.write(dim(`  reading ${labelCase.slug}…\r`));
  scores.push(scoreCase(await runCase(labelCase, { live, record })));
}

const total = summarise(scores);

/* ── Per case ─────────────────────────────────────────────────────────────── */

console.log(`  ${bold(pad('PACKAGE', 34))}${pad('FIELDS', 12)}${pad('FALSE FINDINGS', 16)}`);
console.log(`  ${dim('─'.repeat(62))}`);

for (const score of scores) {
  if (score.error) {
    console.log(`  ${pad(score.slug, 34)}${red('could not run')}  ${dim(score.error)}`);
    continue;
  }

  const ratio = `${score.correct}/${score.total}`;
  const clean = score.correct === score.total;
  const bad = score.falseViolations.length;

  console.log(
    `  ${pad(score.slug, 34)}` +
      pad(clean ? green(ratio) : yellow(ratio), clean || !process.stdout.isTTY ? 12 : 21) +
      (bad > 0 ? red(String(bad)) : green('0')),
  );
}

console.log(`  ${dim('─'.repeat(62))}`);

const percent = total.total === 0 ? 0 : Math.round((total.correct / total.total) * 100);
console.log(
  `  ${bold(pad('TOTAL', 34))}${pad(`${total.correct}/${total.total} (${percent}%)`, 12)}` +
    `${total.falseViolations > 0 ? red(String(total.falseViolations)) : green('0')}\n`,
);

/* ── What went wrong ──────────────────────────────────────────────────────── */

for (const score of scores) {
  const misses = score.fields.filter((field) => !field.ok);
  const interesting = verbose ? score.fields : misses;

  if (interesting.length === 0 && score.falseViolations.length === 0 && score.missedPointers.length === 0) {
    continue;
  }

  console.log(`  ${bold(score.slug)} ${dim(`— ${score.package}`)}`);

  for (const field of interesting) {
    const mark = field.ok ? green('✓') : red('✗');
    console.log(
      `    ${mark} ${pad(field.field, 20)} got ${show(field.actual)}` +
        (field.ok ? '' : `  ${dim('expected')} ${expectedOf(field)}`),
    );
  }

  for (const field of score.falseViolations) {
    console.log(
      `    ${red('!')} ${pad(field, 20)} ${red('recorded as a potential violation')} ` +
        dim('— the package declares this'),
    );
  }

  for (const field of score.missedPointers) {
    console.log(
      `    ${yellow('?')} ${pad(field, 20)} ${yellow('pointer not recognised')} ` +
        dim('— the label says this is printed elsewhere'),
    );
  }

  console.log('');
}

/**
 * A false finding fails the run on its own.
 *
 * Accuracy is a number to improve; an accusation against a compliant trader is
 * a defect, and the exit code says so whatever the percentage is.
 */
if (total.falseViolations > 0 || total.failed > 0) process.exit(1);
