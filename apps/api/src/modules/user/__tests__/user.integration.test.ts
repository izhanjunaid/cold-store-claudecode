import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  TEST_FACILITY_ID,
} from '../../../test/helpers';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
const createdEmails: string[] = [];

function uniqueEmail(suffix: string) {
  const email = `phase11-${Date.now()}-${suffix}@coldchain.test`;
  createdEmails.push(email);
  return email;
}

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  const manager = await loginAsRole(app, 'MANAGER');
  ownerToken = owner.accessToken;
  managerToken = manager.accessToken;
});

afterAll(async () => {
  // Clean up any users we created. Refresh tokens FK cascade is handled below.
  if (createdEmails.length > 0) {
    const users = await prisma.user.findMany({
      where: { facilityId: TEST_FACILITY_ID, email: { in: createdEmails } },
      select: { id: true },
    });
    const ids = users.map((u) => u.id);
    if (ids.length > 0) {
      await prisma.refreshToken.deleteMany({ where: { userId: { in: ids } } });
      await prisma.user.deleteMany({ where: { id: { in: ids } } });
    }
  }
  await prisma.$disconnect();
  await closeTestApp();
});

describe('User Management', () => {
  it('OWNER can create a user (must_change_password=true)', async () => {
    const email = uniqueEmail('create');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: {
        email,
        name: 'Phase 11 Test',
        role: 'OPERATOR',
        initial_password: 'tempPass123!',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.data.email).toBe(email);
    expect(body.data.role).toBe('OPERATOR');
    expect(body.data.must_change_password).toBe(true);
    expect(body.data.is_active).toBe(true);
  });

  it('rejects duplicate email with USER_EMAIL_TAKEN', async () => {
    const email = uniqueEmail('dup');
    const first = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'First', role: 'OPERATOR', initial_password: 'tempPass123!' },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Second', role: 'ACCOUNTANT', initial_password: 'tempPass456!' },
    });
    expect(second.statusCode).toBe(409);
    expect(JSON.parse(second.body).error.code).toBe('USER_EMAIL_TAKEN');
  });

  it('MANAGER cannot create a user (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(managerToken),
      payload: {
        email: uniqueEmail('rolegate'),
        name: 'Should Fail',
        role: 'OPERATOR',
        initial_password: 'tempPass789!',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('OWNER can update role and is_active', async () => {
    const email = uniqueEmail('update');
    const create = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Update Me', role: 'OPERATOR', initial_password: 'tempPass!1' },
    });
    expect(create.statusCode).toBe(201);
    const userId = JSON.parse(create.body).data.id;

    const patch = await app.inject({
      method: 'PATCH',
      url: `/v1/users/${userId}`,
      headers: authHeaders(ownerToken),
      payload: { role: 'ACCOUNTANT', is_active: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(JSON.parse(patch.body).data.role).toBe('ACCOUNTANT');
    expect(JSON.parse(patch.body).data.is_active).toBe(false);
  });

  it('reset-password sets must_change_password=true and clears lockout', async () => {
    const email = uniqueEmail('reset');
    const create = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Reset Me', role: 'OPERATOR', initial_password: 'tempPass!1' },
    });
    const userId = JSON.parse(create.body).data.id;

    // Change own password to clear must_change_password (so the reset is observable)
    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email, password: 'tempPass!1' },
    });
    expect(login.statusCode).toBe(200);
    const userToken = JSON.parse(login.body).data.access_token;

    const change = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: authHeaders(userToken),
      payload: { current_password: 'tempPass!1', new_password: 'newPass!2' },
    });
    expect(change.statusCode).toBe(200);
    expect(JSON.parse(change.body).data.must_change_password).toBe(false);

    // OWNER resets — must_change_password should flip back to true.
    const reset = await app.inject({
      method: 'POST',
      url: `/v1/users/${userId}/reset-password`,
      headers: authHeaders(ownerToken),
      payload: { new_password: 'resetPass!3' },
    });
    expect(reset.statusCode).toBe(200);
    expect(JSON.parse(reset.body).data.must_change_password).toBe(true);
  });

  it('deactivated user cannot log in', async () => {
    const email = uniqueEmail('deact');
    const create = await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Deact Me', role: 'OPERATOR', initial_password: 'tempPass!1' },
    });
    const userId = JSON.parse(create.body).data.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/users/${userId}`,
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email, password: 'tempPass!1' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('change-password rejects wrong current password', async () => {
    const email = uniqueEmail('wrong');
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Wrong PW', role: 'OPERATOR', initial_password: 'tempPass!1' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email, password: 'tempPass!1' },
    });
    const userToken = JSON.parse(login.body).data.access_token;

    const change = await app.inject({
      method: 'POST',
      url: '/v1/auth/change-password',
      headers: authHeaders(userToken),
      payload: { current_password: 'wrong-current', new_password: 'newPass!2' },
    });
    expect(change.statusCode).toBe(422);
    expect(JSON.parse(change.body).error.code).toBe('USER_WRONG_PASSWORD');
  });

  it('login response carries must_change_password flag', async () => {
    const email = uniqueEmail('flag');
    await app.inject({
      method: 'POST',
      url: '/v1/users',
      headers: authHeaders(ownerToken),
      payload: { email, name: 'Flag User', role: 'OPERATOR', initial_password: 'tempPass!1' },
    });

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { email, password: 'tempPass!1' },
    });
    expect(login.statusCode).toBe(200);
    expect(JSON.parse(login.body).data.user.must_change_password).toBe(true);
  });

  it('MANAGER cannot list users (403)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/users',
      headers: authHeaders(managerToken),
    });
    expect(res.statusCode).toBe(403);
  });
});
