import type { Response } from 'express';

import type { PaginationMeta } from '../types/domain';

/**
 * The success envelope, matching the contract in docs/api.md:
 *
 *   { "success": true, "data": {...}, "message": "..." }
 *
 * Every controller returns through here, so the shape can never drift between
 * endpoints — which is what lets the mobile client unwrap responses in one
 * place rather than per call site.
 */
export function ok<T>(res: Response, data: T, message?: string, statusCode = 200): Response {
  return res.status(statusCode).json({
    success: true,
    data,
    ...(message ? { message } : {}),
  });
}

export function created<T>(res: Response, data: T, message?: string): Response {
  return ok(res, data, message, 201);
}

/** Paginated list response — `meta` carries the page window. */
export function paginated<T>(
  res: Response,
  items: T[],
  meta: PaginationMeta,
  message?: string,
): Response {
  return res.status(200).json({
    success: true,
    data: { items, ...meta },
    meta,
    ...(message ? { message } : {}),
  });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}
