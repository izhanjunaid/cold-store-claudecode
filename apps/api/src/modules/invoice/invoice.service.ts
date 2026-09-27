import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { InvoiceRepository, type InvoiceWithRelations } from './invoice.repository';
import { generateInvoiceNumber } from './invoice-number';
import { renderInvoice } from '../pdf/pdf.service';
import { lockRow } from '../../common/row-lock';
import { round2, toIsoDate } from '@coldchain/shared';
import { settlementOf, SETTLEMENT_INCLUDE } from './invoice-settlement';
import { resolveFacilitySettings } from '../facility/facility.service';
import type {
  InvoiceListQueryType,
  AddInvoiceLineRequestType,
  UpdateDraftInvoiceRequestType,
  FinalizeInvoiceRequestType,
  VoidInvoiceRequestType,
} from '@coldchain/shared';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE01InvoiceFinalized } from '../accounting/templates/je-01-invoice-finalized';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';
import { revenueAccountForLine, REVENUE_LINE_INCLUDE } from './revenue-account';

function formatInvoice(inv: InvoiceWithRelations) {
  const settlement = settlementOf(inv);
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
    discount_type: inv.discountType ?? null,
    discount_value: inv.discountValue != null ? Number(inv.discountValue) : null,
    discount_amount_pkr: Number(inv.discountAmountPkr),
    gst_rate: Number(inv.gstRate),
    gst_amount_pkr: Number(inv.gstAmountPkr),
    total_pkr: Number(inv.totalPkr),
    amount_paid_pkr: settlement.paidPkr,
    amount_credited_pkr: settlement.creditedPkr,
    amount_written_off_pkr: settlement.writtenOffPkr,
    balance_due_pkr: round2(Number(inv.totalPkr) - settlement.settledPkr),
    status: inv.status,
    finalized_at: inv.finalizedAt?.toISOString() ?? null,
    finalized_by: inv.finalizedBy ?? null,
    book_type: inv.bookType,
    notes: inv.notes,
    voided_at: inv.voidedAt?.toISOString() ?? null,
    void_reason: inv.voidReason,
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
      ...SETTLEMENT_INCLUDE,
    },
  });
}

export class InvoiceService {
  constructor(
    private prisma: PrismaClient,
    private repo: InvoiceRepository,
    private journalEntry: JournalEntryService,
  ) {}

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
      meta: { total, page: query.page, per_page: query.page_size },
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

    // A line adds a charge. A reduction is the invoice's discount, which already posts
    // to 4910 and which GST and credit notes pro-rate (docs/25 R-07).
    if (!(body.unit_price_pkr > 0)) {
      throw Errors.VALIDATION_ERROR('A line must be a charge; give a reduction as the invoice discount', 'unit_price_pkr');
    }

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

  async updateDraft(
    facilityId: string,
    invoiceId: string,
    body: UpdateDraftInvoiceRequestType,
  ) {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();
    if (inv.status !== 'DRAFT') throw Errors.INVOICE_ALREADY_FINALIZED();

    return this.prisma.$transaction(async (tx) => {
      const data: Prisma.InvoiceUpdateInput = {};
      if (body.gst_rate !== undefined && body.gst_rate > 0 && inv.bookType === 'KATCHI') {
        throw Errors.VALIDATION_ERROR('An invoice on the KATCHI book carries no sales tax', 'gst_rate');
      }
      if (body.gst_rate !== undefined) data.gstRate = body.gst_rate;
      if (body.invoice_date !== undefined) {
        const invoiceDate = new Date(`${body.invoice_date}T00:00:00.000Z`);
        if (invoiceDate < inv.periodEnd) {
          throw Errors.VALIDATION_ERROR(
            `An invoice cannot be dated before the storage it bills ended (${toIsoDate(inv.periodEnd)})`,
            'invoice_date',
          );
        }
        data.invoiceDate = invoiceDate;
      }
      if (body.discount !== undefined) {
        if (body.discount === null) {
          data.discountType = null;
          data.discountValue = null;
        } else {
          data.discountType = body.discount.type;
          data.discountValue = body.discount.value;
        }
      }
      await tx.invoice.update({ where: { id: invoiceId }, data });
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
    if (line.lineType === 'STORAGE') {
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
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'invoices', invoiceId, facilityId))) throw Errors.INVOICE_NOT_FOUND();
      const inv = await tx.invoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: {
          billingParty: { select: RECEIVABLE_PARTY_SELECT },
          lot: { select: { id: true, lotNumber: true, commodity: { select: { revenueAccountCode: true } } } },
          lineItems: { orderBy: { sortOrder: 'asc' }, include: REVENUE_LINE_INCLUDE },
        },
      });
      if (inv.status !== 'DRAFT') throw Errors.INVOICE_ALREADY_FINALIZED();
      // A draft saved by an older version may still carry a negative adjustment line;
      // a reduction is a discount now (docs/25 R-07).
      if (inv.lineItems.some((l) => Number(l.amountPkr) <= 0)) {
        throw Errors.VALIDATION_ERROR('Remove the negative adjustment and give the reduction as a discount', 'line_items');
      }
      if (body.notes) {
        await tx.invoice.update({ where: { id: invoiceId }, data: { notes: body.notes } });
      }
      // Number from the invoice's own date, not the wall clock at finalize: a backdated
      // invoice belongs to its own month's sequence, matching the period it posts to.
      const invoiceNumber = await generateInvoiceNumber(tx, facilityId, inv.invoiceDate);
      const updated = await this.repo.finalize(tx, invoiceId, invoiceNumber, userId);

      // JE-01 posts atomically with finalize, so the GL always agrees with the invoice.
      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE01InvoiceFinalized({
          invoiceId: inv.id,
          invoiceNumber,
          invoiceDate: inv.invoiceDate,
          totalPkr: Number(inv.totalPkr),
          gstAmountPkr: Number(inv.gstAmountPkr),
          discountAmountPkr: Number(inv.discountAmountPkr),
          bookType: inv.bookType,
          billingParty: receivableParty(inv.billingParty),
          lot: { id: inv.lot.id, lotNumber: inv.lot.lotNumber },
          lines: inv.lineItems.map((l) => ({
            revenueAccountCode: revenueAccountForLine(l, inv.lot.commodity),
            amountPkr: Number(l.amountPkr),
          })),
        }),
      );
      await tx.invoice.update({ where: { id: invoiceId }, data: { journalEntryId: posted.id } });

      return formatInvoice(updated);
    });
  }

  /**
   * Void a finalized, unpaid invoice: post a full reversal of its JE-01 and set
   * status VOID. Only allowed when nothing downstream has consumed the invoice
   * (no payments, credit notes or surcharges) — otherwise correct it with a
   * credit note or a bad-debt write-off instead (phase/19 audit).
   */
  async void(facilityId: string, invoiceId: string, userId: string, body: VoidInvoiceRequestType) {
    await this.prisma.$transaction(async (tx) => {
      // Row-lock the invoice so a concurrent payment can't slip in.
      if (!(await lockRow(tx, 'invoices', invoiceId, facilityId))) throw Errors.INVOICE_NOT_FOUND();
      const inv = await tx.invoice.findFirst({ where: { id: invoiceId, facilityId } });
      if (!inv) throw Errors.INVOICE_NOT_FOUND();
      if (inv.status !== 'FINALIZED') {
        throw Errors.INVOICE_NOT_VOIDABLE('Only a FINALIZED invoice can be voided');
      }
      if (Number(inv.amountPaidPkr) > 0.005) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has payments or credits applied; use a credit note or write-off');
      }
      if (!inv.journalEntryId) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has no journal entry to reverse');
      }

      const creditNotes = await tx.creditNote.count({ where: { facilityId, originalInvoiceId: invoiceId, voidedAt: null } });
      if (creditNotes > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has credit notes; use a credit note flow instead');
      }
      const liveAllocations = await tx.paymentAllocation.count({ where: { invoiceId, voidedAt: null } });
      if (liveAllocations > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has active payment allocations');
      }
      // A surcharge invoice stands on this one; void it first. (A legacy JE-21 is a
      // line of its own on the party's account and does not block — docs/25 R-08.)
      const surcharges = await tx.invoice.count({
        where: { facilityId, surchargeOfInvoiceId: invoiceId, status: { not: 'VOID' } },
      });
      if (surcharges > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has late-payment surcharge invoices; void those first');
      }

      const voidDate = body.void_date ? new Date(body.void_date) : new Date();
      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, inv.journalEntryId, {
        reason: `void of invoice ${inv.invoiceNumber ?? invoiceId} — ${body.reason}`,
        date: voidDate,
      });

      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'VOID', voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });
    });

    // Re-read after commit so the response reflects the VOID status + reversal.
    const full = await this.repo.findById(facilityId, invoiceId);
    if (!full) throw Errors.INVOICE_NOT_FOUND();
    return formatInvoice(full);
  }

  async getPdf(facilityId: string, invoiceId: string): Promise<{ filename: string; pdf: Buffer }> {
    const inv = await this.repo.findById(facilityId, invoiceId);
    if (!inv) throw Errors.INVOICE_NOT_FOUND();

    const facility = await this.prisma.facility.findUnique({ where: { id: facilityId } });
    const numberLocale = resolveFacilitySettings(facility?.settings ?? null).number_format;

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
      discountLabel:
        Number(inv.discountAmountPkr) > 0
          ? inv.discountType === 'PERCENT'
            ? `Discount (${Number(inv.discountValue)}%)`
            : 'Discount'
          : null,
      discountAmountPkr: Number(inv.discountAmountPkr),
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
    }, numberLocale);

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
