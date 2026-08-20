/**
 * JE-25 — storage revenue accrued in the period it is earned (docs/16, F-16).
 *
 * Storage revenue was recognised only when the invoice was finalised, which
 * happens at withdrawal. A lot stored six months put six months of revenue
 * into the last one, and every period end showed nothing at all for lots
 * still in storage.
 *
 * The property under test is NOT that the total comes out right — a total-only
 * assertion passes with the broken designs too. It is that **each period gets
 * its own share**, and that the accrual and the eventual invoice converge
 * exactly, leaving 1250 at zero.
 *
 * Isolation: the lot bills to its own revenue account (4099, created here) so
 * the per-month assertions measure this lot and nothing else in the shared
 * dev facility.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000300';
const REVENUE_ACCOUNT = '4099';
const BAGS = 10;
const RATE_PER_BAG_PER_DAY = 1;

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let operatorToken: string;
let dailyPlanId: string;
let seasonalNoEndPlanId: string;
let partyId: string;

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Net movement on an account within a date range, from the GL endpoint. */
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
  // Revenue is credit-normal: credits minus debits is what the period earned.
  return Math.round((gl.total_credit_pkr - gl.total_debit_pkr) * 100) / 100;
}

/**
 * 1250 is facility-wide, and every other suite's lots accrue into it as soon
 * as the accrual is switched on — so an absolute balance proves nothing here.
 * The accrual tags each 1250 line with its lot, which is exactly what makes
 * this measurable per lot.
 */
async function accruedBalanceForLot(lotId: string): Promise<number> {
  const agg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId: TEST_FACILITY_ID,
      accountCode: '1250',
      lotId,
      journalEntry: { postingStatus: 'POSTED' },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100;
}

const runAccrual = (year: number, month: number, token = managerToken) =>
  app.inject({
    method: 'POST',
    url: '/v1/accounting/revenue-accrual',
    headers: authHeaders(token),
    payload: { period_year: year, period_month: month },
  });

async function cleanup() {
  const lots = await prisma.lot.findMany({
    where: { facilityId: TEST_FACILITY_ID, ratePlanId: { in: [dailyPlanId, seasonalNoEndPlanId].filter(Boolean) } },
    select: { id: true },
  });
  const lotIds = lots.map((l) => l.id);

  await withGuardsDisabled(prisma, async () => {
    const entries = await prisma.journalEntry.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        OR: [{ sourceTable: 'revenue_accrual' }, { lines: { some: { accountCode: REVENUE_ACCOUNT } } }],
      },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });

    const invoices = await prisma.invoice.findMany({ where: { lotId: { in: lotIds } }, select: { id: true, journalEntryId: true } });
    const invIds = invoices.map((i) => i.id);
    const invJeIds = invoices.map((i) => i.journalEntryId).filter((x): x is string => x !== null);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: invJeIds } } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invIds } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: [...ids, ...invJeIds] } } });

    await prisma.outboundEvent.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotMovement.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lotRackPlacement.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.ownershipHistory.deleteMany({ where: { lotId: { in: lotIds } } });
    await prisma.lot.deleteMany({ where: { id: { in: lotIds } } });
    await prisma.ratePlan.deleteMany({ where: { id: { in: [dailyPlanId, seasonalNoEndPlanId].filter(Boolean) } } });
    await prisma.chartOfAccounts.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: REVENUE_ACCOUNT },
    });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  operatorToken = (await loginAsRole(app, 'OPERATOR')).accessToken;

  await prisma.chartOfAccounts.upsert({
    where: { facilityId_accountCode: { facilityId: TEST_FACILITY_ID, accountCode: REVENUE_ACCOUNT } },
    update: {},
    create: {
      facilityId: TEST_FACILITY_ID,
      accountCode: REVENUE_ACCOUNT,
      accountName: 'Storage Revenue — accrual test',
      accountClass: 'REVENUE',
      accountType: 'DETAIL',
      parentAccountCode: '4000',
      normalBalance: 'CREDIT',
    },
  });

  // minBillingDays 1 on purpose: computeStorageCharge floors elapsed days at
  // minBillingDays, so a higher floor makes the first month legitimately
  // larger and a flat per-month assertion would fail on correct code.
  const daily = await prisma.ratePlan.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      name: 'Accrual Test — Daily',
      commodityId: POTATO_ID,
      rateType: 'DAILY_PER_BAG',
      rateAmountPkr: RATE_PER_BAG_PER_DAY,
      minBillingDays: 1,
      revenueAccountCode: REVENUE_ACCOUNT,
    },
  });
  dailyPlanId = daily.id;

  const seasonal = await prisma.ratePlan.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      name: 'Accrual Test — Seasonal, no end date',
      commodityId: POTATO_ID,
      rateType: 'SEASONAL_PER_BAG',
      rateAmountPkr: 500,
      minBillingDays: 1,
      revenueAccountCode: REVENUE_ACCOUNT,
      seasonStartDate: new Date('2026-01-01T00:00:00.000Z'),
      seasonEndDate: null,
    },
  });
  seasonalNoEndPlanId = seasonal.id;

  const party = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name: `Accrual Test Farmer ${Date.now()}`,
      party_type: 'FARMER',
      phone_primary: `0300${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(party.statusCode).toBe(201);
  partyId = JSON.parse(party.body).data.id;

  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: {
      settings: {
        ...(await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings as object,
        revenue_accrual: { enabled: true, start_date: null },
      },
    },
  });

  await cleanupAccrualEntriesOnly();
});

/** Other suites don't post to revenue_accrual, but a previous run of this one may have. */
async function cleanupAccrualEntriesOnly() {
  await withGuardsDisabled(prisma, async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'revenue_accrual' },
      select: { id: true },
    });
    const ids = entries.map((e) => e.id);
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: ids } } });
  });
}

afterAll(async () => {
  await cleanup();
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: {
      settings: {
        ...(await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings as object,
        revenue_accrual: { enabled: false, start_date: null },
      },
    },
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('storage revenue lands in the period it was earned', () => {
  let lotId: string;

  it('creates a lot that will sit in storage across six periods', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(ownerToken),
      payload: {
        owner_party_id: partyId,
        commodity_id: POTATO_ID,
        rate_plan_id: dailyPlanId,
        chamber_id: CHAMBER_A,
        quantity_bags: BAGS,
        accepted_weight_kg: BAGS * 20,
        inbound_date: '2026-01-01',
      },
    });
    expect(res.statusCode).toBe(201);
    lotId = JSON.parse(res.body).data.id;
  });

  it('recognises revenue every month, not all of it at the end', async () => {
    const monthly: number[] = [];
    for (const month of [1, 2, 3, 4, 5]) {
      const res = await runAccrual(2026, month);
      expect(res.statusCode).toBe(201);
      monthly.push(await revenueIn(2026, month));
    }

    // The whole point: every month carries revenue. Under the old behaviour
    // these were all zero; under a *periodic* accrual plus reversal (rather
    // than the cumulative one) months 2-5 would be zero too.
    for (const [i, amount] of monthly.entries()) {
      expect(amount, `month ${i + 1} should have recognised revenue`).toBeGreaterThan(0);
    }

    // And each month's share tracks that month's own length, because the
    // cumulative accrual minus the prior reversal leaves exactly the month.
    const daysIn = (m: number) => new Date(Date.UTC(2026, m, 0)).getUTCDate();
    for (const m of [2, 3, 4, 5]) {
      expect(monthly[m - 1]).toBeCloseTo(daysIn(m) * BAGS * RATE_PER_BAG_PER_DAY, 2);
    }
  });

  it('accrues cumulatively — 1250 holds everything earned so far, not one month', async () => {
    const balance = await accruedBalanceForLot(lotId);
    const jan1 = Date.UTC(2026, 0, 1);
    const may31 = Date.UTC(2026, 4, 31);
    const days = Math.ceil((may31 - jan1) / (1000 * 60 * 60 * 24));
    expect(balance).toBeCloseTo(days * BAGS * RATE_PER_BAG_PER_DAY, 2);
  });

  it('refuses to run the same period twice — the result is immutable, so a double post is unrecoverable', async () => {
    const again = await runAccrual(2026, 5);
    expect(again.statusCode).toBe(400);
  });

  it('converges with the invoice: 1250 returns to zero and revenue equals the invoice', async () => {
    // Month 6: accrue, then withdraw and bill.
    expect((await runAccrual(2026, 6)).statusCode).toBe(201);

    const out = await app.inject({
      method: 'POST',
      url: '/v1/outbound-events',
      headers: authHeaders(operatorToken),
      payload: {
        lot_id: lotId,
        withdrawal_type: 'FULL',
        quantity_withdrawn_bags: BAGS,
        outbound_date: '2026-06-30',
      },
    });
    expect(out.statusCode).toBe(201);
    const outboundId = JSON.parse(out.body).data.id;

    await app.inject({
      method: 'PATCH',
      url: `/v1/outbound-events/${outboundId}/weight`,
      headers: authHeaders(operatorToken),
      payload: { outbound_weight_kg: BAGS * 20 },
    });
    const finOut = await app.inject({
      method: 'POST',
      url: `/v1/outbound-events/${outboundId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(finOut.statusCode).toBe(200);
    const draftId = JSON.parse(finOut.body).data.invoice_id as string;

    const fin = await app.inject({
      method: 'POST',
      url: `/v1/invoices/${draftId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(fin.statusCode).toBe(200);
    const invoice = JSON.parse(fin.body).data;

    // Month 7 reverses month 6's accrual. The lot is gone, so nothing new is
    // accrued and 1250 must come back to exactly zero.
    expect((await runAccrual(2026, 7)).statusCode).toBe(201);
    expect(await accruedBalanceForLot(lotId)).toBeCloseTo(0, 2);

    // Total revenue recognised across every period equals the invoice's
    // storage charge — the accrual redistributed it, it did not create any.
    // Across the whole year, not just the accrued months: an invoice is dated
    // at finalisation (invoice.builder.ts uses new Date()), not the outbound
    // date, so it can land a period or two after the withdrawal. The accruals
    // net to zero over their own life and the invoice supplies the revenue —
    // which is the convergence property. Existing behaviour; not changed here.
    let total = 0;
    for (let m = 1; m <= 12; m += 1) total += await revenueIn(2026, m);
    expect(total).toBeCloseTo(Number(invoice.sub_total_pkr), 2);

    // And the accrual itself created none of it: every accrual posted is
    // matched by a reversal, so the pair contributes exactly zero.
    const accrualOnly = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: REVENUE_ACCOUNT,
        journalEntry: { sourceTable: 'revenue_accrual', postingStatus: 'POSTED' },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const netFromAccruals =
      Number(accrualOnly._sum.creditAmount ?? 0) - Number(accrualOnly._sum.debitAmount ?? 0);
    expect(netFromAccruals).toBeCloseTo(0, 2);
  });
});

describe('a seasonal plan with no season end cannot be spread, and says so', () => {
  it('excludes the lot and reports why, instead of recognising the whole fee at once', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(ownerToken),
      payload: {
        owner_party_id: partyId,
        commodity_id: POTATO_ID,
        rate_plan_id: seasonalNoEndPlanId,
        chamber_id: CHAMBER_A,
        quantity_bags: 5,
        accepted_weight_kg: 100,
        inbound_date: '2026-08-01',
      },
    });
    expect(res.statusCode).toBe(201);
    const lotNumber = JSON.parse(res.body).data.lot_number as string;

    const preview = await app.inject({
      method: 'GET',
      url: '/v1/accounting/revenue-accrual?period_year=2026&period_month=8',
      headers: authHeaders(ownerToken),
    });
    expect(preview.statusCode).toBe(200);
    const data = JSON.parse(preview.body).data;

    expect(data.lots.some((l: { lot_number: string }) => l.lot_number === lotNumber)).toBe(false);
    const flagged = data.unaccruable.find((u: { lot_number: string }) => u.lot_number === lotNumber);
    expect(flagged).toBeTruthy();
    expect(flagged.reason).toMatch(/season end/i);
  });
});

describe('two runs of the same period cannot both post', () => {
  it('serialises concurrent runs — exactly one wins, the other is refused', async () => {
    // A lot to accrue, so the period has something to post and the race is
    // real rather than two no-ops agreeing with each other.
    const lot = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(ownerToken),
      payload: {
        owner_party_id: partyId,
        commodity_id: POTATO_ID,
        rate_plan_id: dailyPlanId,
        chamber_id: CHAMBER_A,
        quantity_bags: 4,
        accepted_weight_kg: 80,
        inbound_date: '2026-09-01',
      },
    });
    expect(lot.statusCode).toBe(201);

    const [a, b] = await Promise.all([runAccrual(2026, 9), runAccrual(2026, 9)]);
    const codes = [a.statusCode, b.statusCode].sort();

    // Asserting only that "one succeeded" would stay green with no lock at
    // all. The loser must be refused — a posted accrual is immutable, so a
    // double post could never be edited back out (CLAUDE.md invariant 3).
    expect(codes).toEqual([201, 400]);

    const posted = await prisma.journalEntry.count({
      where: {
        facilityId: TEST_FACILITY_ID,
        sourceTable: 'revenue_accrual',
        entryType: 'ACCRUAL',
        periodYear: 2026,
        periodMonth: 9,
      },
    });
    expect(posted).toBe(1);
  });
});

describe('the accrual is off unless the facility turns it on', () => {
  it('refuses to run when disabled', async () => {
    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: {
        settings: {
          ...(await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings as object,
          revenue_accrual: { enabled: false, start_date: null },
        },
      },
    });
    const res = await runAccrual(2026, 9);
    expect(res.statusCode).toBe(400);

    await prisma.facility.update({
      where: { id: TEST_FACILITY_ID },
      data: {
        settings: {
          ...(await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID } })).settings as object,
          revenue_accrual: { enabled: true, start_date: null },
        },
      },
    });
  });
});
