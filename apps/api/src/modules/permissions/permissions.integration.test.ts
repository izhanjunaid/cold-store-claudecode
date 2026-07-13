import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;

async function putOverrides(token: string, overrides: unknown) {
  return app.inject({
    method: 'PUT',
    url: '/v1/permissions',
    headers: authHeaders(token),
    payload: { overrides },
  });
}

async function resetPermissions() {
  await app.inject({ method: 'POST', url: '/v1/permissions/reset', headers: authHeaders(ownerToken) });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
});

afterEach(async () => {
  await resetPermissions();
});

afterAll(async () => {
  // Clean the permissions key out of settings entirely.
  const facility = await prisma.facility.findUnique({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
  const settings = { ...((facility?.settings as Record<string, unknown>) ?? {}) };
  delete settings['permissions'];
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: settings as never } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Permissions matrix API', () => {
  it('GET /v1/permissions returns defaults, overrides and effective for OWNER', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeaders(ownerToken) });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.defaults.OWNER).toContain('users.manage');
    expect(data.effective.MANAGER).toContain('invoices.manage');
    // MANAGER outranks ACCOUNTANT so it keeps ACCOUNTANT-default keys, but never
    // the OWNER-only ones.
    expect(data.effective.MANAGER).toContain('payments.record');
    expect(data.effective.MANAGER).not.toContain('reports.seasonal');
    expect(data.effective.MANAGER).not.toContain('users.manage');
    expect(data.overrides).toEqual({});
  });

  it('GET /v1/permissions is denied for non-OWNER (403)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeaders(managerToken) });
    expect(res.statusCode).toBe(403);
  });

  it('login and /me return the effective permission list', async () => {
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email: 'manager@coldchain.pk', password: 'admin123' },
    });
    const perms = JSON.parse(login.body).data.user.permissions as string[];
    expect(perms).toContain('invoices.manage');
    expect(perms).not.toContain('users.manage');

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(managerToken) });
    expect(JSON.parse(me.body).data.permissions).toEqual(expect.arrayContaining(['invoices.manage']));
  });

  it('granting a key lets a role reach a route it could not before', async () => {
    // MANAGER cannot see the seasonal summary (OWNER-only) by default.
    const before = await app.inject({
      method: 'GET',
      url: '/v1/reports/seasonal-summary?date_from=2026-01-01&date_to=2026-12-31',
      headers: authHeaders(managerToken),
    });
    expect(before.statusCode).toBe(403);

    const put = await putOverrides(ownerToken, { MANAGER: { grant: ['reports.seasonal'], revoke: [] } });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/reports/seasonal-summary?date_from=2026-01-01&date_to=2026-12-31',
      headers: authHeaders(managerToken),
    });
    // 200 (or a downstream non-authz status), but NOT 403 anymore.
    expect(after.statusCode).not.toBe(403);
  });

  it('revoking a default key blocks a role that had it (cache invalidated immediately)', async () => {
    const before = await app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
    });
    expect(before.statusCode).toBe(200);

    const put = await putOverrides(ownerToken, { ACCOUNTANT: { grant: [], revoke: ['billing.view'] } });
    expect(put.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
    });
    expect(after.statusCode).toBe(403);
  });

  it('reset restores defaults', async () => {
    await putOverrides(ownerToken, { ACCOUNTANT: { grant: [], revoke: ['billing.view'] } });
    const reset = await app.inject({ method: 'POST', url: '/v1/permissions/reset', headers: authHeaders(ownerToken) });
    expect(reset.statusCode).toBe(200);
    const after = await app.inject({ method: 'GET', url: '/v1/payments', headers: authHeaders(accountantToken) });
    expect(after.statusCode).toBe(200);
  });

  it('rejects granting an alwaysOwner key (400)', async () => {
    const res = await putOverrides(ownerToken, { MANAGER: { grant: ['permissions.manage'], revoke: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown permission key (400)', async () => {
    const res = await putOverrides(ownerToken, { MANAGER: { grant: ['not.a.key'], revoke: [] } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects editing the OWNER row (400)', async () => {
    const res = await putOverrides(ownerToken, { OWNER: { grant: [], revoke: ['users.manage'] } });
    expect(res.statusCode).toBe(400);
  });

  it('PUT is denied for non-OWNER (403)', async () => {
    const res = await putOverrides(managerToken, { ACCOUNTANT: { grant: [], revoke: ['billing.view'] } });
    expect(res.statusCode).toBe(403);
  });

  it('permission overrides survive an unrelated facility settings PATCH', async () => {
    await putOverrides(ownerToken, { ACCOUNTANT: { grant: ['reports.seasonal'], revoke: [] } });

    // A normal settings update must not clobber the hidden permissions key.
    const patch = await app.inject({
      method: 'PATCH',
      url: '/v1/facilities/me',
      headers: authHeaders(ownerToken),
      payload: { settings: { weight_dispute_threshold_kg: 7 } },
    });
    expect(patch.statusCode).toBe(200);

    const get = await app.inject({ method: 'GET', url: '/v1/permissions', headers: authHeaders(ownerToken) });
    expect(JSON.parse(get.body).data.overrides.ACCOUNTANT.grant).toContain('reports.seasonal');
  });
});
