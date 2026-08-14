import { describe, it, expect, afterAll } from 'vitest';
import {
  PrismaClient,
  CHART_OF_ACCOUNTS,
  seedChartOfAccounts,
  syncChartOfAccounts,
} from '@coldchain/db';
import { withGuardsDisabled } from '../../../test/financial-guards';

/**
 * syncChartOfAccounts is what every facility box runs on every update
 * (packages/db/prisma/deploy.ts step 3). It replaced three hand-run backfill
 * scripts, so the property that matters is not "it adds the account" — it is
 * that it adds ONLY what is missing and never rewrites what the owner changed.
 *
 * A "simplification" to `seedChartOfAccounts`-style upsert would pass any test
 * that only checks the missing account came back, and would silently reset every
 * account name and parent the client had customised on their next update. The
 * rename assertion below is the one that catches that.
 *
 * Runs on a scratch facility it creates and removes: the shared TEST_FACILITY_ID
 * is used by the rest of the suite and must not gain or lose accounts.
 */
const prisma = new PrismaClient();
const SCRATCH_FACILITY_ID = '00000000-0000-0000-0000-0000000009c0';

afterAll(async () => {
  await withGuardsDisabled(prisma, async () => {
    // chart_of_accounts_facility_id_fkey is ON DELETE RESTRICT, so the accounts must
    // go before the facility — and every insert above left an append-only audit_log
    // row pointing at the facility too.
    await prisma.chartOfAccounts.deleteMany({ where: { facilityId: SCRATCH_FACILITY_ID } });
    await prisma.auditLog.deleteMany({ where: { facilityId: SCRATCH_FACILITY_ID } });
    await prisma.facility.deleteMany({ where: { id: SCRATCH_FACILITY_ID } });
  });
  await prisma.$disconnect();
});

describe('syncChartOfAccounts (runs on every client update)', () => {
  it('adds only missing accounts and leaves owner edits alone', async () => {
    await prisma.facility.upsert({
      where: { id: SCRATCH_FACILITY_ID },
      update: {},
      create: { id: SCRATCH_FACILITY_ID, name: 'Sync Scratch Facility', city: 'Lahore' },
    });
    await seedChartOfAccounts(prisma, SCRATCH_FACILITY_ID);

    // Simulate a real client box one release behind: the owner renamed an account,
    // and a code this release introduces does not exist yet. 1230 is deliberate —
    // it is `system: false` in the seed, and it is exactly the account
    // backfill-1230.ts was written for, so a sync that only handled system
    // accounts would not fix the case it exists for.
    await withGuardsDisabled(prisma, async () => {
      await prisma.chartOfAccounts.update({
        where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '6020' } },
        data: { accountName: 'Godown Rent (Ali Khan)' },
      });
      await prisma.chartOfAccounts.delete({
        where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '1230' } },
      });
    });

    const added = await syncChartOfAccounts(prisma, SCRATCH_FACILITY_ID);
    expect(added).toBe(1);

    const restored = await prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '1230' } },
    });
    expect(restored?.accountName).toBe('Advances to Employees');

    const renamed = await prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '6020' } },
    });
    expect(renamed?.accountName).toBe('Godown Rent (Ali Khan)');
  });

  it('is a no-op the second time (updates run it on every release)', async () => {
    expect(await syncChartOfAccounts(prisma, SCRATCH_FACILITY_ID)).toBe(0);

    const count = await prisma.chartOfAccounts.count({ where: { facilityId: SCRATCH_FACILITY_ID } });
    expect(count).toBe(CHART_OF_ACCOUNTS.length);
  });

  // The one thing sync does that is not an insert, and the only reason a client's P&L
  // puts a disposal loss below operating profit instead of above it. It lives inside a
  // bare try/catch, so without these two cases a silent no-op would look exactly like
  // success.
  it('re-parents 6110 from the old 6000 to 6900, and only from there', async () => {
    const parentOf = async () =>
      (
        await prisma.chartOfAccounts.findUnique({
          where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '6110' } },
        })
      )?.parentAccountCode;

    // A box one release behind still has 6110 under 6000.
    await withGuardsDisabled(prisma, async () => {
      await prisma.chartOfAccounts.update({
        where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '6110' } },
        data: { parentAccountCode: '6000' },
      });
    });
    await syncChartOfAccounts(prisma, SCRATCH_FACILITY_ID);
    expect(await parentOf()).toBe('6900');

    // An owner who filed it somewhere of their own keeps it there — the move is scoped
    // to the exact old parent, not "anything that isn't 6900".
    await withGuardsDisabled(prisma, async () => {
      await prisma.chartOfAccounts.update({
        where: { facilityId_accountCode: { facilityId: SCRATCH_FACILITY_ID, accountCode: '6110' } },
        data: { parentAccountCode: '6100' },
      });
    });
    await syncChartOfAccounts(prisma, SCRATCH_FACILITY_ID);
    expect(await parentOf()).toBe('6100');
  });
});
