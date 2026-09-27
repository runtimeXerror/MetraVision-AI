import { randomBytes } from 'node:crypto';

import type { Request, Response } from 'express';

import { User } from '../models/User';
import { revokeAllSessions } from '../services/authService';
import type { UserRole } from '../types/domain';
import { ApiError } from '../utils/ApiError';
import { inspectorBadge, nextSequence } from '../utils/referenceId';
import { created, ok } from '../utils/respond';

/** Inspector profile. */

export async function getProfile(req: Request, res: Response): Promise<Response> {
  const user = await User.findById(req.user!.id);
  if (!user) throw ApiError.unauthorized('This account no longer exists. Sign in again.', 'ACCOUNT_NOT_FOUND');

  return ok(res, user.toDTO());
}

export async function updateProfile(req: Request, res: Response): Promise<Response> {
  const updates = req.body as Record<string, string>;

  /**
   * Only these fields are writable by their owner. Role, status, email and
   * inspectorId are administrative — accepting `req.body` wholesale here would
   * let an inspector promote themselves.
   */
  const allowed = ['name', 'phone', 'zone', 'district', 'state', 'avatarColor'] as const;
  const patch: Record<string, string> = {};
  for (const key of allowed) {
    if (updates[key] !== undefined) patch[key] = updates[key];
  }

  const user = await User.findByIdAndUpdate(req.user!.id, { $set: patch }, { new: true, runValidators: true });
  if (!user) throw ApiError.unauthorized('This account no longer exists. Sign in again.', 'ACCOUNT_NOT_FOUND');

  return ok(res, user.toDTO(), 'Profile updated successfully');
}

export async function changePassword(req: Request, res: Response): Promise<Response> {
  const { currentPassword, newPassword } = req.body as {
    currentPassword: string;
    newPassword: string;
  };

  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('This account no longer exists. Sign in again.', 'ACCOUNT_NOT_FOUND');

  const matches = await user.comparePassword(currentPassword);
  if (!matches) {
    throw ApiError.unauthorized('Your current password is incorrect.', 'INVALID_CREDENTIALS');
  }

  user.passwordHash = await User.hashPassword(newPassword);
  await user.save();

  // Every existing session is invalidated: a password change is usually a
  // response to a suspected compromise, so old tokens must stop working.
  await revokeAllSessions(user.id as string);

  return ok(res, { changed: true }, 'Password changed. Sign in again on your other devices.');
}

/** Roster, for supervisors and admins. */
export async function listUsers(_req: Request, res: Response): Promise<Response> {
  const users = await User.find().sort({ role: -1, name: 1 });
  return ok(res, users.map((user) => user.toDTO()));
}

/* ── Enrolling an officer ─────────────────────────────────────────────────── */

/**
 * The alphabet a temporary password is drawn from.
 *
 * `0/O`, `1/l/I` and `5/S` are left out. This credential is going to be read
 * off a screen and typed on a phone in a shop, and a password that cannot be
 * transcribed reliably becomes a support call on the officer's first day.
 */
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZabcdefghijkmnpqrtuvwxyz23467892346789';

function temporaryPassword(length = 12): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += SAFE_ALPHABET[bytes[i]! % SAFE_ALPHABET.length];
  }
  return out;
}

/**
 * `POST /api/users` — an administrator enrols an officer.
 *
 * Distinct from `/auth/register`, which is self-service and can only ever mint
 * an inspector. This is the administrative act: the department decides who
 * holds a badge, so the caller must be an ADMIN and may set the role.
 *
 * ── THE CREDENTIAL IS RETURNED ONCE ────────────────────────────────────────
 *
 * The badge number and a temporary password are generated here rather than
 * typed by the administrator — an account whose password was chosen by someone
 * other than its holder should at least not be guessable by them.
 *
 * Delivering it by email is the intended path and is not built yet, so the
 * password is returned in this one response for the administrator to hand over,
 * and is never retrievable again: only its hash is stored. When mail exists,
 * the change is to send it from here and stop returning it — the rest of this
 * function stays as it is.
 */
export async function createInspector(req: Request, res: Response): Promise<Response> {
  const { name, email, role, phone, zone, district, state } = req.body as {
    name: string;
    email: string;
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

  const assignedRole: UserRole = role ?? 'INSPECTOR';
  const sequence = await nextSequence(`user:${assignedRole}`);
  const password = temporaryPassword();

  const user = await User.create({
    inspectorId: inspectorBadge(assignedRole, 4000 + sequence),
    name,
    email,
    passwordHash: await User.hashPassword(password),
    role: assignedRole,
    status: 'ACTIVE',
    department: 'Department of Legal Metrology',
    phone,
    zone,
    district,
    state,
  });

  return created(res, {
    user: user.toDTO(),
    // Read it now or lose it. Said plainly so the caller does not close the
    // dialog expecting to find it on the officer's record later.
    temporaryPassword: password,
    delivery: 'NOT_SENT',
  }, 'Officer enrolled. Hand over the credentials shown — they are not stored.');
}
