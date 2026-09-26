import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp } from '../../../test/helpers';
import { billingFixture } from './billing-fixture';

/**
 * docs/25 R-21: what settles an invoice is recomputed from its sources — live
 * payment allocations, standing credit notes and the bad-debt write-off — and
 * reported separately. It used to be one counter everyone incremented, so a
 * written-off or credit-noted invoice showed as PAID.
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

describe('invoice settlement (R-21)', () => {
  it('reports paid, credited and written-off separately, and WRITTEN_OFF is a listable status', async () => {
    const partyId = await fx.party('Settlement Party');
    const { id, total } = await fx.invoice(partyId, { outbound: '2026-04-02' });
    const paid = Math.round(total * 0.3 * 100) / 100;
    const credited = Math.round(total * 0.2 * 100) / 100;

    const pay = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-04-03', amount_pkr: paid, payment_method: 'CASH',
      allocations: [{ invoice_id: id, allocated_amount_pkr: paid }],
    });
    expect(pay.status).toBe(201);

    const inv = (await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data;
    const storageLine = inv.line_items.find((l: { line_type: string }) => l.line_type === 'STORAGE');
    const cn = await fx.call('POST', '/v1/credit-notes', fx.tokens.manager, {
      original_invoice_id: id, credit_date: '2026-04-04', reason: 'short weight',
      line_items: [{ invoice_line_item_id: storageLine.id, revenue_account_code: '4010', description: 'weight', amount_pkr: credited }],
    });
    expect(cn.status).toBe(201);

    const wo = await fx.call('POST', `/v1/invoices/${id}/write-off`, fx.tokens.owner, {
      write_off_date: '2026-04-05', reason: 'party absconded',
    });
    expect(wo.status).toBe(201);

    const after = (await fx.call('GET', `/v1/invoices/${id}`, fx.tokens.manager)).body.data;
    expect(after.status).toBe('WRITTEN_OFF');
    expect(after.amount_paid_pkr).toBeCloseTo(paid, 2);
    expect(after.amount_credited_pkr).toBeCloseTo(credited, 2);
    expect(after.amount_written_off_pkr).toBeCloseTo(total - paid - credited, 2);
    expect(after.balance_due_pkr).toBeCloseTo(0, 2);

    const list = await fx.call('GET', `/v1/invoices?status=WRITTEN_OFF&party_id=${partyId}`, fx.tokens.manager);
    expect(list.status).toBe(200);
    expect(list.body.data.map((i: { id: string }) => i.id)).toEqual([id]);
  });
});
