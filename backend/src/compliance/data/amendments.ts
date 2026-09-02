import type { Amendment } from '../types/Amendment';

import { sourceUrlFor } from './sources';

/**
 * ── VERIFIED AMENDMENT REGISTRY ─────────────────────────────────────────────
 *
 * The Legal Metrology (Packaged Commodities) Rules, 2011 and every notification
 * amending them, from G.S.R. 202(E) of 7 March 2011 to G.S.R. 418(E) of
 * 29 May 2026.
 *
 * HOW THIS WAS BUILT. Not from memory and not from summaries. The Department of
 * Consumer Affairs' Legal Metrology page was fetched, every Packaged
 * Commodities PDF it links was downloaded, and each notification's operative
 * text was read out of the Gazette itself — from the text layer where the PDF
 * had one, and from the page images where it did not, which is most of
 * 2011–2015.
 *
 * WHY THE CHAIN MATTERS. Every notification closes with a note naming the one
 * before it ("…and was last amended vide number G.S.R. 881(E), dated 2nd
 * December, 2025"). Those notes make the registry a linked list, and a linked
 * list can be checked: `RuleSetValidator` walks `citesPreviousNotification`
 * and reports any break. That is the only defence against the failure mode
 * that matters here — an amendment nobody knew about, leaving the corpus
 * quietly stating law that has been superseded for years.
 *
 * The chain is complete and closes on itself for all 33 records below, with one
 * exception recorded honestly: G.S.R. 910(E) of 29 December 2022, which the
 * department's page does not carry. See its entry.
 *
 * WHAT IS NOT HERE. Advisories, guidelines and standard operating procedures
 * published alongside the rules. They are departmental guidance, not amending
 * instruments, and admitting them would blur the line between what the rules
 * require and what the department recommends.
 * ────────────────────────────────────────────────────────────────────────────
 */

function url(notification: string): string | undefined {
  return sourceUrlFor(notification);
}

export const AMENDMENTS: Amendment[] = [
  /* ── The principal rules ──────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 202(E)',
    notificationDate: '2011-03-07',
    publicationDate: '2011-03-09',
    title: 'The Legal Metrology (Packaged Commodities) Rules, 2011',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2011-04-01',
    commencementText: 'They shall come into force on the 1st day of April, 2011.',
    affectedRules: ['Rule 1', 'Rule 2', 'Rule 3', 'Rule 4', 'Rule 5', 'Rule 6', 'Rule 7', 'Rule 26', 'Rule 27'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(1)',
        operation: 'INSERTED',
        effect:
          'Establishes the mandatory declarations every retail package must bear: manufacturer/packer/importer, common or generic name, net quantity, month and year of manufacture, retail sale price, dimensions where relevant.',
      },
      {
        rule: 'Rule 26',
        operation: 'INSERTED',
        effect: 'Establishes the exemptions from the rules for small, fast-food, drug-formulation and bulk farm-produce packages.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'The principal rules. Made under section 52 of the Legal Metrology Act, 2009; published in the Gazette of India on 9 March 2011 and in force from 1 April 2011.',
    officialSourceUrl: url('G.S.R. 202(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
  },

  /* ── 2011 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 318(E)',
    notificationDate: '2011-04-13',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2011',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2011-04-13',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(6)',
        operation: 'INSERTED',
        effect:
          'Transitional relief: packaging material or wrappers that could not be exhausted may be used until 30 September 2011 or until the stock is exhausted, whichever is earlier, after correcting the declarations by stamping, sticker or online printing.',
      },
    ],
    changeType: 'PROCEDURAL',
    summary: 'Inserted a transitional provision for pre-existing packaging stock as the 2011 rules came into force.',
    officialSourceUrl: url('G.S.R. 318(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 202(E)',
  },
  {
    notificationNumber: 'G.S.R. 734(E)',
    notificationDate: '2011-09-30',
    title: 'The Legal Metrology (Packaged Commodities) Second Amendment Rules, 2011',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2011-09-30',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(6)',
        operation: 'SUBSTITUTED',
        effect: 'Extended the packaging-stock transitional period from "upto 30th September, 2011" to "upto 31st March, 2012".',
      },
    ],
    changeType: 'PROCEDURAL',
    summary: 'Extended the transitional period for exhausting old packaging material by six months.',
    officialSourceUrl: url('G.S.R. 734(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 318(E)',
  },
  {
    notificationNumber: 'G.S.R. 784(E)',
    notificationDate: '2011-10-24',
    title: 'The Legal Metrology (Packaged Commodities) Third Amendment Rules, 2011',
    amends: 'PRINCIPAL_RULES',
    // Set by the notification itself and left alone by G.S.R. 426(E), which
    // only carved the rule-5 proviso out to a later date. See that record.
    effectiveFrom: '2012-07-01',
    commencementText: 'They shall come into force with effect from 1st July, 2012.',
    affectedRules: ['Rule 5', 'Rule 6', 'Rule 12', 'Rule 19', 'Rule 26', 'Fourth Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 5',
        operation: 'OMITTED',
        effect: 'The proviso to rule 5 (the "not a standard pack size" declaration) omitted.',
        // G.S.R. 426(E) moved this one item, and only this one, to 1 November 2012.
        effectiveFromOverride: '2012-11-01',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(d)',
        operation: 'OMITTED',
        effect: 'The third proviso to rule 6(1)(d) omitted.',
      },
      {
        rule: 'Rule 12',
        provision: '12(6)',
        operation: 'SUBSTITUTED',
        effect: 'Quantity declarations may not carry any word or expression tending to create an exaggerated, misleading or inadequate impression of quantity.',
      },
      {
        rule: 'Rule 19',
        provision: '19(7)',
        operation: 'SUBSTITUTED',
        effect: 'Mandatory declarations to be ensured at the factory level and at the depot of the factory.',
      },
      {
        rule: 'Rule 19',
        provision: '19(8)',
        operation: 'SUBSTITUTED',
        effect: 'On non-compliance, action may be taken after seizing five representative samples; the rest of the packages released after compliance.',
      },
      {
        rule: 'Rule 26',
        provision: '26(a)',
        operation: 'OMITTED',
        effect: 'The proviso to rule 26(a) (requiring MRP and net quantity on 10g–20g / 10ml–20ml packages) omitted.',
      },
      {
        rule: 'Fourth Schedule',
        operation: 'SUBSTITUTED',
        effect: 'Serial number 15, column 3: "volume" substituted by "weight".',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Removed the small-package MRP proviso from rule 26(a), tightened the quantity-declaration wording in rule 12(6), and reworked the rule 19 inspection provisions.',
    officialSourceUrl: url('G.S.R. 784(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 734(E)',
    correctedBy: ['G.S.R. 832(E)'],
  },
  {
    notificationNumber: 'G.S.R. 832(E)',
    notificationDate: '2011-11-23',
    title: 'Corrigendum to the Legal Metrology (Packaged Commodities) Third Amendment Rules, 2011',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 784(E)',
    effectiveFrom: '2011-11-23',
    commencementText: 'Corrigendum — corrects the English text of G.S.R. 784(E) as published.',
    affectedRules: ['Rule 6', 'Rule 19'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(1)(d)',
        operation: 'AMENDED',
        effect: 'In G.S.R. 784(E) at page 2, rule 2, clause (b): for "sub-rule (1)" read "sub-rule (1) of rule 6" — fixing which sub-rule the omitted third proviso belonged to.',
      },
      {
        rule: 'Rule 19',
        provision: '19(7)',
        operation: 'AMENDED',
        effect: 'In G.S.R. 784(E) at page 2, rule 2, clause (d): for "ensured either" read "ensured".',
      },
    ],
    changeType: 'CORRIGENDUM',
    summary:
      'Corrects two printing errors in the English text of the Third Amendment Rules, 2011. The first matters: without it, the omitted third proviso has no identified parent sub-rule.',
    officialSourceUrl: url('G.S.R. 832(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 784(E)',
  },

  /* ── 2012 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 426(E)',
    notificationDate: '2012-06-05',
    title: 'The Legal Metrology (Packaged Commodities) (Second Amendment) Amendment Rules, 2012',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 784(E)',
    effectiveFrom: '2012-06-05',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 5'],
    affectedProvisions: [
      {
        rule: 'Rule 5',
        operation: 'AMENDED',
        effect:
          'Amends the Third Amendment Rules, 2011: rule 1(2) restated as "Save as otherwise provided, these rules shall come into force from 1st July, 2012", and rule 2(a) restated so that the omission of the proviso to rule 5 takes effect from 1st November, 2012.',
        effectiveFromOverride: '2012-11-01',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary:
      'Deferred one item of the Third Amendment Rules, 2011 — the omission of the proviso to rule 5 — from 1 July 2012 to 1 November 2012, leaving the rest of that amendment unmoved.',
    officialSourceUrl: url('G.S.R. 426(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 784(E)',
  },
  {
    notificationNumber: 'G.S.R. 427(E)',
    notificationDate: '2012-06-05',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2012',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2012-06-05',
    commencementText: 'Save as otherwise provided, these rules shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 5', 'Rule 6', 'Rule 33', 'Second Schedule', 'Fourth Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 5',
        provision: '5(2)',
        operation: 'INSERTED',
        effect:
          'Rule 5 renumbered as 5(1); new 5(2) — where packages intended for retail sale are grouped together and sold as a retail package on promotional offer, every package of the group must comply with rule 6.',
      },
      {
        rule: 'Rule 5',
        provision: '5(3)',
        operation: 'INSERTED',
        effect: 'New 5(3) — notwithstanding the Second Schedule, value-based packages of Rs.1 to Rs.10 may be sold after making the other rule 6 declarations.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)',
        operation: 'SUBSTITUTED',
        effect: 'References to the Prevention of Food Adulteration Act, 1954 replaced by the Food Safety and Standards Act, 2006.',
      },
      {
        rule: 'Rule 6',
        provision: '6(7)',
        operation: 'INSERTED',
        effect: 'Packages containing genetically modified food must bear the words "GM" at the top of the principal display panel.',
        effectiveFromOverride: '2013-01-01',
      },
      {
        rule: 'Rule 33',
        provision: '33(2)',
        operation: 'INSERTED',
        effect: 'Rule 33 renumbered as 33(1); new 33(2) allows the Central Government to permit non-standard pack sizes for up to one year.',
      },
      {
        rule: 'Second Schedule',
        operation: 'SUBSTITUTED',
        effect: 'The Second Schedule (commodities to be packed in specified quantities) substituted in full.',
      },
      {
        rule: 'Fourth Schedule',
        operation: 'SUBSTITUTED',
        effect: 'Serial number 15, column 3: entry substituted by "weight or measure".',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Introduced the promotional-group-package rule, value-based packages, the "GM" declaration for genetically modified food, and a substituted Second Schedule.',
    officialSourceUrl: url('G.S.R. 427(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 784(E)',
  },

  /* ── 2013 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 359(E)',
    notificationDate: '2013-06-06',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2013',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2013-06-06',
    commencementText: 'Save as otherwise provided in these rules, they shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 2', 'Rule 3', 'Rule 18', 'Rule 32', 'Second Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(bb), 2(bc)',
        operation: 'INSERTED',
        effect: 'Defines "industrial consumer" and "institutional consumer" in the definitions rule itself.',
      },
      {
        rule: 'Rule 2',
        provision: '2(k)',
        operation: 'OMITTED',
        effect: 'The proviso to clause (k) omitted.',
      },
      {
        rule: 'Rule 3',
        operation: 'OMITTED',
        effect: 'The Explanation to rule 3 omitted — the two consumer definitions it carried having moved into rule 2.',
      },
      {
        rule: 'Rule 18',
        provision: '18(8)',
        operation: 'INSERTED',
        effect: 'LPG marketing companies, packers and distributors must maintain a class-III check weigher and let the delivery man weigh the cylinder.',
        effectiveFromOverride: '2013-07-01',
      },
      {
        rule: 'Rule 32',
        provision: '32(3)',
        operation: 'INSERTED',
        effect: 'Introduces the compounding table for offences under sections 29 and 36 and for selling above the maximum retail price.',
      },
      {
        rule: 'Second Schedule',
        operation: 'AMENDED',
        effect: 'Additional standard pack quantities inserted against several commodities.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary: 'Moved the industrial/institutional consumer definitions into rule 2, added the LPG check-weigher obligation, and introduced compounding amounts.',
    officialSourceUrl: url('G.S.R. 359(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    // The Hindi note in this notification cites G.S.R. 426(E) of 5 June 2012 as
    // the last amendment; the English chain runs through G.S.R. 427(E) of the
    // same date. Recorded as a source conflict — see data/conflicts.ts.
    citesPreviousNotification: 'G.S.R. 426(E)',
  },

  /* ── 2014 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 137',
    notificationDate: '2014-06-16',
    publicationDate: '2014-06-21',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2014',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2014-07-01',
    commencementText: 'They shall come into force with effect from 1st July, 2014.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(8)',
        operation: 'INSERTED',
        effect:
          'Packages of soap, shampoo, tooth paste and other cosmetics and toiletries must bear at the top of the principal display panel a red or brown dot for non-vegetarian origin and a green dot for vegetarian origin.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary: 'Introduced the vegetarian/non-vegetarian origin dot on cosmetics and toiletries.',
    officialSourceUrl: url('G.S.R. 137'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 359(E)',
    // The Gazette prints this one as "G.S.R. 137", without the "(E)" suffix
    // every other notification in this series carries. Left as printed.
  },
  {
    notificationNumber: 'G.S.R. 870(E)',
    notificationDate: '2014-12-04',
    title: 'The Legal Metrology (Packaged Commodities) (Second Amendment) Rules, 2014',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2014-12-04',
    commencementText: 'They shall come into force from the date of their publication in Official Gazette.',
    affectedRules: ['Rule 26'],
    affectedProvisions: [
      {
        rule: 'Rule 26',
        provision: '26(e)',
        operation: 'INSERTED',
        effect: 'New exemption: "any thread which is sold in coil to handloom weavers".',
      },
    ],
    changeType: 'EXEMPTION',
    summary: 'Exempted thread sold in coil to handloom weavers from the rules.',
    officialSourceUrl: url('G.S.R. 870(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 137',
  },

  /* ── 2015 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 385(E)',
    notificationDate: '2015-05-14',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2015',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2015-05-14',
    commencementText: 'Save as otherwise provided in these rules, they shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 2', 'Rule 6', 'Rule 7', 'Rule 9', 'Rule 10', 'Rule 12', 'Rule 13', 'Rule 26', 'Rule 32', 'Rule 33', 'Second Schedule', 'Third Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(bb), 2(bc)',
        operation: 'SUBSTITUTED',
        effect: 'Industrial and institutional consumer definitions substituted; both now require a "not for retail sale" declaration on the package.',
      },
      {
        rule: 'Rule 2',
        provision: '2(k)',
        operation: 'INSERTED',
        effect: 'Proviso: for "retail food package", the definition in the Food Safety and Standards Act, 2006 rules or regulations applies.',
      },
      {
        rule: 'Rule 6',
        provision: '6(2)',
        operation: 'SUBSTITUTED',
        effect: 'Consumer-care declaration restated: name, address, telephone number and e-mail address of the person or office to be contacted on consumer complaints.',
        effectiveFromOverride: '2016-01-01',
      },
      {
        rule: 'Rule 6',
        provision: '6(9)',
        operation: 'INSERTED',
        effect: 'It is permissible to affix a label on imported packages to make the declarations required under the rules.',
      },
      {
        rule: 'Rule 7',
        provision: '7(1)',
        operation: 'SUBSTITUTED',
        effect: 'The small-package threshold raised from "five cubic centimeters or less" to "ten cubic centimeters or less".',
      },
      {
        rule: 'Rule 7',
        provision: '7(5)',
        operation: 'INSERTED',
        effect: 'Method for determining the principal display panel area for rectangular, cylindrical and other package shapes.',
        effectiveFromOverride: '2016-01-01',
      },
      {
        rule: 'Rule 9',
        provision: '9(3)',
        operation: 'OMITTED',
        effect: 'The proviso to rule 9(3) omitted.',
      },
      {
        rule: 'Rule 10',
        provision: '10(1)',
        operation: 'SUBSTITUTED',
        effect: 'In the Explanation, "at which the factory is situated" substituted by "at which the company or firm is registered".',
        effectiveFromOverride: '2016-01-01',
      },
      {
        rule: 'Rule 13',
        provision: '13(5), 13(6)',
        operation: 'INSERTED',
        effect: 'Explanation permitting "L" for litre; new 13(6) requiring supplementary quantity declaration where a prepackage contains several packages of the same commodity.',
      },
      {
        rule: 'Rule 26',
        provision: '26(a)',
        operation: 'INSERTED',
        effect: 'Proviso: the rule 26(a) small-package exemption is not available for tobacco and tobacco products.',
        effectiveFromOverride: '2016-01-01',
      },
      {
        rule: 'Rule 32',
        operation: 'AMENDED',
        effect: 'Compounding provisions amended.',
      },
      {
        rule: 'Rule 33',
        provision: '33(1)',
        operation: 'OMITTED',
        effect: 'The words "of the compounding of a case or a Court decision stated in the application" omitted.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'A broad amendment: restated the consumer-care declaration, raised the small-package threshold to ten cubic centimetres, fixed the method for measuring the principal display panel, and — significantly for the exemption engine — withdrew the rule 26(a) small-package exemption from tobacco products.',
    officialSourceUrl: url('G.S.R. 385(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 870(E)',
  },

  /* ── 2016 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 858(E)',
    notificationDate: '2016-09-07',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2016',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2016-09-07',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 5', 'Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 5',
        provision: '5(1)',
        operation: 'INSERTED',
        effect:
          'Proviso: where the Competent Authority under the Essential Commodities Act, 1955 has fixed and notified a standard quantity for an essential commodity, that quantity prevails over the Second Schedule.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(e)',
        operation: 'INSERTED',
        effect:
          'Further proviso: where the retail sale price of an essential commodity is fixed and notified by the Competent Authority under the Essential Commodities Act, 1955, that price applies.',
      },
    ],
    changeType: 'CROSS_REGULATION',
    summary: 'Subordinated the standard-quantity and retail-price rules to prices and quantities notified under the Essential Commodities Act, 1955.',
    officialSourceUrl: url('G.S.R. 858(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 385(E)',
  },

  /* ── 2017 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 629(E)',
    notificationDate: '2017-06-23',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2017',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2018-01-01',
    commencementText: 'They shall come into force on the 1st day of January, 2018.',
    affectedRules: [
      'Rule 2', 'Rule 3', 'Rule 6', 'Rule 7', 'Rule 9', 'Rule 10', 'Rule 18', 'Rule 19', 'Rule 20', 'Rule 26', 'Rule 32',
      'Second Schedule', 'Fifth Schedule', 'Sixth Schedule', 'Seventh Schedule',
    ],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(aa), 2(bd), 2(be), 2(bf)',
        operation: 'INSERTED',
        effect: 'Defines "consumer", "E-commerce", "E-commerce entity" and "marketplace based model of e-commerce".',
      },
      {
        rule: 'Rule 2',
        provision: '2(m)',
        operation: 'SUBSTITUTED',
        effect: '"retail sale price" restated as the maximum price at which the commodity may be sold to the consumer, inclusive of all taxes.',
      },
      {
        rule: 'Rule 3',
        operation: 'SUBSTITUTED',
        effect:
          'Chapter II disapplied to packages over 25 kg or 25 litre; to cement, fertilizer and agricultural farm produce sold in bags above 50 kg; and to packaged commodities meant for industrial or institutional consumers.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(aa)',
        operation: 'INSERTED',
        effect: 'The name of the country of origin or manufacture or assembly must be mentioned on imported packages.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(da)',
        operation: 'INSERTED',
        effect: 'Where a commodity may become unfit for human consumption after a period, the best-before or use-by date, month and year must be declared.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(e)',
        operation: 'AMENDED',
        effect: 'The retail sale price must clearly indicate that it is the maximum retail price inclusive of all taxes, rounded to the nearest rupee or 50 paise.',
      },
      {
        rule: 'Rule 6',
        provision: '6(4A)',
        operation: 'INSERTED',
        effect: 'Permits — does not require — a barcode, GTIN, QR code, e-code and authorised government-scheme logos in addition to the mandatory declarations.',
      },
      {
        rule: 'Rule 6',
        provision: '6(10)',
        operation: 'INSERTED',
        effect:
          'An e-commerce entity must display the rule 6(1) mandatory declarations, except the month and year of manufacture or packing, on the digital and electronic network used for the transaction; with a safe harbour for a genuine marketplace intermediary.',
      },
      {
        rule: 'Rule 7',
        provision: '7(2), 7(3), Table-I',
        operation: 'SUBSTITUTED',
        effect: 'Height of numerals and letters to be as per a substituted Table-I; width not less than one third of the height, except numeral "1" and the letters i, I and l. Table II omitted.',
      },
      {
        rule: 'Rule 10',
        provision: '10(1)',
        operation: 'SUBSTITUTED',
        effect: '"5 cubic cm or less" substituted by "10 cubic cm or less"; "complete address" defined to include the PIN code.',
      },
      {
        rule: 'Rule 18',
        provision: '18(1A), 18(2A)',
        operation: 'INSERTED',
        effect:
          'Wholesale dealers may sell directly to industrial and institutional consumers; and no manufacturer, packer or importer may declare different maximum retail prices on an identical pre-packaged commodity by adopting restrictive or unfair trade practices.',
      },
      {
        rule: 'Rule 26',
        provision: '26(c)',
        operation: 'SUBSTITUTED',
        effect:
          'The drug-formulation exemption restated against the Drugs (Price Control) Order, 2013, with a proviso that no exemption applies to medical devices declared as drugs.',
      },
      {
        rule: 'Rule 26',
        provision: '26(d)',
        operation: 'OMITTED',
        effect: 'The exemption for agricultural farm produce in packages above 50 kg omitted from rule 26 (the exclusion having moved into rule 3).',
      },
      {
        rule: 'Rule 32',
        operation: 'SUBSTITUTED',
        effect: 'Fine of five thousand rupees for contraventions with no specified punishment; new rule 32A sets out compounding amounts.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'The e-commerce amendment. Introduced the country-of-origin declaration for imported products, the best-before declaration, the e-commerce display obligation in rule 6(10), a new Table-I for letter heights, and the medical-devices-declared-as-drugs carve-out in rule 26(c).',
    officialSourceUrl: url('G.S.R. 629(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 858(E)',
    correctedBy: ['G.S.R. 1373(E)'],
  },
  {
    notificationNumber: 'G.S.R. 1373(E)',
    notificationDate: '2017-11-07',
    title: 'Corrigendum to the Legal Metrology (Packaged Commodities) Amendment Rules, 2017',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 629(E)',
    effectiveFrom: '2017-11-07',
    commencementText: 'Corrigendum — corrects the text of G.S.R. 629(E) as published.',
    affectedRules: ['Rule 7', 'Rule 18'],
    affectedProvisions: [
      {
        rule: 'Rule 7',
        provision: 'Table-I',
        operation: 'AMENDED',
        effect: 'At page 11, line 33, in Table-I, column (3): for "1.5" read "2.0" — a minimum letter height in millimetres.',
      },
      {
        rule: 'Rule 18',
        provision: '18(2A)',
        operation: 'AMENDED',
        effect: 'At page 12: for "(i)" read "(ii)", and for "clause (c)" read "clause (nnn) and clause (r), respectively," in the Consumer Protection Act reference.',
      },
    ],
    changeType: 'CORRIGENDUM',
    summary:
      'Corrects a minimum letter height in Table-I from 1.5 mm to 2.0 mm, and a mis-numbered clause in rule 18. The first is substantive in effect: a typography check built on the uncorrected table would apply a threshold that was never the law.',
    officialSourceUrl: url('G.S.R. 1373(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 629(E)',
  },

  /* ── 2021 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 779(E)',
    notificationDate: '2021-11-02',
    publicationDate: '2021-11-03',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2021',
    amends: 'PRINCIPAL_RULES',
    // As notified. G.S.R. 226(E) and the nine commencement notifications after
    // it moved this repeatedly; the effective date the engine uses for the
    // provisions this created is 2024-01-01. See the rule versions.
    effectiveFrom: '2022-04-01',
    commencementText: 'They shall come into force on the 1st day of April, 2022.',
    affectedRules: ['Rule 2', 'Rule 4', 'Rule 5', 'Rule 6', 'Rule 13', 'Rule 18'],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(aa)',
        operation: 'SUBSTITUTED',
        effect: 'The "consumer" definition re-pointed from the Consumer Protection Act, 1986 to clause (7) of section 2 of the Consumer Protection Act, 2019.',
      },
      {
        rule: 'Rule 4',
        provision: '4(2)',
        operation: 'INSERTED',
        effect:
          'Rule 4 renumbered as 4(1); new 4(2) — where packages intended for retail sale are grouped together and sold as a retail package on promotional offer, every package of the group must comply with rule 6. (Carried over from rule 5(2), which this notification omitted.)',
      },
      {
        rule: 'Rule 5',
        operation: 'OMITTED',
        effect: 'Rule 5 (specific commodities to be packed in recommended standard packages) omitted in full.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(d)',
        operation: 'AMENDED',
        effect: 'The words "or pre-packed or imported" omitted from the month-and-year declaration.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(e)',
        operation: 'SUBSTITUTED',
        effect: 'The retail-sale-price wording from "and the price in rupees and paisa" to the illustrations replaced by the words "in Indian currency:".',
      },
      {
        rule: 'Rule 6',
        provision: '6(11)',
        operation: 'INSERTED',
        effect: 'Unit sale price to be declared as Rs. per g / kg / cm / metre / number / ml / litre according to the net quantity of the commodity.',
      },
      {
        rule: 'Rule 13',
        provision: '13(5)(ii)',
        operation: 'SUBSTITUTED',
        effect: 'For items sold by number, the number or unit or piece or pair or set or such other word representing the quantity must be mentioned.',
      },
      {
        rule: 'Rule 18',
        provision: '18(2A), 18(7)',
        operation: 'SUBSTITUTED',
        effect: 'Consumer Protection Act, 1986 references re-pointed to the 2019 Act; "Value Added Tax (VAT) or Turn Over Tax (TOT)" replaced by "Goods and Service Tax".',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Omitted rule 5 entirely, moved the promotional-group-package obligation into rule 4(2), introduced the unit sale price in rule 6(11), and modernised the statutory cross-references.',
    officialSourceUrl: url('G.S.R. 779(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 629(E)',
  },

  /* ── 2022 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 226(E)',
    notificationDate: '2022-03-28',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2022',
    amends: 'PRINCIPAL_RULES',
    // Its own rule 1(2) said 1 October 2022. Nine later notifications moved it;
    // the final date, set by G.S.R. 714(E), is 1 January 2024.
    effectiveFrom: '2024-01-01',
    commencementText:
      'They shall come into force on the 1st day of October, 2022 — subsequently substituted, through G.S.R. 747(E), 859(E), 910(E), 60(E), 214(E), 412(E), 463(E), 640(E) and 714(E), to the 1st day of January, 2024.',
    affectedRules: ['Rule 1', 'Rule 6', 'Rule 33', 'Second Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'Commencement date "1st day of April, 2022" substituted by "1st Day of October, 2022".',
      },
      {
        rule: 'Rule 6',
        provision: '6(11)',
        operation: 'SUBSTITUTED',
        effect:
          'Unit sale price restated: rounded to the nearest two decimal places, per gram/kilogram, centimetre/metre, millilitre/litre or number; State excise laws prevail for alcoholic beverages; no unit sale price where the retail sale price equals it.',
      },
      {
        rule: 'Rule 33',
        provision: '33(2)',
        operation: 'OMITTED',
        effect: 'Rule 33(2) — the one-year relaxation for non-standard pack sizes — omitted.',
      },
      {
        rule: 'Second Schedule',
        operation: 'OMITTED',
        effect: 'The Second Schedule omitted in full, ending prescribed standard pack sizes.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Ended prescribed standard pack sizes by omitting the Second Schedule, and restated the unit sale price rule. Its commencement was deferred nine times before taking effect on 1 January 2024.',
    officialSourceUrl: url('G.S.R. 226(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 779(E)',
    // Its clause 2 says it amends "rule 1, sub-rule (2)" of the *principal
    // rules*, whose commencement was 1 April 2011, not 1 April 2022. It plainly
    // means the 2021 Amendment Rules. Recorded as a source conflict.
  },
  {
    notificationNumber: 'G.S.R. 577(E)',
    notificationDate: '2022-07-14',
    title: 'The Legal Metrology (Packaged Commodities) (Second Amendment) Rules, 2022',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2022-07-14',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(1)(a), 6(1)(b), 6(1)(f), 6(2)',
        operation: 'INSERTED',
        effect:
          'For electronic products manufactured, packed or imported after 15 July 2022, and for one year from that date, certain declarations may be carried through a QR code provided the package itself names the manufacturer and tells the consumer to scan.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Introduced the electronic-product QR-code option, time-limited to one year from 15 July 2022. G.S.R. 456(E) of 23 June 2023 later removed the time limit.',
    officialSourceUrl: url('G.S.R. 577(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 226(E)',
  },
  {
    notificationNumber: 'G.S.R. 648(E)',
    notificationDate: '2022-08-22',
    title: 'The Legal Metrology (Packaged Commodities) (Third Amendment) Rules, 2022',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2023-01-01',
    commencementText: 'They shall come into force on 1st January, 2023.',
    affectedRules: ['Rule 26'],
    affectedProvisions: [
      {
        rule: 'Rule 26',
        provision: '26(f)',
        operation: 'INSERTED',
        effect:
          'Garments and hosiery sold loose or open at the point of sale are exempt, provided they bear the manufacturer/marketer/brand owner/importer with country of origin, consumer care email and phone, size, and maximum retail price inclusive of all taxes; and that the same information is displayed on the e-commerce website where sold online.',
      },
    ],
    changeType: 'EXEMPTION',
    summary:
      'Exempted loose-sold garments and hosiery from the general rules, subject to a residual set of four declarations. A partial exemption, not a complete one.',
    officialSourceUrl: url('G.S.R. 648(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 577(E)',
  },
  {
    notificationNumber: 'G.S.R. 747(E)',
    notificationDate: '2022-09-30',
    title: 'The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2022',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2022-09-30',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of October, 2022" substituted by "1st Day of December, 2022".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 October 2022 to 1 December 2022. Changes no declaration requirement.',
    officialSourceUrl: url('G.S.R. 747(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 226(E)',
  },
  {
    notificationNumber: 'G.S.R. 859(E)',
    notificationDate: '2022-11-30',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2022',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2022-11-30',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of December, 2022" substituted by "1st Day of January, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 December 2022 to 1 January 2023.',
    officialSourceUrl: url('G.S.R. 859(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 747(E)',
  },
  {
    notificationNumber: 'G.S.R. 910(E)',
    notificationDate: '2022-12-29',
    title: 'The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2022',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2022-12-29',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette. (Not read from the notification — see verificationNote.)',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of January, 2023" substituted by "1st Day of February, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 January 2023 to 1 February 2023.',
    officialSourceUrl: undefined,
    verified: false,
    verificationStatus: 'PARTIALLY_VERIFIED',
    verificationNote:
      'The Department of Consumer Affairs page does not carry this notification, and no official copy could be retrieved. Its existence, date and effect are nonetheless established by official documents: G.S.R. 60(E) of 27 January 2023 names "G.S.R. 910(E), dated the 29th December, 2022" as the last amendment, and substitutes "1st day of February, 2023" — a date no earlier notification set, and which G.S.R. 859(E) had left at 1 January 2023. The arithmetic of the chain admits only one reading. The record is nevertheless flagged for manual verification against the e-Gazette; it changes only a commencement date and no declaration requirement depends on it.',
    citesPreviousNotification: 'G.S.R. 859(E)',
  },

  /* ── 2023 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 60(E)',
    notificationDate: '2023-01-27',
    title: 'The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-01-27',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of February, 2023" substituted by "1st Day of April, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 February 2023 to 1 April 2023.',
    officialSourceUrl: url('G.S.R. 60(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 910(E)',
  },
  {
    notificationNumber: 'G.S.R. 214(E)',
    notificationDate: '2023-03-24',
    title: 'The Legal Metrology (Packaged Commodities) Amendment (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-03-24',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of April, 2023" substituted by "1st day of June, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 April 2023 to 1 June 2023.',
    officialSourceUrl: url('G.S.R. 214(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 60(E)',
  },
  {
    notificationNumber: 'G.S.R. 412(E)',
    notificationDate: '2023-06-05',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-06-05',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of June, 2023" substituted by "1st day of July, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 June 2023 to 1 July 2023.',
    officialSourceUrl: url('G.S.R. 412(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 214(E)',
  },
  {
    notificationNumber: 'G.S.R. 456(E)',
    notificationDate: '2023-06-23',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2023-06-23',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(1)(a), 6(1)(b), 6(1)(f), 6(2)',
        operation: 'SUBSTITUTED',
        effect:
          'The electronic-product QR-code provisos substituted, dropping the "manufactured or packed or imported after the 15th July, 2022" qualifier and the one-year limit. The option becomes permanent.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary: 'Made the electronic-product QR-code option permanent by removing the time limit G.S.R. 577(E) had attached to it.',
    officialSourceUrl: url('G.S.R. 456(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    // Its closing note names G.S.R. 412(E), which amends the 2022 Amendment
    // Rules rather than the principal rules. Recorded as a source conflict.
    citesPreviousNotification: 'G.S.R. 412(E)',
  },
  {
    notificationNumber: 'G.S.R. 463(E)',
    notificationDate: '2023-06-28',
    publicationDate: '2023-06-30',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-06-28',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of July, 2023" substituted by "1st day of September, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 July 2023 to 1 September 2023.',
    officialSourceUrl: url('G.S.R. 463(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 412(E)',
  },
  {
    notificationNumber: 'G.S.R. 640(E)',
    notificationDate: '2023-08-30',
    publicationDate: '2023-08-31',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-08-31',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of September, 2023" substituted by "1st day of October, 2023".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary: 'Deferred the 2022 Amendment Rules from 1 September 2023 to 1 October 2023.',
    officialSourceUrl: url('G.S.R. 640(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 463(E)',
  },
  {
    notificationNumber: 'G.S.R. 714(E)',
    notificationDate: '2023-09-30',
    publicationDate: '2023-10-03',
    title: 'The Legal Metrology (Packaged Commodities) (Amendment) Rules, 2023',
    amends: 'AMENDMENT_RULES',
    amendsNotification: 'G.S.R. 226(E)',
    effectiveFrom: '2023-10-03',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: [],
    affectedProvisions: [
      {
        rule: 'Rule 1',
        provision: '1(2)',
        operation: 'SUBSTITUTED',
        effect: 'In G.S.R. 226(E): "1st day of October, 2023" substituted by "1st day of January, 2024".',
      },
    ],
    changeType: 'COMMENCEMENT_DATE',
    summary:
      'The last of the nine deferrals. Fixed the 2022 Amendment Rules at 1 January 2024, which is the date they finally took effect.',
    officialSourceUrl: url('G.S.R. 714(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 640(E)',
  },
  {
    notificationNumber: 'G.S.R. 722(E)',
    notificationDate: '2023-10-06',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2023',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2024-01-01',
    commencementText: 'Save as otherwise provided, these rules shall come into force on the 1st day of January, 2024.',
    affectedRules: ['Rule 2', 'Rule 6', 'Rule 26', 'Fourth Schedule'],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(ka), 2(kb), 2(kc)',
        operation: 'INSERTED',
        effect: 'Defines "combination package", "group package" and "multi-piece package", with illustrations.',
      },
      {
        rule: 'Rule 6',
        provision: '6(1)(d)',
        operation: 'INSERTED',
        effect:
          'Provisos: the month-and-year declaration does not apply to spare parts and accessories used for warranty servicing and not sold to end customers; and for electronic products, spare parts and accessories the declaration may be anywhere on the retail package, visibly and legibly.',
        effectiveFromOverride: '2024-04-01',
      },
      {
        rule: 'Rule 6',
        provision: '6(11)',
        operation: 'INSERTED',
        effect: 'Proviso: no unit sale price is required for a combination package, a group package or a multi-piece package.',
      },
      {
        rule: 'Rule 26',
        provision: '26(f)',
        operation: 'SUBSTITUTED',
        effect:
          'In the garments exemption, item (iii) restated: size in metric notation in cm or m, or with internationally recognisable indicators (S, M, L, XL, XXL, XXXL) together with the metric detail.',
      },
      {
        rule: 'Rule 26',
        provision: '26(g)',
        operation: 'INSERTED',
        effect:
          'New exemption for loose commodities ordered through e-commerce channels where the consumer knows the commodity, type and quantity — subject to four residual declarations: seller identity with country of origin for imports, consumer care email and phone, retail sale price inclusive of all taxes, and net quantity.',
      },
      {
        rule: 'Fourth Schedule',
        operation: 'SUBSTITUTED',
        effect: 'Serial number (11), column 3: "weight or volume and if the net quantity is declared by volume, the net quantity shall also be declared by weight".',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Introduced the combination/group/multi-piece package definitions and the corresponding unit-sale-price relief, the spare-parts carve-out from the manufacturing-date declaration, and the loose-commodity e-commerce exemption in rule 26(g).',
    officialSourceUrl: url('G.S.R. 722(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 714(E)',
  },

  /* ── 2025 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 778(E)',
    notificationDate: '2025-10-23',
    publicationDate: '2025-10-24',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2025',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2025-10-24',
    commencementText: 'They shall come into force on the date of their publication in the official gazette.',
    affectedRules: ['Rule 2', 'Rule 7', 'Rule 33'],
    affectedProvisions: [
      {
        rule: 'Rule 2',
        provision: '2(h)',
        operation: 'INSERTED',
        effect: 'Proviso: for packages containing medical devices, the provisions of the Medical Devices Rules, 2017 shall apply to make declarations.',
      },
      {
        rule: 'Rule 7',
        provision: '7(2)',
        operation: 'INSERTED',
        effect: 'Proviso: for packages containing medical devices, the Medical Devices Rules, 2017 apply for the height of any numeral and letter.',
      },
      {
        rule: 'Rule 7',
        provision: '7(3)',
        operation: 'INSERTED',
        effect: 'Proviso: for packages containing medical devices, the Medical Devices Rules, 2017 apply for the width of any numeral and letter.',
      },
      {
        rule: 'Rule 33',
        provision: '33(2)',
        operation: 'INSERTED',
        effect: 'Rule 33 numbered as 33(1); new 33(2) — where the Medical Devices Rules, 2017 are applicable, the relaxation under rule 33 does not apply.',
      },
    ],
    changeType: 'CROSS_REGULATION',
    summary:
      'Redirects declaration, letter-height and letter-width requirements for medical-device packages to the Medical Devices Rules, 2017, and withdraws the rule 33 relaxation where those rules apply. The Packaged Commodities typography thresholds must not be applied to such packages.',
    officialSourceUrl: url('G.S.R. 778(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 722(E)',
  },
  {
    notificationNumber: 'G.S.R. 881(E)',
    notificationDate: '2025-12-02',
    title: 'The Legal Metrology (Packaged Commodities) Second (Amendment) Rules, 2025',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2026-02-01',
    commencementText: 'They shall come into force on the 1st day of February, 2026.',
    affectedRules: ['Rule 26'],
    affectedProvisions: [
      {
        rule: 'Rule 26',
        provision: '26(a)',
        operation: 'INSERTED',
        effect: 'After the first proviso to rule 26(a): "Provided further that the provisions of this clause shall not apply to pan masala."',
      },
    ],
    changeType: 'EXEMPTION',
    summary:
      'Withdrew the rule 26(a) small-package exemption from pan masala, in the same way G.S.R. 385(E) had withdrawn it from tobacco. This narrows an exemption; it does not create one.',
    officialSourceUrl: url('G.S.R. 881(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 778(E)',
  },

  /* ── 2026 ─────────────────────────────────────────────────────────────── */
  {
    notificationNumber: 'G.S.R. 128(E)',
    notificationDate: '2026-02-13',
    title: 'The Legal Metrology (Packaged Commodities) Amendment Rules, 2026',
    amends: 'PRINCIPAL_RULES',
    effectiveFrom: '2026-07-01',
    commencementText: 'They shall come into force on the 1st day of July, 2026.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(10A)',
        operation: 'INSERTED',
        effect:
          'After rule 6(10): "Every e-commerce entity selling imported products shall provide the product listings of such imported products in a searchable and sortable filter specifying the country of origin."',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Introduced the country-of-origin searchable and sortable filter obligation for e-commerce entities selling imported products, in force from 1 July 2026.',
    officialSourceUrl: url('G.S.R. 128(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 881(E)',
  },
  {
    notificationNumber: 'G.S.R. 312(E)',
    notificationDate: '2026-04-27',
    title: 'The Legal Metrology (Packaged Commodities) Second Amendment Rules, 2026',
    amends: 'PRINCIPAL_RULES',
    // The substitution takes effect when these rules come into force — 1 July
    // 2027 — not on the date they were notified. Until then rule 6(10A) reads
    // as G.S.R. 128(E) left it. This is the edge case §39 warns about.
    effectiveFrom: '2027-07-01',
    commencementText: 'They shall come into force on the 1st day of July, 2027.',
    affectedRules: ['Rule 6'],
    affectedProvisions: [
      {
        rule: 'Rule 6',
        provision: '6(10A)',
        operation: 'SUBSTITUTED',
        effect:
          'Rule 6(10A) substituted: "Every e-commerce entity offering for sale any imported product shall, with effect from the 1st day of July, 2027, ensure that the product listing of such imported product contains a searchable and sortable filter specifying the country of origin."',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Substitutes the country-of-origin filter sub-rule with a restated version, in force from 1 July 2027. Notified in April 2026, it is future-effective throughout 2026: an inspection in 2026 is governed by the G.S.R. 128(E) text, not this one.',
    officialSourceUrl: url('G.S.R. 312(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 128(E)',
  },
  {
    notificationNumber: 'G.S.R. 418(E)',
    notificationDate: '2026-05-29',
    publicationDate: '2026-06-01',
    title: 'The Legal Metrology (Packaged Commodities) Third Amendment Rules, 2026',
    amends: 'PRINCIPAL_RULES',
    // "on the date of their publication". The e-Gazette identifier on the
    // document is CG-DL-E-01062026-273053 and its digital signature is dated
    // 1 June 2026, so publication is taken as 1 June 2026 rather than the
    // 29 May 2026 the notification bears. Recorded as a source conflict; the
    // choice is conservative — the later date cannot make anything a violation
    // earlier than it was.
    effectiveFrom: '2026-06-01',
    commencementText: 'They shall come into force on the date of their publication in the Official Gazette.',
    affectedRules: ['Rule 4', 'Rule 27'],
    affectedProvisions: [
      {
        rule: 'Rule 4',
        operation: 'INSERTED',
        effect:
          'Explanation renumbered as Explanation-1; new Explanation-2 — importers may make the mandatory declarations at the bonded warehouses of Authorised Economic Operator Tier-2 and Tier-3 certified operators, provided retail packages carry all mandatory declarations before leaving those warehouses.',
      },
      {
        rule: 'Rule 27',
        provision: '27(2)(d)',
        operation: 'INSERTED',
        effect: 'A registration application must state the name of the Director of the company responsible for violations under the Act and rules.',
      },
      {
        rule: 'Rule 27',
        provision: '27(3)',
        operation: 'INSERTED',
        effect: 'Proviso: a company or firm must update its registration details annually, through an option on the online portal.',
      },
      {
        rule: 'Rule 27',
        provision: '27(5)',
        operation: 'INSERTED',
        effect: 'Registration certificates remain valid until cancelled.',
      },
    ],
    changeType: 'SUBSTANTIVE',
    summary:
      'Allowed importers to complete mandatory declarations at AEO Tier-2/Tier-3 bonded warehouses before the goods leave, and reworked the registration provisions in rule 27.',
    officialSourceUrl: url('G.S.R. 418(E)'),
    verified: true,
    verificationStatus: 'VERIFIED',
    citesPreviousNotification: 'G.S.R. 312(E)',
  },
];

/** The registry, newest first — the order a reader wants. */
export function amendmentsNewestFirst(): Amendment[] {
  return [...AMENDMENTS].sort((a, b) => b.notificationDate.localeCompare(a.notificationDate));
}

export function findAmendment(notificationNumber: string): Amendment | undefined {
  return AMENDMENTS.find((entry) => entry.notificationNumber === notificationNumber);
}
