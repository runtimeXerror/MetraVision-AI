/**
 * ── THE VERSIONED LEGAL CORPUS ──────────────────────────────────────────────
 *
 * A `LegalRule` record is **one version of one requirement**, not a rule.
 *
 * That distinction is the whole point of this module. The Legal Metrology
 * (Packaged Commodities) Rules, 2011 have been amended thirty-odd times; a
 * requirement such as "declare the unit sale price" has existed in three
 * materially different forms since 2021, and an inspection carried out in
 * March 2023 must be judged against the form that was in force in March 2023 —
 * not against the form in force when the report is read.
 *
 * So `ruleId` is the *identity* of a requirement and is stable across
 * amendments; `ruleVersion` distinguishes the successive texts of it. Exactly
 * one version of a `ruleId` may be in force on any given date, and
 * `VersionResolver` picks it by date alone.
 *
 * Nothing here is authoritative law. `legalText` is a transcription of the
 * official Gazette notification; `machineInterpretation` is this system's
 * reading of it, and is explicitly marked as such — see `interpretationStatus`.
 * ────────────────────────────────────────────────────────────────────────────
 */

/* ── Conditions ───────────────────────────────────────────────────────────── */

export const COMPARISON_OPERATORS = [
  'equals',
  'notEquals',
  'contains',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
  'regex',
] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

export const MEMBERSHIP_OPERATORS = ['in', 'notIn'] as const;
export type MembershipOperator = (typeof MEMBERSHIP_OPERATORS)[number];

export const PRESENCE_OPERATORS = ['exists', 'notExists'] as const;
export type PresenceOperator = (typeof PRESENCE_OPERATORS)[number];

export const GROUP_OPERATORS = ['all', 'any', 'not'] as const;
export type GroupOperator = (typeof GROUP_OPERATORS)[number];

/** A value a condition may be compared against. Deliberately not `unknown`. */
export type ConditionValue = string | number | boolean | null;

/**
 * A declarative condition.
 *
 * Stored in the database and therefore **never executed as code**: there is no
 * expression string, no function body, no `eval`. `ConditionEvaluator` walks
 * this tree and nothing else, so a compromised rule record cannot become
 * remote code execution.
 */
export type RuleCondition =
  | { op: 'always' }
  | { op: 'never' }
  | { op: ComparisonOperator; path: string; value: ConditionValue }
  | { op: MembershipOperator; path: string; values: ConditionValue[] }
  | { op: PresenceOperator; path: string }
  | { op: 'all' | 'any'; conditions: RuleCondition[] }
  | { op: 'not'; condition: RuleCondition };

/* ── Validation ───────────────────────────────────────────────────────────── */

export const VALIDATION_KINDS = [
  'required',
  'presence',
  'textFormat',
  'numeric',
  'unit',
  'date',
  'currency',
  'regex',
  'range',
  'enum',
  'crossField',
  /**
   * The three below need measurements only computer vision can supply. They are
   * declared now so the corpus is complete and the engine is ready to consume
   * the evidence, but with no CV in this phase they resolve to
   * INSUFFICIENT_EVIDENCE rather than to a finding. See `evidenceValidator`.
   */
  'placement',
  'fontSize',
  'readability',
] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];

export interface ValidationSpecBase {
  kind: ValidationKind;
  /** Shown to the inspector as "what the provision expects". */
  expectation: string;
}

export interface RequiredValidation extends ValidationSpecBase {
  kind: 'required' | 'presence';
}

export interface TextFormatValidation extends ValidationSpecBase {
  kind: 'textFormat' | 'regex';
  pattern: string;
  /** Applied to `new RegExp(pattern, flags)`. `g` is rejected — it is stateful. */
  flags?: string;
  /** Sub-strings that must all appear (case-insensitive), e.g. "inclusive of all taxes". */
  mustContainAll?: string[];
  /** Any one of these must appear, e.g. "MRP" or "Maximum Retail Price". */
  mustContainAny?: string[];
}

export interface NumericValidation extends ValidationSpecBase {
  kind: 'numeric' | 'range';
  min?: number;
  max?: number;
  integerOnly?: boolean;
  /** Maximum decimal places, e.g. 2 for a rupee amount. */
  maxDecimals?: number;
}

export interface UnitValidation extends ValidationSpecBase {
  kind: 'unit';
  /** Canonical unit symbols the declaration may use. */
  allowedUnits: string[];
  /** When set, a bare number with no unit fails rather than being indeterminate. */
  unitRequired: boolean;
}

export interface DateValidation extends ValidationSpecBase {
  kind: 'date';
  /** Accepted shapes, e.g. `MM/YYYY`, `MMM YYYY`, `DD/MM/YYYY`. */
  formats: string[];
  /** The declaration may not name a month later than the inspection month. */
  notInFuture?: boolean;
}

export interface CurrencyValidation extends ValidationSpecBase {
  kind: 'currency';
  currency: 'INR';
  mustContainAny?: string[];
  maxDecimals?: number;
}

export interface EnumValidation extends ValidationSpecBase {
  kind: 'enum';
  allowed: string[];
  caseSensitive?: boolean;
}

export interface CrossFieldValidation extends ValidationSpecBase {
  kind: 'crossField';
  /** Every field named here must be present for the check to be conclusive. */
  requires: string[];
  /**
   * The relation asserted between them. Only these three are implemented;
   * anything else would be an invented legal requirement.
   */
  relation: 'allPresentTogether' | 'anyPresent' | 'consistentUnits';
}

export interface EvidenceValidation extends ValidationSpecBase {
  kind: 'placement' | 'fontSize' | 'readability';
  /**
   * The measurement the future CV service must supply on the field's evidence,
   * e.g. `heightMm` for a font-size rule. Recorded now so the contract is
   * fixed before anything implements it.
   */
  requiresMeasurement: string;
  /** For `fontSize`: minimum height in millimetres, where the corpus states one. */
  minimumMm?: number;
  /** For `placement`: the panel the declaration must appear on. */
  panel?: 'PRINCIPAL_DISPLAY_PANEL' | 'ANY_FACE';
}

export type ValidationSpec =
  | RequiredValidation
  | TextFormatValidation
  | NumericValidation
  | UnitValidation
  | DateValidation
  | CurrencyValidation
  | EnumValidation
  | CrossFieldValidation
  | EvidenceValidation;

/* ── Sourcing and interpretation ──────────────────────────────────────────── */

export const SOURCE_VERIFICATION_STATUSES = [
  /** The official Gazette PDF was retrieved and the text read from it. */
  'VERIFIED',
  /**
   * The provision's existence and effect are established by another official
   * document that cites it, but the notification itself could not be retrieved.
   */
  'PARTIALLY_VERIFIED',
  /** Recorded from a secondary source, or not yet checked. Do not rely on it. */
  'NEEDS_VERIFICATION',
] as const;
export type SourceVerificationStatus = (typeof SOURCE_VERIFICATION_STATUSES)[number];

export interface RuleSource {
  authority: string;
  /** e.g. `G.S.R. 202(E)`. */
  notification: string;
  /** ISO date the notification is dated. */
  notificationDate: string;
  /** ISO date the Gazette carrying it was published, where it differs. */
  publicationDate?: string;
  officialUrl?: string;
  verificationStatus: SourceVerificationStatus;
  /** Why the status is not VERIFIED, when it is not. */
  verificationNote?: string;
}

export const INTERPRETATION_STATUSES = [
  /** A domain reviewer has read the legal text against the interpretation. */
  'REVIEWED',
  /** Written from the legal text but not yet reviewed. */
  'DRAFT',
  /** The provision is ambiguous or depends on another instrument. */
  'NEEDS_LEGAL_REVIEW',
] as const;
export type InterpretationStatus = (typeof INTERPRETATION_STATUSES)[number];

/* ── Rule lifecycle ───────────────────────────────────────────────────────── */

/**
 * The record's own standing in the corpus — deliberately independent of any
 * query date.
 *
 * Whether a rule applies to a given inspection is decided by comparing dates
 * (`VersionResolver`), never by reading this field. Keeping the two separate is
 * what lets `RuleSetValidator` catch the contradiction the prompt warns about:
 * a record marked ACTIVE whose window closed in the past, or one whose window
 * has not opened yet.
 */
export const RULE_LIFECYCLE_STATUSES = [
  /** The operative text from `effectiveFrom` until `effectiveTo` (may be future). */
  'ACTIVE',
  /** Replaced by a later version of the same `ruleId`. */
  'SUPERSEDED',
  /** The provision was deleted by amendment and nothing replaced it. */
  'OMITTED',
  /** Drafted but not law. Never selected by the resolver. */
  'DRAFT',
] as const;
export type RuleLifecycleStatus = (typeof RULE_LIFECYCLE_STATUSES)[number];

/** How a rule stands *relative to a particular date*. Derived, never stored. */
export const RULE_TEMPORAL_STATUSES = ['IN_FORCE', 'FUTURE_EFFECTIVE', 'EXPIRED', 'NOT_LAW'] as const;
export type RuleTemporalStatus = (typeof RULE_TEMPORAL_STATUSES)[number];

export const RULE_CATEGORIES = [
  'DECLARATION',
  'TYPOGRAPHY',
  'PLACEMENT',
  'PRICING',
  'QUANTITY',
  'E_COMMERCE',
  'REGISTRATION',
  'DEFINITION',
  'PROCEDURAL',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

export const RULE_SEVERITIES = ['CRITICAL', 'MAJOR', 'MINOR'] as const;
export type RuleSeverity = (typeof RULE_SEVERITIES)[number];

/* ── The rule record ──────────────────────────────────────────────────────── */

export interface LegalRule {
  /** Stable identity of the requirement across all its amendments. */
  ruleId: string;
  /**
   * Distinguishes successive texts of the same `ruleId`. Uses the ISO date the
   * version came into force, which makes the chain readable at a glance
   * (`LM-PC-R6-1-E@2011-04-01` → `@2018-01-01` → `@2022-01-01`).
   */
  ruleVersion: string;

  /** `Rule 6`. */
  sourceRule: string;
  /** `6(1)`, where the provision has one. */
  sourceSubRule?: string;
  /** `6(1)(e)`, where the provision has one. */
  sourceClause?: string;

  /** The extracted-evidence key this rule is checked against, e.g. `mrp`. */
  field?: string;
  fieldLabel?: string;

  title: string;
  /** One-line statement of the obligation, for lists and summaries. */
  requirement: string;

  /**
   * Verbatim transcription of the operative words of the provision as amended.
   * Never paraphrased, never strengthened. Where the version was produced by an
   * amendment, this is the text as it reads *after* that amendment.
   */
  legalText: string;
  /**
   * What this system actually checks. This is an implementation reading of the
   * legal text and is **not legally authoritative** — it is narrower than the
   * provision wherever the provision needs judgement or a measurement the
   * system cannot take.
   */
  machineInterpretation: string;
  interpretationStatus: InterpretationStatus;

  category: RuleCategory;
  severity: RuleSeverity;

  /** Which products and contexts this rule reaches. */
  applicability: RuleCondition;
  /** Further gating evaluated against the evidence itself, not the context. */
  conditions?: RuleCondition;
  validation: ValidationSpec;

  /** Exception identifiers that can switch this rule off. */
  exceptions: string[];

  /** Inclusive. */
  effectiveFrom: string;
  /** Exclusive — the date the next version takes over. `null` while in force. */
  effectiveTo: string | null;
  status: RuleLifecycleStatus;

  source: RuleSource;
  /** `ruleVersion` of the version this one replaced. */
  supersedes?: string;
  /** `ruleVersion` of the version that replaced this one. */
  supersededBy?: string;

  /**
   * Another instrument this provision hands off to, e.g. the Medical Devices
   * Rules, 2017 for packages containing medical devices. The engine refuses to
   * apply its own typography checks where a cross-reference redirects them.
   */
  crossRegulation?: {
    instrument: string;
    reason: string;
  };

  notes?: string;
}

/* ── Exceptions ───────────────────────────────────────────────────────────── */

export const EXCEPTION_EFFECTS = [
  /** The rule does not reach this package at all. */
  'NOT_APPLICABLE',
  /** The obligation is relaxed but a residual set of declarations survives. */
  'PARTIAL_EXEMPTION',
  /** Another instrument supplies the requirement instead of this one. */
  'DEFER_TO_OTHER_REGULATION',
] as const;
export type ExceptionEffect = (typeof EXCEPTION_EFFECTS)[number];

/**
 * An exemption, carve-out or cross-reference.
 *
 * Kept as records rather than as branches inside the engine. A carve-out such
 * as "this exemption shall not apply to pan masala" is a legal fact with its
 * own notification and its own commencement date; buried in an `if`, it would
 * have neither, and no one could tell when it started to bite.
 */
export interface RuleException {
  exceptionId: string;
  /** Rules this exception can switch off. Empty means every rule in `scope`. */
  ruleIds: string[];
  /** Broad scope, applied when `ruleIds` is empty. */
  scope?: { category?: RuleCategory; sourceRule?: string };

  title: string;
  legalText: string;
  machineInterpretation: string;
  interpretationStatus: InterpretationStatus;

  condition: RuleCondition;
  effect: ExceptionEffect;
  /** For PARTIAL_EXEMPTION: the declarations that survive the exemption. */
  survivingRequirements?: string[];
  /** For DEFER_TO_OTHER_REGULATION: the instrument that takes over. */
  deferTo?: string;

  effectiveFrom: string;
  effectiveTo: string | null;
  status: RuleLifecycleStatus;
  source: RuleSource;
  supersedes?: string;
  supersededBy?: string;
}

/* ── The corpus as loaded ─────────────────────────────────────────────────── */

export interface RuleSetMetadata {
  /** e.g. `LM-PC-2026-05-29`. Derived from the latest notification in the set. */
  ruleSetVersion: string;
  /** Content hash — two sets with the same version but different text differ here. */
  checksum: string;
  /** Where the records were read from. */
  origin: 'BUILT_IN' | 'DATABASE';
  ruleCount: number;
  exceptionCount: number;
  amendmentCount: number;
  builtAt: string;
}
