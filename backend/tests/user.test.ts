import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { User } from '../src/models/User';

import { TEST_PASSWORD, app, signIn } from './helpers';

/**
 * The inspector profile endpoints.
 *
 * These back the mobile Profile screen, and two of them are the only places in
 * the API where a signed-in caller writes to their own account record — so the
 * escalation and revocation cases below matter more than the happy paths.
 */

describe('GET /api/users/me', () => {
  it('returns the signed-in inspector', async () => {
    const { user, auth } = await signIn();

    const response = await request(app).get('/api/users/me').set('Authorization', auth).expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.email).toBe(user.email);
    expect(response.body.data.inspectorId).toBe(user.inspectorId);
    expect(response.body.data.role).toBe('INSPECTOR');
  });

  it('never leaks the password hash', async () => {
    const { auth } = await signIn();

    const response = await request(app).get('/api/users/me').set('Authorization', auth).expect(200);

    expect(JSON.stringify(response.body)).not.toContain('passwordHash');
  });

  it('rejects an unauthenticated caller', async () => {
    const response = await request(app).get('/api/users/me').expect(401);

    expect(response.body.success).toBe(false);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates the writable fields', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({ name: 'Ravi Sharma', phone: '9876543210', district: 'Pune', state: 'Maharashtra' })
      .expect(200);

    expect(response.body.data.name).toBe('Ravi Sharma');
    expect(response.body.data.phone).toBe('9876543210');
    expect(response.body.data.district).toBe('Pune');
  });

  it('persists the change', async () => {
    const { user, auth } = await signIn();

    await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({ zone: 'West Zone' })
      .expect(200);

    const reloaded = await User.findById(user.id);
    expect(reloaded?.zone).toBe('West Zone');
  });

  it('will not let an inspector promote themselves', async () => {
    const { user, auth } = await signIn();

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({ name: 'Still An Inspector', role: 'ADMIN', status: 'SUSPENDED' })
      .expect(200);

    expect(response.body.data.role).toBe('INSPECTOR');

    const reloaded = await User.findById(user.id);
    expect(reloaded?.role).toBe('INSPECTOR');
    expect(reloaded?.status).toBe('ACTIVE');
  });

  it('ignores email and inspector ID when they ride along with a real edit', async () => {
    const { user, auth } = await signIn();

    await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({
        name: 'Renamed Inspector',
        email: 'someone.else@legalmetrology.gov.in',
        inspectorId: 'LM-INS-9999',
      })
      .expect(200);

    const reloaded = await User.findById(user.id);
    expect(reloaded?.name).toBe('Renamed Inspector');
    expect(reloaded?.email).toBe(user.email);
    expect(reloaded?.inspectorId).toBe(user.inspectorId);
  });

  it('refuses a patch made up entirely of non-writable fields', async () => {
    const { auth } = await signIn();

    // The schema strips the unknown keys, which leaves nothing to apply — so
    // the request is refused rather than silently reported as a success.
    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({ email: 'someone.else@legalmetrology.gov.in', role: 'ADMIN' })
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('refuses an empty patch', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({})
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('rejects a name that is too short', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .patch('/api/users/me')
      .set('Authorization', auth)
      .send({ name: 'A' })
      .expect(422);

    expect(response.body.success).toBe(false);
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app).patch('/api/users/me').send({ name: 'Nobody At All' }).expect(401);
  });
});

describe('POST /api/users/me/password', () => {
  it('changes the password and lets the new one sign in', async () => {
    const { user, auth } = await signIn();

    await request(app)
      .post('/api/users/me/password')
      .set('Authorization', auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@2026' })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: 'BrandNew@2026' })
      .expect(200);
  });

  it('stops the old password working', async () => {
    const { user, auth } = await signIn();

    await request(app)
      .post('/api/users/me/password')
      .set('Authorization', auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@2026' })
      .expect(200);

    await request(app)
      .post('/api/auth/login')
      .send({ identifier: user.email, password: TEST_PASSWORD })
      .expect(401);
  });

  it('revokes the sessions issued before the change', async () => {
    const { auth, refreshToken } = await signIn();

    await request(app)
      .post('/api/users/me/password')
      .set('Authorization', auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@2026' })
      .expect(200);

    // A password change is usually a response to a suspected compromise, so
    // the refresh token handed out beforehand must stop working.
    await request(app).post('/api/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('rejects a wrong current password', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .post('/api/users/me/password')
      .set('Authorization', auth)
      .send({ currentPassword: 'NotMyPassword@1', newPassword: 'BrandNew@2026' })
      .expect(401);

    expect(response.body.errorCode).toBe('INVALID_CREDENTIALS');
  });

  it('rejects a new password that is too short', async () => {
    const { auth } = await signIn();

    const response = await request(app)
      .post('/api/users/me/password')
      .set('Authorization', auth)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' })
      .expect(422);

    expect(response.body.errorCode).toBe('VALIDATION_FAILED');
  });

  it('rejects an unauthenticated caller', async () => {
    await request(app)
      .post('/api/users/me/password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'BrandNew@2026' })
      .expect(401);
  });
});

describe('GET /api/users', () => {
  it('lets a supervisor read the roster', async () => {
    await signIn();
    const supervisor = await signIn({ role: 'SUPERVISOR' });

    const response = await request(app)
      .get('/api/users')
      .set('Authorization', supervisor.auth)
      .expect(200);

    expect(Array.isArray(response.body.data)).toBe(true);
    expect(response.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('hides the roster from an inspector', async () => {
    const { auth } = await signIn();

    const response = await request(app).get('/api/users').set('Authorization', auth).expect(403);

    expect(response.body.success).toBe(false);
  });
});
