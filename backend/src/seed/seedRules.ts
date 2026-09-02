import { Rule } from '../models';
import { RULE_SETS, severityFor } from '../services/ruleSets';
import type { ProductCategory } from '../types/domain';
import type { ValidationType } from '../types/rules';

/**
 * Seeds the rule repository from the compliance service's catalogue.
 *
 * `services/ruleSets.ts` remains the source `complianceService` evaluates
 * against — that is deliberate for now, because moving evaluation onto database
 * records is the real rule-engine work and belongs with the AI phase. This
 * projects the same catalogue into queryable, versionable records so the
 * dashboard shows the department the provisions actually in force rather than a
 * hardcoded list in a React component.
 *
 * The two cannot silently drift: both are generated from `RULE_SETS`.
 */

/** How each declaration is checked, beyond simple presence. */
const VALIDATION_BY_FIELD: Record<string, ValidationType> = {
  mrp: 'FORMAT',
  net_quantity: 'FORMAT',
  manufacturing_date: 'FORMAT',
  expiry_date: 'FORMAT',
  consumer_care: 'FORMAT',
  country_of_origin: 'PRESENCE',
  fssai_licence: 'FORMAT',
};

const PARAMETERS_BY_FIELD: Record<string, Record<string, unknown>> = {
  mrp: {
    pattern: '^(Rs\\.?|₹|MRP)\\s*\\d+(\\.\\d{1,2})?$',
    note: 'Inclusive of all taxes; the words "Maximum Retail Price" or "MRP" must appear.',
  },
  net_quantity: {
    pattern: '^\\d+(\\.\\d+)?\\s*(g|kg|ml|l|N|pcs)$',
    units: ['g', 'kg', 'ml', 'l', 'N'],
  },
  manufacturing_date: { format: 'MM/YYYY' },
  expiry_date: { format: 'MM/YYYY' },
  consumer_care: { requires: ['name', 'address', 'phoneOrEmail'] },
  fssai_licence: { pattern: '^\\d{14}$', digits: 14 },
};

/**
 * Turns a provision reference into a stable rule identifier.
 * `Rule 6(1)(c)` + `net_quantity` → `LM-PKG-6-1-C-NET-QUANTITY`.
 */
function ruleIdFor(ruleReference: string, field: string): string {
  const provision = ruleReference
    .replace(/rule\s*/i, '')
    .replace(/[()]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return `LM-PKG-${provision}-${field.replace(/_/g, '-')}`.toUpperCase();
}

export async function seedRules(options: { reset?: boolean } = {}): Promise<number> {
  if (options.reset) await Rule.deleteMany({});

  // See the note in `seed.ts`: the estimate is unreliable after an unclean
  // shutdown, and reseeding over existing rules is not harmless.
  const existing = await Rule.countDocuments();
  if (existing > 0) return 0;

  // One record per distinct declaration, carrying every category that demands
  // it — rather than one per category, which would duplicate the same provision
  // eight times and give an amendment eight places to be applied.
  const byField = new Map<
    string,
    {
      field: string;
      label: string;
      ruleReference: string;
      expectation: string;
      categories: ProductCategory[];
    }
  >();

  for (const [category, ruleSet] of Object.entries(RULE_SETS)) {
    for (const requirement of ruleSet.fields) {
      const entry = byField.get(requirement.name);
      if (entry) {
        entry.categories.push(category as ProductCategory);
        continue;
      }
      byField.set(requirement.name, {
        field: requirement.name,
        label: requirement.label,
        ruleReference: requirement.ruleReference,
        expectation: requirement.expectation,
        categories: [category as ProductCategory],
      });
    }
  }

  // The 2011 rules, so the effective date is not "whenever this was seeded".
  const effectiveFrom = new Date('2011-04-01T00:00:00.000Z');
  const totalCategories = Object.keys(RULE_SETS).length;

  const documents = [...byField.values()].map((entry) => ({
    ruleId: ruleIdFor(entry.ruleReference, entry.field),
    category: 'Mandatory Declarations',
    field: entry.field,
    fieldLabel: entry.label,
    title: `${entry.label} — ${entry.ruleReference}`,
    requirement: entry.expectation,
    validationType: VALIDATION_BY_FIELD[entry.field] ?? 'PRESENCE',
    parameters: PARAMETERS_BY_FIELD[entry.field] ?? {},
    ruleReference: entry.ruleReference,
    source: 'Legal Metrology (Packaged Commodities) Rules, 2011',
    // Same grading the compliance service applies when it raises a finding,
    // so the catalogue and the findings can never disagree.
    severity: severityFor(entry.field),
    version: 1,
    effectiveFrom,
    status: 'ACTIVE' as const,
    // An empty list reads as "every category", which is true only when the
    // declaration really is demanded across the board.
    appliesToCategories: entry.categories.length === totalCategories ? [] : entry.categories,
    history: [],
  }));

  await Rule.insertMany(documents);
  return documents.length;
}
