/**
 * Cash ↔ bank transfers — a document since docs/25 C-44 / L-09.
 *
 * Depositing the day's takings into the bank had no first-class path (backlog P1-10).
 * JE-27 then gave it one, but as a bare journal entry posted from a controller: no
 * history to look at, no way to correct one, and the acting user's id standing in as
 * its "source". A transfer is now a `cash_transfers` row with its own entry
 * (CASH_TRANSFER, sourced to the row), a list, and a void that reverses the entry.
 *
 * The property worth asserting beyond "it posts two lines" is that a transfer changes
 * where the money is and not how much there is — cash and cash equivalents are
 * unmoved, and the cash flow statement's net change is unmoved with them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();
const OWN_BANK = '1048';

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;
const transferIds: string[] = [];

const DATE = '2033-04-10';
const AMOUNT = 7500;

async function cashFlowNetChange() {
  const res = await app.inject({
    method: 'GET',
    url: '/v1/accounting/cash-flow?date_from=2033-01-01&date_to=2033-12-31',
    headers: authHeaders(ownerToken),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as { net_change_pkr: number; closing_cash_pkr: number };
}

async function transfer(payload: Record<string, unknown>, token = ownerToken) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/cash-transfers',
    headers: authHeaders(token),
    payload,
  });
  if (res.statusCode === 201) transferIds.push(JSON.parse(res.body).data.id);
  return res;
}

const voidTransfer = (id: string, payload: Record<string, unknown>) =>
  app.inject({
    method: 'POST',
    url: `/v1/accounting/cash-transfers/${id}/void`,
    headers: authHeaders(ownerToken),
    payload,
  });

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  await prisma.chartOfAccounts.upsert({
    where: { facilityId_accountCode: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } },
    update: {},
    create: {
      facilityId: TEST_FACILITY_ID,
      accountCode: OWN_BANK,
      accountName: 'Second bank — cash transfer test',
      accountClass: 'ASSET',
      accountType: 'DETAIL',
      parentAccountCode: '1000',
      normalBalance: 'DEBIT',
      isCashEquivalent: true,
    },
  });
});

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    const scope = { facilityId: TEST_FACILITY_ID, sourceTable: 'cash_transfers', sourceId: { in: transferIds } };
    await prisma.cashTransfer.updateMany({ where: { id: { in: transferIds } }, data: { journalEntryId: null } });
    await prisma.cashTransfer.deleteMany({ where: { id: { in: transferIds } } });
    await prisma.journalEntryLine.deleteMany({ where: { facilityId: TEST_FACILITY_ID, journalEntry: scope } });
    await prisma.journalEntry.updateMany({ where: scope, data: { reversedById: null } });
    await prisma.journalEntry.deleteMany({ where: scope });
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: TEST_FACILITY_ID, accountCode: OWN_BANK } });
  });
  await prisma.$disconnect();
  await closeTestApp();
});

describe('a transfer is a document with its own entry', () => {
  it('records the transfer and posts DR destination / CR source, sourced to it', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1020',
      amount_pkr: AMOUNT,
      note: 'daily takings deposited',
    });
    expect(res.statusCode, res.body).toBe(201);
    const doc = JSON.parse(res.body).data;
    expect(doc).toMatchObject({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1020',
      amount_pkr: AMOUNT,
      notes: 'daily takings deposited',
      voided_at: null,
      allowed_actions: ['void'],
    });
    expect(doc.entry_number).toMatch(/^JE-/);

    const entry = await prisma.journalEntry.findUniqueOrThrow({
      where: { id: doc.journal_entry_id },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    });
    expect(entry).toMatchObject({ entryType: 'CASH_TRANSFER', sourceTable: 'cash_transfers', sourceId: doc.id });
    expect(entry.lines).toHaveLength(2);
    expect(Number(entry.lines.find((l) => l.accountCode === '1020')!.debitAmount)).toBeCloseTo(AMOUNT, 2);
    expect(Number(entry.lines.find((l) => l.accountCode === '1010')!.creditAmount)).toBeCloseTo(AMOUNT, 2);
  });

  it('moves money into an owner-added bank account', async () => {
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1020',
      to_account_code: OWN_BANK,
      amount_pkr: 250,
    });
    expect(res.statusCode, res.body).toBe(201);
  });

  it('appears in the transfer history, newest first', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/accounting/cash-transfers?date_from=2033-04-01&date_to=2033-04-30',
      headers: authHeaders(ownerToken),
    });
    expect(res.statusCode, res.body).toBe(200);
    const rows = JSON.parse(res.body).data as Array<{ id: string; from_account_name: string }>;
    const ids = rows.map((r) => r.id);
    for (const id of transferIds) expect(ids).toContain(id);
    expect(rows.find((r) => r.id === transferIds[0])!.from_account_name).toBeTruthy();
  });

  it('leaves total cash — and the cash flow statement — unchanged', async () => {
    const before = await cashFlowNetChange();
    const res = await transfer({
      transfer_date: DATE,
      from_account_code: '1010',
      to_account_code: '1030',
      amount_pkr: 1200,
    });
    expect(res.statusCode, res.body).toBe(201);

    const after = await cashFlowNetChange();
    expect(after.closing_cash_pkr, 'a transfer changes where the money is, not how much').toBeCloseTo(
      before.closing_cash_pkr,
      2,
    );
    expect(after.net_change_pkr, 'moving between your own pockets is not a cash flow').toBeCloseTo(
      before.net_change_pkr,
      2,
    );
  });
});

describe('only cash equivalents, only two different ones', () => {
  it('refuses a receivable and cheques in hand', async () => {
    for (const code of ['1110', '1025']) {
      const res = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: code, amount_pkr: 100 });
      expect(res.statusCode, code).toBe(422);
      expect(JSON.parse(res.body).error).toMatchObject({ code: 'NOT_A_CASH_ACCOUNT' });
      expect(JSON.parse(res.body).error.message).toContain(code);
    }
  });

  it('refuses a transfer to the same account', async () => {
    const res = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: '1010', amount_pkr: 100 });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a zero or negative amount', async () => {
    for (const amount_pkr of [0, -50]) {
      const res = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: '1020', amount_pkr });
      expect(res.statusCode, `amount ${amount_pkr}`).toBe(400);
    }
  });
});

describe('a transfer recorded in error is voided, not deleted', () => {
  it('reverses its entry, keeps the row, and cannot be voided twice', async () => {
    const created = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: '1020', amount_pkr: 999 });
    expect(created.statusCode, created.body).toBe(201);
    const doc = JSON.parse(created.body).data;

    const voided = await voidTransfer(doc.id, { reason: 'wrong account', void_date: '2033-04-12' });
    expect(voided.statusCode, voided.body).toBe(200);
    const after = JSON.parse(voided.body).data;
    expect(after.voided_at).not.toBeNull();
    expect(after.void_reason).toBe('wrong account');
    expect(after.allowed_actions).toEqual([]);

    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: doc.journal_entry_id } });
    expect(original.reversedById).not.toBeNull();
    const mirror = await prisma.journalEntry.findUniqueOrThrow({ where: { id: original.reversedById! } });
    expect(mirror).toMatchObject({ entryType: 'REVERSAL', sourceTable: 'cash_transfers', sourceId: doc.id });

    const again = await voidTransfer(doc.id, { reason: 'twice' });
    expect(again.statusCode).toBe(409);
  });

  it('two concurrent voids: exactly one reverses the entry', async () => {
    const created = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: '1020', amount_pkr: 444 });
    const doc = JSON.parse(created.body).data;
    const [a, b] = await Promise.all([voidTransfer(doc.id, { reason: 'void a', void_date: DATE }), voidTransfer(doc.id, { reason: 'void b', void_date: DATE })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const mirrors = await prisma.journalEntry.count({
      where: { facilityId: TEST_FACILITY_ID, sourceTable: 'cash_transfers', sourceId: doc.id, entryType: 'REVERSAL' },
    });
    expect(mirrors).toBe(1);
  });

  it('a transfer cannot be reversed behind its back from the journal', async () => {
    const created = await transfer({ transfer_date: DATE, from_account_code: '1010', to_account_code: '1020', amount_pkr: 333 });
    const doc = JSON.parse(created.body).data;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/accounting/journal-entries/${doc.journal_entry_id}/reverse`,
      headers: authHeaders(managerToken),
      payload: { reason: 'behind its back' },
    });
    expect(res.statusCode).not.toBe(200);
    expect(res.statusCode).not.toBe(201);
  });
});
