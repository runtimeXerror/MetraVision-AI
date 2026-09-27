import {
  canonicalUnit,
  firstAmount,
  repairDigits,
  repairQuantityDigits,
  unifyCurrency,
} from './normalise';

/**
 * ── THE FIELD PATTERNS ──────────────────────────────────────────────────────
 *
 * One table, one entry per declaration this phase knows how to look for.
 *
 * Everything here is deterministic and inspectable: a label form, an optional
 * unlabelled form, and a small function that says what the value is. No model,
 * no scoring network, nothing that produces a different answer on Tuesday. That
 * is a requirement rather than a simplification — an extraction that cannot be
 * explained cannot support a finding, and a finding that cannot be explained
 * cannot survive a hearing.
 *
 * Note what is *not* here: no rule decides anything about compliance. This
 * table knows that a line beginning "MRP" carries a price declaration. Whether
 * a price declaration is required, what form it must take, and what follows
 * from its absence are questions for the rule engine, and asking them here
 * would put legal reasoning in two places at once.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ExtractionMethod = 'LABEL_MATCH' | 'PATTERN_MATCH' | 'HEURISTIC' | 'DERIVED' | 'MODEL';

export interface ExtractedValue {
  /** What is handed on. For a rule that inspects wording, the whole line. */
  value: string;
  /** Unit, where the pattern separated one out. Consumed by `unitValidator`. */
  unit?: string;
  /** True when `repairDigits` changed a character. Lowers reported confidence. */
  repaired?: boolean;
}

export interface FieldSpec {
  /** Key the value is filed under. Engine fields use the rule set's own names. */
  field: string;
  label: string;
  /**
   * True when this field is part of the rule engine's input contract. False
   * entries are recorded for the report and the inspector, and never influence
   * a legal check.
   */
  engineField: boolean;
  /** Label forms introducing the declaration, tried in order. */
  labels: RegExp[];
  /** A line matching this is never this field, whatever else matched. */
  exclude?: RegExp;
  /** Recognises the declaration where the label was not printed or not read. */
  unlabelled?: RegExp;
  /**
   * Absorbs following lines into the value — addresses wrap, and half an
   * address is a worse input to a presence check than the whole one.
   *
   * A number sets how many lines; `true` means the default of three.
   */
  continuation?: boolean | number;
  /**
   * Turns the text after the label (and the whole line) into a value.
   * Returning `null` rejects the line, so the scan continues looking.
   */
  extract: (afterLabel: string, wholeLine: string) => ExtractedValue | null;
  /**
   * The shape a value must have when it is read from a *neighbouring* line
   * rather than from the label's own.
   *
   * Text on the label line is vouched for by the label printed in front of it.
   * Text one line over is not: all that is known about it is that it sits
   * where a value would sit, and on a dense back-of-pack that is equally true
   * of the factory address, the next declaration's key, and half the recycling
   * mark. Where an extractor is permissive enough to accept any of those — the
   * date extractors keep unreadable text on purpose, so the engine can report
   * what was actually printed — it says here what a neighbour has to look like.
   *
   * Omitted where the extractor is already specific: a quantity must parse as
   * a number and a unit, a price must carry an amount, and neither will take
   * an address.
   */
  neighbour?: RegExp;
}

/* ── Small shared extractors ──────────────────────────────────────────────── */

/**
 * The whole line, verbatim.
 *
 * Used wherever the rule inspects the *wording* and not just the value — MRP
 * between 2018 and 2024 had to say "maximum retail price", and consumer care
 * has to carry a telephone number or an e-mail address. Handing the engine a
 * bare "315.00" would throw away the very text the rule is about.
 */
const wholeLine = (_after: string, line: string): ExtractedValue | null =>
  line.trim() === '' ? null : { value: line.trim() };

/**
 * Whether what follows a label is a value at all, or just the rest of the label.
 *
 * A two-column declaration block prints the key on the left and the value on
 * the right, and the recogniser reads the key's own tail with the key:
 * `Batch No.:` leaves `:`, `MFD.(P) &` leaves `(P) &`, `Use Before (E):`
 * leaves `(E):`. None of those is a value, and accepting one is worse than
 * finding nothing — it stops the search for the real value dead, because the
 * neighbour lookup in `findField` only runs when the label line yielded
 * nothing. That is how this system reported a batch number of ":" for a
 * package whose batch number, 861363777, was printed one column to the right
 * and read perfectly.
 *
 * So: a value has to carry a digit, or a run of letters long enough not to be
 * a bracketed suffix on the label. `(P)` and `(E)` fail that; `SEE CAP` and
 * `03/26` pass it.
 */
function isValueBearing(text: string): boolean {
  return /\d/.test(text) || /\p{L}{2,}/u.test(text);
}

/**
 * Words that only ever name a declaration, never state one.
 *
 * Kept deliberately small: every word here is one this system will refuse to
 * accept as a value on its own, so a word that could plausibly *be* a value
 * does not belong in it. `see`, `cap`, `crimp` and `carton` are all absent for
 * that reason — "SEE CAP" is a real, useful reading.
 */
const LABEL_WORDS = new Set([
  'batch', 'lot', 'no', 'nos', 'number', 'code',
  'mfg', 'mfd', 'mfgd', 'manufacture', 'manufactured', 'manufacturing',
  'packed', 'packing', 'pkd', 'date', 'dt', 'dates',
  'exp', 'expiry', 'expires', 'expiration', 'best', 'before', 'use', 'by',
  'mrp', 'price', 'rate', 'retail', 'maximum', 'sale', 'unit',
  'net', 'qty', 'quantity', 'wt', 'weight', 'vol', 'volume', 'content', 'contents',
]);

/**
 * ── WHERE ONE LABEL RUNS STRAIGHT INTO THE NEXT ────────────────────────────
 *
 * Indian packs routinely print two declarations under one heading:
 *
 *     BATCH NO. & MFG DATE: 80/23/000
 *
 * The batch matcher stops at `BATCH NO.` and hands back `& MFG DATE:` as what
 * followed it. `isValueBearing` passed that — it has two runs of letters — and
 * a report went out to a dealer recording their batch number as the string
 * "& MFG DATE:".
 *
 * The bracketed-suffix rule above cannot catch this, because the tail here is
 * not `(P)` or `:` but a whole second label that reads like words.
 *
 * So the second heading is *dropped* rather than the line rejected. Leading
 * punctuation and label words are eaten until something that is not label
 * vocabulary appears, and that is the value: `& MFG DATE: 80/23/000` becomes
 * `80/23/000`. Rejecting instead would have thrown away the value printed
 * right there on the same line.
 *
 * Where nothing survives — `& MFG DATE:` on its own, the value being in the
 * next column — the caller is left with an empty string, fails
 * `isValueBearing`, and the neighbour lookup in `findField` runs, which is
 * exactly what should happen.
 *
 * `SEE CAP` is untouched: `see` is not label vocabulary. That reading is a
 * pointer to the crimp and is handled by `POINTS_ELSEWHERE` below, not here.
 */
function stripLeadingLabelRun(text: string): string {
  let rest = text;
  for (;;) {
    const trimmed = rest.replace(/^[\s&/,:;.\-–—()[\]]+/u, '');
    const word = /^(\p{L}+)/u.exec(trimmed);
    if (word === null) return trimmed;
    if (!LABEL_WORDS.has(word[1]!.toLowerCase())) return trimmed;
    rest = trimmed.slice(word[1]!.length);
  }
}

/** The text after the label, rejected when the label was all there was. */
const afterLabel = (after: string): ExtractedValue | null => {
  const value = stripLeadingLabelRun(after);
  return isValueBearing(value) ? { value: value.trim() } : null;
};

/* ── Currency ─────────────────────────────────────────────────────────────── */

/** `per kg`, `/kg`, `per 100 g` — the mark of a unit sale price, not an MRP. */
const PER_UNIT = /(?:\bper\b|\/)\s*(?:\d+\s*)?(?:kg|kilogram|g|gm|gram|mg|l|ltr|litre|liter|ml|cm|m|mm|no\.?|nos|unit|piece|pcs|number|n)\b/i;

const CURRENCY_LINE = /(?:₹|\bRs\.?\b|\bINR\b|\bRupees\b)\s*[0-9OoQDlIi|ZSsbGTB,.]/i;

/**
 * A lone character standing where the rupee sign should be.
 *
 * The rupee glyph is the least reliably recognised character on an Indian
 * label. It is a recent addition to most fonts, it is printed small, and it
 * comes back as `7`, `2`, `R`, `T`, `z` or `$` — or as nothing at all. On a
 * line
 * that has already identified itself as a price this is unambiguous: a single
 * stray character between the words "MRP" and an amount is not a quantity, a
 * count or part of the figure. It is the currency sign.
 *
 * Deliberately narrow. It requires the character to stand alone, separated by
 * whitespace on both sides, with a digit immediately after — so `7,199.00` and
 * `MRP: 7` are both left exactly as they are. Guessing wider than this on a
 * price is how a system invents a number and then accuses somebody with it.
 */
const MISREAD_RUPEE = /(^|[\s:(\[])([72RTtzZ$?|])\s+(?=\d)/;

/**
 * A price line, kept whole and digit-repaired.
 *
 * ── WHY THE CURRENCY SYMBOL IS NOT REQUIRED WHEN A LABEL MATCHED ──────────
 *
 * This used to demand a rupee sign or an `Rs` on every line before it would
 * read a price, on either path. That is right for an *unlabelled* line — a
 * bare `199.00` in the middle of a nutrition panel is not a declaration of
 * anything, and the currency mark is the only thing that makes it one.
 *
 * On a line that says `MRP` it is exactly backwards. The words "Maximum Retail
 * Price" are a stronger statement of what the number is than any symbol, and
 * requiring the symbol as well meant that every package whose rupee sign the
 * recogniser fumbled — `MRP: 7 199.00`, `M.R.P. 2 45.00`, `MRP R 250.00` —
 * had no price extracted at all. The engine then had to rule on an MRP that
 * was printed plainly on the packet and simply not read, which under rule
 * 6(1)(e) is the single most consequential declaration to get wrong.
 *
 * The repair is reported so the caller can lower the confidence it publishes.
 * A repaired price acted on at full confidence is a number this system made
 * up, and the difference between ₹l99 and ₹199 is the difference between a
 * correct reading and an accusation.
 */
function priceLine(after: string, line: string): ExtractedValue | null {
  // `after` is the line with its label removed, so they differ exactly when a
  // price label matched this line. A neighbouring value line is passed as both,
  // and is held to the stricter unlabelled test — beside a label, position is
  // weak evidence and the symbol is what confirms it.
  const labelled = after !== line;

  let working = line;
  let currencyRepaired = false;

  if (!CURRENCY_LINE.test(unifyCurrency(working))) {
    if (!labelled) return null;

    // Put the sign back where the recogniser lost it, so the value of record
    // reads `MRP: ₹199.00` rather than carrying a stray `7` onto a report.
    const restored = working.replace(MISREAD_RUPEE, '$1₹');
    if (restored !== working) {
      working = restored;
      currencyRepaired = true;
    }
  }

  const { text, repaired } = repairDigits(working);
  if (firstAmount(text) === null) return null;

  return { value: text.trim(), repaired: repaired || currencyRepaired };
}

/* ── Quantity ─────────────────────────────────────────────────────────────── */

/**
 * A number followed by a unit token.
 *
 * The unit class includes Devanagari so a Hindi-only declaration —
 * "200 ग्राम" — is read as a quantity rather than as a number with no
 * unit. `` does not apply after a Devanagari character, so the tail is
 * bounded by an explicit negative lookahead instead.
 */
const QUANTITY_VALUE = /(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{1,12}|\p{Script=Devanagari}{1,12})(?![A-Za-z\p{Script=Devanagari}])/u;

/**
 * A net-quantity declaration: a number and a unit.
 *
 * The unit is returned separately because `unitValidator` prefers an explicit
 * `field.unit` over one it has to parse back out of the text — the extraction
 * stage already knows which token was the unit, and re-deriving it is how "1 N"
 * becomes a unit of "N" on one path and nothing on another.
 */
export function quantityValue(after: string): ExtractedValue | null {
  // Two repairs, weakest first. `repairDigits` handles a span that already
  // looks numeric; `repairQuantityDigits` then takes the token sitting against
  // the unit, which is the one place on a label where a bolder substitution is
  // safe. See both for why the split exists.
  const general = repairDigits(after);
  const beside = repairQuantityDigits(general.text);

  const text = beside.text;
  const repaired = general.repaired || beside.repaired;

  const match = QUANTITY_VALUE.exec(text);
  if (!match?.[1] || !match[2]) return null;

  const unit = canonicalUnit(match[2]);
  if (!unit) {
    // A number with an unrecognised unit token is still a declaration, and the
    // rule engine — not this table — decides whether the unit is permitted.
    return { value: text.trim(), repaired };
  }

  const amount = match[1].replace(/,/g, '');
  return { value: `${amount} ${unit}`, unit, repaired };
}

/* ── Dates ────────────────────────────────────────────────────────────────── */

/**
 * The forms a printed date takes.
 *
 * Ordered longest-first, so `12/03/2026` is read whole rather than as `12/03`.
 *
 * The last alternative is month over a two-digit year — `03/26`, meaning March
 * 2026 — which is how nearly every Indian package prints the month and year
 * the law asks for, and which none of the others matched: they all require a
 * four-digit year. A label reading `MFD.(P) 03/26` therefore had no date found
 * in it at all, and the extractor fell back to returning the label's own tail.
 *
 * It is deliberately narrower than the rest: a slash or a hyphen only, never a
 * dot, and nothing may follow the year. A dot would make `4.98/ml` — a unit
 * price — read as a date, and this pattern also decides whether a line sitting
 * next to a date label may be taken as its value.
 */
const DATE_LIKE =
  /\b(?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{1,2}\s*[/.-]\s*\d{4}|[A-Za-z]{3,9}\s*[\s/.-]\s*\d{4}|\d{4}\s*-\s*\d{1,2}|\d{1,2}\s*[/-]\s*\d{2}(?!\d))\b/;

/**
 * How much text may stand in for a date that could not be parsed.
 *
 * The fallback below is deliberate and has to be bounded. `MFD: ///` should
 * reach the rule engine as the smudge that was printed, so the validator can
 * say "this could not be read as a month and year" about the actual mark on
 * the packet rather than about an empty string. But the same fallback,
 * unbounded, turned a manufacturer's address into a manufacturing date.
 *
 * A printed month and year is short and has no prose in it. Twenty-four
 * characters covers every real form — `12 December 2026` is sixteen — and a
 * comma or four words is an address, a sentence, or a label's tail, none of
 * which is a date however unreadable.
 */
const UNPARSED_DATE_MAX = 24;

function looksLikeProse(text: string): boolean {
  return text.includes(',') || text.trim().split(/\s+/).length > 3;
}

/**
 * The date portion of a declaration.
 *
 * Where a date is recognisable it is returned on its own. Where it is not, a
 * short unparseable remainder is passed through — see `UNPARSED_DATE_MAX` —
 * and anything longer yields nothing at all, because a date field returning
 * prose is worse than a date field returning nothing: the first reaches a
 * report as a fact, the second reaches the inspector as a question.
 */
function dateValue(after: string): ExtractedValue | null {
  // …but only where something was printed. `MFD.(P) &` leaves `(P) &`, which
  // is the label's own tail, not an unreadable date — see `isValueBearing`.
  // `& Batch No.` is the *next* heading — see `stripLeadingLabelRun`.
  const text = stripLeadingLabelRun(after);
  if (!isValueBearing(text)) return null;

  const match = DATE_LIKE.exec(text);
  if (match) return { value: match[0].trim() };

  const remainder = text.trim();
  if (remainder.length > UNPARSED_DATE_MAX || looksLikeProse(remainder)) return null;

  return { value: remainder };
}

/** `18 months`, `2 years` — a shelf life stated as a period. */
const SHELF_LIFE = /\b(\d{1,3})\s*(day|week|month|year)s?\b/i;

/**
 * ── A SHELF LIFE IS NOT A DATE ──────────────────────────────────────────────
 *
 * Rule 6(1)(c) is satisfied either by a date or by a period counted from
 * manufacture, and cosmetics overwhelmingly print the second: "Use before 18
 * months from the date of manufacturing."
 *
 * `dateValue` looks for a date, and failing that keeps whatever short scrap of
 * text is left — refusing anything that reads like prose, because on a date
 * field prose is the label's own tail rather than a value. That rule inverted
 * the evidence here. The sentence as printed is prose, so the frame that read
 * it correctly contributed nothing; a softer frame of the same line came back
 * `18 monts ton`, which is short and unprosaic enough to pass, and *that* was
 * recorded and printed on the report served on the dealer.
 *
 * Naming the period is what fixes it: the declaration is read as what it is,
 * the whole sentence no longer has to survive an OCR pass intact, and a
 * garbled read of it no longer beats a clean one.
 */
function shelfLifeValue(after: string): ExtractedValue | null {
  const text = stripLeadingLabelRun(after);
  if (!isValueBearing(text)) return null;

  // A printed date still wins where the package gives one — "Use before
  // 12/2027" is a date declaration and should be recorded as that.
  const date = DATE_LIKE.exec(after);
  if (date) return { value: date[0].trim() };

  const period = SHELF_LIFE.exec(after);
  if (period) {
    const count = Number(period[1]);
    const unit = period[2]!.toLowerCase();
    return { value: `${count} ${unit}${count === 1 ? '' : 's'}` };
  }

  return dateValue(after);
}

/**
 * A batch or lot code as printed: one unbroken token, mostly digits or
 * capitals. Wide enough for `861363777`, `L23/AB-7` and `COS052/13`; too
 * narrow for `Moo 17, Soi Industr`, which is where the factory is.
 */
const CODE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9./-]{2,}$/;

/**
 * ── DECLARED SOMEWHERE ELSE ────────────────────────────────────────────────
 *
 * A tube inside a carton does not repeat the carton's declarations. It prints
 * a sentence saying where they are:
 *
 *     For the manufacturing date, batch no. & Use before date - refer to the crimp
 *     For MRP, refer to the carton
 *
 * Those two lines cost this system its credibility on a real package. The
 * label matchers saw `batch no.` and `Use before` inside them and took the
 * surrounding words as values — a batch number of `& Use before date-` — and
 * where nothing could be salvaged the field came out NOT_FOUND and the engine
 * recorded three potential violations against a trader whose package had
 * *told the inspector where to look*.
 *
 * A pointer is not a declaration and it is not an absence. It is positive
 * evidence that the declaration is elsewhere on the retail package, which is
 * exactly what `absenceConfidence` on the engine's contract exists to say. So
 * these lines yield no value, claim themselves so nothing else reads them, and
 * name the fields they point at.
 * ────────────────────────────────────────────────────────────────────────────
 */
const POINTS_ELSEWHERE =
  /\b(?:refer\s+to|printed\s+on|see|as\s+(?:per|on)|mentioned\s+on|given\s+on|marked\s+on)\s+(?:the\s+)?(?:carton|crimp|pack|packet|box|outer|label|sleeve|wrapper|sachet|bottom|cap|seal|mono\s*carton)\b/i;

/**
 * Which declarations a pointer sentence is about.
 *
 * Read from the same sentence, because one sentence routinely covers several —
 * `manufacturing date, batch no. & Use before date` is three.
 */
const POINTER_TARGETS: Array<{ field: string; pattern: RegExp }> = [
  { field: 'mrp', pattern: /\b(?:m\.?\s?r\.?\s?p\.?|maximum\s+retail\s+price|retail\s+sale\s+price)\b/i },
  { field: 'unit_sale_price', pattern: /\bunit\s*(?:sale|retail)?\s*price\b/i },
  { field: 'manufacturing_date', pattern: /\b(?:manufactur\w*|packing|packed|mfg|mfd|pkd)\b/i },
  { field: 'best_before', pattern: /\b(?:best\s+before|use\s+by|use\s+before)\b/i },
  { field: 'expiry_date', pattern: /\b(?:expiry|expires|exp\.?\s*(?:date|dt))\b/i },
  { field: 'batch_number', pattern: /\b(?:batch|lot)\s*(?:no\.?|number|code)?\b/i },
  { field: 'net_quantity', pattern: /\bnet\s*(?:qty|quantity|wt|weight|vol|volume|content)s?\.?\b/i },
];

/** The declarations this line says are printed somewhere else, if it says so. */
export function declaredElsewhereIn(text: string): string[] {
  if (!POINTS_ELSEWHERE.test(text)) return [];
  return POINTER_TARGETS.filter((target) => target.pattern.test(text)).map((target) => target.field);
}

/** Whether a line is a pointer to another part of the package rather than a declaration. */
export function isPointerLine(text: string): boolean {
  return POINTS_ELSEWHERE.test(text);
}

/* ── The table ────────────────────────────────────────────────────────────── */

/**
 * Ordered by precedence, because a line is claimed once.
 *
 * Unit sale price comes before MRP: both are rupee amounts, and "₹63.00 per kg"
 * read as a retail price would be a false reading with legal consequences. The
 * narrower pattern goes first, always.
 */
/**
 * ── A NOTE ON THE DEVANAGARI PATTERNS ──────────────────────────────────────
 *
 * They use explicit lookarounds instead of ``.
 *
 * JavaScript's `` is defined on ASCII word characters only, so it never
 * fires beside a Devanagari letter: `/शुद्ध/.test('शुद्ध मात्रा')` is
 * `false`. Every Hindi label form in this table was written with `` and
 * therefore matched nothing at all — a package declaring its net quantity only
 * as "शुद्ध मात्रा 200 ग्राम" had that declaration reported missing, and the
 * rule engine was handed an absence that was really a blind spot.
 *
 * It failed silently because it looks correct, and because every fixture was
 * written in English.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const FIELD_SPECS: FieldSpec[] = [
  {
    field: 'unit_sale_price',
    label: 'Unit sale price',
    engineField: true,
    labels: [/\bunit\s*(?:sale|retail)?\s*price\b/i, /\bprice\s*per\s*unit\b/i],
    unlabelled: PER_UNIT,
    extract: (after, line) => (PER_UNIT.test(line) ? priceLine(after, line) : null),
  },
  {
    field: 'mrp',
    label: 'Maximum retail price',
    engineField: true,
    labels: [
      /\bm\.?\s?r\.?\s?p\.?\b/i,
      /\bmaximum\s+retail\s+price\b/i,
      /\bmax\.?\s+retail\s+price\b/i,
      /\bretail\s+sale\s+price\b/i,
      /(?<![ऀ-ॿ])प्रति\s*मूल्य(?![ऀ-ॿ])/i,
      /(?<![ऀ-ॿ])अधिकतम\s+खुदरा\s+मूल्य(?![ऀ-ॿ])/,
    ],
    // A per-unit price is a different declaration under a different sub-rule.
    exclude: PER_UNIT,
    unlabelled: CURRENCY_LINE,
    extract: priceLine,
  },
  {
    field: 'net_quantity',
    label: 'Net quantity',
    engineField: true,
    labels: [
      /\bnet\s*(?:qty|quantity|wt|weight|vol|volume|content)s?\.?\b/i,
      // `Q` read as `O` is one of the commonest recogniser confusions on a
      // photographed label. Without this "NET OUANTITY" matches nothing and a
      // declaration that is present on the package is reported missing.
      /\bnet\s*[oq0]uantity\b/i,
      /\bquantity\b/i,
      /\bcontents?\b/i,
      /(?<![ऀ-ॿ])शुद्ध\s*(?:मात्रा|वजन)(?![ऀ-ॿ])/,
    ],
    // Never let a price line become a quantity: both carry a number.
    exclude: /(?:₹|\bRs\.?\b|\bINR\b|\bprice\b)/i,
    unlabelled: /^\s*\d[\d,]*(?:\.\d+)?\s*(?:kg|kgs|g|gm|gms|mg|ml|l|ltr|litre|liter|cm|mm|m|N|No|Nos|pcs|pieces?|pair|set|units?|[\u0900-\u097F]{2,12})\s*$/i,
    extract: quantityValue,
  },
  {
    field: 'manufacturing_date',
    label: 'Month and year of manufacture',
    engineField: true,
    labels: [
      /\bdate\s+of\s+(?:manufactur\w*|packing|packaging|pack)\b/i,
      /\bmanufactur\w*\s+(?:date|on)\b/i,
      /\bpacked\s+(?:on|in)\b/i,
      /*
       * `(?!\s*by\b)` on all three, and it is not a nicety.
       *
       * `FIELD_SPECS` is ordered by precedence and a line is claimed once, so
       * this spec sees every line before the manufacturer spec below does —
       * and "Mfd by Crispy Snacks Pvt Ltd," matched `\bmfd\b`. The date
       * extractor then took the rest of the line, and a potato-crisp packet
       * carrying no date at all was recorded as manufactured on
       * "by Crispy Snacks Pvt Ltd,".
       *
       * That is the worst class of failure this system has: not a declaration
       * missed, but one invented, on a record that then goes to a report. The
       * package genuinely had no date — the finding should have been that it
       * was absent.
       */
      /\bmfg\.?\s*(?:date|dt)?\b(?!\s*by\b)/i,
      /\bmfd\.?\s*(?:date|dt)?\b(?!\s*by\b)/i,
      /\bpkd\.?\s*(?:date|dt)?\b(?!\s*by\b)/i,
      // The wording of rule 6(1)(d) itself, which is what a careful packer
      // prints verbatim: "month and year in which the commodity is
      // manufactured or pre-packed". None of the abbreviations above matched
      // it, so the most correctly labelled packages were the ones whose date
      // went unread.
      /\bmonth\s*(?:&|and)?\s*year\s+of\s+(?:manufactur\w*|packing|packaging|pack)\b/i,
      /(?<![ऀ-ॿ])निर्माण\s*(?:तिथि|दिनांक)(?![ऀ-ॿ])/,
    ],
    // These are their own declarations under their own clauses.
    exclude: /\b(?:best\s+before|use\s+by|use\s+before|expiry|expires|exp\.?\s*(?:date|dt))\b/i,
    extract: dateValue,
    neighbour: DATE_LIKE,
  },
  {
    field: 'best_before',
    label: 'Best before',
    engineField: true,
    labels: [/\bbest\s+before\b/i, /\bbest\s+by\b/i, /\buse\s+by\b/i, /\buse\s+before\b/i],
    extract: shelfLifeValue,
    neighbour: DATE_LIKE,
  },
  {
    field: 'manufacturer',
    label: 'Manufacturer, packer or importer',
    engineField: true,
    // Rule 6(1)(a) is satisfied by the manufacturer, the packer, or — for an
    // imported package — the importer, so every one of those labels feeds it.
    labels: [
      /\bmanufactured\s*(?:&|and)?\s*(?:marketed|packed|distributed)?\s*by\b/i,
      /\bmfd\.?\s*by\b/i,
      /\bmfg\.?\s*by\b/i,
      /\bmanufacturer\b/i,
      /\bimported\s*(?:&|and)?\s*(?:marketed|distributed|packed)?\s*by\b/i,
      /\bimporter\b/i,
      /\bpacked\s*(?:&|and)?\s*(?:marketed)?\s*by\b/i,
      /\bmarketed\s*by\b/i,
      /(?<![ऀ-ॿ])निर्माता(?![ऀ-ॿ])/,
    ],
    continuation: true,
    extract: wholeLine,
  },
  {
    field: 'consumer_care',
    label: 'Consumer care details',
    engineField: true,
    labels: [
      /*
       * `care` was the only noun this took after "consumer", and the heading
       * printed on a great many packs is not "Consumer Care" — it is "For
       * Consumer Complaints / Queries". Neither arm reached it: the first
       * wanted the word care, and the second wanted the complaint to follow
       * "for" immediately, which "For Consumer Complaints" does not.
       *
       * So a block giving an address, a mobile number and an e-mail address
       * was recorded as not declared, on a report served on the dealer — while
       * the same three lines sat in the manufacturer field, which had reached
       * them through "Same as Marketed By Address".
       */
      /\b(?:consumer|customer)\s*(?:care|complaints?|queries|grievances?|support|service)\b/i,
      /\bfor\s+(?:any\s+)?(?:\w+\s+){0,2}(?:complaints?|queries|feedback|grievances?)\b/i,
      /\bhelpline\b/i,
      /\bcustomer\s+service\b/i,
      /\bgrievance\s+officer\b/i,
    ],
    unlabelled: /(?:[\w.+-]+@[\w-]+\.[\w.]{2,}|\b1800[\s-]?\d{2,4}[\s-]?\d{3,4}\b|\+91[\s-]?\d{10}\b)/,
    continuation: true,
    extract: wholeLine,
  },
  {
    field: 'country_of_origin',
    label: 'Country of origin',
    engineField: true,
    labels: [
      /\bcountry\s+of\s+origin\b/i,
      /\bcountry\s+of\s+(?:manufacture|assembly)\b/i,
      /\bmade\s+in\b/i,
      /\bproduct\s+of\b/i,
      /\borigin\b/i,
    ],
    extract: afterLabel,
  },
  {
    field: 'dimensions',
    label: 'Dimensions',
    engineField: true,
    labels: [/\bdimensions?\b/i, /\bsize\b/i, /\bl\s*x\s*w\s*x\s*h\b/i],
    unlabelled: /\b\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:[x×]\s*\d+(?:\.\d+)?)?\s*(?:cm|mm|m|inch|in)\b/i,
    extract: afterLabel,
  },
  {
    field: 'veg_nonveg_mark',
    label: 'Vegetarian / non-vegetarian mark',
    engineField: true,
    labels: [],
    // The rule set names the permitted values; this maps the printed words onto
    // them and does nothing else. `non` is tested first — "non-vegetarian"
    // contains "vegetarian", and getting that backwards mislabels the product.
    unlabelled: /\b(?:non[\s-]?veg(?:etarian)?|veg(?:etarian)?)\b/i,
    extract: (_after, line) => {
      if (/\bnon[\s-]?veg/i.test(line)) return { value: 'NON_VEGETARIAN' };
      if (/\bveg(?:etarian)?\b/i.test(line)) return { value: 'VEGETARIAN' };
      return null;
    },
  },
  {
    field: 'gm_declaration',
    label: 'Genetically modified declaration',
    engineField: true,
    labels: [/\bgenetically\s+modified\b/i],
    unlabelled: /\bGM\b/,
    extract: (_after, line) => ({ value: line.trim() }),
  },

  /* ── Informational. Recorded and shown; never fed to a legal check. ─────── */

  {
    field: 'importer',
    label: 'Importer',
    engineField: false,
    labels: [/\bimported\s*(?:&|and)?\s*(?:marketed|distributed|packed)?\s*by\b/i, /\bimporter\b/i],
    continuation: true,
    extract: wholeLine,
  },
  {
    field: 'packer',
    label: 'Packer',
    engineField: false,
    labels: [/\bpacked\s*(?:&|and)?\s*(?:marketed)?\s*by\b/i],
    continuation: true,
    extract: wholeLine,
  },
  {
    field: 'expiry_date',
    label: 'Expiry date',
    engineField: false,
    labels: [/\bexpiry\s*(?:date|dt)?\b/i, /\bexp\.?\s*(?:date|dt)\b/i, /\bexpires?\s+on\b/i],
    extract: dateValue,
    neighbour: DATE_LIKE,
  },
  {
    field: 'fssai_licence',
    label: 'FSSAI licence number',
    engineField: false,
    labels: [/\bfssai\s*(?:lic\.?|licence|license)?\s*(?:no\.?|number)?\b/i],
    extract: (after) => {
      const match = /\b\d{14}\b/.exec(repairDigits(after).text);
      return match ? { value: match[0] } : afterLabel(after);
    },
    neighbour: /\d{6,}/,
  },
  {
    field: 'batch_number',
    label: 'Batch or lot number',
    engineField: false,
    labels: [/\bbatch\s*(?:no\.?|number|code)?\b/i, /\blot\s*(?:no\.?|number)?\b/i, /\bb\.?\s*no\.?\b/i],
    extract: afterLabel,
    neighbour: CODE_TOKEN,
  },
  {
    field: 'ingredients',
    label: 'Ingredients',
    engineField: false,
    labels: [/\bingredients?\b/i, /\bcomposition\b/i],
    /**
     * `Hero Ingredient : Vitamin B5 (BASF, Germany)` is a marketing line, not
     * the statutory ingredient list, and on a Minimalist tube it is printed
     * directly above the real one. Matched first by reading order, it became
     * the ingredients — and the actual list, five lines of it starting
     * `Water/Aqua`, went unclaimed two lines below.
     *
     * The qualifier is what gives it away: a package declares its ingredients
     * under `Ingredients`, and advertises one of them under `Hero`, `Key`,
     * `Active` or `Star`.
     */
    exclude: /\b(?:hero|key|active|star|main|primary)\s+ingredients?\b/i,
    // Long, because they are: a cosmetic declares twenty-odd over seven lines,
    // and a truncated list is not a shorter answer — it is a different one,
    // missing whichever ingredient the rule happens to be about.
    continuation: 8,
    extract: afterLabel,
  },
];

/** Every label form in the table — used to stop a continuation at a new label. */
export const ALL_LABELS: RegExp[] = FIELD_SPECS.flatMap((spec) => spec.labels);

/** The engine field keys this stage can produce, for documentation and tests. */
export const ENGINE_FIELDS = FIELD_SPECS.filter((spec) => spec.engineField).map((spec) => spec.field);

/** The informational keys, likewise. */
export const INFORMATIONAL_FIELDS = FIELD_SPECS.filter((spec) => !spec.engineField).map(
  (spec) => spec.field,
);
