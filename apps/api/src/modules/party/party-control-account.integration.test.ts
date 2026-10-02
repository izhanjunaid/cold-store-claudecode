import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { withGuardsDisabled } from '../../test/financial-guards';

/**
 * docs/25 R-01: a party's receivable account is stamped once, at creation, and
 * every posting reads it off the party row — never off the party's current type.
 * A FARMER retyped to TRADER used to have its invoice on 1110 and its payment on
 * 1120: 1110 stayed debit forever and 1120 went negative.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let accountantToken: string;
let operatorToken: string;
const created: string[] = [];

async function createParty(name: string, partyType: string, phone: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name, party_type: partyType, phone_primary: phone, credit_terms_days: 30 },
  });
  expect(res.statusCode).toBe(201);
  const party = JSON.parse(res.body).data;
  created.push(party.id);
  return party;
}

async function payOnAccount(partyId: string, amount: number) {
  return app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(accountantToken),
    payload: { party_id: partyId, payment_date: '2026-05-10', amount_pkr: amount, payment_method: 'CASH' },
  });
}

async function arLinesFor(partyId: string) {
  return prisma.journalEntryLine.findMany({
    where: { facilityId: TEST_FACILITY_ID, partyId, creditAmount: { gt: 0 } },
    select: { accountCode: true, creditAmount: true },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, lines: { some: { partyId: { in: created } } } },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
    await prisma.payment.updateMany({ where: { partyId: { in: created } }, data: { journalEntryId: null } });
    await prisma.journalEntry.updateMany({ where: { id: { in: ids } }, data: { reversedById: null } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { partyId: { in: created } } } });
    await prisma.payment.deleteMany({ where: { partyId: { in: created } } });
    await prisma.party.deleteMany({ where: { id: { in: created } } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('party control account (R-01)', () => {
  it('is stamped from the type at creation and re-stamped on a retype before any posting', async () => {
    const party = await createParty('CA Farmer Fresh', 'FARMER', '03009990001');
    expect(party.control_account_code).toBe('1110');

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/parties/${party.id}`,
      headers: authHeaders(operatorToken),
      payload: { party_type: 'TRADER' },
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.control_account_code).toBe('1120');
  });

  it('refuses a retype once the party has any journal line', async () => {
    const party = await createParty('CA Farmer Posted', 'FARMER', '03009990002');
    expect((await payOnAccount(party.id, 500)).statusCode).toBe(201);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/parties/${party.id}`,
      headers: authHeaders(operatorToken),
      payload: { party_type: 'TRADER' },
    });
    expect(res.statusCode).toBe(400);
    const detail = await app.inject({ method: 'GET', url: `/v1/parties/${party.id}`, headers: authHeaders(operatorToken) });
    expect(JSON.parse(detail.body).data.can_change_type).toBe(false);
    const row = await prisma.party.findUniqueOrThrow({ where: { id: party.id } });
    expect(row.partyType).toBe('FARMER');
    expect(row.controlAccountCode).toBe('1110');
  });

  it('posts to the stamped account even when the type says otherwise (legacy retype)', async () => {
    const party = await createParty('CA Legacy Retyped', 'FARMER', '03009990003');
    // The state an older image left behind: retyped after posting, account unchanged.
    await prisma.party.update({ where: { id: party.id }, data: { partyType: 'TRADER' } });

    expect((await payOnAccount(party.id, 700)).statusCode).toBe(201);
    const lines = await arLinesFor(party.id);
    expect(lines.map((l) => l.accountCode)).toEqual(['1110']);
  });

  it('refuses a customer receipt from a supplier', async () => {
    const supplier = await createParty('CA Supplier', 'SUPPLIER', '03009990004');
    expect(supplier.control_account_code).toBe('2050');
    const res = await payOnAccount(supplier.id, 100);
    expect(res.statusCode).toBe(400);
  });

  it('refuses a peshgi to a supplier', async () => {
    const supplier = await createParty('CA Supplier Loan', 'SUPPLIER', '03009990005');
    const owner = (await loginAsRole(app, 'OWNER')).accessToken;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/loans/issue',
      headers: authHeaders(owner),
      payload: { party_id: supplier.id, issue_date: '2026-05-10', principal_pkr: 100, payment_method: 'CASH' },
    });
    expect(res.statusCode).toBe(400);
  });
});
