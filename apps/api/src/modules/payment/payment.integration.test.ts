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

describe('Phase 9 — Combined settlement (invoice + loan)', () => {
  async function issueLoan(partyId: string, amount: number, date: string) {
    const ownerLogin = await loginAsRole(app, 'OWNER');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/loans/issue',
      headers: authHeaders(ownerLogin.accessToken),
      payload: {
        party_id: partyId,
        issue_date: date,
        principal_pkr: amount,
        payment_method: 'CASH',
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data;
  }

  async function cleanLoans() {
    await prisma.paymentAllocation.deleteMany({ where: { loanId: { not: null } } });
    await prisma.partyLoanRepayment.deleteMany({ where: { loan: { facilityId: TEST_FACILITY_ID } } });
    await prisma.partyLoan.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { issueJournalEntryId: null, writeOffJournalEntryId: null },
    });
    await prisma.partyLoan.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  }

  it('one payment allocates across invoice + loan in one transaction', async () => {
    await cleanLoans();
    const partyId = await createParty('Combined Settle Party', '03001099001');
    const lot = await createLot({ ownerPartyId: partyId, quantity: 10, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({ lotId: lot.id, quantity: 10, outboundDate: '2026-09-01' });
    const total = await finalizeInvoice(invoiceId);

    const loan = await issueLoan(partyId, 100000, '2026-04-10');

    const totalPayment = total + 100000;
    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: totalPayment,
        payment_method: 'CASH',
        allocations: [
          { invoice_id: invoiceId, allocated_amount_pkr: total },
          { target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 100000 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;
    expect(payment.allocations).toHaveLength(2);

    const invoiceAlloc = payment.allocations.find((a: any) => a.target === 'INVOICE');
    const loanAlloc = payment.allocations.find((a: any) => a.target === 'LOAN');
    expect(invoiceAlloc.invoice_id).toBe(invoiceId);
    expect(loanAlloc.loan_id).toBe(loan.id);
    expect(loanAlloc.loan_number).toBe(loan.loan_number);

    const loanRes = await app.inject({
      method: 'GET',
      url: `/v1/loans/${loan.id}`,
      headers: authHeaders(accountantToken),
    });
    const loanData = JSON.parse(loanRes.body).data;
    expect(loanData.status).toBe('RECOVERED');
    expect(loanData.balance_outstanding_pkr).toBe(0);
    expect(loanData.repayments).toHaveLength(1);
    expect(loanData.repayments[0].payment_method).toBe('DEDUCTED_FROM_PRODUCE');
    expect(loanData.repayments[0].journal_entry_id).toBeTruthy();

    const je19 = await prisma.journalEntry.findUnique({
      where: { id: loanData.repayments[0].journal_entry_id },
      include: { lines: true },
    });
    expect(je19?.entryType).toBe('PESHGI_RECOVERY');
    expect(je19?.lines.find((l) => l.accountCode === '1140')?.creditAmount.toString()).toBe('100000');

    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
    });
    expect(JSON.parse(invRes.body).data.balance_due_pkr).toBe(0);

    // GL invariant: total cash debit posted by this payment must equal payment.amount_pkr exactly.
    // Pre-fix bug: JE-02 was posting full 150k while JE-19 also debited 100k cash → 250k cash debit.
    const cashLines = await prisma.journalEntryLine.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '1010',
        journalEntry: {
          OR: [{ sourceId: payment.id }, { sourceId: loanData.repayments[0].id }],
        },
      },
    });
    const cashDebit = cashLines.reduce((s, l) => s + Number(l.debitAmount), 0);
    expect(cashDebit).toBe(totalPayment);
    // And the JE-02 itself should have booked only the invoice portion.
    const je02 = await prisma.journalEntry.findFirst({
      where: { sourceId: payment.id, entryType: 'PAYMENT' },
      include: { lines: true },
    });
    expect(je02).toBeTruthy();
    expect(Number(je02!.lines.find((l) => l.accountCode === '1010')!.debitAmount)).toBe(total);
  });

  it('loan-only payment skips JE-02 entirely (no double cash debit)', async () => {
    await cleanLoans();
    const partyId = await createParty('Loan Only Party', '03001099006');
    const loan = await issueLoan(partyId, 40000, '2026-04-10');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: 40000,
        payment_method: 'CASH',
        allocations: [{ target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 40000 }],
      },
    });
    expect(res.statusCode).toBe(201);
    const payment = JSON.parse(res.body).data;

    // No JE-02 should exist; only JE-19 for the loan cash receipt.
    const je02 = await prisma.journalEntry.findFirst({
      where: { sourceId: payment.id, entryType: 'PAYMENT' },
    });
    expect(je02).toBeNull();

    // Inspect JE-19 for THIS payment's repayment only (scoped via loan id).
    const loanDetail = await app.inject({
      method: 'GET',
      url: `/v1/loans/${loan.id}`,
      headers: authHeaders(accountantToken),
    });
    const loanData = JSON.parse(loanDetail.body).data;
    expect(loanData.status).toBe('RECOVERED');
    expect(loanData.repayments).toHaveLength(1);
    const je19 = await prisma.journalEntry.findUnique({
      where: { id: loanData.repayments[0].journal_entry_id },
      include: { lines: true },
    });
    expect(je19?.entryType).toBe('PESHGI_RECOVERY');
    const cashLine = je19!.lines.find((l) => l.accountCode === '1010');
    expect(cashLine).toBeTruthy();
    expect(Number(cashLine!.debitAmount)).toBe(40000);
  });

  it('dishonour of cheque combined settlement reverses both invoice and loan sides', async () => {
    await cleanLoans();
    const partyId = await createParty('Cheque Combined', '03001099008');
    const lot = await createLot({ ownerPartyId: partyId, quantity: 10, inboundDate: '2026-03-01' });
    const invoiceId = await finalizeOutbound({
      lotId: lot.id,
      quantity: 10,
      outboundDate: '2026-09-01',
    });
    const invoiceTotal = await finalizeInvoice(invoiceId);

    const loanPrincipal = 100000;
    const loan = await issueLoan(partyId, loanPrincipal, '2026-04-10');

    const totalPayment = invoiceTotal + loanPrincipal;
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: totalPayment,
        payment_method: 'CHEQUE',
        cheque_date: '2026-09-01',
        reference_number: 'CHQ-COMBINED-BOUNCE',
        allocations: [
          { invoice_id: invoiceId, allocated_amount_pkr: invoiceTotal },
          { target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: loanPrincipal },
        ],
      },
    });
    expect(payRes.statusCode).toBe(201);
    const payment = JSON.parse(payRes.body).data;
    const paymentId = payment.id;

    // Capture original JE-02 and JE-19 ids before dishonour so we can verify
    // they get marked REVERSED.
    const originalJe02 = await prisma.journalEntry.findFirst({
      where: { facilityId: TEST_FACILITY_ID, sourceId: paymentId, entryType: 'PAYMENT' },
    });
    expect(originalJe02).toBeTruthy();
    const loanDetail = await app.inject({
      method: 'GET',
      url: `/v1/loans/${loan.id}`,
      headers: authHeaders(accountantToken),
    });
    const loanData = JSON.parse(loanDetail.body).data;
    const originalJe19Id = loanData.repayments[0].journal_entry_id as string;
    expect(originalJe19Id).toBeTruthy();

    // Dishonour the cheque
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

    // Data side: invoice balance restored, loan balance restored, repayment row gone.
    const invRes = await app.inject({
      method: 'GET',
      url: `/v1/invoices/${invoiceId}`,
      headers: authHeaders(accountantToken),
    });
    const inv = JSON.parse(invRes.body).data;
    expect(inv.amount_paid_pkr).toBe(0);
    expect(inv.balance_due_pkr).toBe(invoiceTotal);

    const loanAfterRes = await app.inject({
      method: 'GET',
      url: `/v1/loans/${loan.id}`,
      headers: authHeaders(accountantToken),
    });
    const loanAfter = JSON.parse(loanAfterRes.body).data;
    expect(loanAfter.status).toBe('ACTIVE');
    expect(loanAfter.balance_outstanding_pkr).toBe(loanPrincipal);
    expect(loanAfter.repayments ?? []).toHaveLength(0);

    // JE-06 (cheque dishonour) should be posted for the INVOICE portion only — not the full 150k.
    const je06 = await prisma.journalEntry.findFirst({
      where: { facilityId: TEST_FACILITY_ID, sourceId: paymentId, entryType: 'REVERSAL' },
      include: { lines: true },
    });
    expect(je06).toBeTruthy();
    const je06CashCredit = je06!.lines.find((l) => l.accountCode === '1020');
    // CHEQUE asset account is 1020 per PAYMENT_METHOD_ASSET_ACCOUNT
    expect(je06CashCredit).toBeTruthy();
    expect(Number(je06CashCredit!.creditAmount)).toBe(invoiceTotal);

    // Original JE-02 should be flagged reversed by JE-06.
    const originalJe02Refreshed = await prisma.journalEntry.findUnique({
      where: { id: originalJe02!.id },
    });
    expect(originalJe02Refreshed?.postingStatus).toBe('REVERSED');

    // Per-loan REVERSAL JE: sourceTable='party_loans', sourceId=loan.id, DR 1140 / CR 1020
    const loanReversal = await prisma.journalEntry.findFirst({
      where: {
        facilityId: TEST_FACILITY_ID,
        sourceTable: 'party_loans',
        sourceId: loan.id,
        entryType: 'REVERSAL',
      },
      include: { lines: true },
    });
    expect(loanReversal).toBeTruthy();
    const loanReversalCashCredit = loanReversal!.lines.find((l) => l.accountCode === '1020');
    const loanReversalPeshgiDebit = loanReversal!.lines.find((l) => l.accountCode === '1140');
    expect(Number(loanReversalCashCredit!.creditAmount)).toBe(loanPrincipal);
    expect(Number(loanReversalPeshgiDebit!.debitAmount)).toBe(loanPrincipal);

    // Original JE-19 should now be marked REVERSED.
    const originalJe19Refreshed = await prisma.journalEntry.findUnique({
      where: { id: originalJe19Id },
    });
    expect(originalJe19Refreshed?.postingStatus).toBe('REVERSED');

    // Net cash on 1020 across all four JEs must be zero:
    // +invoiceTotal (JE-02) + loanPrincipal (JE-19) − invoiceTotal (JE-06) − loanPrincipal (loan reversal).
    const cashLines = await prisma.journalEntryLine.findMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: '1020',
        journalEntry: {
          OR: [
            { id: originalJe02!.id },
            { id: originalJe19Id },
            { id: je06!.id },
            { id: loanReversal!.id },
          ],
        },
      },
    });
    const netCash = cashLines.reduce(
      (s, l) => s + Number(l.debitAmount) - Number(l.creditAmount),
      0,
    );
    expect(netCash).toBe(0);
  });

  it('POST /v1/payments/:id/allocate rejects LOAN-target allocations', async () => {
    await cleanLoans();
    const partyId = await createParty('Post Hoc Loan', '03001099007');
    const loan = await issueLoan(partyId, 20000, '2026-04-10');

    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: 20000,
        payment_method: 'CASH',
      },
    });
    expect(payRes.statusCode).toBe(201);
    const paymentId = JSON.parse(payRes.body).data.id;

    const alloc = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/allocate`,
      headers: authHeaders(accountantToken),
      payload: {
        allocations: [{ target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 20000 }],
      },
    });
    expect(alloc.statusCode).toBe(400);
    expect(JSON.parse(alloc.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects loan allocation exceeding outstanding balance', async () => {
    await cleanLoans();
    const partyId = await createParty('Over Allocate', '03001099002');
    const loan = await issueLoan(partyId, 50000, '2026-04-10');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: 60000,
        payment_method: 'CASH',
        allocations: [
          { target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 60000 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PESHGI_OVER_REPAYMENT');
  });

  it('rejects loan allocation when loan party does not match payment party', async () => {
    await cleanLoans();
    const partyA = await createParty('Loan Belongs To A', '03001099003');
    const partyB = await createParty('Payer B', '03001099004');
    const loan = await issueLoan(partyA, 25000, '2026-04-10');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyB,
        payment_date: '2026-09-01',
        amount_pkr: 25000,
        payment_method: 'CASH',
        allocations: [
          { target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 25000 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('PAYMENT_PARTY_MISMATCH');
  });

  it('rejects loan allocation when loan is WRITTEN_OFF', async () => {
    await cleanLoans();
    const partyId = await createParty('Inactive Loan', '03001099005');
    const loan = await issueLoan(partyId, 30000, '2026-04-10');
    const ownerLogin = await loginAsRole(app, 'OWNER');
    await app.inject({
      method: 'POST',
      url: `/v1/loans/${loan.id}/write-off`,
      headers: authHeaders(ownerLogin.accessToken),
      payload: { reason: 'unrecoverable' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: partyId,
        payment_date: '2026-09-01',
        amount_pkr: 30000,
        payment_method: 'CASH',
        allocations: [
          { target: 'LOAN', loan_id: loan.id, allocated_amount_pkr: 30000 },
        ],
      },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PESHGI_INACTIVE');
  });
});
