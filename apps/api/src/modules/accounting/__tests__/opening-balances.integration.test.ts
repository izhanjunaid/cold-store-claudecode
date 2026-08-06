/**
 * Gap 1 (docs/16_accounting_module_audit.md) — guided opening balances:
 * one balanced JE (per-party AR + cash/bank + other BS lines + equity plug
 * to 3010), one-shot unless reversed, and visible end-to-end: party
 * statement, AR aging, and on-account payment recovery all pick it up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let operatorToken: string;
let farmerId: string;
let traderId: string;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    const openingEntries = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: { in: ['opening_balances'] } },
      select: { id: true },
    });
    const ids = openingEntries.map((e) => e.id);
    // Their reversals reference them via sourceId.
    const reversals = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'journal_entries', sourceId: { in: ids } },
      select: { id: true },
    });
    const allIds = [...ids, ...reversals.map((r) => r.id)];
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: allIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: allIds } } });
    if (farmerId) {
      const payments = await prisma.payment.findMany({
        where: { facilityId: TEST_FACILITY_ID, partyId: farmerId },
        select: { id: true, journalEntryId: true },
      });
      await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
      await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
      const jeIds = payments.map((p) => p.journalEntryId).filter((x): x is string => x !== null);
      await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
      await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    }
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;

  const mk = async (name: string, type: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/parties',
      headers: authHeaders(operatorToken),
      payload: {
        name,
        party_type: type,
        phone_primary: `0300${Date.now() % 10000000}`.slice(0, 11),
        credit_terms_days: 30,
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data.id as string;
  };
  farmerId = await mk(`OB Farmer ${Date.now()}`, 'FARMER');
  traderId = await mk(`OB Trader ${Date.now()}`, 'TRADER');
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

function enter(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/v1/accounting/opening-balances',
    headers: authHeaders(token),
    payload: body,
  });
}

function status(token: string) {
  return app.inject({
    method: 'GET',
    url: '/v1/accounting/opening-balances',
    headers: authHeaders(token),
  });
}

const FULL_BODY = () => ({
  as_of_date: '2026-01-01',
  party_receivables: [
    { party_id: farmerId, amount_pkr: 40000 },
    { party_id: traderId, amount_pkr: 25000 },
  ],
  cash_pkr: 12000,
  bank_pkr: 88000,
  other_lines: [
    { account_code: '1310', debit_pkr: 200000, credit_pkr: 0, description: 'Plant at book value' },
  ],
});

describe('Gap 1 · opening balances', () => {
  it('reports not-entered before any entry exists', async () => {
    const res = await status(accountantToken);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.entered).toBe(false);
  });

  it('rejects an entry with nothing to post', async () => {
    const res = await enter(managerToken, { as_of_date: '2026-01-01' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects per-party AR codes smuggled through other_lines', async () => {
    const res = await enter(managerToken, {
      as_of_date: '2026-01-01',
      other_lines: [{ account_code: '1110', debit_pkr: 5000, credit_pkr: 0 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a P&L-class account in other_lines (phase/19)', async () => {
    const res = await enter(managerToken, {
      as_of_date: '2026-01-01',
      other_lines: [{ account_code: '4010', debit_pkr: 0, credit_pkr: 5000, description: 'bad revenue opening' }],
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects the 3010 plug account entered directly in other_lines (phase/19)', async () => {
    const res = await enter(managerToken, {
      as_of_date: '2026-01-01',
      other_lines: [{ account_code: '3010', debit_pkr: 0, credit_pkr: 5000 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a header account in other_lines (phase/19)', async () => {
    const res = await enter(managerToken, {
      as_of_date: '2026-01-01',
      other_lines: [{ account_code: '1000', debit_pkr: 5000, credit_pkr: 0 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it('ACCOUNTANT cannot enter opening balances', async () => {
    const res = await enter(accountantToken, FULL_BODY());
    expect(res.statusCode).toBe(403);
  });

  it('MANAGER posts one balanced entry with per-party AR lines and an equity plug to 3010', async () => {
    const res = await enter(managerToken, FULL_BODY());
    expect(res.statusCode).toBe(201);
    const je = JSON.parse(res.body).data;

    expect(je.posting_status).toBe('POSTED');
    expect(je.book_type).toBe('PACCI');
    expect(je.source_table).toBe('opening_balances');
    expect(je.entry_date).toBe('2026-01-01');
    expect(je.total_debit_pkr).toBe(365000);
    expect(je.total_credit_pkr).toBe(365000);

    const farmerLine = je.lines.find((l: any) => l.party_id === farmerId);
    expect(farmerLine.account_code).toBe('1110');
    expect(farmerLine.debit_amount).toBe(40000);
    const traderLine = je.lines.find((l: any) => l.party_id === traderId);
    expect(traderLine.account_code).toBe('1120');
    expect(traderLine.debit_amount).toBe(25000);

    const plug = je.lines.find((l: any) => l.account_code === '3010');
    expect(plug.credit_amount).toBe(365000);
  });

  it('status flips to entered with the entry reference', async () => {
    const res = await status(accountantToken);
    const data = JSON.parse(res.body).data;
    expect(data.entered).toBe(true);
    expect(data.journal_entry_id).toBeTruthy();
    expect(data.as_of_date).toBe('2026-01-01');
  });

  it('a second entry is rejected while the first stands', async () => {
    const res = await enter(managerToken, FULL_BODY());
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('OPENING_BALANCES_ALREADY_ENTERED');
  });

  it('party statement carries the opening balance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${farmerId}`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    const opening = data.entries.find((e: any) => e.type === 'OPENING_BALANCE');
    expect(opening).toBeTruthy();
    expect(opening.debit_pkr).toBe(40000);
    expect(data.closing_balance_pkr).toBe(40000);
  });

  it('AR aging includes the opening due', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/reports/receivables-aging?party_id=${farmerId}`,
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body).data;
    expect(data.buckets.total_pkr).toBe(40000);
    const row = data.parties.find((p: any) => p.party_id === farmerId);
    expect(row.total_due_pkr).toBe(40000);
  });

  it('an on-account payment settles the opening due in aging and on the statement', async () => {
    const pay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: farmerId,
        payment_date: '2026-07-01',
        amount_pkr: 15000,
        payment_method: 'CASH',
        allocations: [],
      },
    });
    expect(pay.statusCode).toBe(201);

    const aging = await app.inject({
      method: 'GET',
      url: `/v1/reports/receivables-aging?party_id=${farmerId}`,
      headers: authHeaders(accountantToken),
    });
    const data = JSON.parse(aging.body).data;
    expect(data.buckets.total_pkr).toBe(25000);

    const stmt = await app.inject({
      method: 'GET',
      url: `/v1/reports/party-statement/${farmerId}`,
      headers: authHeaders(accountantToken),
    });
    expect(JSON.parse(stmt.body).data.closing_balance_pkr).toBe(25000);
  });

  it('reversing the opening entry re-arms the flow', async () => {
    const st = JSON.parse((await status(accountantToken)).body).data;
    const reverse = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${st.journal_entry_id}/reverse`,
      headers: authHeaders(managerToken),
      payload: { reason: 'balances keyed from the wrong register' },
    });
    expect(reverse.statusCode).toBe(201);

    const after = JSON.parse((await status(accountantToken)).body).data;
    expect(after.entered).toBe(false);

    const again = await enter(managerToken, FULL_BODY());
    expect(again.statusCode).toBe(201);
  });

  // The one-shot check is a read-then-write with no unique constraint behind it
  // (@@index([sourceTable, sourceId]) is not unique), so only the advisory lock
  // stops two concurrent entries. Both would post, both would be immutable by
  // trigger, and every opening balance would be permanently doubled.
  //
  // Assert the LOSER: "both succeeded" is exactly what let the lot-number
  // concurrency test stay green for years while its lock did nothing.
  it('serialises concurrent entries — exactly one wins, the other 409s', async () => {
    await cleanup();
    expect(JSON.parse((await status(accountantToken)).body).data.entered).toBe(false);

    const results = await Promise.all([
      enter(managerToken, FULL_BODY()),
      enter(managerToken, FULL_BODY()),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409]);

    // The assertion that actually matters: one entry on the ledger, not two.
    const posted = await prisma.journalEntry.count({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'opening_balances', postingStatus: 'POSTED' },
    });
    expect(posted).toBe(1);
  });
});
