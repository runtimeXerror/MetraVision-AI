import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import type { LegalRule as LegalRuleDTO } from '../compliance/types/Rule';
import {
  INTERPRETATION_STATUSES,
  RULE_CATEGORIES,
  RULE_LIFECYCLE_STATUSES,
  RULE_SEVERITIES,
  SOURCE_VERIFICATION_STATUSES,
} from '../compliance/types/Rule';

/**
 * The versioned legal corpus, projected into MongoDB.
 *
 * One document per *version* of a rule, which is why the unique index is on
 * `(ruleId, ruleVersion)` and not on `ruleId` alone — a collection that can
 * hold only one text of rule 6(1)(e) cannot answer what the law was in 2019.
 *
 * The origin of this data is `src/compliance/data/ruleVersions.ts`; see
 * `RuleSetLoader` for why. Nothing writes here except the seeder, and there is
 * no admin mutation route: a legal corpus edited through a web form is a legal
 * corpus with no diff and no reviewer.
 */

export type LegalRuleAttrs = LegalRuleDTO & { createdAt: Date; updatedAt: Date };
export type LegalRuleDocument = HydratedDocument<LegalRuleAttrs>;

/**
 * Condition trees and validation specs are stored as `Mixed`.
 *
 * The obvious alternative — an empty sub-schema with `strict: false` — silently
 * drops every key on write, so a rule's `applicability` comes back as `{}` and
 * the engine finds that no rule reaches any package. It fails as a clean pass
 * rather than as an error, which is the worst way for a compliance system to
 * fail. `Mixed` stores the tree verbatim.
 *
 * The shape is guaranteed by the TypeScript types on the way in and checked by
 * `RuleSetValidator` on the way out, so nothing is lost by Mongoose not
 * policing it.
 */

const sourceSchema = new Schema(
  {
    authority: { type: String, required: true },
    notification: { type: String, required: true, trim: true },
    notificationDate: { type: String, required: true },
    publicationDate: { type: String },
    officialUrl: { type: String },
    verificationStatus: { type: String, enum: SOURCE_VERIFICATION_STATUSES, required: true },
    verificationNote: { type: String },
  },
  { _id: false },
);

const legalRuleSchema = new Schema<LegalRuleAttrs, Model<LegalRuleAttrs>>(
  {
    ruleId: { type: String, required: true, trim: true },
    ruleVersion: { type: String, required: true, trim: true },

    sourceRule: { type: String, required: true, trim: true },
    sourceSubRule: { type: String, trim: true },
    sourceClause: { type: String, trim: true },

    field: { type: String, trim: true },
    fieldLabel: { type: String, trim: true },

    title: { type: String, required: true, trim: true },
    requirement: { type: String, required: true },
    legalText: { type: String, required: true },
    machineInterpretation: { type: String, required: true },
    interpretationStatus: { type: String, enum: INTERPRETATION_STATUSES, required: true },

    category: { type: String, enum: RULE_CATEGORIES, required: true },
    severity: { type: String, enum: RULE_SEVERITIES, required: true },

    applicability: { type: Schema.Types.Mixed, required: true },
    conditions: { type: Schema.Types.Mixed },
    validation: { type: Schema.Types.Mixed, required: true },

    exceptions: { type: [String], default: [] },

    effectiveFrom: { type: String, required: true },
    // `null` means "still in force" and has to be storable as null rather than
    // absent, since the resolver distinguishes the two.
    effectiveTo: { type: String, default: null },
    status: { type: String, enum: RULE_LIFECYCLE_STATUSES, required: true },

    source: { type: sourceSchema, required: true },
    supersedes: { type: String },
    supersededBy: { type: String },
    crossRegulation: {
      type: new Schema({ instrument: { type: String, required: true }, reason: { type: String, required: true } }, { _id: false }),
    },
    notes: { type: String },
  },
  { timestamps: true, minimize: false },
);

// The identity of a rule version. A duplicate here would make version
// resolution ambiguous, so the database refuses it outright.
legalRuleSchema.index({ ruleId: 1, ruleVersion: 1 }, { unique: true });

// The resolver's query: rules in force on a date. Compound so the index can
// serve the `effectiveFrom <= date` half without a collection scan.
legalRuleSchema.index({ effectiveFrom: 1, effectiveTo: 1 });
legalRuleSchema.index({ sourceRule: 1 });
legalRuleSchema.index({ status: 1 });
legalRuleSchema.index({ category: 1 });
legalRuleSchema.index({ field: 1 });
legalRuleSchema.index({ 'source.notification': 1 });

export const LegalRule = model<LegalRuleAttrs>('LegalRule', legalRuleSchema, 'legal_rules');
