/**
 * ── DEPARTMENT IDENTITY ─────────────────────────────────────────────────────
 * The naming lines the app and its documents are issued under.
 *
 * **There is deliberately no drawn mark here.** An earlier revision carried a
 * vector rendition of the State Emblem and then of the Ashoka Chakra; both are
 * gone. The department's mark is the Lion Capital lockup issued by the
 * Ministry, and a hand-authored approximation of it is not a substitute — an
 * approximate State Emblem is not something a department should issue documents
 * under, and reproduction is governed by the State Emblem of India (Prohibition
 * of Improper Use) Act, 2005.
 *
 * So until the official artwork is installed (see `brandAssets.ts`) the
 * letterhead is typographic: the department's name, set properly, with no mark.
 * That is what a letterhead without its seal should look like — not a letterhead
 * wearing the wrong seal.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The department's identity, in both languages.
 *
 * The Hindi lines are not decoration: they are half of the official name of the
 * issuing department, and a letterhead that drops them is not the department's.
 */
export const LETTERHEAD = {
  governmentHi: 'भारत सरकार',
  governmentEn: 'Government of India',
  ministryHi: 'उपभोक्ता मामले, खाद्य और सार्वजनिक वितरण मंत्रालय',
  ministryEn: 'Ministry of Consumer Affairs, Food & Public Distribution',
  departmentHi: 'उपभोक्ता मामले विभाग',
  departmentEn: 'Department of Consumer Affairs',
  division: 'Legal Metrology Division',
} as const;
