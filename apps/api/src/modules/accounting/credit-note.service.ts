import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { JournalEntryService } from './journal-entry.service';
import { generateCreditNoteNumber } from './journal-entry-number';
import { buildJE05CreditNote } from './templates/je-05-credit-note';
import type { CreateCreditNoteRequestType, CreditNoteListQueryType } from '@coldchain/shared';

const include = {
  originalInvoice: { select: { id: true, invoiceNumber: true, totalPkr: true, amountPaidPkr: true, billingPartyId: true, status: true } },
  billingParty: { select: { id: true, name: true, partyType: true } },
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
    credit_date: cn.creditDate.toISOString().slice(0, 10),
    reason: cn.reason,
    total_pkr: Number(cn.totalPkr),
    status: cn.status,
    book_type: cn.bookType,
    journal_entry_id: cn.journalEntryId,
    journal_entry_number: cn.journalEntry?.entryNumber ?? null,
    notes: cn.notes,
    created_at: cn.createdAt.toISOString(),
    created_by_name: cn.createdByUser.name,
    line_items: cn.lineItems.map((l) => ({
      id: l.id,
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

  async create(facilityId: string, userId: string, body: CreateCreditNoteRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({
        where: { id: body.original_invoice_id, facilityId },
        include: { billingParty: { select: { id: true, name: true, partyType: true } } },
      });
      if (!invoice) throw Errors.INVOICE_NOT_FOUND();
      if (invoice.status !== 'FINALIZED') throw Errors.INVOICE_NOT_FINALIZED();

      const total = body.line_items.reduce((s, l) => s + l.amount_pkr, 0);
      const balanceDue = Number(invoice.totalPkr) - Number(invoice.amountPaidPkr);
      if (total > balanceDue + 0.001 && total > Number(invoice.totalPkr) + 0.001) {
        throw Errors.CREDIT_NOTE_EXCEEDS_INVOICE();
      }

      // Validate revenue account codes exist
      const codes = Array.from(new Set(body.line_items.map((l) => l.revenue_account_code)));
      const accounts = await tx.chartOfAccounts.findMany({
        where: { facilityId, accountCode: { in: codes } },
      });
      const found = new Set(accounts.map((a) => a.accountCode));
      for (const code of codes) {
        if (!found.has(code)) throw Errors.ACCOUNT_NOT_FOUND();
      }

      const creditDate = new Date(body.credit_date);
      const cnNumber = await generateCreditNoteNumber(tx, facilityId, creditDate);

      // Create credit note + line items
      const created = await tx.creditNote.create({
        data: {
          facilityId,
          creditNoteNumber: cnNumber,
          originalInvoiceId: invoice.id,
          billingPartyId: invoice.billingPartyId,
          creditDate,
          reason: body.reason,
          totalPkr: total,
          status: 'ISSUED',
          bookType: body.book_type ?? 'PACCI',
          notes: body.notes ?? null,
          createdBy: userId,
          lineItems: {
            create: body.line_items.map((l, idx) => ({
              revenueAccountCode: l.revenue_account_code,
              description: l.description,
              amountPkr: l.amount_pkr,
              sortOrder: idx,
            })),
          },
        },
        include,
      });

      // Post JE-05
      const draft = buildJE05CreditNote({
        creditNoteId: created.id,
        creditNoteNumber: cnNumber,
        creditDate,
        bookType: created.bookType as 'PACCI' | 'KATCHI',
        party: invoice.billingParty,
        invoice: { id: invoice.id, invoiceNumber: invoice.invoiceNumber },
        lineItems: body.line_items.map((l) => ({
          revenueAccountCode: l.revenue_account_code,
          description: l.description,
          amountPkr: l.amount_pkr,
        })),
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      // Reduce invoice's effective AR by reducing total_pkr is wrong (the original is immutable);
      // the credit note's JE-05 already debits revenue and credits AR — net effect is the AR
      // ledger drops by `total`. We update the credit note with journalEntryId and APPLIED status.
      const updated = await tx.creditNote.update({
        where: { id: created.id },
        data: { journalEntryId: posted.id, status: 'APPLIED' },
        include,
      });

      // Decrement amount_paid is wrong; credit notes reduce gross AR not cash receipts.
      // Convention: increment amount_paid by the credit-note total so balance_due drops to reflect
      // settled portion. This makes the invoice's `balance_due_pkr` accurate post-credit.
      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidPkr: { increment: total } },
      });

      return format(updated);
    });
  }

  async list(facilityId: string, query: CreditNoteListQueryType) {
    const where: Prisma.CreditNoteWhereInput = { facilityId };
    if (query.invoice_id) where.originalInvoiceId = query.invoice_id;
    if (query.billing_party_id) where.billingPartyId = query.billing_party_id;
    if (query.status) where.status = query.status;
    if (query.date_from || query.date_to) {
      where.creditDate = {};
      if (query.date_from) (where.creditDate as any).gte = new Date(query.date_from);
      if (query.date_to) (where.creditDate as any).lte = new Date(query.date_to);
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
