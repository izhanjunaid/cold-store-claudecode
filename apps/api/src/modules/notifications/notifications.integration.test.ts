import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { PrismaClient } from '@coldchain/db';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, sentMails } from '../../test/helpers';

const prisma = new PrismaClient();
let app: FastifyInstance;
let ownerToken: string;
let accountantToken: string;
let operatorToken: string;
let managerToken: string;

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN = '00000000-0000-0000-0000-000000000500';

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
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
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

  it('includes an Unbilled Invoices section when a transfer-accrued DRAFT invoice exists', async () => {
    await patchEmail({ enabled: true, admin_email: 'digest-unbilled@coldchain.pk', smtp_password: 'app-pass-123' });

    const stamp = Date.now();
    const fromParty = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: { name: `DigestFrom-${stamp}`, party_type: 'FARMER', phone_primary: `0300${stamp % 10000000}`, credit_terms_days: 30 },
    });
    const toParty = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: { name: `DigestTo-${stamp}`, party_type: 'TRADER', phone_primary: `0301${stamp % 10000000}`, credit_terms_days: 30 },
    });
    const fromPartyId = JSON.parse(fromParty.body).data.id;
    const toPartyId = JSON.parse(toParty.body).data.id;

    const lotRes = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload: {
        owner_party_id: fromPartyId,
        commodity_id: POTATO_ID,
        rate_plan_id: RATE_PLAN,
        chamber_id: CHAMBER_A,
        quantity_bags: 5,
        accepted_weight_kg: 100,
        inbound_date: '2026-01-01',
      },
    });
    expect(lotRes.statusCode).toBe(201);
    const lotId = JSON.parse(lotRes.body).data.id;

    const transferRes = await app.inject({
      method: 'POST',
      url: `/v1/lots/${lotId}/transfer`,
      headers: authHeaders(managerToken),
      payload: { transfer_type: 'FULL', to_party_id: toPartyId, effective_date: '2026-02-01' },
    });
    expect(transferRes.statusCode).toBe(201);

    const res = await sendNow(ownerToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.sent).toBe(true);

    const mail = sentMails[sentMails.length - 1]!;
    expect(mail.html).toMatch(/unbilled/i);
  });
});
