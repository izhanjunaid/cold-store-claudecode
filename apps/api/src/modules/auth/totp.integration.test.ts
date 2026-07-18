import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { generate } from 'otplib';
import type { FastifyInstance } from 'fastify';
import { PrismaClient, type Prisma } from '@coldchain/db';
import {
  getTestApp,
  closeTestApp,
  loginAsRole,
  authHeaders,
  sentMails,
  TEST_FACILITY_ID,
} from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let userId: string;
let userToken: string;
let totpSecret: string;
let backupCodes: string[] = [];
let originalSettings: Prisma.JsonValue;

const TEST_EMAIL = `totp-user-${Date.now()}@coldchain.pk`;
const PASSWORD = 'totpUserPass123';

const login = (email: string, password: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { email, password },
  });

const verify2fa = (pendingToken: string, code: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/auth/login/verify-2fa',
    headers: { 'x-facility-id': TEST_FACILITY_ID },
    payload: { pending_token: pendingToken, code },
  });

async function disableFacilityEmail() {
  const row = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } });
  const settings =
    row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings)
      ? { ...(row.settings as Record<string, unknown>) }
      : {};
  settings['email'] = { enabled: false };
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: settings as Prisma.InputJsonValue },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  originalSettings = (await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } }))
    .settings;

  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/users',
    headers: authHeaders(ownerToken),
    payload: { email: TEST_EMAIL, name: 'TOTP Test', role: 'MANAGER', initial_password: PASSWORD },
  });
  expect(created.statusCode).toBe(201);
  userId = JSON.parse(created.body).data.id;
  await prisma.user.update({ where: { id: userId }, data: { mustChangePassword: false } });

  const loginRes = await login(TEST_EMAIL, PASSWORD);
  userToken = JSON.parse(loginRes.body).data.access_token;
});

afterAll(async () => {
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: (originalSettings ?? {}) as Prisma.InputJsonValue },
  });
  await prisma.userBackupCode.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.refreshToken.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.otpCode.deleteMany({ where: { userId } }).catch(() => {});
  await prisma.user.delete({ where: { id: userId } }).catch(() => {});
  await prisma.$disconnect();
  await closeTestApp();
});

describe('TOTP 2FA', () => {
  it('enable is rejected before setup', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/enable',
      headers: authHeaders(userToken),
      payload: { code: '123456' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('setup returns an otpauth URI and stores the secret encrypted, 2FA still off', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/setup',
      headers: authHeaders(userToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as { otpauth_uri: string; secret: string };
    expect(data.otpauth_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(data.otpauth_uri).toContain(`secret=${data.secret}`);
    totpSecret = data.secret;

    // Stored encrypted (not the base32 plaintext), and NOT yet enabled.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.totpSecretEnc).toBeTruthy();
    expect(row.totpSecretEnc).not.toContain(totpSecret);
    expect(row.totpEnabledAt).toBeNull();

    // Login is still password-only at this point (pending enrollment ≠ enabled).
    const loginRes = await login(TEST_EMAIL, PASSWORD);
    expect(JSON.parse(loginRes.body).data.access_token).toBeDefined();
  });

  it('enable rejects a wrong code', async () => {
    const wrong = (await generate({ secret: totpSecret })) === '000000' ? '111111' : '000000';
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/enable',
      headers: authHeaders(userToken),
      payload: { code: wrong },
    });
    expect(res.statusCode).toBe(401);
  });

  it('enable verifies a live code and returns 8 backup codes exactly once', async () => {
    const code = await generate({ secret: totpSecret });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/enable',
      headers: authHeaders(userToken),
      payload: { code },
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data as {
      two_factor_enabled: boolean;
      two_factor_method: string;
      backup_codes: string[];
    };
    expect(data.two_factor_enabled).toBe(true);
    expect(data.two_factor_method).toBe('totp');
    expect(data.backup_codes).toHaveLength(8);
    for (const c of data.backup_codes) expect(c).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    backupCodes = data.backup_codes;

    // Codes are stored hashed, never plaintext.
    const rows = await prisma.userBackupCode.findMany({ where: { userId } });
    expect(rows).toHaveLength(8);
    for (const row of rows) {
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(backupCodes).not.toContain(row.codeHash);
    }

    // /me reflects the method and remaining codes.
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(userToken) });
    const meData = JSON.parse(me.body).data;
    expect(meData.two_factor_enabled).toBe(true);
    expect(meData.two_factor_method).toBe('totp');
    expect(meData.backup_codes_remaining).toBe(8);
  });

  it('REGRESSION — TOTP login does NOT bypass when email is unconfigured: no tokens, no email', async () => {
    await disableFacilityEmail();
    sentMails.length = 0;

    const res = await login(TEST_EMAIL, PASSWORD);
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;

    // The email-2FA offline bypass must never apply to a TOTP account.
    expect(data.requires_2fa).toBe(true);
    expect(data.method).toBe('totp');
    expect(data.pending_token).toBeDefined();
    expect(data.access_token).toBeUndefined();
    expect(data.refresh_token).toBeUndefined();
    expect(data.two_factor_bypassed).toBeUndefined();
    expect(sentMails).toHaveLength(0);
  });

  it('verify-2fa accepts a live authenticator code and issues tokens', async () => {
    const pending = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    const res = await verify2fa(pending, await generate({ secret: totpSecret }));
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.access_token).toBeDefined();
    expect(data.user.email).toBe(TEST_EMAIL);
  });

  it('verify-2fa rejects a wrong authenticator code', async () => {
    const pending = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    const live = await generate({ secret: totpSecret });
    const wrong = live === '000000' ? '111111' : '000000';
    expect((await verify2fa(pending, wrong)).statusCode).toBe(401);
  });

  it('a backup code signs in once and dies on reuse', async () => {
    const code = backupCodes[0]!;

    const pending1 = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    const first = await verify2fa(pending1, code);
    expect(first.statusCode).toBe(200);
    expect(JSON.parse(first.body).data.access_token).toBeDefined();

    // Same code again — burned.
    const pending2 = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    expect((await verify2fa(pending2, code)).statusCode).toBe(401);

    // Remaining count dropped by one.
    const me = await app.inject({ method: 'GET', url: '/v1/auth/me', headers: authHeaders(userToken) });
    expect(JSON.parse(me.body).data.backup_codes_remaining).toBe(7);
  });

  it('backup codes are accepted case-insensitively and without the dash', async () => {
    const code = backupCodes[1]!.toLowerCase().replace('-', '');
    const pending = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    expect((await verify2fa(pending, code)).statusCode).toBe(200);
  });

  it('regenerate replaces the set: old codes die, count resets to 8', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/backup-codes/regenerate',
      headers: authHeaders(userToken),
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    const fresh = JSON.parse(res.body).data.backup_codes as string[];
    expect(fresh).toHaveLength(8);

    // An old (unused) code no longer works; a fresh one does.
    const oldCode = backupCodes[2]!;
    const p1 = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    expect((await verify2fa(p1, oldCode)).statusCode).toBe(401);
    const p2 = JSON.parse((await login(TEST_EMAIL, PASSWORD)).body).data.pending_token as string;
    expect((await verify2fa(p2, fresh[0]!)).statusCode).toBe(200);
  });

  it('regenerate requires the correct password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/backup-codes/regenerate',
      headers: authHeaders(userToken),
      payload: { password: 'not-the-password-1' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('disable requires the correct password, then login is password-only again', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/disable',
      headers: authHeaders(userToken),
      payload: { password: 'not-the-password-1' },
    });
    expect(wrong.statusCode).toBe(422);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/2fa/totp/disable',
      headers: authHeaders(userToken),
      payload: { password: PASSWORD },
    });
    expect(res.statusCode).toBe(200);

    const loginRes = await login(TEST_EMAIL, PASSWORD);
    const data = JSON.parse(loginRes.body).data;
    expect(data.access_token).toBeDefined();
    expect(data.requires_2fa).toBeUndefined();

    // Secret and backup codes are gone.
    const row = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(row.totpSecretEnc).toBeNull();
    expect(row.totpEnabledAt).toBeNull();
    expect(row.twoFactorEnabled).toBe(false);
    expect(await prisma.userBackupCode.count({ where: { userId } })).toBe(0);
  });
});
