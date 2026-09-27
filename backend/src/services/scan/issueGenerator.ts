import { createHash } from 'node:crypto';

import type { ComplianceCheck, ComplianceResult } from '../../compliance/types/ComplianceResult';
import type { EvidenceReference } from '../../compliance/types/Evidence';
import type { RuleSeverity } from '../../compliance/types/Rule';

/**
 * ── ISSUES ──────────────────────────────────────────────────────────────────
 *
 * Turns the engine's checks into the things an inspector acts on.
 *
 * This is a *presentation* step and nothing more. Every word of legal substance
 * in an issue — the requirement, the rule, the clause, the notification, the
 * official URL, the severity — is copied from the check the engine produced. No
 * legal explanation is written here, because a legal explanation written here
 * would be one this system invented, and it would appear beside a real citation
 * where nobody could tell the difference.
 *
 * On severity (§19 of the brief): the corpus grades each *rule* CRITICAL, MAJOR
 * or MINOR, and that grading is carried through untouched. It describes the
 * requirement, not this package — how serious it is to sell goods with no
 * declared price.
 *
 * An issue is raised for every check that was not satisfied and for nothing
 * else. Nothing here ever prints "confirmed violation": the engine's verdict is
 * that a requirement was not satisfied on what was read; whether an offence
 * was committed is a decision for a person with a statutory power, and this
 * system does not have one.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const ISSUE_CLASSIFICATIONS = ['POTENTIAL_VIOLATION'] as const;
export type IssueClassification = (typeof ISSUE_CLASSIFICATIONS)[number];

export interface ComplianceIssue {
  issueId: string;
  ruleId: string;
  ruleVersion: string;
  field?: string;
  fieldLabel?: string;
  /** From the check's status. Not a judgement about the trader. */
  classification: IssueClassification;
  /** The rule's own grading, verbatim from the corpus. */
  severity: RuleSeverity;
  title: string;
  /** The engine's one-sentence reason, unedited. */
  description: string;
  /** What the provision requires, in the corpus's words. */
  expectedRequirement: string;
  observedValue: string | null;
  reasonCode: string;
  confidence: number | null;
  evidence: EvidenceReference[];
  /** Where the requirement comes from. Every value is the corpus's own. */
  source: {
    rule: string;
    clause?: string;
    notification: string;
    notificationDate: string;
    officialUrl?: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    verificationStatus: string;
  };
  /** Verbatim legal text of the version relied on. */
  legalText: string;
  /** This system's reading of it — explicitly not authoritative. */
  machineInterpretation: string;
}

const CLASSIFICATION_BY_STATUS: Partial<Record<ComplianceCheck['status'], IssueClassification>> = {
  VIOLATION_DETECTED: 'POTENTIAL_VIOLATION',
};

/**
 * Titles by reason code.
 *
 * These are descriptions of what the *system* observed, never of what the law
 * says. "Required declaration not detected" is a statement about this scan;
 * "the package is unlawful" would be a statement about the law, and the engine
 * is the only thing entitled to make one.
 */
const TITLE_BY_REASON: Record<string, string> = {
  /*
   * Short, and in the officer's words rather than the engine's.
   *
   * These were a sentence each — "Declaration not detected — evidence
   * insufficient to conclude" — printed as the *heading* of a finding, so a
   * report of six findings was six sentences where six headings should have
   * been, and an officer scanning for what was wrong had to read all of them.
   *
   * A heading says what happened; the description underneath, which is
   * unchanged, says the rest. The distinction each one still has to carry is
   * whether the package is at fault or the photograph is: "Not printed on the
   * package" is a finding against a trader, "Could not be read" is a statement
   * about the scan, and collapsing the two would be the worst thing this table
   * could do.
   */
  DECLARATION_ABSENT: 'Not printed on the package',
  DECLARATION_UNREADABLE: 'Could not be read',
  FORMAT_NOT_SATISFIED: 'Printed in the wrong form',
  VALUE_OUT_OF_RANGE: 'Value outside the permitted range',
  UNIT_NOT_PERMITTED: 'Not a standard unit',
  CROSS_FIELD_INCOMPLETE: 'Related declarations are incomplete',
};

/**
 * A stable issue id.
 *
 * Derived from the inspection, the rule version and the reason rather than
 * randomly generated, so re-running a scan on corrected evidence produces the
 * same id for the same finding — which is what lets a dashboard show that an
 * issue was resolved rather than that one vanished and another appeared.
 */
function issueIdFor(inspectionId: string | undefined, check: ComplianceCheck): string {
  const digest = createHash('sha256')
    .update([inspectionId ?? 'unsaved', check.ruleId, check.ruleVersion, check.reasonCode].join('|'))
    .digest('hex')
    .slice(0, 12);
  return `ISS-${digest}`;
}

export interface IssueSummary {
  total: number;
  potentialViolations: number;
  /** Counts by the corpus's own rule grading. */
  bySeverity: Record<RuleSeverity, number>;
}

/**
 * Builds the issue list from a completed evaluation.
 *
 * Checks that passed, that did not apply, and that were skipped by an exemption
 * produce no issue — they are reported in the summary and the full check list,
 * where a reader can see that they were considered.
 */
export function generateIssues(
  result: ComplianceResult,
  inspectionId?: string,
): { issues: ComplianceIssue[]; summary: IssueSummary } {
  const issues: ComplianceIssue[] = [];

  for (const check of result.checks) {
    const classification = CLASSIFICATION_BY_STATUS[check.status];
    if (!classification) continue;

    issues.push({
      issueId: issueIdFor(inspectionId ?? result.inspectionId, check),
      ruleId: check.ruleId,
      ruleVersion: check.ruleVersion,
      field: check.field,
      fieldLabel: check.fieldLabel,
      classification,
      severity: check.severity,
      title: TITLE_BY_REASON[check.reasonCode] ?? 'Requirement not satisfied',
      description: check.reason,
      expectedRequirement: check.expectedRequirement,
      observedValue: check.observedValue,
      reasonCode: check.reasonCode,
      confidence: check.confidence,
      evidence: check.evidence,
      source: {
        rule: check.provenance.sourceRule,
        clause: check.provenance.sourceClause,
        notification: check.provenance.source.notification,
        notificationDate: check.provenance.source.notificationDate,
        officialUrl: check.provenance.source.officialUrl,
        effectiveFrom: check.provenance.effectiveFrom,
        effectiveTo: check.provenance.effectiveTo,
        verificationStatus: check.provenance.source.verificationStatus,
      },
      legalText: check.legalText,
      machineInterpretation: check.machineInterpretation,
    });
  }

  /** Ordered by the corpus's own grading, then by rule. */
  const severityRank: Record<RuleSeverity, number> = { CRITICAL: 0, MAJOR: 1, MINOR: 2 };

  issues.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.ruleId.localeCompare(b.ruleId),
  );

  const bySeverity: Record<RuleSeverity, number> = { CRITICAL: 0, MAJOR: 0, MINOR: 0 };
  for (const issue of issues) bySeverity[issue.severity] += 1;

  return {
    issues,
    summary: {
      total: issues.length,
      potentialViolations: issues.length,
      bySeverity,
    },
  };
}
