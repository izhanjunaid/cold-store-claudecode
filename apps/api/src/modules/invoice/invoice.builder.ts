import type { Prisma } from '@coldchain/db';
import { computeStorageCharge } from './storage-charge';

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
      gstRate: 0,
      gstAmountPkr: 0,
      totalPkr: subTotal,
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
