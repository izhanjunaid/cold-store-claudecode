import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  ClearOutwardRequestType,
  GatePassListQueryType,
  GatePassResponseType,
  LinkLotRequestType,
  LogInwardRequestType,
  LogOutwardRequestType,
} from '@coldchain/shared';
import {
  BUSINESS_TIME_ZONE,
  addDays,
  businessDate,
  businessDayStart,
  normalizePlate,
  round2,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { roleAtLeast } from '../../plugins/auth';
import { generateGatePassNumber } from './gate-pass-number';
import { GatePassRepository } from './gate-pass.repository';

/** What the gate needs to know about a withdrawal leaving on a truck. */
const releaseSelect = {
  id: true,
  dispatchNoteNumber: true,
  status: true,
  vehicleNumber: true,
  quantityWithdrawnBags: true,
  createdBy: true,
  createdAt: true,
  finalizedBy: true,
  voidedAt: true,
  gatePassId: true,
  invoice: { select: { id: true, status: true, totalPkr: true, amountPaidPkr: true } },
} satisfies Prisma.OutboundEventSelect;
type ReleaseOutbound = Prisma.OutboundEventGetPayload<{ select: typeof releaseSelect }>;

const dnOf = (o: { dispatchNoteNumber: string | null; id: string }) => o.dispatchNoteNumber ?? o.id.slice(0, 8);

export class GatePassService {
  constructor(
    private prisma: PrismaClient,
    private repo: GatePassRepository,
  ) {}

  async logInward(
    facilityId: string,
    userId: string,
    body: LogInwardRequestType,
  ): Promise<GatePassResponseType> {
    const created = await this.prisma.$transaction(async (tx) => {
      if (body.party_id) {
        const party = await tx.party.findFirst({
          where: { id: body.party_id, facilityId },
          select: { id: true },
        });
        if (!party) throw Errors.PARTY_NOT_FOUND();
      }
      const passNumber = await generateGatePassNumber(tx, facilityId, new Date());
      const row = await tx.gatePass.create({
        data: {
          facilityId,
          passNumber,
          direction: 'INWARD',
          vehicleNumber: body.vehicle_number,
          driverName: body.driver_name ?? null,
          driverPhone: body.driver_phone ?? null,
          biltyNumber: body.bilty_number ?? null,
          status: 'ARRIVED',
          partyId: body.party_id ?? null,
          declaredQuantity: body.declared_quantity ?? null,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });
      return row.id;
    });
    return this.getById(facilityId, created);
  }

  async logOutward(
    facilityId: string,
    userId: string,
    userRole: string,
    body: LogOutwardRequestType,
  ): Promise<GatePassResponseType> {
    return this.prisma.$transaction(async (tx) => {
      const passNumber = await generateGatePassNumber(tx, facilityId, new Date());
      const row = await tx.gatePass.create({
        data: {
          facilityId,
          passNumber,
          direction: 'OUTWARD',
          vehicleNumber: body.vehicle_number,
          driverName: body.driver_name ?? null,
          driverPhone: body.driver_phone ?? null,
          status: 'ARRIVED',
          relatedOutboundId: body.outbound_event_id ?? null,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });
      // Auto-clear outward in same call (truck arriving at exit gate) — through
      // exactly the same checks as clearing a logged pass.
      const cleared = await this.clearOutwardInternal(tx, facilityId, row.id, userId, userRole, {
        outbound_event_id: body.outbound_event_id,
        credit_authorization: body.credit_authorization,
        declared_quantity: body.declared_quantity,
        override_reason: body.override_reason,
        notes: body.notes,
      });
      return cleared;
    });
  }

  async linkLot(
    facilityId: string,
    passId: string,
    body: LinkLotRequestType,
  ): Promise<GatePassResponseType> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM gate_passes WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        passId,
        facilityId,
      );
      const pass = await tx.gatePass.findFirst({ where: { facilityId, id: passId } });
      if (!pass) throw Errors.GATE_PASS_NOT_FOUND();
      if (pass.direction !== 'INWARD') {
        throw Errors.GATE_PASS_INVALID_STATE('Only INWARD passes can be linked to a lot');
      }
      if (pass.status !== 'ARRIVED' && pass.status !== 'WEIGHING') {
        throw Errors.GATE_PASS_INVALID_STATE('Pass must be ARRIVED or WEIGHING to link a lot');
      }
      const lot = await tx.lot.findFirst({
        where: { facilityId, id: body.lot_id },
        select: { id: true, quantityBags: true },
      });
      if (!lot) throw Errors.GATE_PASS_LOT_MISMATCH();

      // Gate-side reconciliation: declared count at the gate vs actual binned quantity.
      const mismatch =
        pass.declaredQuantity != null && pass.declaredQuantity !== lot.quantityBags;

      await tx.gatePass.update({
        where: { id: passId },
        data: { relatedLotId: body.lot_id, status: 'WEIGHING', quantityMismatchFlag: mismatch },
      });
      return this.getByIdInternal(tx, facilityId, passId);
    });
  }

  async clearOutward(
    facilityId: string,
    passId: string,
    userId: string,
    userRole: string,
    body: ClearOutwardRequestType,
  ): Promise<GatePassResponseType> {
    return this.prisma.$transaction(async (tx) => {
      return this.clearOutwardInternal(tx, facilityId, passId, userId, userRole, body);
    });
  }

  async list(facilityId: string, query: GatePassListQueryType) {
    const where: Prisma.GatePassWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.direction) where.direction = query.direction;
    if (query.active) where.status = { in: ['ARRIVED', 'WEIGHING'] };
    if (query.vehicle_number) {
      where.vehicleNumber = { contains: query.vehicle_number.toUpperCase(), mode: 'insensitive' };
    }
    // Dates are the facility's calendar days, so "today" includes trucks logged
    // between midnight and 05:00 in Lahore (still yesterday in UTC).
    if (query.date_from || query.date_to) {
      where.createdAt = {};
      if (query.date_from) (where.createdAt as Prisma.DateTimeFilter).gte = businessDayStart(query.date_from);
      if (query.date_to) (where.createdAt as Prisma.DateTimeFilter).lt = businessDayStart(addDays(query.date_to, 1));
    }
    const [rows, total] = await this.repo.list(facilityId, where, query.page, query.page_size);
    return {
      data: rows.map((r) => formatGatePass(r)),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }

  async getById(facilityId: string, id: string): Promise<GatePassResponseType> {
    const row = await this.repo.findById(facilityId, id);
    if (!row) throw Errors.GATE_PASS_NOT_FOUND();
    return formatGatePass(row);
  }

  // ---------- internals ----------

  private async getByIdInternal(
    tx: Prisma.TransactionClient,
    facilityId: string,
    id: string,
  ): Promise<GatePassResponseType> {
    const row = await tx.gatePass.findFirst({
      where: { facilityId, id },
      include: {
        relatedLot: {
          select: {
            id: true,
            lotNumber: true,
            marka: true,
            commodity: { select: { name: true, unitLabel: true } },
          },
        },
        relatedOutbound: {
          select: {
            id: true,
            dispatchNoteNumber: true,
            quantityWithdrawnBags: true,
            invoice: { select: { id: true, totalPkr: true, amountPaidPkr: true, status: true } },
            lot: { select: { marka: true, commodity: { select: { name: true, unitLabel: true } } } },
            ownerPartySnapshot: { select: { name: true } },
          },
        },
        clearedOutbounds: {
          select: { id: true, quantityWithdrawnBags: true, dispatchNoteNumber: true },
          orderBy: { createdAt: 'asc' },
        },
        party: { select: { id: true, name: true } },
      },
    });
    if (!row) throw Errors.GATE_PASS_NOT_FOUND();
    return formatGatePass(row);
  }

  /**
   * Release a truck. Every withdrawal leaving on it must be dispatched, billed with
   * a final invoice and paid (pending cheques do not count) — or released on a
   * recorded MANAGER credit authorization — and the guard's blind bag count must
   * match. A withdrawal leaves on exactly one truck, and the person who booked or
   * dispatched it may not release it (MANAGER+ excepted). Checks run in this
   * order so the first failure is the one the guard can act on.
   */
  private async clearOutwardInternal(
    tx: Prisma.TransactionClient,
    facilityId: string,
    passId: string,
    userId: string,
    userRole: string,
    body: ClearOutwardRequestType,
  ): Promise<GatePassResponseType> {
    // 1. The pass.
    if (!(await lockRow(tx, 'gate_passes', passId, facilityId))) throw Errors.GATE_PASS_NOT_FOUND();
    const pass = await tx.gatePass.findFirst({ where: { facilityId, id: passId } });
    if (!pass) throw Errors.GATE_PASS_NOT_FOUND();
    if (pass.status === 'CLEARED' || pass.status === 'CANCELLED') {
      throw Errors.GATE_PASS_INVALID_STATE(`Pass is already ${pass.status}`);
    }
    const isManager = roleAtLeast(userRole, 'MANAGER');
    const overrideReason = body.override_reason?.trim() || null;
    if (overrideReason && !isManager) throw Errors.GATE_OVERRIDE_REQUIRES_MANAGER();
    let overrideUsed = false;
    const declared = body.declared_quantity ?? null;

    // 2. The withdrawals on this truck: the one named, or every dispatched
    //    withdrawal booked on this plate that has not left yet.
    let outbounds: ReleaseOutbound[];
    const explicitId = body.outbound_event_id ?? pass.relatedOutboundId ?? null;
    if (explicitId) {
      if (!(await lockRow(tx, 'outbound_events', explicitId, facilityId))) {
        throw Errors.GATE_OUTWARD_NO_OUTBOUND();
      }
      const ob = await tx.outboundEvent.findFirst({ where: { facilityId, id: explicitId }, select: releaseSelect });
      if (!ob) throw Errors.GATE_OUTWARD_NO_OUTBOUND();
      // 3. A named withdrawal must be ready to leave, unused, and booked on this truck.
      if (ob.status !== 'DISPATCHED' || ob.voidedAt) throw Errors.GATE_OUTWARD_NOT_DISPATCHED(dnOf(ob));
      if ((ob.gatePassId && ob.gatePassId !== pass.id) || (await this.clearedElsewhere(tx, ob.id, pass.id))) {
        throw Errors.GATE_OUTWARD_ALREADY_USED(dnOf(ob));
      }
      // No plate on the booking counts as a mismatch: otherwise leaving it blank
      // would be the way around this check.
      const plateMatches =
        ob.vehicleNumber != null && normalizePlate(ob.vehicleNumber) === normalizePlate(pass.vehicleNumber);
      if (!plateMatches) {
        if (!overrideReason) throw Errors.GATE_OUTWARD_PLATE_MISMATCH(dnOf(ob));
        overrideUsed = true;
      }
      outbounds = [ob];
    } else {
      outbounds = await this.matchByPlate(tx, facilityId, pass);
    }

    // 4. Nothing booked on this truck: an empty or delivery truck leaves freely,
    //    but a counted load that no withdrawal accounts for does not.
    if (outbounds.length === 0) {
      let unmatchedLoad = false;
      if (declared != null && declared > 0) {
        if (!overrideReason) throw Errors.GATE_OUTWARD_UNMATCHED_LOAD();
        overrideUsed = true;
        unmatchedLoad = true;
      }
      await tx.gatePass.update({
        where: { id: passId },
        data: {
          status: 'CLEARED',
          clearedAt: new Date(),
          clearedBy: userId,
          ...(declared != null ? { declaredQuantity: declared, quantityMismatchFlag: unmatchedLoad } : {}),
          ...(overrideUsed ? { overrideReason } : {}),
          notes: body.notes ?? pass.notes,
        },
      });
      return this.getByIdInternal(tx, facilityId, passId);
    }

    // 5. Whoever booked or dispatched a withdrawal does not also release it.
    if (!isManager && outbounds.some((o) => o.createdBy === userId || o.finalizedBy === userId)) {
      throw Errors.GATE_SELF_RELEASE();
    }

    // 6. Payment. A draft bill can still be edited, so nothing leaves on one —
    //    not even on credit. A cheque is credit until it clears. A voided bill can
    //    never be re-issued (one invoice per withdrawal), so the stock leaves on a
    //    recorded credit authorization rather than being stranded.
    const pending = await this.pendingChequeTotals(
      tx,
      outbounds.flatMap((o) => (o.invoice ? [o.invoice.id] : [])),
    );
    let outstanding = 0;
    let unbilled: string | null = null;
    let chequesPending = false;
    for (const o of outbounds) {
      const inv = o.invoice;
      if (inv?.status === 'DRAFT') throw Errors.GATE_OUTWARD_INVOICE_NOT_FINAL(dnOf(o));
      if (!inv || inv.status === 'VOID') {
        unbilled = unbilled ?? dnOf(o);
        continue;
      }
      const uncleared = pending.get(inv.id) ?? 0;
      if (uncleared > 0.005) chequesPending = true;
      outstanding += Math.max(0, Number(inv.totalPkr) - Number(inv.amountPaidPkr) + uncleared);
    }
    outstanding = round2(outstanding);
    const needsCredit = unbilled != null || outstanding > 0.01;
    if (needsCredit) {
      if (!body.credit_authorization) {
        throw Errors.GATE_OUTWARD_BLOCKED(
          unbilled != null
            ? `Withdrawal ${unbilled} has no valid bill — a manager must authorize this release on credit`
            : `Payment Pending — balance ${outstanding.toFixed(2)} PKR` +
                (chequesPending ? ' (includes cheques not yet cleared)' : ''),
        );
      }
      if (!isManager) throw Errors.GATE_CREDIT_AUTH_REQUIRES_MANAGER();
    }

    // 7. The guard's count, checked blind against what was dispatched.
    if (declared == null) throw Errors.GATE_OUTWARD_COUNT_REQUIRED();
    const authorized = outbounds.reduce((sum, o) => sum + o.quantityWithdrawnBags, 0);
    const countMismatch = declared !== authorized;
    if (countMismatch) {
      if (!overrideReason) throw Errors.GATE_OUTWARD_COUNT_MISMATCH();
      overrideUsed = true;
    }

    // 8. Record it. Attaching is conditional, so a withdrawal another truck took
    //    in the meantime fails here instead of leaving twice.
    const ids = outbounds.map((o) => o.id);
    const { count } = await tx.outboundEvent.updateMany({
      where: { id: { in: ids }, OR: [{ gatePassId: null }, { gatePassId: pass.id }] },
      data: { gatePassId: pass.id },
    });
    if (count !== ids.length) throw Errors.GATE_OUTWARD_ALREADY_USED(outbounds.map(dnOf).join(', '));

    const now = new Date();
    const first = [...outbounds].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
    await tx.gatePass.update({
      where: { id: passId },
      data: {
        status: 'CLEARED',
        clearedAt: now,
        clearedBy: userId,
        // Legacy single link, still written so an older release reads it.
        relatedOutboundId: explicitId ?? first.id,
        declaredQuantity: declared,
        quantityMismatchFlag: countMismatch,
        ...(needsCredit
          ? { creditAuthorizedBy: userId, creditAuthorizedAt: now, creditAuthorizedAmountPkr: outstanding }
          : {}),
        ...(overrideUsed ? { overrideReason } : {}),
        notes: body.notes ?? pass.notes,
      },
    });

    return this.getByIdInternal(tx, facilityId, passId);
  }

  /**
   * Every dispatched withdrawal booked on this truck's plate that has not left
   * yet, locked. Plates compare by letters and digits only. "Recent" is by
   * dispatch time — a withdrawal may be backdated, so its outbound date says
   * nothing about when it was loaded — from the earlier of the facility day the
   * truck arrived and yesterday.
   */
  private async matchByPlate(
    tx: Prisma.TransactionClient,
    facilityId: string,
    pass: { id: string; vehicleNumber: string; createdAt: Date },
  ): Promise<ReleaseOutbound[]> {
    const plate = normalizePlate(pass.vehicleNumber);
    if (!plate) return [];
    const arrived = businessDate(pass.createdAt);
    const yesterday = addDays(businessDate(), -1);
    const since = arrived < yesterday ? arrived : yesterday;
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
      `SELECT o.id FROM outbound_events o
        WHERE o.facility_id = $1::uuid
          AND o.status = 'DISPATCHED'
          AND o.voided_at IS NULL
          AND o.gate_pass_id IS NULL
          AND o.vehicle_number IS NOT NULL
          AND regexp_replace(upper(o.vehicle_number), '[^A-Z0-9]', '', 'g') = $2
          AND COALESCE(o.finalized_at, o.created_at) >= ($3::date::timestamp AT TIME ZONE $4)
          AND NOT EXISTS (
            SELECT 1 FROM gate_passes g
             WHERE g.related_outbound_id = o.id AND g.status = 'CLEARED' AND g.id <> $5::uuid)
        ORDER BY o.id
        FOR UPDATE OF o`,
      facilityId,
      plate,
      since,
      BUSINESS_TIME_ZONE,
      pass.id,
    );
    if (rows.length === 0) return [];
    return tx.outboundEvent.findMany({
      where: { facilityId, id: { in: rows.map((r) => r.id) } },
      select: releaseSelect,
      orderBy: { id: 'asc' },
    });
  }

  /** A pass other than this one already released the withdrawal (legacy single link). */
  private async clearedElsewhere(tx: Prisma.TransactionClient, outboundId: string, passId: string) {
    const n = await tx.gatePass.count({
      where: { relatedOutboundId: outboundId, status: 'CLEARED', id: { not: passId } },
    });
    return n > 0;
  }

  /** Per invoice: receipts allocated to it by cheques that have not cleared yet. */
  private async pendingChequeTotals(
    tx: Prisma.TransactionClient,
    invoiceIds: string[],
  ): Promise<Map<string, number>> {
    if (invoiceIds.length === 0) return new Map();
    const rows = await tx.paymentAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoiceIds }, voidedAt: null, payment: { clearanceStatus: 'PENDING' } },
      _sum: { allocatedAmountPkr: true },
    });
    return new Map(rows.map((r) => [r.invoiceId!, Number(r._sum.allocatedAmountPkr ?? 0)]));
  }
}

function formatLotLocation(
  lot:
    | { chamber?: { name: string } | null; rackPlacements?: { bags: number; rack: { name: string } }[] }
    | null
    | undefined,
): string | null {
  if (!lot?.chamber) return null;
  const parts = (lot.rackPlacements ?? []).map((p) => `${p.rack.name} ×${p.bags}`);
  return parts.length > 0 ? `${lot.chamber.name} → ${parts.join(', ')}` : lot.chamber.name;
}

function formatGatePass(row: any): GatePassResponseType {
  const created: Date = row.createdAt;
  const cleared: Date | null = row.clearedAt ?? null;
  const turnaround = cleared ? Math.round((cleared.getTime() - created.getTime()) / 1000) : null;
  const commodity = row.relatedLot?.commodity ?? row.relatedOutbound?.lot?.commodity ?? null;
  const marka = row.relatedLot?.marka ?? row.relatedOutbound?.lot?.marka ?? null;
  const location =
    formatLotLocation(row.relatedLot) ?? formatLotLocation(row.relatedOutbound?.lot);
  return {
    id: row.id,
    pass_number: row.passNumber,
    direction: row.direction,
    vehicle_number: row.vehicleNumber,
    driver_name: row.driverName,
    driver_phone: row.driverPhone,
    bilty_number: row.biltyNumber,
    status: row.status,
    related_lot_id: row.relatedLotId,
    related_lot_number: row.relatedLot?.lotNumber ?? null,
    related_outbound_id: row.relatedOutboundId,
    related_dispatch_note_number: row.relatedOutbound?.dispatchNoteNumber ?? null,
    related_commodity_name: commodity?.name ?? null,
    related_unit_label: commodity?.unitLabel ?? null,
    related_marka: marka,
    related_location: location,
    declared_quantity: row.declaredQuantity ?? null,
    authorized_quantity: authorizedQuantity(row),
    quantity_mismatch_flag: row.quantityMismatchFlag ?? false,
    party_id: row.partyId ?? null,
    party_name: row.party?.name ?? null,
    owner_party_name: row.relatedOutbound?.ownerPartySnapshot?.name ?? null,
    notes: row.notes,
    created_at: created.toISOString(),
    cleared_at: cleared ? cleared.toISOString() : null,
    turnaround_seconds: turnaround,
    created_by: row.createdBy,
    cleared_by: row.clearedBy ?? null,
    credit_authorized_by: row.creditAuthorizedBy ?? null,
    credit_authorized_at: row.creditAuthorizedAt ? row.creditAuthorizedAt.toISOString() : null,
    credit_authorized_amount_pkr:
      row.creditAuthorizedAmountPkr != null ? Number(row.creditAuthorizedAmountPkr) : null,
    override_reason: row.overrideReason ?? null,
    outbound_ids: (row.clearedOutbounds ?? []).map((o: { id: string }) => o.id),
  };
}

/** Bags authorized to leave: every withdrawal the truck carried, else the legacy single link. */
function authorizedQuantity(row: any): number | null {
  const carried: { quantityWithdrawnBags: number }[] = row.clearedOutbounds ?? [];
  if (carried.length > 0) return carried.reduce((sum, o) => sum + o.quantityWithdrawnBags, 0);
  return row.relatedOutbound?.quantityWithdrawnBags ?? null;
}
