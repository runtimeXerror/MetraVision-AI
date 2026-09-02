import type { ProductCategory, Severity } from '../types/domain';

/**
 * Declaration requirements, keyed by product category.
 *
 * This is the backend's rule *catalogue*, not yet a rule engine: it says which
 * declarations a category requires and under which provision. Phase 3 replaces
 * `complianceService` with a real engine that reads a versioned rulebook from
 * the database; this table is the interim source and keeps the same shape
 * (`ruleSetId` + a list of requirements) so the swap is a change of source.
 *
 * Deliberately server-side. The mobile app renders whatever it is told is
 * required — it must not carry its own copy of the law.
 */

export interface FieldRequirement {
  name: string;
  label: string;
  ruleReference: string;
  required: boolean;
  /** Plain-language statement of what the provision demands. */
  expectation: string;
}

export interface RuleSet {
  id: string;
  label: string;
  fields: FieldRequirement[];
}

const COMMON: FieldRequirement[] = [
  {
    name: 'manufacturer',
    label: 'Manufacturer',
    ruleReference: 'Rule 6(1)(a)',
    required: true,
    expectation: 'Name and complete address of the manufacturer, packer or importer.',
  },
  {
    name: 'commodity_name',
    label: 'Common Name of Commodity',
    ruleReference: 'Rule 6(1)(b)',
    required: true,
    expectation: 'The generic name by which the commodity is known.',
  },
  {
    name: 'net_quantity',
    label: 'Net Quantity',
    ruleReference: 'Rule 6(1)(c)',
    required: true,
    expectation: 'Net quantity in standard units of weight, measure or number.',
  },
  {
    name: 'manufacturing_date',
    label: 'Manufacturing / Packing Date',
    ruleReference: 'Rule 6(1)(d)',
    required: true,
    expectation: 'Month and year in which the commodity was manufactured or packed.',
  },
  {
    name: 'mrp',
    label: 'Maximum Retail Price',
    ruleReference: 'Rule 6(1)(e)',
    required: true,
    expectation: 'Retail sale price declared as inclusive of all taxes.',
  },
  {
    name: 'consumer_care',
    label: 'Consumer Care Details',
    ruleReference: 'Rule 6(1)(f)',
    required: true,
    expectation: 'Name, address, telephone and email of the consumer care executive.',
  },
];

const FOOD_EXTRA: FieldRequirement[] = [
  {
    name: 'best_before',
    label: 'Best Before / Use By',
    ruleReference: 'FSSR 2.2.2(6)',
    required: true,
    expectation: 'Date up to which the product retains its declared properties.',
  },
  {
    name: 'veg_nonveg_mark',
    label: 'Veg / Non-Veg Mark',
    ruleReference: 'FSSR 2.2.2(4)',
    required: true,
    expectation: 'Green or brown symbol declaring the vegetarian status.',
  },
  {
    name: 'fssai_licence',
    label: 'FSSAI Licence Number',
    ruleReference: 'FSSR 2.2.2(9)',
    required: true,
    expectation: '14-digit licence number of the manufacturing unit.',
  },
];

const COSMETIC_EXTRA: FieldRequirement[] = [
  {
    name: 'batch_number',
    label: 'Batch Number',
    ruleReference: 'D&C Rule 148',
    required: true,
    expectation: 'Batch reference enabling traceability of the manufacturing lot.',
  },
  {
    name: 'expiry_date',
    label: 'Expiry Date',
    ruleReference: 'D&C Rule 149',
    required: true,
    expectation: 'Date after which the product should not be used.',
  },
];

const IMPORT_EXTRA: FieldRequirement[] = [
  {
    name: 'country_of_origin',
    label: 'Country of Origin',
    ruleReference: 'Rule 6(1)(g)',
    required: true,
    expectation: 'Country in which the commodity was manufactured, for imports.',
  },
];

export const RULE_SETS: Record<ProductCategory, RuleSet> = {
  packaged_food: { id: 'rs-food-v1', label: 'Packaged Food Commodities', fields: [...COMMON, ...FOOD_EXTRA] },
  beverage: { id: 'rs-beverage-v1', label: 'Packaged Beverages', fields: [...COMMON, ...FOOD_EXTRA] },
  /**
   * Soap, shampoo, toothpaste and the like.
   *
   * Kept separate from `cosmetic` even though both carry the batch and expiry
   * requirements, because the two are regulated under different provisions and
   * an inspector reading the report should see which one was applied.
   */
  personal_care: {
    id: 'rs-personal-care-v1',
    label: 'Personal Care & Toiletries',
    fields: [...COMMON, ...COSMETIC_EXTRA],
  },
  cosmetic: { id: 'rs-cosmetic-v1', label: 'Cosmetics & Toiletries', fields: [...COMMON, ...COSMETIC_EXTRA] },
  household: { id: 'rs-household-v1', label: 'Household Commodities', fields: COMMON },
  /**
   * Medicines are labelled under the Drugs and Cosmetics Rules, which demand a
   * batch number and an expiry date on every pack.
   */
  pharmaceutical: {
    id: 'rs-pharma-v1',
    label: 'Pharmaceuticals',
    fields: [...COMMON, ...COSMETIC_EXTRA],
  },
  medical_device: { id: 'rs-medical-v1', label: 'Medical Devices', fields: [...COMMON, ...COSMETIC_EXTRA] },
  apparel: {
    id: 'rs-apparel-v1',
    label: 'Garments & Textiles',
    fields: COMMON.filter((field) => field.name !== 'net_quantity'),
  },
  /**
   * Footwear is declared by size rather than by weight or measure, so the net
   * quantity requirement does not apply — the same reasoning as apparel.
   */
  footwear: {
    id: 'rs-footwear-v1',
    label: 'Footwear',
    fields: COMMON.filter((field) => field.name !== 'net_quantity'),
  },
  electronics: { id: 'rs-electronics-v1', label: 'Electronic Goods', fields: [...COMMON, ...IMPORT_EXTRA] },
  other: { id: 'rs-general-v1', label: 'General Commodities', fields: COMMON },
};

export function resolveRuleSet(category?: ProductCategory): RuleSet {
  return (category && RULE_SETS[category]) || RULE_SETS.other;
}

export function findRequirement(
  category: ProductCategory | undefined,
  name: string,
): FieldRequirement | undefined {
  return resolveRuleSet(category).fields.find((field) => field.name === name);
}

/**
 * Confidence below this routes a field to human review. Server-side so the
 * threshold can be tuned per deployment without shipping a new mobile build.
 */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.75;

/**
 * How grave a missing declaration is.
 *
 * Not every omission is equally serious, and treating them alike makes the
 * enforcement picture useless: a package with no price misleads a buyer at the
 * point of sale, while a missing consumer-care address obstructs redress after
 * it. Grading them is what lets a supervisor triage a day's findings.
 *
 * `complianceService` reads this when it raises a finding, and the rule
 * repository is seeded from it, so the catalogue and the findings cannot
 * disagree about how serious a provision is.
 */
const SEVERITY_BY_FIELD: Record<string, Severity> = {
  // Misleads the purchaser at the moment of sale.
  mrp: 'CRITICAL',
  net_quantity: 'CRITICAL',
  // Obstructs traceability and redress.
  manufacturer: 'MAJOR',
  consumer_care: 'MAJOR',
  fssai_licence: 'MAJOR',
  country_of_origin: 'MAJOR',
  expiry_date: 'MAJOR',
  // Identification and dating: required, but the package remains traceable.
  commodity_name: 'MINOR',
  manufacturing_date: 'MINOR',
};

export function severityFor(fieldName: string): Severity {
  return SEVERITY_BY_FIELD[fieldName] ?? 'MAJOR';
}
