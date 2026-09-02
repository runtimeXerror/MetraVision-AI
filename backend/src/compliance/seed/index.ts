import { RuleConflict } from '../../models/RuleConflict';
import { SOURCE_CONFLICTS } from '../data/conflicts';

import { seedAmendments } from './seedAmendments';
import { seedExceptions } from './seedExceptions';
import { seedRuleVersions } from './seedRuleVersions';

/**
 * Seeds the whole legal corpus.
 *
 * Order matters only for readability — nothing here has a foreign key — but
 * amendments first mirrors how the corpus is reasoned about: the notification
 * exists, then the rule version it produced, then the exemptions it created.
 */

export interface SeedCorpusResult {
  amendments: number;
  ruleVersions: number;
  exceptions: number;
  sourceConflicts: number;
}

async function seedSourceConflicts(options: { reset?: boolean } = {}): Promise<number> {
  if (options.reset) await RuleConflict.deleteMany({});

  const operations = SOURCE_CONFLICTS.map((entry) => ({
    updateOne: { filter: { conflictId: entry.conflictId }, update: { $set: entry }, upsert: true },
  }));

  if (operations.length > 0) await RuleConflict.bulkWrite(operations, { ordered: false });
  return SOURCE_CONFLICTS.length;
}

export async function seedLegalCorpus(options: { reset?: boolean } = {}): Promise<SeedCorpusResult> {
  const amendments = await seedAmendments(options);
  const ruleVersions = await seedRuleVersions(options);
  const exceptions = await seedExceptions(options);
  const sourceConflicts = await seedSourceConflicts(options);

  return { amendments, ruleVersions, exceptions, sourceConflicts };
}

export { seedAmendments } from './seedAmendments';
export { seedExceptions } from './seedExceptions';
export { seedRuleVersions, ruleCorpusShape } from './seedRuleVersions';
export { seedPrincipalRules, principalRuleVersions, PRINCIPAL_RULES_NOTIFICATION } from './seedPrincipalRules';
