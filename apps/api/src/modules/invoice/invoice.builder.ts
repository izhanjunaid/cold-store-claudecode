import type { Prisma, RateType, BookType } from '@coldchain/db';
import { invoiceTotals } from './invoice-totals';
import { computeStorageCharge, billingPeriodStart } from './storage-charge';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';
import { resolveFacilitySettings } from '../facility/facility.service';
import { settingsOn } from '../facility/settings-store';

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
  tariff?: unknown;
  seasonEndDate?: Date | null;
  seasonFeeBilled?: boolean;
  alreadyBilledPerUnitPkr?: number;
  /** A bill for rent up to a date with the goods still in the room (docs/32 2.6). */
  rentPeriodBill?: boolean;
  createdBy: string;
}

/** What a storage invoice would say, before anything is written. */
export interface StorageInvoicePricing {
  charge: ReturnType<typeof computeStorageCharge>;
  subTotal: number;
  gstRate: number;
  gstAmount: number;
  total: number;
}

/**
 * The pricing half of a storage invoice: the STORAGE charge and the GST on it. Pure
 * of writes, so the dispatch checkout's preview and the invoice it then builds are
 * the same arithmetic and cannot disagree (as with computeTariffCharge).
 */
export async function priceStorageInvoice(
  tx: Prisma.TransactionClient,
  params: DraftInvoiceParams,
): Promise<StorageInvoicePricing> {
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
    tariff: params.tariff,
    seasonEndDate: params.seasonEndDate,
    seasonFeeBilled: params.seasonFeeBilled,
    alreadyBilledPerUnitPkr: params.alreadyBilledPerUnitPkr,
    perUnitLine: params.rentPeriodBill,
  });

  // GST default: pre-fill from facility settings when GST-registered.
  // Still editable per invoice while DRAFT (PATCH /v1/invoices/:id).
  // Read for the bill's own date (docs/32 2.2): a rate that starts on 1 July is not
  // charged on a bill dated in June, whenever that bill is made.
  const settings = await settingsOn(tx, params.facilityId, params.periodEnd);
  // The informal book carries no sales tax: nothing settles KATCHI output tax,
  // so charging it would only grow a liability no return ever clears (docs/25 R-06).
  const gstRate = settings.gst_registered && params.bookType === 'PACCI' ? settings.gst_default_rate : 0;
  const { subTotal, gst: gstAmount, total } = invoiceTotals({
    lineAmounts: [charge.amountPkr],
    gstRate,
    bookType: params.bookType,
  });
  return { charge, subTotal, gstRate, gstAmount, total };
}

// Shared by buildInvoiceFromOutbound (period = latest ownership -> outbound
// date) and buildOwnershipTransferAccruedInvoice (period = latest ownership
// -> transfer date). Both bill one STORAGE line for a fixed period; only how
// the period and billing party are derived differs.
async function createDraftInvoice(
  tx: Prisma.TransactionClient,
  params: DraftInvoiceParams,
): Promise<BuiltInvoice> {
  const { charge, subTotal, gstRate, gstAmount, total } = await priceStorageInvoice(tx, params);

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
      rentPeriodBill: params.rentPeriodBill ?? false,
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

/** The billing inputs of a withdrawal: its lot's rate plan and billing party over the stay it ends. */
async function outboundBillingParams(
  tx: Prisma.TransactionClient,
  outboundEventId: string,
): Promise<DraftInvoiceParams> {
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

  return {
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
    tariff: ratePlan.tariff,
    seasonEndDate: ratePlan.seasonEndDate,
    seasonFeeBilled: lot.seasonFeeBilled,
    alreadyBilledPerUnitPkr: await rentBilledPerUnit(tx, lot, periodStart),
    createdBy: outbound.createdBy,
  };
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

  return createDraftInvoice(tx, await outboundBillingParams(tx, outboundEventId));
}

/** What the withdrawal's invoice will say, without creating it (the checkout's review step). */
export async function previewInvoiceFromOutbound(
  tx: Prisma.TransactionClient,
  outboundEventId: string,
) {
  const params = await outboundBillingParams(tx, outboundEventId);
  const pricing = await priceStorageInvoice(tx, params);
  return { params, ...pricing };
}

interface TransferAccruedInvoiceParams {
  /** Rent per unit already billed on these units in period bills (see rentBilledPerUnit). */
  alreadyBilledPerUnitPkr?: number;
  facilityId: string;
  lotId: string;
  billingPartyId: string;
  bookType: BookType;
  periodStart: Date;
  periodEnd: Date;
  quantityBags: number;
  ratePlan: {
    id: string;
    rateType: RateType;
    rateAmountPkr: number;
    minBillingDays: number;
    tariff?: unknown;
    seasonEndDate?: Date | null;
  };
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
): Promise<BuiltInvoice | null> {
  const draft: DraftInvoiceParams = {
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
    tariff: params.ratePlan.tariff,
    seasonEndDate: params.ratePlan.seasonEndDate,
    alreadyBilledPerUnitPkr: params.alreadyBilledPerUnitPkr,
    createdBy: params.createdBy,
  };
  // Period bills may already have charged everything up to the transfer: then there is no bill.
  if ((params.alreadyBilledPerUnitPkr ?? 0) > 0 && (await priceStorageInvoice(tx, draft)).charge.amountPkr <= 0) {
    return null;
  }
  return createDraftInvoice(tx, draft);
}

/**
 * Rent per unit already billed on a lot's units in the present owner's stay: the lot's
 * period bills that are not void and end after the stay began, plus what was billed on
 * these units under another lot number. Derived, never stored, so voiding a period bill
 * needs no second correction (docs/32 2.6).
 */
export async function rentBilledPerUnit(
  tx: Prisma.TransactionClient,
  lot: { id: string; rentBilledCarriedPkr: Prisma.Decimal | number },
  stayStart: Date,
): Promise<number> {
  const bills = await tx.invoice.findMany({
    where: { lotId: lot.id, rentPeriodBill: true, status: { not: 'VOID' }, periodEnd: { gt: stayStart } },
    select: { lineItems: { where: { lineType: 'STORAGE' }, select: { unitPricePkr: true } } },
  });
  const billed = bills.reduce((s, b) => s + b.lineItems.reduce((t, l) => t + Number(l.unitPricePkr), 0), 0);
  return Math.round((billed + Number(lot.rentBilledCarriedPkr)) * 100) / 100;
}

/**
 * Bill the rent on a lot's units up to `asOf`, with the goods still in the room: the
 * month-end bill of a khata client, the season-end bill, the bill for goods nobody
 * collects. Returns null when nothing more is owed up to that date.
 *
 * The bill is the whole stay's rent per unit up to `asOf`, less what earlier period
 * bills charged. A later withdrawal subtracts the same way, so the parts always add up
 * to what one bill at the end would have been.
 */
export async function buildRentPeriodBill(
  tx: Prisma.TransactionClient,
  args: { facilityId: string; lotId: string; asOf: Date; createdBy: string },
): Promise<BuiltInvoice | null> {
  const lot = await tx.lot.findFirst({
    where: { id: args.lotId, facilityId: args.facilityId },
    include: { ratePlan: true, ownershipHistory: { select: { eventType: true, effectiveDate: true } } },
  });
  if (!lot) throw new Error(`Lot ${args.lotId} not found`);
  if (lot.status !== 'ACTIVE' || lot.currentBalanceBags <= 0) return null;

  const periodStart = billingPeriodStart(lot);
  if (args.asOf <= periodStart) return null;

  const params: DraftInvoiceParams = {
    facilityId: args.facilityId,
    lotId: lot.id,
    outboundEventId: null,
    billingPartyId: lot.billingPartyId,
    bookType: lot.bookType,
    periodStart,
    periodEnd: args.asOf,
    quantityBags: lot.currentBalanceBags,
    ratePlanId: lot.ratePlan.id,
    rateType: lot.ratePlan.rateType,
    rateAmountPkr: Number(lot.ratePlan.rateAmountPkr),
    minBillingDays: lot.ratePlan.minBillingDays,
    tariff: lot.ratePlan.tariff,
    seasonEndDate: lot.ratePlan.seasonEndDate,
    seasonFeeBilled: lot.seasonFeeBilled,
    alreadyBilledPerUnitPkr: await rentBilledPerUnit(tx, lot, periodStart),
    rentPeriodBill: true,
    createdBy: args.createdBy,
  };
  const { charge } = await priceStorageInvoice(tx, params);
  if (charge.amountPkr <= 0) return null;
  return createDraftInvoice(tx, params);
}
