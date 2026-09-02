import type { LegalRule } from '../types/Rule';
import { RULE_VERSIONS } from '../data/ruleVersions';

/**
 * The Principal Rules, 2011 as originally enacted.
 *
 * Not a separate seeder with its own data — that would give the corpus two
 * places where the text of rule 6(1)(c) lives, and two places is one too many.
 * The principal rules are simply the versions of the corpus sourced to
 * G.S.R. 202(E), and this module reads them back out of it.
 *
 * Kept as a named entry point because the phase brief asks for one, and because
 * "what did the rules say when they were made?" is a question worth being able
 * to ask directly.
 */

export const PRINCIPAL_RULES_NOTIFICATION = 'G.S.R. 202(E)';

export function principalRuleVersions(): LegalRule[] {
  return RULE_VERSIONS.filter((rule) => rule.source.notification === PRINCIPAL_RULES_NOTIFICATION).sort((a, b) =>
    a.ruleId.localeCompare(b.ruleId),
  );
}

/**
 * Seeding the principal rules is a subset of seeding the corpus, so this
 * delegates rather than writing a second time. Exposed for the brief's file
 * layout and for anyone who wants only the 2011 baseline.
 */
export async function seedPrincipalRules(): Promise<number> {
  const { seedRuleVersions } = await import('./seedRuleVersions');
  await seedRuleVersions();
  return principalRuleVersions().length;
}
