import { round2 } from '@coldchain/shared';
import type { Prisma, RateType, BookType } from '@coldchain/db';
import { computeStorageCharge, billingPeriodStart } from './storage-charge';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';
import { resolveFacilitySettings } from '../facility/facility.service';

const builderInclude = {
  lot: { select: { lotNumber: true } },
  billingParty: { select: { name: true } },
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;

export type BuiltInvoice = Prisma.InvoiceGetPayload<{ include: typeof builderInclude }>;

interface DraftInvoiceParams {
  facilityId: string;
  lotId: string;
  outboundEventId: string | null;
  billingPartyId: string;
  bookType: BookType;
  periodStart: Date;
  periodEnd: Date;
  quantityBags: number;
  ratePlanId: string;
  rateType: RateType;
  rateAmountPkr: number;
  minBillingDays: number;
  createdBy: string;
}

// Shared by buildInvoiceFromOutbound (period = latest ownership -> outbound
// date) and buildOwnershipTransferAccruedInvoice (period = latest ownership
// -> transfer date). Both bill one STORAGE line for a fixed period; only how
// the period and billing party are derived differs.
async function createDraftInvoice(
  tx: Prisma.TransactionClient,
  params: DraftInvoiceParams,
): Promise<BuiltInvoice> {
  // A supplier has no receivable, so a draft billed to one could never be finalized —
  // and a draft nothing can finalize stops its month from closing (docs/25 R-01).
  const billingParty = await tx.party.findUniqueOrThrow({
    where: { id: params.billingPartyId },
    select: RECEIVABLE_PARTY_SELECT,
  });
  receivableParty(billingParty);

  const charge = computeStorageCharge({
    rateType: params.rateType,
    rateAmountPkr: params.rateAmountPkr,
    quantityBags: params.quantityBags,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    minBillingDays: params.minBillingDays,
  });

  const subTotal = charge.amountPkr;

  // GST default: pre-fill from facility settings when GST-registered.
  // Still editable per invoice while DRAFT (PATCH /v1/invoices/:id).
  const facility = await tx.facility.findUnique({
    where: { id: params.facilityId },
  });
  const settings = resolveFacilitySettings(facility?.settings ?? null);
  // The informal book carries no sales tax: nothing settles KATCHI output tax,
  // so charging it would only grow a liability no return ever clears (docs/25 R-06).
  const gstRate = settings.gst_registered && params.bookType === 'PACCI' ? settings.gst_default_rate : 0;
  const gstAmount = round2(subTotal * (gstRate / 100));
  const total = round2(subTotal + gstAmount);

  return tx.invoice.create({
    data: {
      facilityId: params.facilityId,
      lotId: params.lotId,
      outboundEventId: params.outboundEventId,
      billingPartyId: params.billingPartyId,
      // Dated when the storage it bills ended — the dispatch or the transfer — so a
      // backdated dispatch books its revenue in its own month (docs/25 R-09).
      invoiceDate: params.periodEnd,
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      subTotalPkr: subTotal,
      gstRate,
      gstAmountPkr: gstAmount,
      totalPkr: total,
      amountPaidPkr: 0,
      status: 'DRAFT',
      bookType: params.bookType,
      createdBy: params.createdBy,
      lineItems: {
        create: {
          lineType: 'STORAGE',
          description: charge.description,
          quantity: charge.quantity,
          unitPricePkr: charge.unitPricePkr,
          amountPkr: charge.amountPkr,
          ratePlanId: params.ratePlanId,
          sortOrder: 0,
        },
      },
    },
    include: builderInclude,
  });
}

export async function buildInvoiceFromOutbound(
  tx: Prisma.TransactionClient,
  outboundEventId: string,
): Promise<BuiltInvoice> {
  // Idempotent: return existing if already created
  const existing = await tx.invoice.findFirst({
    where: { outboundEventId },
    include: builderInclude,
  });
  if (existing) return existing;

  const outbound = await tx.outboundEvent.findUnique({
    where: { id: outboundEventId },
    include: {
      lot: {
        include: {
          ratePlan: true,
          ownershipHistory: { select: { eventType: true, effectiveDate: true } },
        },
      },
    },
  });

  if (!outbound) throw new Error(`Outbound event ${outboundEventId} not found`);

  const lot = outbound.lot;
  const ratePlan = lot.ratePlan;

  const periodStart = billingPeriodStart(lot);
  const periodEnd: Date = outbound.outboundDate;

  return createDraftInvoice(tx, {
    facilityId: outbound.facilityId,
    lotId: outbound.lotId,
    outboundEventId,
    billingPartyId: lot.billingPartyId,
    bookType: lot.bookType,
    periodStart,
    periodEnd,
    quantityBags: outbound.quantityWithdrawnBags,
    ratePlanId: ratePlan.id,
    rateType: ratePlan.rateType,
    rateAmountPkr: Number(ratePlan.rateAmountPkr),
    minBillingDays: ratePlan.minBillingDays,
    createdBy: outbound.createdBy,
  });
}

interface TransferAccruedInvoiceParams {
  facilityId: string;
  lotId: string;
  billingPartyId: string;
  bookType: BookType;
  periodStart: Date;
  periodEnd: Date;
  quantityBags: number;
  ratePlan: { id: string; rateType: RateType; rateAmountPkr: number; minBillingDays: number };
  createdBy: string;
}

/**
 * On a FULL ownership transfer, the outgoing owner held the lot for
 * [periodStart, effectiveDate) but no outbound event exists to trigger a
 * normal invoice for that period — the goods stay in storage under the new
 * owner. Bill it now as a standalone DRAFT invoice (outboundEventId=null,
 * nullable in schema) so the outgoing owner's accrued charges aren't lost
 * and the incoming owner's eventual withdrawal invoice only covers their
 * own holding period (see the TRANSFER_IN event written alongside this).
 */
export async function buildOwnershipTransferAccruedInvoice(
  tx: Prisma.TransactionClient,
  params: TransferAccruedInvoiceParams,
): Promise<BuiltInvoice> {
  return createDraftInvoice(tx, {
    facilityId: params.facilityId,
    lotId: params.lotId,
    outboundEventId: null,
    billingPartyId: params.billingPartyId,
    bookType: params.bookType,
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    quantityBags: params.quantityBags,
    ratePlanId: params.ratePlan.id,
    rateType: params.ratePlan.rateType,
    rateAmountPkr: params.ratePlan.rateAmountPkr,
    minBillingDays: params.ratePlan.minBillingDays,
    createdBy: params.createdBy,
  });
}
