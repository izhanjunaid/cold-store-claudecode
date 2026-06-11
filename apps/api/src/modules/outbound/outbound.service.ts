import type { PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { OutboundRepository, type OutboundWithRelations } from './outbound.repository';
import { generateDispatchNoteNumber } from './dispatch-note-number';
import { renderDispatchNote } from '../pdf/pdf.service';
import { buildInvoiceFromOutbound } from '../invoice/invoice.builder';
import { roleAtLeast } from '../../plugins/auth';
import { resolveFacilitySettings } from '../facility/facility.service';

function toNumber(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  return Number(d);
}

function computeVariance(
  acceptedWeightKg: { toString(): string },
  quantityBags: number,
  quantityWithdrawnBags: number,
  outboundWeightKg: { toString(): string } | null,
): { proratedInboundWeightKg: number | null; weightVariancePct: number | null } {
  if (quantityBags === 0 || outboundWeightKg == null) {
    return { proratedInboundWeightKg: null, weightVariancePct: null };
  }
  const prorated = Number(acceptedWeightKg) * (quantityWithdrawnBags / quantityBags);
  const outbound = Number(outboundWeightKg);
  const variance = prorated !== 0 ? ((prorated - outbound) / prorated) * 100 : null;
  return {
    proratedInboundWeightKg: Math.round(prorated * 100) / 100,
    weightVariancePct: variance !== null ? Math.round(variance * 100) / 100 : null,
  };
}

function formatOutbound(ob: OutboundWithRelations, invoiceId: string | null = null) {
  const { proratedInboundWeightKg, weightVariancePct } = computeVariance(
    ob.lot.acceptedWeightKg,
    ob.lot.quantityBags,
    ob.quantityWithdrawnBags,
    ob.outboundWeightKg,
  );
  return {
    id: ob.id,
    lot_id: ob.lotId,
    lot_number: ob.lot.lotNumber,
    facility_id: ob.facilityId,
    withdrawal_type: ob.withdrawalType,
    quantity_withdrawn_bags: ob.quantityWithdrawnBags,
    outbound_weight_kg: toNumber(ob.outboundWeightKg),
    outbound_date: ob.outboundDate.toISOString().slice(0, 10),
    receiving_party_id: ob.receivingPartyId,
    receiving_party_name: ob.receivingParty?.name ?? null,
    owner_party_id_snapshot: ob.ownerPartyIdSnapshot ?? null,
    owner_party_name: ob.ownerPartySnapshot?.name ?? null,
    vehicle_number: ob.vehicleNumber,
    dispatch_note_number: ob.dispatchNoteNumber,
    status: ob.status,
    notes: ob.notes,
    prorated_inbound_weight_kg: proratedInboundWeightKg,
    weight_variance_pct: weightVariancePct,
    invoice_id: invoiceId,
    created_at: ob.createdAt.toISOString(),
    created_by_name: ob.createdByUser.name,
  };
}

export class OutboundService {
  constructor(
    private prisma: PrismaClient,
    private repo: OutboundRepository,
  ) {}

  async create(params: {
    facilityId: string;
    createdBy: string;
    userRole?: string;
    lotId: string;
    withdrawalType: string;
    quantityWithdrawnBags: number;
    outboundDate: string;
    receivingPartyId?: string;
    thirdPartyRelease?: boolean;
    vehicleNumber?: string;
    notes?: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Row-lock the lot for the duration of this transaction
      const lots = await tx.$queryRawUnsafe<
        {
          id: string;
          status: string;
          current_balance_bags: number;
          owner_party_id: string;
        }[]
      >(
        `SELECT id, status, current_balance_bags, owner_party_id FROM lots WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        params.lotId,
        params.facilityId,
      );
      const lot = lots[0];
      if (!lot) throw Errors.LOT_NOT_FOUND();
      if (lot.status !== 'ACTIVE') throw Errors.LOT_NOT_ACTIVE();

      const balance = lot.current_balance_bags;

      if (params.withdrawalType === 'FULL') {
        if (params.quantityWithdrawnBags !== balance) {
          throw Errors.VALIDATION_ERROR(
            `FULL withdrawal requires quantity equal to lot balance (${balance})`,
            'quantity_withdrawn_bags',
          );
        }
      } else {
        if (params.quantityWithdrawnBags >= balance) {
          throw Errors.LOT_BALANCE_INSUFFICIENT(balance, params.quantityWithdrawnBags);
        }
      }

      if (params.receivingPartyId) {
        const party = await tx.party.findFirst({
          where: { id: params.receivingPartyId, facilityId: params.facilityId },
        });
        if (!party) throw Errors.PARTY_NOT_FOUND();
      }

      // Current-owner authorization: goods leave for the lot's CURRENT owner
      // (kept current through M3 transfers). Releasing to anyone else is a
      // deliberate third-party release that a MANAGER+ must authorize.
      if (params.receivingPartyId && params.receivingPartyId !== lot.owner_party_id) {
        if (!params.thirdPartyRelease) throw Errors.OUTBOUND_OWNER_MISMATCH();
        if (!roleAtLeast(params.userRole, 'MANAGER')) {
          throw Errors.OUTBOUND_THIRD_PARTY_REQUIRES_MANAGER();
        }
      }

      const outboundDate = new Date(params.outboundDate);

      // Backdating guard: OPERATOR-level users may only backdate within the
      // configured window; MANAGER+ may exceed it.
      const facility = await tx.facility.findUnique({
        where: { id: params.facilityId },
      });
      const settings = resolveFacilitySettings(facility?.settings ?? null);
      const maxBackdateDays = settings.backdating_max_days;
      if (maxBackdateDays !== null && !roleAtLeast(params.userRole, 'MANAGER')) {
        const earliest = new Date();
        earliest.setHours(0, 0, 0, 0);
        earliest.setDate(earliest.getDate() - maxBackdateDays);
        if (outboundDate < earliest) {
          throw Errors.BACKDATING_LIMIT_EXCEEDED(maxBackdateDays);
        }
      }
      const dispatchNoteNumber = await generateDispatchNoteNumber(
        tx,
        params.facilityId,
        outboundDate,
      );

      const ob = await this.repo.create(tx, {
        lotId: params.lotId,
        facilityId: params.facilityId,
        withdrawalType: params.withdrawalType as 'FULL' | 'PARTIAL',
        quantityWithdrawnBags: params.quantityWithdrawnBags,
        outboundDate,
        receivingPartyId: params.receivingPartyId ?? null,
        ownerPartyIdSnapshot: lot.owner_party_id,
        vehicleNumber: params.vehicleNumber ?? null,
        dispatchNoteNumber,
        status: 'PENDING',
        notes: params.notes ?? null,
        createdBy: params.createdBy,
      });

      return formatOutbound(ob);
    });
  }

  async getById(facilityId: string, id: string) {
    const ob = await this.repo.findById(facilityId, id);
    if (!ob) throw Errors.OUTBOUND_NOT_FOUND();
    const invoice = await this.prisma.invoice.findFirst({
      where: { outboundEventId: id },
      select: { id: true },
    });
    return formatOutbound(ob, invoice?.id ?? null);
  }

  async recordWeight(facilityId: string, id: string, outboundWeightKg: number) {
    const ob = await this.repo.findById(facilityId, id);
    if (!ob) throw Errors.OUTBOUND_NOT_FOUND();
    if (ob.status === 'DISPATCHED' || ob.status === 'CANCELLED') {
      throw Errors.OUTBOUND_ALREADY_FINALIZED();
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        outboundWeightKg: outboundWeightKg,
        status: 'WEIGHED',
      });
      return formatOutbound(updated);
    });
  }

  async finalize(facilityId: string, id: string, notes?: string) {
    return this.prisma.$transaction(async (tx) => {
      const ob = await tx.outboundEvent.findFirst({
        where: { id, facilityId },
        include: { lot: true },
      });
      if (!ob) throw Errors.OUTBOUND_NOT_FOUND();
      if (ob.status === 'DISPATCHED') throw Errors.OUTBOUND_ALREADY_FINALIZED();
      if (ob.status !== 'WEIGHED') throw Errors.OUTBOUND_WEIGHT_REQUIRED();

      // Row-lock the lot
      await tx.$queryRawUnsafe(
        `SELECT 1 FROM lots WHERE id = $1::uuid FOR UPDATE`,
        ob.lotId,
      );

      const newBalance = ob.lot.currentBalanceBags - ob.quantityWithdrawnBags;
      const isFullClose =
        ob.withdrawalType === 'FULL' || newBalance === 0;

      await tx.lot.update({
        where: { id: ob.lotId },
        data: {
          currentBalanceBags: newBalance,
          ...(isFullClose
            ? { status: 'CLOSED', closedAt: ob.outboundDate }
            : {}),
        },
      });

      const updated = await this.repo.update(tx, id, {
        status: 'DISPATCHED',
        ...(notes ? { notes } : {}),
      });

      const invoice = await buildInvoiceFromOutbound(tx, id);

      return formatOutbound(updated, invoice.id);
    });
  }

  async getDispatchNotePdf(facilityId: string, id: string): Promise<{ filename: string; pdf: Buffer }> {
    const ob = await this.repo.findById(facilityId, id);
    if (!ob) throw Errors.OUTBOUND_NOT_FOUND();

    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });

    const pdf = await renderDispatchNote({
      facilityName: facility?.name ?? 'Cold Store',
      facilityCity: facility?.city ?? 'Lahore',
      dispatchNoteNumber: ob.dispatchNoteNumber ?? id.slice(0, 8),
      lotNumber: ob.lot.lotNumber,
      outboundDate: ob.outboundDate.toISOString().slice(0, 10),
      receivingPartyName: ob.receivingParty?.name ?? null,
      commodityName: '', // will be filled via joined query if needed
      quantityWithdrawnBags: ob.quantityWithdrawnBags,
      outboundWeightKg: toNumber(ob.outboundWeightKg),
      vehicleNumber: ob.vehicleNumber,
      marka: ob.lot.marka,
      operatorName: ob.createdByUser.name,
      withdrawalType: ob.withdrawalType,
    });

    return {
      filename: `${ob.dispatchNoteNumber ?? ob.id.slice(0, 8)}.pdf`,
      pdf,
    };
  }

  async getByLot(facilityId: string, lotId: string) {
    const lot = await this.prisma.lot.findFirst({ where: { id: lotId, facilityId } });
    if (!lot) throw Errors.LOT_NOT_FOUND();
    const events = await this.repo.findByLot(facilityId, lotId);
    const invoices = await this.prisma.invoice.findMany({
      where: { outboundEventId: { in: events.map((e) => e.id) } },
      select: { id: true, outboundEventId: true },
    });
    const byEvent = new Map(invoices.map((i) => [i.outboundEventId!, i.id]));
    return events.map((e) => formatOutbound(e, byEvent.get(e.id) ?? null));
  }
}
