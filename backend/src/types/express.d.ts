import type { UserRole } from './domain';

/**
 * Adds the authenticated caller to the request.
 *
 * Populated by `middleware/auth.ts` from the verified access token, so reading
 * `req.user` never costs a database round-trip.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        role: UserRole;
        inspectorId: string;
      };
    }
  }
}

export {};
