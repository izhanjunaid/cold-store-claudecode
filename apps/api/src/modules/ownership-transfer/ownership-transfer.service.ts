import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { OwnershipTransferRepository, LOT_INCLUDE_SHAPE_TRANSFER } from './ownership-transfer.repository';
import { mirrorTransferPlacements } from '../lot/placement.service';
import { renderTransferAcknowledgment } from '../pdf/pdf.service';
import type { TransferAcknowledgmentData } from '../pdf/pdf.service';
import { buildOwnershipTransferAccruedInvoice } from '../invoice/invoice.builder';

export interface CreateTransferInput {
  facilityId: string;
  operatorId: string;
  lotId: string;
  transferType: 'FULL' | 'PARTIAL';
  toPartyId: string;
  quantityBags?: number;
  transferPricePkr?: number;
  effectiveDate: string;
  notes?: string;
}

interface TransferRow {
  id: string;
  eventType: string;
  fromPartyId: string | null;
  toPartyId: string;
  quantityBags: number;
  transferPricePkr: { toString(): string } | null;
  effectiveDate: Date;
  notes: string | null;
  createdAt: Date;
}

function mapTransferResponse(
  transfer: TransferRow,
  parent: { id: string; lotNumber: string; currentBalanceBags: number },
  child: { id: string; lotNumber: string } | null,
  transferType: 'FULL' | 'PARTIAL',
  accruedInvoiceId: string | null = null,
) {
  return {
    transfer_id: transfer.id,
    transfer_type: transferType,
    effective_date: transfer.effectiveDate.toISOString().slice(0, 10),
    from_party_id: transfer.fromPartyId ?? '',
    to_party_id: transfer.toPartyId,
    quantity_bags: transfer.quantityBags,
    transfer_price_pkr: transfer.transferPricePkr ? Number(transfer.transferPricePkr) : null,
    parent_lot_id: parent.id,
    parent_lot_number: parent.lotNumber,
    parent_current_balance_bags: parent.currentBalanceBags,
    child_lot_id: child?.id ?? null,
    child_lot_number: child?.lotNumber ?? null,
    // FULL transfers only: DRAFT invoice billing the outgoing owner for the
    // pre-transfer accrued period (see buildOwnershipTransferAccruedInvoice).
    accrued_invoice_id: accruedInvoiceId,
    notes: transfer.notes,
    created_at: transfer.createdAt.toISOString(),
  };
}

export class OwnershipTransferService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: OwnershipTransferRepository,
  ) {}

  async create(input: CreateTransferInput) {
    // Validate new owner
    const newOwner = await this.prisma.party.findFirst({
      where: { id: input.toPartyId, facilityId: input.facilityId },
    });
    if (!newOwner) throw Errors.VALIDATION_ERROR('New owner not found', 'to_party_id');
    if (!newOwner.isActive) {
      throw Errors.VALIDATION_ERROR('New owner is inactive', 'to_party_id');
    }

    const effectiveDate = new Date(input.effectiveDate);

    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Row-lock the parent lot to serialize concurrent transfers
      const locked = await tx.$queryRawUnsafe<
        { id: string; facility_id: string; status: string; current_balance_bags: number; owner_party_id: string }[]
      >(
        `SELECT id, facility_id, status, current_balance_bags, owner_party_id
         FROM lots
         WHERE id = $1::uuid AND facility_id = $2::uuid
         FOR UPDATE`,
        input.lotId,
        input.facilityId,
      );
      if (locked.length === 0) throw Errors.LOT_NOT_FOUND();
      const parent = locked[0]!;
      if (parent.status !== 'ACTIVE') throw Errors.LOT_CLOSED();
      if (parent.owner_party_id === input.toPartyId) {
        throw Errors.TRANSFER_SAME_PARTY();
      }

      const fromPartyId = parent.owner_party_id;
      const balance = parent.current_balance_bags;

      // Full load of parent (for output + child inheritance)
      const parentLot = await tx.lot.findUniqueOrThrow({
        where: { id: parent.id },
        include: { ratePlan: true },
      });

      if (input.transferType === 'FULL') {
        // Bill the outgoing owner for the accrued pre-transfer period now —
        // no outbound event will ever fire for it, since the goods stay put
        // and only the owner changes (outboundEventId is nullable for
        // exactly this case). Find where their billing window started: the
        // latest INITIAL/TRANSFER_IN on this lot, same lookup invoice
        // builder uses at withdrawal time.
        const priorOwnership = await tx.ownershipHistory.findFirst({
          where: { lotId: parent.id, eventType: { in: ['INITIAL', 'TRANSFER_IN'] } },
          orderBy: { effectiveDate: 'desc' },
        });
        const accruedPeriodStart = priorOwnership ? priorOwnership.effectiveDate : parentLot.inboundDate;

        const accruedInvoice = await buildOwnershipTransferAccruedInvoice(tx, {
          facilityId: input.facilityId,
          lotId: parent.id,
          billingPartyId: parentLot.billingPartyId,
          bookType: parentLot.bookType,
          periodStart: accruedPeriodStart,
          periodEnd: effectiveDate,
          quantityBags: balance,
          ratePlan: {
            id: parentLot.ratePlan.id,
            rateType: parentLot.ratePlan.rateType,
            rateAmountPkr: Number(parentLot.ratePlan.rateAmountPkr),
            minBillingDays: parentLot.ratePlan.minBillingDays,
          },
          createdBy: input.operatorId,
        });

        const updated = await tx.lot.update({
          where: { id: parent.id },
          data: {
            ownerPartyId: input.toPartyId,
            billingPartyId: input.toPartyId,
          },
          include: LOT_INCLUDE_SHAPE_TRANSFER,
        });
        const transfer = await tx.ownershipHistory.create({
          data: {
            lotId: parent.id,
            eventType: 'TRANSFER_OUT',
            fromPartyId,
            toPartyId: input.toPartyId,
            quantityBags: balance,
            transferPricePkr: input.transferPricePkr,
            effectiveDate,
            operatorId: input.operatorId,
            notes: input.notes,
          },
        });
        // Mirrors the TRANSFER_IN a child lot gets on PARTIAL transfer, but
        // on the same lot (FULL transfer keeps the same lot id/number): the
        // new owner's eventual withdrawal invoice will use this event's
        // effectiveDate as periodStart instead of falling back to the lot's
        // original INITIAL event.
        await tx.ownershipHistory.create({
          data: {
            lotId: parent.id,
            eventType: 'TRANSFER_IN',
            fromPartyId,
            toPartyId: input.toPartyId,
            quantityBags: balance,
            transferPricePkr: input.transferPricePkr,
            effectiveDate,
            operatorId: input.operatorId,
            notes: input.notes,
          },
        });
        return mapTransferResponse(
          transfer as unknown as TransferRow,
          { id: updated.id, lotNumber: updated.lotNumber, currentBalanceBags: updated.currentBalanceBags },
          null,
          'FULL',
          accruedInvoice.id,
        );
      }

      // PARTIAL
      const qty = input.quantityBags!;
      if (qty >= balance) {
        throw Errors.VALIDATION_ERROR(
          `Partial transfer quantity must be less than current balance (${balance}). Use FULL transfer for the whole lot.`,
          'quantity_bags',
        );
      }

      // Decrement parent
      const updatedParent = await tx.lot.update({
        where: { id: parent.id },
        data: { currentBalanceBags: { decrement: qty } },
      });

      // Child lot number
      const childCount = await tx.lot.count({ where: { parentLotId: parent.id } });
      const childLotNumber = `${parentLot.lotNumber}-T${childCount + 1}`;

      const childLot = await tx.lot.create({
        data: {
          facilityId: parentLot.facilityId,
          lotNumber: childLotNumber,
          chamberId: parentLot.chamberId,
          ownerPartyId: input.toPartyId,
          billingPartyId: input.toPartyId,
          commodityId: parentLot.commodityId,
          varietyId: parentLot.varietyId,
          ratePlanId: parentLot.ratePlanId,
          quantityBags: qty,
          currentBalanceBags: qty,
          acceptedWeightKg: 0,
          declaredWeightKg: null,
          weightDisputeFlag: false,
          qualityGradeInbound: parentLot.qualityGradeInbound,
          inboundDate: effectiveDate,
          entryDate: effectiveDate,
          parentLotId: parent.id,
          status: 'ACTIVE',
          bookType: parentLot.bookType,
          // The physical marka stays on the bags, so the child lot inherits it.
          marka: parentLot.marka,
          notes: `Created from partial transfer of ${parentLot.lotNumber}`,
          createdBy: input.operatorId,
        },
      });

      // The bags never move on an ownership split: re-attribute the parent's
      // rack placements (largest-first) onto the child on the same racks.
      await mirrorTransferPlacements(tx, {
        facilityId: parentLot.facilityId,
        parentLotId: parent.id,
        childLotId: childLot.id,
        parentNewBalanceBags: updatedParent.currentBalanceBags,
      });

      // TRANSFER_OUT on parent
      const parentEvent = await tx.ownershipHistory.create({
        data: {
          lotId: parent.id,
          eventType: 'TRANSFER_OUT',
          fromPartyId,
          toPartyId: input.toPartyId,
          quantityBags: qty,
          transferPricePkr: input.transferPricePkr,
          effectiveDate,
          operatorId: input.operatorId,
          notes: input.notes,
        },
      });

      // TRANSFER_IN on child (mirrors the INITIAL event lot creation would emit)
      await tx.ownershipHistory.create({
        data: {
          lotId: childLot.id,
          eventType: 'TRANSFER_IN',
          fromPartyId,
          toPartyId: input.toPartyId,
          quantityBags: qty,
          transferPricePkr: input.transferPricePkr,
          effectiveDate,
          operatorId: input.operatorId,
          notes: input.notes,
        },
      });

      return mapTransferResponse(
        parentEvent as unknown as TransferRow,
        {
          id: updatedParent.id,
          lotNumber: updatedParent.lotNumber,
          currentBalanceBags: updatedParent.currentBalanceBags,
        },
        { id: childLot.id, lotNumber: childLot.lotNumber },
        'PARTIAL',
      );
    });
  }

  async getAcknowledgmentPdf(facilityId: string, lotId: string, transferId: string) {
    const transfer = await this.repo.findTransferById(lotId, transferId) as
      | {
          id: string;
          lotId: string;
          eventType: string;
          quantityBags: number;
          transferPricePkr: { toString(): string } | null;
          effectiveDate: Date;
          notes: string | null;
          fromParty: { id: string; name: string; nameUrdu: string | null } | null;
          toParty: { id: string; name: string; nameUrdu: string | null };
          operator: { name: string };
          lot: {
            id: string;
            facilityId: string;
            lotNumber: string;
            commodity?: { name: string } | null;
            variety?: { name: string } | null;
            parentLotId: string | null;
          };
        }
      | null;

    if (!transfer) throw Errors.VALIDATION_ERROR('Transfer not found', 'transfer_id');
    if (transfer.lot.facilityId !== facilityId) throw Errors.LOT_NOT_FOUND();
    if (transfer.eventType === 'INITIAL') {
      throw Errors.VALIDATION_ERROR('Cannot generate acknowledgment for INITIAL event', 'transfer_id');
    }

    // If this is a TRANSFER_OUT on a parent with a child lot created same effective date, find the child
    let childLotNumber: string | null = null;
    if (transfer.eventType === 'TRANSFER_OUT') {
      const child = await this.prisma.lot.findFirst({
        where: {
          parentLotId: transfer.lot.id,
          inboundDate: transfer.effectiveDate,
          ownerPartyId: transfer.toParty.id,
        },
        orderBy: { createdAt: 'desc' },
      });
      childLotNumber = child?.lotNumber ?? null;
    }

    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, city: true },
    });

    const data: TransferAcknowledgmentData = {
      facilityName: facility?.name ?? 'ColdChain',
      facilityCity: facility?.city ?? '',
      parentLotNumber: transfer.lot.lotNumber,
      childLotNumber,
      fromPartyName: transfer.fromParty?.name ?? '',
      fromPartyNameUrdu: transfer.fromParty?.nameUrdu ?? null,
      toPartyName: transfer.toParty.name,
      toPartyNameUrdu: transfer.toParty.nameUrdu ?? null,
      commodityName: transfer.lot.commodity?.name ?? '',
      varietyName: transfer.lot.variety?.name ?? null,
      quantityBags: transfer.quantityBags,
      transferPricePkr: transfer.transferPricePkr ? Number(transfer.transferPricePkr) : null,
      effectiveDate: transfer.effectiveDate.toISOString().slice(0, 10),
      operatorName: transfer.operator.name,
      notes: transfer.notes,
      transferType: childLotNumber ? 'PARTIAL' : 'FULL',
    };

    const pdfBuffer = await renderTransferAcknowledgment(data);
    return { lotNumber: transfer.lot.lotNumber, transferId: transfer.id, pdfBuffer };
  }
}
