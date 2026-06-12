import type { PrismaClient, Prisma, InvoiceStatus } from '@coldchain/db';
import { Errors } from '../../common/errors';

export function computeDiscountAmount(
  subTotal: number,
  discountType: 'PERCENT' | 'FIXED' | null,
  discountValue: number | null,
): number {
  if (!discountType || discountValue == null) return 0;
  const amount =
    discountType === 'PERCENT'
      ? Math.round(subTotal * (discountValue / 100) * 100) / 100
      : discountValue;
  if (amount > subTotal) throw Errors.INVOICE_DISCOUNT_EXCEEDS_SUBTOTAL();
  return amount;
}

const invoiceInclude = {
  lot: { select: { lotNumber: true } },
  billingParty: { select: { name: true } },
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.InvoiceInclude;

export type InvoiceWithRelations = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;

export class InvoiceRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(facilityId: string, id: string): Promise<InvoiceWithRelations | null> {
    return this.prisma.invoice.findFirst({
      where: { id, facilityId },
      include: invoiceInclude,
    });
  }

  async findByOutboundEventId(outboundEventId: string): Promise<InvoiceWithRelations | null> {
    return this.prisma.invoice.findFirst({
      where: { outboundEventId },
      include: invoiceInclude,
    });
  }

  async findByLot(facilityId: string, lotId: string): Promise<InvoiceWithRelations[]> {
    return this.prisma.invoice.findMany({
      where: { facilityId, lotId },
      include: invoiceInclude,
      orderBy: { createdAt: 'desc' },
    });
  }

  async list(
    facilityId: string,
    filters: {
      partyId?: string;
      lotId?: string;
      status?: InvoiceStatus;
      dateFrom?: string;
      dateTo?: string;
    },
    pagination: { page: number; pageSize: number },
  ): Promise<{ data: InvoiceWithRelations[]; total: number }> {
    const where: Prisma.InvoiceWhereInput = {
      facilityId,
      ...(filters.partyId ? { billingPartyId: filters.partyId } : {}),
      ...(filters.lotId ? { lotId: filters.lotId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.dateFrom || filters.dateTo
        ? {
            invoiceDate: {
              ...(filters.dateFrom ? { gte: new Date(filters.dateFrom) } : {}),
              ...(filters.dateTo ? { lte: new Date(filters.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: { invoiceDate: 'desc' },
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.invoice.count({ where }),
    ]);

    return { data, total };
  }

  async create(
    tx: Prisma.TransactionClient,
    data: Prisma.InvoiceUncheckedCreateInput,
  ): Promise<InvoiceWithRelations> {
    return tx.invoice.create({ data, include: invoiceInclude });
  }

  async addLine(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    line: Omit<Prisma.InvoiceLineItemUncheckedCreateInput, 'invoiceId'>,
  ): Promise<void> {
    await tx.invoiceLineItem.create({ data: { ...line, invoiceId } });
  }

  async removeLine(tx: Prisma.TransactionClient, lineId: string): Promise<void> {
    await tx.invoiceLineItem.delete({ where: { id: lineId } });
  }

  async recomputeTotals(tx: Prisma.TransactionClient, invoiceId: string): Promise<void> {
    const lines = await tx.invoiceLineItem.findMany({ where: { invoiceId } });
    const subTotal = lines.reduce((sum, l) => sum + Number(l.amountPkr), 0);
    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    const gstRate = Number(invoice?.gstRate ?? 0);
    const discount = computeDiscountAmount(
      subTotal,
      (invoice?.discountType as 'PERCENT' | 'FIXED' | null) ?? null,
      invoice?.discountValue != null ? Number(invoice.discountValue) : null,
    );
    // GST applies to the post-discount taxable value
    const gstAmount = Math.round((subTotal - discount) * (gstRate / 100) * 100) / 100;
    const total = Math.round((subTotal - discount + gstAmount) * 100) / 100;

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        subTotalPkr: subTotal,
        discountAmountPkr: discount,
        gstAmountPkr: gstAmount,
        totalPkr: total,
      },
    });
  }

  async finalize(
    tx: Prisma.TransactionClient,
    invoiceId: string,
    invoiceNumber: string,
    userId: string,
  ): Promise<InvoiceWithRelations> {
    return tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: 'FINALIZED',
        invoiceNumber,
        finalizedAt: new Date(),
        finalizedBy: userId,
      },
      include: invoiceInclude,
    });
  }
}
