import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { getTestApp, closeTestApp, TEST_FACILITY_ID } from '../../../test/helpers';
import { billingFixture } from '../../invoice/__tests__/billing-fixture';

/**
 * Receipts against invoices (docs/25 R-02, R-04, R-06, R-13, R-22).
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

async function partyBalance(partyId: string, accountCode: string, book: 'PACCI' | 'KATCHI' = 'PACCI') {
  const agg = await prisma.journalEntryLine.aggregate({
    where: { facilityId: TEST_FACILITY_ID, partyId, accountCode, journalEntry: { bookType: book, postingStatus: 'POSTED' } },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return Math.round((Number(agg._sum.debitAmount ?? 0) - Number(agg._sum.creditAmount ?? 0)) * 100) / 100;
}

describe('KATCHI invoices carry no GST (R-06)', () => {
  it('a KATCHI draft is built at 0% and cannot be given a rate', async () => {
    const partyId = await fx.party('Katchi GST Party');
    const pacci = (await fx.call('GET', `/v1/invoices/${await fx.draftInvoice(partyId)}`, fx.tokens.owner)).body.data;
    expect(pacci.gst_rate).toBe(18);

    const katchiId = await fx.draftInvoice(partyId, { book: 'KATCHI' });
    const katchi = (await fx.call('GET', `/v1/invoices/${katchiId}`, fx.tokens.owner)).body.data;
    expect(katchi.gst_rate).toBe(0);
    expect(katchi.gst_amount_pkr).toBe(0);

    const patch = await fx.call('PATCH', `/v1/invoices/${katchiId}`, fx.tokens.owner, { gst_rate: 18 });
    expect(patch.status).toBe(400);
  });
});

describe('a receipt takes its book from the invoices it settles (R-04)', () => {
  it('paying a KATCHI invoice books the receipt on KATCHI without being told', async () => {
    const partyId = await fx.party('Katchi Payer');
    const { id, total } = await fx.invoice(partyId, { book: 'KATCHI', outbound: '2026-04-06' });

    const pay = await fx.call('POST', '/v1/payments', fx.tokens.owner, {
      party_id: partyId, payment_date: '2026-04-07', amount_pkr: total, payment_method: 'CASH',
      allocations: [{ invoice_id: id, allocated_amount_pkr: total }],
    });
    expect(pay.status).toBe(201);
    expect(pay.body.data.book_type).toBe('KATCHI');
    expect(await partyBalance(partyId, '1110', 'KATCHI')).toBeCloseTo(0, 2);
    expect(await partyBalance(partyId, '1110', 'PACCI')).toBeCloseTo(0, 2);
  });

  it('refuses one receipt across both books, and allocating across books', async () => {
    const partyId = await fx.party('Mixed Book Payer');
    const k = await fx.invoice(partyId, { book: 'KATCHI', outbound: '2026-04-08' });
    const p = await fx.invoice(partyId, { outbound: '2026-04-08' });

    const mixed = await fx.call('POST', '/v1/payments', fx.tokens.owner, {
      party_id: partyId, payment_date: '2026-04-09', amount_pkr: k.total + p.total, payment_method: 'CASH',
      allocations: [
        { invoice_id: k.id, allocated_amount_pkr: k.total },
        { invoice_id: p.id, allocated_amount_pkr: p.total },
      ],
    });
    expect(mixed.status).toBe(400);

    const onAccount = await fx.call('POST', '/v1/payments', fx.tokens.owner, {
      party_id: partyId, payment_date: '2026-04-09', amount_pkr: k.total, payment_method: 'CASH',
    });
    expect(onAccount.status).toBe(201);
    expect(onAccount.body.data.book_type).toBe('PACCI');
    const cross = await fx.call('POST', `/v1/payments/${onAccount.body.data.id}/allocate`, fx.tokens.owner, {
      allocations: [{ invoice_id: k.id, allocated_amount_pkr: k.total }],
    });
    expect(cross.status).toBe(400);
  });
});

describe('advances and on-account receipts (R-02, R-13, R-22)', () => {
  it('posts JE-04 on every application of an advance, and derives the status', async () => {
    const partyId = await fx.party('Advance Party');
    const a = await fx.invoice(partyId, { bags: 20, outbound: '2026-04-10' });
    const b = await fx.invoice(partyId, { bags: 20, outbound: '2026-04-10' });

    const adv = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-04-11', amount_pkr: 1000, payment_method: 'CASH', is_advance: true,
    });
    expect(adv.status).toBe(201);
    const payId = adv.body.data.id;
    expect(await partyBalance(partyId, '2010')).toBe(-1000);

    const first = await fx.call('POST', `/v1/payments/${payId}/allocate`, fx.tokens.accountant, {
      allocations: [{ invoice_id: a.id, allocated_amount_pkr: 400 }],
    });
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe('ADVANCE');
    expect(first.body.data.unallocated_pkr).toBe(600);

    const second = await fx.call('POST', `/v1/payments/${payId}/allocate`, fx.tokens.accountant, {
      allocations: [{ invoice_id: b.id, allocated_amount_pkr: 300 }],
    });
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('ADVANCE');

    // Only what is still unapplied stays in 2010; the invoices' AR fell by what was applied.
    expect(await partyBalance(partyId, '2010')).toBe(-300);
    expect(await partyBalance(partyId, '1110')).toBeCloseTo(a.total + b.total - 700, 2);

    const rest = await fx.call('POST', `/v1/payments/${payId}/allocate`, fx.tokens.accountant, {
      allocations: [{ invoice_id: b.id, allocated_amount_pkr: 300 }],
    });
    expect(rest.status).toBe(200);
    expect(rest.body.data.status).toBe('ALLOCATED');
    expect(rest.body.data.can_allocate).toBe(false);
    expect(await partyBalance(partyId, '2010')).toBe(0);
  });

  it('a receipt on account stays RECORDED until fully applied', async () => {
    const partyId = await fx.party('On Account Party');
    const a = await fx.invoice(partyId, { outbound: '2026-04-12' });
    const pay = await fx.call('POST', '/v1/payments', fx.tokens.accountant, {
      party_id: partyId, payment_date: '2026-04-13', amount_pkr: a.total, payment_method: 'CASH',
    });
    expect(pay.body.data.status).toBe('RECORDED');
    expect(pay.body.data.can_allocate).toBe(true);

    const part = await fx.call('POST', `/v1/payments/${pay.body.data.id}/allocate`, fx.tokens.accountant, {
      allocations: [{ invoice_id: a.id, allocated_amount_pkr: 100 }],
    });
    expect(part.status).toBe(200);
    expect(part.body.data.status).toBe('RECORDED');
    expect(part.body.data.unallocated_pkr).toBeCloseTo(a.total - 100, 2);
  });
});
