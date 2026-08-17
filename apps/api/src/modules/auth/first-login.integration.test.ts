import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../test/helpers';

/**
 * The very first login on a freshly installed box, from a browser that has never
 * logged in — the one path no other test covers, because every other test supplies
 * `X-Facility-ID` by hand (authHeaders() in the integration suites, FACILITY_ID in
 * the E2E fixtures).
 *
 * That gap hid a deadlock that made a clean install unusable:
 *
 *   POST /v1/auth/login required the X-Facility-ID header,
 *   the web client sent it only if localStorage held facility_id,
 *   and the only writer of localStorage.facility_id runs AFTER a successful login.
 *
 * So a new browser could never log in, and — because forgot-password had the same
 * requirement — could not reset its way out either. The password was never even
 * compared: the request was rejected before reaching bcrypt, which is why the
 * credentials looked correct and still failed.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;

beforeAll(async () => {
  app = await getTestApp();
});

afterAll(async () => {
  await closeTestApp();
  await prisma.$disconnect();
});

describe('first login on a fresh browser (no X-Facility-ID)', () => {
  it('has exactly one facility — the single-tenant assumption this relies on', async () => {
    const count = await prisma.facility.count();
    expect(
      count,
      'these tests describe a single-facility box; a leaked fixture facility invalidates them',
    ).toBe(1);
  });

  it('logs in without the header, because the browser cannot know the id yet', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      // Deliberately no x-facility-id: this is what a fresh browser sends.
      payload: { email: 'admin@coldchain.pk', password: 'admin123' },
    });

    expect(res.statusCode, res.body).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.data.access_token).toBeTruthy();
    // The response must carry the id so the client can store it for every later call.
    expect(body.data.user.facility_id).toBe(TEST_FACILITY_ID);
  });

  it('still rejects a wrong password — the fallback resolves the facility, nothing more', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      payload: { email: 'admin@coldchain.pk', password: 'definitely-not-the-password' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('lets a user who has never logged in start a password reset', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      payload: { email: 'admin@coldchain.pk' },
    });
    // Always 200 (it must not reveal whether the address exists); what matters is
    // that it is no longer refused for a missing header.
    expect(res.statusCode, res.body).toBe(200);
  });

  it('an explicit header still wins over the fallback', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email: 'admin@coldchain.pk', password: 'admin123' },
    });
    expect(res.statusCode, res.body).toBe(200);
  });
});
