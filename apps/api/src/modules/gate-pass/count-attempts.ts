import type { PrismaClient, Prisma } from '@coldchain/db';
import { GATE_COUNT_TRIES } from '@coldchain/shared';
import type { AppError } from '../../common/errors';

/**
 * Wrong bag counts on this plate since its last release (docs/28 D4). Per truck, not per pass:
 * logging the same truck in again must not hand a guard fresh tries. `plate` is the normalized
 * plate. A pass stores its plate as typed, so passes compare through the same letters-and-digits
 * expression the withdrawal queries use; the newest `cleared_at` among them is the last release.
 */
export async function triesUsed(tx: Prisma.TransactionClient, facilityId: string, plate: string): Promise<number> {
  if (!plate) return 0;
  const rows = await tx.$queryRawUnsafe<{ n: number }[]>(
    `SELECT count(*)::int AS n
       FROM gate_count_attempts a
      WHERE a.facility_id = $1::uuid
        AND a.plate = $2::text
        AND a.created_at > COALESCE(
              (SELECT max(g.cleared_at) FROM gate_passes g
                WHERE g.facility_id = $1::uuid
                  AND g.status = 'CLEARED'
                  AND regexp_replace(upper(g.vehicle_number), '[^A-Z0-9]', '', 'g') = $2::text),
              '-infinity'::timestamptz)`,
    facilityId,
    plate,
  );
  return rows[0]?.n ?? 0;
}

/**
 * Which of these plates (normalized) have used up their tries since their last release: the same rule
 * as `triesUsed`, in one query for the gate's list.
 */
export async function lockedPlates(db: PrismaClient | Prisma.TransactionClient, facilityId: string, plates: string[]): Promise<string[]> {
  if (plates.length === 0) return [];
  const rows = await db.$queryRawUnsafe<{ plate: string }[]>(
    `SELECT a.plate
       FROM gate_count_attempts a
      WHERE a.facility_id = $1::uuid
        AND a.plate = ANY($2::text[])
        AND a.created_at > COALESCE(
              (SELECT max(g.cleared_at) FROM gate_passes g
                WHERE g.facility_id = $1::uuid
                  AND g.status = 'CLEARED'
                  AND regexp_replace(upper(g.vehicle_number), '[^A-Z0-9]', '', 'g') = a.plate),
              '-infinity'::timestamptz)
      GROUP BY a.plate
     HAVING count(*) >= $3::int`,
    facilityId,
    plates,
    GATE_COUNT_TRIES,
  );
  return rows.map((r) => r.plate);
}

/** One saved wrong count, with the counter's name, for the manager's list. */
export type CountAttempt = { declaredQuantity: number; expectedQuantity: number; createdAt: Date; countedBy: { name: string } | null };

/**
 * The wrong counts each of these plates (normalized) holds since its last release: exactly the ones the
 * lock counts (`triesUsed`, `lockedPlates`), so what a manager reads is what locked the truck. Oldest
 * first. Per truck, not per pass: a truck logged in again lists the counts of its earlier passes too.
 */
export async function attemptsByPlate(
  db: PrismaClient | Prisma.TransactionClient,
  facilityId: string,
  plates: string[],
): Promise<Map<string, CountAttempt[]>> {
  const byPlate = new Map<string, CountAttempt[]>();
  const wanted = [...new Set(plates.filter(Boolean))];
  if (wanted.length === 0) return byPlate;
  // No join to `users` here: it is row-level-secured by the request's facility, and a raw query on the plain client
  // runs without that setting (the facility-scope extension stamps it for model operations and interactive
  // transactions only). The counters are named by a model query below instead.
  const rows = await db.$queryRawUnsafe<
    { plate: string; declared: number; expected: number; created_at: Date; created_by: string }[]
  >(
    `SELECT a.plate, a.declared_quantity::int AS declared, a.expected_quantity::int AS expected,
            a.created_at, a.created_by
       FROM gate_count_attempts a
      WHERE a.facility_id = $1::uuid
        AND a.plate = ANY($2::text[])
        AND a.created_at > COALESCE(
              (SELECT max(g.cleared_at) FROM gate_passes g
                WHERE g.facility_id = $1::uuid
                  AND g.status = 'CLEARED'
                  AND regexp_replace(upper(g.vehicle_number), '[^A-Z0-9]', '', 'g') = a.plate),
              '-infinity'::timestamptz)
      ORDER BY a.created_at ASC`,
    facilityId,
    wanted,
  );
  if (rows.length === 0) return byPlate;
  const names = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.created_by))] } }, select: { id: true, name: true } })).map(
      (u) => [u.id, u.name] as const,
    ),
  );
  for (const r of rows) {
    const list = byPlate.get(r.plate) ?? [];
    const name = names.get(r.created_by);
    list.push({
      declaredQuantity: r.declared,
      expectedQuantity: r.expected,
      createdAt: r.created_at,
      countedBy: name ? { name } : null,
    });
    byPlate.set(r.plate, list);
  }
  return byPlate;
}

/**
 * Save one wrong count. `createdAt` is the app clock, like the release's `cleared_at`, not the
 * transaction's start (`now()`): a miss that waited on the plate's lock behind a release must sort
 * after it, or the next visit would start with the old tries.
 */
export async function recordMiss(
  tx: Prisma.TransactionClient,
  miss: { facilityId: string; passId: string; plate: string; declared: number; expected: number; userId: string },
): Promise<void> {
  await tx.gateCountAttempt.create({
    data: {
      facilityId: miss.facilityId,
      gatePassId: miss.passId,
      plate: miss.plate,
      declaredQuantity: miss.declared,
      expectedQuantity: miss.expected,
      createdBy: miss.userId,
      createdAt: new Date(),
    },
  });
}

/** A refusal that must outlive its transaction: what was written before it (the miss) commits. */
export class KeptRefusal extends Error {
  constructor(readonly refusal: AppError) {
    super(refusal.message);
    this.name = 'KeptRefusal';
  }
}

/**
 * Run `fn` in a transaction. A `KeptRefusal` thrown inside commits everything written so far — the
 * wrong count it records — then the wrapped error is thrown to the caller. Any other error rolls back
 * as before.
 */
export async function withKeptRefusals<T>(
  prisma: PrismaClient,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  let refusal = null as AppError | null;
  const result = await prisma.$transaction(async (tx) => {
    try {
      return await fn(tx);
    } catch (e) {
      if (!(e instanceof KeptRefusal)) throw e;
      refusal = e.refusal;
      return undefined as T;
    }
  });
  if (refusal) throw refusal;
  return result;
}
