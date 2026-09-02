import type { SourceVerificationStatus } from './Rule';

/**
 * ── THE AMENDMENT REGISTRY ──────────────────────────────────────────────────
 *
 * One record per Gazette notification, in the order the Gazette issued them.
 *
 * The registry is not what the engine evaluates — rule *versions* are. It is
 * the provenance ledger that says why those versions exist, and it is what
 * makes the corpus auditable: every version points at the notification that
 * produced it, and every notification records what it changed.
 *
 * Its second job is to catch omissions. Each notification carries a "the
 * principal rules were last amended vide …" note, so the registry forms a
 * linked list; `RuleSetValidator` walks it and reports any break. A missing
 * amendment is otherwise invisible — the corpus would simply be quietly wrong.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const AMENDMENT_CHANGE_TYPES = [
  /** Changes what a package must actually declare or how. */
  'SUBSTANTIVE',
  /** Only moves the date another instrument comes into force. */
  'COMMENCEMENT_DATE',
  /** Corrects the printed text of an earlier notification. */
  'CORRIGENDUM',
  /** Creates, narrows or removes an exemption. */
  'EXEMPTION',
  /** Changes a defined term. */
  'DEFINITION',
  /** Registration, inspection, compounding and the like. */
  'PROCEDURAL',
  /** Hands a requirement off to another regulation. */
  'CROSS_REGULATION',
  'OTHER',
] as const;
export type AmendmentChangeType = (typeof AMENDMENT_CHANGE_TYPES)[number];

export interface AmendmentAffectedProvision {
  /** `Rule 6`. */
  rule: string;
  /** `6(1)(e)`, where the notification names one. */
  provision?: string;
  /** What the notification did to it. */
  operation: 'INSERTED' | 'SUBSTITUTED' | 'OMITTED' | 'RENUMBERED' | 'AMENDED';
  /** One line, drawn from the notification's own words. */
  effect: string;
  /**
   * Set where a single notification gives different provisions different
   * commencement dates — G.S.R. 722(E) is the clear case, with most of it in
   * force from 1 January 2024 but the rule 6(1)(d) provisos from 1 April 2024.
   */
  effectiveFromOverride?: string;
}

export interface Amendment {
  /** e.g. `G.S.R. 226(E)`. Unique. */
  notificationNumber: string;
  /** ISO date the notification itself is dated. */
  notificationDate: string;
  /** ISO date the Gazette carrying it was published, where it is known to differ. */
  publicationDate?: string;

  title: string;
  /**
   * The instrument this notification amends. Usually the principal rules, but
   * the 2022–23 commencement notifications amend the *2022 Amendment Rules*,
   * which is why they never change a declaration requirement.
   */
  amends: 'PRINCIPAL_RULES' | 'AMENDMENT_RULES';
  /** When `amends` is AMENDMENT_RULES, the notification being amended. */
  amendsNotification?: string;

  /**
   * When the amendment comes into force. `null` where the notification defers
   * it to another instrument and no date is fixed.
   */
  effectiveFrom: string | null;
  /** Verbatim from the notification, e.g. "on the date of their publication". */
  commencementText: string;

  affectedRules: string[];
  affectedProvisions: AmendmentAffectedProvision[];
  changeType: AmendmentChangeType;
  summary: string;

  officialSourceUrl?: string;
  verified: boolean;
  verificationStatus: SourceVerificationStatus;
  verificationNote?: string;

  /**
   * What this notification's own closing note says the principal rules were
   * last amended by. Used to walk the chain and detect a missing record.
   */
  citesPreviousNotification?: string;
  /** Corrigenda issued against this notification. */
  correctedBy?: string[];
}
