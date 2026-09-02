/**
 * ── OFFICIAL ARTWORK ────────────────────────────────────────────────────────
 * The department's own logo files, as issued.
 *
 * Two files, because they are used in different places:
 *
 *   · `letterhead.png` — the full lockup: the State Emblem followed by
 *     "उपभोक्ता मामले विभाग / DEPARTMENT OF CONSUMER AFFAIRS". This is the
 *     department's identity as one piece, and it leads the report letterhead
 *     and the app masthead.
 *   · `emblem.png` — the Lion Capital on its own, with सत्यमेव जयते beneath.
 *     Used where the wide lockup will not fit, and as the seal on the report.
 *
 * They are held as `require`s rather than resolved at runtime because Metro
 * resolves requires at build time: a path that is wrong fails the bundle
 * immediately and loudly, which is the right moment to find out that a
 * department's seal is missing.
 *
 * To swap in updated artwork, replace the files in `mobile/assets/` — the
 * names are what the code binds to, so nothing here needs editing.
 *
 * Reproduction of the State Emblem is governed by the State Emblem of India
 * (Prohibition of Improper Use) Act, 2005. These are the department's own
 * files, used for the department's own application.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** The full lockup: emblem + department name. Roughly 3.4 : 1. */
export const LETTERHEAD_IMAGE: number | null = require('../../assets/letterhead.png');

/**
 * The Lion Capital alone, with the motto. Portrait, roughly 0.63 : 1.
 *
 * Note this file is a palette PNG with no alpha, where `letterhead.png` is
 * RGBA. It is only reached when the lockup is absent, and the masthead band it
 * would land on is tinted — so if the lockup is ever removed, re-export this
 * one with a transparent ground first, or it will render as a white rectangle
 * on the header.
 */
export const EMBLEM_IMAGE: number | null = require('../../assets/emblem.png');

/**
 * Aspect ratios of the two files, so every consumer sizes them by height and
 * lets the width follow. Hard-coding a width somewhere would squash whichever
 * file was replaced with one of a different shape.
 */
export const LETTERHEAD_ASPECT = 310 / 92;
export const EMBLEM_ASPECT = 354 / 564;

/** Whether official artwork is in place, so callers can pick their branch. */
export const hasOfficialArtwork = LETTERHEAD_IMAGE !== null || EMBLEM_IMAGE !== null;
