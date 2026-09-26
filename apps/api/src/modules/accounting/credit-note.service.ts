import type { PrismaClient, Prisma } from '@coldchain/db';
import { round2, toIsoDate } from '@coldchain/shared';
import type {
  IssueCreditNoteRequestType,
  CancelCreditNoteRequestType,
  CreditNoteListQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { JournalEntryService, postedEntryNumber } from './journal-entry.service';
import { generateCreditNoteNumber } from './journal-entry-number';
import { buildJE05CreditNote } from './templates/je-05-credit-note';
import { assertKatchiWriteAllowed } from './book-gate';
import { refreshInvoiceSettlement } from '../invoice/invoice-settlement';
import { revenueAccountForLine, REVENUE_LINE_INCLUDE } from '../invoice/revenue-account';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';

const include = {
  originalInvoice: { select: { id: true, invoiceNumber: true } },
  billingParty: { select: { id: true, name: true } },
  journalEntry: { select: { entryNumber: true } },
  createdByUser: { select: { name: true } },
  lineItems: { orderBy: { sortOrder: 'asc' as const } },
} satisfies Prisma.CreditNoteInclude;

type CreditNoteWithRelations = Prisma.CreditNoteGetPayload<{ include: typeof include }>;

function format(cn: CreditNoteWithRelations) {
  return {
    id: cn.id,
    facility_id: cn.facilityId,
    credit_note_number: cn.creditNoteNumber,
    original_invoice_id: cn.originalInvoiceId,
    original_invoice_number: cn.originalInvoice.invoiceNumber ?? null,
    billing_party_id: cn.billingPartyId,
    billing_party_name: cn.billingParty.name,
    credit_date: toIsoDate(cn.creditDate),
    reason: cn.reason,
    total_pkr: Number(cn.totalPkr),
    gst_amount_pkr: Number(cn.gstAmountPkr),
    status: cn.status,
    book_type: cn.bookType,
    journal_entry_id: cn.journalEntryId,
    journal_entry_number: cn.journalEntry?.entryNumber ?? null,
    notes: cn.notes,
    voided_at: cn.voidedAt?.toISOString() ?? null,
    void_reason: cn.voidReason,
    /** The server's own rule for whether it can still be cancelled. */
    can_cancel: cn.voidedAt === null,
    created_at: cn.createdAt.toISOString(),
    created_by_name: cn.createdByUser.name,
    line_items: cn.lineItems.map((l) => ({
      id: l.id,
      invoice_line_item_id: l.invoiceLineItemId,
      revenue_account_code: l.revenueAccountCode,
      description: l.description,
      amount_pkr: Number(l.amountPkr),
      sort_order: l.sortOrder,
    })),
  };
}

export class CreditNoteService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  /**
   * Issue a credit note against a finalized invoice, built from the invoice's own
   * lines (docs/25 R-03): each credited line reverses its own revenue account,
   * and the credit carries its pro-rata share of the invoice's discount and output
   * tax. The book is the invoice's (R-04), and the invoice is row-locked so a
   * payment racing it cannot over-settle (R-23).
   */
  async create(facilityId: string, userId: string, role: string, body: IssueCreditNoteRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'invoices', body.original_invoice_id, facilityId))) throw Errors.INVOICE_NOT_FOUND();
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: body.original_invoice_id },
        include: {
          billingParty: { select: RECEIVABLE_PARTY_SELECT },
          lot: { select: { commodity: { select: { revenueAccountCode: true } } } },
          lineItems: { include: REVENUE_LINE_INCLUDE },
        },
      });
      if (invoice.status !== 'FINALIZED') throw Errors.INVOICE_NOT_FINALIZED();
      assertKatchiWriteAllowed(role, invoice.bookType);

      const credited = await tx.creditNoteLineItem.groupBy({
        by: ['invoiceLineItemId'],
        where: { creditNote: { originalInvoiceId: invoice.id, voidedAt: null }, invoiceLineItemId: { not: null } },
        _sum: { amountPkr: true },
      });
      const creditedByLine = new Map(credited.map((c) => [c.invoiceLineItemId, Number(c._sum.amountPkr ?? 0)]));

      const items = body.line_items.map((req, idx) => {
        const line = invoice.lineItems.find((l) => l.id === req.invoice_line_item_id);
        if (!line) throw Errors.VALIDATION_ERROR('That line is not on this invoice', `line_items.${idx}.invoice_line_item_id`);
        const left = round2(Number(line.amountPkr) - (creditedByLine.get(line.id) ?? 0));
        if (req.amount_pkr > left + 0.005) {
          throw Errors.VALIDATION_ERROR(`Only Rs ${left} of "${line.description}" is left to credit`, `line_items.${idx}.amount_pkr`);
        }
        creditedByLine.set(line.id, (creditedByLine.get(line.id) ?? 0) + req.amount_pkr);
        return {
          invoiceLineItemId: line.id,
          revenueAccountCode: revenueAccountForLine(line, invoice.lot.commodity),
          description: req.description ?? line.description,
          amountPkr: round2(req.amount_pkr),
        };
      });

      // The discount was taken off the subtotal and the tax charged on what was left,
      // so the credited revenue carries the same proportions.
      const revenue = round2(items.reduce((s, i) => s + i.amountPkr, 0));
      const subTotal = Number(invoice.subTotalPkr);
      const discount = Number(invoice.discountAmountPkr);
      const taxable = subTotal - discount;
      const discountPkr = subTotal > 0 ? round2((revenue * discount) / subTotal) : 0;
      const gstPkr = taxable > 0 ? round2(((revenue - discountPkr) * Number(invoice.gstAmountPkr)) / taxable) : 0;
      const total = round2(revenue - discountPkr + gstPkr);

      // A credit note reduces what is still owed; refunding a settled invoice is a different workflow.
      const balanceDue = round2(Number(invoice.totalPkr) - Number(invoice.amountPaidPkr));
      if (total > balanceDue + 0.005) throw Errors.CREDIT_NOTE_EXCEEDS_INVOICE();

      const creditDate = new Date(`${body.credit_date}T00:00:00.000Z`);
      const cnNumber = await generateCreditNoteNumber(tx, facilityId, creditDate);
      const created = await tx.creditNote.create({
        data: {
          facilityId,
          creditNoteNumber: cnNumber,
          originalInvoiceId: invoice.id,
          billingPartyId: invoice.billingPartyId,
          creditDate,
          reason: body.reason,
          totalPkr: total,
          gstAmountPkr: gstPkr,
          status: 'APPLIED',
          bookType: invoice.bookType,
          notes: body.notes ?? null,
          createdBy: userId,
          lineItems: { create: items.map((i, idx) => ({ ...i, sortOrder: idx })) },
        },
      });

      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE05CreditNote({
          creditNoteId: created.id,
          creditNoteNumber: cnNumber,
          creditDate,
          bookType: invoice.bookType,
          party: receivableParty(invoice.billingParty),
          invoiceNumber: invoice.invoiceNumber ?? invoice.id,
          lineItems: items,
          discountPkr,
          gstPkr,
        }),
      );
      await tx.creditNote.update({ where: { id: created.id }, data: { journalEntryId: posted.id } });
      await refreshInvoiceSettlement(tx, invoice.id);
      return format(await tx.creditNote.findUniqueOrThrow({ where: { id: created.id }, include }));
    });
  }

  /**
   * Cancel a credit note: its JE-05 is reversed and the invoice owes again
   * (docs/25 R-23). The cancellation is recorded in its own columns.
   */
  async cancel(facilityId: string, userId: string, role: string, id: string, body: CancelCreditNoteRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'credit_notes', id, facilityId))) throw Errors.CREDIT_NOTE_NOT_FOUND();
      const cn = await tx.creditNote.findUniqueOrThrow({ where: { id } });
      assertKatchiWriteAllowed(role, cn.bookType);
      if (cn.voidedAt) throw Errors.VALIDATION_ERROR('This credit note is already cancelled', 'id');
      await lockRow(tx, 'invoices', cn.originalInvoiceId, facilityId);
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: cn.originalInvoiceId }, select: { status: true } });
      if (invoice.status !== 'FINALIZED') {
        throw Errors.VALIDATION_ERROR(`The invoice is ${invoice.status}; its credit notes can no longer change`, 'id');
      }
      if (!cn.journalEntryId) throw Errors.VALIDATION_ERROR('This credit note has no journal entry to reverse', 'id');

      const date = body.cancel_date ? new Date(`${body.cancel_date}T00:00:00.000Z`) : undefined;
      const je = await tx.journalEntry.findUniqueOrThrow({ where: { id: cn.journalEntryId } });
      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, cn.journalEntryId, {
        reason: `credit note ${postedEntryNumber(je)} cancelled — ${body.reason}`,
        date,
      });
      await tx.creditNote.update({
        where: { id },
        data: { status: 'CANCELLED', voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });
      await refreshInvoiceSettlement(tx, cn.originalInvoiceId);
      return format(await tx.creditNote.findUniqueOrThrow({ where: { id }, include }));
    });
  }

  async list(facilityId: string, query: CreditNoteListQueryType) {
    const where: Prisma.CreditNoteWhereInput = { facilityId };
    if (query.invoice_id) where.originalInvoiceId = query.invoice_id;
    if (query.billing_party_id) where.billingPartyId = query.billing_party_id;
    if (query.status) where.status = query.status;
    if (query.date_from || query.date_to) {
      where.creditDate = {
        ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
        ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.creditNote.findMany({
        where,
        include,
        orderBy: { creditDate: 'desc' },
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.creditNote.count({ where }),
    ]);

    return {
      data: data.map(format),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }

  async getById(facilityId: string, id: string) {
    const cn = await this.prisma.creditNote.findFirst({ where: { id, facilityId }, include });
    if (!cn) throw Errors.CREDIT_NOTE_NOT_FOUND();
    return format(cn);
  }

  async listByInvoice(facilityId: string, invoiceId: string) {
    const data = await this.prisma.creditNote.findMany({
      where: { facilityId, originalInvoiceId: invoiceId },
      include,
      orderBy: { creditDate: 'desc' },
    });
    return data.map(format);
  }
}
