import type { PrismaClient, Prisma } from '@coldchain/db';
import { LotRepository, LOT_INCLUDE_SHAPE } from './lot.repository';
import { Errors } from '../../common/errors';
import { generateLotNumber } from './lot-number';
import { renderStorageReceipt } from '../pdf/pdf.service';
import type { StorageReceiptData } from '../pdf/pdf.service';

interface LotRecord {
  id: string;
  facilityId: string;
  lotNumber: string;
  chamberId: string;
  ownerPartyId: string;
  billingPartyId: string;
  commodityId: string;
  varietyId: string | null;
  ratePlanId: string;
  quantityBags: number;
  currentBalanceBags: number;
  acceptedWeightKg: { toString(): string };
  declaredWeightKg: { toString(): string } | null;
  weightDisputeFlag: boolean;
  weightDisputeNote: string | null;
  qualityGradeInbound: string | null;
  inboundDate: Date;
  entryDate: Date;
  parentLotId: string | null;
  vehicleNumber: string | null;
  status: 'ACTIVE' | 'CLOSED' | 'SUSPENDED';
  closedAt: Date | null;
  bookType: 'PACCI' | 'KATCHI';
  notes: string | null;
  createdAt: Date;
  createdBy: string;
  chamber?: { name: string } | null;
  ownerParty?: { name: string } | null;
  billingParty?: { name: string } | null;
  commodity?: { name: string } | null;
  variety?: { name: string } | null;
  ratePlan?: { name: string } | null;
}

interface OwnershipEvent {
  id: string;
  lotId: string;
  eventType: string;
  fromPartyId: string | null;
  fromParty: { name: string } | null;
  toPartyId: string;
  toParty: { name: string } | null;
  quantityBags: number;
  transferPricePkr: { toString(): string } | null;
  effectiveDate: Date;
  operatorId: string;
  operator: { name: string } | null;
  notes: string | null;
  createdAt: Date;
}

import { daysInStorage } from './days-in-storage';
export { daysInStorage };

function toResponse(lot: LotRecord) {
  return {
    id: lot.id,
    facility_id: lot.facilityId,
    lot_number: lot.lotNumber,
    chamber_id: lot.chamberId,
    chamber_name: lot.chamber?.name ?? null,
    owner_party_id: lot.ownerPartyId,
    owner_party_name: lot.ownerParty?.name ?? null,
    billing_party_id: lot.billingPartyId,
    billing_party_name: lot.billingParty?.name ?? null,
    commodity_id: lot.commodityId,
    commodity_name: lot.commodity?.name ?? null,
    variety_id: lot.varietyId,
    variety_name: lot.variety?.name ?? null,
    rate_plan_id: lot.ratePlanId,
    rate_plan_name: lot.ratePlan?.name ?? null,
    quantity_bags: lot.quantityBags,
    current_balance_bags: lot.currentBalanceBags,
    accepted_weight_kg: Number(lot.acceptedWeightKg),
    declared_weight_kg: lot.declaredWeightKg != null ? Number(lot.declaredWeightKg) : null,
    weight_dispute_flag: lot.weightDisputeFlag,
    weight_dispute_note: lot.weightDisputeNote,
    quality_grade_inbound: lot.qualityGradeInbound,
    inbound_date: lot.inboundDate.toISOString().slice(0, 10),
    entry_date: lot.entryDate.toISOString().slice(0, 10),
    parent_lot_id: lot.parentLotId,
    vehicle_number: lot.vehicleNumber,
    status: lot.status,
    closed_at: lot.closedAt ? lot.closedAt.toISOString().slice(0, 10) : null,
    book_type: lot.bookType,
    notes: lot.notes,
    days_in_storage: daysInStorage(lot.inboundDate),
    created_at: lot.createdAt.toISOString(),
    created_by: lot.createdBy,
  };
}

export interface CreateLotInput {
  facilityId: string;
  createdBy: string;
  ownerPartyId: string;
  billingPartyId?: string;
  commodityId: string;
  varietyId?: string;
  ratePlanId: string;
  chamberId: string;
  quantityBags: number;
  acceptedWeightKg: number;
  declaredWeightKg?: number;
  weightDisputeNote?: string;
  qualityGradeInbound?: 'A' | 'B' | 'C';
  inboundDate?: string;
  vehicleNumber?: string;
  notes?: string;
  bookType?: 'PACCI' | 'KATCHI';
}

export class LotService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repo: LotRepository,
  ) {}

  async list(
    facilityId: string,
    query: {
      status?: 'ACTIVE' | 'CLOSED' | 'SUSPENDED';
      party_id?: string;
      commodity_id?: string;
      chamber_id?: string;
      inbound_date_from?: string;
      inbound_date_to?: string;
      search?: string;
      page: number;
      per_page: number;
    },
  ) {
    const { data, total } = await this.repo.findMany({
      facilityId,
      status: query.status,
      partyId: query.party_id,
      commodityId: query.commodity_id,
      chamberId: query.chamber_id,
      inboundDateFrom: query.inbound_date_from,
      inboundDateTo: query.inbound_date_to,
      search: query.search,
      page: query.page,
      perPage: query.per_page,
    });
    return {
      data: (data as unknown as LotRecord[]).map(toResponse),
      meta: { page: query.page, per_page: query.per_page, total },
    };
  }

  async getById(facilityId: string, id: string) {
    const lot = await this.repo.findById(facilityId, id);
    if (!lot) throw Errors.LOT_NOT_FOUND();
    return toResponse(lot as unknown as LotRecord);
  }

  async getOwnershipHistory(facilityId: string, id: string) {
    const lot = await this.repo.findById(facilityId, id);
    if (!lot) throw Errors.LOT_NOT_FOUND();
    const events = (await this.repo.findOwnershipHistory(id)) as OwnershipEvent[];
    return events.map((e) => ({
      id: e.id,
      lot_id: e.lotId,
      event_type: e.eventType,
      from_party_id: e.fromPartyId,
      from_party_name: e.fromParty?.name ?? null,
      to_party_id: e.toPartyId,
      to_party_name: e.toParty?.name ?? null,
      quantity_bags: e.quantityBags,
      transfer_price_pkr: e.transferPricePkr ? Number(e.transferPricePkr) : null,
      effective_date: e.effectiveDate.toISOString().slice(0, 10),
      operator_id: e.operatorId,
      operator_name: e.operator?.name ?? null,
      notes: e.notes,
      created_at: e.createdAt.toISOString(),
    }));
  }

  async create(input: CreateLotInput) {
    const warnings: string[] = [];

    // 1. Owner party
    const owner = await this.prisma.party.findFirst({
      where: { id: input.ownerPartyId, facilityId: input.facilityId },
    });
    if (!owner) throw Errors.VALIDATION_ERROR('Owner party not found', 'owner_party_id');
    if (!owner.isActive) {
      throw Errors.VALIDATION_ERROR('Owner party is inactive', 'owner_party_id');
    }

    // 2. Billing party (defaults to owner)
    const billingPartyId = input.billingPartyId ?? input.ownerPartyId;
    if (billingPartyId !== input.ownerPartyId) {
      const billing = await this.prisma.party.findFirst({
        where: { id: billingPartyId, facilityId: input.facilityId },
      });
      if (!billing || !billing.isActive) {
        throw Errors.VALIDATION_ERROR('Billing party invalid or inactive', 'billing_party_id');
      }
    }

    // 3. Chamber
    const chamber = await this.prisma.chamber.findFirst({
      where: { id: input.chamberId, facilityId: input.facilityId },
    });
    if (!chamber) throw Errors.VALIDATION_ERROR('Chamber not found', 'chamber_id');
    if (!chamber.isActive) throw Errors.VALIDATION_ERROR('Chamber is inactive', 'chamber_id');
    if (
      chamber.commodityRestrictionId &&
      chamber.commodityRestrictionId !== input.commodityId
    ) {
      throw Errors.VALIDATION_ERROR(
        'Chamber is restricted to a different commodity',
        'chamber_id',
      );
    }

    // 3a. Capacity check (aggregate over ACTIVE lots)
    const agg = await this.repo.sumActiveBalanceByChamber(input.facilityId, input.chamberId);
    const currentOccupancy = agg._sum.currentBalanceBags ?? 0;
    if (currentOccupancy + input.quantityBags > chamber.maxCapacityBags) {
      throw Errors.CHAMBER_CAPACITY_EXCEEDED();
    }
    if (currentOccupancy + input.quantityBags > chamber.maxCapacityBags * 0.9) {
      warnings.push(
        `Chamber ${chamber.name} will be >90% full after this inbound`,
      );
    }

    // 4. Rate plan
    const ratePlan = await this.prisma.ratePlan.findFirst({
      where: { id: input.ratePlanId, facilityId: input.facilityId },
    });
    if (!ratePlan) throw Errors.VALIDATION_ERROR('Rate plan not found', 'rate_plan_id');
    if (!ratePlan.isActive) {
      throw Errors.VALIDATION_ERROR('Rate plan is inactive', 'rate_plan_id');
    }
    if (ratePlan.commodityId && ratePlan.commodityId !== input.commodityId) {
      throw Errors.VALIDATION_ERROR(
        'Rate plan does not apply to this commodity',
        'rate_plan_id',
      );
    }

    // 5. Weight dispute detection
    const facility = await this.prisma.facility.findUnique({
      where: { id: input.facilityId },
    });
    const settings = (facility?.settings as Record<string, unknown> | null) ?? {};
    const thresholdPct =
      typeof settings['weight_dispute_threshold_pct'] === 'number'
        ? (settings['weight_dispute_threshold_pct'] as number)
        : 2;

    let disputeFlag = false;
    if (input.declaredWeightKg != null) {
      const variance =
        Math.abs(input.acceptedWeightKg - input.declaredWeightKg) / input.declaredWeightKg;
      if (variance > thresholdPct / 100) disputeFlag = true;
    }
    if (disputeFlag && !input.weightDisputeNote) {
      throw Errors.WEIGHT_DISPUTE_UNRESOLVED();
    }

    // 6/7/8. Dates + lot number + insert in one transaction
    const entryDate = new Date();
    entryDate.setHours(0, 0, 0, 0);
    const inboundDate = input.inboundDate ? new Date(input.inboundDate) : entryDate;

    // Retry up to 5 times on unique-constraint collision (P2002) which
    // can occur under high concurrency despite the advisory lock.
    const MAX_RETRIES = 5;
    let lot: unknown;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        lot = await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          const lotNumber = await generateLotNumber(tx, input.facilityId, entryDate);
          const created = await tx.lot.create({
            data: {
              facilityId: input.facilityId,
              lotNumber,
              chamberId: input.chamberId,
              ownerPartyId: input.ownerPartyId,
              billingPartyId,
              commodityId: input.commodityId,
              varietyId: input.varietyId,
              ratePlanId: input.ratePlanId,
              quantityBags: input.quantityBags,
              currentBalanceBags: input.quantityBags,
              acceptedWeightKg: input.acceptedWeightKg,
              declaredWeightKg: input.declaredWeightKg,
              weightDisputeFlag: disputeFlag,
              weightDisputeNote: disputeFlag ? input.weightDisputeNote : null,
              qualityGradeInbound: input.qualityGradeInbound,
              inboundDate,
              entryDate,
              vehicleNumber: input.vehicleNumber,
              notes: input.notes,
              bookType: input.bookType ?? 'PACCI',
              createdBy: input.createdBy,
            },
            include: LOT_INCLUDE_SHAPE,
          });

          await tx.ownershipHistory.create({
            data: {
              lotId: created.id,
              eventType: 'INITIAL',
              fromPartyId: null,
              toPartyId: input.ownerPartyId,
              quantityBags: input.quantityBags,
              effectiveDate: inboundDate,
              operatorId: input.createdBy,
            },
          });

          return created;
        });
        break; // success
      } catch (err: unknown) {
        const isUniqueViolation =
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === 'P2002';
        if (!isUniqueViolation || attempt === MAX_RETRIES - 1) throw err;
        // retry
      }
    }

    const response = toResponse(lot as unknown as LotRecord);
    return { ...response, warnings: warnings.length > 0 ? warnings : undefined };
  }

  async update(
    facilityId: string,
    id: string,
    input: { notes?: string; qualityGradeInbound?: 'A' | 'B' | 'C' },
  ) {
    const lot = (await this.repo.findById(facilityId, id)) as LotRecord | null;
    if (!lot) throw Errors.LOT_NOT_FOUND();
    if (lot.status === 'CLOSED') throw Errors.LOT_CLOSED();

    const updated = await this.repo.update(id, {
      ...(input.notes !== undefined && { notes: input.notes }),
      ...(input.qualityGradeInbound !== undefined && {
        qualityGradeInbound: input.qualityGradeInbound,
      }),
    });
    return toResponse(updated as unknown as LotRecord);
  }

  async getReceipt(facilityId: string, id: string) {
    const lot = await this.repo.findById(facilityId, id);
    if (!lot) throw Errors.LOT_NOT_FOUND();

    const typedLot = lot as unknown as LotRecord & {
      chamber: { name: string } | null;
      ownerParty: { name: string; nameUrdu: string | null } | null;
      commodity: { name: string } | null;
      variety: { name: string } | null;
      ratePlan: { name: string; rateAmountPkr: { toString(): string }; rateType: string } | null;
      createdByUser: { name: string } | null;
      facility?: { name: string; city: string } | null;
    };

    // Fetch facility separately (not in standard include)
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { name: true, city: true },
    });

    const data: StorageReceiptData = {
      facilityName: facility?.name ?? 'ColdChain',
      facilityCity: facility?.city ?? '',
      lotNumber: typedLot.lotNumber,
      inboundDate: typedLot.inboundDate.toISOString().slice(0, 10),
      entryDate: typedLot.entryDate.toISOString().slice(0, 10),
      ownerName: typedLot.ownerParty?.name ?? '',
      ownerNameUrdu: null,
      commodityName: typedLot.commodity?.name ?? '',
      varietyName: typedLot.variety?.name ?? null,
      quantityBags: typedLot.quantityBags,
      acceptedWeightKg: Number(typedLot.acceptedWeightKg),
      declaredWeightKg: typedLot.declaredWeightKg ? Number(typedLot.declaredWeightKg) : null,
      weightDisputeFlag: typedLot.weightDisputeFlag,
      weightDisputeNote: typedLot.weightDisputeNote,
      qualityGradeInbound: typedLot.qualityGradeInbound,
      chamberName: typedLot.chamber?.name ?? '',
      ratePlanName: typedLot.ratePlan?.name ?? '',
      rateAmountPkr: typedLot.ratePlan ? Number(typedLot.ratePlan.rateAmountPkr) : 0,
      rateType: typedLot.ratePlan?.rateType ?? '',
      vehicleNumber: typedLot.vehicleNumber,
      operatorName: typedLot.createdByUser?.name ?? '',
      bookType: typedLot.bookType,
    };

    const pdfBuffer = await renderStorageReceipt(data);
    return { lotNumber: typedLot.lotNumber, pdfBuffer };
  }
}
