import { z } from 'zod';

import { FIELD_EXTRACTION_STATUSES } from '../compliance/types/Evidence';
import { RULE_CATEGORIES, RULE_LIFECYCLE_STATUSES } from '../compliance/types/Rule';

/**
 * Request schemas for the rule engine.
 *
 * Kept apart from `schemas.ts` so the legal layer's contract is readable on its
 * own — this is the shape a future extraction service has to produce, and it
 * should not be buried among login and pagination schemas.
 *
 * The `productContext` schema is `.passthrough()` on purpose. Rule conditions
 * name context paths, and a new amendment may need a flag no schema here
 * anticipated. Stripping unknown keys would mean shipping a code change to add
 * a rule that only needed a data change — which defeats the point of the
 * amendment workflow.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use an ISO date, e.g. 2026-09-01.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date.');

const confidence = z.number().min(0).max(1);

const bboxSchema = z.tuple([z.number(), z.number(), z.number(), z.number()]);

const measurementsSchema = z
  .object({
    heightMm: z.number().nonnegative().optional(),
    widthMm: z.number().nonnegative().optional(),
    principalDisplayPanelAreaCm2: z.number().nonnegative().optional(),
    panel: z.enum(['PRINCIPAL_DISPLAY_PANEL', 'BACK', 'SIDE', 'OTHER']).optional(),
    legibility: confidence.optional(),
  })
  .strict();

const evidenceReferenceSchema = z
  .object({
    imageId: z.string().trim().min(1).max(200),
    bbox: bboxSchema.optional(),
    space: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
    text: z.string().max(2000).optional(),
    confidence: confidence.optional(),
    measurements: measurementsSchema.optional(),
  })
  .strict();

const extractedFieldSchema = z
  .object({
    value: z.union([z.string().max(2000), z.number(), z.null()]),
    confidence: confidence.optional(),
    status: z.enum(FIELD_EXTRACTION_STATUSES).optional(),
    absenceConfidence: confidence.optional(),
    unit: z.string().trim().max(20).optional(),
    evidence: z.array(evidenceReferenceSchema).max(50).optional(),
  })
  .strict();

const productContextSchema = z
  .object({
    category: z.string().trim().max(80).optional(),
    commodityType: z.string().trim().max(120).optional(),
    packageType: z.enum(['RETAIL', 'WHOLESALE', 'MULTI_PIECE', 'COMBINATION', 'GROUP', 'INSTITUTIONAL']).optional(),

    isImported: z.boolean().optional(),
    countryOfOrigin: z.string().trim().max(80).optional(),
    isMedicalDevice: z.boolean().optional(),
    isElectronicProduct: z.boolean().optional(),
    isFoodArticle: z.boolean().optional(),
    isPanMasala: z.boolean().optional(),
    isTobaccoProduct: z.boolean().optional(),
    isGarmentOrHosiery: z.boolean().optional(),
    isAlcoholicBeverage: z.boolean().optional(),
    isGeneticallyModifiedFood: z.boolean().optional(),
    isCosmeticOrToiletry: z.boolean().optional(),
    isAgriculturalFarmProduce: z.boolean().optional(),
    isFastFoodByRestaurant: z.boolean().optional(),
    isDrugFormulation: z.boolean().optional(),

    isEcommerce: z.boolean().optional(),
    ecommerceModel: z.enum(['MARKETPLACE', 'INVENTORY', 'NONE']).optional(),
    isPromotionalGroup: z.boolean().optional(),
    isIndustrialConsumer: z.boolean().optional(),
    isInstitutionalConsumer: z.boolean().optional(),
    isSoldLoose: z.boolean().optional(),

    quantity: z.number().nonnegative().optional(),
    quantityUnit: z.string().trim().max(20).optional(),
    isBaggedBulkCommodity: z.boolean().optional(),
  })
  .passthrough();

const evidenceContextSchema = z
  .object({
    imageIds: z.array(z.string().trim().max(200)).max(50).optional(),
    captureCompleteness: confidence.optional(),
    imageQuality: confidence.optional(),
    facesCaptured: z.array(z.string().trim().max(40)).max(20).optional(),
    extractionEngine: z.string().trim().max(120).optional(),
    extractionEngineVersion: z.string().trim().max(60).optional(),
  })
  .strict();

export const evaluateComplianceSchema = z.object({
  inspectionId: z.string().trim().max(120).optional(),
  inspectionDate: isoDate,
  productContext: productContextSchema.default({}),
  fields: z.record(z.string().trim().min(1).max(80), extractedFieldSchema).default({}),
  evidence: evidenceContextSchema.optional(),
  options: z
    .object({
      includeFutureRules: z.boolean().optional(),
    })
    .strict()
    .optional(),
});

export type EvaluateComplianceBody = z.infer<typeof evaluateComplianceSchema>;

export const listLegalRulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /** Restricts to the versions in force on this date. */
  asOf: isoDate.optional(),
  ruleId: z.string().trim().max(60).optional(),
  sourceRule: z.string().trim().max(40).optional(),
  category: z.enum(RULE_CATEGORIES).optional(),
  status: z.union([z.enum(RULE_LIFECYCLE_STATUSES), z.literal('ALL')]).optional(),
  field: z.string().trim().max(80).optional(),
  notification: z.string().trim().max(40).optional(),
  search: z.string().trim().max(160).optional(),
});

export type ListLegalRulesQuery = z.infer<typeof listLegalRulesQuerySchema>;

/**
 * `GET /api/rules/applicable`.
 *
 * The context arrives as query parameters, so booleans come through as the
 * strings "true"/"false" and have to be coerced explicitly — `z.coerce.boolean`
 * would turn the string "false" into `true`, which is the kind of bug that
 * makes an exemption fire on every package.
 */
const queryBoolean = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1')
  .optional();

export const applicableRulesQuerySchema = z.object({
  inspectionDate: isoDate,
  category: z.string().trim().max(80).optional(),
  commodityType: z.string().trim().max(120).optional(),
  packageType: z.enum(['RETAIL', 'WHOLESALE', 'MULTI_PIECE', 'COMBINATION', 'GROUP', 'INSTITUTIONAL']).optional(),
  isImported: queryBoolean,
  isMedicalDevice: queryBoolean,
  isEcommerce: queryBoolean,
  ecommerceModel: z.enum(['MARKETPLACE', 'INVENTORY', 'NONE']).optional(),
  isPanMasala: queryBoolean,
  isTobaccoProduct: queryBoolean,
  isFoodArticle: queryBoolean,
  isElectronicProduct: queryBoolean,
  isGarmentOrHosiery: queryBoolean,
  isSoldLoose: queryBoolean,
  isPromotionalGroup: queryBoolean,
  isIndustrialConsumer: queryBoolean,
  isInstitutionalConsumer: queryBoolean,
  isAlcoholicBeverage: queryBoolean,
  isCosmeticOrToiletry: queryBoolean,
  isGeneticallyModifiedFood: queryBoolean,
  quantity: z.coerce.number().nonnegative().optional(),
  quantityUnit: z.string().trim().max(20).optional(),
});

export type ApplicableRulesQuery = z.infer<typeof applicableRulesQuerySchema>;

export const listAmendmentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  changeType: z.string().trim().max(40).optional(),
  verified: queryBoolean,
  affectsRule: z.string().trim().max(40).optional(),
  search: z.string().trim().max(160).optional(),
});

export type ListAmendmentsQuery = z.infer<typeof listAmendmentsQuerySchema>;

export const validationReportQuerySchema = z.object({
  asOf: isoDate.optional(),
});

export type ValidationReportQuery = z.infer<typeof validationReportQuerySchema>;

/** `GET /api/rules/legal/:ruleId?asOf=` — same shape, named for the call site. */
export const ruleHistoryQuerySchema = z.object({
  asOf: isoDate.optional(),
});

export type RuleHistoryQuery = z.infer<typeof ruleHistoryQuerySchema>;
