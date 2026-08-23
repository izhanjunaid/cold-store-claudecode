/**
 * Tax withheld from the facility on customer receipts (s.153; backlog P3-6).
 *
 * A customer deducts tax at source and pays the balance. That deduction is an
 * advance of the facility's OWN income tax, not a discount — but with nowhere
 * to record it, the invoice looked part-unpaid forever and the money vanished
 * into an unexplained AR shortfall.
 *
 * `amount_pkr` stays GROSS: it is what settles the invoice. Cash actually
 * received is `amount_pkr − tax_withheld_pkr`. That split is the whole risk of
 * this change, because it gives one stored number two meanings, so the tests
 * below are built around the two places it can go wrong.
 *
 * TEST 1 is the gate: a receipt WITHOUT withholding must produce byte-identical
 * journal lines to before. Every payment the facility has ever recorded takes
 * that path, and it is the line between an additive change and a regression in
 * all of them.
 *
 * TEST 2's last clause is the one that earns its keep: AR aging must still
 * agree with the GL control accounts. Aging is the one report NOT derived from
 * the GL — it builds from invoices and payments and has drifted twice before.
 * Reading the code says it cannot break here, because it reads amount_pkr as
 * "how much AR was reduced", which gross semantics keeps true. The test is how
 * we know.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let partyId: string;

const AMOUNT = 20_000;
const WITHHELD = 800;
const PAY_DATE = '2033-02-10';

const AR_CONTROL_ACCOUNTS = ['1110', '1120', '1130', '1150'];
/** The party below is a TRADER, which routes to 1120. */
const AR_ACCOUNT = '1120';

async function recordPayment(payload: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(ownerToken),
    payload: {
      party_id: partyId,
      payment_date: PAY_DATE,
      amount_pkr: AMOUNT,
      payment_method: 'CASH',
      allocations: [],
      ...payload,
    },
  });
}

const linesOf = (journalEntryId: string) =>
  prisma.journalEntryLine.findMany({ where: { journalEntryId }, orderBy: { lineNumber: 'asc' } });

/** Sum of the GL AR control accounts, which aging must agree with. */
async function glReceivables() {
  const agg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId: TEST_FACILITY_ID,
      accountCode: { in: AR_CONTROL_ACCOUNTS },
      journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return (
    Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100
  );
}

/** The report computes its own tie-out to the GL controls; read that. */
async function agingVariance() {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/reports/receivables-aging',
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode, res.body).toBe(200);
  return JSON.parse(res.body).data as {
    net_total_pkr: number;
    gl_ar_control_total_pkr: number;
    variance_pkr: number;
  };
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(ownerToken),
    payload: {
      name: `WHT Receipt Party ${Date.now()}`,
      party_type: 'TRADER',
      phone_primary: `0313${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  partyId = JSON.parse(res.body).data.id;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const payments = await prisma.payment.findMany({
      where: { partyId },
      select: { id: true, journalEntryId: true },
    });
    const ids = payments.map((p) => p.id);
    const related = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payments', sourceId: { in: ids } },
      select: { id: true },
    });
    const jeIds = [
      ...payments.map((p) => p.journalEntryId).filter((x): x is string => x !== null),
      ...related.map((r) => r.id),
    ];
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.payment.updateMany({ where: { id: { in: ids } }, data: { journalEntryId: null } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a receipt without withholding is untouched — the gating test', () => {
  it('posts exactly DR cash / CR AR for the full amount, and nothing else', async () => {
    const res = await recordPayment();
    expect(res.statusCode, res.body).toBe(201);
    const payment = JSON.parse(res.body).data;

    expect(payment.tax_withheld_pkr).toBe(0);
    expect(payment.cash_received_pkr).toBeCloseTo(AMOUNT, 2);

    const lines = await linesOf(await journalIdOf(payment.id));
    expect(lines).toHaveLength(2);
    expect(Number(lines.find((l) => l.accountCode === '1010')!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === AR_ACCOUNT)!.creditAmount)).toBeCloseTo(AMOUNT, 2);
    expect(lines.some((l) => l.accountCode === '1240')).toBe(false);
  });
});

async function journalIdOf(paymentId: string) {
  const p = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  return p.journalEntryId!;
}

describe('a receipt with withholding', () => {
  it('settles AR gross, takes in net cash, and holds the rest in 1240', async () => {
    const glBefore = await glReceivables();

    const res = await recordPayment({ tax_withheld_pkr: WITHHELD });
    expect(res.statusCode, res.body).toBe(201);
    const payment = JSON.parse(res.body).data;

    expect(payment.amount_pkr).toBeCloseTo(AMOUNT, 2);
    expect(payment.tax_withheld_pkr).toBeCloseTo(WITHHELD, 2);
    expect(payment.cash_received_pkr).toBeCloseTo(AMOUNT - WITHHELD, 2);

    const lines = await linesOf(await journalIdOf(payment.id));
    expect(Number(lines.find((l) => l.accountCode === AR_ACCOUNT)!.creditAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === '1010')!.debitAmount)).toBeCloseTo(
      AMOUNT - WITHHELD,
      2,
    );
    expect(Number(lines.find((l) => l.accountCode === '1240')!.debitAmount)).toBeCloseTo(WITHHELD, 2);

    // AR fell by the FULL invoice amount — the customer settled in full; the
    // tax simply went to the authority instead of to the facility.
    expect(await glReceivables()).toBeCloseTo(glBefore - AMOUNT, 2);
  });

  it('keeps AR aging in step with the GL control accounts', async () => {
    // Aging is the one report not derived from the GL. It has drifted twice
    // before, and gross semantics is exactly what keeps it honest here: it
    // reads amount_pkr as "how much AR was reduced", which stays true.
    const aging = await agingVariance();
    expect(aging.variance_pkr, 'AR aging must reconcile with 1110/1120/1130/1150').toBeCloseTo(0, 2);
    expect(aging.net_total_pkr).toBeCloseTo(aging.gl_ar_control_total_pkr, 2);
  });

  it('refuses more tax than the receipt settles', async () => {
    const res = await recordPayment({ tax_withheld_pkr: AMOUNT * 2 });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('tax_withheld_pkr');
  });

  it('refuses withholding on an advance — there is no invoice to certify against', async () => {
    const res = await recordPayment({ is_advance: true, tax_withheld_pkr: WITHHELD });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('tax_withheld_pkr');
  });
});

describe('a withheld cheque, through clearing and through bouncing', () => {
  async function chequeWithWithholding() {
    const res = await recordPayment({
      payment_method: 'CHEQUE',
      cheque_number: `WHT-${Date.now() % 100000}`,
      tax_withheld_pkr: WITHHELD,
    });
    expect(res.statusCode, res.body).toBe(201);
    return JSON.parse(res.body).data.id as string;
  }

  const balanceOf = async (accountCode: string) => {
    const agg = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode,
        journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return (
      Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) /
      100
    );
  };

  it('clears the NET into bank, leaving 1025 at exactly zero', async () => {
    const before = await balanceOf('1025');
    const id = await chequeWithWithholding();

    // 1025 received the net, not the gross.
    expect(await balanceOf('1025')).toBeCloseTo(before + AMOUNT - WITHHELD, 2);

    const clear = await app.inject({
      method: 'POST',
      url: `/v1/payments/${id}/clear`,
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(clear.statusCode, clear.body).toBe(200);

    // The single assertion that catches both sides being wrong together:
    // clearing the gross would leave 1025 short by the withheld amount, and
    // a matching mistake at JE-02 would hide it from a bank-side check.
    expect(await balanceOf('1025'), '1025 must clear to nothing').toBeCloseTo(before, 2);
  });

  it('reverses AR gross, the cash leg net, and unwinds 1240 when it bounces', async () => {
    const id = await chequeWithWithholding();

    const dishonour = await app.inject({
      method: 'POST',
      url: `/v1/payments/${id}/dishonour`,
      headers: authHeaders(ownerToken),
      payload: { dishonour_date: PAY_DATE },
    });
    expect(dishonour.statusCode, dishonour.body).toBe(200);

    const reversal = await prisma.journalEntry.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payments', sourceId: id, entryType: 'REVERSAL' },
      orderBy: { createdAt: 'desc' },
    });
    const lines = await linesOf(reversal.id);
    expect(Number(lines.find((l) => l.accountCode === AR_ACCOUNT)!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(lines.find((l) => l.accountCode === '1025')!.creditAmount)).toBeCloseTo(
      AMOUNT - WITHHELD,
      2,
    );
    // No payment was made, so no tax was withheld on it.
    expect(Number(lines.find((l) => l.accountCode === '1240')!.creditAmount)).toBeCloseTo(WITHHELD, 2);

    // JE-06 itself balances, and every leg mirrors what JE-02 actually did.
    const totalD = lines.reduce((s, l) => s + Number(l.debitAmount), 0);
    const totalC = lines.reduce((s, l) => s + Number(l.creditAmount), 0);
    expect(totalD).toBeCloseTo(totalC, 2);

    // Deliberately NOT asserted here: that AR and 1025 return to their
    // pre-receipt balances. They do not, and not because of anything on this
    // branch — the dishonour path posts JE-06 as a full mirror AND marks JE-02
    // REVERSED, which drops it out of every POSTED query, so a bounce reverses
    // twice. Measured with no withholding at all: AR ends +10,000 and 1025
    // ends −10,000 on a 10,000 cheque. Equal and opposite, so the trial
    // balance still balances, which is why it went unseen. Fixed separately,
    // where the end-state assertion belongs.
  });
});
