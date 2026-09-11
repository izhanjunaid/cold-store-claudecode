/**
 * Whose the period's result is — end to end.
 *
 * Before this, `getChangesInEquity` returned `result_pkr: 0` on every partner
 * column with `result_is_unallocated` hardcoded true. IFRS for SMEs 4.13 asks for
 * the changes in *each* category of equity, and the largest change of all — the
 * result — reached no owner at all.
 *
 * The allocation is disclosed beside the columns, never folded into them: nothing
 * is posted, so no partner's account balance has moved, and folding it in would
 * make this statement disagree with the balance sheet about the same accounts.
 * The invariant that guards it is that total equity is untouched.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let token: string;
let aliceId: string;
let bilalId: string;

// A year of its own, so no other suite's postings land inside the window.
const FROM = '2047-01-01';
const TO = '2047-12-31';
const ENTRY_PREFIX = 'ALLOC-';
const MARK = 'ALLOCTEST';

/** A balanced revenue entry — fixture, not the thing under test. */
async function earn(entryNumber: string, date: string, amount: number) {
  const d = new Date(date);
  const user = await prisma.user.findFirstOrThrow({
    where: { facilityId: TEST_FACILITY_ID },
    select: { id: true },
  });
  await prisma.journalEntry.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      entryNumber,
      entryDate: d,
      entryType: 'ADJUSTMENT',
      bookType: 'PACCI',
      sourceTable: 'manual',
      sourceId: TEST_FACILITY_ID,
      description: 'allocation fixture',
      postingStatus: 'POSTED',
      periodYear: d.getUTCFullYear(),
      periodMonth: d.getUTCMonth() + 1,
      createdBy: user.id,
      lines: {
        create: [
          { lineNumber: 1, facilityId: TEST_FACILITY_ID, accountCode: '1010', debitAmount: amount, creditAmount: 0, description: 'fixture' },
          { lineNumber: 2, facilityId: TEST_FACILITY_ID, accountCode: '4050', debitAmount: 0, creditAmount: amount, description: 'fixture' },
        ],
      },
    },
  });
}

const equity = async (from = FROM, to = TO) =>
  JSON.parse(
    (
      await app.inject({
        method: 'GET',
        url: `/v1/accounting/changes-in-equity?date_from=${from}&date_to=${to}`,
        headers: authHeaders(token),
      })
    ).body,
  ).data;

const setRatio = (effective_from: string, shares: { partner_id: string; weight: number }[]) =>
  app.inject({
    method: 'PUT',
    url: '/v1/partners/profit-shares',
    headers: authHeaders(token),
    payload: { effective_from, shares },
  });

const clearRatios = () =>
  prisma.partnerProfitShare.deleteMany({
    where: { facilityId: TEST_FACILITY_ID, partner: { name: { startsWith: MARK } } },
  });

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    const ids = (
      await prisma.journalEntry.findMany({
        where: { facilityId: TEST_FACILITY_ID, entryNumber: { startsWith: ENTRY_PREFIX } },
        select: { id: true },
      })
    ).map((e) => e.id);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });

    const partners = await prisma.partner.findMany({
      where: { facilityId: TEST_FACILITY_ID, name: { startsWith: MARK } },
      select: { id: true },
    });
    await prisma.partnerProfitShare.deleteMany({ where: { partnerId: { in: partners.map((p) => p.id) } } });
    await prisma.partner.deleteMany({ where: { id: { in: partners.map((p) => p.id) } } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountName: { startsWith: MARK } },
    });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  token = (await loginAsRole(app, 'OWNER')).accessToken;
  await cleanup();

  const add = async (name: string) => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/partners',
      headers: authHeaders(token),
      payload: { name, admitted_on: '2047-01-01' },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data.id as string;
  };
  aliceId = await add(`${MARK} Alice`);
  bilalId = await add(`${MARK} Bilal`);

  // 1,000,000 earned evenly: half before 1 July, half after.
  await earn(`${ENTRY_PREFIX}H1`, '2047-03-01', 500000);
  await earn(`${ENTRY_PREFIX}H2`, '2047-09-01', 500000);
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the result reaches the owners', () => {
  it('says so plainly when no ratio has ever been agreed', async () => {
    await clearRatios();
    const d = await equity();
    expect(d.result_allocation).toBeNull();
    expect(d.result_is_unallocated).toBe(true);
  });

  it('divides the whole period once a ratio covers it', async () => {
    await clearRatios();
    expect((await setRatio('2047-01-01', [
      { partner_id: aliceId, weight: 3 },
      { partner_id: bilalId, weight: 1 },
    ])).statusCode).toBe(200);

    const d = await equity();
    expect(d.result_is_unallocated).toBe(false);
    expect(d.result_allocation.unallocated_pkr).toBe(0);

    const byId = new Map<string, number>(
      d.result_allocation.by_partner.map((p: { partner_id: string; amount_pkr: number }) => [
        p.partner_id,
        p.amount_pkr,
      ]),
    );
    expect(byId.get(aliceId)).toBe(750000);
    expect(byId.get(bilalId)).toBe(250000);
  });

  // The answer to "will I have to move shares by hand when a partner joins".
  it('splits at the date the ratio changed, without anyone doing it by hand', async () => {
    await clearRatios();
    await setRatio('2047-01-01', [{ partner_id: aliceId, weight: 1 }]);
    await setRatio('2047-07-01', [
      { partner_id: aliceId, weight: 1 },
      { partner_id: bilalId, weight: 1 },
    ]);

    const d = await equity();
    const byId = new Map<string, number>(
      d.result_allocation.by_partner.map((p: { partner_id: string; amount_pkr: number }) => [
        p.partner_id,
        p.amount_pkr,
      ]),
    );
    // 500,000 earned before 1 July, all Alice's. 500,000 after, split evenly.
    expect(byId.get(aliceId)).toBe(750000);
    expect(byId.get(bilalId)).toBe(250000);

    expect(d.result_allocation.windows).toHaveLength(2);
    expect(d.result_allocation.windows.map((w: { to: string }) => w.to)).toEqual([
      '2047-06-30',
      '2047-12-31',
    ]);
  });

  it('leaves the stretch before the first ratio undivided, and says it is', async () => {
    await clearRatios();
    await setRatio('2047-07-01', [
      { partner_id: aliceId, weight: 1 },
      { partner_id: bilalId, weight: 1 },
    ]);

    const d = await equity();
    // Profit earned before the owners agreed anything must not be divided on a
    // ratio that did not exist yet.
    expect(d.result_allocation.unallocated_pkr).toBe(500000);
    expect(d.result_is_unallocated).toBe(true);
    const total = d.result_allocation.by_partner.reduce(
      (t: number, p: { amount_pkr: number }) => t + p.amount_pkr,
      0,
    );
    expect(total).toBe(500000);
  });

  /**
   * The invariant that makes disclosure safe. Allocation says whose the result
   * is; it must not move a rupee. If this ever fails, the statement is claiming
   * equity that the accounts do not support.
   */
  it('changes no total — the statement still foots to equity', async () => {
    await clearRatios();
    const before = await equity();
    await setRatio('2047-01-01', [
      { partner_id: aliceId, weight: 2 },
      { partner_id: bilalId, weight: 1 },
    ]);
    const after = await equity();

    expect(after.total_closing_pkr).toBe(before.total_closing_pkr);
    expect(after.total_result_pkr).toBe(before.total_result_pkr);
    expect(after.is_reconciled).toBe(true);
    expect(before.is_reconciled).toBe(true);
  });

  it('adds up to the period result exactly, odd paisa included', async () => {
    await clearRatios();
    // Three equal ways into 1,000,000 does not divide evenly.
    const third = await app.inject({
      method: 'POST',
      url: '/v1/partners',
      headers: authHeaders(token),
      payload: { name: `${MARK} Chand`, admitted_on: '2047-01-01' },
    });
    const chandId = JSON.parse(third.body).data.id as string;

    await setRatio('2047-01-01', [
      { partner_id: aliceId, weight: 1 },
      { partner_id: bilalId, weight: 1 },
      { partner_id: chandId, weight: 1 },
    ]);

    const d = await equity();
    const total = d.result_allocation.by_partner.reduce(
      (t: number, p: { amount_pkr: number }) => t + p.amount_pkr,
      0,
    );
    expect(total).toBe(1000000);
    expect(d.result_allocation.unallocated_pkr).toBe(0);
  });
});
