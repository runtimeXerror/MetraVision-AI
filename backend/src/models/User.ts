import bcrypt from 'bcryptjs';
import { Schema, model, type HydratedDocument, type Model } from 'mongoose';

import { USER_ROLES, USER_STATUSES, type UserDTO, type UserRole, type UserStatus } from '../types/domain';

/**
 * Inspector / supervisor / admin account.
 *
 * `passwordHash` carries `select: false`, so it is absent from every query
 * result unless a caller explicitly asks for it. That makes leaking it the
 * exception a reviewer can grep for, rather than the default.
 */

export interface UserAttrs {
  inspectorId: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  status: UserStatus;
  department: string;
  phone?: string;
  zone?: string;
  district?: string;
  state?: string;
  avatarColor?: string;
  lastLoginAt?: Date;
  /** Bumped on logout / password change so existing refresh tokens stop working. */
  tokenVersion: number;
}

export interface UserDocument extends HydratedDocument<UserAttrs> {
  comparePassword(candidate: string): Promise<boolean>;
  toDTO(): UserDTO;
}

interface UserModel extends Model<UserAttrs, Record<string, never>, UserDocument> {
  hashPassword(plain: string): Promise<string>;
}

const userSchema = new Schema<UserAttrs, UserModel, UserDocument>(
  {
    inspectorId: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: 'INSPECTOR', required: true },
    status: { type: String, enum: USER_STATUSES, default: 'ACTIVE', required: true },
    department: { type: String, default: 'Department of Legal Metrology' },
    phone: { type: String, trim: true },
    zone: { type: String, trim: true },
    district: { type: String, trim: true },
    state: { type: String, trim: true },
    avatarColor: { type: String, default: '#1D6FE0' },
    lastLoginAt: { type: Date },
    tokenVersion: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// `email` and `inspectorId` already get unique indexes from the field options.
userSchema.index({ role: 1, status: 1 });

const BCRYPT_ROUNDS = 10;

userSchema.statics.hashPassword = function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
};

userSchema.methods.comparePassword = function comparePassword(candidate: string): Promise<boolean> {
  // `passwordHash` is `select: false`; a caller that forgot `.select('+passwordHash')`
  // would otherwise compare against undefined and always fail confusingly.
  if (!this.passwordHash) {
    throw new Error('comparePassword called on a user loaded without +passwordHash');
  }
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.toDTO = function toDTO(): UserDTO {
  return {
    id: this.id as string,
    inspectorId: this.inspectorId,
    name: this.name,
    email: this.email,
    phone: this.phone,
    role: this.role,
    status: this.status,
    department: this.department,
    zone: this.zone,
    district: this.district,
    state: this.state,
    avatarColor: this.avatarColor,
    lastLoginAt: this.lastLoginAt?.toISOString(),
    createdAt: (this.get('createdAt') as Date).toISOString(),
    updatedAt: (this.get('updatedAt') as Date).toISOString(),
  };
};

export const User = model<UserAttrs, UserModel>('User', userSchema);
