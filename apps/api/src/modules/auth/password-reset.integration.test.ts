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
let testUserId: string;

const TEST_EMAIL = 'resettest@coldchain.pk';
const INITIAL_PASSWORD = 'initialPass123';

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

function lastEmailedCode(): string {
  const html = sentMails[sentMails.length - 1]!.html;
  const match = html.match(/(\d{6})/);
  if (!match) throw new Error('No 6-digit code in captured email');
  return match[1]!;
}

async function requestCode(email: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email },
  });
}

async function resetWith(email: string, code: string, newPassword: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/reset-password',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email, code, new_password: newPassword },
  });
}

async function loginWith(email: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email, password },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsAdmin(app);
  ownerToken = owner.accessToken;

  const facility = await prisma.facility.findUnique({
    where: { id: TEST_FACILITY_ID },
    select: { settings: true },
  });
  originalSettings = facility?.settings ?? {};

  // Configure email so OTP sends go through the captured test transport.
  const patch = await app.inject({
    method: 'PATCH',
    url: '/v1/facilities/me',
    headers: authHeaders(ownerToken),
    payload: {
      settings: {
        email: {
          enabled: true,
          smtp_host: 'smtp.gmail.com',
          smtp_port: 587,
          smtp_secure: false,
          smtp_user: 'store@gmail.com',
          from_name: 'Test Store',
          admin_email: 'store@gmail.com',
          smtp_password: 'app-password',
        },
      },
    },
  });
  expect(patch.statusCode).toBe(200);

  // Dedicated throwaway user so other suites' logins are unaffected.
  await deleteTestUser(); // idempotence: a previously aborted run may have left it behind
  const created = await app.inject({
    method: 'POST',
    url: '/v1/users',
    headers: authHeaders(ownerToken),
    payload: { email: TEST_EMAIL, name: 'Reset Test', role: 'OPERATOR', initial_password: INITIAL_PASSWORD },
  });
  expect(created.statusCode).toBe(201);
  testUserId = JSON.parse(created.body).data.id;
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

describe('OTP password reset', () => {
  it('forgot-password is neutral for unknown emails and sends nothing', async () => {
    sentMails.length = 0;
    const res = await requestCode('nobody@coldchain.pk');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.message).toMatch(/if an account/i);
    expect(sentMails).toHaveLength(0);
  });

  it('forgot-password emails a 6-digit code to the user', async () => {
    sentMails.length = 0;
    const res = await requestCode(TEST_EMAIL);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.message).toMatch(/if an account/i);
    expect(sentMails).toHaveLength(1);
    expect(sentMails[0]!.to).toBe(TEST_EMAIL);
    expect(lastEmailedCode()).toMatch(/^\d{6}$/);

    const row = await prisma.otpCode.findFirst({
      where: { userId: testUserId, purpose: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(row).toBeTruthy();
    // Stored hashed, not the raw code
    expect(row!.codeHash).toHaveLength(64);
    expect(row!.codeHash).not.toBe(lastEmailedCode());
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';
    const res = await resetWith(TEST_EMAIL, wrong, 'brandNewPass123');
    expect(res.statusCode).toBe(401);

    const row = await prisma.otpCode.findFirst({
      where: { userId: testUserId, purpose: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(row!.attemptCount).toBe(1);
  });

  it('rejects a policy-violating new password WITHOUT consuming the code', async () => {
    const code = lastEmailedCode();

    // Blocklisted password → 400 with the policy reason, not a code error.
    const tooCommon = await resetWith(TEST_EMAIL, code, 'password123');
    expect(tooCommon.statusCode).toBe(400);
    expect(JSON.parse(tooCommon.body).error.message).toMatch(/too common/);

    // Too short → 400 with the length reason.
    const tooShort = await resetWith(TEST_EMAIL, code, 'tiny!123');
    expect(tooShort.statusCode).toBe(400);
    expect(JSON.parse(tooShort.body).error.message).toMatch(/at least 10 characters/);

    // The code survives both rejections — still unconsumed with no attempts
    // burned, so the user can retry it with an acceptable password.
    const row = await prisma.otpCode.findFirst({
      where: { userId: testUserId, purpose: 'PASSWORD_RESET', consumedAt: null },
    });
    expect(row).not.toBeNull();
  });

  it('resets the password with the correct code and revokes sessions', async () => {
    // Establish a session that must die on reset
    const preLogin = await loginWith(TEST_EMAIL, INITIAL_PASSWORD);
    expect(preLogin.statusCode).toBe(200);
    const oldRefresh = JSON.parse(preLogin.body).data.refresh_token as string;

    const res = await resetWith(TEST_EMAIL, lastEmailedCode(), 'brandNewPass123');
    expect(res.statusCode).toBe(200);

    // Old password no longer works; new one does
    expect((await loginWith(TEST_EMAIL, INITIAL_PASSWORD)).statusCode).toBe(401);
    const newLogin = await loginWith(TEST_EMAIL, 'brandNewPass123');
    expect(newLogin.statusCode).toBe(200);
    // OTP reset counts as a deliberate password choice — no forced rotation
    expect(JSON.parse(newLogin.body).data.user.must_change_password).toBe(false);

    // Old refresh token revoked
    const refreshRes = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refresh_token: oldRefresh },
    });
    // Token rotation semantics: the stored token row was revoked, so refresh fails
    expect([400, 401]).toContain(refreshRes.statusCode);
  });

  it('a consumed code cannot be reused', async () => {
    const res = await resetWith(TEST_EMAIL, lastEmailedCode(), 'anotherPass123');
    expect(res.statusCode).toBe(401);
  });

  it('a new request invalidates the previous unconsumed code', async () => {
    sentMails.length = 0;
    await requestCode(TEST_EMAIL);
    const firstCode = lastEmailedCode();
    await requestCode(TEST_EMAIL);
    const secondCode = lastEmailedCode();

    if (firstCode !== secondCode) {
      const withFirst = await resetWith(TEST_EMAIL, firstCode, 'someOtherPass1');
      expect(withFirst.statusCode).toBe(401);
    }
    const withSecond = await resetWith(TEST_EMAIL, secondCode, 'afterInvalidate1');
    expect(withSecond.statusCode).toBe(200);
  });

  it('an expired code is rejected', async () => {
    sentMails.length = 0;
    await requestCode(TEST_EMAIL);
    await prisma.otpCode.updateMany({
      where: { userId: testUserId, purpose: 'PASSWORD_RESET', consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await resetWith(TEST_EMAIL, lastEmailedCode(), 'expiredCodePass1');
    expect(res.statusCode).toBe(401);
  });

  it('locks the code after 5 wrong attempts, even if the right code follows', async () => {
    sentMails.length = 0;
    await requestCode(TEST_EMAIL);
    const code = lastEmailedCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      expect((await resetWith(TEST_EMAIL, wrong, 'bruteForcePass1')).statusCode).toBe(401);
    }
    const res = await resetWith(TEST_EMAIL, code, 'bruteForcePass1');
    expect(res.statusCode).toBe(401);
  });

  it('sends nothing when email is not configured, but stays neutral', async () => {
    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: { settings: (originalSettings ?? {}) as never },
    });
    sentMails.length = 0;
    const res = await requestCode(TEST_EMAIL);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.message).toMatch(/if an account/i);
    expect(sentMails).toHaveLength(0);
  });
});
