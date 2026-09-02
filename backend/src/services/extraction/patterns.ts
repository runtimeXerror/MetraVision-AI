import { canonicalUnit, firstAmount, repairDigits, unifyCurrency } from './normalise';

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

export type ExtractionMethod = 'LABEL_MATCH' | 'PATTERN_MATCH' | 'HEURISTIC' | 'DERIVED';

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
   */
  continuation?: boolean;
  /**
   * Turns the text after the label (and the whole line) into a value.
   * Returning `null` rejects the line, so the scan continues looking.
   */
  extract: (afterLabel: string, wholeLine: string) => ExtractedValue | null;
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

/** The text after the label, rejected when the label was all there was. */
const afterLabel = (after: string): ExtractedValue | null =>
  after.trim() === '' ? null : { value: after.trim() };

/* ── Currency ─────────────────────────────────────────────────────────────── */

/** `per kg`, `/kg`, `per 100 g` — the mark of a unit sale price, not an MRP. */
const PER_UNIT = /(?:\bper\b|\/)\s*(?:\d+\s*)?(?:kg|kilogram|g|gm|gram|mg|l|ltr|litre|liter|ml|cm|m|mm|no\.?|nos|unit|piece|pcs|number|n)\b/i;

const CURRENCY_LINE = /(?:₹|\bRs\.?\b|\bINR\b|\bRupees\b)\s*[0-9OoQDlIi|ZSsbGTB,.]/i;

/**
 * A price line, kept whole and digit-repaired.
 *
 * The repair is reported so the caller can lower the confidence it publishes.
 * A repaired price that is acted on at full confidence is a number this system
 * made up, and the difference between ₹l99 and ₹199 is the difference between a
 * correct reading and an accusation.
 */
function priceLine(_after: string, line: string): ExtractedValue | null {
  if (!CURRENCY_LINE.test(unifyCurrency(line))) return null;

  const { text, repaired } = repairDigits(line);
  if (firstAmount(text) === null) return null;

  return { value: text.trim(), repaired };
}

/* ── Quantity ─────────────────────────────────────────────────────────────── */

const QUANTITY_VALUE = /(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z]{1,12})\b/;

/**
 * A net-quantity declaration: a number and a unit.
 *
 * The unit is returned separately because `unitValidator` prefers an explicit
 * `field.unit` over one it has to parse back out of the text — the extraction
 * stage already knows which token was the unit, and re-deriving it is how "1 N"
 * becomes a unit of "N" on one path and nothing on another.
 */
function quantityValue(after: string): ExtractedValue | null {
  const { text, repaired } = repairDigits(after);
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

const DATE_LIKE =
  /\b(?:\d{1,2}\s*[/.-]\s*\d{1,2}\s*[/.-]\s*\d{2,4}|\d{1,2}\s*[/.-]\s*\d{4}|[A-Za-z]{3,9}\s*[\s/.-]\s*\d{4}|\d{4}\s*-\s*\d{1,2})\b/;

/**
 * The date portion of a declaration.
 *
 * Where a date is recognisable it is returned on its own; where it is not, the
 * remaining text is returned unchanged so the rule engine's date validator can
 * say "this could not be read as a month and year" about the text that was
 * actually printed, rather than about an empty string this stage invented.
 */
function dateValue(after: string): ExtractedValue | null {
  if (after.trim() === '') return null;
  const match = DATE_LIKE.exec(after);
  return { value: (match?.[0] ?? after).trim() };
}

/* ── The table ────────────────────────────────────────────────────────────── */

/**
 * Ordered by precedence, because a line is claimed once.
 *
 * Unit sale price comes before MRP: both are rupee amounts, and "₹63.00 per kg"
 * read as a retail price would be a false reading with legal consequences. The
 * narrower pattern goes first, always.
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
      /\bप्रति\s*मूल्य\b/i,
      /\bअधिकतम\s+खुदरा\s+मूल्य\b/,
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
      /\bquantity\b/i,
      /\bcontents?\b/i,
      /\bशुद्ध\s*(?:मात्रा|वजन)\b/,
    ],
    // Never let a price line become a quantity: both carry a number.
    exclude: /(?:₹|\bRs\.?\b|\bINR\b|\bprice\b)/i,
    unlabelled: /^\s*\d[\d,]*(?:\.\d+)?\s*(?:kg|kgs|g|gm|gms|mg|ml|l|ltr|litre|liter|cm|mm|m|N|No|Nos|pcs|pieces?|pair|set|units?)\s*$/i,
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
      /\bmfg\.?\s*(?:date|dt)?\b/i,
      /\bmfd\.?\s*(?:date|dt)?\b/i,
      /\bpkd\.?\s*(?:date|dt)?\b/i,
      /\bनिर्माण\s*(?:तिथि|दिनांक)\b/,
    ],
    // These are their own declarations under their own clauses.
    exclude: /\b(?:best\s+before|use\s+by|use\s+before|expiry|expires|exp\.?\s*(?:date|dt))\b/i,
    extract: dateValue,
  },
  {
    field: 'best_before',
    label: 'Best before',
    engineField: true,
    labels: [/\bbest\s+before\b/i, /\bbest\s+by\b/i, /\buse\s+by\b/i, /\buse\s+before\b/i],
    extract: dateValue,
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
      /\bनिर्माता\b/,
    ],
    continuation: true,
    extract: wholeLine,
  },
  {
    field: 'consumer_care',
    label: 'Consumer care details',
    engineField: true,
    labels: [
      /\b(?:consumer|customer)\s*care\b/i,
      /\bfor\s+(?:any\s+)?(?:complaints?|queries|feedback|grievances?)\b/i,
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
  },
  {
    field: 'batch_number',
    label: 'Batch or lot number',
    engineField: false,
    labels: [/\bbatch\s*(?:no\.?|number|code)?\b/i, /\blot\s*(?:no\.?|number)?\b/i, /\bb\.?\s*no\.?\b/i],
    extract: afterLabel,
  },
  {
    field: 'ingredients',
    label: 'Ingredients',
    engineField: false,
    labels: [/\bingredients?\b/i, /\bcomposition\b/i],
    continuation: true,
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
