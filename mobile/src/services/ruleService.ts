import { request } from './api';

/**
 * The rulebook, as the inspector reads it.
 *
 * The same corpus the engine decides on — served from `/rules/legal`, not
 * restated here. A second copy of the law inside the app is a copy that goes
 * stale the day an amendment is seeded, and an inspector quoting a superseded
 * requirement at a trader is worse off than one who looked nothing up at all.
 *
 * Only what is **in force** is fetched. The corpus holds every historical
 * version of every provision so an old inspection can be replayed against the
 * law of its own date; that history matters to the engine and to an audit, and
 * not at all to an officer standing in a shop who needs to know what the rule
 * says today.
 */

export interface LegalRuleSummary {
  ruleId: string;
  ruleVersion: string;
  /** `6(1)(e)` where the corpus has one, else the sub-rule or the rule. */
  clause: string;
  title: string;
  /** One sentence on what the provision demands. */
  requirement: string;
  /** Verbatim text of the provision, as it currently stands. */
  legalText: string;
  /** This system's narrower reading — explicitly not authoritative. */
  machineInterpretation: string;
  category: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  effectiveFrom: string;
  notification: string;
  notificationDate: string;
  officialUrl?: string;
}

interface LegalRuleDTO {
  ruleId: string;
  ruleVersion: string;
  sourceRule: string;
  sourceSubRule?: string;
  sourceClause?: string;
  title: string;
  requirement: string;
  legalText: string;
  machineInterpretation: string;
  category: string;
  severity: 'CRITICAL' | 'MAJOR' | 'MINOR';
  effectiveFrom: string;
  source: { notification: string; notificationDate: string; officialUrl?: string };
}

interface PagedDTO {
  items: LegalRuleDTO[];
  total: number;
}

/**
 * Every provision currently in force, ordered by the clause an officer would
 * cite rather than by the corpus's internal id.
 */
export async function listRules(): Promise<LegalRuleSummary[]> {
  // 100 against a corpus of ~21 in-force versions: one request, no paging, and
  // headroom for the amendments this rulebook exists to keep up with.
  const paged = await request<PagedDTO>('/rules/legal', {
    query: { status: 'ACTIVE', pageSize: 100 },
  });

  return paged.items
    .map((rule) => ({
      ruleId: rule.ruleId,
      ruleVersion: rule.ruleVersion,
      clause: rule.sourceClause ?? rule.sourceSubRule ?? rule.sourceRule,
      title: rule.title,
      requirement: rule.requirement,
      legalText: rule.legalText,
      machineInterpretation: rule.machineInterpretation,
      category: rule.category,
      severity: rule.severity,
      effectiveFrom: rule.effectiveFrom,
      notification: rule.source.notification,
      notificationDate: rule.source.notificationDate,
      officialUrl: rule.source.officialUrl,
    }))
    .sort((a, b) => a.clause.localeCompare(b.clause, undefined, { numeric: true }));
}
