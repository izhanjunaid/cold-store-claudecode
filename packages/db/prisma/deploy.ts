import { execSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { syncChartOfAccounts } from '../src/chart-of-accounts';

/**
 * ColdChain — the ONE thing a facility box runs to bring its database up to the
 * release it is about to start. Idempotent: running it twice changes nothing.
 *
 * It exists because `prisma migrate deploy` alone is not enough on a real box:
 *
 *  1. **Pre-rebaseline boxes.** Phase 13 replaced migrations 0001–0016 with a
 *     single `20260101000000_baseline` (phases/phase-13-production-deploy.md,
 *     "Rebaseline impact"). A box installed before that has the OLD migration
 *     names in `_prisma_migrations` and no baseline row, so `migrate deploy`
 *     replays the baseline against a schema that already has it. Reproduced on a
 *     scratch postgres:16: it dies on the first statement that collides, which is
 *     an enum rather than a table — `P3018 / 42710: type "UserRole" already
 *     exists` — and the baseline is recorded FAILED.
 *
 *  2. **A failed migration is permanent.** From then on every `migrate deploy`
 *     aborts with P3009 before touching anything, so the box can never be
 *     updated again — the client sees a database migration error on every
 *     single update, forever. That is the reported symptom.
 *
 *  3. **New accounts shipped as manual scripts.** backfill-1230 / backfill-1025 /
 *     backfill-6900 each had to be run by hand on every existing facility, and
 *     nothing in the update path ran them — so a box that migrated cleanly still
 *     failed at runtime on a missing account. syncChartOfAccounts covers every
 *     future account with no new script.
 *
 * Runs as the DB owner: only the compose `migrate` service holds those
 * credentials, the api runs as the least-privilege coldchain_app role (F-2a).
 */

const BASELINE = '20260101000000_baseline';
/** Serialises two deploy runs against one database. Session-scoped. */
const LOCK_KEY = 'coldchain:db:deploy';

const prisma = new PrismaClient();

function prismaCli(args: string): void {
  // Shell form so this works from a pnpm script on both Linux (the container)
  // and Windows (a developer running it locally).
  execSync(`pnpm exec prisma ${args}`, { stdio: 'inherit' });
}

async function tableExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<{ present: boolean }[]>(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    `public.${name}`,
  );
  return rows[0]?.present === true;
}

/**
 * Bring `_prisma_migrations` into a state `migrate deploy` can move forward from.
 * No-ops on a healthy or brand-new database.
 *
 * The baseline is handled BEFORE the generic failed-migration sweep, and never by
 * rolling it back and re-applying it: on a pre-rebaseline box its `CREATE TABLE`s
 * would only fail again. It is instead recorded as already applied, which is what
 * `phases/phase-13-production-deploy.md` prescribes doing by hand.
 */
async function repairMigrationHistory(): Promise<void> {
  if (!(await tableExists('facilities'))) {
    console.log('  fresh database — nothing to repair.');
    return;
  }

  // Schema present but Prisma has no history at all (the P3005 shape): adopt the
  // baseline rather than re-create tables that are already there.
  if (!(await tableExists('_prisma_migrations'))) {
    console.log(`  schema present, no migration history — adopting ${BASELINE}.`);
    prismaCli(`migrate resolve --applied ${BASELINE}`);
    return;
  }

  const rows = await prisma.$queryRawUnsafe<
    { migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]
  >(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at`,
  );

  // A box provisioned before the phase-13 rebaseline carries rows for migrations
  // that no longer exist in this image (0002_parties_chambers and friends). That is
  // the precise signal that its schema is already complete — as opposed to a fresh
  // box where the baseline simply failed part-way and must be retried.
  const localMigrations = new Set(
    readdirSync(join(__dirname, 'migrations'), { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name),
  );
  const preRebaseline = rows.some((r) => !localMigrations.has(r.migration_name));
  const baseline = rows.find((r) => r.migration_name === BASELINE);

  if (preRebaseline && !baseline) {
    console.log(`  pre-rebaseline database — recording ${BASELINE} as already applied.`);
    prismaCli(`migrate resolve --applied ${BASELINE}`);
  } else if (preRebaseline && baseline && !baseline.finished_at) {
    // The usual state of a box that has been failing to update: the baseline was
    // attempted against tables that already existed, hit 42P07, and has been
    // recorded FAILED ever since, blocking every later migration with P3009.
    // Marking the existing row finished is exactly what `resolve --applied` does,
    // and the row already carries the correct checksum. Done in SQL rather than
    // via two CLI calls (`--rolled-back` then `--applied`) so it does not depend
    // on how the CLI treats a re-resolve of the same migration name.
    console.log(`  ${BASELINE} recorded as failed against an existing schema — marking it applied.`);
    await prisma.$executeRawUnsafe(
      `UPDATE _prisma_migrations
          SET finished_at = now(), applied_steps_count = 1, logs = NULL, rolled_back_at = NULL
        WHERE migration_name = $1 AND finished_at IS NULL`,
      BASELINE,
    );
  }

  // Everything else that started and never finished. PostgreSQL applies each Prisma
  // migration in one transaction and none of ours contain a statement that cannot
  // run inside one (no CREATE INDEX CONCURRENTLY, and every ALTER TYPE ... ADD VALUE
  // sits alone in its own file — see migrations 0012, 0014, 0016, 0017), so a
  // failure left nothing half-applied and retrying it is safe.
  const stillFailed = rows.filter(
    (r) =>
      !r.finished_at &&
      !r.rolled_back_at &&
      !(r.migration_name === BASELINE && preRebaseline),
  );
  for (const row of stillFailed) {
    console.log(`  clearing failed migration ${row.migration_name} so it can be retried.`);
    prismaCli(`migrate resolve --rolled-back ${row.migration_name}`);
  }
}

async function main(): Promise<void> {
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_lock(hashtext($1))::text AS _lock`, LOCK_KEY);

  console.log('1/3 checking migration history...');
  await repairMigrationHistory();

  console.log('2/3 applying migrations...');
  prismaCli('migrate deploy');

  console.log('3/3 syncing chart of accounts...');
  let added = 0;
  for (const f of await prisma.facility.findMany({ select: { id: true, name: true } })) {
    const n = await syncChartOfAccounts(prisma, f.id);
    if (n) console.log(`  ${n} account(s) added to ${f.name}.`);
    added += n;
  }
  if (!added) console.log('  already up to date.');

  console.log('\nDatabase is ready for this release.');
}

main()
  .catch((e) => {
    console.error('\nDatabase update FAILED — the previous version is still running.\n');
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
