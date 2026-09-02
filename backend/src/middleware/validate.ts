import type { Request, RequestHandler } from 'express';
import type { AnyZodObject, ZodTypeAny } from 'zod';

/**
 * Validates and *replaces* the request segment with the parsed result, so
 * downstream handlers receive coerced, typed values rather than raw strings.
 *
 * A rejected parse throws a ZodError, which the error handler renders as a
 * 422 with per-field messages.
 */
export function validateBody(schema: ZodTypeAny): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}

export function validateQuery(schema: AnyZodObject): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return next(result.error);
    // `req.query` has only a getter in Express 5; assigning to a local copy
    // that handlers read keeps this working across both major versions.
    Object.defineProperty(req, 'validatedQuery', { value: result.data, configurable: true });
    next();
  };
}

export function validateParams(schema: AnyZodObject): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return next(result.error);
    next();
  };
}

/**
 * Reads what `validateQuery` stored.
 *
 * Typed against the Express Request rather than a structural shape: Request has
 * no index signature, so a `{ validatedQuery?: unknown }` parameter would never
 * accept one.
 */
export function query<T>(req: Request): T {
  return (req as Request & { validatedQuery?: unknown }).validatedQuery as T;
}
