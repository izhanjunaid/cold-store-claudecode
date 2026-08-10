import { PrismaClient } from '@prisma/client';
import { CHART_OF_ACCOUNTS } from './chart-of-accounts';

const prisma = new PrismaClient();

/**
 * One-shot backfill for phase 25: add header account 6900 (Non-Operating
 * Expenses) to every existing facility, and re-parent 6110 (Loss on Disposal
 * of Asset) under it wherever 6110 carries no postings.
 *
 * Same upsert-one-code precedent as backfill-1230.ts/backfill-1025.ts for the
 * header. The re-parent is different: guard_chart_of_accounts (migration
 * 0002) blocks a parent_account_code change on any account that already has
 * journal-entry-line postings. A facility that has booked a disposal loss
 * keeps 6110 under 6000 — it still lands in operating expense and the
 * statements still balance, exactly as before this phase — rather than a
 * silent restatement of a posted period. This script logs those as skipped
 * instead of failing.
 *
 * New facilities need no backfill: `seedChartOfAccounts` already seeds 6900
 * and parents 6110 under it for anyone provisioned after this change.
 *
 * Run once per environment: `pnpm --filter @coldchain/db exec tsx prisma/backfill-6900.ts`
 */
async function main() {
  const header = CHART_OF_ACCOUNTS.find((a) => a.code === '6900');
  if (!header) throw new Error('6900 not found in CHART_OF_ACCOUNTS — check chart-of-accounts.ts');

  const facilities = await prisma.facility.findMany({ select: { id: true, name: true } });

  let headersCreated = 0;
  let headersExisted = 0;
  let reparented = 0;
  let alreadyUnder6900 = 0;
  let skippedHasPostings = 0;
  let skippedNo6110 = 0;

  for (const facility of facilities) {
    const existingHeader = await prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId: facility.id, accountCode: '6900' } },
    });
    if (existingHeader) {
      headersExisted += 1;
    } else {
      await prisma.chartOfAccounts.create({
        data: {
          facilityId: facility.id,
          accountCode: header.code,
          accountName: header.name,
          accountClass: header.cls,
          accountType: header.type,
          parentAccountCode: header.parent,
          normalBalance: header.normal,
          isSystemAccount: header.system ?? false,
          statementSection: header.section ?? null,
        },
      });
      headersCreated += 1;
      console.log(`  + 6900 header added to ${facility.name} (${facility.id})`);
    }

    const account6110 = await prisma.chartOfAccounts.findUnique({
      where: { facilityId_accountCode: { facilityId: facility.id, accountCode: '6110' } },
    });
    if (!account6110) {
      skippedNo6110 += 1;
      continue;
    }
    if (account6110.parentAccountCode === '6900') {
      alreadyUnder6900 += 1;
      continue;
    }
    try {
      await prisma.chartOfAccounts.update({
        where: { facilityId_accountCode: { facilityId: facility.id, accountCode: '6110' } },
        data: { parentAccountCode: '6900' },
      });
      reparented += 1;
      console.log(`  ~ 6110 re-parented to 6900 for ${facility.name} (${facility.id})`);
    } catch {
      skippedHasPostings += 1;
      console.log(
        `  ! 6110 has postings for ${facility.name} (${facility.id}) — left under 6000, skipped`,
      );
    }
  }

  console.log(
    `\n6900 header: ${headersCreated} created, ${headersExisted} already present.\n` +
      `6110 re-parent: ${reparented} moved, ${alreadyUnder6900} already under 6900, ` +
      `${skippedHasPostings} skipped (has postings), ${skippedNo6110} skipped (no 6110 account).\n` +
      `${facilities.length} facilities total.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
