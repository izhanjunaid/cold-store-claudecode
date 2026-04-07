import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, loginAsAdmin, TEST_FACILITY_ID } from '../../test/helpers';

describe('Auth API Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await closeTestApp();
  });

  // --- Health Check ---
  it('GET /health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.status).toBe('ok');
  });

  // --- Login ---
  describe('POST /v1/auth/login', () => {
    it('returns tokens and user on valid credentials', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email: 'admin@coldchain.pk', password: 'admin123' },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.refresh_token).toBeDefined();
      expect(body.data.user.email).toBe('admin@coldchain.pk');
      expect(body.data.user.role).toBe('OWNER');
    });

    it('rejects wrong password', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email: 'admin@coldchain.pk', password: 'wrongpassword' },
      });
      expect(res.statusCode).toBe(401);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe('AUTH_INVALID');
    });

    it('rejects non-existent user', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email: 'nobody@coldchain.pk', password: 'admin123' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects missing X-Facility-ID', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        payload: { email: 'admin@coldchain.pk', password: 'admin123' },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('rejects invalid email format', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email: 'not-an-email', password: 'admin123' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  // --- GET /v1/auth/me ---
  describe('GET /v1/auth/me', () => {
    it('returns current user with valid token', async () => {
      const { accessToken } = await loginAsAdmin(app);
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.email).toBe('admin@coldchain.pk');
      expect(body.data.name).toBeDefined();
      expect(body.data.role).toBe('OWNER');
    });

    it('rejects request without token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/auth/me',
        headers: { authorization: 'Bearer invalidtoken123' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- POST /v1/auth/refresh ---
  describe('POST /v1/auth/refresh', () => {
    it('returns new tokens on valid refresh token', async () => {
      const { refreshToken } = await loginAsAdmin(app);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: refreshToken },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.data.access_token).toBeDefined();
      expect(body.data.refresh_token).toBeDefined();
    });

    it('rejects invalid refresh token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: 'invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  // --- POST /v1/auth/logout ---
  describe('POST /v1/auth/logout', () => {
    it('logs out successfully', async () => {
      const { accessToken } = await loginAsAdmin(app);
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.success).toBe(true);
    });

    it('rejects unauthenticated logout', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/logout',
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
