import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  ClearOutwardRequestType,
  GatePassListQueryType,
  GatePassResponseType,
  LinkLotRequestType,
  LogInwardRequestType,
  LogOutwardRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { generateGatePassNumber } from './gate-pass-number';
import { GatePassRepository } from './gate-pass.repository';

const ROLE_RANK: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

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
    body: LogOutwardRequestType & { credit_authorization?: boolean },
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
      // Auto-clear outward in same call (truck arriving at exit gate)
      const cleared = await this.clearOutwardInternal(tx, facilityId, row.id, userRole, {
        outbound_event_id: body.outbound_event_id,
        credit_authorization: body.credit_authorization,
        declared_quantity: body.declared_quantity,
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
    userRole: string,
    body: ClearOutwardRequestType,
  ): Promise<GatePassResponseType> {
    return this.prisma.$transaction(async (tx) => {
      return this.clearOutwardInternal(tx, facilityId, passId, userRole, body);
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
    if (query.date_from || query.date_to) {
      where.createdAt = {};
      if (query.date_from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(query.date_from);
      if (query.date_to) {
        const to = new Date(query.date_to);
        to.setUTCHours(23, 59, 59, 999);
        (where.createdAt as Prisma.DateTimeFilter).lte = to;
      }
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
        party: { select: { id: true, name: true } },
      },
    });
    if (!row) throw Errors.GATE_PASS_NOT_FOUND();
    return formatGatePass(row);
  }

  private async clearOutwardInternal(
    tx: Prisma.TransactionClient,
    facilityId: string,
    passId: string,
    userRole: string,
    body: ClearOutwardRequestType,
  ): Promise<GatePassResponseType> {
    await tx.$queryRawUnsafe(
      `SELECT id FROM gate_passes WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
      passId,
      facilityId,
    );
    const pass = await tx.gatePass.findFirst({
      where: { facilityId, id: passId },
      include: {
        relatedOutbound: {
          select: {
            id: true,
            dispatchNoteNumber: true,
            status: true,
            vehicleNumber: true,
            quantityWithdrawnBags: true,
            invoice: {
              select: { id: true, status: true, totalPkr: true, amountPaidPkr: true },
            },
          },
        },
      },
    });
    if (!pass) throw Errors.GATE_PASS_NOT_FOUND();
    if (pass.status === 'CLEARED' || pass.status === 'CANCELLED') {
      throw Errors.GATE_PASS_INVALID_STATE(`Pass is already ${pass.status}`);
    }

    // Resolve outbound link (use body.outbound_event_id if provided, else existing)
    let outboundId = body.outbound_event_id ?? pass.relatedOutboundId ?? null;
    let outbound = pass.relatedOutbound ?? null;
    if (body.outbound_event_id && body.outbound_event_id !== pass.relatedOutboundId) {
      outbound = await tx.outboundEvent.findFirst({
        where: { facilityId, id: body.outbound_event_id },
        select: {
          id: true,
          dispatchNoteNumber: true,
          status: true,
          vehicleNumber: true,
          quantityWithdrawnBags: true,
          invoice: { select: { id: true, status: true, totalPkr: true, amountPaidPkr: true } },
        },
      });
      if (!outbound) throw Errors.GATE_OUTWARD_NO_OUTBOUND();
      outboundId = outbound.id;
    }

    // Auto-match by vehicle number if no link yet
    if (!outboundId) {
      const today = new Date();
      const dayStart = new Date(today);
      dayStart.setUTCHours(0, 0, 0, 0);
      const candidate = await tx.outboundEvent.findFirst({
        where: {
          facilityId,
          vehicleNumber: pass.vehicleNumber,
          status: 'DISPATCHED',
          createdAt: { gte: dayStart },
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          dispatchNoteNumber: true,
          status: true,
          vehicleNumber: true,
          quantityWithdrawnBags: true,
          invoice: { select: { id: true, status: true, totalPkr: true, amountPaidPkr: true } },
        },
      });
      if (candidate) {
        outbound = candidate;
        outboundId = candidate.id;
      }
    }

    // Validate invoice paid OR credit_authorization (MANAGER+)
    if (outbound) {
      const inv = outbound.invoice;
      if (!inv) {
        if (!body.credit_authorization) {
          throw Errors.GATE_OUTWARD_BLOCKED(
            'Outbound has no finalized invoice yet — settle billing first',
          );
        }
        if ((ROLE_RANK[userRole] ?? 0) < ROLE_RANK['MANAGER']!) {
          throw Errors.GATE_CREDIT_AUTH_REQUIRES_MANAGER();
        }
      } else {
        const balanceDue = Number(inv.totalPkr) - Number(inv.amountPaidPkr);
        const isPaid = balanceDue <= 0.01;
        if (!isPaid) {
          if (!body.credit_authorization) {
            throw Errors.GATE_OUTWARD_BLOCKED(
              `Payment Pending — invoice balance ${balanceDue.toFixed(2)} PKR`,
            );
          }
          if ((ROLE_RANK[userRole] ?? 0) < ROLE_RANK['MANAGER']!) {
            throw Errors.GATE_CREDIT_AUTH_REQUIRES_MANAGER();
          }
        }
      }
    }

    // Gate-side reconciliation: physically-counted bags/crates vs the authorized
    // quantity on the linked outbound. A divergence raises the mismatch flag.
    const authorizedQty = outbound?.quantityWithdrawnBags ?? null;
    const declaredQty = body.declared_quantity ?? null;
    const outwardMismatch =
      declaredQty != null && authorizedQty != null && declaredQty !== authorizedQty;

    await tx.gatePass.update({
      where: { id: passId },
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        relatedOutboundId: outboundId,
        ...(declaredQty != null
          ? { declaredQuantity: declaredQty, quantityMismatchFlag: outwardMismatch }
          : {}),
        notes: body.notes ?? pass.notes,
      },
    });

    return this.getByIdInternal(tx, facilityId, passId);
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
    authorized_quantity: row.relatedOutbound?.quantityWithdrawnBags ?? null,
    quantity_mismatch_flag: row.quantityMismatchFlag ?? false,
    party_id: row.partyId ?? null,
    party_name: row.party?.name ?? null,
    owner_party_name: row.relatedOutbound?.ownerPartySnapshot?.name ?? null,
    notes: row.notes,
    created_at: created.toISOString(),
    cleared_at: cleared ? cleared.toISOString() : null,
    turnaround_seconds: turnaround,
    created_by: row.createdBy,
  };
}
