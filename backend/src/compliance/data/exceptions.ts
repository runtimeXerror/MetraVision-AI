import type { RuleException, RuleSource } from '../types/Rule';

import { AUTHORITY } from './sources';
import { findAmendment } from './amendments';

/**
 * ── EXEMPTIONS AND CARVE-OUTS ───────────────────────────────────────────────
 *
 * Every exemption in the corpus, as a record with its own dates and its own
 * source. None of them is an `if` inside the engine.
 *
 * The reason is visible in rule 26(a). It exempts packages of ten grams or ten
 * millilitres or less — but that exemption has been narrowed twice, once for
 * tobacco in 2016 and once for pan masala in 2026, and it carried a proviso
 * until 2012 that has since been removed. Written as a condition in code, it
 * would be a single boolean with no history, and nobody could say what it
 * exempted on a given date. Written as four dated versions, the question
 * answers itself.
 *
 * Note what the pan masala amendment actually does: it does **not** create an
 * exemption for pan masala. It takes one away. `EX-R26-A-SMALL-PACKAGE` at
 * version 2026-02-01 declines to fire for pan masala, which means a 5 g pan
 * masala sachet is subject to the full declaration requirements from
 * 1 February 2026, having been exempt the day before.
 * ────────────────────────────────────────────────────────────────────────────
 */

function src(notification: string): RuleSource {
  const amendment = findAmendment(notification);
  if (!amendment) {
    throw new Error(`Exception cites ${notification}, which is not in the amendment registry.`);
  }
  return {
    authority: AUTHORITY,
    notification: amendment.notificationNumber,
    notificationDate: amendment.notificationDate,
    publicationDate: amendment.publicationDate,
    officialUrl: amendment.officialSourceUrl,
    verificationStatus: amendment.verificationStatus,
    verificationNote: amendment.verificationNote,
  };
}

/**
 * An empty `ruleIds` means "every rule that names this exception".
 *
 * Rule 26 says "nothing contained in these rules shall apply", so its
 * exemptions reach declaration, pricing, quantity and typography rules alike.
 * Each rule lists the exemptions that can reach it, which keeps the coupling
 * explicit and readable from either end.
 */
const ALL_CHAPTER_II: RuleException['ruleIds'] = [];

export const RULE_EXCEPTIONS: RuleException[] = [
  /* ══ Rule 3 — scope of Chapter II ═══════════════════════════════════════ */
  {
    exceptionId: 'EX-R3-BULK-QUANTITY',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages over 25 kg or 25 litre, other than cement and fertilizer in bags up to 50 kg',
    legalText:
      'The provisions of this Chapter shall not apply to,- (a) packages of commodities containing quantity of more than 25 kg or 25 litre excluding cement and fertilizer sold in bags up to 50 kg; and',
    machineInterpretation:
      'A package over 25 kg or 25 litre is outside Chapter II — except cement and fertilizer sold in bags of up to 50 kg, which stay regulated. G.S.R. 629(E) inverted this in 2018: from then on cement, fertilizer and farm produce in bags *above* 50 kg are the ones excluded.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        {
          op: 'any',
          conditions: [
            {
              op: 'all',
              conditions: [
                { op: 'in', path: 'productContext.quantityUnit', values: ['kg', 'kilogram', 'kgs'] },
                { op: 'greaterThan', path: 'productContext.quantity', value: 25 },
              ],
            },
            {
              op: 'all',
              conditions: [
                { op: 'in', path: 'productContext.quantityUnit', values: ['l', 'L', 'litre', 'liter', 'litres'] },
                { op: 'greaterThan', path: 'productContext.quantity', value: 25 },
              ],
            },
          ],
        },
        // Cement and fertilizer in bags up to 50 kg are carved back in.
        {
          op: 'not',
          condition: {
            op: 'all',
            conditions: [
              { op: 'equals', path: 'productContext.isBaggedBulkCommodity', value: true },
              { op: 'lessThanOrEqual', path: 'productContext.quantity', value: 50 },
              { op: 'in', path: 'productContext.quantityUnit', values: ['kg', 'kilogram', 'kgs'] },
            ],
          },
        },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: '2018-01-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 202(E)'),
    supersededBy: 'EX-R3-BULK-QUANTITY@2018-01-01',
  },
  {
    exceptionId: 'EX-R3-BULK-QUANTITY',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages over 25 kg or 25 litre',
    legalText: 'The provisions of this Chapter shall not apply to- (a) packages of commodities containing quantity of more than 25 kilogram or 25 litre;',
    machineInterpretation:
      'Where the declared net quantity exceeds 25 kg or 25 litre, the Chapter II declaration rules do not reach the package. The engine needs a parsed quantity and unit on the product context to apply this; without one it does not assume the exemption.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'any',
      conditions: [
        {
          op: 'all',
          conditions: [
            { op: 'in', path: 'productContext.quantityUnit', values: ['kg', 'kilogram', 'kgs'] },
            { op: 'greaterThan', path: 'productContext.quantity', value: 25 },
          ],
        },
        {
          op: 'all',
          conditions: [
            { op: 'in', path: 'productContext.quantityUnit', values: ['l', 'L', 'litre', 'liter', 'litres'] },
            { op: 'greaterThan', path: 'productContext.quantity', value: 25 },
          ],
        },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
    supersedes: 'EX-R3-BULK-QUANTITY@2011-04-01',
  },
  {
    exceptionId: 'EX-R3-INDUSTRIAL-CONSUMER',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packaged commodities meant for industrial consumers',
    legalText: 'The provisions of this Chapter shall not apply to- … (c) packaged commodities meant for industrial consumers or institutional consumers.',
    machineInterpretation: 'Where the package is meant for an industrial consumer, the Chapter II declaration rules do not apply to it.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isIndustrialConsumer', value: true },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R3-INSTITUTIONAL-CONSUMER',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packaged commodities meant for institutional consumers',
    legalText: 'The provisions of this Chapter shall not apply to- … (c) packaged commodities meant for industrial consumers or institutional consumers.',
    machineInterpretation:
      'Where the package is meant for an institutional consumer, the Chapter II declaration rules do not apply. Since 2015 both consumer definitions require a "not for retail sale" declaration on the package, which is the practical marker an inspector looks for.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isInstitutionalConsumer', value: true },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R3-BAGGED-BULK',
    ruleIds: ALL_CHAPTER_II,
    title: 'Cement, fertilizer and agricultural farm produce in bags above 50 kg',
    legalText: 'The provisions of this Chapter shall not apply to- … (b) cement, fertilizer and agricultural farm produce sold in bags above 50 kilogram; and',
    machineInterpretation:
      'Where the commodity is cement, fertilizer or agricultural farm produce sold in bags above 50 kg, Chapter II does not apply. Before 1 January 2018 the rule read differently: cement and fertilizer in bags up to 50 kg were *excluded from* the 25 kg exemption, so they remained regulated.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isBaggedBulkCommodity', value: true },
        { op: 'greaterThan', path: 'productContext.quantity', value: 50 },
        { op: 'in', path: 'productContext.quantityUnit', values: ['kg', 'kilogram', 'kgs'] },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
  },

  /* ══ Rule 26(a) — small packages, and the two carve-outs from it ════════ */
  {
    exceptionId: 'EX-R26-A-SMALL-PACKAGE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages of ten gram or ten millilitre or less',
    legalText:
      'Nothing contained in these rules shall apply to any package containing a commodity if— (a) the net weight or measure of the commodity is ten gram or ten millilitre or less, if sold by weight or measure; Provided that the declaration in respect of maximum retail price and net quantity shall be declared on packages containing 10g to 20g or 10ml to 20ml;',
    machineInterpretation:
      'A package of 10 g or 10 ml or less is exempt. As originally enacted a proviso still required the retail price and net quantity on packages of 10–20 g or 10–20 ml, which the engine models as a partial exemption over that band.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'in', path: 'productContext.quantityUnit', values: ['g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter'] },
        { op: 'lessThanOrEqual', path: 'productContext.quantity', value: 10 },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: '2012-07-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 202(E)'),
    supersededBy: 'EX-R26-A-SMALL-PACKAGE@2012-07-01',
  },
  {
    exceptionId: 'EX-R26-A-SMALL-PACKAGE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages of ten gram or ten millilitre or less',
    legalText:
      'Nothing contained in these rules shall apply to any package containing a commodity if— (a) the net weight or measure of the commodity is ten gram or ten millilitre or less, if sold by weight or measure;',
    machineInterpretation: 'A package of 10 g or 10 ml or less is exempt. The 10–20 g proviso was omitted with effect from 1 July 2012.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'in', path: 'productContext.quantityUnit', values: ['g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter'] },
        { op: 'lessThanOrEqual', path: 'productContext.quantity', value: 10 },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2012-07-01',
    effectiveTo: '2016-01-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 784(E)'),
    supersedes: 'EX-R26-A-SMALL-PACKAGE@2011-04-01',
    supersededBy: 'EX-R26-A-SMALL-PACKAGE@2016-01-01',
  },
  {
    exceptionId: 'EX-R26-A-SMALL-PACKAGE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages of ten gram or ten millilitre or less, other than tobacco',
    legalText:
      'Nothing contained in these rules shall apply to any package containing a commodity if— (a) the net weight or measure of the commodity is ten gram or ten millilitre or less, if sold by weight or measure: Provided that the provisions of this clause shall not be applicable for tobacco and tobacco products.',
    machineInterpretation:
      'The small-package exemption, withdrawn from tobacco and tobacco products from 1 January 2016. A 5 g tobacco sachet is therefore fully subject to the declaration requirements; a 5 g sachet of anything else is not.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'in', path: 'productContext.quantityUnit', values: ['g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter'] },
        { op: 'lessThanOrEqual', path: 'productContext.quantity', value: 10 },
        { op: 'not', condition: { op: 'equals', path: 'productContext.isTobaccoProduct', value: true } },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2016-01-01',
    effectiveTo: '2026-02-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 385(E)'),
    supersedes: 'EX-R26-A-SMALL-PACKAGE@2012-07-01',
    supersededBy: 'EX-R26-A-SMALL-PACKAGE@2026-02-01',
  },
  {
    exceptionId: 'EX-R26-A-SMALL-PACKAGE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Packages of ten gram or ten millilitre or less, other than tobacco and pan masala',
    legalText:
      'Nothing contained in these rules shall apply to any package containing a commodity if— (a) the net weight or measure of the commodity is ten gram or ten millilitre or less, if sold by weight or measure: Provided that the provisions of this clause shall not be applicable for tobacco and tobacco products: Provided further that the provisions of this clause shall not apply to pan masala.',
    machineInterpretation:
      'The small-package exemption, now withdrawn from pan masala as well as tobacco, with effect from 1 February 2026. The amendment narrows an exemption; it does not create one. A 5 g pan masala sachet inspected on 31 January 2026 is exempt and the same sachet inspected on 1 February 2026 is not.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'in', path: 'productContext.quantityUnit', values: ['g', 'gram', 'grams', 'ml', 'millilitre', 'milliliter'] },
        { op: 'lessThanOrEqual', path: 'productContext.quantity', value: 10 },
        { op: 'not', condition: { op: 'equals', path: 'productContext.isTobaccoProduct', value: true } },
        { op: 'not', condition: { op: 'equals', path: 'productContext.isPanMasala', value: true } },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2026-02-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 881(E)'),
    supersedes: 'EX-R26-A-SMALL-PACKAGE@2016-01-01',
  },

  /* ══ Rule 26 — the remaining exemptions ═════════════════════════════════ */
  {
    exceptionId: 'EX-R26-B-FAST-FOOD',
    ruleIds: ALL_CHAPTER_II,
    title: 'Fast food packed by a restaurant or hotel',
    legalText: '(b) any package containing fast food items packed by restaurant or hotel and the like;',
    machineInterpretation: 'Fast food packed by a restaurant, hotel or similar establishment is outside the rules entirely.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isFastFoodByRestaurant', value: true },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R26-C-DRUG-FORMULATION',
    ruleIds: ALL_CHAPTER_II,
    title: 'Scheduled and non-scheduled drug formulations',
    legalText:
      '(c) it contains scheduled formulations and non-scheduled formulations covered under the Drugs (Price Control) Order, 1995 made under section 3 of the Essential Commodities Act, 1955 (10 of 1955);',
    machineInterpretation: 'Drug formulations covered by the Drugs (Price Control) Order, 1995 are outside the rules.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isDrugFormulation', value: true },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: '2018-01-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 202(E)'),
    supersededBy: 'EX-R26-C-DRUG-FORMULATION@2018-01-01',
  },
  {
    exceptionId: 'EX-R26-C-DRUG-FORMULATION',
    ruleIds: ALL_CHAPTER_II,
    title: 'Drug formulations, but not medical devices declared as drugs',
    legalText:
      '(c) it contains scheduled formulations and non-scheduled formulations covered under the Drugs (Price Control) Order, 2013 made under section 3 of the Essential Commodities Act, 1955 (10 of 1955): Provided that no exemption shall be applicable to medical devices declared as drugs.',
    machineInterpretation:
      'Drug formulations under the Drugs (Price Control) Order, 2013 remain exempt, but a medical device declared as a drug does not get the exemption. The engine therefore refuses to apply this exception where the package is a medical device — an important interaction with the 2025 medical-device cross-reference, which redirects *how* declarations are made without exempting the package from making them.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isDrugFormulation', value: true },
        { op: 'not', condition: { op: 'equals', path: 'productContext.isMedicalDevice', value: true } },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
    supersedes: 'EX-R26-C-DRUG-FORMULATION@2011-04-01',
  },
  {
    exceptionId: 'EX-R26-D-FARM-PRODUCE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Agricultural farm produce in packages above 50 kg',
    legalText: '(d) agricultural form produces in packages of above 50 kg.',
    machineInterpretation:
      'Agricultural farm produce in packages above 50 kg was exempt under rule 26(d) until 1 January 2018, when the clause was omitted and the exclusion moved into rule 3 — see EX-R3-BAGGED-BULK, which carries it forward.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isAgriculturalFarmProduce', value: true },
        { op: 'greaterThan', path: 'productContext.quantity', value: 50 },
        { op: 'in', path: 'productContext.quantityUnit', values: ['kg', 'kilogram', 'kgs'] },
      ],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: '2018-01-01',
    status: 'OMITTED',
    source: src('G.S.R. 202(E)'),
    supersededBy: 'EX-R3-BAGGED-BULK@2018-01-01',
  },
  {
    exceptionId: 'EX-R26-E-HANDLOOM-THREAD',
    ruleIds: ALL_CHAPTER_II,
    title: 'Thread sold in coil to handloom weavers',
    legalText: '(e) any thread which is sold in coil to handloom weavers.',
    machineInterpretation: 'Thread sold in coil to handloom weavers is outside the rules.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.commodityType', value: 'handloom_thread_coil' },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2014-12-04',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 870(E)'),
  },
  {
    exceptionId: 'EX-R26-F-LOOSE-GARMENTS',
    ruleIds: ALL_CHAPTER_II,
    title: 'Garments and hosiery sold loose at the point of sale',
    legalText:
      '(f) such commodities being a garment or hosiery is sold in loose or open at the point of sale in such manner that the consumer can inspect the products before buying: Provided that such product shall bear the following details, namely:- (i) name and address of the manufacturer or marketer or brand owner or importer with country of origin or manufacture in case of imported products; (ii) consumer care email id and phone number; (iii) sizes with internationally recognizable size indicators such as S, M, L, XL, XXL and XXXL along with details in metric notation in terms of cm or m, as the case may be; (iv) maximum retail price of the package inclusive of all taxes in Indian currency: Provided further that the exemption under this clause shall apply to sale of finished products alone: Provided also that the above information shall be displayed on e-commerce website if such product is sold through e-commerce.',
    machineInterpretation:
      'A partial exemption, not a complete one. Loose-sold garments and hosiery escape the general declaration rules but must still carry four specific declarations, which the engine continues to check. Reading this as a full exemption would drop four live requirements.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isGarmentOrHosiery', value: true },
        { op: 'equals', path: 'productContext.isSoldLoose', value: true },
      ],
    },
    effect: 'PARTIAL_EXEMPTION',
    survivingRequirements: ['LM-PC-R6-1-A', 'LM-PC-R6-1-AA', 'LM-PC-R6-2', 'LM-PC-R6-1-E', 'LM-PC-R6-1-F'],
    effectiveFrom: '2023-01-01',
    effectiveTo: '2024-01-01',
    status: 'SUPERSEDED',
    source: src('G.S.R. 648(E)'),
    supersededBy: 'EX-R26-F-LOOSE-GARMENTS@2024-01-01',
  },
  {
    exceptionId: 'EX-R26-F-LOOSE-GARMENTS',
    ruleIds: ALL_CHAPTER_II,
    title: 'Garments and hosiery sold loose at the point of sale',
    legalText:
      '(f) such commodities being a garment or hosiery is sold in loose or open at the point of sale … Provided that such product shall bear the following details, namely:- … (iii) size of the product in metric notation in terms of cm or m, as the case may be, or with internationally recognizable size indicators such as S, M, L, XL, XXL and XXXL along with details in metric notation in the terms of cm or m, as the case may be;',
    machineInterpretation:
      'The same partial exemption, with item (iii) restated to put metric notation first. The four surviving declarations are unchanged.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isGarmentOrHosiery', value: true },
        { op: 'equals', path: 'productContext.isSoldLoose', value: true },
      ],
    },
    effect: 'PARTIAL_EXEMPTION',
    survivingRequirements: ['LM-PC-R6-1-A', 'LM-PC-R6-1-AA', 'LM-PC-R6-2', 'LM-PC-R6-1-E', 'LM-PC-R6-1-F'],
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 722(E)'),
    supersedes: 'EX-R26-F-LOOSE-GARMENTS@2023-01-01',
  },
  {
    exceptionId: 'EX-R26-G-LOOSE-ECOMMERCE',
    ruleIds: ALL_CHAPTER_II,
    title: 'Loose commodities ordered through e-commerce channels',
    legalText:
      '(g) it contains loose commodities ordered through e-commerce channels, where consumers are aware of the ordered commodity, its type and quantity: Provided that such commodities shall bear the following information, namely:- (i) name and address of manufacturer or marketer or brand owner or importer or seller with the country of origin or manufacture in the case of imported products; (ii) consumer care email id and phone number; (iii) retail sale price of the package inclusive of all taxes in the Indian currency; and (iv) net quantity, in terms of the standard unit of weight or measure, or where the commodity is sold by number, the number of the commodity.',
    machineInterpretation:
      'A partial exemption for loose commodities bought online. Four declarations survive: seller identity with country of origin for imports, consumer care contact, retail sale price inclusive of all taxes, and net quantity.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isSoldLoose', value: true },
        { op: 'equals', path: 'productContext.isEcommerce', value: true },
      ],
    },
    effect: 'PARTIAL_EXEMPTION',
    survivingRequirements: ['LM-PC-R6-1-A', 'LM-PC-R6-1-AA', 'LM-PC-R6-2', 'LM-PC-R6-1-E', 'LM-PC-R6-1-C'],
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 722(E)'),
  },

  /* ══ Cross-regulation hand-offs ═════════════════════════════════════════ */
  {
    exceptionId: 'EX-R7-MEDICAL-DEVICES',
    ruleIds: ['LM-PC-R7-2', 'LM-PC-R7-3'],
    title: 'Medical device packages — height and width under the Medical Devices Rules, 2017',
    legalText:
      'Provided that for packages containing medical devices, the provisions of the Medical Devices Rules, 2017, shall apply for the height of any numeral and letter to make declarations. … Provided that for packages containing medical devices, the provisions of the Medical Devices Rules, 2017, shall apply for the width of any numeral and letter to make declarations.',
    machineInterpretation:
      'For a package containing a medical device, the Packaged Commodities letter-height and letter-width requirements do not apply; the Medical Devices Rules, 2017 supply them instead. The engine must not fall back on Table-I here. It hands off, and says on the result which instrument took over — it does not evaluate the Medical Devices Rules, which are outside this corpus.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isMedicalDevice', value: true },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Medical Devices Rules, 2017',
    effectiveFrom: '2025-10-24',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 778(E)'),
  },
  {
    exceptionId: 'EX-R2-H-MEDICAL-DEVICE-DECLARATIONS',
    ruleIds: ['LM-PC-R7-2', 'LM-PC-R7-3'],
    title: 'Medical device packages — principal display panel under the Medical Devices Rules, 2017',
    legalText: 'Provided that for packages containing medical devices, the provisions of the Medical Devices Rules, 2017, shall apply to make declarations;',
    machineInterpretation:
      'This proviso was inserted into rule 2(h), which defines the *principal display panel* — the surface on which declarations are to be given and the manner in which they are grouped. Read in place, it redirects how declarations are laid out on a medical-device package to the Medical Devices Rules, 2017; it does not excuse the package from carrying them. That reading is confirmed by the company it keeps: G.S.R. 778(E) made three other changes, all of them about presentation (letter height under rule 7(2), letter width under rule 7(3), and withdrawal of the rule 33 relaxation), and by rule 26(c), which expressly withholds the drug-formulation exemption from medical devices declared as drugs. So this exception reaches the panel and typography rules and stops there — the substantive declarations are still checked.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isMedicalDevice', value: true },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Medical Devices Rules, 2017',
    effectiveFrom: '2025-10-24',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 778(E)'),
  },
  {
    exceptionId: 'EX-R6-1-A-FOOD-ARTICLES',
    ruleIds: ['LM-PC-R6-1-A'],
    title: 'Food articles — manufacturer declaration under the Food Safety and Standards Act, 2006',
    legalText:
      'Explanation III. - In respect of packages containing food articles, the provisions of this clause shall not apply, but the provisions of, and the requirements specified in the Food Safety and Standards Act, 2006 (34 of 2006) and the rules made thereunder shall apply;',
    machineInterpretation:
      'For a package containing food articles, rule 6(1)(a) hands the manufacturer declaration to the Food Safety and Standards Act, 2006. The engine defers rather than finding a breach of a clause that does not apply.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'any',
      conditions: [
        { op: 'equals', path: 'productContext.isFoodArticle', value: true },
        { op: 'equals', path: 'productContext.category', value: 'packaged_food' },
      ],
    },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Food Safety and Standards Act, 2006',
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
  },
  {
    exceptionId: 'EX-R6-1-D-SEEDS',
    ruleIds: ['LM-PC-R6-1-D'],
    title: 'Certified seeds — manufacturing date under the Seeds Act, 1966',
    legalText:
      'Provided further that nothing in this sub-clause shall apply in case of packages containing seeds which are labeled and certified under the provisions of the Seeds Act, 1966 (54 of 1966) and the rules made there under:',
    machineInterpretation: 'Packages of seeds labelled and certified under the Seeds Act, 1966 are outside the month-and-year declaration.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.commodityType', value: 'certified_seeds' },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R6-1-D-COSMETICS',
    ruleIds: ['LM-PC-R6-1-D'],
    title: 'Cosmetics — manufacturing date under the Drugs and Cosmetics Rules, 1945',
    legalText: 'Provided also that for packages containing cosmetics products, the provisions of the Drugs and Cosmetics Rules, 1945 shall apply.',
    machineInterpretation: 'For cosmetics, the month-and-year declaration is governed by the Drugs and Cosmetics Rules, 1945 rather than by this clause.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'any',
      conditions: [
        { op: 'equals', path: 'productContext.isCosmeticOrToiletry', value: true },
        { op: 'equals', path: 'productContext.category', value: 'cosmetic' },
      ],
    },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Drugs and Cosmetics Rules, 1945',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R6-1-D-WARRANTY-SPARES',
    ruleIds: ['LM-PC-R6-1-D'],
    title: 'Spare parts and accessories for warranty servicing',
    legalText:
      'Provided also that nothing contained in this clause shall apply to spare parts and accessories used for the purpose of servicing with a warranty and not sold to end customers:',
    machineInterpretation:
      'Spare parts and accessories supplied for warranty servicing and not sold to end customers fall outside the month-and-year declaration entirely.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.commodityType', value: 'warranty_spare_part' },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2024-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 722(E)'),
  },
  {
    exceptionId: 'EX-R6-1-DA-OTHER-LAW',
    ruleIds: ['LM-PC-R6-1-DA'],
    title: 'Best before — where another law provides for it',
    legalText: 'Provided that nothing in this clause shall apply if a provision in this regard is made in any other law.',
    machineInterpretation:
      'Where another law already provides for the best-before declaration — for food articles, the Food Safety and Standards Act, 2006 — this clause steps back. The engine defers for food articles rather than raising a Packaged Commodities finding.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isFoodArticle', value: true },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Food Safety and Standards Act, 2006',
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
  },
  {
    exceptionId: 'EX-R6-1-E-ALCOHOL',
    ruleIds: ['LM-PC-R6-1-E'],
    title: 'Alcoholic beverages — retail sale price under State excise law',
    legalText:
      'Provided that for packages containing alcoholic beverages or spirituous liquor, the State Excise Laws and the rules made there under shall be applicable within the State in which it is manufactured and where the state excise laws and rules made there under do not provide for declaration of retail sale price, the provisions of these rules shall apply.',
    machineInterpretation:
      'For alcoholic beverages, State excise law governs the price declaration within the State of manufacture — and these rules apply only where the State law is silent. The engine cannot determine what a given State\'s excise rules provide, so it defers and says so, rather than guessing in either direction.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isAlcoholicBeverage', value: true },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'State Excise Laws',
    effectiveFrom: '2011-04-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 202(E)'),
  },
  {
    exceptionId: 'EX-R6-1-E-ESSENTIAL-COMMODITY',
    ruleIds: ['LM-PC-R6-1-E'],
    title: 'Essential commodities — notified retail sale price prevails',
    legalText:
      'Provided further that if the retail sale price of any essential commodity is fixed and notified by the Competent Authority under the Essential Commodities Act, 1955 the same shall apply;',
    machineInterpretation:
      'Where a price is notified under the Essential Commodities Act, 1955, that price applies. The engine holds no register of notified prices, so this exception fires only when the inspection record marks the commodity as price-notified.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.commodityType', value: 'price_notified_essential_commodity' },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'Essential Commodities Act, 1955',
    effectiveFrom: '2016-09-07',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 858(E)'),
  },
  {
    exceptionId: 'EX-R6-10-MARKETPLACE-INTERMEDIARY',
    ruleIds: ['LM-PC-R6-10'],
    title: 'Marketplace model — responsibility rests with the seller',
    legalText:
      'Provided that in case of market place model of e-commerce, responsibility of the correctness of declarations shall lie with the manufacturer or seller or dealer or importer if,- (a) the function of the e-commerce entity is limited to providing access to a communication system … (b) the entity does not- (i) initiate the transmission; (ii) select the receiver of the transmission; and (iii) select or modify the information contained in the transmission; (c) the entity observes due diligence …',
    machineInterpretation:
      'In a marketplace model, correctness of the declarations is the seller\'s responsibility, provided the platform behaved as a mere intermediary. Whether it did is a factual question the engine cannot settle from package evidence, so it records the shift of responsibility and marks the check as requiring review rather than finding against the platform.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'all',
      conditions: [
        { op: 'equals', path: 'productContext.isEcommerce', value: true },
        { op: 'equals', path: 'productContext.ecommerceModel', value: 'MARKETPLACE' },
      ],
    },
    effect: 'PARTIAL_EXEMPTION',
    survivingRequirements: ['LM-PC-R6-10'],
    effectiveFrom: '2018-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 629(E)'),
  },
  {
    exceptionId: 'EX-R6-11-ALCOHOL',
    ruleIds: ['LM-PC-R6-11'],
    title: 'Alcoholic beverages — unit sale price under State excise law',
    legalText:
      'Provided that for packages containing alcoholic beverages or spirituous liquor, the State Excise Laws and the rules made thereunder shall be applicable within the State in which it is manufactured.',
    machineInterpretation: 'The unit sale price rule steps back for alcoholic beverages within the State of manufacture.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.isAlcoholicBeverage', value: true },
    effect: 'DEFER_TO_OTHER_REGULATION',
    deferTo: 'State Excise Laws',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 226(E)'),
  },
  {
    exceptionId: 'EX-R6-11-RSP-EQUALS-UNIT-PRICE',
    ruleIds: ['LM-PC-R6-11'],
    title: 'Unit sale price not required where it equals the retail sale price',
    legalText:
      'Provided further that declaration of unit sale price is not required for the pre-packaged commodities in which retail sale price is equal to the unit sale price.',
    machineInterpretation:
      'Where the retail sale price is the unit sale price — a one-kilogram pack, say — no separate unit price is required. This fires only when the inspection record says the two are equal; the engine does not infer it by comparing two independent reads.',
    interpretationStatus: 'REVIEWED',
    condition: { op: 'equals', path: 'productContext.commodityType', value: 'rsp_equals_unit_price' },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 226(E)'),
  },
  {
    exceptionId: 'EX-R6-11-MULTI-PIECE-PACKAGES',
    ruleIds: ['LM-PC-R6-11'],
    title: 'Unit sale price not required for combination, group or multi-piece packages',
    legalText:
      'Provided also that declaration of unit sale price is not required for a combination package or a group package or a multi-piece package, under these rules or under any other law for the time being in force.',
    machineInterpretation:
      'Combination, group and multi-piece packages — all three defined by G.S.R. 722(E) — are outside the unit-sale-price requirement.',
    interpretationStatus: 'REVIEWED',
    condition: {
      op: 'in',
      path: 'productContext.packageType',
      values: ['COMBINATION', 'GROUP', 'MULTI_PIECE'],
    },
    effect: 'NOT_APPLICABLE',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'ACTIVE',
    source: src('G.S.R. 722(E)'),
  },
];
