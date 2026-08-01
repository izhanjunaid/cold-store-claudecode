import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { PaymentRepository, type PaymentWithRelations } from './payment.repository';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE02PaymentReceived } from '../accounting/templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../accounting/templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../accounting/templates/je-04-advance-applied';
import { buildJE06ChequeDishonoured } from '../accounting/templates/je-06-cheque-dishonoured';
import { assetAccountForPaymentMethod } from '../accounting/templates/types';
import { buildJE19PeshgiRecovered } from '../peshgi/templates/je-19-peshgi-recovered';

// Internal allocation shape used by service. Controller normalises legacy
// `{invoice_id, allocated_amount_pkr}` payloads into INVOICE-targeted lines.
type AllocationInput =
  | { target: 'INVOICE'; invoice_id: string; allocated_amount_pkr: number }
  | { target: 'LOAN'; loan_id: string; allocated_amount_pkr: number };

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
      target: (a.invoiceId ? 'INVOICE' : 'LOAN') as 'INVOICE' | 'LOAN',
      invoice_id: a.invoiceId ?? null,
      invoice_number: a.invoice?.invoiceNumber ?? null,
      loan_id: a.loanId ?? null,
      loan_number: a.loan?.loanNumber ?? null,
      allocated_amount_pkr: Number(a.allocatedAmountPkr),
    })),
  };
}

export class PaymentService {
  constructor(
    private prisma: PrismaClient,
    private repo: PaymentRepository,
    private journalEntry: JournalEntryService,
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
    allocations?: AllocationInput[];
  }) {
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.party.findFirst({
        where: { id: params.partyId, facilityId: params.facilityId },
      });
      if (!party) throw Errors.PARTY_NOT_FOUND();

      const isAdvance = params.isAdvance ?? false;
      const allocations = isAdvance ? [] : (params.allocations ?? []);

      const allocTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
      if (allocTotal > params.amountPkr + 0.001) {
        throw Errors.PAYMENT_OVER_ALLOCATED();
      }

      // Pre-validate each allocation (row-locking targets).
      for (const alloc of allocations) {
        if (alloc.target === 'INVOICE') {
          await validateInvoiceAllocation(tx, params.facilityId, params.partyId, alloc);
        } else {
          await validateLoanAllocation(tx, params.facilityId, params.partyId, alloc);
        }
      }

      let status: 'RECORDED' | 'ALLOCATED' | 'ADVANCE' = 'RECORDED';
      if (isAdvance) status = 'ADVANCE';
      else if (allocations.length > 0) status = 'ALLOCATED';

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
          create: allocations.map((a) =>
            a.target === 'INVOICE'
              ? { invoiceId: a.invoice_id, allocatedAmountPkr: a.allocated_amount_pkr }
              : { loanId: a.loan_id, allocatedAmountPkr: a.allocated_amount_pkr },
          ),
        },
      });

      // Apply each allocation: invoice increments amount_paid; loan decrements balance + posts JE-19.
      for (const alloc of allocations) {
        if (alloc.target === 'INVOICE') {
          await tx.invoice.update({
            where: { id: alloc.invoice_id },
            data: { amountPaidPkr: { increment: alloc.allocated_amount_pkr } },
          });
        } else {
          await this.applyLoanAllocation(
            tx,
            params.facilityId,
            params.createdBy,
            payment.id,
            assetAccountCode,
            new Date(params.paymentDate),
            alloc,
          );
        }
      }

      // Post JE-02 (regular) or JE-03 (advance) for the cash receipt — but only for the
      // invoice+unallocated portion. Loan allocations book their cash receipt via JE-19
      // inside applyLoanAllocation above; without this scaling we'd double-debit cash.
      const loanAllocTotal = allocations
        .filter((a) => a.target === 'LOAN')
        .reduce((s, a) => s + a.allocated_amount_pkr, 0);
      const cashReceiptAmount = round2(Number(payment.amountPkr) - loanAllocTotal);

      if (cashReceiptAmount > 0.005) {
        const draft = isAdvance
          ? buildJE03AdvanceReceived({
              paymentId: payment.id,
              paymentDate: payment.paymentDate,
              amountPkr: cashReceiptAmount,
              paymentMethod: payment.paymentMethod,
              referenceNumber: payment.referenceNumber,
              bookType,
              party: { id: party.id, partyType: party.partyType, name: party.name },
              assetAccountCode,
            })
          : buildJE02PaymentReceived({
              paymentId: payment.id,
              paymentDate: payment.paymentDate,
              amountPkr: cashReceiptAmount,
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
    allocations: AllocationInput[],
    userId?: string,
  ) {
    // LOAN allocations require coordinating the cash-side JE with creation-time JE-02.
    // Post-creation /allocate would need an AR-transfer JE we don't have, so route
    // peshgi recovery through POST /v1/payments or POST /v1/loans/:id/repayments.
    if (allocations.some((a) => a.target === 'LOAN')) {
      throw Errors.VALIDATION_ERROR(
        'LOAN allocations must be supplied at payment creation, not via /allocate. ' +
          'Use POST /v1/payments with combined allocations, or POST /v1/loans/:id/repayments.',
        'allocations',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRawUnsafe<
        { id: string; status: string; amount_pkr: string; party_id: string; asset_account_code: string | null; payment_method: string; payment_date: Date; book_type: string }[]
      >(
        `SELECT id, status, amount_pkr, party_id, asset_account_code, payment_method, payment_date, book_type FROM payments WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        id,
        facilityId,
      );
      const paymentRow = rows[0];
      if (!paymentRow) throw Errors.PAYMENT_NOT_FOUND();
      if (paymentRow.status === 'DISHONOURED') throw Errors.PAYMENT_ALREADY_DISHONOURED();

      const existing = await tx.paymentAllocation.findMany({
        where: { paymentId: id, voidedAt: null },
        select: { allocatedAmountPkr: true },
      });
      const existingTotal = existing.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
      const newTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);

      if (existingTotal + newTotal > Number(paymentRow.amount_pkr) + 0.001) {
        throw Errors.PAYMENT_OVER_ALLOCATED();
      }

      for (const alloc of allocations) {
        if (alloc.target === 'INVOICE') {
          await validateInvoiceAllocation(tx, facilityId, paymentRow.party_id, alloc);
        } else {
          await validateLoanAllocation(tx, facilityId, paymentRow.party_id, alloc);
        }
      }

      const previousStatus = paymentRow.status;
      const paymentDate = new Date(paymentRow.payment_date);
      const bookType = (paymentRow.book_type ?? 'PACCI') as 'PACCI' | 'KATCHI';
      // Derive the fallback from the payment's own method rather than assuming cash:
      // a legacy row with a null asset_account_code paid by cheque belongs to 1020, and
      // hardcoding '1010' here diverged from PAYMENT_METHOD_ASSET_ACCOUNT.
      const assetAccountCode =
        paymentRow.asset_account_code ?? assetAccountForPaymentMethod(paymentRow.payment_method);

      for (const alloc of allocations) {
        if (alloc.target === 'INVOICE') {
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
        } else {
          await this.applyLoanAllocation(
            tx,
            facilityId,
            userId ?? paymentRow.party_id,
            id,
            assetAccountCode,
            paymentDate,
            alloc,
          );
        }
      }

      // ADVANCE → applying to invoices triggers JE-04 per invoice line.
      if (previousStatus === 'ADVANCE') {
        const partyRow = await tx.party.findFirstOrThrow({
          where: { id: paymentRow.party_id },
          select: { id: true, name: true, partyType: true },
        });
        for (const alloc of allocations) {
          if (alloc.target !== 'INVOICE') continue;
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

  async dishonour(
    facilityId: string,
    id: string,
    notes?: string,
    userId?: string,
    dishonourDateInput?: string,
  ) {
    // The bank often notifies a bounce days after it happened. Defaulting to
    // "now" would post it — and the period-lock check below it — against the
    // wrong date. postInTransaction enforces the period lock on whatever date
    // is passed here, so no separate check is needed for that. Dishonour has
    // never had a backdating-window rule (unlike lots/outbound), so none is
    // added here either — a caller-supplied date is simply used as given.
    const dishonourDate = dishonourDateInput ? new Date(dishonourDateInput) : new Date();
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

      await tx.$queryRawUnsafe(
        `SELECT id FROM payments WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        id,
        facilityId,
      );

      const allocations = await tx.paymentAllocation.findMany({
        where: { paymentId: id, voidedAt: null },
      });

      // Track per-loan reversal state so we can post REVERSAL JEs for JE-19 entries
      // after the data side is cleaned up.
      type LoanReversal = {
        loanId: string;
        loanNumber: string;
        partyId: string;
        bookType: 'PACCI' | 'KATCHI';
        amountPkr: number;
        repaymentJournalEntryIds: string[];
      };
      const loanReversals: LoanReversal[] = [];
      let loanReversalTotal = 0;

      for (const alloc of allocations) {
        if (alloc.invoiceId) {
          await tx.invoice.update({
            where: { id: alloc.invoiceId },
            data: { amountPaidPkr: { decrement: Number(alloc.allocatedAmountPkr) } },
          });
        } else if (alloc.loanId) {
          await tx.$queryRawUnsafe(
            `SELECT id FROM party_loans WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
            alloc.loanId,
            facilityId,
          );
          const loan = await tx.partyLoan.findFirstOrThrow({
            where: { id: alloc.loanId, facilityId },
          });
          const newBalance = round2(
            Number(loan.balanceOutstandingPkr) + Number(alloc.allocatedAmountPkr),
          );
          await tx.partyLoan.update({
            where: { id: alloc.loanId },
            data: {
              balanceOutstandingPkr: newBalance,
              status: 'ACTIVE',
            },
          });
          // Capture the JE-19 ids before voiding the repayment rows so we can
          // mark them as reversed once the reversal JEs are posted.
          const repayments = await tx.partyLoanRepayment.findMany({
            where: { loanId: alloc.loanId, paymentId: id, voidedAt: null },
            select: { journalEntryId: true },
          });
          loanReversals.push({
            loanId: alloc.loanId,
            loanNumber: loan.loanNumber,
            partyId: loan.partyId,
            bookType: loan.bookType as 'PACCI' | 'KATCHI',
            amountPkr: Number(alloc.allocatedAmountPkr),
            repaymentJournalEntryIds: repayments
              .map((r) => r.journalEntryId)
              .filter((v): v is string => Boolean(v)),
          });
          loanReversalTotal += Number(alloc.allocatedAmountPkr);
          // Void, don't delete (F-11): the subledger keeps the story of what
          // this cheque had funded; readers filter on voided_at IS NULL.
          await tx.partyLoanRepayment.updateMany({
            where: { loanId: alloc.loanId, paymentId: id, voidedAt: null },
            data: { voidedAt: new Date(), voidedBy: userId ?? fullPayment.createdBy },
          });
        }
      }

      await tx.paymentAllocation.updateMany({
        where: { paymentId: id, voidedAt: null },
        data: { voidedAt: new Date(), voidedBy: userId ?? fullPayment.createdBy },
      });

      const updated = await this.repo.update(tx, id, {
        status: 'DISHONOURED',
        clearanceStatus: 'BOUNCED',
        ...(notes ? { notes } : {}),
      });

      // JE-06 reverses only the invoice/unallocated portion of the original JE-02 —
      // matching the scaled-down amount we originally posted (see record() for the rule).
      const je06Amount = round2(Number(fullPayment.amountPkr) - loanReversalTotal);
      if (je06Amount > 0.005) {
        // An advance receipt credited 2010 (JE-03), not AR. Only allocating it to an
        // invoice moves it to AR via JE-04, so whatever is still unallocated must be
        // reversed against 2010 — reversing it against AR would leave the advance
        // liability standing AND invent a receivable. record() forces `allocations = []`
        // when isAdvance, and allocate() rejects LOAN targets, so every allocation an
        // advance can carry is an invoice allocation that went through JE-04. Read from
        // the in-memory `allocations` captured before they were voided above.
        const invoiceAllocTotal = fullPayment.isAdvance
          ? allocations
              .filter((a) => a.invoiceId)
              .reduce((s, a) => s + Number(a.allocatedAmountPkr), 0)
          : 0;
        const advanceRemainderPkr = fullPayment.isAdvance
          ? Math.max(0, round2(je06Amount - invoiceAllocTotal))
          : 0;

        const draft = buildJE06ChequeDishonoured({
          paymentId: id,
          dishonourDate: dishonourDate ?? new Date(),
          amountPkr: je06Amount,
          bookType: fullPayment.bookType as 'PACCI' | 'KATCHI',
          party: fullPayment.party,
          originalAssetAccountCode: fullPayment.assetAccountCode,
          advanceRemainderPkr,
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

      // For each loan portion, post a JE-19 reversal: DR 1140 / CR cash account.
      // This unwinds the per-loan cash receipt JE-19 booked during combined settlement.
      // Same rule as allocate(): fall back to the method's account, not a cash guess.
      const cashAccount =
        fullPayment.assetAccountCode ?? assetAccountForPaymentMethod(fullPayment.paymentMethod);
      for (const lr of loanReversals) {
        const reverseDraft = {
          entryType: 'REVERSAL' as const,
          bookType: lr.bookType,
          sourceTable: 'party_loans',
          sourceId: lr.loanId,
          entryDate: dishonourDate ?? new Date(),
          description: `Cheque dishonour reversal — peshgi ${lr.loanNumber} (${fullPayment.party.name})`,
          lines: [
            {
              accountCode: '1140',
              debitAmount: lr.amountPkr,
              creditAmount: 0,
              partyId: lr.partyId,
              description: `Restore peshgi balance — cheque dishonour ${lr.loanNumber}`,
            },
            {
              accountCode: cashAccount,
              debitAmount: 0,
              creditAmount: lr.amountPkr,
              partyId: lr.partyId,
              description: `Reverse loan cash receipt — cheque dishonour ${lr.loanNumber}`,
            },
          ],
        };
        const reversedPost = await this.journalEntry.postInTransaction(
          tx,
          facilityId,
          userId ?? fullPayment.createdBy,
          reverseDraft,
          {
            postingStatus: 'POSTED',
            reversedById: lr.repaymentJournalEntryIds[0] ?? null,
          },
        );
        for (const originalJeId of lr.repaymentJournalEntryIds) {
          await this.journalEntry.markReversed(tx, originalJeId, reversedPost.id);
        }
      }

      return formatPayment(updated);
    });
  }

  async getPartyLedger(
    facilityId: string,
    partyId: string,
    opts: { fromDate?: string; toDate?: string; bookType?: 'PACCI' | 'KATCHI' } = {},
  ) {
    const party = await this.prisma.party.findFirst({
      where: { id: partyId, facilityId },
    });
    if (!party) throw Errors.PARTY_NOT_FOUND();

    const { fromDate, toDate, bookType } = opts;
    const bookFilter = bookType ? { bookType } : {};

    const invoices = await this.prisma.invoice.findMany({
      where: {
        facilityId,
        billingPartyId: partyId,
        status: 'FINALIZED',
        ...bookFilter,
      },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalPkr: true,
        createdAt: true,
      },
      orderBy: [{ invoiceDate: 'asc' }, { createdAt: 'asc' }],
    });

    const payments = await this.prisma.payment.findMany({
      where: {
        facilityId,
        partyId,
        status: { not: 'DISHONOURED' },
        ...bookFilter,
      },
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

    const creditNotes = await this.prisma.creditNote.findMany({
      where: {
        facilityId,
        billingPartyId: partyId,
        status: { in: ['ISSUED', 'APPLIED'] },
        ...bookFilter,
      },
      select: {
        id: true,
        creditNoteNumber: true,
        creditDate: true,
        totalPkr: true,
        createdAt: true,
      },
      orderBy: [{ creditDate: 'asc' }, { createdAt: 'asc' }],
    });

    // Opening balances (audit Gap 1) live as journal-entry lines with party
    // attribution, not as documents — surface them so the statement matches
    // the GL from day one.
    const openingLines = await this.prisma.journalEntryLine.findMany({
      where: {
        facilityId,
        partyId,
        journalEntry: {
          facilityId,
          sourceTable: 'opening_balances',
          postingStatus: 'POSTED',
          ...bookFilter,
        },
      },
      select: {
        debitAmount: true,
        creditAmount: true,
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, createdAt: true } },
      },
    });

    // Late-payment surcharges (JE-21) debit the party's AR — surface them on the
    // statement too (only the AR debit line; the 4210 credit line also carries
    // the partyId but is not the receivable). phase/19 audit.
    const surchargeLines = await this.prisma.journalEntryLine.findMany({
      where: {
        facilityId,
        partyId,
        debitAmount: { gt: 0 },
        journalEntry: {
          facilityId,
          sourceTable: 'invoice_surcharge',
          postingStatus: 'POSTED',
          ...bookFilter,
        },
      },
      select: {
        debitAmount: true,
        creditAmount: true,
        description: true,
        journalEntry: { select: { id: true, entryNumber: true, entryDate: true, createdAt: true } },
      },
    });

    type RawEntry = {
      date: string;
      type: 'OPENING_BALANCE' | 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'SURCHARGE';
      reference: string | null;
      description: string;
      debit_pkr: number;
      credit_pkr: number;
      id: string;
      sortKey: string;
    };

    const allEntries: RawEntry[] = [
      ...openingLines.map((line) => ({
        date: line.journalEntry.entryDate.toISOString().slice(0, 10),
        type: 'OPENING_BALANCE' as const,
        reference: line.journalEntry.entryNumber,
        description: 'Opening balance brought forward',
        debit_pkr: Number(line.debitAmount),
        credit_pkr: Number(line.creditAmount),
        id: line.journalEntry.id,
        sortKey: `${line.journalEntry.entryDate.toISOString().slice(0, 10)}_0_${line.journalEntry.createdAt.toISOString()}`,
      })),
      ...surchargeLines.map((line) => ({
        date: line.journalEntry.entryDate.toISOString().slice(0, 10),
        type: 'SURCHARGE' as const,
        reference: line.journalEntry.entryNumber,
        description: line.description ?? 'Late payment surcharge',
        debit_pkr: Number(line.debitAmount),
        credit_pkr: Number(line.creditAmount),
        id: line.journalEntry.id,
        sortKey: `${line.journalEntry.entryDate.toISOString().slice(0, 10)}_1_${line.journalEntry.createdAt.toISOString()}`,
      })),
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
      ...creditNotes.map((cn) => ({
        date: cn.creditDate.toISOString().slice(0, 10),
        type: 'CREDIT_NOTE' as const,
        reference: cn.creditNoteNumber ?? null,
        description: `Credit Note ${cn.creditNoteNumber ?? cn.id.slice(0, 8)}`,
        debit_pkr: 0,
        credit_pkr: Number(cn.totalPkr),
        id: cn.id,
        sortKey: `${cn.creditDate.toISOString().slice(0, 10)}_C_${cn.createdAt.toISOString()}`,
      })),
    ];

    allEntries.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    const openingBalance = fromDate
      ? allEntries
          .filter((e) => e.date < fromDate)
          .reduce((bal, e) => bal + e.debit_pkr - e.credit_pkr, 0)
      : 0;

    const windowEntries = allEntries.filter((e) => {
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      return true;
    });

    let balance = openingBalance;
    const ledgerEntries = windowEntries.map((e) => {
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

    const totalDebit = windowEntries.reduce((s, e) => s + e.debit_pkr, 0);
    const totalCredit = windowEntries.reduce((s, e) => s + e.credit_pkr, 0);

    return {
      party_id: partyId,
      party_name: party.name,
      party_type: party.partyType,
      book_type: bookType ?? null,
      date_from: fromDate ?? null,
      date_to: toDate ?? null,
      opening_balance_pkr: Math.round(openingBalance * 100) / 100,
      entries: ledgerEntries,
      total_debit_pkr: Math.round(totalDebit * 100) / 100,
      total_credit_pkr: Math.round(totalCredit * 100) / 100,
      closing_balance_pkr: Math.round(balance * 100) / 100,
    };
  }

  // ---------- internals ----------

  private async applyLoanAllocation(
    tx: Prisma.TransactionClient,
    facilityId: string,
    userId: string,
    paymentId: string,
    assetAccountCode: string,
    paymentDate: Date,
    alloc: { target: 'LOAN'; loan_id: string; allocated_amount_pkr: number },
  ): Promise<void> {
    const loan = await tx.partyLoan.findFirstOrThrow({
      where: { id: alloc.loan_id, facilityId },
      include: { party: { select: { name: true } } },
    });

    const newBalance = round2(
      Number(loan.balanceOutstandingPkr) - alloc.allocated_amount_pkr,
    );
    await tx.partyLoan.update({
      where: { id: alloc.loan_id },
      data: {
        balanceOutstandingPkr: newBalance,
        status: newBalance <= 0.005 ? 'RECOVERED' : 'ACTIVE',
      },
    });

    const repayment = await tx.partyLoanRepayment.create({
      data: {
        loanId: alloc.loan_id,
        repaymentDate: paymentDate,
        amountPkr: alloc.allocated_amount_pkr,
        paymentMethod: 'DEDUCTED_FROM_PRODUCE',
        assetAccountCode,
        paymentId,
        notes: `Allocated from payment ${paymentId.slice(0, 8)}`,
        createdBy: userId,
      },
    });

    const draft = buildJE19PeshgiRecovered({
      loanId: loan.id,
      loanNumber: loan.loanNumber,
      repaymentId: repayment.id,
      partyId: loan.partyId,
      partyName: loan.party.name,
      entryDate: paymentDate,
      amountPkr: alloc.allocated_amount_pkr,
      toAssetAccountCode: assetAccountCode,
      bookType: loan.bookType,
    });
    const posted = await this.journalEntry.postInTransaction(
      tx,
      facilityId,
      userId,
      draft,
      { postingStatus: 'POSTED' },
    );
    await tx.partyLoanRepayment.update({
      where: { id: repayment.id },
      data: { journalEntryId: posted.id },
    });
  }
}

async function validateInvoiceAllocation(
  tx: Prisma.TransactionClient,
  facilityId: string,
  partyId: string,
  alloc: { invoice_id: string; allocated_amount_pkr: number },
) {
  const rows = await tx.$queryRawUnsafe<
    { id: string; status: string; billing_party_id: string; total_pkr: string; amount_paid_pkr: string }[]
  >(
    `SELECT id, status, billing_party_id, total_pkr, amount_paid_pkr FROM invoices WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
    alloc.invoice_id,
    facilityId,
  );
  const inv = rows[0];
  if (!inv) throw Errors.INVOICE_NOT_FOUND();
  if (inv.status !== 'FINALIZED') {
    throw Errors.VALIDATION_ERROR('Only FINALIZED invoices can be allocated', 'invoice_id');
  }
  if (inv.billing_party_id !== partyId) throw Errors.PAYMENT_PARTY_MISMATCH();
  const balanceDue = Number(inv.total_pkr) - Number(inv.amount_paid_pkr);
  if (alloc.allocated_amount_pkr > balanceDue + 0.001) {
    throw Errors.PAYMENT_EXCEEDS_INVOICE_BALANCE();
  }
}

async function validateLoanAllocation(
  tx: Prisma.TransactionClient,
  facilityId: string,
  partyId: string,
  alloc: { loan_id: string; allocated_amount_pkr: number },
) {
  const rows = await tx.$queryRawUnsafe<
    { id: string; status: string; party_id: string; balance_outstanding_pkr: string }[]
  >(
    `SELECT id, status, party_id, balance_outstanding_pkr FROM party_loans WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
    alloc.loan_id,
    facilityId,
  );
  const loan = rows[0];
  if (!loan) throw Errors.PESHGI_NOT_FOUND();
  if (loan.status !== 'ACTIVE') throw Errors.PESHGI_INACTIVE();
  if (loan.party_id !== partyId) throw Errors.PAYMENT_PARTY_MISMATCH();
  const balance = Number(loan.balance_outstanding_pkr);
  if (alloc.allocated_amount_pkr > balance + 0.005) {
    throw Errors.PESHGI_OVER_REPAYMENT();
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
