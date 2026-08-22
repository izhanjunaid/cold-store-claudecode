/**
 * A reversal reverses once, not twice.
 *
 * markReversed() used to flip the original to REVERSED **and** the caller
 * separately posted a full mirror. Every statement, the GL and the trial
 * balance filter posting_status = 'POSTED', so the original dropped out of the
 * ledger entirely while the mirror was also applied — every reversal in the
 * system landed twice.
 *
 * Measured on a 10,000 cheque receipt, dishonoured, with no withholding at
 * all: AR ended +10,000 and 1025 ended −10,000. **Equal and opposite, so the
 * trial balance still balanced** — which is exactly why three accounting
 * audits did not catch it, and why the assertion that matters here is the
 * per-account end state, not `is_balanced`.
 *
 * Every test below therefore asserts the same shape: take a balance, do a
 * thing, reverse the thing, and require the balance to come back to where it
 * started. A test that only checked the reversal entry's own lines, or only
 * that debits equal credits, would pass against the defect.
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

const AR_CONTROLS = ['1110', '1120', '1130', '1150'];
const AMOUNT = 10_000;

async function balanceOf(codes: string[]) {
  const agg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId: TEST_FACILITY_ID,
      accountCode: { in: codes },
      journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return (
    Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100
  );
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(ownerToken),
    payload: {
      name: `Reversal Party ${Date.now()}`,
      party_type: 'TRADER',
      phone_primary: `0314${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode, res.body).toBe(201);
  partyId = JSON.parse(res.body).data.id;
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const payments = await prisma.payment.findMany({ where: { partyId }, select: { id: true } });
    const ids = payments.map((p) => p.id);
    const jes = await prisma.journalEntry.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        OR: [
          { sourceTable: 'payments', sourceId: { in: ids } },
          { description: { contains: 'Reversal nets to zero' } },
        ],
      },
      select: { id: true },
    });
    const jeIds = jes.map((j) => j.id);
    // Break the mutual links before deleting, or the FK refuses.
    await prisma.journalEntry.updateMany({ where: { id: { in: jeIds } }, data: { reversedById: null } });
    await prisma.payment.updateMany({ where: { id: { in: ids } }, data: { journalEntryId: null } });
    await prisma.paymentAllocation.deleteMany({ where: { paymentId: { in: ids } } });
    await prisma.journalEntryLine.deleteMany({ where: { journalEntryId: { in: jeIds } } });
    await prisma.payment.deleteMany({ where: { id: { in: ids } } });
    await prisma.journalEntry.deleteMany({ where: { id: { in: jeIds } } });
    await prisma.party.deleteMany({ where: { id: partyId } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a bounced cheque puts every account back where it started', () => {
  it('leaves AR and 1025 at their pre-receipt balances — the exact defect', async () => {
    const arBefore = await balanceOf(AR_CONTROLS);
    const chequesBefore = await balanceOf(['1025']);

    const pay = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: partyId,
        payment_date: '2033-02-10',
        amount_pkr: AMOUNT,
        payment_method: 'CHEQUE',
        cheque_number: `RV-${Date.now() % 100000}`,
        allocations: [],
      },
    });
    expect(pay.statusCode, pay.body).toBe(201);
    const paymentId = JSON.parse(pay.body).data.id as string;

    expect(await balanceOf(AR_CONTROLS)).toBeCloseTo(arBefore - AMOUNT, 2);
    expect(await balanceOf(['1025'])).toBeCloseTo(chequesBefore + AMOUNT, 2);

    const bounce = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/dishonour`,
      headers: authHeaders(ownerToken),
      payload: { dishonour_date: '2033-02-15' },
    });
    expect(bounce.statusCode, bounce.body).toBe(200);

    // Before the fix these read arBefore + 10,000 and chequesBefore − 10,000.
    expect(await balanceOf(AR_CONTROLS), 'AR must return to its pre-receipt balance').toBeCloseTo(
      arBefore,
      2,
    );
    expect(await balanceOf(['1025']), '1025 must return to its pre-receipt balance').toBeCloseTo(
      chequesBefore,
      2,
    );
  });

  it('keeps the original POSTED and links it to the entry that reversed it', async () => {
    const original = await prisma.journalEntry.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'payments', entryType: 'PAYMENT' },
      orderBy: { createdAt: 'desc' },
    });
    // The receipt really happened and belongs in its own period. Flipping it to
    // REVERSED erased it retroactively — a bounce in April restated March.
    expect(original.postingStatus).toBe('POSTED');
    expect(original.reversedById).not.toBeNull();

    const mirror = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: original.reversedById! },
    });
    expect(mirror.entryType).toBe('REVERSAL');
    expect(mirror.entryDate.toISOString().slice(0, 10)).toBe('2033-02-15');
  });
});

describe('the generic reversal path behaves the same way', () => {
  it('nets a manual entry to zero and refuses to reverse it twice', async () => {
    const cashBefore = await balanceOf(['1010']);
    const miscBefore = await balanceOf(['6100']);

    const manual = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(ownerToken),
      payload: {
        entry_date: '2033-02-10',
        description: 'Reversal nets to zero — manual entry',
        lines: [
          { account_code: '6100', debit_amount: 750, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 750 },
        ],
      },
    });
    expect(manual.statusCode, manual.body).toBe(201);
    const entryId = JSON.parse(manual.body).data.id as string;

    const reverse = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${entryId}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'Reversal nets to zero — undo', entry_date: '2033-02-20' },
    });
    expect(reverse.statusCode, reverse.body).toBe(201);

    expect(await balanceOf(['1010'])).toBeCloseTo(cashBefore, 2);
    expect(await balanceOf(['6100'])).toBeCloseTo(miscBefore, 2);

    // The guard is reversedById now, not the posting status — without that
    // change an entry could be reversed over and over.
    const again = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${entryId}/reverse`,
      headers: authHeaders(ownerToken),
      payload: { reason: 'second attempt' },
    });
    expect(again.statusCode).toBe(409);
  });
});

describe('the guard trigger still refuses everything else', () => {
  it('rejects editing a posted entry, and rejects re-pointing reversed_by', async () => {
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { facilityId: TEST_FACILITY_ID, postingStatus: 'POSTED', reversedById: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    await expect(
      prisma.journalEntry.update({
        where: { id: entry.id },
        data: { description: 'tampered' },
      }),
    ).rejects.toThrow(/immutable once posted/);

    // reversed_by is write-once: the relaxed transition requires OLD to be null.
    await expect(
      prisma.journalEntry.update({
        where: { id: entry.id },
        data: { reversedById: null },
      }),
    ).rejects.toThrow(/immutable once posted/);
  });
});
