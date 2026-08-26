import type { FastifyInstance } from 'fastify';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { sendSuccess } from '../../common/response';

/**
 * What this box is running, and whether its last update actually finished.
 *
 * The second half is the point. A client box failed to migrate on *every*
 * update for months and nothing on screen said so (phase 26: a pre-rebaseline
 * history produced 42P07, then P3009 forever). The app kept serving the old
 * schema quite happily. So this endpoint does not merely print a version
 * string — it compares the migrations baked into this image against the ones
 * the database has actually applied, which is a claim the box can prove about
 * itself without reaching the network.
 */

// Baked in at image build time (see apps/api/Dockerfile + release.yml). Absent
// in dev and in the test suite, where 'dev' is the honest answer.
const VERSION = process.env['COLDCHAIN_VERSION'] || 'dev';
const COMMIT = process.env['COLDCHAIN_COMMIT'] || null;
const BUILT_AT = process.env['COLDCHAIN_BUILT_AT'] || null;

// The API process start. On a facility box the container is recreated by
// update.ps1, so this is when the running version was put in place.
const STARTED_AT = new Date().toISOString();

/**
 * Migration directories shipped inside this image. The runtime image carries the
 * whole workspace (`COPY --from=build /app /app`), so they are on disk next to
 * the compiled server. Returns null rather than throwing if the layout ever
 * changes — an unknown count must not take the settings page down.
 */
function migrationsInImage(): string[] | null {
  for (const candidate of [
    join(process.cwd(), '../../packages/db/prisma/migrations'),
    join(process.cwd(), 'packages/db/prisma/migrations'),
  ]) {
    try {
      return readdirSync(candidate, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

export async function systemRoutes(app: FastifyInstance) {
  app.route({
    method: 'GET',
    url: '/v1/system/version',
    preHandler: [app.authenticate, app.requirePermission('settings.manage')],
    handler: async (_request, reply) => {
      const shipped = migrationsInImage();

      // _prisma_migrations is not a Prisma model, so this is raw. It is also the
      // one query here that can fail for a reason that has nothing to do with
      // the caller: the runtime role is least-privilege (F-2a), and a box whose
      // grants predate a change might not be able to read it. A version panel
      // that 500s is worse than one that says "unknown", so this degrades.
      let applied: { name: string; finished_at: Date | null }[] | null = null;
      try {
        applied = await app.prisma.$queryRawUnsafe<{ name: string; finished_at: Date | null }[]>(
          `SELECT migration_name AS name, finished_at
             FROM _prisma_migrations
            WHERE finished_at IS NOT NULL
            ORDER BY finished_at ASC`,
        );
      } catch (err) {
        app.log.warn({ err }, 'version: could not read _prisma_migrations');
      }

      const appliedNames = applied?.map((m) => m.name) ?? null;
      const pending =
        shipped && appliedNames ? shipped.filter((m) => !appliedNames.includes(m)) : null;

      return sendSuccess(reply, {
        version: VERSION,
        commit: COMMIT,
        built_at: BUILT_AT,
        started_at: STARTED_AT,
        database: {
          migrations_in_image: shipped?.length ?? null,
          migrations_applied: appliedNames?.length ?? null,
          latest_migration: appliedNames?.length ? appliedNames[appliedNames.length - 1] : null,
          latest_applied_at: applied?.length
            ? (applied[applied.length - 1]?.finished_at?.toISOString() ?? null)
            : null,
          // null = could not be determined, [] = nothing pending. The web
          // distinguishes the two: "unknown" is not the same as "fine".
          pending_migrations: pending,
        },
      });
    },
  });
}
