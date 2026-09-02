import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import type { RuleConflict as RuleConflictDTO } from '../compliance/types/RuleConflict';
import { CONFLICT_CODES, CONFLICT_ORIGINS, CONFLICT_SEVERITIES } from '../compliance/types/RuleConflict';
import { SOURCE_VERIFICATION_STATUSES } from '../compliance/types/Rule';

/**
 * Recorded disagreements between official documents.
 *
 * Only `SOURCE` conflicts are stored. Structural ones — overlapping versions,
 * broken chains — are computed from the corpus every time the validation report
 * is requested, because a stored copy of a defect is a defect that stays in the
 * report after someone fixes it.
 */

export type RuleConflictAttrs = RuleConflictDTO & { createdAt: Date; updatedAt: Date };
export type RuleConflictDocument = HydratedDocument<RuleConflictAttrs>;

const documentSchema = new Schema(
  {
    notification: { type: String, required: true },
    url: { type: String },
    says: { type: String, required: true },
  },
  { _id: false },
);

const ruleConflictSchema = new Schema<RuleConflictAttrs, Model<RuleConflictAttrs>>(
  {
    conflictId: { type: String, required: true, unique: true, trim: true },
    origin: { type: String, enum: CONFLICT_ORIGINS, required: true },
    code: { type: String, enum: CONFLICT_CODES, required: true },
    severity: { type: String, enum: CONFLICT_SEVERITIES, required: true },
    message: { type: String, required: true },
    subjects: { type: [String], default: [] },
    documents: { type: [documentSchema], default: undefined },
    interimResolution: { type: String },
    requiresManualVerification: { type: Boolean, required: true },
    verificationStatus: { type: String, enum: SOURCE_VERIFICATION_STATUSES },
  },
  { timestamps: true, minimize: false },
);

ruleConflictSchema.index({ severity: 1 });
ruleConflictSchema.index({ requiresManualVerification: 1 });

export const RuleConflict = model<RuleConflictAttrs>('RuleConflict', ruleConflictSchema, 'rule_conflicts');
