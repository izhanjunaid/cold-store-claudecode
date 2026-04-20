import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { InvoiceRepository, type InvoiceWithRelations } from './invoice.repository';
import { buildInvoiceFromOutbound } from './invoice.builder';
import { generateInvoiceNumber } from './invoice-number';
import { renderInvoice } from '../pdf/pdf.service';
import type {
  InvoiceListQueryType,
  AddInvoiceLineRequestType,
  FinalizeInvoiceRequestType,
} from '@coldchain/shared';

function formatInvoice(inv: InvoiceWithRelations) {
  return {
    id: inv.id,
    facility_id: inv.facilityId,
    invoice_number: inv.invoiceNumber,
    lot_id: inv.lotId,
    lot_number: inv.lot.lotNumber,
    outbound_event_id: inv.outboundEventId,
    billing_party_id: inv.billingPartyId,
    billing_party_name: inv.billingParty.name,
    invoice_date: inv.invoiceDate.toISOString().slice(0, 10),
    period_start: inv.periodStart.toISOString().slice(0, 10),
    period_end: inv.periodEnd.toISOString().slice(0, 10),
    sub_total_pkr: Number(inv.subTotalPkr),
    gst_rate: Number(inv.gstRate),
    gst_amount_pkr: Number(inv.gstAmountPkr),
    total_pkr: Number(inv.totalPkr),
    amount_paid_pkr: Number(inv.amountPaidPkr),
    balance_due_pkr: Number(inv.totalPkr) - Number(inv.amountPaidPkr),
    status: inv.status,
    finalized_at: inv.finalizedAt?.toISOString() ?? null,
    finalized_by: inv.finalizedBy ?? null,
    book_type: inv.bookType,
    notes: inv.notes,
    created_at: inv.createdAt.toISOString(),
    line_items: inv.lineItems.map((l) => ({
      id: l.id,
      invoice_id: l.invoiceId,
      line_type: l.lineType,
      description: l.description,
      quantity: Number(l.quantity),
      unit_price_pkr: Number(l.unitPricePkr),
      amount_pkr: Number(l.amountPkr),
      service_charge_id: l.serviceChargeId ?? null,
      rate_plan_id: l.ratePlanId ?? null,
      sort_order: l.sortOrder,
      created_at: l.createdAt.toISOString(),
    })),
  };
}

async function refreshInvoice(tx: Prisma.TransactionClient, id: string) {
  return tx.invoice.findFirst({
    where: { id },
    include: {
      lot: { select: { lotNumber: true } },
      billingParty: { select: { name: true } },
      lineItems: { orderBy: { sortOrder: 'asc' } },
    },
  });
}

export class InvoiceService {
  constructor(
    private prisma: PrismaClient,
    private repo: InvoiceRepository,
  ) {}

  async buildFromOutbound(tx: Prisma.TransactionClient, outboundEventId: string) {
    return buildInvoiceFromOutbound(tx, outboundEventId);
  }

  async list(facilityId: string, query: InvoiceListQueryType) {
    const { data, total } = await this.repo.list(
      facilityId,
      {
        partyId: query.party_id,
        lotId: query.lot_id,
        status: query.status as any,
        dateFrom: query.date_from,
        dateTo: query.date_to,
      },
      { page: query.page, pageSize: query.page_size },
    );
    return {
      data: data.map(formatInvoice),
      meta: { total, page: query.page, page_size: query.page_size },
    };
  }

  async getById(facilityId: string, id: string) {
    const inv = await this.repo.findById(facilityId, id);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    return formatInvoice(inv);
  }

  async addLine(facilityId: string, invoiceId: string, body: AddInvoiceLineRequestType) {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    if (inv.status !== 'DRAFT') throw Errors.INVOICE_ALREADY_FINALIZED();

    return this.prisma.$transaction(async (tx) => {
      const maxSort = inv.lineItems.length > 0 ? Math.max(...inv.lineItems.map((l) => l.sortOrder)) : 0;
      await this.repo.addLine(tx, invoiceId, {
        lineType: body.line_type,
        description: body.description,
        quantity: body.quantity,
        unitPricePkr: body.unit_price_pkr,
        amountPkr: body.quantity * body.unit_price_pkr,
        serviceChargeId: body.service_charge_id ?? null,
        sortOrder: maxSort + 1,
      });
      await this.repo.recomputeTotals(tx, invoiceId);
      const updated = await refreshInvoice(tx, invoiceId);
      return formatInvoice(updated!);
    });
  }

  async removeLine(facilityId: string, invoiceId: string, lineId: string) {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    if (inv.status !== 'DRAFT') throw Errors.INVOICE_ALREADY_FINALIZED();

    const line = inv.lineItems.find((l) => l.id === lineId);
    if (!line) throw Errors.INVOICE_LINE_NOT_FOUND();
    if (line.lineType === 'STORAGE' || line.lineType === 'ADVANCE_APPLIED') {
      throw Errors.INVOICE_LINE_IMMUTABLE();
    }

    return this.prisma.$transaction(async (tx) => {
      await this.repo.removeLine(tx, lineId);
      await this.repo.recomputeTotals(tx, invoiceId);
      const updated = await refreshInvoice(tx, invoiceId);
      return formatInvoice(updated!);
    });
  }

  async finalize(
    facilityId: string,
    invoiceId: string,
    userId: string,
    body: FinalizeInvoiceRequestType,
  ) {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    if (inv.status !== 'DRAFT') throw Errors.INVOICE_ALREADY_FINALIZED();

    return this.prisma.$transaction(async (tx) => {
      if (body.notes) {
        await tx.invoice.update({ where: { id: invoiceId }, data: { notes: body.notes } });
      }
      const invoiceNumber = await generateInvoiceNumber(tx, facilityId, new Date());
      const updated = await this.repo.finalize(tx, invoiceId, invoiceNumber, userId);
      return formatInvoice(updated);
    });
  }

  async getPdf(facilityId: string, invoiceId: string): Promise<{ filename: string; pdf: Buffer }> {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();

    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });

    const pdf = await renderInvoice({
      facilityName: facility?.name ?? 'Cold Store',
      facilityCity: facility?.city ?? 'Lahore',
      invoiceNumber: inv.invoiceNumber ?? inv.id.slice(0, 8),
      lotNumber: inv.lot.lotNumber,
      billingPartyName: inv.billingParty.name,
      invoiceDate: inv.invoiceDate.toISOString().slice(0, 10),
      periodStart: inv.periodStart.toISOString().slice(0, 10),
      periodEnd: inv.periodEnd.toISOString().slice(0, 10),
      subTotalPkr: Number(inv.subTotalPkr),
      gstRate: Number(inv.gstRate),
      gstAmountPkr: Number(inv.gstAmountPkr),
      totalPkr: Number(inv.totalPkr),
      amountPaidPkr: Number(inv.amountPaidPkr),
      balanceDuePkr: Number(inv.totalPkr) - Number(inv.amountPaidPkr),
      status: inv.status,
      isDraft: inv.status === 'DRAFT',
      lineItems: inv.lineItems.map((l) => ({
        lineType: l.lineType,
        description: l.description,
        quantity: Number(l.quantity),
        unitPricePkr: Number(l.unitPricePkr),
        amountPkr: Number(l.amountPkr),
      })),
    });

    return {
      filename: `${inv.invoiceNumber ?? inv.id.slice(0, 8)}.pdf`,
      pdf,
    };
  }

  async getByLot(facilityId: string, lotId: string) {
    const lot = await this.prisma.lot.findFirst({ where: { id: lotId, facilityId } });
    if (!lot) throw Errors.LOT_NOT_FOUND();
    const invoices = await this.repo.findByLot(facilityId, lotId);
    return invoices.map(formatInvoice);
  }
}
