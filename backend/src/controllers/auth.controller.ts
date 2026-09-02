import type { Request, Response } from 'express';

import { User } from '../models/User';
import {
  createSession,
  revokeAllSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  verifyCredentials,
} from '../services/authService';
import { ApiError } from '../utils/ApiError';
import { created, ok } from '../utils/respond';
import { inspectorBadge, nextSequence } from '../utils/referenceId';
import type { UserRole } from '../types/domain';

/**
 * Authentication endpoints.
 *
 * The controller does no crypto and no token handling of its own — all of that
 * lives in `services/authService.ts`, so there is exactly one implementation of
 * how a session is issued and revoked.
 */

export async function register(req: Request, res: Response): Promise<Response> {
  const { name, email, password, role, phone, zone, district, state } = req.body as {
    name: string;
    email: string;
    password: string;
    role?: UserRole;
    phone?: string;
    zone?: string;
    district?: string;
    state?: string;
  };

  const existing = await User.findOne({ email });
  if (existing) {
    throw ApiError.conflict('An account already exists for that email address.', 'EMAIL_IN_USE');
  }

  /**
   * Self-registration always creates an INSPECTOR. Elevating a role is an
   * administrative act, not something a request body can ask for — otherwise
   * anyone could mint themselves an admin account.
   */
  const requestedRole: UserRole = 'INSPECTOR';
  if (role && role !== 'INSPECTOR') {
    throw ApiError.forbidden('Supervisor and administrator accounts are created by an administrator.');
  }

  const sequence = await nextSequence(`user:${requestedRole}`);

  const user = await User.create({
    inspectorId: inspectorBadge(requestedRole, 4000 + sequence),
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: requestedRole,
    status: 'ACTIVE',
    department: 'Department of Legal Metrology',
    phone,
    zone,
    district,
    state,
    tokenVersion: 0,
  });

  const session = await createSession(user, req.get('user-agent') ?? undefined);
  return created(res, session, 'Account created successfully');
}

export async function login(req: Request, res: Response): Promise<Response> {
  const { identifier, password } = req.body as { identifier: string; password: string };

  const user = await verifyCredentials(identifier, password);

  user.lastLoginAt = new Date();
  await user.save();

  const session = await createSession(user, req.get('user-agent') ?? undefined);
  return ok(res, session, 'Signed in successfully');
}

export async function refresh(req: Request, res: Response): Promise<Response> {
  const { refreshToken } = req.body as { refreshToken: string };
  const session = await rotateRefreshToken(refreshToken, req.get('user-agent') ?? undefined);
  return ok(res, session, 'Session refreshed');
}

export async function logout(req: Request, res: Response): Promise<Response> {
  const { refreshToken } = req.body as { refreshToken?: string };

  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  } else if (req.user) {
    // No token supplied — revoke every session for the caller instead, so a
    // logout can never silently leave a usable refresh token behind.
    await revokeAllSessions(req.user.id);
  }

  return ok(res, { loggedOut: true }, 'Signed out successfully');
}

export async function me(req: Request, res: Response): Promise<Response> {
  const user = await User.findById(req.user!.id);
  // A token that names an account which no longer exists is an authentication
  // failure, not a missing resource. Returning 404 leaves a client holding a
  // token it believes is good, showing a signed-in shell around an empty
  // profile; 401 lets it clear the session and route to sign-in.
  if (!user) {
    throw ApiError.unauthorized('This account no longer exists. Sign in again.', 'ACCOUNT_NOT_FOUND');
  }

  return ok(res, user.toDTO());
}
