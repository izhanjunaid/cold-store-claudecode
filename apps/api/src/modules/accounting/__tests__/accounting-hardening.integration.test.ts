/**
 * Priority-2 backend fixes from docs/16_accounting_module_audit.md:
 *   F-5  credit notes must not exceed the invoice balance due
 *   F-6  CoA parent validation + statement completeness
 *   F-7  AUTO_DRAFT journal entries promotable to POSTED
 *   F-9  KATCHI gates on every source document + PACCI-default reads
 *   F-2b audit attribution (changed_by = acting user)
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

vi.mock('../../pdf/pdf.service', () => ({
  renderStorageReceipt: vi.fn().mockResolvedValue(Buffer.from('%PDF mock\n')),
  renderStorageReceiptHtml: vi.fn().mockReturnValue('<html>mock</html>'),
  renderTransferAcknowledgment: vi.fn().mockResolvedValue(Buffer.from('%PDF ack\n')),
  renderTransferAcknowledgmentHtml: vi.fn().mockReturnValue('<html>ack</html>'),
  renderDispatchNote: vi.fn().mockResolvedValue(Buffer.from('%PDF dn\n')),
  renderDispatchNoteHtml: vi.fn().mockReturnValue('<html>dn</html>'),
  renderInvoice: vi.fn().mockResolvedValue(Buffer.from('%PDF inv\n')),
  renderInvoiceHtml: vi.fn().mockReturnValue('<html>inv</html>'),
}));

const prisma = new PrismaClient();

const POTATO_ID = '00000000-0000-0000-0000-000000000100';
const CHAMBER_A = '00000000-0000-0000-0000-000000000300';
const RATE_PLAN_SEASONAL = '00000000-0000-0000-0000-000000000550';

let app: FastifyInstance;
let ownerToken: string;
let ownerUserId: string;
let managerToken: string;
let managerUserId: string;
let accountantToken: string;
let operatorToken: string;
let testParty: string;

async function createParty(name: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/parties',
    headers: authHeaders(operatorToken),
    payload: {
      name,
      party_type: 'FARMER',
      phone_primary: `0300${Date.now() % 10000000}`.slice(0, 11),
      credit_terms_days: 30,
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data.id as string;
}

async function finalizedInvoice(partyId: string): Promise<{ invoiceId: string; totalPkr: number }> {
  const lotRes = await app.inject({
    method: 'POST',
    url: '/v1/lots',
    headers: authHeaders(operatorToken),
    payload: {
      owner_party_id: partyId,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: 20,
      accepted_weight_kg: 400,
      inbound_date: '2026-04-01',
    },
  });
  expect(lotRes.statusCode).toBe(201);
  const lotId = JSON.parse(lotRes.body).data.id;

  const outRes = await app.inject({
    method: 'POST',
    url: '/v1/outbound-events',
    headers: authHeaders(operatorToken),
    payload: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: 20, outbound_date: '2026-04-30' },
  });
  expect(outRes.statusCode).toBe(201);
  const outboundId = JSON.parse(outRes.body).data.id;

  await app.inject({
    method: 'PATCH',
    url: `/v1/outbound-events/${outboundId}/weight`,
    headers: authHeaders(operatorToken),
    payload: { outbound_weight_kg: 400 },
  });
  const finOut = await app.inject({
    method: 'POST',
    url: `/v1/outbound-events/${outboundId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(finOut.statusCode).toBe(200);
  const draftId = JSON.parse(finOut.body).data.invoice_id as string;

  const fin = await app.inject({
    method: 'POST',
    url: `/v1/invoices/${draftId}/finalize`,
    headers: authHeaders(managerToken),
    payload: {},
  });
  expect(fin.statusCode).toBe(200);
  const inv = JSON.parse(fin.body).data;
  return { invoiceId: inv.id, totalPkr: inv.total_pkr as number };
}

async function payInvoice(partyId: string, invoiceId: string, amount: number): Promise<void> {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/payments',
    headers: authHeaders(accountantToken),
    payload: {
      party_id: partyId,
      payment_date: '2026-05-01',
      amount_pkr: amount,
      payment_method: 'CASH',
      allocations: [{ target: 'INVOICE', invoice_id: invoiceId, allocated_amount_pkr: amount }],
    },
  });
  expect(res.statusCode).toBe(201);
}

function creditNotePayload(invoiceId: string, amount: number, bookType?: 'PACCI' | 'KATCHI') {
  return {
    original_invoice_id: invoiceId,
    credit_date: '2026-05-02',
    reason: 'hardening test credit',
    ...(bookType ? { book_type: bookType } : {}),
    line_items: [{ revenue_account_code: '4010', description: 'storage adjustment', amount_pkr: amount }],
  };
}

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.creditNoteLineItem.deleteMany({ where: { creditNote: { facilityId: TEST_FACILITY_ID } } });
    await prisma.creditNote.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.paymentAllocation.deleteMany({ where: { payment: { facilityId: TEST_FACILITY_ID } } });
    // The H5 (KATCHI later-stage gate) tests below create a payroll run —
    // period+type is unique per facility, so a leftover run from an earlier
    // pass of this file collides with a 409 on the next one. Null the JE refs
    // before the blanket journalEntry delete below, matching the FK order
    // payroll.integration.test.ts already uses for the same tables.
    await prisma.payrollLineItem.deleteMany({ where: { payrollRun: { facilityId: TEST_FACILITY_ID } } });
    await prisma.payrollRun.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { payrollJournalEntryId: null, paymentJournalEntryId: null, remittanceJournalEntryId: null },
    });
    await prisma.payrollRun.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    // Deliberately NOT deleting employee/employeeAdvance rows here: this file's
    // employee_advances test creates its own employee per run (no unique
    // constraint to collide on), and payroll.integration.test.ts /
    // employee-advance.integration.test.ts create long-lived employees on the
    // same shared TEST_FACILITY_ID — a blanket deleteMany in this file's
    // beforeAll/afterAll would race and delete rows those files are mid-use of
    // when vitest runs files in parallel.
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.journalEntry.updateMany({
      where: { facilityId: TEST_FACILITY_ID },
      data: { reversedById: null },
    });
    await prisma.invoice.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { journalEntryId: null } });
    await prisma.payment.updateMany({ where: { facilityId: TEST_FACILITY_ID }, data: { journalEntryId: null } });
    await prisma.journalEntry.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.payment.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.invoiceLineItem.deleteMany({ where: { invoice: { facilityId: TEST_FACILITY_ID } } });
    await prisma.invoice.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.outboundEvent.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.ownershipHistory.deleteMany({ where: { lot: { facilityId: TEST_FACILITY_ID } } });
    await prisma.lot.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
    await prisma.chartOfAccounts.deleteMany({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode: { in: ['1999', '4995', '7000', '7010', '7020', '7030', '7900', '7910', '9902', '9903', '9904', '9905', '9906', '3910'] },
      },
    });
    await prisma.chartOfAccounts.updateMany({
      where: { facilityId: TEST_FACILITY_ID, accountCode: { in: ['1010', '6080'] } },
      data: { isActive: true },
    });
    await prisma.$executeRawUnsafe(`DELETE FROM audit_log WHERE facility_id = $1::uuid`, TEST_FACILITY_ID);
  });
}

beforeAll(async () => {
  app = await getTestApp();
  await cleanup();
  const owner = await loginAsRole(app, 'OWNER');
  const manager = await loginAsRole(app, 'MANAGER');
  const accountant = await loginAsRole(app, 'ACCOUNTANT');
  const operator = await loginAsRole(app, 'OPERATOR');
  ownerToken = owner.accessToken;
  ownerUserId = owner.user.id;
  managerToken = manager.accessToken;
  managerUserId = manager.user.id;
  accountantToken = accountant.accessToken;
  operatorToken = operator.accessToken;
  testParty = await createParty(`Hardening-${Date.now()}`);
}, 30_000);

afterAll(async () => {
  await cleanup();
  await closeTestApp();
  await prisma.$disconnect();
});

// ============================================================
// F-2b — audit attribution: changed_by must be the acting user
// ============================================================

describe('audit attribution (F-2b)', () => {
  it('journal-entry audit rows carry the acting user, not the zero uuid', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-03-16',
        description: 'attribution test',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 10, credit_amount: 0 },
          { account_code: '4050', debit_amount: 0, credit_amount: 10 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const jeId = JSON.parse(res.body).data.id as string;

    const rows = await prisma.$queryRawUnsafe<{ changed_by: string }[]>(
      `SELECT changed_by::text AS changed_by FROM audit_log
       WHERE table_name = 'journal_entries' AND record_id = $1::uuid AND action = 'INSERT'`,
      jeId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.changed_by).toBe(managerUserId);
  });

  it('chart-of-accounts audit rows carry the acting user', async () => {
    // 6020 Rent is a non-system account — system accounts reject renames (phase/19).
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6020',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Rent (attributed)' },
    });
    expect(res.statusCode).toBe(200);
    const accountId = JSON.parse(res.body).data.id as string;

    const rows = await prisma.$queryRawUnsafe<{ changed_by: string }[]>(
      `SELECT changed_by::text AS changed_by FROM audit_log
       WHERE table_name = 'chart_of_accounts' AND record_id = $1::uuid AND action = 'UPDATE'
       ORDER BY changed_at DESC LIMIT 1`,
      accountId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.changed_by).toBe(ownerUserId);

    await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6020',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Rent' },
    });
  });
});

// ============================================================
// F-10 — template-wired accounts cannot be deactivated
// ============================================================

describe('posting-template accounts are protected (F-10)', () => {
  it('rejects deactivating 1010 Cash — every cash posting depends on it', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/1010',
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
  });

  it('rejects deactivating 6080 Bad Debt Expense', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6080',
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });
    expect(res.statusCode).toBe(409);
  });
});

// ============================================================
// F-11 — dishonour voids subledger rows instead of deleting them
// ============================================================

describe('cheque dishonour preserves allocation history (F-11)', () => {
  it('marks allocations voided and hides them from payment reads', async () => {
    const { invoiceId, totalPkr } = await finalizedInvoice(testParty);
    const payRes = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload: {
        party_id: testParty,
        payment_date: '2026-05-04',
        amount_pkr: totalPkr,
        payment_method: 'CHEQUE',
        reference_number: 'CHQ-HARDENING-1',
        allocations: [{ target: 'INVOICE', invoice_id: invoiceId, allocated_amount_pkr: totalPkr }],
      },
    });
    expect(payRes.statusCode).toBe(201);
    const paymentId = JSON.parse(payRes.body).data.id as string;

    const dis = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/dishonour`,
      headers: authHeaders(accountantToken),
      payload: { notes: 'bounced (hardening test)' },
    });
    expect(dis.statusCode).toBe(200);

    // The operational record survives, flagged as voided…
    const rows = await prisma.$queryRawUnsafe<{ voided_at: Date | null }[]>(
      `SELECT voided_at FROM payment_allocations WHERE payment_id = $1::uuid`,
      paymentId,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]!.voided_at).not.toBeNull();

    // …while consumers see the same shape as before (no active allocations).
    const detail = await app.inject({
      method: 'GET',
      url: `/v1/payments/${paymentId}`,
      headers: authHeaders(accountantToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(JSON.parse(detail.body).data.allocations.length).toBe(0);
  });
});

// ============================================================
// F-7 — draft journal entries are promotable to POSTED
// ============================================================

describe('draft journal entries can be posted (F-7)', () => {
  async function createDraft(token: string, bookType?: 'KATCHI'): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(token),
      payload: {
        entry_date: '2026-03-18',
        description: `draft promotion test ${Date.now()}`,
        posting_status: 'AUTO_DRAFT',
        ...(bookType ? { book_type: bookType } : {}),
        lines: [
          { account_code: '1010', debit_amount: 25, credit_amount: 0 },
          { account_code: '4050', debit_amount: 0, credit_amount: 25 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.body).data.id as string;
  }

  it('MANAGER promotes a draft and it reaches the general ledger', async () => {
    const id = await createDraft(managerToken);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.posting_status).toBe('POSTED');
  });

  it('re-posting an already-posted entry is rejected', async () => {
    const id = await createDraft(managerToken);
    await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    const again = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(again.statusCode).toBe(409);
  });

  it('promotion re-checks the period lock', async () => {
    const id = await createDraft(managerToken);
    const lock = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 3, reason: 'promotion lock test' },
    });
    expect(lock.statusCode).toBe(201);
    try {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/accounting/journal-entries/${id}/post`,
        headers: authHeaders(managerToken),
        payload: {},
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
    } finally {
      await app.inject({
        method: 'POST',
        url: '/v1/accounting/period-locks/2026/3/unlock',
        headers: authHeaders(ownerToken),
        payload: { reason: 'promotion lock test cleanup' },
      });
    }
  });

  it('ACCOUNTANT cannot promote drafts', async () => {
    const id = await createDraft(managerToken);
    const res = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  it('KATCHI drafts are promotable by OWNER only', async () => {
    const id = await createDraft(ownerToken, 'KATCHI');
    const asManager = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(asManager.statusCode).toBe(403);
    const asOwner = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(ownerToken),
      payload: {},
    });
    expect(asOwner.statusCode).toBe(200);
  });
});

// ============================================================
// P1-6 — cash-class accounts cannot go negative (phase/22, invariant 14)
// ============================================================
//
// SKIPPED — the guard this suite exercised (assertCashAccountsStayNonNegative
// in journal-entry.service.ts) was reverted after it turned 57 integration
// tests red across 9 files. Root cause: this codebase has no opening-balance
// mechanism for any cash-class account (1010/1020/1030) — every facility,
// test fixture included, starts those accounts at an implicit zero with
// nothing to fund them. Loan issuance, expense payments, and every other
// ordinary cash-out posting against that unfunded balance were rejected —
// e.g. peshgi.integration.test.ts's issueLoan() helper returned 422 instead
// of 201. The guard is correct in principle (a debit-normal balance below
// zero is physically impossible) but unenforceable until the system gains a
// way to establish an opening cash position — which is new capability
// (out of scope for this defect-repair phase), not a bug fix. See
// docs/20_audit_backlog.md P1-6 (DEFERRED) and invariant 14 (BLOCKED,
// same reason as invariant 13's cheque-clearing dependency). Left in place,
// skipped, as the spec for whichever phase adds opening balances.
describe.skip('cash-class accounts cannot go negative (P1-6, invariant 14)', () => {
  async function cashBalance(accountCode: string): Promise<number> {
    const sum = await prisma.journalEntryLine.aggregate({
      where: {
        facilityId: TEST_FACILITY_ID,
        accountCode,
        journalEntry: { facilityId: TEST_FACILITY_ID, postingStatus: 'POSTED' },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return Number(sum._sum.debitAmount ?? 0) - Number(sum._sum.creditAmount ?? 0);
  }

  it('rejects a manual POSTED entry that would drive 1010 below zero', async () => {
    const current = await cashBalance('1010');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-03-18',
        description: `cash-negative guard rejection ${Date.now()}`,
        posting_status: 'POSTED',
        lines: [
          { account_code: '4050', debit_amount: current + 1000, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: current + 1000 },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('CASH_ACCOUNT_WOULD_GO_NEGATIVE');
    expect(await cashBalance('1010')).toBe(current); // rejected, so unchanged
  });

  it('allows a POSTED entry that keeps the balance non-negative', async () => {
    const current = await cashBalance('1010');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-03-18',
        description: `cash-negative guard pass-through ${Date.now()}`,
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 1, credit_amount: 0 },
          { account_code: '4050', debit_amount: 0, credit_amount: 1 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    expect(await cashBalance('1010')).toBeCloseTo(current + 1);
  });

  it('an AUTO_DRAFT that would go negative is saved (drafts do not affect the balance yet)', async () => {
    const current = await cashBalance('1010');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-03-18',
        description: `cash-negative guard draft exemption ${Date.now()}`,
        posting_status: 'AUTO_DRAFT',
        lines: [
          { account_code: '4050', debit_amount: current + 1000, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: current + 1000 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    // ...but promoting that same draft to POSTED must re-check and reject.
    const id = JSON.parse(res.body).data.id as string;
    const promote = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${id}/post`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(promote.statusCode).toBe(422);
    expect(JSON.parse(promote.body).error.code).toBe('CASH_ACCOUNT_WOULD_GO_NEGATIVE');
  });

  // "Assert the loser" (docs/18 §1's lesson, re-applied): two concurrent posts
  // each look safe against a stale read of the balance, but together would
  // drive 1010 negative. Without the per-account advisoryXactLock inside
  // assertCashAccountsStayNonNegative, both could read the same starting
  // balance and both pass. With it, the second read happens only after the
  // first transaction has committed, so exactly one succeeds.
  it('serialises two concurrent posts so exactly one is rejected', async () => {
    const post = (debitCode: string, debitAmt: number, creditCode: string, creditAmt: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/accounting/journal-entries',
        headers: authHeaders(managerToken),
        payload: {
          entry_date: '2026-03-18',
          description: `cash-negative guard concurrency setup ${Date.now()}-${Math.random()}`,
          posting_status: 'POSTED',
          lines: [
            { account_code: debitCode, debit_amount: debitAmt, credit_amount: 0 },
            { account_code: creditCode, debit_amount: 0, credit_amount: creditAmt },
          ],
        },
      });

    // The ambient 1010 balance carries whatever every other test in this
    // shared facility has posted — unknown, and by the invariant itself
    // already guaranteed >= 0. Rather than aim for a margin around an
    // unknown number, drain it to exactly 0 first (a controlled, sequential
    // boundary case: credit == balance lands on 0, which the guard permits),
    // then fund it with a known amount. The race below then straddles a
    // number this test fully controls, independent of suite ordering.
    const current = await cashBalance('1010');
    if (current > 0) {
      const drain = await post('4050', current, '1010', current);
      expect(drain.statusCode).toBe(201);
    }
    expect(await cashBalance('1010')).toBeCloseTo(0);

    const fund = await post('1010', 100, '4050', 100);
    expect(fund.statusCode).toBe(201);
    expect(await cashBalance('1010')).toBeCloseTo(100);

    // Each of these alone is safe against a balance of 100 (100 - 70 = 30);
    // together they demand 140, which the balance cannot cover.
    const [a, b] = await Promise.all([
      post('4050', 70, '1010', 70),
      post('4050', 70, '1010', 70),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([201, 422]);

    const rejected = a.statusCode === 422 ? a : b;
    expect(JSON.parse(rejected.body).error.code).toBe('CASH_ACCOUNT_WOULD_GO_NEGATIVE');
    expect(await cashBalance('1010')).toBeCloseTo(30); // exactly one 70 went through
  });
});

// ============================================================
// F-9 — KATCHI gates on sources and reads
// ============================================================

describe('KATCHI source-document gates (F-9)', () => {
  it('ACCOUNTANT cannot record a KATCHI payment; OWNER can', async () => {
    const payload = {
      party_id: testParty,
      payment_date: '2026-05-03',
      amount_pkr: 50,
      payment_method: 'CASH',
      is_advance: true,
      book_type: 'KATCHI',
    };
    const asAccountant = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(accountantToken),
      payload,
    });
    expect(asAccountant.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ownerToken),
      payload,
    });
    expect(asOwner.statusCode).toBe(201);
  });

  it('OPERATOR cannot create a KATCHI lot; OWNER can', async () => {
    const payload = {
      owner_party_id: testParty,
      commodity_id: POTATO_ID,
      rate_plan_id: RATE_PLAN_SEASONAL,
      chamber_id: CHAMBER_A,
      quantity_bags: 5,
      accepted_weight_kg: 100,
      inbound_date: '2026-04-02',
      book_type: 'KATCHI',
    };
    const asOperator = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(operatorToken),
      payload,
    });
    expect(asOperator.statusCode).toBe(403);

    const asOwner = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(ownerToken),
      payload,
    });
    expect(asOwner.statusCode).toBe(201);
  });

  it('MANAGER cannot issue a KATCHI credit note', async () => {
    const { invoiceId } = await finalizedInvoice(testParty);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(managerToken),
      payload: creditNotePayload(invoiceId, 10, 'KATCHI'),
    });
    expect(res.statusCode).toBe(403);
  });

  // Below (phase/22, P2-10 / H5): the gate above only covered create. Every
  // later-stage mutation on an already-KATCHI record was ungated, so anyone
  // holding the route's ordinary permission — not just OWNER — could mutate
  // a KATCHI document. One representative later-stage route per controller,
  // not one per route (23 near-identical tests would just get deleted later).

  it('ACCOUNTANT cannot dishonour a KATCHI cheque payment', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/payments',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: testParty,
        payment_date: '2026-05-04',
        amount_pkr: 60,
        payment_method: 'CHEQUE',
        cheque_date: '2026-05-04',
        is_advance: true,
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const paymentId = JSON.parse(create.body).data.id as string;

    const asAccountant = await app.inject({
      method: 'POST',
      url: `/v1/payments/${paymentId}/dishonour`,
      headers: authHeaders(accountantToken),
      payload: {},
    });
    expect(asAccountant.statusCode).toBe(403);
  });

  it('OPERATOR cannot update a KATCHI lot', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/lots',
      headers: authHeaders(ownerToken),
      payload: {
        owner_party_id: testParty,
        commodity_id: POTATO_ID,
        rate_plan_id: RATE_PLAN_SEASONAL,
        chamber_id: CHAMBER_A,
        quantity_bags: 5,
        accepted_weight_kg: 100,
        inbound_date: '2026-04-03',
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const lotId = JSON.parse(create.body).data.id as string;

    const asOperator = await app.inject({
      method: 'PATCH',
      url: `/v1/lots/${lotId}`,
      headers: authHeaders(operatorToken),
      payload: { notes: 'attempted edit' },
    });
    expect(asOperator.statusCode).toBe(403);
  });

  it('ACCOUNTANT cannot update a KATCHI expense voucher', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/expense-vouchers',
      headers: authHeaders(ownerToken),
      payload: {
        voucher_date: '2026-05-05',
        expense_account_code: '6110',
        description: 'KATCHI gate test voucher',
        amount_pkr: 500,
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const voucherId = JSON.parse(create.body).data.id as string;

    const asAccountant = await app.inject({
      method: 'PATCH',
      url: `/v1/expense-vouchers/${voucherId}`,
      headers: authHeaders(accountantToken),
      payload: { description: 'attempted edit' },
    });
    expect(asAccountant.statusCode).toBe(403);
  });

  it('MANAGER cannot record a repayment on a KATCHI loan', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/loans/issue',
      headers: authHeaders(ownerToken),
      payload: {
        party_id: testParty,
        issue_date: '2026-05-06',
        principal_pkr: 1000,
        payment_method: 'CASH',
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const loanId = JSON.parse(create.body).data.id as string;

    const asManager = await app.inject({
      method: 'POST',
      url: `/v1/loans/${loanId}/repayments`,
      headers: authHeaders(managerToken),
      payload: {
        repayment_date: '2026-05-10',
        amount_pkr: 100,
        payment_method: 'CASH',
        asset_account_code: '1010',
      },
    });
    expect(asManager.statusCode).toBe(403);
  });

  it('MANAGER cannot finalize a KATCHI payroll run', async () => {
    const emp = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(managerToken),
      payload: {
        name: 'KATCHI Gate Test Employee',
        employee_type: 'SALARIED',
        designation: 'Clerk',
        join_date: '2026-01-01',
        basic_salary_pkr: 30000,
        eobi_registered: false,
      },
    });
    expect(emp.statusCode).toBe(201);

    const run = await app.inject({
      method: 'POST',
      url: '/v1/payroll-runs',
      headers: authHeaders(ownerToken),
      payload: {
        payroll_type: 'MONTHLY_SALARY',
        period_year: 2026,
        period_month: 5,
        period_from: '2026-05-01',
        period_to: '2026-05-31',
        book_type: 'KATCHI',
      },
    });
    expect(run.statusCode).toBe(201);
    const runId = JSON.parse(run.body).data.id as string;

    const asManager = await app.inject({
      method: 'POST',
      url: `/v1/payroll-runs/${runId}/finalize`,
      headers: authHeaders(managerToken),
      payload: {},
    });
    expect(asManager.statusCode).toBe(403);
  });

  // fixed_assets.manage defaults to OWNER but, like every non-alwaysOwner key,
  // is owner-grantable — this is the scenario that motivated widening H5 past
  // the original 15 routes: a facility owner CAN hand this to MANAGER, and
  // without the gate below that MANAGER could then commission a KATCHI asset
  // with no OWNER check anywhere in the path.
  it('MANAGER cannot commission a KATCHI asset even when granted fixed_assets.manage', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/fixed-assets',
      headers: authHeaders(ownerToken),
      payload: {
        asset_name: 'KATCHI Gate Test Asset',
        asset_category: 'OTHER',
        purchase_date: '2026-05-01',
        purchase_cost_pkr: 50000,
        depreciation_method: 'WDV',
        wdv_rate_percent: 10,
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const assetId = JSON.parse(create.body).data.id as string;

    const grant = await app.inject({
      method: 'PUT',
      url: '/v1/permissions',
      headers: authHeaders(ownerToken),
      payload: { overrides: { MANAGER: { grant: ['fixed_assets.manage'], revoke: [] } } },
    });
    expect(grant.statusCode).toBe(200);

    try {
      const asManager = await app.inject({
        method: 'POST',
        url: `/v1/fixed-assets/${assetId}/commission`,
        headers: authHeaders(managerToken),
        payload: { depreciation_start_date: '2026-05-01' },
      });
      expect(asManager.statusCode).toBe(403);
      // Distinguish the KATCHI gate from requirePermission's own 403 (which the
      // grant above already defeated) — otherwise this test would pass whether
      // or not the gate below it exists.
      expect(JSON.parse(asManager.body).error.message).toBe('Only OWNER can post KATCHI entries');
    } finally {
      await app.inject({ method: 'POST', url: '/v1/permissions/reset', headers: authHeaders(ownerToken) });
    }
  });

  // Same shape as fixed_assets.manage above: employee_advances.write_off also
  // defaults to OWNER without being locked there.
  it('MANAGER cannot write off a KATCHI employee advance even when granted employee_advances.write_off', async () => {
    const emp = await app.inject({
      method: 'POST',
      url: '/v1/employees',
      headers: authHeaders(managerToken),
      payload: {
        name: 'KATCHI Gate Test Employee 2',
        employee_type: 'SALARIED',
        designation: 'Clerk',
        join_date: '2026-01-01',
        basic_salary_pkr: 30000,
        eobi_registered: false,
      },
    });
    expect(emp.statusCode).toBe(201);
    const employeeId = JSON.parse(emp.body).data.id as string;

    const create = await app.inject({
      method: 'POST',
      url: '/v1/employee-advances/issue',
      headers: authHeaders(ownerToken),
      payload: {
        employee_id: employeeId,
        issue_date: '2026-05-01',
        principal_pkr: 5000,
        monthly_installment_pkr: 1000,
        payment_method: 'CASH',
        book_type: 'KATCHI',
      },
    });
    expect(create.statusCode).toBe(201);
    const advanceId = JSON.parse(create.body).data.id as string;

    const grant = await app.inject({
      method: 'PUT',
      url: '/v1/permissions',
      headers: authHeaders(ownerToken),
      payload: { overrides: { MANAGER: { grant: ['employee_advances.write_off'], revoke: [] } } },
    });
    expect(grant.statusCode).toBe(200);

    try {
      const asManager = await app.inject({
        method: 'POST',
        url: `/v1/employee-advances/${advanceId}/write-off`,
        headers: authHeaders(managerToken),
        payload: { reason: 'test write-off attempt' },
      });
      expect(asManager.statusCode).toBe(403);
      // Distinguish the KATCHI gate from requirePermission's own 403, same as
      // the fixed-assets case above.
      expect(JSON.parse(asManager.body).error.message).toBe('Only OWNER can post KATCHI entries');
    } finally {
      await app.inject({ method: 'POST', url: '/v1/permissions/reset', headers: authHeaders(ownerToken) });
    }
  });
});

describe('KATCHI reads default to PACCI and are MANAGER-gated (F-9)', () => {
  const KATCHI_MARKER = 'katchi-only-hardening-entry';
  let katchiJeId: string;

  beforeAll(async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(ownerToken),
      payload: {
        entry_date: '2026-03-19',
        description: KATCHI_MARKER,
        posting_status: 'POSTED',
        book_type: 'KATCHI',
        lines: [
          { account_code: '1010', debit_amount: 77, credit_amount: 0 },
          { account_code: '4050', debit_amount: 0, credit_amount: 77 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    katchiJeId = JSON.parse(res.body).data.id as string;
  });

  it('general ledger omits KATCHI by default and rejects KATCHI for ACCOUNTANT', async () => {
    const dflt = await app.inject({
      method: 'GET',
      url: '/v1/accounting/general-ledger?account_code=1010&date_from=2026-03-01&date_to=2026-03-31',
      headers: authHeaders(accountantToken),
    });
    expect(dflt.statusCode).toBe(200);
    expect(dflt.body).not.toContain(KATCHI_MARKER);

    const katchi = await app.inject({
      method: 'GET',
      url: '/v1/accounting/general-ledger?account_code=1010&date_from=2026-03-01&date_to=2026-03-31&book_type=KATCHI',
      headers: authHeaders(accountantToken),
    });
    expect(katchi.statusCode).toBe(403);

    const asManager = await app.inject({
      method: 'GET',
      url: '/v1/accounting/general-ledger?account_code=1010&date_from=2026-03-01&date_to=2026-03-31&book_type=KATCHI',
      headers: authHeaders(managerToken),
    });
    expect(asManager.statusCode).toBe(200);
    expect(asManager.body).toContain(KATCHI_MARKER);
  });

  it('journal-entry list omits KATCHI by default; detail is MANAGER-gated', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/accounting/journal-entries?page_size=100',
      headers: authHeaders(accountantToken),
    });
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain(KATCHI_MARKER);

    const listKatchi = await app.inject({
      method: 'GET',
      url: '/v1/accounting/journal-entries?book_type=KATCHI',
      headers: authHeaders(accountantToken),
    });
    expect(listKatchi.statusCode).toBe(403);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/accounting/journal-entries/${katchiJeId}`,
      headers: authHeaders(accountantToken),
    });
    expect(detail.statusCode).toBe(403);

    const detailManager = await app.inject({
      method: 'GET',
      url: `/v1/accounting/journal-entries/${katchiJeId}`,
      headers: authHeaders(managerToken),
    });
    expect(detailManager.statusCode).toBe(200);
  });

  it('trial balance, P&L and balance sheet reject KATCHI for ACCOUNTANT', async () => {
    for (const url of [
      '/v1/accounting/trial-balance?date_from=2026-03-01&date_to=2026-03-31&book_type=KATCHI',
      '/v1/accounting/profit-loss?date_from=2026-03-01&date_to=2026-03-31&book_type=KATCHI',
      '/v1/accounting/balance-sheet?as_of_date=2026-03-31&book_type=KATCHI',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: authHeaders(accountantToken) });
      expect(res.statusCode).toBe(403);
    }
  });
});

// ============================================================
// F-6a — chart-of-accounts parent validation
// ============================================================

describe('account creation validates the parent (F-6a)', () => {
  const base = {
    account_name: 'Parent Validation Test',
    account_class: 'EXPENSE',
    account_type: 'DETAIL',
    normal_balance: 'DEBIT',
  };

  it('rejects a nonexistent parent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: { ...base, account_code: '9902', parent_account_code: '8888' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a DETAIL account as parent', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: { ...base, account_code: '9902', parent_account_code: '6010' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('rejects a parent from a different account class', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: { ...base, account_code: '9902', parent_account_code: '4000' },
    });
    expect(res.statusCode).toBe(422);
  });

  it('accepts a HEADER parent of the same class', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: { ...base, account_code: '9902', parent_account_code: '6000' },
    });
    expect(res.statusCode).toBe(201);
  });

  it('rejects a parentless DETAIL account outside equity — it could never reach the statements', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: { ...base, account_code: '9905' },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_PARENT_ACCOUNT');
  });

  it('rejects a HEADER given a parent — buildGroups is one level deep, a nested header would orphan its own children (phase/24)', async () => {
    // 9902 is already claimed by 'accepts a HEADER parent of the same class'
    // above — use an unused code so this asserts the nested-header rejection,
    // not an incidental duplicate-code collision.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '9906',
        account_name: 'Nested Header (rejected)',
        account_class: 'EXPENSE',
        account_type: 'HEADER',
        parent_account_code: '6000',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('INVALID_PARENT_ACCOUNT');
  });

  it('accepts a parentless EQUITY DETAIL account — equity sits at the root by design', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '3910',
        account_name: 'Owner Drawings (custom)',
        account_class: 'EQUITY',
        account_type: 'DETAIL',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ============================================================
// F-6b — statements surface unclassified accounts
// ============================================================

describe('statements surface activity in unclassified accounts (F-6b)', () => {
  it('P&L includes custom-header expense activity instead of silently dropping it', async () => {
    const header = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7000',
        account_name: 'Financing Costs (custom)',
        account_class: 'EXPENSE',
        account_type: 'HEADER',
        normal_balance: 'DEBIT',
      },
    });
    expect(header.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7010',
        account_name: 'Interest Expense (custom)',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        parent_account_code: '7000',
        normal_balance: 'DEBIT',
      },
    });
    expect(detail.statusCode).toBe(201);

    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-02-10',
        description: 'unclassified expense test',
        posting_status: 'POSTED',
        lines: [
          { account_code: '7010', debit_amount: 500, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 500 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/profit-loss?date_from=2026-02-01&date_to=2026-02-28',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const pl = JSON.parse(res.body).data;

    expect(pl.has_unclassified).toBe(true);
    const stray = (pl.unclassified_lines as { account_code: string; amount_pkr: number }[]).find(
      (l) => l.account_code === '7010',
    );
    expect(stray).toBeTruthy();
    // Signed as contribution to net profit: an expense reduces it.
    expect(stray!.amount_pkr).toBe(-500);
    expect(pl.net_profit_pkr).toBe(-500);

    // phase/24: the unclassified expense must fold into operating_profit_pkr
    // and ebitda_pkr too, not just net_profit_pkr. Pre-fix, this window had no
    // header-placed activity, so operating_profit_pkr and ebitda_pkr would
    // both have been 0 — correct-looking net_profit_pkr, wrong everything
    // above it, and no test caught it because none asserted these two fields
    // in the presence of unclassified activity.
    expect(pl.operating_profit_pkr).toBe(-500);
    expect(pl.ebitda_pkr).toBe(-500);
    expect(pl.total_operating_expense_pkr).toBe(500);
    // The chain of identities must hold exactly, not just net_profit_pkr in isolation.
    expect(pl.net_profit_pkr).toBeCloseTo(pl.operating_profit_pkr + pl.total_other_income_pkr);
  });

  it('Balance sheet includes custom-header asset balances and still balances', async () => {
    const header = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '9903',
        account_name: 'Custom Asset Header',
        account_class: 'ASSET',
        account_type: 'HEADER',
        normal_balance: 'DEBIT',
      },
    });
    expect(header.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '9904',
        account_name: 'Custom Asset (stray)',
        account_class: 'ASSET',
        account_type: 'DETAIL',
        parent_account_code: '9903',
        normal_balance: 'DEBIT',
      },
    });
    expect(detail.statusCode).toBe(201);

    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-02-11',
        description: 'unclassified asset test',
        posting_status: 'POSTED',
        lines: [
          { account_code: '9904', debit_amount: 300, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 300 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/balance-sheet?as_of_date=2026-02-28',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const bs = JSON.parse(res.body).data;

    expect(bs.has_unclassified).toBe(true);
    const stray = (bs.unclassified_asset_lines as { account_code: string; amount_pkr: number }[]).find(
      (l) => l.account_code === '9904',
    );
    expect(stray).toBeTruthy();
    expect(stray!.amount_pkr).toBe(300);
    expect(bs.is_balanced).toBe(true);
  });

  // phase/24: the two expense-side tests above never exercised the REVENUE
  // branch of the fold — a separate code path (credit-normal, added straight
  // to total_operating_revenue_pkr rather than subtracted as a magnitude).
  it('P&L includes custom-header revenue activity, folded into net_revenue and every subtotal above it', async () => {
    const header = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7020',
        account_name: 'Ancillary Revenue (custom)',
        account_class: 'REVENUE',
        account_type: 'HEADER',
        normal_balance: 'CREDIT',
      },
    });
    expect(header.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7030',
        account_name: 'Weighbridge Fee Income (custom)',
        account_class: 'REVENUE',
        account_type: 'DETAIL',
        parent_account_code: '7020',
        normal_balance: 'CREDIT',
      },
    });
    expect(detail.statusCode).toBe(201);

    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-02-12',
        description: 'unclassified revenue test',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 800, credit_amount: 0 },
          { account_code: '7030', debit_amount: 0, credit_amount: 800 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/profit-loss?date_from=2026-02-12&date_to=2026-02-12',
      headers: authHeaders(accountantToken),
    });
    expect(res.statusCode).toBe(200);
    const pl = JSON.parse(res.body).data;

    expect(pl.has_unclassified).toBe(true);
    const stray = (pl.unclassified_lines as { account_code: string; amount_pkr: number }[]).find(
      (l) => l.account_code === '7030',
    );
    expect(stray).toBeTruthy();
    expect(stray!.amount_pkr).toBe(800); // credit-normal revenue: positive contribution

    // Every subtotal from net_revenue upward must include it — not just net_profit.
    expect(pl.total_operating_revenue_pkr).toBe(800);
    expect(pl.net_revenue_pkr).toBe(800);
    expect(pl.gross_profit_pkr).toBe(800);
    expect(pl.operating_profit_pkr).toBe(800);
    expect(pl.ebitda_pkr).toBe(800);
    expect(pl.net_profit_pkr).toBe(800);
  });
});

// ============================================================
// Phase 19 audit — CoA guardrails
// ============================================================

describe('account codes must not collide with another class range (phase/19)', () => {
  it('rejects an EXPENSE account numbered in the asset range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '1999',
        account_name: 'Miscoded Expense',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        parent_account_code: '6000',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an ASSET account numbered in the revenue range', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '4995',
        account_name: 'Miscoded Asset',
        account_class: 'ASSET',
        account_type: 'DETAIL',
        parent_account_code: '1200',
        normal_balance: 'DEBIT',
      },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('VALIDATION_ERROR');
  });
});

describe('deactivation requires a zero ledger balance (phase/19)', () => {
  it('blocks deactivating an account holding a balance; allows it once zeroed', async () => {
    const header = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7900',
        account_name: 'Deactivation Test Header',
        account_class: 'EXPENSE',
        account_type: 'HEADER',
        normal_balance: 'DEBIT',
      },
    });
    expect(header.statusCode).toBe(201);
    const detail = await app.inject({
      method: 'POST',
      url: '/v1/accounting/accounts',
      headers: authHeaders(ownerToken),
      payload: {
        account_code: '7910',
        account_name: 'Deactivation Test Detail',
        account_class: 'EXPENSE',
        account_type: 'DETAIL',
        parent_account_code: '7900',
        normal_balance: 'DEBIT',
      },
    });
    expect(detail.statusCode).toBe(201);

    const je = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-02-12',
        description: 'deactivation balance test',
        posting_status: 'POSTED',
        lines: [
          { account_code: '7910', debit_amount: 120, credit_amount: 0 },
          { account_code: '1010', debit_amount: 0, credit_amount: 120 },
        ],
      },
    });
    expect(je.statusCode).toBe(201);

    const blocked = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/7910',
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });
    expect(blocked.statusCode).toBe(409);
    expect(JSON.parse(blocked.body).error.code).toBe('ACCOUNT_HAS_BALANCE');

    const offset = await app.inject({
      method: 'POST',
      url: '/v1/accounting/journal-entries',
      headers: authHeaders(managerToken),
      payload: {
        entry_date: '2026-02-13',
        description: 'deactivation balance offset',
        posting_status: 'POSTED',
        lines: [
          { account_code: '1010', debit_amount: 120, credit_amount: 0 },
          { account_code: '7910', debit_amount: 0, credit_amount: 120 },
        ],
      },
    });
    expect(offset.statusCode).toBe(201);

    const allowed = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/7910',
      headers: authHeaders(ownerToken),
      payload: { is_active: false },
    });
    expect(allowed.statusCode).toBe(200);
    expect(JSON.parse(allowed.body).data.is_active).toBe(false);
  });
});

describe('system accounts cannot be renamed (phase/19)', () => {
  it('rejects renaming 1010 Cash on Hand', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/1010',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Petty Cash' },
    });
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('SYSTEM_ACCOUNT_PROTECTED');
  });

  it('still allows renaming a non-system account', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6030',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Maintenance & Repairs (renamed)' },
    });
    expect(res.statusCode).toBe(200);
    await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/6030',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Maintenance & Repairs' },
    });
  });
});

// ============================================================
// F-5 — credit notes bounded by balance due
// ============================================================

describe('credit notes are bounded by the invoice balance due (F-5)', () => {
  it('rejects a credit note on a fully paid invoice', async () => {
    const { invoiceId, totalPkr } = await finalizedInvoice(testParty);
    await payInvoice(testParty, invoiceId, totalPkr);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(managerToken),
      payload: creditNotePayload(invoiceId, 100),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('CREDIT_NOTE_EXCEEDS_INVOICE');
  });

  it('rejects a credit note exceeding the remaining balance on a partially paid invoice', async () => {
    const { invoiceId, totalPkr } = await finalizedInvoice(testParty);
    const paid = Math.round(totalPkr * 0.6);
    await payInvoice(testParty, invoiceId, paid);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(managerToken),
      payload: creditNotePayload(invoiceId, totalPkr - paid + 50),
    });
    expect(res.statusCode).toBe(422);
    expect(JSON.parse(res.body).error.code).toBe('CREDIT_NOTE_EXCEEDS_INVOICE');
  });

  it('still allows a credit note within the balance due', async () => {
    const { invoiceId, totalPkr } = await finalizedInvoice(testParty);
    const paid = Math.round(totalPkr * 0.6);
    await payInvoice(testParty, invoiceId, paid);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/credit-notes',
      headers: authHeaders(managerToken),
      payload: creditNotePayload(invoiceId, totalPkr - paid),
    });
    expect(res.statusCode).toBe(201);
    expect(JSON.parse(res.body).data.status).toBe('APPLIED');
  });
});

// ============================================================
// P2-2 — every JE's sourceId resolves to a live row (invariant 17)
// ============================================================

describe('every JE sourceId resolves to a live row in its sourceTable (invariant 17)', () => {
  // Document-backed sourceTable values are the real table name, matching
  // Prisma's own @@map for each model — checked against schema.prisma, not
  // assumed. Two values have no backing document at all, by design, so
  // sourceId means something else there: 'manual' (accounting.controller.ts's
  // manual-JE handler, and now JE-17C petty-cash-replenish — P2-2) stamps the
  // acting user's id; 'opening_balances' (opening-balance.service.ts) stamps
  // the facility's own id. Both predate this test.
  const resolvableTables: Record<string, (id: string) => Promise<boolean>> = {
    manual: async (id) => (await prisma.user.count({ where: { id } })) > 0,
    opening_balances: async (id) => (await prisma.facility.count({ where: { id } })) > 0,
    expense_vouchers: async (id) => (await prisma.expenseVoucher.count({ where: { id } })) > 0,
    party_loans: async (id) => (await prisma.partyLoan.count({ where: { id } })) > 0,
    party_loan_repayments: async (id) => (await prisma.partyLoanRepayment.count({ where: { id } })) > 0,
    employee_advances: async (id) => (await prisma.employeeAdvance.count({ where: { id } })) > 0,
    invoices: async (id) => (await prisma.invoice.count({ where: { id } })) > 0,
    fixed_assets: async (id) => (await prisma.fixedAsset.count({ where: { id } })) > 0,
    payroll_runs: async (id) => (await prisma.payrollRun.count({ where: { id } })) > 0,
    payments: async (id) => (await prisma.payment.count({ where: { id } })) > 0,
    journal_entries: async (id) => (await prisma.journalEntry.count({ where: { id } })) > 0,
    credit_notes: async (id) => (await prisma.creditNote.count({ where: { id } })) > 0,
  };

  // P3-3 (docs/20_audit_backlog.md): je-21-late-payment-surcharge.ts and its
  // callers stamp sourceTable 'invoice_surcharge', but no invoice_surcharges
  // table exists in schema.prisma on this branch — confirmed absent, not
  // assumed. There is nothing to resolve against. Named here as a known gap
  // rather than silently excluded or left to throw on a missing table/model.
  const knownGapTables = new Set(['invoice_surcharge']);

  // Self-verifying (the point of this test over just checking today's known
  // values): a sourceTable this facility's journal_entries actually carries
  // but that isn't in either bucket above fails loudly, so a template added
  // in a future phase can't silently go unchecked the way JE-17C did.
  it('every sourceTable value present is either resolvable or a documented gap', async () => {
    const distinct = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID },
      select: { sourceTable: true },
      distinct: ['sourceTable'],
    });
    for (const { sourceTable } of distinct) {
      const known = sourceTable in resolvableTables || knownGapTables.has(sourceTable);
      expect(known, `unmapped sourceTable "${sourceTable}" — add it to the invariant-17 resolver map`).toBe(true);
    }
  });

  it('every resolvable-table sourceId points at a row that actually exists', async () => {
    const entries = await prisma.journalEntry.findMany({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: { in: Object.keys(resolvableTables) } },
      select: { entryNumber: true, sourceTable: true, sourceId: true },
    });
    const dangling: string[] = [];
    for (const e of entries) {
      const exists = await resolvableTables[e.sourceTable]!(e.sourceId);
      if (!exists) dangling.push(`${e.entryNumber} -> ${e.sourceTable}:${e.sourceId}`);
    }
    expect(dangling).toEqual([]);
  });
});
