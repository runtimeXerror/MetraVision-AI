import { z } from 'zod';

import {
  IMAGE_TYPES,
  INSPECTION_STATUSES,
  PRODUCT_CATEGORIES,
  REVIEW_ACTIONS,
  SEVERITIES,
  USER_ROLES,
  VIOLATION_CATEGORIES,
} from '../types/domain';
import { RULE_STATUSES, VALIDATION_TYPES } from '../types/rules';

/**
 * Request schemas.
 *
 * Every endpoint validates before a controller runs, so a handler never has to
 * defend against a missing field or a string where a number belongs.
 */

/* ── Primitives ───────────────────────────────────────────────────────────── */

export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Not a valid identifier.');

/** Accepts either a Mongo id or a human reference such as `INS-2026-00001`. */
export const inspectionIdParam = z.object({
  id: z.union([objectIdSchema, z.string().regex(/^INS-\d{4}-\d{4,6}$/, 'Not a valid inspection ID.')]),
});

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address.');

/**
 * Password policy.
 *
 * Length is the requirement that actually matters; a composition rule pushes
 * people toward predictable substitutions. Eight characters is the floor.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');

/* ── Auth ─────────────────────────────────────────────────────────────────── */

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name is required.').max(120),
  email: emailSchema,
  password: passwordSchema,
  role: z.enum(USER_ROLES).optional(),
  phone: z.string().trim().max(20).optional(),
  zone: z.string().trim().max(80).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});

export const loginSchema = z.object({
  /** Email address or inspector ID — the endpoint accepts either. */
  identifier: z.string().trim().min(3, 'Enter your email address or Inspector ID.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'A refresh token is required.'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(10).optional(),
});

/* ── Users ────────────────────────────────────────────────────────────────── */

export const updateProfileSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    phone: z.string().trim().max(20).optional(),
    zone: z.string().trim().max(80).optional(),
    district: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    avatarColor: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Use a hex colour such as #1D6FE0.')
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password.'),
  newPassword: passwordSchema,
});

/* ── Inspections ──────────────────────────────────────────────────────────── */

/**
 * Indian PIN code: six digits, never starting at zero.
 *
 * Validated rather than accepted as free text because it is what the district
 * and state reports are reconciled against, and a five-digit typo silently
 * groups an inspection under nothing. Optional everywhere — an inspector in a
 * market with no signal may have no reverse-geocode to fill it from, and
 * refusing an inspection over a postcode would be absurd.
 */
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a six-digit PIN code.');

export const createInspectionSchema = z.object({
  business: z.object({
    name: z.string().trim().min(2, 'Business or shop name is required.').max(160),
    ownerName: z.string().trim().max(120).optional(),
    contact: z.string().trim().max(60).optional(),
  }),
  location: z.object({
    address: z.string().trim().min(3, 'Location is required.').max(300),
    district: z.string().trim().max(80).optional(),
    state: z.string().trim().max(80).optional(),
    pincode: pincodeSchema.optional(),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    accuracyM: z.coerce.number().min(0).max(100000).optional(),
  }),
  productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
  productName: z.string().trim().max(160).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const updateInspectionSchema = z
  .object({
    business: z
      .object({
        name: z.string().trim().min(2).max(160).optional(),
        ownerName: z.string().trim().max(120).optional(),
        contact: z.string().trim().max(60).optional(),
      })
      .optional(),
    location: z
      .object({
        address: z.string().trim().min(3).max(300).optional(),
        district: z.string().trim().max(80).optional(),
        state: z.string().trim().max(80).optional(),
        pincode: pincodeSchema.optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        accuracyM: z.coerce.number().min(0).max(100000).optional(),
      })
      .optional(),
    productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
    productName: z.string().trim().max(160).optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export const listInspectionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  status: z.union([z.enum(INSPECTION_STATUSES), z.literal('ALL')]).optional(),
  productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  /** ISO dates, inclusive. */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** Supervisors and admins only; ignored for inspectors. */
  inspectorId: objectIdSchema.optional(),
  sort: z.enum(['newest', 'oldest', 'score']).default('newest'),
});

export type ListInspectionsQuery = z.infer<typeof listInspectionsQuerySchema>;

export const finalizeSchema = z.object({
  finalNotes: z.string().trim().max(4000).optional(),
});

export const analyzeSchema = z.object({
  categoryHint: z.enum(PRODUCT_CATEGORIES).optional(),
});

/* ── Images ───────────────────────────────────────────────────────────────── */

export const uploadImageSchema = z.object({
  type: z.enum(IMAGE_TYPES).default('FRONT'),
});

export const imageIdParam = z.object({
  id: z.string(),
  imageId: z.string().min(3),
});

/* ── Review ───────────────────────────────────────────────────────────────── */

export const reviewSchema = z
  .object({
    /** Machine key of the field being decided, e.g. `net_quantity`. */
    fieldName: z.string().trim().min(1, 'The field name is required.'),
    action: z.enum(REVIEW_ACTIONS),
    /** Required when the action is EDITED. */
    value: z.string().trim().max(500).nullable().optional(),
    comment: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) => data.action !== 'EDITED' || (data.value !== null && data.value !== undefined && data.value.length > 0),
    { message: 'A corrected value is required when editing a field.', path: ['value'] },
  );

export const bulkReviewSchema = z.object({
  reviews: z.array(reviewSchema).min(1, 'Provide at least one review decision.').max(40),
});

/* ── Analytics ────────────────────────────────────────────────────────────── */

/**
 * The dashboard's global filter bar.
 *
 * Every analytics endpoint accepts the same shape, so a filter set once on the
 * overview page means the same thing to each chart it drives.
 */
export const analyticsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  status: z.union([z.enum(INSPECTION_STATUSES), z.literal('ALL')]).optional(),
  /** Supervisors and admins only; ignored for an inspector. */
  inspectorId: objectIdSchema.optional(),
  /**
   * Trend window when no explicit range is given.
   *
   * `0` means all time — the trend then runs from the earliest record the
   * caller can see. Values between 1 and 6 are rejected rather than clamped: a
   * chart of three days is a chart of three columns, and silently widening it
   * to a week would report a window the caller did not ask for.
   */
  days: z.coerce
    .number()
    .int()
    .min(0)
    .max(365)
    .default(30)
    .refine((value) => value === 0 || value >= 7, {
      message: 'days must be 0 (all time) or between 7 and 365.',
    }),
});

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/* ── Violations ───────────────────────────────────────────────────────────── */

export const listViolationsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  severity: z.enum(SEVERITIES).optional(),
  category: z.enum(VIOLATION_CATEGORIES).optional(),
  status: z.enum(['OPEN', 'RESOLVED']).optional(),
  productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
  inspectorId: objectIdSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type ListViolationsQuery = z.infer<typeof listViolationsQuerySchema>;

/* ── Products ─────────────────────────────────────────────────────────────── */

export const listProductsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().max(160).optional(),
  productCategory: z.enum(PRODUCT_CATEGORIES).optional(),
  inspectorId: objectIdSchema.optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
});

export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;

/* ── Rules ────────────────────────────────────────────────────────────────── */

export const listRulesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(160).optional(),
  status: z.union([z.enum(RULE_STATUSES), z.literal('ALL')]).optional(),
  category: z.string().trim().max(80).optional(),
  field: z.string().trim().max(80).optional(),
  validationType: z.enum(VALIDATION_TYPES).optional(),
});

export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;

const ruleParameters = z.record(z.unknown()).default({});

export const createRuleSchema = z.object({
  ruleId: z
    .string()
    .trim()
    .min(3, 'A rule identifier is required.')
    .max(40)
    .regex(/^[A-Za-z0-9-]+$/, 'Use letters, digits and hyphens only.'),
  category: z.string().trim().min(2).max(80),
  field: z.string().trim().min(2).max(80),
  fieldLabel: z.string().trim().min(2).max(120),
  title: z.string().trim().min(3).max(200),
  requirement: z.string().trim().min(5, 'State what the rule requires.').max(2000),
  validationType: z.enum(VALIDATION_TYPES).default('PRESENCE'),
  parameters: ruleParameters,
  ruleReference: z.string().trim().min(2).max(120),
  source: z.string().trim().max(240).optional(),
  severity: z.enum(SEVERITIES).default('MAJOR'),
  effectiveFrom: z.string().datetime({ offset: true }),
  effectiveTo: z.string().datetime({ offset: true }).optional(),
  status: z.enum(RULE_STATUSES).default('ACTIVE'),
  appliesToCategories: z.array(z.enum(PRODUCT_CATEGORIES)).default([]),
});

export type CreateRuleBody = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z
  .object({
    title: z.string().trim().min(3).max(200).optional(),
    fieldLabel: z.string().trim().min(2).max(120).optional(),
    requirement: z.string().trim().min(5).max(2000).optional(),
    validationType: z.enum(VALIDATION_TYPES).optional(),
    parameters: z.record(z.unknown()).optional(),
    ruleReference: z.string().trim().min(2).max(120).optional(),
    source: z.string().trim().max(240).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(RULE_STATUSES).optional(),
    effectiveFrom: z.string().datetime({ offset: true }).optional(),
    effectiveTo: z.string().datetime({ offset: true }).nullable().optional(),
    appliesToCategories: z.array(z.enum(PRODUCT_CATEGORIES)).optional(),
    /** Recorded against the outgoing version when the change is substantive. */
    changeNote: z.string().trim().max(1000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

export type UpdateRuleBody = z.infer<typeof updateRuleSchema>;

export const ruleStatusSchema = z.object({
  status: z.enum(RULE_STATUSES),
});
