import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF-1.4 inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000200';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000501';

let app: FastifyInstance;
let operatorToken: string;
let managerToken: string;
let accountantToken: string;
let ownerPartyId: string;
let otherPartyId: string;

async function createParty(name: string, phone: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: { name, party_type: 'FARMER', phone_primary: phone, credit_terms_days: 30 },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id;
}

async function createLot(opts: {
  ownerPartyId: string;
  quantity: number;
  inboundDate: string;
}): Promise<{ id: string; lot_number: string }> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: opts.ownerPartyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: opts.quantity,
      accepted_weight_kg: opts.quantity * 20,
      inbound_date: opts.inboundDate,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

async function finalizeOutbound(opts: {
  lotId: string;
  quantity: number;
  outboundDate: string;
}): Promise<string> {
  const createRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: {
      lot_id: opts.lotId,
      withdrawal_type: 'FULL',
      quantity_withdrawn_bags: opts.quantity,
      outbound_date: opts.outboundDate,
    },
  });
  expect(createRes.statusCode).toBe(201);
  const outboundId = JSON.parse(createRes.body).data.id;

  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: opts.quantity * 19.5 },
  });

  const finalizeRes = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finalizeRes.statusCode).toBe(200);
  const invoiceId = JSON.parse(finalizeRes.body).data.invoice_id;
  expect(invoiceId).toBeTruthy();
  return invoiceId;
}

async function finalizeInvoice(invoiceId: string): Promise<number> {
  const res = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${invoiceId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data.total_pkr;
}

beforeAll(async () => {
  app = await getTestApp();

  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });

  const op = await loginAsRole(app, 'OPERATOR');
  operatorToken = op.accessToken;
  const mgr = await loginAsRole(app, 'MANAGER');
  managerToken = mgr.accessToken;
  const acc = await loginAsRole(app, 'ACCOUNTANT');
  accountantToken = acc.accessToken;

  ownerPartyId = await createParty('Payment Owner Party', '03001000001');
  otherPartyId = await createParty('Payment Other Party', '03001000002');
});

afterAll(async () => {
  await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
  await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
  await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
  await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('Payment — Financial Ledger', () => {
  it('1. Full CASH allocation → balance_due=0 and status=ALLOCATED', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 10, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 10, outboundDate: '2026-04-01' });
    const totalPkr = await finalizeInvoice(invoiceId); // 10 × 50 = 500

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-05',
        amount_pkr: totalPkr,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr }],
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    expect(payment.status).toBe('ALLOCATED');
    expect(payment.payment_method).toBe('CASH');
    expect(payment.allocations).toHaveLength(1);
    expect(payment.allocations[0].allocated_amount_pkr).toBe(totalPkr);

    // Verify invoice balance_due = 0
    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
    });
    const inv = JSON.parse(invRes.body).data;
    expect(inv.amount_paid_pkr).toBe(totalPkr);
    expect(inv.balance_due_pkr).toBe(0);
  });

  it('2. Partial allocation → invoice partly paid, status=ALLOCATED', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 20, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 20, outboundDate: '2026-04-02' });
    const totalPkr = await finalizeInvoice(invoiceId); // 20 × 50 = 1000

    const partial = totalPkr / 2;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-06',
        amount_pkr: totalPkr,
        payment_method: 'BANK_TRANSFER',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: partial }],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.status).toBe('ALLOCATED');

    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
    });
    const inv = JSON.parse(invRes.body).data;
    expect(inv.amount_paid_pkr).toBe(partial);
    expect(inv.balance_due_pkr).toBe(partial);
  });

  it('3. Advance payment (is_advance=true) → status=ADVANCE, no allocations', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-07',
        amount_pkr: 2000,
        payment_method: 'CASH',
        is_advance: true,
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    expect(payment.status).toBe('ADVANCE');
    expect(payment.is_advance).toBe(true);
    expect(payment.allocations).toHaveLength(0);
  });

  it('4. Cheque payment → clearance_status=CLEARED', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-08',
        amount_pkr: 5000,
        payment_method: 'CHEQUE',
        reference_number: 'CHQ-12345',
        cheque_date: '2026-04-10',
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    expect(payment.payment_method).toBe('CHEQUE');
    expect(payment.clearance_status).toBe('CLEARED');
    expect(payment.reference_number).toBe('CHQ-12345');
    expect(payment.cheque_date).toBe('2026-04-10');
    expect(payment.status).toBe('RECORDED');
  });

  it('5. Over-allocation → 422 PAYMENT_OVER_ALLOCATED', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 5, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 5, outboundDate: '2026-04-03' });
    const totalPkr = await finalizeInvoice(invoiceId); // 5 × 50 = 250

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-09',
        amount_pkr: 100, // less than the allocation
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr }], // > amount_pkr
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PAYMENT_OVER_ALLOCATED');
  });

  it('6. Allocation to DRAFT invoice → 422 VALIDATION_ERROR', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 8, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 8, outboundDate: '2026-04-04' });
    // Invoice is still DRAFT

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-09',
        amount_pkr: 1000,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: 400 }],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('7. Allocation to another party\'s invoice → 422 PAYMENT_PARTY_MISMATCH', async () => {
    // Create invoice belonging to otherPartyId
    const lot = await createLot({ ownerPartyId: otherPartyId, quantity: 6, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 6, outboundDate: '2026-04-05' });
    await finalizeInvoice(invoiceId);

    // Try to pay with ownerPartyId (mismatch)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-09',
        amount_pkr: 1000,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: 300 }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PAYMENT_PARTY_MISMATCH');
  });

  it('8. Allocation exceeding invoice balance → 422 PAYMENT_EXCEEDS_INVOICE_BALANCE', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 4, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 4, outboundDate: '2026-04-06' });
    const totalPkr = await finalizeInvoice(invoiceId); // 4 × 50 = 200

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-09',
        amount_pkr: 5000,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr + 100 }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PAYMENT_EXCEEDS_INVOICE_BALANCE');
  });

  it('9. Dishonour cheque → allocations reversed, invoice amount_paid rolls back', async () => {
    const lot = await createLot({ ownerPartyId, quantity: 12, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 12, outboundDate: '2026-04-07' });
    const totalPkr = await finalizeInvoice(invoiceId); // 12 × 50 = 600

    // Create cheque payment with full allocation
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-09',
        amount_pkr: totalPkr,
        payment_method: 'CHEQUE',
        reference_number: 'CHQ-BOUNCE',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: totalPkr }],
      },
    });
    expect(payRes.statusCode).toBe(201);
    const paymentId = JSON.parse(payRes.body).data.id;

    // Dishonour
    const dishonourRes = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/dishonour`,
      headers: authHeaders(accountantToken),
      payload: { notes: 'Bank returned cheque' },
    });
    expect(dishonourRes.statusCode).toBe(200);
    const dishonoured = JSON.parse(dishonourRes.body).data;
    expect(dishonoured.status).toBe('DISHONOURED');
    expect(dishonoured.clearance_status).toBe('BOUNCED');
    expect(dishonoured.allocations).toHaveLength(0);

    // Invoice balance_due restored
    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
    });
    const inv = JSON.parse(invRes.body).data;
    expect(inv.amount_paid_pkr).toBe(0);
    expect(inv.balance_due_pkr).toBe(totalPkr);
  });

  it('10. Dishonour non-cheque payment → 409 PAYMENT_NOT_CHEQUE', async () => {
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-10',
        amount_pkr: 500,
        payment_method: 'CASH',
      },
    });
    const paymentId = JSON.parse(payRes.body).data.id;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/dishonour`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PAYMENT_NOT_CHEQUE');
  });

  it('11. Role gating: OPERATOR → 403; ACCOUNTANT → 201', async () => {
    const opRes = await app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: authHeaders(operatorToken),
    });
    expect(opRes.statusCode).toBe(403);

    const accRes = await app.inject({
      method: 'GET',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
    });
    expect(accRes.statusCode).toBe(200);

    // ACCOUNTANT can create payment
    const createRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ownerPartyId,
        payment_date: '2026-04-11',
        amount_pkr: 1500,
        payment_method: 'MOBILE_WALLET',
      },
    });
    expect(createRes.statusCode).toBe(201);
  });

  it('12. GET /v1/parties/:id/ledger — chronological entries, WF-04 e2e', async () => {
    // Use a fresh party for clean ledger
    const ledgerPartyId = await createParty('Ledger Test Party', '03001099999');

    // Create and finalize an invoice (debit)
    const lot = await createLot({ ownerPartyId: ledgerPartyId, quantity: 20, inboundDate: '2026-02-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 20, outboundDate: '2026-03-01' });
    const totalPkr = await finalizeInvoice(invoiceId); // 20 × 50 = 1000

    // Record partial payment (credit)
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: ledgerPartyId,
        payment_date: '2026-12-01',
        amount_pkr: 600,
        payment_method: 'CASH',
        allocations: [{ invoice_id: invoiceId, allocated_amount_pkr: 600 }],
      },
    });
    expect(payRes.statusCode).toBe(201);

    // Get ledger
    const ledgerRes = await app.inject({
      method: 'GET',
      url: `/v1/parties/${ledgerPartyId}/ledger`,
      headers: authHeaders(accountantToken),
    });
    expect(ledgerRes.statusCode).toBe(200);
    const ledger = JSON.parse(ledgerRes.body).data;

    expect(ledger.party_id).toBe(ledgerPartyId);
    expect(ledger.entries).toHaveLength(2);

    // First entry: invoice (debit)
    const invoiceEntry = ledger.entries[0];
    expect(invoiceEntry.type).toBe('INVOICE');
    expect(invoiceEntry.debit_pkr).toBe(totalPkr);
    expect(invoiceEntry.credit_pkr).toBe(0);
    expect(invoiceEntry.balance_pkr).toBe(totalPkr);

    // Second entry: payment (credit)
    const paymentEntry = ledger.entries[1];
    expect(paymentEntry.type).toBe('PAYMENT');
    expect(paymentEntry.credit_pkr).toBe(600);
    expect(paymentEntry.debit_pkr).toBe(0);
    expect(paymentEntry.balance_pkr).toBe(totalPkr - 600);

    // Totals
    expect(ledger.total_debit_pkr).toBe(totalPkr);
    expect(ledger.total_credit_pkr).toBe(600);
    expect(ledger.closing_balance_pkr).toBe(totalPkr - 600);
  });
});
