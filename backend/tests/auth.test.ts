import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { User } from '../src/models/User';

import { TEST_PASSWORD, app, createUser, signIn } from './helpers';

describe('POST /api/auth/register', () => {
  it('creates an account and returns a session', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'New Inspector',
        email: 'new.inspector@legalmetrology.gov.in',
        password: 'Inspector@123',
      })
      .expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.user.role).toBe('INSPECTOR');
    expect(response.body.data.user.inspectorId).toMatch(/^LM-INS-\d{4}$/);
  });

  it('never returns the password hash', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Hash Check', email: 'hash@legalmetrology.gov.in', password: 'Inspector@123' })
      .expect(201);

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('stores the password hashed, never in plain text', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Plain Check', email: 'plain@legalmetrology.gov.in', password: 'Inspector@123' })
      .expect(201);

    const user = await User.findOne({ email: 'plain@legalmetrology.gov.in' }).select('+passwordHash');

    expect(user?.passwordHash).toBeTruthy();
    expect(user?.passwordHash).not.toBe('Inspector@123');
    expect(user?.passwordHash).toMatch(/^\$2[aby]\$/);
  });

  it('rejects a duplicate email', async () => {
    await createUser({ email: 'taken@legalmetrology.gov.in' });

    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Duplicate', email: 'taken@legalmetrology.gov.in', password: 'Inspector@123' })
      .expect(409);

    expect(response.body.errorCode).toBe('EMAIL_IN_USE');
  });

  it('refuses to create a privileged account through self-registration', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Would-be Admin',
        email: 'sneaky@legalmetrology.gov.in',
        password: 'Inspector@123',
        role: 'ADMIN',
      })
      .expect(403);

    expect(response.body.success).toBe(false);
  });

  it('rejects a weak password', async () => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Weak', email: 'weak@legalmetrology.gov.in', password: 'short' })
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });
});

describe('POST /api/auth/login', () => {
  it('signs in with a valid email and password', async () => {
    const user = await createUser({ email: 'valid@legalmetrology.gov.in' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'valid@legalmetrology.gov.in', password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.user.id).toBe(user.id);
    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).toBeTruthy();
  });

  it('signs in with an inspector ID instead of an email', async () => {
    await createUser({ inspectorId: 'LM-INS-9090', email: 'badge@legalmetrology.gov.in' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'lm-ins-9090', password: TEST_PASSWORD })
      .expect(200);

    expect(response.body.data.user.inspectorId).toBe('LM-INS-9090');
  });

  it('rejects an invalid password', async () => {
    await createUser({ email: 'wrongpass@legalmetrology.gov.in' });

    const response = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'wrongpass@legalmetrology.gov.in', password: 'NotThePassword1' })
      .expect(401);

    expect(response.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same answer for an unknown account as for a wrong password', async () => {
    await createUser({ email: 'known@legalmetrology.gov.in' });

    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'known@legalmetrology.gov.in', password: 'NotThePassword1' })
      .expect(401);

    const unknownAccount = await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'nobody@legalmetrology.gov.in', password: 'NotThePassword1' })
      .expect(401);

    // Identical responses, so the endpoint cannot be used to enumerate accounts.
    expect(unknownAccount.body.message).toBe(wrongPassword.body.message);
    expect(unknownAccount.body.errorCode).toBe(wrongPassword.body.errorCode);
  });

  it('refuses a suspended account', async () => {
    const user = await createUser({ email: 'suspended@legalmetrology.gov.in' });
    user.status = 'SUSPENDED';
    await user.save();

    await request(app)
      .post('/api/auth/login')
      .send({ identifier: 'suspended@legalmetrology.gov.in', password: TEST_PASSWORD })
      .expect(403);
  });
});

describe('authenticated access', () => {
  it('rejects a request with no token', async () => {
    const response = await request(app).get('/api/auth/me').expect(401);
    expect(response.body.success).toBe(false);
  });

  it('rejects a malformed token', async () => {
    const response = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401);

    expect(response.body.errorCode).toBe('TOKEN_INVALID');
  });

  it('returns the caller for a valid token', async () => {
    const { auth, user } = await signIn();

    const response = await request(app).get('/api/auth/me').set('Authorization', auth).expect(200);

    expect(response.body.data.email).toBe(user.email);
  });
});

describe('token lifecycle', () => {
  it('exchanges a refresh token for a new session', async () => {
    const { refreshToken } = await signIn();

    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    expect(response.body.data.accessToken).toBeTruthy();
    expect(response.body.data.refreshToken).not.toBe(refreshToken);
  });

  it('refuses to reuse a rotated refresh token', async () => {
    const { refreshToken } = await signIn();

    await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(200);

    // The first token was revoked as part of the rotation.
    const response = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(401);

    expect(response.body.errorCode).toBe('REFRESH_REVOKED');
  });

  it('invalidates a refresh token on logout', async () => {
    const { refreshToken, auth } = await signIn();

    await request(app)
      .post('/api/auth/logout')
      .set('Authorization', auth)
      .send({ refreshToken })
      .expect(200);

    await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(401);
  });
});
