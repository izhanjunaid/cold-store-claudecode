import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../../test/helpers';
import { addDays } from '@coldchain/shared';
import { billingFixture } from './billing-fixture';

/**
 * One AR read model on the ledger (docs/25 R-10, R-11, R-12, L-03): aging,
 * the party statement and the credit-limit check all read the party's lines on
 * the receivable control accounts, so none of them can disagree with the GL —
 * whatever posted there (invoice, write-off, manual correction, opening balance).
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

async function glBalance(partyId: string, book: 'PACCI' | 'KATCHI' = 'PACCI') {
  const agg = await prisma.journalEntryLine.aggregate({
    where: {
      facilityId: TEST_FACILITY_ID,
      partyId,
      accountCode: { in: ['1110', '1120', '1130', '1150'] },
      journalEntry: { postingStatus: 'POSTED', bookType: book },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100;
}

async function aging(partyId: string, asOf?: string) {
  const r = await fx.call('GET', `/v1/reports/receivables-aging?party_id=${partyId}${asOf ? `&as_of_date=${asOf}` : ''}`, fx.tokens.owner);
  expect(r.status).toBe(200);
  return r.body.data;
}

async function manualAr(partyId: string, amount: number, date: string) {
  const r = await fx.call('POST', '/v1/accounting/journal-entries', fx.tokens.owner, {
    entry_date: date,
    description: 'AR correction',
    lines: [
      { account_code: '1110', debit_amount: amount, credit_amount: 0, party_id: partyId },
      { account_code: '4150', debit_amount: 0, credit_amount: amount },
    ],
  });
  expect(r.status).toBe(201);
  return r.body.data.id as string;
}

describe('AR read model (R-10, R-11, R-12, L-03)', () => {
  it('aging is as of its date, keeps the books apart, and counts every AR line', async () => {
    const partyId = await fx.party('Read Model Party');
    const pacci = await fx.invoice(partyId, { outbound: '2026-07-01' });
    await fx.invoice(partyId, { book: 'KATCHI', outbound: '2026-07-01' });
    await manualAr(partyId, 300, '2026-07-02');

    const now = await aging(partyId);
    expect(now.gl_ar_control_total_pkr).toBe(await glBalance(partyId));
    expect(now.net_total_pkr).toBe(pacci.total + 300);
    expect(now.variance_pkr).toBe(0);

    // Before the invoice existed, it is not owed.
    const invoiceDate = pacci.invoice.invoice_date as string;
    const before = await aging(partyId, addDays(invoiceDate, -1));
    expect(before.parties.flatMap((p: { total_due_pkr: number }) => [p.total_due_pkr]).reduce((s: number, n: number) => s + n, 0)).toBeLessThan(pacci.total);
  });

  it('the party statement is the GL — a written-off invoice nets to nothing, both books apart', async () => {
    const partyId = await fx.party('Statement Party');
    const { id, total } = await fx.invoice(partyId, { outbound: '2026-07-05' });
    await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-07-06', amount_pkr: 100, payment_method: 'CASH',
      allocations: [{ invoice_id: id, allocated_amount_pkr: 100 }],
    });
    expect((await fx.call('POST', `/v1/invoices/${id}/write-off`, fx.tokens.owner, { write_off_date: '2026-07-07', reason: 'gone' })).status).toBe(201);
    await fx.invoice(partyId, { book: 'KATCHI', outbound: '2026-07-05' });

    const st = await fx.call('GET', `/v1/parties/${partyId}/ledger?book_type=PACCI`, fx.tokens.owner);
    expect(st.status).toBe(200);
    expect(st.body.data.closing_balance_pkr).toBe(0);
    expect(st.body.data.total_debit_pkr).toBe(total);
    expect(st.body.data.entries.map((e: { type: string }) => e.type)).toEqual(['INVOICE', 'PAYMENT', 'WRITE_OFF']);

    const katchi = await fx.call('GET', `/v1/parties/${partyId}/ledger?book_type=KATCHI`, fx.tokens.owner);
    expect(katchi.body.data.closing_balance_pkr).toBe(await glBalance(partyId, 'KATCHI'));
  });

  it('the credit limit is checked against what the ledger says the party owes', async () => {
    const partyId = await fx.party('Limit Party');
    await fx.call('PATCH', `/v1/parties/${partyId}`, fx.tokens.owner, { credit_limit_pkr: 100 });
    await manualAr(partyId, 250, '2026-07-10');
    const p = await fx.call('GET', `/v1/parties/${partyId}`, fx.tokens.owner);
    expect(p.body.data.over_credit_limit).toBe(true);
  });
});
