import type { Prisma } from '@coldchain/db';

/** A withdrawal holds its bags from booking until it is dispatched or cancelled. */
export const OPEN_OUTBOUND_STATUSES = ['PENDING', 'WEIGHED', 'DISPUTED'] as const;

/**
 * What may be dispatched: a booked withdrawal, weighed or not, because weight is optional (docs/27).
 * DISPUTED, which nothing sets any more, waits. Every "may this go out" check uses this, the solo
 * door's included, so a booked line meets the same rules a weighed one does.
 */
export const READY_TO_DISPATCH = ['PENDING', 'WEIGHED'] as const;
export const isReadyToDispatch = (status: string): boolean => (READY_TO_DISPATCH as readonly string[]).includes(status);

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
