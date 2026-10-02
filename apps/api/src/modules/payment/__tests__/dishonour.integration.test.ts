import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../../test/helpers';
import { billingFixture } from '../../invoice/__tests__/billing-fixture';

/**
 * A dishonour reverses the payment's own chain of entries (docs/25 R-05, L-07,
 * R-17): the receipt, every advance application, the clearing if the cheque had
 * cleared, and the peshgi recoveries it funded. It used to post one hand-built
 * JE-06 that always credited 1025 — for a cleared cheque that left 1025 negative
 * and 1020 overstated by the cheque.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
});

afterAll(async () => {
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
});

/** Net of every entry sourced to the payment (receipt, applications, clearing and their reversals), per account. */
async function chainNet(paymentId: string) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { journalEntry: { facilityId: TEST_FACILITY_ID, sourceTable: 'payments', sourceId: paymentId } },
  });
  const net = new Map<string, number>();
  for (const l of lines) {
    net.set(l.accountCode, Math.round(((net.get(l.accountCode) ?? 0) + Number(l.debitAmount) - Number(l.creditAmount)) * 100) / 100);
  }
  return (code: string) => net.get(code) ?? 0;
}

describe('cheque dishonour reverses the chain (R-05)', () => {
  it('a cleared cheque that bounces takes the money back out of the bank, not out of 1025', async () => {
    const partyId = await fx.party('Cleared Bounce Party');
    const { id: invoiceId, total } = await fx.invoice(partyId, { outbound: '2026-05-01' });
    const pay = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-05-02', amount_pkr: total, payment_method: 'CHEQUE', reference_number: 'CHQ-CL-1',
      allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: total }],
    });
    expect(pay.status).toBe(201);
    const payId = pay.body.data.id;
    expect((await fx.call('POST', `/v1/payments/${payId}/clear`, fx.tokens.accountant, { clear_date: '2026-05-04' })).status).toBe(200);

    const bounce = await fx.call('POST', `/v1/payments/${payId}/dishonour`, fx.tokens.accountant, {
      dishonour_date: '2026-05-06', notes: 'returned after clearing',
    });
    expect(bounce.status).toBe(200);
    expect(bounce.body.data.status).toBe('DISHONOURED');

    const net = await chainNet(payId);
    expect(net('1025')).toBe(0);
    expect(net('1020')).toBe(0);
    expect(net('1110')).toBe(0);

    // Every original is linked to its own mirror, and no mirror reads as reversed.
    const entries = await prisma.journalEntry.findMany({ where: { sourceTable: 'payments', sourceId: payId } });
    const originals = entries.filter((e) => e.entryType !== 'REVERSAL');
    const mirrors = entries.filter((e) => e.entryType === 'REVERSAL');
    expect(originals.length).toBe(2); // JE-02 and JE-24
    expect(originals.every((e) => e.reversedById !== null)).toBe(true);
    expect(mirrors.length).toBe(2);
    expect(mirrors.every((e) => e.reversedById === null)).toBe(true);

    const inv = (await fx.call('GET', `/v1/invoices/${invoiceId}`, fx.tokens.manager)).body.data;
    expect(inv.balance_due_pkr).toBeCloseTo(total, 2);
  });

  it('refuses a dishonour dated before the last entry in the chain', async () => {
    const partyId = await fx.party('Early Bounce Party');
    const pay = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-05-10', amount_pkr: 700, payment_method: 'CHEQUE', reference_number: 'CHQ-EARLY',
    });
    const payId = pay.body.data.id;
    await fx.call('POST', `/v1/payments/${payId}/clear`, fx.tokens.accountant, { clear_date: '2026-05-15' });

    const early = await fx.call('POST', `/v1/payments/${payId}/dishonour`, fx.tokens.accountant, { dishonour_date: '2026-05-12' });
    expect(early.status).toBe(400);
    expect(early.body.error.message).toMatch(/2026-05-15/);
  });

  it('an applied advance cheque unwinds every application with the receipt', async () => {
    const partyId = await fx.party('Advance Bounce Party');
    const { id: invoiceId, total } = await fx.invoice(partyId, { bags: 20, outbound: '2026-05-20' });
    const adv = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-05-21', amount_pkr: total + 500, payment_method: 'CHEQUE', is_advance: true,
    });
    const payId = adv.body.data.id;
    for (const part of [300, total - 300]) {
      const r = await fx.call('POST', `/v1/payments/${payId}/allocate`, fx.tokens.accountant, {
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: part }],
      });
      expect(r.status).toBe(200);
    }

    const bounce = await fx.call('POST', `/v1/payments/${payId}/dishonour`, fx.tokens.accountant, {});
    expect(bounce.status).toBe(200);
    const net = await chainNet(payId);
    expect(net('2010')).toBe(0);
    expect(net('1025')).toBe(0);
    expect(net('1110')).toBe(0);
    const inv = (await fx.call('GET', `/v1/invoices/${invoiceId}`, fx.tokens.manager)).body.data;
    expect(inv.balance_due_pkr).toBeCloseTo(total, 2);
  });

  it('reverses the peshgi recovery a bounced cheque funded, through its own entry', async () => {
    const partyId = await fx.party('Loan Bounce Party');
    const loan = await fx.call('POST', '/v1/loans/issue', fx.tokens.owner, {
      party_id: partyId, issue_date: '2026-05-01', principal_pkr: 5000, payment_method: 'CASH',
    });
    expect(loan.status).toBe(201);
    const loanId = loan.body.data.id;
    const pay = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-05-25', amount_pkr: 2000, payment_method: 'CHEQUE', reference_number: 'CHQ-LOAN',
      allocations: [{ target: 'LOAN', loan_id: loanId, allocated_amount_pkr: 2000 }],
    });
    expect(pay.status).toBe(201);
    const repayment = await prisma.partyLoanRepayment.findFirstOrThrow({ where: { paymentId: pay.body.data.id } });

    const bounce = await fx.call('POST', `/v1/payments/${pay.body.data.id}/dishonour`, fx.tokens.accountant, {
      dishonour_date: '2026-05-26',
    });
    expect(bounce.status).toBe(200);

    const je19 = await prisma.journalEntry.findUniqueOrThrow({ where: { id: repayment.journalEntryId! } });
    expect(je19.reversedById).not.toBeNull();
    const peshgi = await prisma.journalEntryLine.aggregate({
      where: { partyId, accountCode: '1140', journalEntry: { postingStatus: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    expect(Number(peshgi._sum.debitAmount) - Number(peshgi._sum.creditAmount)).toBe(5000);
    const loanAfter = (await fx.call('GET', `/v1/loans/${loanId}`, fx.tokens.accountant)).body.data;
    expect(loanAfter.balance_outstanding_pkr).toBe(5000);
  });
});
