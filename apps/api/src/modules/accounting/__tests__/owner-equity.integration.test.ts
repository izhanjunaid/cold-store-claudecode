/**
 * An owner putting money in or taking it out — a document now (docs/25 L-23).
 *
 * The request names the partner and the direction; the server derives the
 * equity account from the partner row (capital for CAPITAL_IN, drawings for
 * DRAWING). It used to take the account separately, so a "capital in" could
 * credit a drawings account and a drawing could debit the plug. The cash side
 * must be an account the chart flags as cash, so an owner's second bank account
 * works and cheques in hand do not.
 *
 * And an owner's pay is not a business cost (ITO 2001 s.21(j)): a withdrawal
 * must never move net profit.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

// Its own year, so no other suite's postings fall inside the window.
const FROM = '2046-01-01';
const TO = '2046-12-31';
// An owner's second bank account, flagged as cash when it is opened.
const SECOND_BANK = '1297';

let app: FastifyInstance;
let token: string;
let partner: { id: string; capital: string; drawings: string };
const manualEntryIds: string[] = [];

const post = (body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/v1/accounting/owner-equity', headers: authHeaders(token), payload: body });

const get = async (url: string) => (await app.inject({ method: 'GET', url, headers: authHeaders(token) })).json().data;

const movement = (overrides: Record<string, unknown>) => ({
  partner_id: partner.id,
  movement_date: '2046-03-01',
  direction: 'DRAWING',
  cash_account_code: '1020',
  amount_pkr: 60000,
  ...overrides,
});

const linesOf = (res: { json: () => { data: { lines: { account_code: string; debit_amount: number; credit_amount: number }[] } } }) =>
  res.json().data.lines;

beforeAll(async () => {
  app = await getTestApp();
  token = (await loginAsRole(app, 'OWNER')).accessToken;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/partners',
    headers: authHeaders(token),
    payload: { name: `Owner C ${Date.now()}`, admitted_on: FROM },
  });
  expect(created.statusCode, created.body).toBe(201);
  const row = await prisma.partner.findUniqueOrThrow({ where: { id: created.json().data.id } });
  partner = { id: row.id, capital: row.capitalAccountCode, drawings: row.drawingsAccountCode };

  const bank = await app.inject({
    method: 'POST',
    url: '/v1/accounting/accounts',
    headers: authHeaders(token),
    payload: {
      account_code: SECOND_BANK,
      account_name: 'Bank Account — Owner equity test',
      account_class: 'ASSET',
      account_type: 'DETAIL',
      parent_account_code: '1000',
      is_cash_equivalent: true,
    },
  });
  expect(bank.statusCode, bank.body).toBe(201);
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const movements = await prisma.ownerEquityMovement.findMany({ where: { partnerId: partner.id } });
    const docEntries = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'owner_equity_movements', sourceId: { in: movements.map((m) => m.id) } },
      select: { id: true },
    });
    const ids = [...docEntries.map((e) => e.id), ...manualEntryIds];
    const reversals = await prisma.journalEntry.findMany({ where: { id: { in: ids } }, select: { reversedById: true } });
    const all = [...ids, ...reversals.map((r) => r.reversedById).filter((x): x is string => !!x)];
    await prisma.ownerEquityMovement.deleteMany({ where: { partnerId: partner.id } });
    await prisma.journalEntry.updateMany({ where: { id: { in: all } }, data: { reversedById: null } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: all } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: all } } });
    await prisma.partner.delete({ where: { id: partner.id } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: { in: [partner.capital, partner.drawings, SECOND_BANK] } },
    });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the account is derived from the partner and the direction (L-23)', () => {
  it('books a drawing as DR the partner’s drawings / CR bank, as an owner-equity document', async () => {
    const res = await post(movement({ note: 'March monthly withdrawal' }));
    expect(res.statusCode, res.body).toBe(201);
    const je = res.json().data;
    expect(je.entry_type).toBe('OWNER_EQUITY');
    expect(je.source_table).toBe('owner_equity_movements');
    const doc = await prisma.ownerEquityMovement.findFirstOrThrow({ where: { journalEntryId: je.id } });
    expect(je.source_id).toBe(doc.id);
    expect(linesOf(res).find((l: { account_code: string }) => l.account_code === partner.drawings)!.debit_amount).toBe(60000);
    expect(linesOf(res).find((l: { account_code: string }) => l.account_code === '1020')!.credit_amount).toBe(60000);
  });

  it('books capital in as DR bank / CR the partner’s capital', async () => {
    const res = await post(movement({ direction: 'CAPITAL_IN', movement_date: '2046-02-01', amount_pkr: 400000 }));
    expect(res.statusCode, res.body).toBe(201);
    expect(linesOf(res).find((l: { account_code: string }) => l.account_code === partner.capital)!.credit_amount).toBe(400000);
  });

  it('takes money through an owner’s second bank account — cash is a flag, not a list', async () => {
    const res = await post(movement({ cash_account_code: SECOND_BANK, amount_pkr: 1000, movement_date: '2046-03-02' }));
    expect(res.statusCode, res.body).toBe(201);
  });

  it('refuses a cash side the chart does not flag as cash — cheques in hand can bounce', async () => {
    const res = await post(movement({ cash_account_code: '1025' }));
    expect(res.statusCode).toBe(400);
  });

  it('refuses an owner who does not exist', async () => {
    const res = await post(movement({ partner_id: '00000000-0000-0000-0000-00000000dead' }));
    expect(res.statusCode).toBe(404);
  });

  it('shows each movement in the owner’s own column', async () => {
    const d = await get(`/v1/accounting/changes-in-equity?date_from=${FROM}&date_to=${TO}`);
    const col = (code: string) => d.columns.find((c: { account_code: string }) => c.account_code === code);
    expect(col(partner.capital).capital_introduced_pkr).toBe(400000);
    expect(col(partner.drawings).drawings_pkr).toBe(-61000);
    expect(d.is_reconciled).toBe(true);
  });
});

describe('a movement is voided through its own reversal', () => {
  it('voids once — the reversal nets it out and a second void is refused', async () => {
    const res = await post(movement({ amount_pkr: 5000, movement_date: '2046-04-01' }));
    expect(res.statusCode).toBe(201);
    const doc = await prisma.ownerEquityMovement.findFirstOrThrow({ where: { journalEntryId: res.json().data.id } });

    const before = await get(`/v1/accounting/balance-sheet?as_of_date=${TO}`);
    const voidIt = () =>
      app.inject({
        method: 'POST',
        url: `/v1/accounting/owner-equity/${doc.id}/void`,
        headers: authHeaders(token),
        payload: { reason: 'keyed twice', date: '2046-04-02' },
      });
    // Two at once: exactly one wins, the other is refused (row lock first).
    const codes = (await Promise.all([voidIt(), voidIt()])).map((r) => r.statusCode).sort();
    expect(codes[0]).toBe(200);
    expect(codes[1]).toBeGreaterThanOrEqual(400);

    const after = await get(`/v1/accounting/balance-sheet?as_of_date=${TO}`);
    expect(after.total_equity_pkr - before.total_equity_pkr).toBeCloseTo(5000, 2);
    const voided = await prisma.ownerEquityMovement.findUniqueOrThrow({ where: { id: doc.id } });
    expect(voided.voidedAt).not.toBeNull();
    expect(voided.voidReason).toBe('keyed twice');
    expect(await prisma.journalEntry.count({ where: { sourceTable: 'owner_equity_movements', sourceId: doc.id } })).toBe(2);
  });

  it('lists the movements with their status', async () => {
    const list = await get(`/v1/accounting/owner-equity?partner_id=${partner.id}`);
    expect(list.length).toBeGreaterThanOrEqual(4);
    expect(list.some((m: { voided_at: string | null }) => m.voided_at !== null)).toBe(true);
  });
});

describe('an owner’s pay is not a business cost (ITO 2001 s.21(j))', () => {
  it('does NOT change net profit, however regular the withdrawal', async () => {
    const before = (await get(`/v1/accounting/profit-loss?date_from=${FROM}&date_to=${TO}`)).net_profit_pkr;
    const res = await post(movement({ movement_date: '2046-05-01', note: 'May monthly withdrawal' }));
    expect(res.statusCode).toBe(201);
    expect((await get(`/v1/accounting/profit-loss?date_from=${FROM}&date_to=${TO}`)).net_profit_pkr).toBe(before);
  });
});

describe('attributing opening equity to an owner (L-32)', () => {
  it('moves the plug into the owner’s capital, and refuses more than the plug holds', async () => {
    // Opening equity booked to the plug, as the opening-balance entry leaves it.
    const plugged = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(token),
      payload: {
        entry_date: '2046-06-01',
        description: 'owner-equity test: opening equity in the plug',
        lines: [
          { account_code: '1010', debit_amount: 7000, credit_amount: 0 },
          { account_code: '3010', debit_amount: 0, credit_amount: 7000 },
        ],
      },
    });
    expect(plugged.statusCode, plugged.body).toBe(201);
    manualEntryIds.push(plugged.json().data.id);

    const plug = async () =>
      (await get('/v1/accounting/balance-sheet?as_of_date=2046-12-31')).unattributed_opening_equity_pkr as number;
    const plugBefore = await plug();

    const attribute = (amount: number) =>
      app.inject({
        method: 'POST',
        url: `/v1/partners/${partner.id}/attribute-opening-equity`,
        headers: authHeaders(token),
        payload: { amount_pkr: amount, date: '2046-06-02' },
      });

    expect((await attribute(plugBefore + 1)).statusCode).toBe(400);

    const res = await attribute(7000);
    expect(res.statusCode, res.body).toBe(201);
    manualEntryIds.push(res.json().data.id);
    expect(await plug()).toBeCloseTo(plugBefore - 7000, 2);

    // A reclass between two columns, not capital anybody introduced.
    const d = await get('/v1/accounting/changes-in-equity?date_from=2046-06-01&date_to=2046-06-30');
    const col = (code: string) => d.columns.find((c: { account_code: string }) => c.account_code === code);
    expect(col(partner.capital).other_movements_pkr).toBe(7000);
    expect(col(partner.capital).capital_introduced_pkr).toBe(0);
  });
});
