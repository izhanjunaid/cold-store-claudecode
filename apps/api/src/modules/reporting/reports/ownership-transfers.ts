import type { PrismaClient, Prisma } from '@coldchain/db';

export interface OwnershipTransfersFilters {
  date_from?: string;
  date_to?: string;
  party_id?: string;
  page: number;
  per_page: number;
}

export interface OwnershipTransferRow {
  transfer_id: string;
  lot_id: string;
  lot_number: string;
  child_lot_id: string | null;
  child_lot_number: string | null;
  from_party_id: string | null;
  from_party_name: string | null;
  to_party_id: string;
  to_party_name: string;
  quantity_bags: number;
  transfer_price_pkr: number | null;
  transfer_date: string;
  type: 'FULL' | 'PARTIAL';
  operator_id: string;
  notes: string | null;
}

export async function getOwnershipTransfers(
  prisma: PrismaClient,
  facilityId: string,
  filters: OwnershipTransfersFilters,
) {
  const where: Prisma.OwnershipHistoryWhereInput = {
    eventType: 'TRANSFER_OUT',
    lot: { facilityId },
  };
  if (filters.date_from) {
    where.effectiveDate = { ...(where.effectiveDate as object), gte: new Date(filters.date_from) };
  }
  if (filters.date_to) {
    where.effectiveDate = { ...(where.effectiveDate as object), lte: new Date(filters.date_to) };
  }
  if (filters.party_id) {
    where.OR = [{ fromPartyId: filters.party_id }, { toPartyId: filters.party_id }];
  }

  const [rows, total] = await Promise.all([
    prisma.ownershipHistory.findMany({
      where,
      include: {
        lot: { select: { id: true, lotNumber: true } },
        fromParty: { select: { id: true, name: true } },
        toParty: { select: { id: true, name: true } },
      },
      orderBy: [{ effectiveDate: 'desc' }, { createdAt: 'desc' }],
      skip: (filters.page - 1) * filters.per_page,
      take: filters.per_page,
    }),
    prisma.ownershipHistory.count({ where }),
  ]);

  const parentLotIds = rows.map((r) => r.lotId);
  const childLots =
    parentLotIds.length > 0
      ? await prisma.lot.findMany({
          where: { parentLotId: { in: parentLotIds } },
          select: { id: true, lotNumber: true, parentLotId: true, createdAt: true },
        })
      : [];

  // Map: parentLotId -> array of child lots (oldest first; we'll pop by event order)
  const childrenByParent = new Map<string, Array<{ id: string; lotNumber: string; createdAt: Date }>>();
  for (const c of childLots) {
    if (!c.parentLotId) continue;
    if (!childrenByParent.has(c.parentLotId)) childrenByParent.set(c.parentLotId, []);
    childrenByParent.get(c.parentLotId)!.push({
      id: c.id,
      lotNumber: c.lotNumber,
      createdAt: c.createdAt,
    });
  }
  for (const arr of childrenByParent.values()) {
    arr.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  // Walk events oldest-first so we pair each PARTIAL TRANSFER_OUT with its first unassigned child.
  // Then reverse to deliver newest-first as requested by orderBy.
  const eventsOldestFirst = [...rows].reverse();
  const childByEvent = new Map<string, { id: string; lotNumber: string } | null>();
  const cursorByParent = new Map<string, number>();
  for (const ev of eventsOldestFirst) {
    const candidates = childrenByParent.get(ev.lotId) ?? [];
    const cursor = cursorByParent.get(ev.lotId) ?? 0;
    // Child lot must have been created on/after the event date — partial transfers create one.
    let chosen: { id: string; lotNumber: string } | null = null;
    for (let i = cursor; i < candidates.length; i++) {
      const c = candidates[i];
      if (c && c.createdAt.getTime() >= ev.effectiveDate.getTime()) {
        chosen = { id: c.id, lotNumber: c.lotNumber };
        cursorByParent.set(ev.lotId, i + 1);
        break;
      }
    }
    childByEvent.set(ev.id, chosen);
  }

  const data: OwnershipTransferRow[] = rows.map((r) => {
    const child = childByEvent.get(r.id) ?? null;
    return {
      transfer_id: r.id,
      lot_id: r.lotId,
      lot_number: r.lot.lotNumber,
      child_lot_id: child?.id ?? null,
      child_lot_number: child?.lotNumber ?? null,
      from_party_id: r.fromPartyId,
      from_party_name: r.fromParty?.name ?? null,
      to_party_id: r.toPartyId,
      to_party_name: r.toParty.name,
      quantity_bags: r.quantityBags,
      transfer_price_pkr: r.transferPricePkr ? Number(r.transferPricePkr) : null,
      transfer_date: r.effectiveDate.toISOString().slice(0, 10),
      type: child ? 'PARTIAL' : 'FULL',
      operator_id: r.operatorId,
      notes: r.notes,
    };
  });

  return {
    data,
    meta: { total, page: filters.page, per_page: filters.per_page },
  };
}
