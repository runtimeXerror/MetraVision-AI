/**
 * Official document locations.
 *
 * Every URL here was fetched during the build of this corpus and the text of
 * the notification read from the PDF it returned. They are the Department of
 * Consumer Affairs' own copies, linked from
 * https://consumeraffairs.gov.in/pages/legal-metrology-act
 *
 * The file names are the department's, timestamp suffixes and all. They look
 * disposable and are not: they are the only stable identifiers the site
 * publishes, and rewriting them into something tidier would break the link
 * between a rule and the document it came from.
 *
 * A notification with no entry here has no verified URL, and its records carry
 * `verificationStatus: 'PARTIALLY_VERIFIED'` or `'NEEDS_VERIFICATION'` rather
 * than an invented one.
 */

export const DCA_LEGAL_METROLOGY_PAGE = 'https://consumeraffairs.gov.in/pages/legal-metrology-act';

export const AUTHORITY = 'Department of Consumer Affairs, Ministry of Consumer Affairs, Food and Public Distribution';

const BASE = 'https://consumeraffairs.gov.in/public/upload/files';

export const SOURCE_URLS = {
  /** The Legal Metrology (Packaged Commodities) Rules, 2011 — G.S.R. 202(E). */
  'G.S.R. 202(E)': `${BASE}/8_1732871406.pdf`,
  'G.S.R. 318(E)': `${BASE}/8(i)_0_1732860957.pdf`,
  'G.S.R. 734(E)': `${BASE}/8(ii)_0_1732860982.pdf`,
  'G.S.R. 784(E)': `${BASE}/8(iii)_0_1732861046.pdf`,
  'G.S.R. 832(E)': `${BASE}/corrigendum_PCR_0_0_1732860695.pdf`,
  'G.S.R. 426(E)': `${BASE}/8(vi)_0_1732861153.pdf`,
  'G.S.R. 427(E)': `${BASE}/8(v)_0_1732861119.pdf`,
  'G.S.R. 359(E)': `${BASE}/8(vii)_0_1732861181.pdf`,
  'G.S.R. 137': `${BASE}/8(viii)_0%20(1)_1732870622.pdf`,
  'G.S.R. 870(E)': `${BASE}/8(ix)_0_1732870718.pdf`,
  'G.S.R. 385(E)': `${BASE}/8(x)_0_1732870750.pdf`,
  'G.S.R. 858(E)': `${BASE}/8(xi)_0_1732871315.pdf`,
  'G.S.R. 629(E)': `${BASE}/8(xii)_0_1732871346.pdf`,
  'G.S.R. 1373(E)': `${BASE}/8(xiii)_0_1732871373.pdf`,
  'G.S.R. 779(E)': `${BASE}/230946_1732871433.pdf`,
  'G.S.R. 226(E)': `${BASE}/GSR226_1732871458.pdf`,
  'G.S.R. 577(E)': `${BASE}/Notification%20-%20%20Legal%20Metrology%20(QR%20Code)_1732871487.pdf`,
  'G.S.R. 648(E)': `${BASE}/2022%203rd%20amendment%20in%20PCR%20Garments_1733228786.pdf`,
  'G.S.R. 747(E)': `${BASE}/PCR_1732871549.pdf`,
  'G.S.R. 859(E)': `${BASE}/eGazette_30_nov_22_1732871630_1746006280.pdf`,
  'G.S.R. 60(E)': `${BASE}/2023.01.27%20amendment%20in%20amendment%20of%202023%20PCR_1732871665.pdf`,
  'G.S.R. 214(E)': `${BASE}/PCR_Amendment_24March2023_1732871698.pdf`,
  'G.S.R. 412(E)': `${BASE}/2023.06.5%20amendment%20in%20amendment%20of%20PCR%20ext%20till%2030.6.2023_1732871791.pdf`,
  'G.S.R. 456(E)': `${BASE}/2023.6.23%20QR%20Code%20PCR%20amendment_1732871827.pdf`,
  'G.S.R. 463(E)': `${BASE}/2023.6.28%20amendment%20in%20amendment%20of%20PCR%20ext%20till%2031.8.2023_1733228263.pdf`,
  'G.S.R. 640(E)': `${BASE}/248432_1732871904.pdf`,
  'G.S.R. 714(E)': `${BASE}/Amendment%20of%20PCR%20ext%20till%2031.12.2023%20(1)_1732871950.pdf`,
  'G.S.R. 722(E)': `${BASE}/2023.10.6%20amendment%20in%20PCR_1732871982.pdf`,
  'G.S.R. 778(E)': `${BASE}/267107_1761404707.pdf`,
  'G.S.R. 881(E)': `${BASE}/2nd%20PCR%20Pan%20Masala_1764736734.pdf`,
  'G.S.R. 128(E)': `${BASE}/2026.02.13%20PCR%201st%20COO%20Filter%20on%20e-commerce%20websites_1771231030.pdf`,
  'G.S.R. 312(E)': `${BASE}/2026.4.27%20PCR%202nd%20COO%20from%201.7.2027_1777348487.pdf`,
  'G.S.R. 418(E)': `${BASE}/PCR_3rd_29May2026_1780376045.pdf`,
} as const satisfies Record<string, string>;

export type KnownNotification = keyof typeof SOURCE_URLS;

/** `undefined` for a notification with no verified official copy. */
export function sourceUrlFor(notification: string): string | undefined {
  return (SOURCE_URLS as Record<string, string | undefined>)[notification];
}
