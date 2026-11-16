import type { Prisma, PrismaClient } from '@coldchain/db';
import { round2 } from '@coldchain/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * How full each room is, in the units its capacity is counted in (docs/32 section 2.4).
 *
 * Goods are counted in their own unit (bags, crates), and one unit of one kind does not
 * take the room of one unit of another. Each kind of goods carries a space factor: the
 * room one of its units takes, measured in the room's capacity units. A room's load is
 * the sum of units x factor over its ACTIVE lots. With every factor at 1 (the default)
 * this is the plain count it always was.
 *
 * The one place room occupancy is added up: the inbound capacity check, the room move,
 * the rooms screen and the dashboard all read it, so they cannot disagree.
 */
export async function roomLoads(db: Db, chamberIds: string[]): Promise<Map<string, number>> {
  const loads = new Map<string, number>(chamberIds.map((id) => [id, 0]));
  if (chamberIds.length === 0) return loads;
  const rows = await db.$queryRaw<{ chamber_id: string; load: unknown }[]>`
    SELECT l.chamber_id, SUM(l.current_balance_bags * c.space_factor) AS load
    FROM lots l
    JOIN commodities c ON c.id = l.commodity_id
    WHERE l.status = 'ACTIVE' AND l.chamber_id = ANY(${chamberIds}::uuid[])
    GROUP BY l.chamber_id
  `;
  for (const r of rows) loads.set(r.chamber_id, round2(Number(r.load)));
  return loads;
}

/** The room `units` of goods with this space factor take. */
export function spaceTaken(units: number, spaceFactor: { toString(): string } | number): number {
  return round2(units * Number(spaceFactor));
}
