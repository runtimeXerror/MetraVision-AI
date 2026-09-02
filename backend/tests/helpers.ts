import type { Express } from 'express';
import request from 'supertest';

import { createApp } from '../src/app';
import { User, type UserDocument } from '../src/models/User';
import type { UserRole } from '../src/types/domain';

/** Shared fixtures. Keeps each spec focused on what it is actually asserting. */

export const app: Express = createApp();

export const TEST_PASSWORD = 'Inspector@123';

let sequence = 0;

export async function createUser(
  overrides: Partial<{ role: UserRole; email: string; name: string; inspectorId: string }> = {},
): Promise<UserDocument> {
  sequence += 1;

  return User.create({
    inspectorId: overrides.inspectorId ?? `LM-INS-${1000 + sequence}`,
    name: overrides.name ?? `Test Inspector ${sequence}`,
    email: overrides.email ?? `inspector${sequence}@legalmetrology.gov.in`,
    passwordHash: await User.hashPassword(TEST_PASSWORD),
    role: overrides.role ?? 'INSPECTOR',
    status: 'ACTIVE',
    department: 'Department of Legal Metrology',
    tokenVersion: 0,
  });
}

export interface Signed {
  user: UserDocument;
  accessToken: string;
  refreshToken: string;
  /** `Authorization: Bearer …` header value. */
  auth: string;
}

/** Creates a user and signs them in through the real endpoint. */
export async function signIn(
  overrides: Parameters<typeof createUser>[0] = {},
): Promise<Signed> {
  const user = await createUser(overrides);

  const response = await request(app)
    .post('/api/auth/login')
    .send({ identifier: user.email, password: TEST_PASSWORD })
    .expect(200);

  const { accessToken, refreshToken } = response.body.data;
  return { user, accessToken, refreshToken, auth: `Bearer ${accessToken}` };
}

/** Minimal valid PNG, for upload tests. */
export const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100' +
    '05fe02fa0000000049454e44ae426082',
  'hex',
);

export function inspectionPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    business: { name: 'ABC Store' },
    location: { address: 'Demo Location, Pune' },
    productCategory: 'packaged_food',
    notes: 'Initial inspection',
    ...overrides,
  };
}
