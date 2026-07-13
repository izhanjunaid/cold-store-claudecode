import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, sentMails } from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let accountantToken: string;

const emailPayload = (over: Record<string, unknown>) => ({
  settings: {
    email: {
      enabled: false,
      smtp_host: 'smtp.gmail.com',
      smtp_port: 587,
      smtp_secure: false,
      smtp_user: 'test@coldchain.pk',
      from_name: 'ColdChain',
      admin_email: 'admin@coldchain.pk',
      ...over,
    },
  },
});

const patchEmail = (over: Record<string, unknown>) =>
  app.inject({ method: 'PATCH', url: '/v1/facilities/me', headers: authHeaders(ownerToken), payload: emailPayload(over) });

const sendNow = (token: string) =>
  app.inject({ method: 'POST', url: '/v1/notifications/digest/send-now', headers: authHeaders(token), payload: {} });

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
});

afterEach(() => {
  sentMails.length = 0;
});

afterAll(async () => {
  await patchEmail({ enabled: false }); // leave the shared facility with email off
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Notifications — daily digest', () => {
  it('send-now requires settings.manage (ACCOUNTANT denied 403)', async () => {
    const res = await sendNow(accountantToken);
    expect(res.statusCode).toBe(403);
  });

  it('reports not-configured (no email sent) when email is disabled', async () => {
    await patchEmail({ enabled: false });
    const res = await sendNow(ownerToken);
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body).data;
    expect(body.sent).toBe(false);
    expect(body.reason).toMatch(/not configured/i);
    expect(sentMails).toHaveLength(0);
  });

  it('sends the digest to the admin email when configured', async () => {
    await patchEmail({ enabled: true, admin_email: 'digest@coldchain.pk', smtp_password: 'app-pass-123' });

    const res = await sendNow(ownerToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sent).toBe(true);

    expect(sentMails).toHaveLength(1);
    const mail = sentMails[0]!;
    expect(mail.to).toBe('digest@coldchain.pk');
    expect(mail.subject).toMatch(/daily digest/i);
    expect(mail.html.length).toBeGreaterThan(0);
  });
});
