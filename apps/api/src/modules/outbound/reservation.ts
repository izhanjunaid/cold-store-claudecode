import type { Prisma } from '@coldchain/db';

/** A withdrawal holds its bags from booking until it is dispatched or cancelled. */
export const OPEN_OUTBOUND_STATUSES = ['PENDING', 'WEIGHED', 'DISPUTED'] as const;

/**
 * Bags of a lot already booked on withdrawals that have not left yet, and their
 * dispatch-note numbers (for the error message). A plain read: the caller holds the
 * lot's row lock, and every booking takes that lock first, so no booking can slip in
 * between this read and the caller's write. Never `FOR UPDATE` on outbound_events
 * here — finalize locks the withdrawal and then the lot, and the reverse order here
 * could deadlock.
 */
export async function openReservation(
  tx: Prisma.TransactionClient,
  facilityId: string,
  lotId: string,
): Promise<{ bags: number; dispatchNotes: string[] }> {
  const open = await tx.outboundEvent.findMany({
    where: { facilityId, lotId, status: { in: [...OPEN_OUTBOUND_STATUSES] } },
    select: { quantityWithdrawnBags: true, dispatchNoteNumber: true, id: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    bags: open.reduce((sum, o) => sum + o.quantityWithdrawnBags, 0),
    dispatchNotes: open.map((o) => o.dispatchNoteNumber ?? o.id.slice(0, 8)),
  };
}
