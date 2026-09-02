import { z } from 'zod';

/**
 * Validation for `POST /api/inspections/scan`.
 *
 * The request is `multipart/form-data`, so every non-file field arrives as a
 * string. `productContext`, `business` and `location` are therefore accepted as
 * JSON strings and parsed here rather than being flattened into a dozen
 * `productContext[isImported]` form fields — the client sends one object, and
 * the object it sends is the rule engine's own `ProductContext`.
 *
 * `productContext` is `.passthrough()` for the same reason the compliance
 * schema is: a rule condition names a context path, and a new amendment may
 * need a flag no schema anticipated. Stripping unknown keys would mean shipping
 * a code change to add a rule that only needed a data change.
 */

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, 'Use an ISO date, e.g. 2026-09-01.')
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Not a real date.');

/** Parses a JSON-encoded form field, reporting a readable error when it is not JSON. */
function jsonField<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (typeof value !== 'string') return value;
    if (value.trim() === '') return undefined;
    try {
      return JSON.parse(value) as unknown;
    } catch {
      // Surfaced by the inner schema as a type error against the field name,
      // which tells the caller which part of the form was malformed.
      return value;
    }
  }, schema);
}

const productContextSchema = z
  .object({
    category: z.string().trim().max(80).optional(),
    commodityType: z.string().trim().max(120).optional(),
    packageType: z
      .enum(['RETAIL', 'WHOLESALE', 'MULTI_PIECE', 'COMBINATION', 'GROUP', 'INSTITUTIONAL'])
      .optional(),
    isImported: z.boolean().optional(),
    countryOfOrigin: z.string().trim().max(80).optional(),
    isEcommerce: z.boolean().optional(),
    ecommerceModel: z.enum(['MARKETPLACE', 'INVENTORY', 'NONE']).optional(),
    isFoodArticle: z.boolean().optional(),
    isSoldLoose: z.boolean().optional(),
    quantity: z.number().nonnegative().optional(),
    quantityUnit: z.string().trim().max(20).optional(),
    /**
     * Overrides the count-based estimate of how much of the package was
     * captured. A client that knows it photographed every face should say so —
     * it is the number that decides whether a missing declaration can be
     * recorded as a violation rather than sent for review.
     */
    captureCompleteness: z.number().min(0).max(1).optional(),
  })
  .passthrough();

export const scanSchema = z.object({
  inspectionDate: isoDate,
  productContext: jsonField(productContextSchema.optional()),
  business: jsonField(
    z
      .object({
        name: z.string().trim().min(1).max(200),
        ownerName: z.string().trim().max(200).optional(),
        contact: z.string().trim().max(100).optional(),
      })
      .optional(),
  ),
  location: jsonField(
    z
      .object({
        address: z.string().trim().min(1).max(400),
        district: z.string().trim().max(120).optional(),
        state: z.string().trim().max(120).optional(),
        pincode: z.string().trim().regex(/^[1-9][0-9]{5}$/).optional(),
        latitude: z.coerce.number().min(-90).max(90).optional(),
        longitude: z.coerce.number().min(-180).max(180).optional(),
        accuracyM: z.coerce.number().nonnegative().optional(),
      })
      .optional(),
  ),
  notes: z.string().trim().max(2000).optional(),
  /**
   * Pins the mock OCR provider to one fixture, for demos and tests. Rejected
   * outright when a real provider is configured — a scan that says it read a
   * package must have read that package.
   */
  mockFixture: z.string().trim().max(60).optional(),
});

export type ScanBody = z.infer<typeof scanSchema>;

/**
 * `POST /api/inspections/:id/scan` — a JSON body, since the images are already
 * on the record. `inspectionDate` is optional here and defaults to today: the
 * inspection exists, and re-scanning it should not require restating when it
 * was opened.
 */
export const rescanSchema = z.object({
  inspectionDate: isoDate.optional(),
  productContext: productContextSchema.optional(),
  mockFixture: z.string().trim().max(60).optional(),
});

export type RescanBody = z.infer<typeof rescanSchema>;

export const reportQuerySchema = z.object({
  format: z.enum(['json', 'html']).default('json'),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
