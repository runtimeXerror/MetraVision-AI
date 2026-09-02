import type { Request, Response } from 'express';

import { User } from '../models/User';
import { revokeAllSessions } from '../services/authService';
import { ApiError } from '../utils/ApiError';
import { ok } from '../utils/respond';

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
