import { Schema, model, type Types } from 'mongoose';

/**
 * Issued refresh tokens.
 *
 * Only a SHA-256 hash of the token is stored: a stolen database dump must not
 * yield usable sessions. Rows carry a TTL index so expired tokens are reaped by
 * MongoDB rather than accumulating forever.
 */
export interface RefreshTokenAttrs {
  user: Types.ObjectId;
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  userAgent?: string;
}

const refreshTokenSchema = new Schema<RefreshTokenAttrs>(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
    userAgent: { type: String },
  },
  { timestamps: true },
);

// MongoDB removes the document once `expiresAt` passes.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<RefreshTokenAttrs>('RefreshToken', refreshTokenSchema);
