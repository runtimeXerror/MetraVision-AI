import type { ComplianceCheck, ComplianceResult, ComplianceWarning } from '../../compliance/types/ComplianceResult';
import type {
  ComplianceCheckAttrs,
  ExtractedFieldAttrs,
  ViolationAttrs,
} from '../../models/Inspection';
import type { CheckResult, ComplianceStatus, ViolationCategory } from '../../types/domain';
import type { ExtractionResult } from '../extraction';

import type { ComplianceIssue } from './issueGenerator';

/**
 * ── KEEPING THE REST OF THE APPLICATION WORKING ─────────────────────────────
 *
 * The scan writes two things onto an inspection: the full rule-engine result,
 * which is the record of what was decided and why, and this — a projection of
 * it into the shape the History screen, the dashboard tiles, the violations
 * page and the analytics aggregations were already built against.
 *
 * The projection is lossy and deliberately so; it is a summary, not a second
 * source of truth. Nothing reads it to make a decision. Where the two ever
 * disagree the rule-engine result is right, which is why the scan result is
 * stored whole beside it rather than being reconstructed from this.
 *
 * The alternative was to rewrite five screens and three aggregation pipelines
 * to speak the engine's five-state vocabulary. That is worth doing eventually.
 * It is not worth doing in the same change that first connects a camera to the
 * rulebook.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * The verdict, in the schema's vocabulary.
 *
 * A package no rule reached — every rule out of scope or exempt — is not a
 * violation, and it is recorded as compliant with nothing checked rather than
 * in a third state the app no longer shows.
 */
export function toLegacyStatus(status: ComplianceResult['status']): ComplianceStatus {
  if (status === 'VIOLATION_DETECTED') return 'VIOLATION_DETECTED';
  return 'COMPLIANT';
}

const RESULT_BY_STATUS: Record<ComplianceCheck['status'], CheckResult> = {
  COMPLIANT: 'PASS',
  VIOLATION_DETECTED: 'FAIL',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
};

const CATEGORY_BY_FIELD: Record<string, ViolationCategory> = {
  mrp: 'PRICING',
  unit_sale_price: 'PRICING',
  net_quantity: 'QUANTITY',
  dimensions: 'QUANTITY',
  manufacturer: 'TRACEABILITY',
  consumer_care: 'TRACEABILITY',
  country_of_origin: 'TRACEABILITY',
  manufacturing_date: 'TRACEABILITY',
  best_before: 'TRACEABILITY',
};

const ABSENCE_REASONS = new Set(['DECLARATION_ABSENT', 'CROSS_FIELD_INCOMPLETE']);

function categoryFor(check: ComplianceCheck): ViolationCategory {
  if (ABSENCE_REASONS.has(check.reasonCode)) return 'MISSING_DECLARATION';
  if (check.reasonCode === 'DECLARATION_UNREADABLE') return 'READABILITY';
  return (check.field ? CATEGORY_BY_FIELD[check.field] : undefined) ?? 'INCORRECT_DECLARATION';
}

/**
 * What a check is *about*, in the words an officer uses.
 *
 * The title used to be the clause — `Rule 6(1)(e)` — so a report listed twenty
 * findings whose headings were all rule numbers, and the reference beside each
 * one repeated the same clause with a gazette notification bolted on. A reader
 * had to know the rule book by heart to know what any row concerned.
 *
 * A check always names the declaration it examined, and that is the plain
 * answer: `Maximum retail price`, `Net quantity`, `Month and year of
 * manufacture`. The clause stays, as the reference, where a reader who wants to
 * look the rule up will find it — but it is no longer doing the work of a title.
 */
const TITLE_BY_FIELD: Record<string, string> = {
  mrp: 'Maximum retail price',
  unit_sale_price: 'Unit sale price',
  net_quantity: 'Net quantity',
  manufacturing_date: 'Month and year of manufacture',
  best_before: 'Best before or use by',
  expiry_date: 'Expiry date',
  manufacturer: 'Name and address of the manufacturer, packer or importer',
  packer: 'Name and address of the packer',
  importer: 'Name and address of the importer',
  consumer_care: 'Consumer care details',
  commodity_name: 'Name of the commodity',
  country_of_origin: 'Country of origin',
  batch_number: 'Batch or lot number',
  dimensions: 'Dimensions of the commodity',
  veg_nonveg_mark: 'Vegetarian or non-vegetarian mark',
  gm_declaration: 'Genetically modified declaration',
  ecommerce_declarations: 'Declarations required for online listings',
  coo_filter: 'Country of origin for imported goods',
};

function titleFor(check: ComplianceResult['checks'][number]): string {
  const clause = check.provenance.sourceClause ?? check.provenance.sourceRule;
  if (check.field && TITLE_BY_FIELD[check.field]) return TITLE_BY_FIELD[check.field]!;

  /*
   * No declaration to name it by. These are the package-level rules — type
   * height, legibility, the promotional-pack group — and the clause is the only
   * name they have, so it stands as the title rather than being replaced by a
   * worse guess.
   */
  return clause;
}

export function toLegacyChecks(result: ComplianceResult): ComplianceCheckAttrs[] {
  return result.checks.map((check) => ({
    code: `${check.ruleId}@${check.ruleVersion}`,
    title: titleFor(check),
    // The clause alone. The gazette notification that used to be appended is
    // provenance for the rule set, not for this check, and it is recorded once
    // on the scan record where it belongs.
    ruleReference: check.provenance.sourceClause ?? check.provenance.sourceRule,
    result: RESULT_BY_STATUS[check.status],
    severity: check.severity,
    category: categoryFor(check),
    expected: check.expectedRequirement,
    observed: check.observedValue,
    message: check.reason,
    relatedFieldNames: check.field ? [check.field] : [],
  }));
}

/** Violations, for the dashboard's violations register. */
export function toLegacyViolations(issues: ComplianceIssue[]): ViolationAttrs[] {
  return issues.map((issue) => ({
    code: `${issue.ruleId}@${issue.ruleVersion}`,
    title: issue.title,
    ruleReference: `${issue.source.clause ?? issue.source.rule} — ${issue.source.notification}`,
    category:
      (issue.field ? CATEGORY_BY_FIELD[issue.field] : undefined) ??
      (issue.reasonCode.startsWith('DECLARATION_ABSENT') ? 'MISSING_DECLARATION' : 'INCORRECT_DECLARATION'),
    severity: issue.severity,
    description: issue.description,
    expected: issue.expectedRequirement,
    observed: issue.observedValue,
    // The corpus's own words about what the provision requires. No advice is
    // written here that the rule set did not supply.
    recommendation: `Confirm against the package and, if the declaration is genuinely absent or non-conforming, proceed under ${issue.source.clause ?? issue.source.rule} (${issue.source.notification}).`,
    bbox: issue.evidence[0]?.bbox ? [...issue.evidence[0].bbox] : undefined,
    sourceImageId: issue.evidence[0]?.imageId,
  }));
}

/**
 * The lapsed-date observation, as an entry in the findings list.
 *
 * ── WHY IT IS HERE AND NOT A RULE CHECK ────────────────────────────────────
 *
 * An inspector holding a packet whose use-by date has gone needs to see that
 * with the other findings, not three sections further down among the notes.
 * But it is not a contravention of the Packaged Commodities Rules and must
 * never be printed as one: Rule 6(1)(da) requires the best-before declaration
 * to be *present*, and on such a package it is. Whether the article may still
 * be offered for sale is a question under the Food Safety and Standards Act,
 * which this rule corpus does not carry.
 *
 * So it is projected here rather than generated as an issue — issues carry a
 * clause, a notification and the corpus's own legal text, and this has none of
 * those to give. `ruleReference` names the Act that does govern it, the
 * description says in its first clause that the labelling rules are not
 * breached, and the recommendation is a referral rather than a notice. A reader
 * of the report sees the finding; a reader of the finding sees exactly what is
 * and is not being claimed.
 */
export function toLapsedDateFinding(warnings: ComplianceWarning[]): ViolationAttrs[] {
  const lapsed = warnings.find((warning) => warning.code === 'DECLARED_DATE_PASSED');
  if (!lapsed) return [];

  return [
    {
      code: 'DECLARED_DATE_PASSED',
      title: 'The date declared on the package has passed',
      ruleReference: 'Food Safety and Standards Act, 2006 — not the Packaged Commodities Rules',
      // The dates and the batch are what let a packet be traced to its run,
      // and this is a statement about one of them.
      category: 'TRACEABILITY',
      severity: 'MAJOR',
      description: lapsed.message,
      expected: 'A package offered for retail sale is within the date it declares.',
      observed: null,
      recommendation:
        'Verify the packet on the shelf. If stock past its declared date is still being offered ' +
        'for sale, refer it to the Food Safety officer — no notice under the Packaged ' +
        'Commodities Rules arises from the date alone.',
    },
  ];
}

/**
 * The extracted-field list the review screen and the evidence overlay read.
 *
 * `required` is taken from whether a rule actually reached this field on this
 * package, rather than from a static list — a country-of-origin declaration is
 * required of an imported package and not of a domestic one, and the engine is
 * the only thing that knows which this is.
 */
export function toLegacyFields(
  extraction: ExtractionResult,
  result: ComplianceResult,
): ExtractedFieldAttrs[] {
  const assessed = new Set(
    result.checks
      .filter((check) => check.status !== 'NOT_APPLICABLE' && check.field)
      .map((check) => check.field!),
  );

  const records = [...Object.values(extraction.fields), ...Object.values(extraction.informational)];

  /**
   * ── DECLARATIONS THIS COMMODITY IS ACTUALLY ASKED FOR ───────────────────
   *
   * The extractor looks for every declaration it knows how to look for, which
   * is the right thing for it to do — it is told nothing about the law, and a
   * value it finds is worth recording whatever the commodity. Which of them a
   * *package* has to carry is the rule engine's question, and it answers it:
   * `assessed` is the set of declarations some applicable rule asked about.
   *
   * This projection was ignoring that answer and writing all seventeen onto
   * every inspection. A 100 ml face cleanser therefore came back declaring it
   * had no Vegetarian / non-vegetarian mark, no genetically modified
   * declaration and no dimensions — three rows of "Not declared" on a document
   * served on a dealer, for three declarations that no rule asks of a
   * cosmetic and that it would be odd to find on one.
   *
   * Worse than untidy: every one of them carried a confidence of zero, which
   * put it under the review threshold, so the inspector's review queue filled
   * with declarations nobody was ever going to check.
   *
   * A record survives if a rule asked about it, or if the package carries a
   * value for it — the second because country of origin on a domestic pack,
   * and an ingredient list on a cosmetic, are worth reporting even where no
   * rule in this set turns on them.
   */
  const asked = records.filter(
    (record) => assessed.has(record.field) || record.value !== null,
  );

  return asked.map((record) => ({
    name: record.field,
    label: record.label,
    aiValue: record.value,
    // The schema requires a number here. `0` records "no confidence was
    // reported", and the scan result beside it keeps the distinction between
    // that and a genuine zero.
    confidence: record.confidence ?? 0,
    bbox: record.evidence[0]?.bbox ? [...record.evidence[0].bbox] : undefined,
    sourceImageId: record.evidence[0]?.imageId,
    required: assessed.has(record.field),
  }));
}
