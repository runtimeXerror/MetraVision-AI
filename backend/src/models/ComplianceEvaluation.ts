import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import type { ComplianceAuditRecord } from '../compliance/types/ComplianceResult';
import { CHECK_STATUSES } from '../compliance/types/ComplianceResult';

/**
 * ── THE AUDIT TRAIL ─────────────────────────────────────────────────────────
 *
 * One document per evaluation, holding enough to reproduce it exactly: the
 * input snapshot, the thresholds in force, the rule-set version and checksum,
 * the engine version, and every check with its provenance.
 *
 * The checksum is the part that is easy to leave out and expensive to add
 * later. A recorded `ruleSetVersion` of `LM-PC-2026-05-29` tells you the corpus
 * was current to the May 2026 notification; it does not tell you whether
 * somebody had corrected a transcription error in rule 6(1)(e) that afternoon.
 * The checksum does, and it is what lets a reviewer say with confidence that a
 * re-run producing a different verdict means the *law* changed rather than the
 * data drifting underneath.
 * ────────────────────────────────────────────────────────────────────────────
 */

export type ComplianceEvaluationAttrs = ComplianceAuditRecord & { createdAt: Date; updatedAt: Date };
export type ComplianceEvaluationDocument = HydratedDocument<ComplianceEvaluationAttrs>;

/**
 * The audit record's payloads are stored as `Mixed`.
 *
 * An audit trail that quietly discards half of what it was given is not an
 * audit trail — and an empty sub-schema does exactly that. See the note in
 * `LegalRule.ts`.
 */

const complianceEvaluationSchema = new Schema<ComplianceEvaluationAttrs, Model<ComplianceEvaluationAttrs>>(
  {
    inspectionId: { type: String, index: true },
    evaluatedAt: { type: String, required: true },
    inspectionDate: { type: String, required: true },

    ruleSetVersion: { type: String, required: true },
    ruleSetChecksum: { type: String, required: true },
    engineVersion: { type: String, required: true },

    applicableRuleIds: { type: [String], default: [] },
    inputSnapshot: { type: Schema.Types.Mixed, required: true },

    decision: { type: String, enum: CHECK_STATUSES, required: true },
    summary: { type: Schema.Types.Mixed, required: true },
    // Arrays of Mixed: the element type is declared with `{}` rather than
    // `Schema.Types.Mixed` because Mongoose's array typings do not accept the
    // Mixed constructor in that position. Both produce a Mixed array at
    // runtime; only this one typechecks.
    checks: { type: [{}], default: [] },
    evidenceReferences: { type: [{}], default: [] },
  },
  { timestamps: true, minimize: false },
);

// The dashboard's query: the latest evaluation of an inspection.
complianceEvaluationSchema.index({ inspectionId: 1, evaluatedAt: -1 });
complianceEvaluationSchema.index({ decision: 1 });
complianceEvaluationSchema.index({ ruleSetVersion: 1 });

export const ComplianceEvaluation = model<ComplianceEvaluationAttrs>(
  'ComplianceEvaluation',
  complianceEvaluationSchema,
  'compliance_evaluations',
);
