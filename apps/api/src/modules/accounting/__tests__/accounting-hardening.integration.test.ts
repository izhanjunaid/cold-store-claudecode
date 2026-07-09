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
      where: { facilityId: TEST_FACILITY_ID, accountCode: { in: ['7000', '7010', '9902', '9903', '9904', '9905', '3910'] } },
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
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/accounting/accounts/4050',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Storage Revenue — Other (attributed)' },
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
      url: '/v1/accounting/accounts/4050',
      headers: authHeaders(ownerToken),
      payload: { account_name: 'Storage Revenue — Other' },
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
