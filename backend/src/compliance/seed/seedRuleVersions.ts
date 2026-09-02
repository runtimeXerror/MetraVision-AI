import { LegalRule } from '../../models/LegalRule';
import { RULE_VERSIONS } from '../data/ruleVersions';

/**
 * Projects the rule corpus into MongoDB.
 *
 * Keyed on `(ruleId, ruleVersion)`, matching the collection's unique index: a
 * reseed updates each version in place, and adding a new version to the data
 * file adds a row rather than replacing the one before it. That is the whole
 * amendment workflow — see `docs/legal-rule-engine.md`.
 */
export async function seedRuleVersions(options: { reset?: boolean } = {}): Promise<number> {
  if (options.reset) await LegalRule.deleteMany({});

  const operations = RULE_VERSIONS.map((rule) => ({
    updateOne: {
      filter: { ruleId: rule.ruleId, ruleVersion: rule.ruleVersion },
      update: { $set: rule },
      upsert: true,
    },
  }));

  if (operations.length > 0) await LegalRule.bulkWrite(operations, { ordered: false });
  return RULE_VERSIONS.length;
}

/** Convenience for the report and the dashboard: how many rules, how many versions. */
export function ruleCorpusShape(): { rules: number; versions: number } {
  return {
    rules: new Set(RULE_VERSIONS.map((rule) => rule.ruleId)).size,
    versions: RULE_VERSIONS.length,
  };
}
