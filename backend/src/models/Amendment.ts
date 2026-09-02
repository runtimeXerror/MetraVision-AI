import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import type { Amendment as AmendmentDTO } from '../compliance/types/Amendment';
import { AMENDMENT_CHANGE_TYPES } from '../compliance/types/Amendment';
import { SOURCE_VERIFICATION_STATUSES } from '../compliance/types/Rule';

/**
 * The amendment registry.
 *
 * The provenance ledger behind the corpus: one document per Gazette
 * notification, in the order the Gazette issued them. Nothing evaluates against
 * it — but every rule version points at a row here, and `RuleSetValidator`
 * walks `citesPreviousNotification` to prove the chain has no holes.
 */

export type AmendmentAttrs = AmendmentDTO & { createdAt: Date; updatedAt: Date };
export type AmendmentDocument = HydratedDocument<AmendmentAttrs>;

const provisionSchema = new Schema(
  {
    rule: { type: String, required: true },
    provision: { type: String },
    operation: { type: String, enum: ['INSERTED', 'SUBSTITUTED', 'OMITTED', 'RENUMBERED', 'AMENDED'], required: true },
    effect: { type: String, required: true },
    effectiveFromOverride: { type: String },
  },
  { _id: false },
);

const amendmentSchema = new Schema<AmendmentAttrs, Model<AmendmentAttrs>>(
  {
    notificationNumber: { type: String, required: true, unique: true, trim: true },
    notificationDate: { type: String, required: true },
    publicationDate: { type: String },

    title: { type: String, required: true },
    amends: { type: String, enum: ['PRINCIPAL_RULES', 'AMENDMENT_RULES'], required: true },
    amendsNotification: { type: String },

    // Nullable rather than optional: a notification that fixes no commencement
    // date is a different fact from one whose date we failed to record.
    effectiveFrom: { type: String, default: null },
    commencementText: { type: String, required: true },

    affectedRules: { type: [String], default: [] },
    affectedProvisions: { type: [provisionSchema], default: [] },
    changeType: { type: String, enum: AMENDMENT_CHANGE_TYPES, required: true },
    summary: { type: String, required: true },

    officialSourceUrl: { type: String },
    verified: { type: Boolean, required: true },
    verificationStatus: { type: String, enum: SOURCE_VERIFICATION_STATUSES, required: true },
    verificationNote: { type: String },

    citesPreviousNotification: { type: String },
    correctedBy: { type: [String], default: [] },
  },
  { timestamps: true, minimize: false },
);

amendmentSchema.index({ notificationDate: -1 });
amendmentSchema.index({ effectiveFrom: 1 });
amendmentSchema.index({ changeType: 1 });
amendmentSchema.index({ verificationStatus: 1 });

export const Amendment = model<AmendmentAttrs>('Amendment', amendmentSchema, 'amendments');
