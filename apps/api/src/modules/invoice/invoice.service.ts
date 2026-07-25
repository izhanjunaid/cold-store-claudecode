import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { InvoiceRepository, type InvoiceWithRelations } from './invoice.repository';
import { buildInvoiceFromOutbound } from './invoice.builder';
import { generateInvoiceNumber } from './invoice-number';
import { renderInvoice } from '../pdf/pdf.service';
import type {
  InvoiceListQueryType,
  AddInvoiceLineRequestType,
  UpdateDraftInvoiceRequestType,
  FinalizeInvoiceRequestType,
  VoidInvoiceRequestType,
} from '@coldchain/shared';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE01InvoiceFinalized } from '../accounting/templates/je-01-invoice-finalized';

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
    discount_type: inv.discountType ?? null,
    discount_value: inv.discountValue != null ? Number(inv.discountValue) : null,
    discount_amount_pkr: Number(inv.discountAmountPkr),
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
    private journalEntry?: JournalEntryService,
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
      if (body.gst_rate !== undefined) data.gstRate = body.gst_rate;
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
      // Number from the invoice's own date, not the wall clock at finalize: a backdated
      // invoice belongs to its own month's sequence, matching the period it posts to.
      // The advisory lock inside the generator is keyed on the same date, so the lock
      // and the number always agree on which month is being extended.
      const invoiceNumber = await generateInvoiceNumber(tx, facilityId, inv.invoiceDate);
      const updated = await this.repo.finalize(tx, invoiceId, invoiceNumber, userId);

      // Phase 8: post JE-01 atomically with finalize so the GL is always reconciled.
      if (this.journalEntry) {
        const context = await tx.invoice.findFirstOrThrow({
          where: { id: invoiceId },
          include: {
            billingParty: { select: { id: true, name: true, partyType: true } },
            lot: {
              select: {
                id: true,
                lotNumber: true,
                commodity: { select: { name: true } },
              },
            },
            lineItems: {
              orderBy: { sortOrder: 'asc' },
              include: {
                serviceCharge: { select: { revenueAccountCode: true } },
                ratePlan: { select: { revenueAccountCode: true } },
              },
            },
          },
        });

        const draft = buildJE01InvoiceFinalized({
          invoiceId: context.id,
          invoiceNumber: context.invoiceNumber ?? invoiceNumber,
          invoiceDate: context.invoiceDate,
          totalPkr: Number(context.totalPkr),
          gstAmountPkr: Number(context.gstAmountPkr),
          discountAmountPkr: Number(context.discountAmountPkr),
          bookType: context.bookType as 'PACCI' | 'KATCHI',
          billingParty: {
            id: context.billingParty.id,
            partyType: context.billingParty.partyType,
            name: context.billingParty.name,
          },
          lot: {
            id: context.lot.id,
            lotNumber: context.lot.lotNumber,
            commodityName: context.lot.commodity.name,
          },
          lines: context.lineItems.map((l) => ({
            lineType: l.lineType,
            description: l.description,
            amountPkr: Number(l.amountPkr),
            serviceChargeRevenueCode: l.serviceCharge?.revenueAccountCode ?? null,
            ratePlanRevenueCode: l.ratePlan?.revenueAccountCode ?? null,
          })),
        });

        const posted = await this.journalEntry.postInTransaction(
          tx,
          facilityId,
          userId,
          draft,
          { postingStatus: 'POSTED' },
        );
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { journalEntryId: posted.id },
        });
      }

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
      await tx.$queryRawUnsafe(
        `SELECT id FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        invoiceId,
        facilityId,
      );
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

      const creditNotes = await tx.creditNote.count({ where: { facilityId, originalInvoiceId: invoiceId } });
      if (creditNotes > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has credit notes; use a credit note flow instead');
      }
      const liveAllocations = await tx.paymentAllocation.count({ where: { invoiceId, voidedAt: null } });
      if (liveAllocations > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has active payment allocations');
      }
      const surcharges = await tx.journalEntry.count({
        where: { facilityId, sourceTable: 'invoice_surcharge', sourceId: invoiceId, postingStatus: 'POSTED' },
      });
      if (surcharges > 0) {
        throw Errors.INVOICE_NOT_VOIDABLE('Invoice has late-payment surcharges; reverse those first');
      }

      const original = await tx.journalEntry.findFirstOrThrow({
        where: { id: inv.journalEntryId, facilityId },
        include: { lines: { orderBy: { lineNumber: 'asc' } } },
      });

      const voidDate = body.void_date ? new Date(body.void_date) : new Date();
      const reversal = await this.journalEntry!.postInTransaction(
        tx,
        facilityId,
        userId,
        {
          entryType: 'REVERSAL',
          bookType: original.bookType,
          sourceTable: 'invoices',
          sourceId: invoiceId,
          entryDate: voidDate,
          description: `Void of invoice ${inv.invoiceNumber ?? invoiceId} — ${body.reason}`,
          lines: original.lines.map((l) => ({
            accountCode: l.accountCode,
            debitAmount: Number(l.creditAmount),
            creditAmount: Number(l.debitAmount),
            partyId: l.partyId,
            lotId: l.lotId,
            description: l.description,
          })),
        },
        { postingStatus: 'POSTED' },
      );
      await this.journalEntry!.markReversed(tx, original.id, reversal.id);

      const voidTag = `[VOID ${voidDate.toISOString().slice(0, 10)}]: ${body.reason}`;
      await tx.invoice.update({
        where: { id: invoiceId },
        data: {
          status: 'VOID',
          notes: inv.notes ? `${inv.notes}\n${voidTag}` : voidTag,
        },
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
