/** `[x1, y1, x2, y2]` in the analysis coordinate space. */
type Box = [number, number, number, number];

/**
 * ── THE CODING STRIP ────────────────────────────────────────────────────────
 *
 * Almost every Indian FMCG pack carries its statutory values not in the printed
 * artwork but in a strip applied on the line, by an inkjet coder, onto a white
 * label patch. It looks like this:
 *
 *     MRP        PKD.          USE BY        B.NO.
 *     (inclusive of all taxes)
 *       398.00   26/06/2026    25/03/2027    B19260626   16:25
 *       USP 0.50/g
 *
 * The headers are pre-printed with the artwork; the values are sprayed on
 * afterwards. Four of the six mandatory declarations under rule 6(1) live here
 * — the price, the packing date, the use-by date and the batch — and on a real
 * photograph of a real packet this extractor scored two out of ten.
 *
 * ── Why the ordinary matcher cannot read it ────────────────────────────────
 *
 * `neighboursOf` pairs a label with the value to its right or below it, which
 * is the correct rule for a label printed with its value. A coding strip is not
 * that. It is a table whose two rows were printed by two different machines,
 * and their columns do not line up. Measured on the Bagrry's pack:
 *
 *     header  MRP     x   55     value  398.00       x  191
 *     header  PKD.    x  445     value  26/06/2026   x  330
 *     header  USE BY  x  806     value  25/03/2027   x  587
 *     header  B.NO.   x 1197     value  B19260626    x  839
 *
 * The drift is systematic and it grows: by the fourth column the value sits
 * 358 pixels to the *left* of the header it belongs to, further left than the
 * previous header. Any rule based on overlap or proximity gets the fourth
 * column wrong, and most of them get the third wrong too.
 *
 * ── What does work ─────────────────────────────────────────────────────────
 *
 * Order, checked against shape. The coder prints its values left to right in
 * the same sequence as the headers, and each header expects a value of a known
 * kind: a price is an amount, PKD and USE BY are dates, B.NO is a code. So the
 * headers are read in order, the values are read in order, and each value is
 * accepted only if it has the shape its header asks for.
 *
 * That survives the drift entirely, because it never looks at x at all beyond
 * sorting. It also survives the strip being photographed at an angle, which
 * every one of them is.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** One line, as the extraction service holds it. */
export interface StripLine {
  index: number;
  text: string;
  raw: string;
  box?: Box;
}

export interface StripReading {
  field: string;
  value: string;
  /** The lines that produced it, so the caller can claim them and cite them. */
  lines: StripLine[];
}

/**
 * What each pre-printed header is asking for.
 *
 * The spellings are what a recogniser returns from a coding strip, not what a
 * typesetter wrote: `MRP` comes back as `MRPR` when the rupee glyph beside it
 * is folded in, `B.NO.` as `BLNO` or `B.N0`, `USP` as `ISPO` when the U is read
 * as an I and the trailing zero of `0.50` is pulled into the header. Matching
 * loosely here costs nothing, because a header only ever selects which *shape*
 * to look for next — a wrong guess yields no value rather than a wrong one.
 */
type Shape = 'amount' | 'date' | 'code' | 'unitPrice';

interface HeaderSpec {
  field: string;
  shape: Shape;
  pattern: RegExp;
}

/**
 * Every pattern is anchored at both ends, and that is the whole safety of this
 * module.
 *
 * A coding-strip header is a bare token printed above the empty space the coder
 * will spray into: `MRP`, `PKD.`, `USE BY`, `B.NO.`. It is never a sentence and
 * it never carries its own value.
 *
 * The first version matched `^mrp\b`, unanchored — so it fired on
 * `MRP <rupee>315.00 (incl. of all taxes)`, which is an ordinary printed
 * declaration with its value right there, and then went looking for the "value"
 * on the row below. It found the unit sale price and recorded 63.00 as the
 * maximum retail price of a five kilo bag of atta. Five API tests and nine of
 * the twenty synthetic labels went with it.
 *
 * That is the failure this module has to be held away from: it exists for a
 * layout the ordinary matcher cannot read, and it must never reach a layout the
 * ordinary matcher reads correctly. Anchoring is the guarantee — a line
 * carrying its own value cannot be a header.
 */
const HEADERS: HeaderSpec[] = [
  { field: 'mrp', shape: 'amount', pattern: /^m\.?\s*r\.?\s*p\.?\s*r?\.?$/i },
  { field: 'unit_sale_price', shape: 'unitPrice', pattern: /^[iu]\s?s\s?p\s?[o0]?\.?$/i },
  { field: 'manufacturing_date', shape: 'date', pattern: /^p\.?\s*k\s?d\.?$|^mfd\.?$|^mfg\.?$/i },
  {
    field: 'best_before',
    shape: 'date',
    pattern: /^use\s*by$|^best\s*before$|^bb\.?$|^exp\.?$|^expiry$|^use\s*before$/i,
  },
  { field: 'batch_number', shape: 'code', pattern: /^b\.?\s*l?\s*n[o0]\.?$/i },
];

/**
 * A header is short.
 *
 * A second guard behind the anchoring, because a recogniser that merges a
 * header with noise beside it can still produce something an anchored pattern
 * accepts. Nothing in the list above is longer than `BEST BEFORE`.
 */
const HEADER_MAX_LENGTH = 14;

/* ── Shapes ───────────────────────────────────────────────────────────────── */

/**
 * A coded amount, with the specks the printer leaves in it.
 *
 * `398.00` came off this packet as `398.'00`: the inkjet drops a stray dot
 * between the rupees and the paise often enough that an amount pattern
 * insisting on a clean decimal point matches nothing at all. The junk class is
 * deliberately tiny — an apostrophe, a comma, a colon, a stop, a space — and
 * bounded to three characters, because anything longer is two values rather
 * than one that got dirty.
 */
const AMOUNT = /\d{1,3}(?:[,\d]{0,9})?[.,][\s'`:.]{0,3}\d{2}\b|\b\d{2,5}\b/;

/** Strips those specks back out, so what is stored is the figure. */
function cleanAmount(text: string): string {
  return text.replace(/([.,])[\s'`:.]{0,3}(\d{2})\b/, '.$2').replace(/\s+/g, '');
}
const DATE = /\b\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}\b|\b\d{1,2}\s*[/.\-]\s*\d{4}\b/;
const CODE = /\b[A-Z]{1,3}\d{4,}[A-Z0-9]*\b|\b[A-Z0-9]{2,}[-/][A-Z0-9]{2,}\b/;

/**
 * `0.50/g`, and the state it arrives in.
 *
 * The unit is the character a recogniser is least likely to get right on a
 * coded strip — `/g` comes back as `/9` about as often as not, and `/ml` as
 * `/mI`. It is also the character that makes this a unit sale price rather than
 * a price, so it cannot simply be dropped.
 */
const UNIT_PRICE = /(\d+(?:\.\d+)?)\s*\/\s*([gq9]|ml|mi|m1|kg|k9|l|ltr|n)\b/i;

const UNIT_REPAIR: Record<string, string> = {
  g: 'g', q: 'g', '9': 'g',
  ml: 'ml', mi: 'ml', m1: 'ml',
  kg: 'kg', k9: 'kg',
  l: 'l', ltr: 'l', n: 'N',
};

function hasShape(text: string, shape: Shape): boolean {
  switch (shape) {
    case 'amount':
      // A date is also digits and dots. Rejecting it here is what stops
      // `26/06/2026` being taken as the price when the coder skipped one.
      return AMOUNT.test(text) && !DATE.test(text);
    case 'date':
      return DATE.test(text);
    case 'code':
      return CODE.test(text);
    case 'unitPrice':
      return UNIT_PRICE.test(text);
  }
}

function valueOfShape(text: string, shape: Shape): string | null {
  if (shape === 'unitPrice') {
    const match = UNIT_PRICE.exec(text);
    if (!match?.[1] || !match[2]) return null;
    const unit = UNIT_REPAIR[match[2].toLowerCase()];
    return unit ? `${match[1]}/${unit}` : null;
  }

  const pattern = shape === 'amount' ? AMOUNT : shape === 'date' ? DATE : CODE;
  const match = pattern.exec(text);
  if (!match) return null;

  if (shape === 'amount') return cleanAmount(match[0].trim());

  if (shape === 'date') {
    // `26/06-2026`. A coder prints one separator and the recogniser returns
    // whichever of `/`, `-` and `.` the ink happened to look like, sometimes
    // both within one date. The separator carries no meaning — the three
    // numbers do — so it is normalised rather than preserved, which is what
    // lets the rule engine's date validator see a date at all.
    return match[0].trim().replace(/\s*[.\-]\s*/g, '/').replace(/\s+/g, '');
  }

  return match[0].trim();
}

/* ── Splitting what the coder ran together ───────────────────────────────── */

/**
 * `398.'0026/06-2026` — one detected line holding two declarations.
 *
 * The coder leaves a wide gap between columns and the detector still merged
 * them, because on a low-contrast strip the space between two sprayed values is
 * not obviously wider than the space inside one. Left merged, the price and the
 * packing date are both lost: the blob is neither an amount nor a date.
 *
 * Split on the boundary between a decimal amount and a date, which is the one
 * place two coded values reliably abut. Everything else is left alone —
 * splitting on any digit run would take `16:25` apart, and a time is not two
 * numbers.
 */
const MERGED_AMOUNT_DATE =
  /^(.*?\d{1,3}(?:[,\d]{0,9})?[.,][\s'`:.]{0,3}\d{2})\D{0,3}(\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}.*)$/;

export function splitMergedCodedValue(text: string): string[] {
  const match = MERGED_AMOUNT_DATE.exec(text);
  if (!match?.[1] || !match[2]) return [text];
  return [match[1].trim(), match[2].trim()];
}

/* ── Reading the strip ────────────────────────────────────────────────────── */

/** Vertical midpoint of a line, for grouping into rows. */
function midY(line: StripLine): number | undefined {
  if (!line.box) return undefined;
  return (line.box[1] + line.box[3]) / 2;
}

function heightOf(line: StripLine): number {
  if (!line.box) return 0;
  return Math.abs(line.box[3] - line.box[1]);
}

/**
 * Reads a coding strip out of a page of lines, if there is one.
 *
 * Returns nothing at all unless at least two headers were found together — one
 * header alone is a word on a packet, and treating it as a strip would let this
 * claim values the ordinary matcher reads better.
 */
export function readCodingStrip(lines: StripLine[]): StripReading[] {
  const located = lines.filter((line) => line.box && line.text.trim() !== '');
  if (located.length === 0) return [];

  /* The headers, and which row they sit on. */
  const headers = located
    .map((line) => {
      const text = line.text.trim();
      if (text.length > HEADER_MAX_LENGTH) return undefined;
      const spec = HEADERS.find((candidate) => candidate.pattern.test(text));
      return spec ? { line, spec, y: midY(line) ?? 0, x: line.box![0] } : undefined;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);

  if (headers.length < 2) return [];

  /*
   * Group the headers into a band.
   *
   * A pack says `PKD.` in its coding strip and `(INDICATING B.NO. & PKD.)` in
   * its complaints paragraph four inches below. Only the ones printed on the
   * same line as each other are a strip, so the band is the largest set of
   * headers sharing a row — within one line height of the topmost.
   */
  headers.sort((a, b) => a.y - b.y);

  let band = headers;
  for (const anchor of headers) {
    const tolerance = Math.max(heightOf(anchor.line), 12) * 1.4;
    const together = headers.filter((entry) => Math.abs(entry.y - anchor.y) <= tolerance);
    if (together.length > band.length || band === headers) band = together;
  }

  if (band.length < 2) return [];

  band.sort((a, b) => a.x - b.x);

  const bandY = band.reduce((sum, entry) => sum + entry.y, 0) / band.length;
  const rowHeight = Math.max(...band.map((entry) => heightOf(entry.line)), 12);

  /*
   * The value row: everything below the headers, within a few line heights.
   *
   * Generous vertically because the coder prints its own row and sometimes a
   * second one — the unit sale price is routinely on a line of its own beneath
   * the rest — and mean because the strip is short: there is nothing else
   * within four line heights of it but the strip itself.
   */
  const headerLines = new Set(band.map((entry) => entry.line));

  /*
   * ── ROW-MAJOR ORDER, TWICE GOT WRONG ───────────────────────────────────
   *
   * The first attempt compared y when two lines were far apart and x when they
   * were close, which is not a comparator: it is not transitive, so `sort` was
   * free to return anything and did.
   *
   * The second measured each line's distance from the header row and rounded
   * to a row number. That is a total order and it still split one physical row
   * in two, because the rounding boundary happened to fall between `16:25` at
   * y 510 and `398.'00` at y 516 — six pixels apart, on the same printed line,
   * assigned to rows 2 and 3. The MRP header then took `16`.
   *
   * Rows are not a function of distance from anywhere. They are clusters: two
   * values are on the same row when the gap between them is small compared to
   * how tall they are. So the values are banded by walking them in y order and
   * starting a new row only where the gap exceeds three quarters of a line
   * height — which no two fragments of one printed row ever do, and which two
   * genuinely different rows always do.
   */
  const positioned = located
    .filter((line) => !headerLines.has(line))
    .map((line) => ({ line, y: midY(line) ?? 0, x: line.box![0], h: heightOf(line) }))
    .filter((entry) => entry.y > bandY && entry.y - bandY <= rowHeight * 5)
    .sort((a, b) => a.y - b.y);

  let row = 0;
  const values = positioned
    .map((entry, index) => {
      const previous = positioned[index - 1];
      if (previous) {
        const gap = entry.y - previous.y;
        const tolerance = Math.max(entry.h, previous.h, 12) * 0.75;
        if (gap > tolerance) row += 1;
      }
      return { ...entry, row };
    })
    .sort((a, b) => a.row - b.row || a.x - b.x);

  if (values.length === 0) return [];

  /* Split anything the detector ran together, keeping the source line. */
  const candidates: Array<{ text: string; line: StripLine }> = [];
  for (const entry of values) {
    for (const piece of splitMergedCodedValue(entry.line.text)) {
      candidates.push({ text: piece, line: entry.line });
    }
  }

  /*
   * Match in order, by shape.
   *
   * Each header takes the first *later* candidate that has the shape it asks
   * for. Later, so the sequence cannot run backwards — the price is printed
   * before the dates and a date must not be handed to the MRP header because it
   * happened to appear first in the list.
   */
  const readings: StripReading[] = [];
  let cursor = 0;

  for (const header of band) {
    for (let index = cursor; index < candidates.length; index += 1) {
      const candidate = candidates[index]!;
      if (!hasShape(candidate.text, header.spec.shape)) continue;

      const value = valueOfShape(candidate.text, header.spec.shape);
      if (!value) continue;

      readings.push({
        field: header.spec.field,
        value,
        lines: [header.line, candidate.line],
      });

      cursor = index + 1;
      break;
    }
  }

  /*
   * The unit sale price, which has no header of its own on many packs.
   *
   * `USP 0.50/g` is printed as one token with the value attached, so it is
   * never paired by the loop above. It is unmistakable on its own — an amount
   * over a unit is not a date, a batch or a price — so it is read wherever it
   * appears in the strip.
   */
  if (!readings.some((reading) => reading.field === 'unit_sale_price')) {
    /*
     * ── THE UNIT PRICE ARRIVES IN PIECES ────────────────────────────────
     *
     * `USP 0.50/g` came off this packet as two detected tokens: `ISPO` and
     * `50/9`. The `U` read as an `I`, the `0` of `0.` was swallowed into the
     * header as its `O`, and the `g` came back as a `9`.
     *
     * Read alone, the second token says `50/g` — and reporting that would put
     * a unit price a hundred times the real one onto an enforcement record.
     * That is far worse than reporting nothing, so the two are joined before
     * being read: a header-like token ending in a truncated amount, plus the
     * `<digits>/<unit>` beside it on the same row, is one declaration.
     *
     * Where they cannot be joined into something that parses whole, nothing is
     * reported. A missing unit price is a gap an inspector fills in ten
     * seconds; a wrong one is a figure nobody can defend.
     */
    for (const [index, candidate] of candidates.entries()) {
      const next = candidates[index + 1];

      // The `O` in `ISPO` is a zero the header stole. Put it back, and only
      // then take the pair as one value.
      const joined = next
        ? `${candidate.text.replace(/[oO]\.?$/, '0.')} ${next.text}`.replace(/\s+\./g, '.')
        : undefined;

      const fromPair = joined ? valueOfShape(joined.replace(/^\D*?(\d)/, '$1'), 'unitPrice') : null;

      if (fromPair && /^\d+\.\d+\//.test(fromPair)) {
        readings.push({
          field: 'unit_sale_price',
          value: fromPair,
          lines: next ? [candidate.line, next.line] : [candidate.line],
        });
        break;
      }

      // A whole one on its own line, which is how most packs print it.
      const alone = valueOfShape(candidate.text, 'unitPrice');
      if (alone && /^\d+\.\d+\//.test(alone)) {
        readings.push({ field: 'unit_sale_price', value: alone, lines: [candidate.line] });
        break;
      }
    }
  }

  return readings;
}
