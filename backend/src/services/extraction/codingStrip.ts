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
type Shape = 'amount' | 'date' | 'code' | 'unitPrice' | 'quantity';

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
/**
 * A date, in the forms a packing line prints one.
 *
 * The last arm is `MM/YY`, and it is here because of what its absence did. A
 * manufacturing date printed `03/2026` came off a soft frame as `03/20`, which
 * no arm of this pattern matched — so it was not a date, and `CODE`'s second
 * arm, two runs joined by a slash, took it happily. The batch number of a
 * cleanser stamped `AAAA557` was recorded as `03/20`.
 *
 * That is the failure this constant's own note warned about, arriving through
 * the one date form it did not list. `hasShape` bars a date from being read as
 * a code or an amount, so every shape that is not a date is protected by
 * naming the form here — and where a package really does print `12/34` as a
 * lot number, the batch is asked of the inspector, which the note beside
 * `CODE` already calls the safer of the two mistakes.
 *
 * It is narrower than the arms above it in two ways, and both are load-bearing.
 * The separator cannot be a full stop, and the month must be a month: written
 * as loosely as they are, `MM/YY` also describes `3.38` — the fluid ounces
 * beside a net quantity — and `100 ml / 3.38 fl. oz.` was then a date, which
 * a manufacturing-date header took in preference to the real one.
 */
const DATE =
  /\b\d{1,2}\s*[/.\-]\s*\d{1,2}\s*[/.\-]\s*\d{2,4}\b|\b\d{1,2}\s*[/.\-]\s*\d{4}\b|\b(?:0?[1-9]|1[0-2])\s*[/\-]\s*\d{2}\b/;
/**
 * A batch or lot code.
 *
 * The letter run was capped at three, which is one short of the coders that
 * print a plant prefix: `DBFH13I9118:05` off a Haldiram pack has four, so it
 * matched nothing and the batch header went looking further down the column —
 * where it took `12/01/27` and recorded the use-by date as the lot number,
 * and pushed every declaration below it onto the wrong value.
 *
 * The third arm is for the lot numbers with no letters in them at all —
 * `861363777`. Both original arms required either a letter prefix or an
 * embedded slash, so an all-numeric batch code, which is a very ordinary thing
 * for a packing line to print, was not a code by this module's reckoning. Five
 * digits is the floor: it clears a net quantity, a price and a two-part date,
 * and `hasShape` bars a date from being read as a code regardless.
 */
const CODE = /\b[A-Z]{1,5}\d{3,}[A-Z0-9]*\b|\b[A-Z0-9]{2,}[-/][A-Z0-9]{2,}\b|\b\d{5,}\b/;

/**
 * `0.50/g`, and the state it arrives in.
 *
 * The unit is the character a recogniser is least likely to get right on a
 * coded strip — `/g` comes back as `/9` about as often as not, and `/ml` as
 * `/mI`. It is also the character that makes this a unit sale price rather than
 * a price, so it cannot simply be dropped.
 */
/**
 * `Rs. 0.30/g`, and what a camera makes of it.
 *
 * The separator was a literal slash. On a Haldiram pack photographed at an
 * angle it came back as a hyphen, and on a second read as nothing at all, so
 * `0.30/g` arrived as `Rs.0.30-9` and `Rs.0.309` — a unit sale price printed
 * exactly as Rule 6 requires, thrown away over one punctuation mark. The class
 * is widened to the marks a thin diagonal stroke is actually mistaken for, and
 * made optional. The unit side already tolerated `9` for `g`; the separator now
 * does the same work.
 */
const UNIT_PRICE = /(\d+(?:\.\d+)?)\s*[/\-|\\]?\s*([gq9]|ml|mi|m1|kg|k9|ltr|l|n)\b/i;

/**
 * A net quantity: a number with its unit attached.
 *
 * Strict on purpose — the unit is the whole of what separates a quantity from a
 * batch number or a price, so a bare number never satisfies this.
 */
const QUANTITY = /\b(\d+(?:[.,]\d+)?)\s*(g|gm|gms|kg|mg|ml|ltr|litres?|l|nos?|pcs?|u|n)\b/i;

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
      // The second arm of CODE — two runs joined by a slash — describes a date
      // as exactly as it describes a lot number. A batch header must not be
      // able to take `12/01/27`; where a package really does print a date as
      // its batch code, the date fields will carry it and the batch will be
      // asked of the inspector, which is the safer of the two mistakes.
      return CODE.test(text) && !DATE.test(text);
    case 'unitPrice':
      return UNIT_PRICE.test(text);
    case 'quantity':
      // A date is digits with separators too, and `12/01/27` must never be
      // read as a quantity of 27 litres.
      return QUANTITY.test(text) && !DATE.test(text);
  }
}

function valueOfShape(text: string, shape: Shape): string | null {
  if (shape === 'unitPrice') {
    const match = UNIT_PRICE.exec(text);
    if (!match?.[1] || !match[2]) return null;
    const unit = UNIT_REPAIR[match[2].toLowerCase()];
    return unit ? `${match[1]}/${unit}` : null;
  }

  if (shape === 'quantity') {
    const match = QUANTITY.exec(text);
    if (!match?.[1] || !match[2]) return null;
    const unit = match[2].toLowerCase();
    return `${match[1]} ${UNIT_REPAIR[unit] ?? unit}`;
  }

  const pattern = shape === 'amount' ? AMOUNT : shape === 'date' ? DATE : CODE;
  const match = pattern.exec(text);
  if (!match) return null;

  if (shape === 'amount') return cleanAmount(match[0].trim());

  if (shape === 'code') {
    /*
     * The whole token, not the part the pattern proved.
     *
     * `DBFH13I9118:05` came back as `DBFH1319!18:05` and CODE matched only as
     * far as the stray `!`, recording the batch as `DBFH1319`. A truncated lot
     * number is worse than none: it looks like a reading, and it will not match
     * the packing record it exists to be checked against. The pattern's job is
     * to decide *that* this is a code; the value is the run of non-space
     * characters it sits in.
     */
    const at = text.indexOf(match[0]);
    const before = text.slice(0, at).search(/\S+$/);
    const start = before === -1 ? at : before;
    const rest = text.slice(at + match[0].length).match(/^\S+/);
    return text.slice(start, at + match[0].length + (rest?.[0].length ?? 0)).trim();
  }

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
/* ── THE OTHER LAYOUT: A COLUMN OF LABELS ─────────────────────────────────── */

/**
 * The declaration block printed as two columns — labels down one side, values
 * down the other:
 *
 *     NET QUANTITY :        200g
 *     MFG. DATE    :        13/08/26
 *     USE BY       :        12/01/27
 *     BATCH NO.    :        DBFH13I9118:05
 *     MRP.(INCL. OF
 *      ALL TAXES); USP :    Rs.60.00   Rs.0.30/g
 *
 * This is not the coding strip above and it needs its own reader. A coding
 * strip is one row of short pre-printed headers with the coder's spray beneath
 * them; this is a full-word declaration block, and every assumption the strip
 * reader makes about it is wrong — the headers are stacked, not side by side;
 * they are sentences (`MRP.(INCL. OF`), not tokens; and `HEADER_MAX_LENGTH`
 * rejects most of them outright.
 *
 * The pairing principle is the same one, and for the same reason. Matching a
 * label to the value on its row fails here: photographed at an angle, the value
 * column drifts down against the label column, and on the Haldiram pack the
 * drift reached 61 pixels against a 45-pixel line — more than a full row out by
 * the bottom of the block. Reading both columns in order and pairing the nth
 * with the nth survives that completely, because it never measures the gap at
 * all. Shape is what keeps it honest: a header takes the next value that looks
 * like what it is asking for, so the lines between them that are not values —
 * `KEEP YOUR`, `CITY CLEAN`, a stray barcode number — are skipped rather than
 * consumed.
 *
 * ── THE SAFETY PROPERTY ────────────────────────────────────────────────────
 *
 * Same as the strip reader's, arrived at differently. There the guarantee is
 * that a header pattern is anchored, so a line carrying its own value cannot be
 * a header. Here the labels are too varied to anchor — `MRP.(INCL. OF` has to
 * match — so the guarantee is `NO_DIGIT`: a candidate header must contain no
 * digit anywhere. `MRP <rupee>315.00` therefore cannot be a header, which is
 * the exact failure the strip reader was once burned by, and this reader must
 * never reach a block the ordinary label-and-value matcher already reads.
 */

/** A header in this layout announces a value; it never carries one. */
const NO_DIGIT = /^[^0-9]+$/;

/** Long enough for `MRP.(INCL. OF`, short enough to exclude a sentence. */
const COLUMN_LABEL_MAX_LENGTH = 26;

/** Fewer than this is a coincidence, not a column. */
const COLUMN_MIN_HEADERS = 3;

const COLUMN_HEADERS: HeaderSpec[] = [
  { field: 'net_quantity', shape: 'quantity', pattern: /\bnet\s*(?:qty|quan\S{0,3}ty|wt|weight|vol|volume|content)s?\b/i },
  // `(?!\s*by)` is the same guard the pattern list carries, for the same
  // packet: `MPKG. Mfd. By: Montage` names who made the thing. Without it that
  // line is a manufacturing-date header, and being printed higher up the panel
  // it is found first — so it took the field, and the real `MFG. DATE` two
  // inches below was discarded as a duplicate.
  /*
   * `manufactur…` spelled out has to bring the word "date" with it.
   *
   * Spelled out and on its own it is not a header, it is prose — and the prose
   * it appears in is a declaration of its own. "Use before 18 months from the
   * date of manufacturing." wraps onto a second line reading `manufacturing.`,
   * which matched, became the manufacturing-date header of the block, and took
   * the value the real `Mfg Date` two lines below was waiting for.
   *
   * The abbreviations keep standing alone. `MFG`, `MFD` and `PKD` are printed
   * as headers and appear in nothing else on a package.
   */
  {
    field: 'manufacturing_date',
    shape: 'date',
    pattern:
      /\b(?:mfg|mfd|pkd|packed|packing)\b(?![^a-z0-9]*by\b)[^a-z]*(?:date)?|\bmanufactur\w*\b(?![^a-z0-9]*by\b)[^a-z]*\bdate\b|\bdate\s+of\s+manufactur\w*/i,
  },
  { field: 'best_before', shape: 'date', pattern: /\b(?:use\s*by|use\s*before|best\s*before|expiry|exp)\b/i },
  { field: 'batch_number', shape: 'code', pattern: /\b(?:batch|lot)\s*(?:no|number|code)?\b/i },
  // `USP` before `MRP`: on this pack both share a line — `ALL TAXES); USP` —
  // and the unit price is the one that line actually announces.
  { field: 'unit_sale_price', shape: 'unitPrice', pattern: /\bu\s?s\s?p\b|\bunit\s*(?:sale|retail)?\s*price\b/i },
  /*
   * `[₹?t]?` is the rupee sign, as a camera renders it.
   *
   * The header is printed `MRP ₹` and came back `MRPT` from one frame and
   * `MRP?` from another. `\bm.?\s?r.?\s?p\b` needs a word boundary after the
   * p, which `MRPT` does not give it — so the sharpest photograph of the panel
   * contributed no MRP header at all, the column reader saw two headers where
   * it needs three, and the whole block went unread in the one frame that had
   * resolved every value on it.
   */
  {
    field: 'mrp',
    shape: 'amount',
    pattern: /\bm\.?\s?r\.?\s?p\.?\s*[₹?t]?\b|\bmaximum\s+retail\s+price\b/i,
  },
];

interface ColumnEntry {
  line: StripLine;
  spec: HeaderSpec;
  top: number;
  centreX: number;
}

/**
 * ── A PRICE IS ITS WORDING, NOT JUST ITS FIGURE ─────────────────────────────
 *
 * Every other reader in this stage hands the rule engine the line as printed,
 * because rule 6(1)(e) is about how the declaration reads: it must carry an
 * Indian currency marker, and between 2018 and 2024 it had to name itself a
 * maximum retail price. A bare `299.00` answers none of that.
 *
 * A two-column block splits the declaration across two OCR lines — the header
 * `MRP ₹` on the left, the figure on the right — and this reader was handing on
 * only the second. The currency validator then found no marker in `299.00`,
 * which is true of the string and false of the package, and a ₹299 bottle of
 * cleanser was reported as declaring its price in the wrong form.
 *
 * Joining them back together is what the block prints. Only the two shapes
 * whose rules inspect wording are joined; a batch code and a date are the value
 * and nothing else, and prefixing their headers would put `Batch No :` inside
 * the batch number.
 */
function asPrinted(shape: Shape, header: string, value: string): string {
  if (shape !== 'amount' && shape !== 'unitPrice') return value;

  const label = header.trim().replace(/[\s:.\-]+$/, '');
  return label === '' ? value : `${label} ${value}`;
}

function leftOf(line: StripLine): number {
  return line.box![0];
}

function rightOf(line: StripLine): number {
  return line.box![2];
}

function centreXOf(line: StripLine): number {
  return (line.box![0] + line.box![2]) / 2;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

/**
 * Reads a two-column declaration block.
 *
 * Returns nothing at all unless the geometry really is a column of labels —
 * three or more, aligned on one edge, none carrying a digit. Every other shape
 * of label is left to the ordinary matcher.
 */
export function readLabelColumn(lines: StripLine[]): StripReading[] {
  const located = lines.filter((line) => line.box && line.text.trim() !== '');
  if (located.length < COLUMN_MIN_HEADERS + 1) return [];

  let headers: ColumnEntry[] = [];
  for (const line of located) {
    const text = line.text.trim();
    if (text.length > COLUMN_LABEL_MAX_LENGTH) continue;
    if (!NO_DIGIT.test(text)) continue;

    const spec = COLUMN_HEADERS.find((candidate) => candidate.pattern.test(text));
    if (!spec) continue;
    if (headers.some((entry) => entry.spec.field === spec.field)) continue;

    headers.push({ line, spec, top: line.box![1], centreX: centreXOf(line) });
  }

  if (headers.length < COLUMN_MIN_HEADERS) return [];

  /*
   * Are they a column?
   *
   * Aligned on one edge or the other — left where the block is set ragged
   * right, right where the labels are set to a colon, which is how this pack
   * prints them. Either counts; a set of labels scattered across the panel does
   * not, and that is what stops this reader firing on a label whose
   * declarations are simply written in prose in different places.
   */
  const lineHeight = Math.max(...headers.map((entry) => heightOf(entry.line)), 12);
  const tolerance = lineHeight * 2;

  /*
   * The column is the largest set of labels that line up — not all of them.
   *
   * Testing every match at once let one label anywhere else on the package veto
   * the whole block: `MPKG. Mfd. By: Montage`, printed across the panel, put
   * 493 pixels of spread into a column whose labels agree to within 25, and the
   * reader returned nothing at all for a pack whose declarations were sitting
   * there in a neat list. A stray label is now simply not in the column.
   */
  let column = headers;
  for (const anchor of headers) {
    const together = headers.filter(
      (entry) =>
        Math.abs(leftOf(entry.line) - leftOf(anchor.line)) <= tolerance ||
        Math.abs(rightOf(entry.line) - rightOf(anchor.line)) <= tolerance,
    );
    if (together.length > column.length || column === headers) column = together;
  }

  if (column.length < COLUMN_MIN_HEADERS) return [];
  headers = column;

  headers.sort((a, b) => a.top - b.top);

  /*
   * The values sit beside the labels, within the block's own vertical extent —
   * one line height of slack at each end, because the first or last value can
   * sit slightly proud of its label.
   */
  const top = headers[0]!.top - lineHeight;
  const bottom = Math.max(...headers.map((entry) => entry.line.box![3])) + lineHeight;
  const claimed = new Set(headers.map((entry) => entry.line));

  const beside = located.filter(
    (line) => !claimed.has(line) && line.box![1] >= top && line.box![1] <= bottom,
  );

  /*
   * Which side? Decided by reading each one, not by counting shapes on it.
   *
   * A label block reads label-then-value, so the values are normally to the
   * right. They are to the *left* on a pack whose coding block is printed
   * upside down relative to the rest of it — the sidecar turns the photograph
   * upright by the majority of its text, and that block is in the minority.
   * So neither side can be assumed and both have to be tried.
   *
   * They used to be compared by counting how many lines carried a shape some
   * header was asking for, which is a test the wrong side passes easily. On
   * the back of a cleanser the left of the panel is the marketer's and the
   * manufacturer's addresses: eleven lines, among them a mobile number that is
   * an amount, a PIN code that is a lot code, and a licence number that is a
   * date. It out-counted the four-line value column beside the headers, and
   * the block was read off the addresses — MRP `91` from `+91 97723 46555`,
   * batch `302022` from `Jaipur - 302022`.
   *
   * Pairing is the honest test, because it is the thing being decided. Each
   * side is paired against the headers in order, and the side that answers
   * more of them wins; a tie goes to the side whose lines sit in a narrower
   * column, since a value column is narrow and a block of prose is not.
   */
  const labelCentre =
    headers.reduce((sum, entry) => sum + entry.centreX, 0) / headers.length;

  const left = beside.filter((line) => centreXOf(line) < labelCentre);
  const right = beside.filter((line) => centreXOf(line) > labelCentre);

  const readingsFrom = (candidates: StripLine[]): StripReading[] => {
    const values = [...candidates].sort((a, b) => a.box![1] - b.box![1]);
    const readings: StripReading[] = [];
    let cursor = 0;

    /* Nth label, nth value of the shape it asks for. */
    for (const header of headers) {
      for (let index = cursor; index < values.length; index += 1) {
        const candidate = values[index]!;
        if (!hasShape(candidate.text, header.spec.shape)) continue;

        const value = valueOfShape(candidate.text, header.spec.shape);
        if (value === null) continue;

        readings.push({
          field: header.spec.field,
          value: asPrinted(header.spec.shape, header.line.text, value),
          lines: [header.line, candidate],
        });
        cursor = index + 1;
        break;
      }
    }

    return readings;
  };

  /** How far apart the lines' centres are. A value column is a narrow one. */
  const columnWidth = (candidates: StripLine[]): number =>
    candidates.length === 0 ? Infinity : spread(candidates.map(centreXOf));

  const fromRight = readingsFrom(right);
  const fromLeft = readingsFrom(left);

  let values: StripReading[];

  if (fromRight.length !== fromLeft.length) {
    values = fromRight.length > fromLeft.length ? fromRight : fromLeft;
  } else {
    values = columnWidth(right) <= columnWidth(left) ? fromRight : fromLeft;
  }

  return values;
}

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
