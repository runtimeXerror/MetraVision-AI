import type { RuleConflict } from '../types/RuleConflict';

import { sourceUrlFor } from './sources';

/**
 * ── RECORDED SOURCE CONFLICTS ───────────────────────────────────────────────
 *
 * Places where the official documents disagree with each other, or with the
 * brief this corpus was built from.
 *
 * None of these can be resolved by reading harder. They are recorded rather
 * than silently decided, because a compliance system that quietly picks one
 * reading of the law and discards the other is worse than one that admits it
 * does not know — the first produces confident findings nobody can audit.
 *
 * Where the engine has to do *something* in the meantime, `interimResolution`
 * says what it does and why that choice is the conservative one. In every case
 * below the interim choice either cannot affect a finding, or errs towards not
 * making one.
 *
 * These are seeded alongside the corpus and surfaced through
 * `GET /api/rule-validation/report`, next to the structural conflicts the
 * validator computes. A reader sees both, and can tell which is a defect in
 * this system and which is a defect in the record.
 * ────────────────────────────────────────────────────────────────────────────
 */

export const SOURCE_CONFLICTS: RuleConflict[] = [
  {
    conflictId: 'SRC-001',
    origin: 'SOURCE',
    code: 'NOTIFICATION_NOT_FOUND',
    severity: 'WARNING',
    message:
      'G.S.R. 496(E) of 5 June 2012 could not be found. The Packaged Commodities notification of that date on the department\'s own page is G.S.R. 426(E); G.S.R. 427(E) of the same date is the substantive 2012 amendment.',
    subjects: ['G.S.R. 496(E)', 'G.S.R. 426(E)', 'G.S.R. 427(E)'],
    documents: [
      {
        notification: 'G.S.R. 426(E)',
        url: sourceUrlFor('G.S.R. 426(E)'),
        says: 'Dated 5 June 2012. "The Legal Metrology (Packaged Commodities) (Second Amendment) Amendment Rules, 2012" — amends the Third Amendment Rules, 2011.',
      },
      {
        notification: 'G.S.R. 427(E)',
        url: sourceUrlFor('G.S.R. 427(E)'),
        says: 'Dated 5 June 2012. "The Legal Metrology (Packaged Commodities) Amendment Rules, 2012" — the substantive 2012 amendment.',
      },
    ],
    interimResolution:
      'No record is created for G.S.R. 496(E). The two notifications actually published on 5 June 2012 are both in the registry, verified against their Gazette PDFs, and the "last amended vide" chain closes without a gap — which it could not do if a third notification of that date were missing.',
    requiresManualVerification: true,
    verificationStatus: 'NEEDS_VERIFICATION',
  },
  {
    conflictId: 'SRC-002',
    origin: 'SOURCE',
    code: 'CITATION_MISMATCH',
    severity: 'INFO',
    message:
      'The Hindi text of G.S.R. 359(E) (2013) cites the last amendment as G.S.R. 426(E) of 5 June 2012, while the substantive amendment of that date is G.S.R. 427(E).',
    subjects: ['G.S.R. 359(E)', 'G.S.R. 426(E)', 'G.S.R. 427(E)'],
    documents: [
      {
        notification: 'G.S.R. 359(E)',
        url: sourceUrlFor('G.S.R. 359(E)'),
        says: 'Hindi closing note: principal rules last amended by notification G.S.R. 426(अ) dated 5 June 2012.',
      },
      {
        notification: 'G.S.R. 427(E)',
        url: sourceUrlFor('G.S.R. 427(E)'),
        says: 'Is itself the amendment to the principal rules dated 5 June 2012; G.S.R. 426(E) amends the 2011 Third Amendment Rules, not the principal rules.',
      },
    ],
    interimResolution:
      'Both notifications are recorded and both are dated 5 June 2012, so the chain is unbroken either way and no rule version depends on which is cited. The registry records the citation as printed.',
    requiresManualVerification: false,
    verificationStatus: 'VERIFIED',
  },
  {
    conflictId: 'SRC-003',
    origin: 'SOURCE',
    code: 'AMENDMENT_TARGET_AMBIGUOUS',
    severity: 'WARNING',
    message:
      'G.S.R. 226(E) states that it amends "rule 1, sub-rule (2)" of the principal rules by substituting "1st day of April, 2022" — but the principal rules commenced on 1 April 2011, and it is the 2021 Amendment Rules whose commencement was 1 April 2022.',
    subjects: ['G.S.R. 226(E)', 'G.S.R. 779(E)', 'G.S.R. 202(E)'],
    documents: [
      {
        notification: 'G.S.R. 226(E)',
        url: sourceUrlFor('G.S.R. 226(E)'),
        says: 'Clause 2: "In the Legal Metrology (Packaged Commodities) Rules, 2011 (hereinafter referred to as the said rules), in rule 1, in sub-rule (2), for the figures, letters and words “1st day of April, 2022”, the figures, letters and words “1st Day of October, 2022” shall be substituted."',
      },
      {
        notification: 'G.S.R. 202(E)',
        url: sourceUrlFor('G.S.R. 202(E)'),
        says: 'Rule 1(2) of the principal rules reads: "They shall come into force on the 1st day of April, 2011." There is no "1st day of April, 2022" in the principal rules to substitute.',
      },
      {
        notification: 'G.S.R. 747(E)',
        url: sourceUrlFor('G.S.R. 747(E)'),
        says: 'The next notification in the chain reads the same provision as belonging to "the Legal Metrology (Packaged Commodities) Amendment Rules, 2022", and every later deferral follows that reading.',
      },
    ],
    interimResolution:
      'Read as amending the commencement of the 2021 Amendment Rules, which is the only reading under which the substituted words exist, and the reading every subsequent notification adopts. The corpus records the 2021 provisions as taking effect on 1 January 2024 accordingly.',
    requiresManualVerification: true,
    verificationStatus: 'PARTIALLY_VERIFIED',
  },
  {
    conflictId: 'SRC-004',
    origin: 'SOURCE',
    code: 'NOTIFICATION_DATE_VS_PUBLICATION_DATE',
    severity: 'INFO',
    message:
      'G.S.R. 418(E) is dated 29 May 2026 and commences "on the date of their publication in the Official Gazette", but its e-Gazette identifier and digital signature both date publication to 1 June 2026.',
    subjects: ['G.S.R. 418(E)'],
    documents: [
      {
        notification: 'G.S.R. 418(E)',
        url: sourceUrlFor('G.S.R. 418(E)'),
        says: 'Header: "New Delhi, the 29th May, 2026". e-Gazette identifier: CG-DL-E-01062026-273053. Digital signature dated 2026.06.01 23:17:23 +05:30.',
      },
    ],
    interimResolution:
      'The later date, 1 June 2026, is used as the effective date. Choosing the later of the two can only ever narrow the window in which a package could be found in breach, so the conservative reading is the safe one. Both dates are stored on the amendment record.',
    requiresManualVerification: true,
    verificationStatus: 'PARTIALLY_VERIFIED',
  },
  {
    conflictId: 'SRC-005',
    origin: 'SOURCE',
    code: 'NOTIFICATION_DATE_VS_PUBLICATION_DATE',
    severity: 'INFO',
    message:
      'G.S.R. 778(E) is dated 23 October 2025 and the Gazette carrying it is dated 24 October 2025. The department\'s index page labels it "dated 24.10.2025". It commences on publication.',
    subjects: ['G.S.R. 778(E)'],
    documents: [
      {
        notification: 'G.S.R. 778(E)',
        url: sourceUrlFor('G.S.R. 778(E)'),
        says: 'Notification header: "New Delhi, the 23rd October, 2025." Gazette masthead: "NEW DELHI, FRIDAY, OCTOBER 24, 2025".',
      },
    ],
    interimResolution:
      'Notification date recorded as 23 October 2025 and publication date as 24 October 2025; the effective date is the publication date, as the commencement clause requires.',
    requiresManualVerification: false,
    verificationStatus: 'VERIFIED',
  },
  {
    conflictId: 'SRC-006',
    origin: 'SOURCE',
    code: 'CITATION_MISMATCH',
    severity: 'INFO',
    message:
      'G.S.R. 456(E) states that the principal rules were "last amended vide G.S.R. 412(E)", but G.S.R. 412(E) amends the 2022 Amendment Rules and never touches the principal rules. The last amendment to the principal rules before it was G.S.R. 648(E).',
    subjects: ['G.S.R. 456(E)', 'G.S.R. 412(E)', 'G.S.R. 648(E)'],
    documents: [
      {
        notification: 'G.S.R. 456(E)',
        url: sourceUrlFor('G.S.R. 456(E)'),
        says: 'Closing note: "…and was last amended vide notification number G.S.R. 412 (E), dated the 5th June, 2023."',
      },
      {
        notification: 'G.S.R. 412(E)',
        url: sourceUrlFor('G.S.R. 412(E)'),
        says: 'Clause 2: "In the Legal Metrology (Packaged Commodities) Amendment Rules, 2022, in rule 1, in sub-rule (2)…" — it amends the 2022 Amendment Rules only.',
      },
    ],
    interimResolution:
      'The citation is recorded as printed. Two threads of notifications run in parallel from 2022 — one amending the principal rules, one deferring the commencement of the 2022 Amendment Rules — and the department\'s closing notes do not consistently distinguish them. No rule version depends on the citation; the registry tracks the two threads separately through `amends` and `amendsNotification`.',
    requiresManualVerification: false,
    verificationStatus: 'VERIFIED',
  },
  {
    conflictId: 'SRC-007',
    origin: 'SOURCE',
    code: 'NOTIFICATION_NOT_FOUND',
    severity: 'WARNING',
    message:
      'G.S.R. 910(E) of 29 December 2022 is not published on the Department of Consumer Affairs page and no official copy could be retrieved. Its effect is established only indirectly.',
    subjects: ['G.S.R. 910(E)'],
    documents: [
      {
        notification: 'G.S.R. 60(E)',
        url: sourceUrlFor('G.S.R. 60(E)'),
        says: 'Closing note names "G.S.R. 910 (E), dated the 29th December, 2022" as the last amendment, and its clause 2 substitutes "1st day of February, 2023" — a date no other notification in the chain sets.',
      },
      {
        notification: 'G.S.R. 859(E)',
        url: sourceUrlFor('G.S.R. 859(E)'),
        says: 'Left the commencement at "1st Day of January, 2023", so something between 30 November 2022 and 27 January 2023 moved it to 1 February 2023.',
      },
    ],
    interimResolution:
      'Recorded as PARTIALLY_VERIFIED with the inference stated on the record. It is a commencement-date notification: no declaration requirement turns on it, and the end of the chain — 1 January 2024, set by G.S.R. 714(E) — is verified independently.',
    requiresManualVerification: true,
    verificationStatus: 'PARTIALLY_VERIFIED',
  },
  {
    conflictId: 'SRC-008',
    origin: 'SOURCE',
    code: 'CITATION_MISMATCH',
    severity: 'INFO',
    message:
      'G.S.R. 137 of 16 June 2014 is printed without the "(E)" suffix that every other notification in this series carries.',
    subjects: ['G.S.R. 137'],
    documents: [
      {
        notification: 'G.S.R. 137',
        url: sourceUrlFor('G.S.R. 137'),
        says: 'Both the Hindi and English texts read "G.S.R. 137" / "सा.का.नि. 137", and G.S.R. 870(E) of 4 December 2014 cites it back the same way.',
      },
    ],
    interimResolution: 'Recorded as printed, without an added suffix. Both the notification and the one citing it agree.',
    requiresManualVerification: false,
    verificationStatus: 'VERIFIED',
  },
];
