import type { ProductCategory } from '../../types/domain';

/**
 * ── WHAT THE PACKAGE CONTAINS, AS PRINTED ON IT ─────────────────────────────
 *
 * Rule 6(1)(b) asks for "the common or generic name of the commodity". That is
 * a *noun*: moisturizer, biscuits, detergent. It is not the brand, it is not
 * the variant, and it is almost never printed with a label in front of it — a
 * package says `MOISTURIZER`, never `Common name: moisturizer`.
 *
 * So it cannot be found the way the rest of the table is found, and the
 * heuristic it used instead — the wordiest of the first five lines the
 * recogniser emitted — produced `+ hyaluronic acid + betaine` on a Minimalist
 * tube and `SALTED TO PERFECTION` on a Haldiram packet. Both are marketing
 * copy sitting where the heuristic happened to look.
 *
 * A vocabulary of commodity nouns is the honest fix. It is a dictionary of
 * *what things are*, not of who makes them: there is not a brand in this file
 * and there must never be one, because a system that recognises Dove and not
 * its competitor is not an enforcement tool.
 *
 * The same vocabulary answers a second question for free. Knowing the package
 * holds a moisturizer is knowing it is a cosmetic, and the category decides
 * which rules apply at all — so the noun that names the commodity also
 * classifies it, from the same evidence, with the same word to point at when
 * an inspector asks why.
 *
 * ── ON AMBIGUITY ────────────────────────────────────────────────────────────
 *
 * Some nouns name a commodity without settling its category. `Oil` is hair oil
 * or mustard oil; `powder` is talcum or turmeric; `syrup` is a cough
 * preparation or a drink. Those carry no category here. Naming the commodity
 * is still useful and guessing the category from a word that does not carry it
 * would put the package under the wrong rules — which is a worse failure than
 * having no category at all, because the caller can supply one.
 * ────────────────────────────────────────────────────────────────────────────
 */

interface CommodityNoun {
  /** The printed noun. Matched whole, case-insensitively, longest first. */
  noun: string;
  /** Omitted where the word alone does not settle the category. */
  category?: ProductCategory;
}

/**
 * Ordered by specificity within each group, not alphabetically: `body wash`
 * has to be tried before `wash`, and `hair oil` before `oil`.
 */
const NOUNS: CommodityNoun[] = [
  /* ── Cosmetics and toiletries ───────────────────────────────────────── */
  { noun: 'body wash', category: 'cosmetic' },
  { noun: 'face wash', category: 'cosmetic' },
  { noun: 'hand wash', category: 'cosmetic' },
  { noun: 'face cream', category: 'cosmetic' },
  { noun: 'cold cream', category: 'cosmetic' },
  { noun: 'shaving cream', category: 'cosmetic' },
  { noun: 'hair oil', category: 'cosmetic' },
  { noun: 'hair colour', category: 'cosmetic' },
  { noun: 'hair color', category: 'cosmetic' },
  { noun: 'lip balm', category: 'cosmetic' },
  { noun: 'nail polish', category: 'cosmetic' },
  { noun: 'talcum powder', category: 'cosmetic' },
  { noun: 'moisturizer', category: 'cosmetic' },
  { noun: 'moisturiser', category: 'cosmetic' },
  { noun: 'conditioner', category: 'cosmetic' },
  { noun: 'antiperspirant', category: 'cosmetic' },
  { noun: 'deodorant', category: 'cosmetic' },
  { noun: 'sunscreen', category: 'cosmetic' },
  { noun: 'sunblock', category: 'cosmetic' },
  { noun: 'toothpaste', category: 'personal_care' },
  { noun: 'sanitizer', category: 'personal_care' },
  { noun: 'sanitiser', category: 'personal_care' },
  { noun: 'shampoo', category: 'cosmetic' },
  { noun: 'cleanser', category: 'cosmetic' },
  { noun: 'lipstick', category: 'cosmetic' },
  { noun: 'kajal', category: 'cosmetic' },
  { noun: 'perfume', category: 'cosmetic' },
  { noun: 'fragrance', category: 'cosmetic' },
  { noun: 'serum', category: 'cosmetic' },
  { noun: 'toner', category: 'cosmetic' },
  { noun: 'lotion', category: 'cosmetic' },
  { noun: 'scrub', category: 'cosmetic' },
  { noun: 'soap', category: 'cosmetic' },
  { noun: 'roll on', category: 'cosmetic' },
  { noun: 'roll-on', category: 'cosmetic' },

  /* ── Food ────────────────────────────────────────────────────────────── */
  { noun: 'mustard oil', category: 'packaged_food' },
  { noun: 'refined oil', category: 'packaged_food' },
  { noun: 'edible oil', category: 'packaged_food' },
  { noun: 'milk powder', category: 'packaged_food' },
  { noun: 'baking powder', category: 'packaged_food' },
  { noun: 'instant noodles', category: 'packaged_food' },
  { noun: 'drinking water', category: 'beverage' },
  { noun: 'biscuits', category: 'packaged_food' },
  { noun: 'biscuit', category: 'packaged_food' },
  { noun: 'cookies', category: 'packaged_food' },
  { noun: 'namkeen', category: 'packaged_food' },
  { noun: 'chocolate', category: 'packaged_food' },
  { noun: 'noodles', category: 'packaged_food' },
  { noun: 'vermicelli', category: 'packaged_food' },
  { noun: 'cornflakes', category: 'packaged_food' },
  { noun: 'chips', category: 'packaged_food' },
  { noun: 'wafers', category: 'packaged_food' },
  { noun: 'pickle', category: 'packaged_food' },
  { noun: 'ketchup', category: 'packaged_food' },
  { noun: 'masala', category: 'packaged_food' },
  { noun: 'atta', category: 'packaged_food' },
  { noun: 'maida', category: 'packaged_food' },
  { noun: 'besan', category: 'packaged_food' },
  { noun: 'rava', category: 'packaged_food' },
  { noun: 'poha', category: 'packaged_food' },
  { noun: 'ghee', category: 'packaged_food' },
  { noun: 'paneer', category: 'packaged_food' },
  { noun: 'butter', category: 'packaged_food' },
  { noun: 'cheese', category: 'packaged_food' },
  { noun: 'honey', category: 'packaged_food' },
  { noun: 'cereal', category: 'packaged_food' },
  { noun: 'oats', category: 'packaged_food' },
  { noun: 'pasta', category: 'packaged_food' },
  { noun: 'rusk', category: 'packaged_food' },
  { noun: 'bread', category: 'packaged_food' },
  { noun: 'sugar', category: 'packaged_food' },
  { noun: 'jaggery', category: 'packaged_food' },
  { noun: 'salt', category: 'packaged_food' },
  { noun: 'spices', category: 'packaged_food' },
  { noun: 'pulses', category: 'packaged_food' },
  { noun: 'dal', category: 'packaged_food' },
  { noun: 'rice', category: 'packaged_food' },
  { noun: 'tea', category: 'packaged_food' },
  { noun: 'coffee', category: 'packaged_food' },
  { noun: 'jam', category: 'packaged_food' },
  { noun: 'sauce', category: 'packaged_food' },

  /* ── Beverages ───────────────────────────────────────────────────────── */
  { noun: 'energy drink', category: 'beverage' },
  { noun: 'soft drink', category: 'beverage' },
  { noun: 'fruit drink', category: 'beverage' },
  { noun: 'mineral water', category: 'beverage' },
  { noun: 'juice', category: 'beverage' },
  { noun: 'squash', category: 'beverage' },
  { noun: 'beverage', category: 'beverage' },

  /* ── Household ───────────────────────────────────────────────────────── */
  { noun: 'detergent powder', category: 'household' },
  { noun: 'detergent cake', category: 'household' },
  { noun: 'dishwash', category: 'household' },
  { noun: 'dish wash', category: 'household' },
  { noun: 'floor cleaner', category: 'household' },
  { noun: 'toilet cleaner', category: 'household' },
  { noun: 'glass cleaner', category: 'household' },
  { noun: 'air freshener', category: 'household' },
  { noun: 'fabric conditioner', category: 'household' },
  { noun: 'mosquito repellent', category: 'household' },
  { noun: 'insect repellent', category: 'household' },
  { noun: 'detergent', category: 'household' },
  { noun: 'phenyl', category: 'household' },
  { noun: 'bleach', category: 'household' },

  /* ── Pharmaceutical ──────────────────────────────────────────────────── */
  { noun: 'tablets', category: 'pharmaceutical' },
  { noun: 'capsules', category: 'pharmaceutical' },
  { noun: 'ointment', category: 'pharmaceutical' },

  /* ── Named, but not classified ───────────────────────────────────────── */
  { noun: 'powder' },
  { noun: 'cream' },
  { noun: 'syrup' },
  { noun: 'gel' },
  { noun: 'oil' },
  { noun: 'wash' },
  { noun: 'spray' },
  { noun: 'balm' },
  { noun: 'mask' },
  { noun: 'drink' },
  { noun: 'snack' },
  { noun: 'flour' },
  { noun: 'mix' },
];

/** Longest first, so `body wash` is tried before `wash`. */
const ORDERED = [...NOUNS].sort((a, b) => b.noun.length - a.noun.length);

export interface CommodityMatch {
  /** The noun as printed on the package, not as spelled in the table. */
  printed: string;
  /** The table's spelling — stable across labels, for the category lookup. */
  noun: string;
  category?: ProductCategory;
}

/**
 * The commodity noun in a line, if there is one.
 *
 * Matched on a word boundary so `salt` is not found inside `asphalt`, and the
 * text is returned as the package printed it — an inspector comparing the
 * report against the package should see the package's own word.
 */
export function commodityNounIn(text: string): CommodityMatch | undefined {
  for (const entry of ORDERED) {
    const pattern = new RegExp(`\\b${entry.noun.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
    const match = pattern.exec(text);

    if (match && !isDenied(text, match.index, match[0].length)) {
      return { printed: match[0], noun: entry.noun, ...(entry.category ? { category: entry.category } : {}) };
    }
  }

  return undefined;
}

/**
 * Whether the noun is being denied rather than declared.
 *
 * `lightweight & oil free` is a claim about what the package does *not*
 * contain, and on the front of this moisturizer it is printed larger than the
 * word `MOISTURIZER` is. Read as a commodity noun it wins on size, and the
 * tube gets reported as containing oil. `sugar free`, `alcohol free`,
 * `no added sugar` and `free from parabens` are the same shape, and a denial
 * must not vote on the category either — a "sugar free" drink is not evidence
 * of a sugar package.
 *
 * Deliberately narrow. Only the words touching the noun are read, because a
 * wider window picks up `free` from a different sentence on the same line.
 */
function isDenied(text: string, index: number, length: number): boolean {
  const before = text.slice(Math.max(0, index - 14), index);
  const after = text.slice(index + length, index + length + 8);

  const negatedBefore = /\b(?:no|without|zero)\s+(?:added\s+)?$|\bfree\s+(?:from|of)\s+$/i.test(
    before,
  );
  const negatedAfter = /^\s*-?\s*free\b/i.test(after);

  return negatedBefore || negatedAfter;
}

/**
 * The category the commodity nouns across a label agree on.
 *
 * Agreement is the point. A single word can appear anywhere — `oil` turns up
 * in the ingredients of a shampoo — so the classification is only reported
 * when the nouns that do carry a category all carry the same one, and the
 * confidence says how many of them there were. Where they disagree the caller
 * is left to say, which on this system is an inspector who is holding the
 * package.
 */
export function categoryFrom(matches: CommodityMatch[]): { value: ProductCategory; confidence: number } | undefined {
  const categorised = matches.filter((match): match is CommodityMatch & { category: ProductCategory } =>
    match.category !== undefined,
  );

  if (categorised.length === 0) return undefined;

  const distinct = new Set(categorised.map((match) => match.category));
  if (distinct.size > 1) return undefined;

  const value = categorised[0]!.category;

  // One noun is a reading; several agreeing is a classification. Capped below
  // certainty, because a vocabulary match is evidence and not proof.
  return { value, confidence: Math.min(0.9, 0.6 + 0.15 * (categorised.length - 1)) };
}
