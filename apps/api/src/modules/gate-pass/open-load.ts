import type { PrismaClient, Prisma } from '@coldchain/db';
import { normalizePlate } from '@coldchain/shared';

type Db = PrismaClient | Prisma.TransactionClient;

/** What the gate preview and the dispatch desk read about each line on a truck. */
export const openLoadSelect = {
  id: true,
  dispatchNoteNumber: true,
  status: true,
  vehicleNumber: true,
  quantityWithdrawnBags: true,
  outboundWeightKg: true,
  outboundDate: true,
  createdAt: true,
  createdBy: true,
  finalizedAt: true,
  finalizedBy: true,
  lot: {
    select: {
      id: true,
      lotNumber: true,
      marka: true,
      bookType: true,
      billingParty: { select: { id: true, name: true } },
    },
  },
  ownerPartySnapshot: { select: { name: true } },
  invoice: {
    select: { id: true, invoiceNumber: true, status: true, totalPkr: true, amountPaidPkr: true, billingPartyId: true },
  },
} satisfies Prisma.OutboundEventSelect;

export type OpenLoadLine = Prisma.OutboundEventGetPayload<{ select: typeof openLoadSelect }>;

/**
 * What is on each truck that has not left yet, by normalized plate (letters and digits only):
 * every withdrawal booked, weighed, disputed or dispatched on that plate, not cancelled, not
 * stamped by a pass (`gate_pass_id`), and not released by a pass under the legacy single link.
 * A withdrawal dispatched before the Phase 0 rules (no `finalized_at`) may already have left
 * untracked, so it is on no truck. The gate's Ready-to-leave preview and the dispatch desk read
 * a truck through this one helper, so they cannot disagree about its lines; the release itself
 * (`matchByPlate`) takes the dispatched ones under the same rules, locked.
 *
 * The plate test and the legacy rule run in SQL, so a poll reads only the trucks it asks about.
 */
export async function openLoads(db: Db, facilityId: string, plates: string[]): Promise<Map<string, OpenLoadLine[]>> {
  const wanted = [...new Set(plates.map(normalizePlate).filter(Boolean))];
  const result = new Map<string, OpenLoadLine[]>();
  if (wanted.length === 0) return result;

  const rows = await db.$queryRawUnsafe<{ id: string }[]>(
    `SELECT o.id FROM outbound_events o
      WHERE o.facility_id = $1::uuid
        AND o.status IN ('PENDING', 'WEIGHED', 'DISPUTED', 'DISPATCHED')
        AND o.voided_at IS NULL
        AND o.gate_pass_id IS NULL
        AND o.vehicle_number IS NOT NULL
        AND NOT (o.status = 'DISPATCHED' AND o.finalized_at IS NULL)
        AND regexp_replace(upper(o.vehicle_number), '[^A-Z0-9]', '', 'g') = ANY($2::text[])
        AND NOT EXISTS (
          SELECT 1 FROM gate_passes g WHERE g.related_outbound_id = o.id AND g.status = 'CLEARED')`,
    facilityId,
    wanted,
  );
  if (rows.length === 0) return result;

  const lines = await db.outboundEvent.findMany({
    where: { facilityId, id: { in: rows.map((r) => r.id) } },
    select: openLoadSelect,
    orderBy: { createdAt: 'asc' },
  });
  for (const line of lines) {
    const plate = normalizePlate(line.vehicleNumber ?? '');
    result.set(plate, [...(result.get(plate) ?? []), line]);
  }
  return result;
}
