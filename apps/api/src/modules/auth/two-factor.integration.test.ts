import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsAdmin,
  authHeaders,
  TEST_FACILITY_ID,
  sentMails,
} from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let originalSettings: unknown;
let userToken: string;
let userId: string;

const TEST_EMAIL = 'twofactest@coldchain.pk';
const PASSWORD = 'twoFactorPass123';

function lastEmailedCode(): string {
  const html = sentMails[sentMails.length - 1]!.html;
  const match = html.match(/(\d{6})/);
  if (!match) throw new Error('No 6-digit code in captured email');
  return match[1]!;
}

async function deleteTestUser() {
  const user = await prisma.user.findUnique({
    where: { facilityId_email: { facilityId: TEST_FACILITY_ID, email: TEST_EMAIL } },
  });
  if (user) {
    await prisma.otpCode.deleteMany({ where: { userId: user.id } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

async function enableEmail(smtpPassword: string | null) {
  return app.inject({
    method: 'PATCH',
    url: '/v1/facilities/me',
    headers: authHeaders(ownerToken),
    payload: {
      settings: {
        email: {
          enabled: smtpPassword !== null,
          smtp_host: 'smtp.gmail.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'store@gmail.com',
          from_name: 'Test Store',
          admin_email: 'store@gmail.com',
          ...(smtpPassword ? { smtp_password: smtpPassword } : {}),
        },
      },
    },
  });
}

async function login(email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email, password },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsAdmin(app)).accessToken;

  const facility = await prisma.facility.findUnique({
    where: { id: TEST_FACILITY_ID },
    select: { settings: true },
  });
  originalSettings = facility?.settings ?? {};

  await enableEmail('app-password');

  await deleteTestUser();
  const created = await app.inject({
    method: 'POST',
    url: '/v1/users',
    headers: authHeaders(ownerToken),
    payload: { email: TEST_EMAIL, name: 'TwoFactor Test', role: 'MANAGER', initial_password: PASSWORD },
  });
  expect(created.statusCode).toBe(201);
  userId = JSON.parse(created.body).data.id;

  // The seeded user is created with must_change_password; clear it so login
  // returns cleanly and we can exercise the 2FA path without that noise.
  await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } });

  const loginRes = await login(TEST_EMAIL, PASSWORD);
  userToken = JSON.parse(loginRes.body).data.access_token;
});

afterAll(async () => {
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: (originalSettings ?? {}) as never },
  });
  await deleteTestUser();
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Email 2FA', () => {
  it('me reports two_factor_enabled=false initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(userToken) });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.two_factor_enabled).toBe(false);
  });

  it('login without 2FA returns tokens directly', async () => {
    const res = await login(TEST_EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.access_token).toBeTruthy();
    expect(data.requires_2fa).toBeUndefined();
  });

  it('enabling 2FA requires a valid emailed code', async () => {
    sentMails.length = 0;
    const reqEnable = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/request-enable',
      headers: authHeaders(userToken),
      payload: {},
    });
    expect(reqEnable.statusCode).toBe(200);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe(TEST_EMAIL);
    expect(sentMails[0]!.subject).toMatch(/login code/i);

    // Wrong code is rejected
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const badEnable = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/enable',
      headers: authHeaders(userToken),
      payload: { code: wrong },
    });
    expect(badEnable.statusCode).toBe(401);

    // Correct code enables it
    const goodEnable = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/enable',
      headers: authHeaders(userToken),
      payload: { code },
    });
    expect(goodEnable.statusCode).toBe(200);
    expect(JSON.parse(goodEnable.body).data.two_factor_enabled).toBe(true);

    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(userToken) });
    expect(JSON.parse(me.body).data.two_factor_enabled).toBe(true);
  });

  it('login now returns a pending 2FA challenge instead of tokens', async () => {
    sentMails.length = 0;
    const res = await login(TEST_EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.requires_2fa).toBe(true);
    expect(data.pending_token).toBeTruthy();
    expect(data.access_token).toBeUndefined();
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe(TEST_EMAIL);
  });

  it('verify-2fa with the emailed code returns tokens', async () => {
    sentMails.length = 0;
    const loginRes = await login(TEST_EMAIL, PASSWORD);
    const pendingToken = JSON.parse(loginRes.body).data.pending_token as string;
    const code = lastEmailedCode();

    const verify = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/verify-2fa',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { pending_token: pendingToken, code },
    });
    expect(verify.statusCode).toBe(200);
    const data = JSON.parse(verify.body).data;
    expect(data.access_token).toBeTruthy();
    expect(data.refresh_token).toBeTruthy();
    expect(data.user.email).toBe(TEST_EMAIL);
  });

  it('verify-2fa rejects a wrong code', async () => {
    sentMails.length = 0;
    const loginRes = await login(TEST_EMAIL, PASSWORD);
    const pendingToken = JSON.parse(loginRes.body).data.pending_token as string;
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';

    const verify = await app.inject({
      method: 'POST',
      url: '/v1/auth/login/verify-2fa',
      headers: { 'x-facility-id': TEST_FACILITY_ID },
      payload: { pending_token: pendingToken, code: wrong },
    });
    expect(verify.statusCode).toBe(401);
  });

  it('the pending token cannot be used as an access token', async () => {
    const loginRes = await login(TEST_EMAIL, PASSWORD);
    const pendingToken = JSON.parse(loginRes.body).data.pending_token as string;
    const res = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      headers: { authorization: `Bearer ${pendingToken}`, 'x-facility-id': TEST_FACILITY_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it('falls back to normal login with a warning when email is unconfigured', async () => {
    await enableEmail(null); // disable email
    sentMails.length = 0;
    const res = await login(TEST_EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.requires_2fa).toBeUndefined();
    expect(data.access_token).toBeTruthy();
    expect(data.two_factor_bypassed).toBe(true);
    expect(sentMails).toHaveLength(0);
    await enableEmail('app-password'); // restore for subsequent tests
  });

  it('disabling 2FA requires the correct password', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/disable',
      headers: authHeaders(userToken),
      payload: { password: 'wrongPassword1' },
    });
    expect(wrong.statusCode).toBe(422);

    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/disable',
      headers: authHeaders(userToken),
      payload: { password: PASSWORD },
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.body).data.two_factor_enabled).toBe(false);

    // Login is direct again
    const loginRes = await login(TEST_EMAIL, PASSWORD);
    expect(JSON.parse(loginRes.body).data.access_token).toBeTruthy();
    expect(JSON.parse(loginRes.body).data.requires_2fa).toBeUndefined();
  });
});
