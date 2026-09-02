/**
 * Rule repository wire shapes.
 *
 * Phase 2 carried the declaration requirements as a static table
 * (`services/ruleSets.ts`). The dashboard needs them to be records: viewable,
 * versionable and — for an admin — editable, because a legal metrology
 * requirement is amended by notification and the system has to be able to say
 * which text was in force on the date an inspection was carried out.
 *
 * This is a *catalogue*, still not an engine. Evaluation continues to live in
 * `complianceService`; these records describe what it checks.
 */

export const VALIDATION_TYPES = [
  'PRESENCE',
  'FORMAT',
  'NUMERIC_RANGE',
  'ENUM',
  'MIN_FONT_SIZE',
  'CROSS_FIELD',
] as const;
export type ValidationType = (typeof VALIDATION_TYPES)[number];

export const RULE_STATUSES = ['ACTIVE', 'DRAFT', 'RETIRED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/**
 * One prior text of a rule.
 *
 * Kept as an append-only list on the rule itself rather than a separate
 * collection: a rule's history is never queried independently of the rule, and
 * the alternative invites a version row that outlives its parent.
 */
export interface RuleVersionDTO {
  version: number;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  effectiveFrom: string;
  effectiveTo?: string;
  changedBy?: { id: string; name: string };
  changeNote?: string;
  recordedAt: string;
}

export interface RuleDTO {
  id: string;
  /** Human-facing identifier, e.g. `LM-PKG-006-1-C`. */
  ruleId: string;
  category: string;
  /** The extracted-field key this rule governs, e.g. `net_quantity`. */
  field: string;
  fieldLabel: string;
  title: string;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  /** The provision this is drawn from, e.g. `Rule 6(1)(c)`. */
  ruleReference: string;
  /** The instrument itself, e.g. the 2011 Packaged Commodities Rules. */
  source: string;
  severity: string;
  version: number;
  effectiveFrom: string;
  effectiveTo?: string;
  status: RuleStatus;
  appliesToCategories: string[];
  history: RuleVersionDTO[];
  createdAt: string;
  updatedAt: string;
}
