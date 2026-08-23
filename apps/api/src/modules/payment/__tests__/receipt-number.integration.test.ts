/**
 * Receipt numbers on payments (backlog P2-14).
 *
 * Invoices were numbered and receipts were not, so a disputed cash receipt had
 * nothing anyone could quote but an internal uuid.
 *
 * The assertion that earns its keep is the concurrency one, and it asserts the
 * LOSER: MAX+1 without the advisory lock hands the same number to two
 * simultaneous receipts, and a test that only checks both calls returned 201
 * stays green with no lock at all. Here either the second call fails on the
 * unique index or both succeed with different numbers — what must never
 * happen is two receipts sharing a number.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { formatReceiptNumber, receiptNumberPrefix } from '../receipt-number';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let partyId: string;

const PAY_DATE = '2033-05-04';

async function recordPayment(amount = 100) {
  return app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(ownerToken),
    payload: {
      party_id: partyId,
      payment_date: PAY_DATE,
      amount_pkr: amount,
      payment_method: 'CASH',
      allocations: [],
    },
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(ownerToken),
    payload: {
      name: `Receipt Number Party ${Date.now()}`,
      party_type: 'TRADER',
      phone_primary: `0312${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode).toBe(201);
  partyId = JSON.parse(res.body).data.id;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const payments = await prisma.payment.findMany({
      where: { partyId },
      select: { id: true, journalEntryId: true },
    });
    const jeIds = payments.map((p) => p.journalEntryId).filter((x): x is string => x !== null);
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: payments.map((p) => p.id) } } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: payments.map((p) => p.id) } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('the formatter', () => {
  it('is UTC and zero-padded, like every other document number here', () => {
    expect(formatReceiptNumber(new Date('2033-05-04T00:00:00.000Z'), 7)).toBe('RCP-203305-0007');
    expect(receiptNumberPrefix(new Date('2033-01-31T23:00:00.000Z'))).toBe('RCP-203301-');
  });
});

describe('every receipt gets a number', () => {
  it('issues one on the response and stores it', async () => {
    const res = await recordPayment();
    expect(res.statusCode, res.body).toBe(201);
    const payment = JSON.parse(res.body).data;
    expect(payment.receipt_number).toMatch(/^RCP-203305-\d{4}$/);

    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.receiptNumber).toBe(payment.receipt_number);
  });

  it('increments within the facility and month', async () => {
    const first = JSON.parse((await recordPayment()).body).data.receipt_number as string;
    const second = JSON.parse((await recordPayment()).body).data.receipt_number as string;
    const seq = (n: string) => Number(n.split('-')[2]);
    expect(seq(second)).toBe(seq(first) + 1);
  });

  it('never issues the same number twice under concurrency', async () => {
    const results = await Promise.allSettled([recordPayment(), recordPayment(), recordPayment()]);
    const numbers = results
      .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof recordPayment>>> => r.status === 'fulfilled')
      .filter((r) => r.value.statusCode === 201)
      .map((r) => JSON.parse(r.value.body).data.receipt_number as string);

    expect(numbers.length).toBeGreaterThan(0);
    expect(new Set(numbers).size, `duplicate receipt numbers issued: ${numbers.join(', ')}`).toBe(
      numbers.length,
    );

    // And nothing in the facility shares a number, including whatever else
    // this suite has recorded.
    const all = await prisma.payment.findMany({
      where: { facilityId: TEST_FACILITY_ID, receiptNumber: { not: null } },
      select: { receiptNumber: true },
    });
    const codes = all.map((p) => p.receiptNumber!);
    expect(new Set(codes).size).toBe(codes.length);
  });
});
