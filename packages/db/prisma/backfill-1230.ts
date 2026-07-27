import { PrismaClient } from '@prisma/client';
import { CHART_OF_ACCOUNTS } from './chart-of-accounts';

const prisma = new PrismaClient();

/**
 * One-shot backfill for phase 21: add account 1230 (Advances to Employees) to every
 * existing facility.
 *
 * `seedChartOfAccounts` upserts the *entire* CHART_OF_ACCOUNTS array and cannot be
 * re-run safely against a live facility — several accounts (1210, 1220, 1230, 2080,
 * 2110, 2120 …) are deliberately non-system and owner-renameable, so a full re-seed
 * would clobber any rename. This script therefore upserts only the one new code.
 *
 * New facilities need no backfill: `seedChartOfAccounts` already includes 1230 for
 * anyone provisioned after this change.
 *
 * Run once per environment: `pnpm --filter @coldchain/db exec tsx prisma/backfill-1230.ts`
 */
async function main() {
  const account = CHART_OF_ACCOUNTS.find((a) => a.code === '1230');
  if (!account) throw new Error('1230 not found in CHART_OF_ACCOUNTS — check chart-of-accounts.ts');

  const facilities = await prisma.facility.findMany({ select: { id: true, name: true } });
  let created = 0;
  let already = 0;

  for (const facility of facilities) {
    const existing = await prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId: facility.id, accountCode: '1230' } },
    });
    if (existing) {
      already += 1;
      continue;
    }
    await prisma.chartOfAccounts.create({
      data: {
        facilityId: facility.id,
        accountCode: account.code,
        accountName: account.name,
        accountClass: account.cls,
        accountType: account.type,
        parentAccountCode: account.parent,
        normalBalance: account.normal,
        isSystemAccount: account.system ?? false,
      },
    });
    created += 1;
    console.log(`  + 1230 added to ${facility.name} (${facility.id})`);
  }

  console.log(`\nDone: ${created} created, ${already} already present, ${facilities.length} facilities total.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
