import type { PrismaClient, Prisma } from '@coldchain/db';
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
 * wrong count it records, and on the one-step route the pass — then the wrapped error is thrown to
 * the caller. Any other error rolls back as before.
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
