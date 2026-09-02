import type { SourceVerificationStatus } from './Rule';

/**
 * ── CONFLICTS ───────────────────────────────────────────────────────────────
 *
 * Two different things share this type, deliberately.
 *
 * `STRUCTURAL` conflicts are defects in *this system's* corpus — two versions
 * of a rule in force at once, a missing effective date, a superseded record
 * still marked active. `RuleSetValidator` computes them on demand, and any one
 * of them is a bug to be fixed before the corpus is trusted.
 *
 * `SOURCE` conflicts are disagreements between official documents themselves —
 * a notification whose own closing note cites a number that does not match the
 * notification it points at, a Gazette dated one day and published another.
 * Those are not bugs and cannot be fixed here. They are recorded, seeded
 * alongside the corpus, and surfaced for a human to resolve, because silently
 * picking one reading of the law and hiding the other is the one thing a
 * compliance system must never do.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const CONFLICT_ORIGINS = ['STRUCTURAL', 'SOURCE'] as const;
export type ConflictOrigin = (typeof CONFLICT_ORIGINS)[number];

export const CONFLICT_SEVERITIES = ['ERROR', 'WARNING', 'INFO'] as const;
export type ConflictSeverity = (typeof CONFLICT_SEVERITIES)[number];

export const CONFLICT_CODES = [
  /* Structural — defects in the corpus. */
  'OVERLAPPING_ACTIVE_VERSIONS',
  'MISSING_EFFECTIVE_FROM',
  'IMPOSSIBLE_DATE_RANGE',
  'FUTURE_RULE_MARKED_ACTIVE',
  'SUPERSEDED_RULE_STILL_ACTIVE',
  'DUPLICATE_RULE_VERSION',
  'DUPLICATE_NOTIFICATION',
  'MISSING_SOURCE_URL',
  'MISSING_NOTIFICATION_DATE',
  'DANGLING_SUPERSEDES',
  'DANGLING_SUPERSEDED_BY',
  'BROKEN_SUPERSESSION_CHAIN',
  'UNKNOWN_EXCEPTION_REFERENCE',
  'CONTRADICTORY_EXCEPTIONS',
  'EXCEPTION_OUTLIVES_RULE',
  'RULE_WITHOUT_AMENDMENT_RECORD',
  'AMENDMENT_CHAIN_BREAK',
  'UNVERIFIED_SUBSTANTIVE_RULE',
  'GAP_BETWEEN_VERSIONS',

  /* Source — disagreements between official documents. */
  'CITATION_MISMATCH',
  'NOTIFICATION_DATE_VS_PUBLICATION_DATE',
  'AMENDMENT_TARGET_AMBIGUOUS',
  'NOTIFICATION_NOT_FOUND',
] as const;
export type ConflictCode = (typeof CONFLICT_CODES)[number];

export interface RuleConflict {
  conflictId: string;
  origin: ConflictOrigin;
  code: ConflictCode;
  severity: ConflictSeverity;
  message: string;
  /** Rule versions, exception ids or notification numbers involved. */
  subjects: string[];
  /** For SOURCE conflicts: the documents that disagree, and how. */
  documents?: Array<{
    notification: string;
    url?: string;
    says: string;
  }>;
  /** What the corpus does in the meantime, and why that is safe. */
  interimResolution?: string;
  requiresManualVerification: boolean;
  verificationStatus?: SourceVerificationStatus;
}

export interface RuleSetValidationReport {
  ruleSetVersion: string;
  ruleSetChecksum: string;
  generatedAt: string;
  /** True only when no ERROR-severity structural conflict was found. */
  valid: boolean;
  counts: {
    rules: number;
    exceptions: number;
    amendments: number;
    errors: number;
    warnings: number;
    info: number;
  };
  conflicts: RuleConflict[];
}
