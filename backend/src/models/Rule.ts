import { Schema, model, type HydratedDocument, type Model, type Types } from 'mongoose';

import { PRODUCT_CATEGORIES, SEVERITIES } from '../types/domain';
import {
  RULE_STATUSES,
  VALIDATION_TYPES,
  type RuleDTO,
  type RuleStatus,
  type RuleVersionDTO,
  type ValidationType,
} from '../types/rules';

/**
 * The rule repository.
 *
 * Amending a rule does not overwrite it: the outgoing text is pushed onto
 * `history` with the window it was in force for, and `version` increments. An
 * inspection carried out last March was judged against last March's text, and a
 * record that cannot show which text it was judged against is not evidence.
 */

export interface RuleVersionAttrs {
  version: number;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  effectiveFrom: Date;
  effectiveTo?: Date;
  changedBy?: Types.ObjectId;
  changeNote?: string;
  recordedAt: Date;
}

export interface RuleAttrs {
  ruleId: string;
  category: string;
  field: string;
  fieldLabel: string;
  title: string;
  requirement: string;
  validationType: ValidationType;
  parameters: Record<string, unknown>;
  ruleReference: string;
  source: string;
  severity: string;
  version: number;
  effectiveFrom: Date;
  effectiveTo?: Date;
  status: RuleStatus;
  appliesToCategories: string[];
  history: RuleVersionAttrs[];
  createdAt: Date;
  updatedAt: Date;
}

export interface RuleDocument extends HydratedDocument<RuleAttrs> {
  toDTO(): RuleDTO;
}

type RuleModel = Model<RuleAttrs, Record<string, never>, RuleDocument>;

const versionSchema = new Schema<RuleVersionAttrs>(
  {
    version: { type: Number, required: true },
    requirement: { type: String, required: true },
    validationType: { type: String, enum: VALIDATION_TYPES, required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    changeNote: { type: String, trim: true },
    recordedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const ruleSchema = new Schema<RuleAttrs, RuleModel, RuleDocument>(
  {
    ruleId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    category: { type: String, required: true, trim: true },
    field: { type: String, required: true, trim: true },
    fieldLabel: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    requirement: { type: String, required: true, trim: true },
    validationType: { type: String, enum: VALIDATION_TYPES, default: 'PRESENCE', required: true },
    parameters: { type: Schema.Types.Mixed, default: {} },
    ruleReference: { type: String, required: true, trim: true },
    source: {
      type: String,
      default: 'Legal Metrology (Packaged Commodities) Rules, 2011',
      trim: true,
    },
    severity: { type: String, enum: SEVERITIES, default: 'MAJOR' },
    version: { type: Number, default: 1 },
    effectiveFrom: { type: Date, required: true },
    effectiveTo: { type: Date },
    status: { type: String, enum: RULE_STATUSES, default: 'ACTIVE', required: true },
    // An empty list means the rule applies to every category.
    appliesToCategories: {
      type: [String],
      enum: PRODUCT_CATEGORIES,
      default: [],
    },
    history: { type: [versionSchema], default: [] },
  },
  { timestamps: true },
);

ruleSchema.index({ status: 1, category: 1 });
ruleSchema.index({ field: 1 });
ruleSchema.index({ effectiveFrom: -1 });

ruleSchema.methods.toDTO = function toDTO(this: RuleDocument): RuleDTO {
  const history: RuleVersionDTO[] = this.history.map((entry) => ({
    version: entry.version,
    requirement: entry.requirement,
    validationType: entry.validationType,
    parameters: entry.parameters ?? {},
    effectiveFrom: entry.effectiveFrom.toISOString(),
    effectiveTo: entry.effectiveTo?.toISOString(),
    changeNote: entry.changeNote,
    recordedAt: entry.recordedAt.toISOString(),
  }));

  return {
    id: this.id as string,
    ruleId: this.ruleId,
    category: this.category,
    field: this.field,
    fieldLabel: this.fieldLabel,
    title: this.title,
    requirement: this.requirement,
    validationType: this.validationType,
    parameters: this.parameters ?? {},
    ruleReference: this.ruleReference,
    source: this.source,
    severity: this.severity,
    version: this.version,
    effectiveFrom: this.effectiveFrom.toISOString(),
    effectiveTo: this.effectiveTo?.toISOString(),
    status: this.status,
    appliesToCategories: this.appliesToCategories,
    // Newest first — a reader wants the most recent amendment, not the oldest.
    history: history.sort((a, b) => b.version - a.version),
    createdAt: this.createdAt.toISOString(),
    updatedAt: this.updatedAt.toISOString(),
  };
};

export const Rule = model<RuleAttrs, RuleModel>('Rule', ruleSchema);
