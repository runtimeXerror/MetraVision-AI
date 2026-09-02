import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import type { RuleException as RuleExceptionDTO } from '../compliance/types/Rule';
import {
  EXCEPTION_EFFECTS,
  INTERPRETATION_STATUSES,
  RULE_CATEGORIES,
  RULE_LIFECYCLE_STATUSES,
  SOURCE_VERIFICATION_STATUSES,
} from '../compliance/types/Rule';

/**
 * Exemptions and carve-outs, versioned the same way rules are.
 *
 * `exceptionId` repeats across versions — rule 26(a) has four — so the unique
 * index is on `(exceptionId, effectiveFrom)`. The alternative, one row per
 * exemption, cannot express that a 5 g pan masala sachet was exempt on
 * 31 January 2026 and not on 1 February 2026.
 */

export type RuleExceptionAttrs = RuleExceptionDTO & { createdAt: Date; updatedAt: Date };
export type RuleExceptionDocument = HydratedDocument<RuleExceptionAttrs>;

/** Stored as `Mixed` — see the note in `LegalRule.ts` for why not a sub-schema. */

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

const ruleExceptionSchema = new Schema<RuleExceptionAttrs, Model<RuleExceptionAttrs>>(
  {
    exceptionId: { type: String, required: true, trim: true },
    ruleIds: { type: [String], default: [] },
    scope: {
      type: new Schema(
        { category: { type: String, enum: RULE_CATEGORIES }, sourceRule: { type: String } },
        { _id: false },
      ),
    },

    title: { type: String, required: true },
    legalText: { type: String, required: true },
    machineInterpretation: { type: String, required: true },
    interpretationStatus: { type: String, enum: INTERPRETATION_STATUSES, required: true },

    condition: { type: Schema.Types.Mixed, required: true },
    effect: { type: String, enum: EXCEPTION_EFFECTS, required: true },
    survivingRequirements: { type: [String], default: undefined },
    deferTo: { type: String },

    effectiveFrom: { type: String, required: true },
    effectiveTo: { type: String, default: null },
    status: { type: String, enum: RULE_LIFECYCLE_STATUSES, required: true },
    source: { type: sourceSchema, required: true },
    supersedes: { type: String },
    supersededBy: { type: String },
  },
  { timestamps: true, minimize: false },
);

ruleExceptionSchema.index({ exceptionId: 1, effectiveFrom: 1 }, { unique: true });
ruleExceptionSchema.index({ effectiveFrom: 1, effectiveTo: 1 });
ruleExceptionSchema.index({ effect: 1 });
ruleExceptionSchema.index({ 'source.notification': 1 });

export const RuleException = model<RuleExceptionAttrs>('RuleException', ruleExceptionSchema, 'rule_exceptions');
