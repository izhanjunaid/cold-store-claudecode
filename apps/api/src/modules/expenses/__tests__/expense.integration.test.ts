/**
 * docs/25 C-03 / C-08 / C-04 — the three expense paths are retired.
 *
 * Direct-paid vouchers (JE-17A), accrue-then-pay (JE-17B) and petty-cash replenishment
 * (JE-17C, a duplicate of the cash transfer) gave three ways to book one cost, none of
 * them correctable once posted. Costs are now supplier bills. Existing vouchers stay
 * readable; a DRAFT or APPROVED one can only be cancelled, and an ACCRUED one — a
 * liability already sitting in 2040 — is converted to a bill: the bill takes the
 * voucher's cost line, a posted entry moves the liability 2040 → the supplier's 2050,
 * and the voucher becomes CONVERTED.
 *
 * Legacy vouchers are seeded as an older image left them; dated 2040, cleaned by id.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';
import { JournalEntryService } from '../../accounting/journal-entry.service';
import { PeriodLockService } from '../../accounting/period-lock.service';

const prisma = new PrismaClient();
const journal = new JournalEntryService(prisma, new PeriodLockService(prisma));

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
let accountantToken: string;
let ownerId: string;

const voucherIds: string[] = [];
const partyIds: string[] = [];

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  ownerId = (await prisma.user.findFirstOrThrow({ where: { email: 'admin@coldchain.pk' } })).id;
}, 30_000);

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const bills = await prisma.bill.findMany({
      where: { OR: [{ legacyExpenseVoucherId: { in: voucherIds } }, { supplierPartyId: { in: partyIds } }] },
      select: { id: true },
    });
    const payments = await prisma.supplierPayment.findMany({ where: { supplierPartyId: { in: partyIds } }, select: { id: true } });
    const billIds = bills.map((b) => b.id);
    const paymentIds = payments.map((p) => p.id);
    const scope = {
      facilityId: TEST_FACILITY_ID,
      OR: [
        { sourceTable: 'expense_vouchers', sourceId: { in: voucherIds } },
        { sourceTable: 'bills', sourceId: { in: billIds } },
        { sourceTable: 'supplier_payments', sourceId: { in: paymentIds } },
      ],
    };
    await prisma.supplierPaymentAllocation.deleteMany({ where: { supplierPaymentId: { in: paymentIds } } });
    await prisma.supplierPayment.updateMany({ where: { id: { in: paymentIds } }, data: { journalEntryId: null } });
    await prisma.supplierPayment.deleteMany({ where: { id: { in: paymentIds } } });
    await prisma.bill.updateMany({ where: { id: { in: billIds } }, data: { journalEntryId: null } });
    await prisma.billLine.deleteMany({ where: { billId: { in: billIds } } });
    await prisma.bill.deleteMany({ where: { id: { in: billIds } } });
    await prisma.expenseVoucher.updateMany({
      where: { id: { in: voucherIds } },
      data: { accrualJournalEntryId: null, paymentJournalEntryId: null },
    });
    await prisma.expenseVoucher.deleteMany({ where: { id: { in: voucherIds } } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
    await prisma.party.deleteMany({ where: { id: { in: partyIds } } });
  });
  await closeTestApp();
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH', url: string, token: string, payload?: unknown) =>
  app.inject({ method, url, headers: authHeaders(token), ...(payload ? { payload: payload as object } : {}) });
const dataOf = (res: { body: string }) => JSON.parse(res.body).data;

let seq = 0;
/** A voucher as an older image left it; an ACCRUED one with its JE-17B accrual. */
async function legacyVoucher(status: 'DRAFT' | 'APPROVED' | 'ACCRUED', amount = 18500) {
  const voucher = await prisma.expenseVoucher.create({
    data: {
      facilityId: TEST_FACILITY_ID,
      voucherNumber: `EXP-204001-9${String(++seq).padStart(3, '0')}`,
      voucherDate: new Date('2040-01-15'),
      expenseAccountCode: '5010',
      description: 'LESCO refrigeration bill (legacy)',
      vendorName: 'LESCO',
      referenceNumber: 'LESCO-JAN',
      amountPkr: amount,
      status,
      isAccrual: status === 'ACCRUED',
      bookType: 'PACCI',
      createdBy: ownerId,
    },
  });
  voucherIds.push(voucher.id);
  if (status === 'ACCRUED') {
    const accrual = await journal.post(TEST_FACILITY_ID, ownerId, {
      entryType: 'EXPENSE',
      bookType: 'PACCI',
      sourceTable: 'expense_vouchers',
      sourceId: voucher.id,
      entryDate: new Date('2040-01-15'),
      description: `Expense accrued ${voucher.voucherNumber}`,
      lines: [
        { accountCode: '5010', debitAmount: amount, creditAmount: 0 },
        { accountCode: '2040', debitAmount: 0, creditAmount: amount },
      ],
    });
    await prisma.expenseVoucher.update({ where: { id: voucher.id }, data: { accrualJournalEntryId: accrual.id } });
  }
  return voucher;
}

async function supplier(name = 'LESCO') {
  const res = await call('POST', '/v1/parties', ownerToken, {
    name: `${name} ${Date.now()}`,
    party_type: 'SUPPLIER',
    phone_primary: `0392${String(Date.now()).slice(-7)}`,
  });
  expect(res.statusCode, res.body).toBe(201);
  partyIds.push(dataOf(res).id);
  return dataOf(res).id as string;
}

const voucherLiability = async (voucherId: string, billId?: string) => {
  const lines = await prisma.journalEntryLine.findMany({
    where: {
      facilityId: TEST_FACILITY_ID,
      accountCode: '2040',
      journalEntry: { OR: [{ sourceTable: 'expense_vouchers', sourceId: voucherId }, ...(billId ? [{ sourceTable: 'bills', sourceId: billId }] : [])] },
    },
  });
  return lines.reduce((s, l) => s + Number(l.creditAmount) - Number(l.debitAmount), 0);
};

describe('C-03 / C-08 — no new expense voucher, no petty-cash path', () => {
  it('refuses to create a voucher and points at bills', async () => {
    const res = await call('POST', '/v1/expense-vouchers', accountantToken, {
      voucher_date: '2040-01-10',
      expense_account_code: '5010',
      description: 'new voucher',
      amount_pkr: 100,
    });
    expect(res.statusCode).toBe(410);
    expect(JSON.parse(res.body).error.code).toBe('EXPENSE_VOUCHERS_RETIRED');
  });

  it('the approve / accrue / pay / petty-cash endpoints are gone', async () => {
    const v = await legacyVoucher('APPROVED');
    for (const path of [`${v.id}/approve`, `${v.id}/accrue`, `${v.id}/pay`, 'petty-cash-replenish']) {
      const res = await call('POST', `/v1/expense-vouchers/${path}`, ownerToken, {
        payment_date: '2040-01-20',
        payment_method: 'CASH',
        asset_account_code: '1010',
        replenishment_date: '2040-01-20',
        amount_pkr: 100,
      });
      expect(res.statusCode, path).toBe(404);
    }
  });
});

describe('C-11 — existing vouchers stay readable; what may happen to them comes from the API', () => {
  it('a draft or approved voucher can only be cancelled', async () => {
    const draft = await legacyVoucher('DRAFT');
    const got = await call('GET', `/v1/expense-vouchers/${draft.id}`, accountantToken);
    expect(got.statusCode).toBe(200);
    expect(dataOf(got).allowed_actions).toEqual(['cancel']);

    const cancelled = await call('POST', `/v1/expense-vouchers/${draft.id}/cancel`, managerToken, { reason: 'retired' });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(dataOf(cancelled)).toMatchObject({ status: 'CANCELLED', allowed_actions: [] });

    const list = await call('GET', '/v1/expense-vouchers?date_from=2040-01-01&date_to=2040-01-31', accountantToken);
    expect((dataOf(list) as Array<{ id: string }>).map((v) => v.id)).toContain(draft.id);
  });

  it('an accrued voucher offers convert-to-bill', async () => {
    const v = await legacyVoucher('ACCRUED');
    expect(dataOf(await call('GET', `/v1/expense-vouchers/${v.id}`, accountantToken)).allowed_actions).toEqual([
      'convert_to_bill',
    ]);
  });
});

describe('C-03 — an accrued voucher converts to a bill, moving its liability 2040 → 2050', () => {
  it('creates a posted bill with the voucher’s cost line, posts DR 2040 / CR 2050 with the supplier, and marks the voucher CONVERTED', async () => {
    const v = await legacyVoucher('ACCRUED', 18500);
    const supplierId = await supplier();
    expect(await voucherLiability(v.id)).toBe(18500);

    const res = await call('POST', `/v1/expense-vouchers/${v.id}/convert-to-bill`, managerToken, {
      supplier_party_id: supplierId,
      conversion_date: '2040-02-01',
    });
    expect(res.statusCode, res.body).toBe(200);
    const voucher = dataOf(res);
    expect(voucher).toMatchObject({ status: 'CONVERTED', allowed_actions: [] });
    expect(voucher.bill_id).toBeTruthy();

    const bill = dataOf(await call('GET', `/v1/bills/${voucher.bill_id}`, accountantToken));
    expect(bill).toMatchObject({
      status: 'POSTED',
      supplier_party_id: supplierId,
      bill_date: '2040-01-15',
      total_pkr: 18500,
      legacy_expense_voucher_id: v.id,
      payment_status: 'UNPAID',
    });
    expect(bill.lines).toEqual([expect.objectContaining({ expense_account_code: '5010', amount_pkr: 18500 })]);

    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: bill.journal_entry_id }, include: { lines: true } });
    expect(entry).toMatchObject({ entryType: 'BILL', sourceTable: 'bills', sourceId: bill.id });
    expect(entry.entryDate.toISOString().slice(0, 10)).toBe('2040-02-01');
    const byAccount = Object.fromEntries(entry.lines.map((l) => [l.accountCode, l]));
    expect(Number(byAccount['2040']!.debitAmount)).toBe(18500);
    expect(Number(byAccount['2050']!.creditAmount)).toBe(18500);
    expect(byAccount['2050']!.partyId).toBe(supplierId);
    // The cost was recognised when it was accrued; converting it books no second expense.
    expect(entry.lines.find((l) => l.accountCode === '5010')).toBeUndefined();
    expect(await voucherLiability(v.id, bill.id)).toBe(0);

    // From here it is an ordinary bill: paid like any other.
    const pay = await call('POST', '/v1/supplier-payments', accountantToken, {
      supplier_party_id: supplierId,
      payment_date: '2040-02-05',
      payment_method: 'BANK_TRANSFER',
      gross_amount_pkr: 18500,
      allocations: [{ bill_id: bill.id, amount_pkr: 18500 }],
    });
    expect(pay.statusCode, pay.body).toBe(201);
  });

  it('refuses a voucher that is not accrued, a customer, and a second conversion', async () => {
    const supplierId = await supplier('Convert Refusals');
    const approved = await legacyVoucher('APPROVED');
    const notAccrued = await call('POST', `/v1/expense-vouchers/${approved.id}/convert-to-bill`, managerToken, {
      supplier_party_id: supplierId,
      conversion_date: '2040-02-01',
    });
    expect(notAccrued.statusCode).toBe(409);

    const accrued = await legacyVoucher('ACCRUED', 700);
    const farmer = await call('POST', '/v1/parties', ownerToken, {
      name: `Convert Farmer ${Date.now()}`,
      party_type: 'FARMER',
      phone_primary: `0393${String(Date.now()).slice(-7)}`,
    });
    partyIds.push(dataOf(farmer).id);
    const customer = await call('POST', `/v1/expense-vouchers/${accrued.id}/convert-to-bill`, managerToken, {
      supplier_party_id: dataOf(farmer).id,
      conversion_date: '2040-02-01',
    });
    expect(customer.statusCode).toBe(400);

    const convert = () =>
      call('POST', `/v1/expense-vouchers/${accrued.id}/convert-to-bill`, managerToken, {
        supplier_party_id: supplierId,
        conversion_date: '2040-02-01',
      });
    const [a, b] = await Promise.all([convert(), convert()]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    expect(await prisma.bill.count({ where: { legacyExpenseVoucherId: accrued.id } })).toBe(1);
  });

  it('a converted bill is not voided — the voucher’s liability cannot be put back behind it', async () => {
    const v = await legacyVoucher('ACCRUED', 900);
    const supplierId = await supplier('Convert Void');
    const converted = dataOf(
      await call('POST', `/v1/expense-vouchers/${v.id}/convert-to-bill`, managerToken, {
        supplier_party_id: supplierId,
        conversion_date: '2040-02-01',
      }),
    );
    const bill = dataOf(await call('GET', `/v1/bills/${converted.bill_id}`, accountantToken));
    expect(bill.allowed_actions).not.toContain('void');
    const res = await call('POST', `/v1/bills/${bill.id}/void`, managerToken, { reason: 'try to void' });
    expect(res.statusCode).toBe(409);
  });
});
