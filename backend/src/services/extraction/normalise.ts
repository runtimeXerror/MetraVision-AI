/**
 * ── NORMALISATION ───────────────────────────────────────────────────────────
 *
 * The first stage of extraction, and the only one allowed to change the text.
 *
 * Two principles hold everywhere below.
 *
 * The first is that normalisation is *reversible in the record*: whatever this
 * module rewrites, the original OCR line is still carried on the evidence, so
 * an inspector always sees what the camera read and not only what the software
 * made of it.
 *
 * The second is that a repair is never silent. `repairDigits` reports whether
 * it changed anything, and every caller that acts on a repaired value lowers
 * the confidence it reports. A system that quietly turns "₹l99" into "₹199" and
 * then asserts the price with full confidence has invented evidence.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * Every rupee glyph and abbreviation a label or an OCR engine may produce.
 *
 * The trailing full stop is part of the abbreviation, so a lookahead — not a
 * word boundary — has to end the match: `\bRs\.?\b` matches only "Rs" in
 * "Rs. 120", because there is no word boundary between "." and " ", and leaves
 * a stray full stop behind. `Re` additionally requires a digit, since on its
 * own it is the start of too many ordinary words.
 */
const RUPEE_FORMS =
  /[₹﹩]|\b(?:Rs|INR|Rupees?)\.?(?=\s*\d|\s|$)|\bRe\.?(?=\s*\d)|\bR5\.(?=\s*\d)/gi;

/**
 * `R5.` in the alternation above is an OCR confusion, not a currency.
 *
 * `s` and `5` are the classic recogniser swap, and on a photographed packet
 * "Rs." comes back as "R5." routinely — it did twice on the first real packet
 * this system read, which is why the MRP came out as `R5.60.00` and the price
 * check found nothing to test. Without the currency marker the line does not
 * look like a price at all, so the declaration is not merely misread, it is
 * invisible.
 *
 * Deliberately narrow: only `R5` immediately followed by a full stop and a
 * digit. `R5` alone is a plausible model number, and rewriting that into a
 * price is a worse error than the one being fixed.
 */

/**
 * Latin/Devanagari lookalikes an OCR engine substitutes in numeric runs.
 * Applied only inside `repairDigits`, and only to a span already known to be
 * a number — never across free text, where "Ol" is a word and not an "01".
 */
const DIGIT_CONFUSIONS: Record<string, string> = {
  O: '0',
  o: '0',
  Q: '0',
  D: '0',
  l: '1',
  I: '1',
  i: '1',
  '|': '1',
  Z: '2',
  S: '5',
  s: '5',
  b: '6',
  G: '6',
  T: '7',
  B: '8',
  g: '9',
  q: '9',
};

/**
 * Canonicalises one line of OCR text.
 *
 * NFKC folds the compatibility forms that packaging fonts and OCR engines
 * emit — full-width digits, ligatures, the several codepoints that all render
 * as a rupee sign — into one representation, so the patterns downstream have a
 * single spelling to match rather than six.
 */
export function normaliseLine(text: string): string {
  return text
    .normalize('NFKC')
    // Unify the dash family: labels use en dashes, OCR reads them as hyphens.
    .replace(/[‐-―−]/g, '-')
    // Unify quotes, which appear inside addresses.
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    // Non-breaking, narrow no-break, figure and thin spaces, all common in
    // typeset label copy. Written as escapes rather than as literals: an
    // invisible character in a character class is a character nobody can
    // review, and one of these is a zero-width no-break space.
    .replace(/[\u00a0\u2007\u202f\u2009\u2002\u2003\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Splits raw OCR text into normalised, non-empty lines. */
export function normaliseText(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map(normaliseLine)
    .filter((line) => line !== '');
}

/**
 * Rewrites every rupee spelling to `₹`, so one currency test covers them all.
 *
 * Note this runs *for matching only*. The value handed to the rule engine keeps
 * the label's own wording, because rule 6(1)(e) as it stood from 2018 to 2024
 * required the declaration to identify itself as a maximum retail price, and
 * the engine has to see the words that were actually printed.
 */
export function unifyCurrency(text: string): string {
  return text.replace(RUPEE_FORMS, '₹');
}

/**
 * Repairs the number that sits immediately before a unit token.
 *
 * `repairDigits` below is deliberately timid: it only touches a span that is
 * already more digit than letter, because applied to ordinary text the same
 * substitution turns "Oil" into "0i1". That guard is right, and it is also why
 * `Net Wt. 5OO g` came back as `5OO g` — one digit against two letters, so the
 * span was left alone and a 500 g package had no readable net quantity. `5O g`
 * happened to survive it; `5OO g`, `1OO ml` and `2OO g` did not, and those are
 * ordinary pack sizes.
 *
 * The narrower context is what makes the bolder repair safe. This only fires on
 * a token that is *immediately followed by a recognised unit*, and only when
 * every character in it is either a digit or a known digit confusion. "Vitamin
 * B5" is untouched because nothing follows it that looks like a unit; "5OO g"
 * is repaired because something does.
 */
export function repairQuantityDigits(text: string): DigitRepair {
  let repaired = false;

  const fixed = text.replace(
    /\b([0-9OoQDlIi|ZSsbGTBgq][0-9OoQDlIi|ZSsbGTBgq,.]*)(\s*)(?=(?:kg|kgs|g|gm|gms|gr|mg|ml|l|ltr|ltrs|lt|litre|liter|litres|liters|cm|mm|m|N|No|Nos|pc|pcs|piece|pieces|pair|set|unit|units)\b)/gi,
    (whole, token: string, gap: string) => {
      // At least one character has to be a real digit already, or "No g" —
      // a heading above a table — becomes "N0 g".
      if (!/[0-9]/.test(token)) return whole;

      const swapped = token.replace(
        /[OoQDlIi|ZSsbGTBgq]/g,
        (character) => DIGIT_CONFUSIONS[character] ?? character,
      );

      if (swapped !== token) repaired = true;
      return swapped + gap;
    },
  );

  return { text: fixed, repaired };
}

export interface DigitRepair {
  text: string;
  /** True when at least one character was substituted. */
  repaired: boolean;
}

/**
 * Repairs OCR character confusions inside numeric runs.
 *
 * A "numeric run" is a span that already looks like a number with a stray
 * letter in it — `5O g`, `₹l99.00`, `1,2O0`. The guard is deliberate: applied
 * to arbitrary text this substitution turns "Oil" into "0i1", and a system that
 * does that to an address will eventually do it to a price.
 */
export function repairDigits(text: string): DigitRepair {
  let repaired = false;

  const repairSpan = (span: string): string => {
    // Only touch a span that is mostly digits already and holds at least one.
    const digits = (span.match(/[0-9]/g) ?? []).length;
    const letters = (span.match(/[A-Za-z|]/g) ?? []).length;
    if (digits === 0 || letters === 0 || letters > digits) return span;

    const fixed = span.replace(/[OoQDlIi|ZSsbGTBgq]/g, (character) => DIGIT_CONFUSIONS[character] ?? character);
    if (fixed !== span) repaired = true;
    return fixed;
  };

  // Spans never cross a space: "5O g" must split into "5O" and "g", so the
  // unit is not counted as a stray letter inside the number and the number is
  // repaired on its own. Letting a span run over the space leaves "5O g"
  // looking like two letters against one digit, and so leaves it broken.
  const result = text.replace(/[0-9OoQDlIi|ZSsbGTBgq][0-9OoQDlIi|ZSsbGTBgq,.]*/g, (span) => {
    /**
     * A unit written tight against its number is not a character confusion.
     *
     * `g`, `G`, `b`, `S`, `T` and `q` are all in the confusion table, and Indian
     * packaging almost always prints the net quantity closed up — `200g`,
     * `500G`, `75gm`. Without this guard those became `2009`, `1006` and
     * `759m`: the unit was eaten, the quantity pattern then found no unit to
     * match, and the extractor fell through to whatever other number it could
     * see. On a food label that is the nutrition table, so a 200g packet was
     * reported as 22.2 g — a wrong declaration, recorded against a trader.
     *
     * The number in front is still repaired: `2O0g` is `200g`.
     */
    const closedUnit = /^(.*[0-9OoQDlIi|ZSsbGTBgq].*?)([A-Za-z]{1,4})$/.exec(span);
    if (closedUnit?.[1] && closedUnit[2] && canonicalUnit(closedUnit[2])) {
      return repairSpan(closedUnit[1]) + closedUnit[2];
    }

    return repairSpan(span);
  });

  return { text: result, repaired };
}

/** Strips a matched label and its separator from the head of a line. */
export function stripLabel(line: string, label: RegExp): string {
  const match = label.exec(line);
  if (!match) return line;
  return line.slice(match.index + match[0].length).replace(/^\s*[:.\-–—=]\s*/, '').trim();
}

/**
 * The first number in a string, tolerating Indian digit grouping.
 *
 * `1,2,499.00` and `1,24,999` are both written on Indian packages; a plain
 * `parseFloat` after stripping commas handles both, and the lakh grouping is
 * why the comma is removed rather than treated as a decimal separator.
 */
export function firstAmount(text: string): number | null {
  const match = /-?\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

/**
 * Canonical spelling for a unit token.
 *
 * Maps the abbreviations found on packages onto the standard units rule 6(1)(c)
 * recognises. `gm`, `gms` and `grams` are all the gram; the rule set lists `g`,
 * so a package declaring "200 gm" is compliant and must not be failed over the
 * spelling of its unit.
 */
const UNIT_CANONICAL: Record<string, string> = {
  g: 'g', gm: 'g', gms: 'g', gram: 'g', grams: 'g', gr: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', kilograms: 'kg', kilo: 'kg',
  mg: 'mg', milligram: 'mg', milligrams: 'mg',
  ml: 'ml', millilitre: 'ml', milliliter: 'ml', millilitres: 'ml', milliliters: 'ml',
  l: 'l', ltr: 'l', ltrs: 'l', lt: 'l', litre: 'l', liter: 'l', litres: 'l', liters: 'l',
  cm: 'cm', centimetre: 'cm', centimeter: 'cm',
  mm: 'mm', millimetre: 'mm', millimeter: 'mm',
  m: 'm', metre: 'm', meter: 'm', metres: 'm', meters: 'm',
  n: 'N', no: 'No', nos: 'Nos', num: 'No', number: 'No',
  pc: 'pcs', pcs: 'pcs', piece: 'piece', pieces: 'pieces',
  pair: 'pair', pairs: 'pair', set: 'set', sets: 'set', unit: 'unit', units: 'unit',
  u: 'unit',

  /**
   * Devanagari unit names.
   *
   * A bilingual package may print its net quantity only in Hindi — "शुद्ध मात्रा
   * 200 ग्राम" — and rule 6(1)(c) is satisfied by that declaration. Without
   * these the quantity pattern finds a number with no recognisable unit and the
   * declaration is reported missing, which is a violation raised against a
   * trader who complied.
   *
   * They canonicalise to the same standard units, so nothing downstream has to
   * know the label was in Hindi.
   */
  ग्राम: 'g', ग्रा: 'g',
  किलोग्राम: 'kg', किग्रा: 'kg', किलो: 'kg',
  मिलीग्राम: 'mg',
  मिलीलीटर: 'ml', मिली: 'ml',
  लीटर: 'l', ली: 'l',
  मीटर: 'm', सेंटीमीटर: 'cm', मिलीमीटर: 'mm',
  नग: 'No', जोड़ी: 'pair',
};

export function canonicalUnit(token: string): string | null {
  const key = token.toLowerCase().replace(/\.$/, '').trim();
  return UNIT_CANONICAL[key] ?? null;
}

/** The unit tokens the quantity patterns will accept, longest first. */
export const UNIT_TOKENS = Object.keys(UNIT_CANONICAL).sort((a, b) => b.length - a.length);
