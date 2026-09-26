import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../../test/helpers';
import { billingFixture } from './billing-fixture';

/**
 * Credit notes are built from the invoice's own lines (docs/25 R-03, R-04, R-23):
 * the revenue account comes from the line, the discount and output tax are
 * reversed pro rata, the book is the invoice's, and a credit note is cancelled
 * through a reversal. Before, JE-05 debited only revenue — output tax on a
 * cancelled supply stayed in 2020 and was remitted.
 */
const prisma = new PrismaClient();
let app: FastifyInstance;
let fx: Awaited<ReturnType<typeof billingFixture>>;
let originalSettings: unknown;

beforeAll(async () => {
  app = await getTestApp();
  fx = await billingFixture(app);
  const facility = await prisma.facility.findUniqueOrThrow({ where: { id: TEST_FACILITY_ID }, select: { settings: true } });
  originalSettings = facility.settings;
  await prisma.facility.update({
    where: { id: TEST_FACILITY_ID },
    data: { settings: { ...(facility.settings as object), gst_registered: true, gst_default_rate: 18 } as never },
  });
});

afterAll(async () => {
  await prisma.facility.update({ where: { id: TEST_FACILITY_ID }, data: { settings: originalSettings as never } });
  await fx.cleanup(prisma);
  await prisma.$disconnect();
  await closeTestApp();
});

/** A finalized invoice for 20 bags (Rs 1,000), 10% discount, 18% GST: total 1,062. */
async function discountedInvoice(partyId: string) {
  const id = await fx.draftInvoice(partyId, { bags: 20, outbound: '2026-06-01' });
  expect((await fx.call('PATCH', `/v1/invoices/${id}`, fx.tokens.manager, { discount: { type: 'PERCENT', value: 10 } })).status).toBe(200);
  const fin = await fx.call('POST', `/v1/invoices/${id}/finalize`, fx.tokens.manager, {});
  expect(fin.status).toBe(200);
  const inv = fin.body.data;
  expect(inv.total_pkr).toBe(1062);
  return { id, lineId: inv.line_items.find((l: { line_type: string }) => l.line_type === 'STORAGE').id as string };
}

function creditNote(invoiceId: string, lineId: string, amount: number, token = fx.tokens.manager) {
  return fx.call('POST', '/v1/credit-notes', token, {
    original_invoice_id: invoiceId, credit_date: '2026-06-03', reason: 'short weight',
    line_items: [{ invoice_line_item_id: lineId, amount_pkr: amount }],
  });
}

describe('credit notes from the invoice lines (R-03, R-23)', () => {
  it('reverses revenue, the discount share and the output tax pro rata', async () => {
    const partyId = await fx.party('CN GST Party');
    const { id, lineId } = await discountedInvoice(partyId);

    const cn = await creditNote(id, lineId, 500);
    expect(cn.status).toBe(201);
    expect(cn.body.data.total_pkr).toBe(531);
    expect(cn.body.data.gst_amount_pkr).toBe(81);
    expect(cn.body.data.line_items[0].revenue_account_code).toBe('4010');

    const lines = await prisma.journalEntryLine.findMany({ where: { journalEntryId: cn.body.data.journal_entry_id } });
    const at = (code: string) => {
      const l = lines.filter((x) => x.accountCode === code);
      return Math.round(l.reduce((s, x) => s + Number(x.debitAmount) - Number(x.creditAmount), 0) * 100) / 100;
    };
    expect(at('4010')).toBe(500);
    expect(at('4910')).toBe(-50);
    expect(at('2020')).toBe(81);
    expect(at('1110')).toBe(-531);

    // What is left on that line: 500. More than that is refused.
    expect((await creditNote(id, lineId, 600)).status).toBe(400);
  });

  it('is cancelled through a reversal, and the invoice opens again', async () => {
    const partyId = await fx.party('CN Cancel Party');
    const { id, lineId } = await discountedInvoice(partyId);
    const cn = await creditNote(id, lineId, 1000);
    expect(cn.status).toBe(201);
    expect((await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data.balance_due_pkr).toBe(0);

    const cancel = await fx.call('POST', `/v1/credit-notes/${cn.body.data.id}/cancel`, fx.tokens.manager, {
      reason: 'issued in error', cancel_date: '2026-06-04',
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('CANCELLED');
    expect(cancel.body.data.void_reason).toBe('issued in error');
    const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: cn.body.data.journal_entry_id } });
    expect(je.reversedById).not.toBeNull();
    expect((await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data.balance_due_pkr).toBe(1062);

    // Its line is free to be credited again.
    expect((await creditNote(id, lineId, 1000)).status).toBe(201);
  });

  it('takes the book from the invoice, so a KATCHI invoice needs the OWNER', async () => {
    const partyId = await fx.party('CN Katchi Party');
    const inv = await fx.invoice(partyId, { book: 'KATCHI', outbound: '2026-06-05' });
    const lineId = inv.invoice.line_items[0].id;
    expect((await creditNote(inv.id, lineId, 100, fx.tokens.manager)).status).toBe(403);
    const ok = await creditNote(inv.id, lineId, 100, fx.tokens.owner);
    expect(ok.status).toBe(201);
    expect(ok.body.data.book_type).toBe('KATCHI');
  });

  it('a credit note racing a payment for the same balance: exactly one wins', async () => {
    const partyId = await fx.party('CN Race Party');
    const { id, lineId } = await discountedInvoice(partyId);
    const [a, b] = await Promise.all([
      creditNote(id, lineId, 1000),
      fx.call('POST', '/v1/payments', fx.tokens.accountant, {
        party_id: partyId, payment_date: '2026-06-03', amount_pkr: 1062, payment_method: 'CASH',
        allocations: [{ invoice_id: id, allocated_amount_pkr: 1062 }],
      }),
    ]);
    // The loser is refused (it re-reads the invoice after the winner's lock), never over-settles.
    expect([a.status, b.status].filter((s) => s === 201)).toHaveLength(1);
    expect([a.status, b.status].filter((s) => s >= 400 && s < 500)).toHaveLength(1);
    const inv = (await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data;
    expect(inv.balance_due_pkr).toBe(0);
  });
});
