import type { Prisma } from '@coldchain/db';
import { computeStorageCharge } from './storage-charge';
import { resolveFacilitySettings } from '../facility/facility.service';

const builderInclude = {
  lot: { select: { lotNumber: true } },
  billingParty: { select: { name: true } },
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;

export type BuiltInvoice = Prisma.InvoiceGetPayload<{ include: typeof builderInclude }>;

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
          ownershipHistory: {
            where: { eventType: { in: ['INITIAL', 'TRANSFER_IN'] } },
            orderBy: { effectiveDate: 'desc' },
            take: 1,
          },
        },
      },
    },
  });

  if (!outbound) throw new Error(`Outbound event ${outboundEventId} not found`);

  const lot = outbound.lot;
  const ratePlan = lot.ratePlan;

  // periodStart: latest ownership effective date or lot inbound date
  const latestOwnership = lot.ownershipHistory[0];
  const periodStart: Date = latestOwnership ? latestOwnership.effectiveDate : lot.inboundDate;
  const periodEnd: Date = outbound.outboundDate;

  const charge = computeStorageCharge({
    rateType: ratePlan.rateType,
    rateAmountPkr: Number(ratePlan.rateAmountPkr),
    quantityBags: outbound.quantityWithdrawnBags,
    periodStart,
    periodEnd,
    minBillingDays: ratePlan.minBillingDays,
  });

  const subTotal = charge.amountPkr;

  // GST default: pre-fill from facility settings when GST-registered.
  // Still editable per invoice while DRAFT (PATCH /v1/invoices/:id).
  const facility = await tx.facility.findUnique({
    where: { id: outbound.facilityId },
  });
  const settings = resolveFacilitySettings(facility?.settings ?? null);
  const gstRate = settings.gst_registered ? settings.gst_default_rate : 0;
  const gstAmount = Math.round(subTotal * (gstRate / 100) * 100) / 100;
  const total = Math.round((subTotal + gstAmount) * 100) / 100;

  return tx.invoice.create({
    data: {
      facilityId: outbound.facilityId,
      lotId: outbound.lotId,
      outboundEventId,
      billingPartyId: lot.billingPartyId,
      invoiceDate: new Date(),
      periodStart,
      periodEnd,
      subTotalPkr: subTotal,
      gstRate,
      gstAmountPkr: gstAmount,
      totalPkr: total,
      amountPaidPkr: 0,
      status: 'DRAFT',
      bookType: lot.bookType,
      createdBy: outbound.createdBy,
      lineItems: {
        create: {
          lineType: 'STORAGE',
          description: charge.description,
          quantity: charge.quantity,
          unitPricePkr: charge.unitPricePkr,
          amountPkr: charge.amountPkr,
          ratePlanId: ratePlan.id,
          sortOrder: 0,
        },
      },
    },
    include: builderInclude,
  });
}
