/**
 * F-4 (docs/16_accounting_module_audit.md) — closed-through watermark:
 * the maximum actively-locked period closes every earlier period too,
 * unless a specific month has been explicitly unlocked (reopen exception).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { withGuardsDisabled } from '../../../test/financial-guards';
import { getTestApp, closeTestApp, loginAsRole, authHeaders, TEST_FACILITY_ID } from '../../../test/helpers';
import { PrismaClient } from '@coldchain/db';
import type { FastifyInstance } from 'fastify';

const prisma = new PrismaClient();

// Isolated far-future year so watermark semantics cannot collide with
// periods used by other integration suites.
const YEAR = 2031;

let app: FastifyInstance;
let ownerToken: string;
let managerToken: string;

async function cleanup() {
  await withGuardsDisabled(prisma, async () => {
    await prisma.journalEntryLine.deleteMany({
      where: { journalEntry: { facilityId: TEST_FACILITY_ID, periodYear: YEAR } },
    });
    await prisma.journalEntry.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, periodYear: YEAR },
    });
    await prisma.periodLock.deleteMany({
      where: { facilityId: TEST_FACILITY_ID, periodYear: YEAR },
    });
  });
}

beforeAll(async () => {
  app = await getTestApp();
  ownerToken = (await loginAsRole(app, 'OWNER')).accessToken;
  managerToken = (await loginAsRole(app, 'MANAGER')).accessToken;
  await cleanup();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
  await closeTestApp();
});

async function postManualJe(entryDate: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    headers: authHeaders(managerToken),
    payload: {
      entry_date: entryDate,
      description: `watermark test ${entryDate}`,
      book_type: 'PACCI',
      posting_status: 'POSTED',
      lines: [
        { account_code: '1010', debit_amount: 100, credit_amount: 0 },
        { account_code: '4050', debit_amount: 0, credit_amount: 100 },
      ],
    },
  });
}

async function lockPeriod(month: number, reason?: string) {
  return app.inject({
    method: 'POST',
    url: '/v1/accounting/period-locks',
    headers: authHeaders(managerToken),
    payload: { period_year: YEAR, period_month: month, reason },
  });
}

async function unlockPeriod(month: number, reason: string) {
  return app.inject({
    method: 'POST',
    url: `/v1/accounting/period-locks/${YEAR}/${month}/unlock`,
    headers: authHeaders(ownerToken),
    payload: { reason },
  });
}

describe('F-4 · closed-through watermark', () => {
  it('locking a month closes every earlier month, even ones never explicitly locked', async () => {
    const lock = await lockPeriod(6, 'June close');
    expect(lock.statusCode).toBe(201);

    // March has no lock row of its own, but sits below the June watermark.
    const res = await postManualJe(`${YEAR}-03-15`);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
  });

  it('months after the watermark stay open', async () => {
    const res = await postManualJe(`${YEAR}-07-15`);
    expect(res.statusCode).toBe(201);
  });

  it('the watermark month itself is closed', async () => {
    const res = await postManualJe(`${YEAR}-06-10`);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
  });

  it('OWNER can explicitly unlock a watermark-closed month that has no lock row', async () => {
    const unlock = await unlockPeriod(3, 'Backdated rent adjustment');
    expect(unlock.statusCode).toBe(200);

    // March is now an explicit reopen exception…
    const march = await postManualJe(`${YEAR}-03-20`);
    expect(march.statusCode).toBe(201);

    // …but April, also below the watermark, stays closed.
    const april = await postManualJe(`${YEAR}-04-10`);
    expect(april.statusCode).toBe(409);
    expect(JSON.parse(april.body).error.code).toBe('PERIOD_LOCKED');
  });

  it('re-locking the reopened month closes it again', async () => {
    const relock = await lockPeriod(3, 'Adjustment done');
    expect(relock.statusCode).toBe(201);

    const res = await postManualJe(`${YEAR}-03-25`);
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_LOCKED');
  });

  it('unlocking a month above the watermark is rejected — it is already open', async () => {
    const res = await unlockPeriod(9, 'nothing to reopen');
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).error.code).toBe('PERIOD_NOT_LOCKED');
  });
});
