import { createHash, randomBytes } from 'node:crypto';

import jwt, { type SignOptions } from 'jsonwebtoken';

import { env } from '../config/env';
import { RefreshToken } from '../models/RefreshToken';
import { User, type UserDocument } from '../models/User';
import type { AuthSessionDTO, AuthTokensDTO, UserRole } from '../types/domain';
import { ApiError } from '../utils/ApiError';

/**
 * Token issue, verification and rotation.
 *
 * Access tokens are short-lived and stateless — authorisation costs no database
 * round-trip. Refresh tokens are long-lived, so they are persisted (hashed) and
 * can be revoked; a stateless refresh token would be impossible to invalidate
 * on logout.
 */

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
  inspectorId: string;
  /** Invalidates outstanding tokens when bumped on the user record. */
  ver: number;
}

interface RefreshTokenPayload {
  sub: string;
  ver: number;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Milliseconds for a `1h` / `30d` style duration string. */
function durationToMs(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration.trim());
  if (!match) throw new Error(`Unsupported duration: ${duration}`);

  const amount = Number(match[1]);
  const unit = match[2] as 's' | 'm' | 'h' | 'd';
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return amount * multipliers[unit];
}

export function signAccessToken(user: UserDocument): string {
  const payload: AccessTokenPayload = {
    sub: user.id as string,
    email: user.email,
    name: user.name,
    role: user.role,
    inspectorId: user.inspectorId,
    ver: user.tokenVersion,
  };

  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_TTL,
  } as SignOptions);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw ApiError.unauthorized('Your session has expired. Sign in again.', 'TOKEN_EXPIRED');
    }
    throw ApiError.unauthorized('The provided token is not valid.', 'TOKEN_INVALID');
  }
}

/** Issues a refresh token and records its hash so it can be revoked later. */
export async function issueRefreshToken(user: UserDocument, userAgent?: string): Promise<string> {
  const payload: RefreshTokenPayload = { sub: user.id as string, ver: user.tokenVersion };

  const token = jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.JWT_REFRESH_TTL,
    jwtid: randomBytes(12).toString('hex'),
  } as SignOptions);

  await RefreshToken.create({
    user: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + durationToMs(env.JWT_REFRESH_TTL)),
    userAgent,
  });

  return token;
}

export function buildTokens(accessToken: string, refreshToken: string): AuthTokensDTO {
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + durationToMs(env.JWT_ACCESS_TTL)).toISOString(),
  };
}

export async function createSession(
  user: UserDocument,
  userAgent?: string,
): Promise<AuthSessionDTO> {
  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user, userAgent);

  return { ...buildTokens(accessToken, refreshToken), user: user.toDTO() };
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * The old token is revoked as part of the exchange (rotation), so a leaked
 * refresh token is usable at most once — and its reuse is detectable.
 */
export async function rotateRefreshToken(
  token: string,
  userAgent?: string,
): Promise<AuthSessionDTO> {
  let payload: RefreshTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
  } catch {
    throw ApiError.unauthorized('Your session has expired. Sign in again.', 'REFRESH_INVALID');
  }

  const stored = await RefreshToken.findOne({ tokenHash: hashToken(token) });

  if (!stored || stored.revokedAt) {
    throw ApiError.unauthorized('This session is no longer valid.', 'REFRESH_REVOKED');
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('This account is not active.', 'ACCOUNT_INACTIVE');
  }

  // A bumped tokenVersion means every token issued before it is void.
  if (user.tokenVersion !== payload.ver) {
    throw ApiError.unauthorized('This session is no longer valid.', 'REFRESH_REVOKED');
  }

  stored.revokedAt = new Date();
  await stored.save();

  return createSession(user, userAgent);
}

/** Revokes one refresh token; used on explicit logout. */
export async function revokeRefreshToken(token: string): Promise<void> {
  await RefreshToken.updateOne(
    { tokenHash: hashToken(token), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
}

/** Revokes every session for a user — password change, suspension, admin action. */
export async function revokeAllSessions(userId: string): Promise<void> {
  await RefreshToken.updateMany(
    { user: userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date() } },
  );
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
}

/**
 * Verifies credentials.
 *
 * Both the unknown-account and the wrong-password paths return the same error,
 * so the endpoint cannot be used to enumerate which inspector IDs exist.
 */
export async function verifyCredentials(
  identifier: string,
  password: string,
): Promise<UserDocument> {
  const needle = identifier.trim().toLowerCase();

  const user = await User.findOne({
    $or: [{ email: needle }, { inspectorId: needle.toUpperCase() }],
  }).select('+passwordHash');

  const invalid = ApiError.unauthorized(
    'Incorrect Inspector ID or password.',
    'INVALID_CREDENTIALS',
  );

  if (!user) throw invalid;

  const matches = await user.comparePassword(password);
  if (!matches) throw invalid;

  if (user.status !== 'ACTIVE') {
    throw ApiError.forbidden('This account is not active. Contact your supervisor.');
  }

  return user;
}
