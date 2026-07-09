/**
 * Gap 2 (docs/16_accounting_module_audit.md) — generic reversal endpoint:
 * POST /v1/accounting/journal-entries/:id/reverse builds the mirror-image
 * entry, links both ways, and flips the original to REVERSED. Manual
 * entries only — system entries are corrected through their own flows
 * (credit note, dishonour, write-off).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

const DESCRIPTION_TAG = 'reversal-endpoint test';

let app: FastifyInstance;
let ownerToken: string;
let ownerUserId: string;
let managerToken: string;
let accountantToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { facilityId: TEST_FACILITY_ID, description: { contains: DESCRIPTION_TAG } } },
    });
    await prisma.journalEntry.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, description: { contains: DESCRIPTION_TAG } },
    });
    await prisma.periodLock.deleteMany({ where: { facilityId: TEST_FACILITY_ID } });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  const owner = await loginAsRole(app, 'OWNER');
  ownerToken = owner.accessToken;
  ownerUserId = owner.user.id as string;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  accountantToken = (await loginAsRole(app, 'ACCOUNTANT')).accessToken;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

async function createManualJe(opts?: {
  token?: string;
  bookType?: 'PACCI' | 'KATCHI';
  postingStatus?: 'AUTO_DRAFT' | 'POSTED';
}) {
  const res = await app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(opts?.token ?? managerToken),
    payload: {
      entry_date: '2026-07-05',
      description: `${DESCRIPTION_TAG} original`,
      book_type: opts?.bookType ?? 'PACCI',
      posting_status: opts?.postingStatus ?? 'POSTED',
      lines: [
        { account_code: '1010', debit_amount: 250, credit_amount: 0 },
        { account_code: '4050', debit_amount: 0, credit_amount: 250 },
      ],
    },
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body).data;
}

function reverse(id: string, token: string, body: Record<string, unknown> = { reason: 'entered against wrong account' }) {
  return app.inject({
    method: 'POST',
    url: `/v1/accounting/journal-entries/${id}/reverse`,
    headers: authHeaders(token),
    payload: body,
  });
}

describe('Gap 2 · journal entry reversal endpoint', () => {
  it('MANAGER reverses a posted manual entry: mirror lines, both-way links, original flipped to REVERSED', async () => {
    const original = await createManualJe();

    const res = await reverse(original.id, managerToken);
    expect(res.statusCode).toBe(201);
    const reversal = JSON.parse(res.body).data;

    expect(reversal.entry_type).toBe('REVERSAL');
    expect(reversal.book_type).toBe('PACCI');
    expect(reversal.posting_status).toBe('POSTED');
    expect(reversal.source_table).toBe('journal_entries');
    expect(reversal.source_id).toBe(original.id);
    expect(reversal.description).toContain(original.entry_number);
    expect(reversal.description).toContain('entered against wrong account');

    // Mirror image: debits and credits swapped, same accounts.
    const byAccount = Object.fromEntries(reversal.lines.map((l: any) => [l.account_code, l]));
    expect(byAccount['1010'].credit_amount).toBe(250);
    expect(byAccount['1010'].debit_amount).toBe(0);
    expect(byAccount['4050'].debit_amount).toBe(250);
    expect(byAccount['4050'].credit_amount).toBe(0);

    const after = await app.inject({
      method: 'GET',
      url: `/v1/accounting/journal-entries/${original.id}`,
      headers: authHeaders(managerToken),
    });
    const originalAfter = JSON.parse(after.body).data;
    expect(originalAfter.posting_status).toBe('REVERSED');
    expect(originalAfter.reversed_by_id).toBe(reversal.id);
  });

  it('requires a reason', async () => {
    const original = await createManualJe();
    const res = await reverse(original.id, managerToken, {});
    expect(res.statusCode).toBe(400);
  });

  it('rejects reversing an already-reversed entry', async () => {
    const original = await createManualJe();
    expect((await reverse(original.id, managerToken)).statusCode).toBe(201);

    const again = await reverse(original.id, managerToken);
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).error.code).toBe('JOURNAL_ENTRY_ALREADY_REVERSED');
  });

  it('rejects reversing a draft — drafts are not in the books', async () => {
    const draft = await createManualJe({ postingStatus: 'AUTO_DRAFT' });
    const res = await reverse(draft.id, managerToken);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('JOURNAL_ENTRY_NOT_POSTED');
  });

  it('rejects reversing a system-generated entry — those go through their own correction flows', async () => {
    const systemJe = await prisma.journalEntry.create({
      data: {
        facilityId: TEST_FACILITY_ID,
        entryNumber: `JE-TEST-${Date.now() % 1000000}`,
        entryDate: new Date('2026-07-05'),
        entryType: 'INVOICE',
        bookType: 'PACCI',
        sourceTable: 'invoices',
        sourceId: ownerUserId,
        description: `${DESCRIPTION_TAG} system entry`,
        postingStatus: 'POSTED',
        periodMonth: 7,
        periodYear: 2026,
        createdBy: ownerUserId,
        lines: {
          create: [
            { lineNumber: 1, accountCode: '1110', facilityId: TEST_FACILITY_ID, debitAmount: 100, creditAmount: 0 },
            { lineNumber: 2, accountCode: '4010', facilityId: TEST_FACILITY_ID, debitAmount: 0, creditAmount: 100 },
          ],
        },
      },
    });

    const res = await reverse(systemJe.id, managerToken);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('JOURNAL_ENTRY_NOT_REVERSIBLE');
  });

  it('ACCOUNTANT cannot reverse', async () => {
    const original = await createManualJe();
    const res = await reverse(original.id, accountantToken);
    expect(res.statusCode).toBe(403);
  });

  it('KATCHI entries: MANAGER blocked, OWNER allowed, reversal stays in KATCHI', async () => {
    const original = await createManualJe({ token: ownerToken, bookType: 'KATCHI' });

    const asManager = await reverse(original.id, managerToken);
    expect(asManager.statusCode).toBe(403);

    const asOwner = await reverse(original.id, ownerToken);
    expect(asOwner.statusCode).toBe(201);
    expect(JSON.parse(asOwner.body).data.book_type).toBe('KATCHI');
  });

  it('reversal date must land in an open period', async () => {
    const original = await createManualJe();

    const lock = await app.inject({
      method: 'POST',
      url: '/v1/accounting/period-locks',
      headers: authHeaders(managerToken),
      payload: { period_year: 2026, period_month: 7, reason: 'reversal-period test' },
    });
    expect(lock.statusCode).toBe(201);

    try {
      const res = await reverse(original.id, managerToken, {
        reason: 'backdated fix attempt',
        entry_date: '2026-07-06',
      });
      expect(res.statusCode).toBe(409);
      expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
    } finally {
      const unlock = await app.inject({
        method: 'POST',
        url: '/v1/accounting/period-locks/2026/7/unlock',
        headers: authHeaders(ownerToken),
        payload: { reason: 'reversal-period test done' },
      });
      expect(unlock.statusCode).toBe(200);
    }
  });
});
