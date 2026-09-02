import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { verifyAccessToken } from '../services/authService';
import { ROLE_RANK, type UserRole } from '../types/domain';
import { ApiError } from '../utils/ApiError';

/**
 * Verifies the bearer token and attaches the caller's identity to the request.
 * Claims come straight from the signed token, so authorisation costs no
 * database round-trip.
 */
export const authenticate: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization;

  if (!header?.startsWith('Bearer ')) {
    return next(ApiError.unauthorized('A bearer token is required for this endpoint.'));
  }

  try {
    const payload = verifyAccessToken(header.slice(7).trim());
    req.user = {
      id: payload.sub,
      email: payload.email,
      name: payload.name,
      role: payload.role,
      inspectorId: payload.inspectorId,
    };
    return next();
  } catch (error) {
    return next(error);
  }
};

/** Restricts a route to specific roles. */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(ApiError.forbidden(`This action requires ${roles.join(' or ')} access.`));
    }
    return next();
  };
}

/** Restricts a route to a minimum privilege level. */
export function requireAtLeast(role: UserRole): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) {
      return next(ApiError.forbidden(`This action requires at least ${role} access.`));
    }
    return next();
  };
}

/**
 * True when the caller may act on records they do not own.
 *
 * Inspectors see only their own inspections; supervisors and admins see the
 * whole jurisdiction. Centralised so no controller re-derives it and gets it
 * subtly wrong.
 */
export function canAccessAllInspections(role: UserRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK.SUPERVISOR;
}
