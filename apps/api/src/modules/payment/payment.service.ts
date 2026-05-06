import type { PrismaClient } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { PaymentRepository, type PaymentWithRelations } from './payment.repository';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE02PaymentReceived } from '../accounting/templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../accounting/templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../accounting/templates/je-04-advance-applied';
import { buildJE06ChequeDishonoured } from '../accounting/templates/je-06-cheque-dishonoured';
import { assetAccountForPaymentMethod } from '../accounting/templates/types';

function toNumber(d: { toString(): string } | null | undefined): number | null {
  if (d == null) return null;
  return Number(d);
}

function formatPayment(p: PaymentWithRelations) {
  return {
    id: p.id,
    facility_id: p.facilityId,
    party_id: p.partyId,
    party_name: p.party.name,
    payment_date: p.paymentDate.toISOString().slice(0, 10),
    amount_pkr: Number(p.amountPkr),
    payment_method: p.paymentMethod,
    reference_number: p.referenceNumber ?? null,
    is_advance: p.isAdvance,
    status: p.status,
    clearance_status: p.clearanceStatus,
    cheque_date: p.chequeDate ? p.chequeDate.toISOString().slice(0, 10) : null,
    book_type: p.bookType,
    notes: p.notes ?? null,
    created_at: p.createdAt.toISOString(),
    created_by_name: p.createdByUser.name,
    allocations: p.allocations.map((a) => ({
      id: a.id,
      payment_id: a.paymentId,
      invoice_id: a.invoiceId,
      invoice_number: a.invoice.invoiceNumber ?? null,
      allocated_amount_pkr: Number(a.allocatedAmountPkr),
    })),
  };
}

export class PaymentService {
  constructor(
    private prisma: PrismaClient,
    private repo: PaymentRepository,
    private journalEntry?: JournalEntryService,
  ) {}

  async record(params: {
    facilityId: string;
    createdBy: string;
    partyId: string;
    paymentDate: string;
    amountPkr: number;
    paymentMethod: string;
    referenceNumber?: string;
    isAdvance?: boolean;
    chequeDate?: string;
    bookType?: string;
    notes?: string;
    allocations?: { invoice_id: string; allocated_amount_pkr: number }[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      // Validate party exists in facility
      const party = await tx.party.findFirst({
        where: { id: params.partyId, facilityId: params.facilityId },
      });
      if (!party) throw Errors.PARTY_NOT_FOUND();

      const isAdvance = params.isAdvance ?? false;
      const allocations = isAdvance ? [] : (params.allocations ?? []);

      // Validate allocation total <= amount
      const allocTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
      if (allocTotal > params.amountPkr + 0.001) {
        throw Errors.PAYMENT_OVER_ALLOCATED();
      }

      // Validate and row-lock each invoice
      for (const alloc of allocations) {
        const rows = await tx.$queryRawUnsafe<
          { id: string; status: string; billing_party_id: string; total_pkr: string; amount_paid_pkr: string }[]
        >(
          `SELECT id, status, billing_party_id, total_pkr, amount_paid_pkr FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
          alloc.invoice_id,
          params.facilityId,
        );
        const inv = rows[0];
        if (!inv) throw Errors.INVOICE_NOT_FOUND();
        if (inv.status !== 'FINALIZED') {
          throw Errors.VALIDATION_ERROR('Only FINALIZED invoices can be allocated', 'invoice_id');
        }
        if (inv.billing_party_id !== params.partyId) throw Errors.PAYMENT_PARTY_MISMATCH();
        const balanceDue = Number(inv.total_pkr) - Number(inv.amount_paid_pkr);
        if (alloc.allocated_amount_pkr > balanceDue + 0.001) {
          throw Errors.PAYMENT_EXCEEDS_INVOICE_BALANCE();
        }
      }

      // Determine status
      let status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' = 'RECORDED';
      if (isAdvance) status = 'ADVANCE';
      else if (allocations.length > 0) status = 'ALLOCATED';

      // Determine clearance status
      const clearanceStatus = params.paymentMethod === 'CHEQUE' ? 'CLEARED' : 'NA';

      const assetAccountCode = assetAccountForPaymentMethod(params.paymentMethod);
      const bookType = ((params.bookType as 'PACCI' | 'KATCHI' | undefined) ?? 'PACCI');

      const payment = await this.repo.create(tx, {
        facilityId: params.facilityId,
        partyId: params.partyId,
        paymentDate: new Date(params.paymentDate),
        amountPkr: params.amountPkr,
        paymentMethod: params.paymentMethod as any,
        referenceNumber: params.referenceNumber ?? null,
        isAdvance,
        status,
        clearanceStatus: clearanceStatus as any,
        chequeDate: params.chequeDate ? new Date(params.chequeDate) : null,
        bookType,
        assetAccountCode,
        notes: params.notes ?? null,
        createdBy: params.createdBy,
        allocations: {
          create: allocations.map((a) => ({
            invoiceId: a.invoice_id,
            allocatedAmountPkr: a.allocated_amount_pkr,
          })),
        },
      });

      // Update invoice amountPaidPkr for each allocation
      for (const alloc of allocations) {
        await tx.invoice.update({
          where: { id: alloc.invoice_id },
          data: { amountPaidPkr: { increment: alloc.allocated_amount_pkr } },
        });
      }

      // Phase 8: post JE-02 (regular) or JE-03 (advance) inside the same transaction.
      if (this.journalEntry) {
        const draft = isAdvance
          ? buildJE03AdvanceReceived({
              paymentId: payment.id,
              paymentDate: payment.paymentDate,
              amountPkr: Number(payment.amountPkr),
              paymentMethod: payment.paymentMethod,
              referenceNumber: payment.referenceNumber,
              bookType,
              party: { id: party.id, partyType: party.partyType, name: party.name },
              assetAccountCode,
            })
          : buildJE02PaymentReceived({
              paymentId: payment.id,
              paymentDate: payment.paymentDate,
              amountPkr: Number(payment.amountPkr),
              paymentMethod: payment.paymentMethod,
              referenceNumber: payment.referenceNumber,
              bookType,
              party: { id: party.id, partyType: party.partyType, name: party.name },
              assetAccountCode,
            });

        const posted = await this.journalEntry.postInTransaction(
          tx,
          params.facilityId,
          params.createdBy,
          draft,
          { postingStatus: 'POSTED' },
        );
        await tx.payment.update({
          where: { id: payment.id },
          data: { journalEntryId: posted.id },
        });
      }

      return formatPayment(payment);
    });
  }

  async list(
    facilityId: string,
    query: {
      partyId?: string;
      status?: string;
      paymentMethod?: string;
      dateFrom?: string;
      dateTo?: string;
      page: number;
      pageSize: number;
    },
  ) {
    const result = await this.repo.list(
      facilityId,
      {
        partyId: query.partyId,
        status: query.status as any,
        paymentMethod: query.paymentMethod as any,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      { page: query.page, pageSize: query.pageSize },
    );
    return {
      data: result.data.map(formatPayment),
      meta: {
        total: result.total,
        page: query.page,
        per_page: query.pageSize,
      },
    };
  }

  async getById(facilityId: string, id: string) {
    const payment = await this.repo.findById(facilityId, id);
    if (!payment) throw Errors.PAYMENT_NOT_FOUND();
    return formatPayment(payment);
  }

  async allocate(
    facilityId: string,
    id: string,
    allocations: { invoice_id: string; allocated_amount_pkr: number }[],
    userId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Row-lock the payment
      const rows = await tx.$queryRawUnsafe<
        { id: string; status: string; amount_pkr: string; party_id: string }[]
      >(
        `SELECT id, status, amount_pkr, party_id FROM payments WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        id,
        facilityId,
      );
      const paymentRow = rows[0];
      if (!paymentRow) throw Errors.PAYMENT_NOT_FOUND();
      if (paymentRow.status === 'DISHONOURED') throw Errors.PAYMENT_ALREADY_DISHONOURED();

      // Get existing allocations total
      const existing = await tx.paymentAllocation.findMany({
        where: { paymentId: id },
        select: { allocatedAmountPkr: true },
      });
      const existingTotal = existing.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
      const newTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);

      if (existingTotal + newTotal > Number(paymentRow.amount_pkr) + 0.001) {
        throw Errors.PAYMENT_OVER_ALLOCATED();
      }

      // Validate and lock each invoice
      for (const alloc of allocations) {
        const invRows = await tx.$queryRawUnsafe<
          { id: string; status: string; billing_party_id: string; total_pkr: string; amount_paid_pkr: string }[]
        >(
          `SELECT id, status, billing_party_id, total_pkr, amount_paid_pkr FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
          alloc.invoice_id,
          facilityId,
        );
        const inv = invRows[0];
        if (!inv) throw Errors.INVOICE_NOT_FOUND();
        if (inv.status !== 'FINALIZED') {
          throw Errors.VALIDATION_ERROR('Only FINALIZED invoices can be allocated', 'invoice_id');
        }
        if (inv.billing_party_id !== paymentRow.party_id) throw Errors.PAYMENT_PARTY_MISMATCH();
        const balanceDue = Number(inv.total_pkr) - Number(inv.amount_paid_pkr);
        if (alloc.allocated_amount_pkr > balanceDue + 0.001) {
          throw Errors.PAYMENT_EXCEEDS_INVOICE_BALANCE();
        }
      }

      // Create allocations
      const previousStatus = paymentRow.status;
      for (const alloc of allocations) {
        await tx.paymentAllocation.create({
          data: {
            paymentId: id,
            invoiceId: alloc.invoice_id,
            allocatedAmountPkr: alloc.allocated_amount_pkr,
          },
        });
        await tx.invoice.update({
          where: { id: alloc.invoice_id },
          data: { amountPaidPkr: { increment: alloc.allocated_amount_pkr } },
        });
      }

      // Phase 8: if this was an ADVANCE payment, posting allocations triggers JE-04 per invoice.
      // Regular payments don't post additional JE on allocate — JE-02 already covered the cash receipt;
      // allocations are sub-ledger detail (which invoice the cash is applied to).
      if (this.journalEntry && previousStatus === 'ADVANCE') {
        const partyRow = await tx.party.findFirstOrThrow({
          where: { id: paymentRow.party_id },
          select: { id: true, name: true, partyType: true },
        });
        const paymentDateRows = await tx.$queryRawUnsafe<{ payment_date: Date; book_type: string }[]>(
          `SELECT payment_date, book_type FROM payments WHERE id = $1::uuid`,
          id,
        );
        const paymentDate = new Date(paymentDateRows[0]?.payment_date ?? new Date());
        const bookType = (paymentDateRows[0]?.book_type ?? 'PACCI') as 'PACCI' | 'KATCHI';

        for (const alloc of allocations) {
          const invRow = await tx.invoice.findFirstOrThrow({
            where: { id: alloc.invoice_id },
            select: { id: true, invoiceNumber: true },
          });
          const draft = buildJE04AdvanceApplied({
            paymentId: id,
            invoiceId: invRow.id,
            invoiceNumber: invRow.invoiceNumber,
            appliedDate: paymentDate,
            amountPkr: alloc.allocated_amount_pkr,
            bookType,
            party: partyRow,
          });
          await this.journalEntry.postInTransaction(
            tx,
            facilityId,
            userId ?? partyRow.id,
            draft,
            { postingStatus: 'POSTED' },
          );
        }
      }

      const updated = await this.repo.update(tx, id, { status: 'ALLOCATED' });
      return formatPayment(updated);
    });
  }

  async dishonour(facilityId: string, id: string, notes?: string, userId?: string) {
    return this.prisma.$transaction(async (tx) => {
      const fullPayment = await tx.payment.findFirst({
        where: { id, facilityId },
        include: {
          party: { select: { id: true, name: true, partyType: true } },
        },
      });
      if (!fullPayment) throw Errors.PAYMENT_NOT_FOUND();
      if (fullPayment.status === 'DISHONOURED') throw Errors.PAYMENT_ALREADY_DISHONOURED();
      if (fullPayment.paymentMethod !== 'CHEQUE') throw Errors.PAYMENT_NOT_CHEQUE();

      // Row-lock to prevent concurrent dishonour
      await tx.$queryRawUnsafe(
        `SELECT id FROM payments WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        id,
        facilityId,
      );

      // Reverse all allocations
      const allocations = await tx.paymentAllocation.findMany({
        where: { paymentId: id },
      });

      for (const alloc of allocations) {
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: { amountPaidPkr: { decrement: Number(alloc.allocatedAmountPkr) } },
        });
      }

      await tx.paymentAllocation.deleteMany({ where: { paymentId: id } });

      const updated = await this.repo.update(tx, id, {
        status: 'DISHONOURED',
        clearanceStatus: 'BOUNCED',
        ...(notes ? { notes } : {}),
      });

      // Phase 8: post JE-06 (reversal) and mark the original JE-02 as REVERSED.
      if (this.journalEntry) {
        const draft = buildJE06ChequeDishonoured({
          paymentId: id,
          dishonourDate: new Date(),
          amountPkr: Number(fullPayment.amountPkr),
          bookType: fullPayment.bookType as 'PACCI' | 'KATCHI',
          party: fullPayment.party,
          originalAssetAccountCode: fullPayment.assetAccountCode,
        });
        const posted = await this.journalEntry.postInTransaction(
          tx,
          facilityId,
          userId ?? fullPayment.createdBy,
          draft,
          { postingStatus: 'POSTED', reversedById: fullPayment.journalEntryId ?? null },
        );
        if (fullPayment.journalEntryId) {
          await this.journalEntry.markReversed(tx, fullPayment.journalEntryId, posted.id);
        }
      }

      return formatPayment(updated);
    });
  }

  async getPartyLedger(facilityId: string, partyId: string) {
    const party = await this.prisma.party.findFirst({
      where: { id: partyId, facilityId },
    });
    if (!party) throw Errors.PARTY_NOT_FOUND();

    // Fetch all finalized invoices for this party (debits)
    const invoices = await this.prisma.invoice.findMany({
      where: { facilityId, billingPartyId: partyId, status: 'FINALIZED' },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalPkr: true,
        createdAt: true,
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    });

    // Fetch all non-dishonoured payments for this party (credits)
    const payments = await this.prisma.payment.findMany({
      where: { facilityId, partyId, status: { not: 'DISHONOURED' } },
      select: {
        id: true,
        paymentDate: true,
        amountPkr: true,
        paymentMethod: true,
        referenceNumber: true,
        createdAt: true,
      },
      orderBy: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
    });

    type RawEntry = {
      date: string;
      type: 'INVOICE' | 'PAYMENT';
      reference: string | null;
      description: string;
      debit_pkr: number;
      credit_pkr: number;
      id: string;
      sortKey: string;
    };

    const entries: RawEntry[] = [
      ...invoices.map((inv) => ({
        date: inv.invoiceDate.toISOString().slice(0, 10),
        type: 'INVOICE' as const,
        reference: inv.invoiceNumber ?? null,
        description: `Invoice ${inv.invoiceNumber ?? inv.id.slice(0, 8)}`,
        debit_pkr: Number(inv.totalPkr),
        credit_pkr: 0,
        id: inv.id,
        sortKey: `${inv.invoiceDate.toISOString().slice(0, 10)}_A_${inv.createdAt.toISOString()}`,
      })),
      ...payments.map((pay) => ({
        date: pay.paymentDate.toISOString().slice(0, 10),
        type: 'PAYMENT' as const,
        reference: pay.referenceNumber ?? null,
        description: `Payment via ${pay.paymentMethod}${pay.referenceNumber ? ` (${pay.referenceNumber})` : ''}`,
        debit_pkr: 0,
        credit_pkr: Number(pay.amountPkr),
        id: pay.id,
        sortKey: `${pay.paymentDate.toISOString().slice(0, 10)}_B_${pay.createdAt.toISOString()}`,
      })),
    ];

    entries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let balance = 0;
    const ledgerEntries = entries.map((e) => {
      balance = balance + e.debit_pkr - e.credit_pkr;
      return {
        date: e.date,
        type: e.type,
        reference: e.reference,
        description: e.description,
        debit_pkr: e.debit_pkr,
        credit_pkr: e.credit_pkr,
        balance_pkr: Math.round(balance * 100) / 100,
        id: e.id,
      };
    });

    const totalDebit = entries.reduce((s, e) => s + e.debit_pkr, 0);
    const totalCredit = entries.reduce((s, e) => s + e.credit_pkr, 0);

    return {
      party_id: partyId,
      party_name: party.name,
      entries: ledgerEntries,
      total_debit_pkr: Math.round(totalDebit * 100) / 100,
      total_credit_pkr: Math.round(totalCredit * 100) / 100,
      closing_balance_pkr: Math.round((totalDebit - totalCredit) * 100) / 100,
    };
  }
}
