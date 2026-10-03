/**
 * docs/25 Q3 — full accounts payable (C-01, C-02, C-09, C-12).
 *
 * A bill is a header with expense lines (+ optional input tax) that posts at its own
 * date: DR each line (+ DR 1260) / CR the supplier's control account with the party.
 * A supplier payment settles the account gross, pays the supplier net, and owes the
 * withholding to the FBR (section, rate and certificate stored on the payment); it is
 * allocated to bills, and a bill's payment state is derived from those allocations.
 * Both void through reverseInTransaction.
 *
 * The invariant: the payables control account per supplier equals the open bills,
 * less unapplied payments, plus any line no bill or payment posted (opening, manual).
 *
 * Everything is dated 2038 with suppliers this file creates, cleaned up by id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;

const partyIds: string[] = [];
const manualEntryIds: string[] = [];

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
}, 30_000);

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const bills = await prisma.bill.findMany({ where: { supplierPartyId: { in: partyIds } }, select: { id: true } });
    const payments = await prisma.supplierPayment.findMany({
      where: { supplierPartyId: { in: partyIds } },
      select: { id: true },
    });
    const billIds = bills.map((b) => b.id);
    const paymentIds = payments.map((p) => p.id);
    const scope = {
      facilityId: TEST_FACILITY_ID,
      OR: [
        { sourceTable: 'bills', sourceId: { in: billIds } },
        { sourceTable: 'supplier_payments', sourceId: { in: paymentIds } },
        { id: { in: manualEntryIds } },
      ],
    };
    await prisma.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: { in: paymentIds } } });
    await prisma.supplierPayment.updateMany({ where: { id: { in: paymentIds } }, data: { journalEntryId: null } });
    await prisma.supplierPayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.bill.updateMany({ where: { id: { in: billIds } }, data: { journalEntryId: null } });
    await prisma.billLine.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.bill.deleteMany({ where: { id: { in: billIds } } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
    await prisma.party.deleteMany({ where: { id: { in: partyIds } } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });

const dataOf = (res: { body: string }) => JSON.parse(res.body).data;
const errorOf = (res: { body: string }) => JSON.parse(res.body).error as { code: string; message: string };

let phoneSeq = 0;
async function party(name: string, type: 'SUPPLIER' | 'FARMER' = 'SUPPLIER') {
  const res = await call('POST', '/v1/parties', ownerToken, {
    name: `${name} ${Date.now()}`,
    party_type: type,
    phone_primary: `0390${String(Date.now()).slice(-5)}${phoneSeq++}`,
  });
  expect(res.statusCode, res.body).toBe(201);
  const id = dataOf(res).id as string;
  partyIds.push(id);
  return id;
}

type Line = { expense_account_code: string; description: string; amount_pkr: number };
const LINES: Line[] = [
  { expense_account_code: '5010', description: 'Refrigeration power', amount_pkr: 10000 },
  { expense_account_code: '6030', description: 'Compressor service', amount_pkr: 2000 },
];

async function draftBill(supplierId: string, over: Record<string, unknown> = {}) {
  const res = await call('POST', '/v1/bills', accountantToken, {
    supplier_party_id: supplierId,
    bill_date: '2038-02-10',
    due_date: '2038-03-12',
    supplier_reference: 'INV-778',
    description: 'February service bill',
    lines: LINES,
    input_tax_pkr: 0,
    ...over,
  });
  return res;
}

async function postedBill(supplierId: string, over: Record<string, unknown> = {}) {
  const draft = await draftBill(supplierId, over);
  expect(draft.statusCode, draft.body).toBe(201);
  const posted = await call('POST', `/v1/bills/${dataOf(draft).id}/post`, managerToken, {});
  expect(posted.statusCode, posted.body).toBe(200);
  return dataOf(posted);
}

const pay = (payload: Record<string, unknown>, token = accountantToken) =>
  call('POST', '/v1/supplier-payments', token, { payment_date: '2038-02-20', payment_method: 'BANK_TRANSFER', ...payload });

async function controlBalance(partyId: string) {
  const lines = await prisma.journalEntryLine.findMany({
    where: { facilityId: TEST_FACILITY_ID, accountCode: '2050', partyId, journalEntry: { postingStatus: 'POSTED', bookType: 'PACCI' } },
  });
  return Math.round(lines.reduce((s, l) => s + Number(l.creditAmount) - Number(l.debitAmount), 0) * 100) / 100;
}

describe('C-01 / C-02 — a bill posts at its own date to the supplier’s account', () => {
  it('a draft has no number and posts nothing; posting numbers it and books DR lines + input tax / CR 2050 with the party', async () => {
    const supplier = await party('AP Supplier A');
    const draft = await draftBill(supplier, { input_tax_pkr: 1800 });
    expect(draft.statusCode, draft.body).toBe(201);
    const d = dataOf(draft);
    expect(d).toMatchObject({ status: 'DRAFT', bill_number: null, subtotal_pkr: 12000, input_tax_pkr: 1800, total_pkr: 13800 });
    expect(d.allowed_actions).toEqual(expect.arrayContaining(['edit', 'delete', 'post']));
    expect(await prisma.journalEntry.count({ where: { sourceTable: 'bills', sourceId: d.id } })).toBe(0);

    const posted = await call('POST', `/v1/bills/${d.id}/post`, managerToken, {});
    expect(posted.statusCode, posted.body).toBe(200);
    const bill = dataOf(posted);
    expect(bill.status).toBe('POSTED');
    expect(bill.bill_number).toMatch(/^BILL-203802-\d{4}$/);
    expect(bill).toMatchObject({ payment_status: 'UNPAID', paid_pkr: 0, open_pkr: 13800 });
    expect(bill.allowed_actions).toEqual(expect.arrayContaining(['pay', 'void']));

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: bill.journal_entry_id },
      include: { lines: true },
    });
    expect(entry).toMatchObject({ entryType: 'BILL', sourceTable: 'bills', sourceId: bill.id });
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2038-02-10');
    const byAccount = Object.fromEntries(entry.lines.map((l) => [l.accountCode, l]));
    expect(Number(byAccount['5010']!.debitAmount)).toBe(10000);
    expect(Number(byAccount['6030']!.debitAmount)).toBe(2000);
    expect(Number(byAccount['1260']!.debitAmount)).toBe(1800);
    expect(Number(byAccount['2050']!.creditAmount)).toBe(13800);
    expect(byAccount['2050']!.partyId).toBe(supplier);
  });

  it('refuses a line on an account a person may not book a cost to', async () => {
    const supplier = await party('AP Supplier Bad Line');
    for (const code of ['6010', '6000', '1010']) {
      const res = await draftBill(supplier, { lines: [{ expense_account_code: code, description: 'x', amount_pkr: 10 }] });
      expect(res.statusCode, code).toBe(400);
      expect(errorOf(res).message).toContain(code);
    }
  });

  it('refuses a customer as the supplier', async () => {
    const farmer = await party('AP Not A Supplier', 'FARMER');
    const res = await draftBill(farmer);
    expect(res.statusCode).toBe(400);
  });

  it('refuses input tax on the informal book', async () => {
    const supplier = await party('AP Katchi');
    const res = await call('POST', '/v1/bills', ownerToken, {
      supplier_party_id: supplier,
      bill_date: '2038-02-10',
      description: 'katchi bill',
      lines: LINES,
      input_tax_pkr: 500,
      book_type: 'KATCHI',
    });
    expect(res.statusCode).toBe(400);
  });

  it('a draft is edited and discarded; a posted bill is neither', async () => {
    const supplier = await party('AP Draft Edit');
    const d = dataOf(await draftBill(supplier));
    const edited = await call('PATCH', `/v1/bills/${d.id}`, accountantToken, {
      supplier_party_id: supplier,
      bill_date: '2038-02-11',
      description: 'edited',
      lines: [{ expense_account_code: '6150', description: 'spoilage claim', amount_pkr: 750 }],
      input_tax_pkr: 0,
    });
    expect(edited.statusCode, edited.body).toBe(200);
    expect(dataOf(edited)).toMatchObject({ total_pkr: 750, bill_date: '2038-02-11' });
    expect((await call('DELETE', `/v1/bills/${d.id}`, accountantToken)).statusCode).toBe(200);
    expect((await call('GET', `/v1/bills/${d.id}`, accountantToken)).statusCode).toBe(404);

    const posted = await postedBill(supplier);
    expect((await call('DELETE', `/v1/bills/${posted.id}`, accountantToken)).statusCode).toBe(409);
  });
});

describe('C-09 / C-12 — a supplier payment carries its withholding and pays from cash', () => {
  it('DR 2050 gross / CR bank net / CR 2071 tax, with section, rate and certificate stored; allocated, the bill is PAID', async () => {
    const supplier = await party('AP Supplier WHT');
    const bill = await postedBill(supplier);
    const res = await pay({
      supplier_party_id: supplier,
      asset_account_code: '1020',
      gross_amount_pkr: 12000,
      withholding_section: 'S153',
      withholding_rate_pct: 4,
      certificate_number: 'WHT-0091',
      allocations: [{ bill_id: bill.id, amount_pkr: 12000 }],
    });
    expect(res.statusCode, res.body).toBe(201);
    const p = dataOf(res);
    expect(p.payment_number).toMatch(/^SPY-203802-\d{4}$/);
    expect(p).toMatchObject({
      gross_amount_pkr: 12000,
      withholding_section: 'S153',
      withholding_rate_pct: 4,
      withholding_pkr: 480,
      net_paid_pkr: 11520,
      certificate_number: 'WHT-0091',
      unapplied_pkr: 0,
    });

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: p.journal_entry_id }, include: { lines: true } });
    expect(entry).toMatchObject({ entryType: 'SUPPLIER_PAYMENT', sourceTable: 'supplier_payments', sourceId: p.id });
    const byAccount = Object.fromEntries(entry.lines.map((l) => [l.accountCode, l]));
    expect(Number(byAccount['2050']!.debitAmount)).toBe(12000);
    expect(byAccount['2050']!.partyId).toBe(supplier);
    expect(Number(byAccount['1020']!.creditAmount)).toBe(11520);
    expect(Number(byAccount['2071']!.creditAmount)).toBe(480);

    const after = dataOf(await call('GET', `/v1/bills/${bill.id}`, accountantToken));
    expect(after).toMatchObject({ payment_status: 'PAID', paid_pkr: 12000, open_pkr: 0 });
    expect(after.allowed_actions).not.toContain('void');
    expect(await controlBalance(supplier)).toBe(0);
  });

  it('rent withholding lands in 2072', async () => {
    const supplier = await party('AP Landlord');
    const res = await pay({ supplier_party_id: supplier, gross_amount_pkr: 50000, withholding_section: 'S155', withholding_rate_pct: 10 });
    expect(res.statusCode, res.body).toBe(201);
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: dataOf(res).journal_entry_id }, include: { lines: true } });
    expect(entry.lines.find((l) => l.accountCode === '2072')).toBeTruthy();
  });

  it('the paid-from account defaults from the method and must be a cash equivalent', async () => {
    const supplier = await party('AP Cash Supplier');
    const cash = await pay({ supplier_party_id: supplier, payment_method: 'CASH', gross_amount_pkr: 300 });
    expect(cash.statusCode, cash.body).toBe(201);
    expect(dataOf(cash).asset_account_code).toBe('1010');

    const bad = await pay({ supplier_party_id: supplier, payment_method: 'CHEQUE', asset_account_code: '1025', gross_amount_pkr: 300 });
    expect(bad.statusCode).toBe(422);
    expect(errorOf(bad).code).toBe('NOT_A_CASH_ACCOUNT');
  });

  it('refuses over-allocation, another supplier’s bill, and a bill in the other book', async () => {
    const supplier = await party('AP Alloc');
    const other = await party('AP Alloc Other');
    const bill = await postedBill(supplier);
    const otherBill = await postedBill(other);

    const over = await pay({ supplier_party_id: supplier, gross_amount_pkr: 20000, allocations: [{ bill_id: bill.id, amount_pkr: 12001 }] });
    expect(over.statusCode).toBe(422);
    const beyondGross = await pay({ supplier_party_id: supplier, gross_amount_pkr: 100, allocations: [{ bill_id: bill.id, amount_pkr: 200 }] });
    expect(beyondGross.statusCode).toBe(422);
    const wrongSupplier = await pay({ supplier_party_id: supplier, gross_amount_pkr: 100, allocations: [{ bill_id: otherBill.id, amount_pkr: 100 }] });
    expect(wrongSupplier.statusCode).toBe(422);
    const wrongBook = await pay(
      { supplier_party_id: supplier, gross_amount_pkr: 100, book_type: 'KATCHI', allocations: [{ bill_id: bill.id, amount_pkr: 100 }] },
      ownerToken,
    );
    expect(wrongBook.statusCode).toBe(422);
  });

  it('two concurrent payments that together over-pay a bill: the loser is refused', async () => {
    const supplier = await party('AP Race');
    const bill = await postedBill(supplier);
    const one = () => pay({ supplier_party_id: supplier, gross_amount_pkr: 8000, allocations: [{ bill_id: bill.id, amount_pkr: 8000 }] });
    const [a, b] = await Promise.all([one(), one()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 422]);
    const loser = [a, b].find((r) => r.statusCode === 422)!;
    expect(errorOf(loser).code).toBe('BILL_OVER_ALLOCATED');
    expect(dataOf(await call('GET', `/v1/bills/${bill.id}`, accountantToken))).toMatchObject({ paid_pkr: 8000, open_pkr: 4000 });
  });

  it('an unapplied payment is allocated later', async () => {
    const supplier = await party('AP Advance');
    const advance = dataOf(await pay({ supplier_party_id: supplier, gross_amount_pkr: 5000 }));
    expect(advance.unapplied_pkr).toBe(5000);
    expect(advance.allowed_actions).toEqual(expect.arrayContaining(['allocate', 'void']));
    const bill = await postedBill(supplier);
    const res = await call('POST', `/v1/supplier-payments/${advance.id}/allocate`, accountantToken, {
      allocations: [{ bill_id: bill.id, amount_pkr: 5000 }],
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(dataOf(res).unapplied_pkr).toBe(0);
    expect(dataOf(await call('GET', `/v1/bills/${bill.id}`, accountantToken))).toMatchObject({ payment_status: 'PARTIAL', open_pkr: 7000 });
  });
});

describe('pay now — a bill and its payment in one action', () => {
  it('posts the bill and pays it in full', async () => {
    const supplier = await party('AP Pay Now');
    const draft = dataOf(await draftBill(supplier));
    const res = await call('POST', `/v1/bills/${draft.id}/post`, managerToken, {
      pay_now: { payment_date: '2038-02-10', payment_method: 'CASH' },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(dataOf(res)).toMatchObject({ status: 'POSTED', payment_status: 'PAID', open_pkr: 0 });
    expect(await controlBalance(supplier)).toBe(0);
  });
});

describe('void — through the reversal path, never behind the document’s back', () => {
  it('a paid bill cannot be voided; voiding the payment frees it; then the bill voids', async () => {
    const supplier = await party('AP Void');
    const bill = await postedBill(supplier);
    const p = dataOf(await pay({ supplier_party_id: supplier, gross_amount_pkr: 12000, allocations: [{ bill_id: bill.id, amount_pkr: 12000 }] }));

    const blocked = await call('POST', `/v1/bills/${bill.id}/void`, managerToken, { reason: 'wrong supplier' });
    expect(blocked.statusCode).toBe(409);

    const vp = await call('POST', `/v1/supplier-payments/${p.id}/void`, managerToken, { reason: 'paid twice', void_date: '2038-02-21' });
    expect(vp.statusCode, vp.body).toBe(200);
    expect(dataOf(vp)).toMatchObject({ void_reason: 'paid twice', allowed_actions: [] });
    expect(dataOf(vp).voided_at).not.toBeNull();
    const allocations = await prisma.supplierPaymentAllocation.findMany({ where: { supplierPaymentId: p.id } });
    expect(allocations.every((a) => a.voidedAt !== null)).toBe(true);
    expect(dataOf(await call('GET', `/v1/bills/${bill.id}`, accountantToken))).toMatchObject({ payment_status: 'UNPAID', open_pkr: 12000 });

    const vb = await call('POST', `/v1/bills/${bill.id}/void`, managerToken, { reason: 'wrong supplier', void_date: '2038-02-21' });
    expect(vb.statusCode, vb.body).toBe(200);
    expect(dataOf(vb).status).toBe('VOID');
    expect(await controlBalance(supplier)).toBe(0);

    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: bill.journal_entry_id } });
    expect(original.reversedById).not.toBeNull();
    const mirror = await prisma.journalEntry.findUniqueOrThrow({ where: { id: original.reversedById! } });
    expect(mirror).toMatchObject({ entryType: 'REVERSAL', sourceTable: 'bills', sourceId: bill.id });
  });
});

describe('payables read model — aging and statement tie to the ledger', () => {
  it('2050 per supplier = open bills − unapplied payments + other lines; the aging and statement agree', async () => {
    const supplier = await party('AP Invariant');
    const b1 = await postedBill(supplier);
    await postedBill(supplier, { bill_date: '2038-01-05', due_date: '2038-01-05' });
    await pay({ supplier_party_id: supplier, gross_amount_pkr: 4000, allocations: [{ bill_id: b1.id, amount_pkr: 3000 }] });

    // A line no bill or payment posted: a manual correction on the supplier's account.
    const manual = await call('POST', '/v1/accounting/journal-entries', ownerToken, {
      entry_date: '2038-02-25',
      description: 'AP invariant: manual supplier credit',
      lines: [
        { account_code: '6100', debit_amount: 250, credit_amount: 0 },
        { account_code: '2050', debit_amount: 0, credit_amount: 250, party_id: supplier },
      ],
    });
    expect(manual.statusCode, manual.body).toBe(201);
    manualEntryIds.push(dataOf(manual).id);

    const gl = await controlBalance(supplier);
    // 12000 + 12000 bills − 4000 paid + 250 manual
    expect(gl).toBe(20250);

    const aging = await call('GET', '/v1/payables/aging', accountantToken);
    expect(aging.statusCode, aging.body).toBe(200);
    const body = dataOf(aging);
    const row = body.suppliers.find((s: { party_id: string }) => s.party_id === supplier);
    expect(row).toMatchObject({ open_bills_pkr: 21000, unapplied_payments_pkr: 1000, other_pkr: 250, balance_pkr: 20250, gl_balance_pkr: 20250 });
    expect(body.tie_out.is_reconciled).toBe(true);

    const statement = await call('GET', `/v1/payables/suppliers/${supplier}/statement?date_from=2038-01-01&date_to=2038-12-31`, accountantToken);
    expect(statement.statusCode, statement.body).toBe(200);
    const st = dataOf(statement);
    expect(st.closing_balance_pkr).toBe(20250);
    expect(st.lines.at(-1).running_balance_pkr).toBe(20250);
    expect(st.open_bills.map((b: { id: string }) => b.id)).toContain(b1.id);
  });
});
