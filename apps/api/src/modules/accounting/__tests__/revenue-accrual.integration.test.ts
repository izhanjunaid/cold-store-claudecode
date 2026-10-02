/**
 * Storage revenue is accrued month by month as it is earned — the fixed policy
 * from `revenue_accrual.start_date` (docs/25 Q2, L-04, R-16). The accrual is posted
 * by the month lock, together with its reversal dated the first of the next month:
 * a month cannot close without it, and no accrual can be left standing next to
 * the invoice that eventually bills the storage.
 *
 * The property under test is that **each month gets its own share** and that the
 * accruals and the eventual invoice converge exactly, leaving 1250 at zero.
 *
 * Isolation: the lots bill to their own revenue account (4099, created here) and
 * the months closed are in 2023–2024, which no other suite posts to; every lock
 * is removed afterwards.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { JournalEntryService } from '../journal-entry.service';
import { PeriodLockService } from '../period-lock.service';

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000300';
const REVENUE_ACCOUNT = '4099';
const BAGS = 10;
const RATE_PER_BAG_PER_DAY = 1;
const YEAR = 2024;

let app: FastifyInstance;
let ownerToken: string;
let dailyPlanId: string;
let seasonalNoEndPlanId: string;
let partyId: string;
let originalSettings: unknown;

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** What a month earned on the test's own revenue account, from the GL endpoint. */
async function revenueIn(year: number, month: number): Promise<number> {
  const from = iso(new Date(Date.UTC(year, month - 1, 1)));
  const to = iso(lastDay(year, month));
  const res = await app.inject({
    method: 'GET',
    url: `/v1/accounting/general-ledger?account_code=${REVENUE_ACCOUNT}&date_from=${from}&date_to=${to}`,
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  const gl = JSON.parse(res.body).data;
  return Math.round((gl.total_credit_pkr - gl.total_debit_pkr) * 100) / 100;
}

/** 1250 for one lot (every 1250 line carries its lot), optionally as of a date. */
async function accruedBalanceForLot(lotId: string, asOf?: Date): Promise<number> {
  const agg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId: TEST_FACILITY_ID,
      accountCode: '1250',
      lotId,
      journalEntry: { postingStatus: 'POSTED', ...(asOf ? { entryDate: { lte: asOf } } : {}) },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100;
}

const closeMonth = (year: number, month: number) =>
  app.inject({
    method: 'POST',
    url: '/v1/accounting/period-locks',
    headers: authHeaders(ownerToken),
    payload: { period_year: year, period_month: month },
  });

async function setStartDate(start: string | null) {
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } });
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: { ...(facility.settings as object), revenue_accrual: { start_date: start } } },
  });
}

async function createLot(ratePlanId: string, bags: number, inbound: string): Promise<{ id: string; lot_number: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(ownerToken),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: ratePlanId,
      chamber_id: CHAMBER_A,
      quantity_bags: bags,
      accepted_weight_kg: bags * 20,
      inbound_date: inbound,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

async function cleanup() {
  const planIds = (
    await prisma.ratePlan.findMany({
      where: { facilityId: TEST_FACILITY_ID, revenueAccountCode: REVENUE_ACCOUNT },
      select: { id: true },
    })
  ).map((p) => p.id);
  const lotIds = (
    await prisma.lot.findMany({ where: { facilityId: TEST_FACILITY_ID, ratePlanId: { in: planIds } }, select: { id: true } })
  ).map((l) => l.id);

  await withGuardsDisabled(prisma, async () => {
    await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID, periodYear: { in: [YEAR - 1, YEAR] } } });
    const invoices = await prisma.invoice.findMany({ where: { lotId: { in: lotIds } }, select: { id: true } });
    const invIds = invoices.map((i) => i.id);
    await prisma.invoice.updateMany({ where: { id: { in: invIds } }, data: { journalEntryId: null } });
    const entries = await prisma.journalEntry.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        OR: [{ sourceTable: 'revenue_accrual' }, { lines: { some: { accountCode: REVENUE_ACCOUNT } } }],
      },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
    await prisma.journalEntry.updateMany({ where: { id: { in: ids } }, data: { reversedById: null } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
    await prisma.outboundEvent.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotMovement.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotRackPlacement.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.ratePlan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: REVENUE_ACCOUNT } });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  const operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;
  originalSettings = (await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings;
  await cleanup();

  await prisma.chartOfAccounts.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      accountCode: REVENUE_ACCOUNT,
      accountName: 'Storage Revenue — accrual test',
      accountClass: 'REVENUE',
      accountType: 'DETAIL',
      parentAccountCode: '4000',
      normalBalance: 'CREDIT',
    },
  });
  // minBillingDays 1: a higher floor makes the first month legitimately larger.
  dailyPlanId = (
    await prisma.ratePlan.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        name: 'Accrual Test — Daily',
        commodityId: POTATO_ID,
        rateType: 'DAILY_PER_BAG',
        rateAmountPkr: RATE_PER_BAG_PER_DAY,
        minBillingDays: 1,
        revenueAccountCode: REVENUE_ACCOUNT,
      },
    })
  ).id;
  seasonalNoEndPlanId = (
    await prisma.ratePlan.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        name: 'Accrual Test — Seasonal, no end date',
        commodityId: POTATO_ID,
        rateType: 'SEASONAL_PER_BAG',
        rateAmountPkr: 500,
        minBillingDays: 1,
        revenueAccountCode: REVENUE_ACCOUNT,
        seasonStartDate: new Date(`${YEAR}-01-01T00:00:00.000Z`),
        seasonEndDate: null,
      },
    })
  ).id;
  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name: `Accrual Test Farmer ${Date.now()}`, party_type: 'FARMER', phone_primary: `0300${Date.now() % 10000000}`.slice(0, 11), credit_terms_days: 30 },
  });
  expect(party.statusCode).toBe(201);
  partyId = JSON.parse(party.body).data.id;

  await setStartDate(`${YEAR}-01-01`);
});

afterAll(async () => {
  await cleanup();
  await prisma.party.deleteMany({ where: { id: partyId } });
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: originalSettings as never } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('storage revenue lands in the month it was earned', () => {
  let lotId: string;
  let legacyId: string;

  it('reverses an accrual an older version left standing before the first new one', async () => {
    lotId = (await createLot(dailyPlanId, BAGS, `${YEAR}-01-01`)).id;
    // What the pre-policy version could leave behind: an accrual nothing ever reversed.
    const journal = new JournalEntryService(prisma, new PeriodLockService(prisma));
    const owner = await prisma.user.findFirstOrThrow({ where: { facilityId: TEST_FACILITY_ID, role: 'OWNER' } });
    const legacy = await journal.post(TEST_FACILITY_ID, owner.id, {
      entryType: 'ACCRUAL',
      bookType: 'PACCI',
      sourceTable: 'revenue_accrual',
      sourceId: TEST_FACILITY_ID,
      entryDate: new Date(`${YEAR - 1}-12-31T00:00:00.000Z`),
      description: 'legacy accrual',
      lines: [
        { accountCode: '1250', debitAmount: 5, creditAmount: 0 },
        { accountCode: REVENUE_ACCOUNT, debitAmount: 0, creditAmount: 5 },
      ],
    });
    legacyId = legacy.id;

    // A month before the start date closes without an accrual.
    expect((await closeMonth(YEAR - 1, 12)).statusCode).toBe(201);
    expect(
      await prisma.journalEntry.count({ where: { facilityId: TEST_FACILITY_ID, sourceTable: 'revenue_accrual', entryType: 'ACCRUAL', periodYear: YEAR - 1 } }),
    ).toBe(1); // only the legacy one

    expect((await closeMonth(YEAR, 1)).statusCode).toBe(201);
    const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: legacyId } });
    expect(after.reversedById).not.toBeNull();
  });

  it('closing each month accrues its own share, not the whole stay at the end', async () => {
    for (const month of [2, 3, 4, 5]) expect((await closeMonth(YEAR, month)).statusCode).toBe(201);
    const daysIn = (m: number) => new Date(Date.UTC(YEAR, m, 0)).getUTCDate();
    for (const m of [2, 3, 4, 5]) {
      expect(await revenueIn(YEAR, m)).toBeCloseTo(daysIn(m) * BAGS * RATE_PER_BAG_PER_DAY, 2);
    }
  });

  it('holds everything earned so far at each month-end, and nothing once reversed', async () => {
    const days = Math.ceil((Date.UTC(YEAR, 4, 31) - Date.UTC(YEAR, 0, 1)) / 86_400_000);
    expect(await accruedBalanceForLot(lotId, lastDay(YEAR, 5))).toBeCloseTo(days * BAGS * RATE_PER_BAG_PER_DAY, 2);
    expect(await accruedBalanceForLot(lotId)).toBeCloseTo(0, 2);
    const standing = await prisma.journalEntry.count({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'revenue_accrual', entryType: 'ACCRUAL', reversedById: null },
    });
    expect(standing).toBe(0);
  });

  it('a month with a draft invoice cannot close; finalised, the revenue converges with the invoice', async () => {
    const out = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(ownerToken),
      payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: BAGS, outbound_date: `${YEAR}-06-15` },
    });
    expect(out.statusCode).toBe(201);
    const outboundId = JSON.parse(out.body).data.id;
    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${outboundId}/weight`,
      headers: authHeaders(ownerToken),
      payload: { outbound_weight_kg: BAGS * 20 },
    });
    const finOut = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${outboundId}/finalize`,
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(finOut.statusCode).toBe(200);
    const draftId = JSON.parse(finOut.body).data.invoice_id as string;

    expect((await closeMonth(YEAR, 6)).statusCode).toBe(400);

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${draftId}/finalize`,
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);
    const invoice = JSON.parse(fin.body).data;
    expect(invoice.invoice_date).toBe(`${YEAR}-06-15`);
    expect((await closeMonth(YEAR, 6)).statusCode).toBe(201);

    // The accruals redistributed the revenue across the months; they created none.
    let total = 0;
    for (let m = 1; m <= 6; m += 1) total += await revenueIn(YEAR, m);
    // January also carries the legacy accrual's reversal (−5): that was revenue an
    // older version booked in the previous year and never took back.
    expect(total).toBeCloseTo(Number(invoice.sub_total_pkr) - 5, 2);
    expect(await accruedBalanceForLot(lotId)).toBeCloseTo(0, 2);
  });
});

describe('the month lock serialises the accrual', () => {
  it('two closes of the same month: exactly one wins, and one accrual is posted', async () => {
    await createLot(dailyPlanId, 4, `${YEAR}-07-01`);
    const [a, b] = await Promise.all([closeMonth(YEAR, 7), closeMonth(YEAR, 7)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
    const posted = await prisma.journalEntry.count({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'revenue_accrual', entryType: 'ACCRUAL', periodYear: YEAR, periodMonth: 7 },
    });
    expect(posted).toBe(1);
  });
});

describe('what is not accrued, and says so', () => {
  it('a seasonal plan with no season end cannot be spread', async () => {
    const lot = await createLot(seasonalNoEndPlanId, 5, `${YEAR}-08-01`);
    const preview = await app.inject({
      method: 'GET',
      url: `/v1/accounting/revenue-accrual?period_year=${YEAR}&period_month=8`,
      headers: authHeaders(ownerToken),
    });
    expect(preview.statusCode).toBe(200);
    const data = JSON.parse(preview.body).data;
    expect(data.lots.some((l: { lot_number: string }) => l.lot_number === lot.lot_number)).toBe(false);
    const flagged = data.unaccruable.find((u: { lot_number: string }) => u.lot_number === lot.lot_number);
    expect(flagged.reason).toMatch(/season end/i);
  });

  it('no start date: the month closes with no accrual', async () => {
    await setStartDate(null);
    expect((await closeMonth(YEAR, 8)).statusCode).toBe(201);
    const posted = await prisma.journalEntry.count({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'revenue_accrual', entryType: 'ACCRUAL', periodYear: YEAR, periodMonth: 8 },
    });
    expect(posted).toBe(0);
  });
});
