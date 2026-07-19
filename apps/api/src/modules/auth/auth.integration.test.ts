import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp, loginAsAdmin, TEST_FACILITY_ID } from '../../test/helpers';

const prisma = new PrismaClient();

describe('Auth API Integration', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await getTestApp();
  });

  afterAll(async () => {
    await prisma.$disconnect();
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

    it('transparently upgrades a legacy bcrypt hash to argon2id on successful login', async () => {
      const email = `legacy-bcrypt-${Date.now()}@coldchain.pk`;
      const bcryptHash = await bcrypt.hash('legacy-password-123', 10);
      const created = await prisma.user.create({
        data: {
          facilityId: TEST_FACILITY_ID,
          email,
          name: 'Legacy Bcrypt User',
          role: 'OPERATOR',
          passwordHash: bcryptHash,
          isActive: true,
        },
      });
      expect(created.passwordHash).toMatch(/^\$2/);

      const first = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, password: 'legacy-password-123' },
      });
      expect(first.statusCode).toBe(200);

      const afterFirstLogin = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
      expect(afterFirstLogin.passwordHash).toMatch(/^\$argon2id\$/);

      // The upgraded hash must still authenticate with the same password.
      const second = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, password: 'legacy-password-123' },
      });
      expect(second.statusCode).toBe(200);

      await prisma.refreshToken.deleteMany({ where: { userId: created.id } }).catch(() => {});
      await prisma.user.delete({ where: { id: created.id } }).catch(() => {});
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

    it('REUSE DETECTION — replaying a rotated refresh token revokes the whole session family', async () => {
      // A dedicated user so nuking all their sessions can't disturb other tests.
      const owner = await loginAsAdmin(app);
      const email = `reuse-probe-${Date.now()}@coldchain.pk`;
      const create = await app.inject({
        method: 'POST',
        url: '/v1/users',
        headers: { authorization: `Bearer ${owner.accessToken}`, 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, name: 'Reuse Probe', role: 'OPERATOR', initial_password: 'reuse-probe-pw1' },
      });
      expect(create.statusCode).toBe(201);
      const probeId = JSON.parse(create.body).data.id as string;

      const login = await app.inject({
        method: 'POST',
        url: '/v1/auth/login',
        headers: { 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, password: 'reuse-probe-pw1' },
      });
      const original = JSON.parse(login.body).data.refresh_token as string;

      // Legitimate rotation: original → rotated.
      const rotate = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: original } });
      expect(rotate.statusCode).toBe(200);
      const rotated = JSON.parse(rotate.body).data.refresh_token as string;

      // Replay of the ORIGINAL (now-revoked) token = theft signal → 401…
      const replay = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: original } });
      expect(replay.statusCode).toBe(401);

      // …and the ROTATED token (the "legitimate" line) is dead too: family revoked.
      const afterTheft = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: rotated } });
      expect(afterTheft.statusCode).toBe(401);

      await prisma.refreshToken.deleteMany({ where: { userId: probeId } }).catch(() => {});
      await prisma.user.delete({ where: { id: probeId } }).catch(() => {});
    });

    it('replaying an EXPLICITLY revoked token (signed-out device) does NOT nuke other sessions', async () => {
      // Same-user two devices; b gets signed out via the sessions API. A stale
      // tab replaying b's token is normal, not theft — a must stay alive.
      const owner = await loginAsAdmin(app);
      const email = `stale-tab-probe-${Date.now()}@coldchain.pk`;
      const create = await app.inject({
        method: 'POST',
        url: '/v1/users',
        headers: { authorization: `Bearer ${owner.accessToken}`, 'x-facility-id': TEST_FACILITY_ID },
        payload: { email, name: 'Stale Tab Probe', role: 'OPERATOR', initial_password: 'stale-tab-pw12' },
      });
      const probeId = JSON.parse(create.body).data.id as string;
      const probeLogin = async () =>
        JSON.parse(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/login',
              headers: { 'x-facility-id': TEST_FACILITY_ID },
              payload: { email, password: 'stale-tab-pw12' },
            })
          ).body,
        ).data as { access_token: string; refresh_token: string };

      const a = await probeLogin();
      const b = await probeLogin();

      // a signs out every other device (revokes b's row — explicitly, not by rotation).
      const revoke = await app.inject({
        method: 'POST',
        url: '/v1/auth/sessions/revoke-others',
        headers: { authorization: `Bearer ${a.access_token}`, 'x-facility-id': TEST_FACILITY_ID },
      });
      expect(revoke.statusCode).toBe(200);

      // b's stale tab replays its token: plain 401…
      const replay = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: b.refresh_token } });
      expect(replay.statusCode).toBe(401);

      // …and a's session survives (no family revocation for explicit revokes).
      const aStillAlive = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: a.refresh_token } });
      expect(aStillAlive.statusCode).toBe(200);

      await prisma.refreshToken.deleteMany({ where: { userId: probeId } }).catch(() => {});
      await prisma.user.delete({ where: { id: probeId } }).catch(() => {});
    });

    it('a garbage/unknown refresh token does NOT revoke anything', async () => {
      const { accessToken, refreshToken } = await loginAsAdmin(app);

      // Unknown-but-well-formed token: sign-shaped garbage fails verification → plain 401.
      const res = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        payload: { refresh_token: 'invalid-token' },
      });
      expect(res.statusCode).toBe(401);

      // The session that was live before is still live.
      const stillAlive = await app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: refreshToken } });
      expect(stillAlive.statusCode).toBe(200);
      const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: { authorization: `Bearer ${accessToken}` } });
      expect(me.statusCode).toBe(200);
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
