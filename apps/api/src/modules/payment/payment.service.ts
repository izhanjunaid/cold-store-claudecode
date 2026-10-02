import type { PrismaClient, Prisma, BookType, PaymentStatus } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { PaymentRepository, type PaymentWithRelations } from './payment.repository';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE02PaymentReceived } from '../accounting/templates/je-02-payment-received';
import { buildJE03AdvanceReceived } from '../accounting/templates/je-03-advance-received';
import { buildJE04AdvanceApplied } from '../accounting/templates/je-04-advance-applied';
import { buildJE24ChequeCleared } from '../accounting/templates/je-24-cheque-cleared';
import { buildJE19PeshgiRecovered } from '../peshgi/templates/je-19-peshgi-recovered';
import { generateReceiptNumber } from './receipt-number';
import { refreshInvoiceSettlement } from '../invoice/invoice-settlement';
import { partyStatement } from '../invoice/receivables';
import { receiptAssetAccountForPaymentMethod, toIsoDate, round2 } from '@coldchain/shared';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { lockRow } from '../../common/row-lock';
import { receivableParty, RECEIVABLE_PARTY_SELECT } from '../party/receivable-party';

// Internal allocation shape used by service. Controller normalises legacy
// `{invoice_id, allocated_amount_pkr}` payloads into INVOICE-targeted lines.
type AllocationInput =
  | { target: 'INVOICE'; invoice_id: string; allocated_amount_pkr: number }
  | { target: 'LOAN'; loan_id: string; allocated_amount_pkr: number };

/**
 * A receipt's status follows from what it is and what it settles, recomputed on
 * every change rather than set by whichever path ran last (docs/25 R-22): a
 * bounced cheque is DISHONOURED; a fully applied receipt is ALLOCATED; otherwise
 * an advance still holding money in 2010 is ADVANCE and a receipt with money
 * still on account is RECORDED.
 */
export function derivePaymentStatus(p: {
  isAdvance: boolean;
  clearanceStatus: string;
  amountPkr: number;
  allocatedPkr: number;
}): PaymentStatus {
  if (p.clearanceStatus === 'BOUNCED') return 'DISHONOURED';
  if (round2(p.amountPkr - p.allocatedPkr) <= 0.005) return 'ALLOCATED';
  return p.isAdvance ? 'ADVANCE' : 'RECORDED';
}

function formatPayment(p: PaymentWithRelations) {
  const allocated = round2(p.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0));
  const unallocated = round2(Number(p.amountPkr) - allocated);
  const bounced = p.clearanceStatus === 'BOUNCED';
  return {
    id: p.id,
    facility_id: p.facilityId,
    party_id: p.partyId,
    party_name: p.party.name,
    payment_date: p.paymentDate.toISOString().slice(0, 10),
    amount_pkr: Number(p.amountPkr),
    payment_method: p.paymentMethod,
    receipt_number: p.receiptNumber ?? null,
    tax_withheld_pkr: Number(p.taxWithheldPkr),
    // What actually arrived. amount_pkr is what settled the invoice.
    cash_received_pkr: round2(Number(p.amountPkr) - Number(p.taxWithheldPkr)),
    reference_number: p.referenceNumber ?? null,
    is_advance: p.isAdvance,
    status: p.status,
    clearance_status: p.clearanceStatus,
    cheque_date: p.chequeDate ? p.chequeDate.toISOString().slice(0, 10) : null,
    book_type: p.bookType,
    notes: p.notes ?? null,
    created_at: p.createdAt.toISOString(),
    created_by_name: p.createdByUser.name,
    /** Still on account (a normal receipt) or still in 2010 (an advance). */
    unallocated_pkr: unallocated,
    can_allocate: !bounced && unallocated > 0.005,
    can_clear: p.clearanceStatus === 'PENDING',
    can_dishonour: p.paymentMethod === 'CHEQUE' && !bounced,
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
    taxWithheldPkr?: number;
    isAdvance?: boolean;
    chequeDate?: string;
    /** Only for a receipt that settles nothing yet; otherwise the documents decide. */
    bookType?: BookType;
    notes?: string;
    allocations?: AllocationInput[];
    role: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.party.findFirst({
        where: { id: params.partyId, facilityId: params.facilityId },
      });
      if (!party) throw Errors.PARTY_NOT_FOUND();
      const customer = receivableParty(party);

      const isAdvance = params.isAdvance ?? false;
      const allocations = isAdvance ? [] : (params.allocations ?? []);

      const allocTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
      if (allocTotal > params.amountPkr + 0.001) {
        throw Errors.PAYMENT_OVER_ALLOCATED();
      }

      // Pre-validate each allocation (row-locking targets). A receipt belongs to the
      // book of the documents it settles, never to what the request says (docs/25 R-04).
      const books = new Set<BookType>();
      for (const alloc of allocations) {
        books.add(
          alloc.target === 'INVOICE'
            ? await validateInvoiceAllocation(tx, params.facilityId, params.partyId, alloc)
            : await validateLoanAllocation(tx, params.facilityId, params.partyId, alloc),
        );
      }
      if (books.size > 1) {
        throw Errors.VALIDATION_ERROR('One receipt settles documents of one book only; record a receipt per book', 'allocations');
      }
      const bookType: BookType = [...books][0] ?? params.bookType ?? 'PACCI';
      if (params.bookType && params.bookType !== bookType) {
        throw Errors.VALIDATION_ERROR(`The documents this receipt settles are on the ${bookType} book`, 'book_type');
      }
      assertKatchiWriteAllowed(params.role, bookType);

      // A cheque is not bank funds the moment it's handed over — it can still
      // bounce. It starts PENDING and posts to 1025 (clearing), not 1020;
      // POST /v1/payments/:id/clear moves it once the bank actually
      // processes it (phase/25, docs/09 §2).
      // s.153 withholding is refused on two shapes, on tax grounds rather
      // than for convenience — and refusing them is what keeps JE-06 a
      // two-case template instead of three.
      //
      //  - An advance credits 2010, not AR. A deduction certificate is issued
      //    against an invoice for services rendered; there is no invoice yet.
      //  - A peshgi recovery is repayment of a loan, not a payment for
      //    services, so s.153 does not reach it.
      const taxWithheldPkr = round2(params.taxWithheldPkr ?? 0);
      if (taxWithheldPkr > 0) {
        if (isAdvance) {
          throw Errors.VALIDATION_ERROR(
            'Tax cannot be withheld on an advance receipt — a deduction certificate is issued against an invoice, and an advance has none yet. Record the receipt, then apply it.',
            'tax_withheld_pkr',
          );
        }
        if (allocations.some((a) => a.target === 'LOAN')) {
          throw Errors.VALIDATION_ERROR(
            'Tax cannot be withheld on a peshgi recovery — repaying a loan is not a payment for services, so s.153 does not reach it. Record the recovery separately.',
            'tax_withheld_pkr',
          );
        }
        if (taxWithheldPkr > params.amountPkr + 0.005) {
          throw Errors.VALIDATION_ERROR(
            'The tax withheld cannot exceed the amount settling the invoice.',
            'tax_withheld_pkr',
          );
        }
      }

      const clearanceStatus = params.paymentMethod === 'CHEQUE' ? 'PENDING' : 'NA';
      const assetAccountCode = receiptAssetAccountForPaymentMethod(params.paymentMethod);

      const paymentDateValue = new Date(params.paymentDate);
      const payment = await this.repo.create(tx, {
        facilityId: params.facilityId,
        partyId: params.partyId,
        receiptNumber: await generateReceiptNumber(tx, params.facilityId, paymentDateValue),
        paymentDate: paymentDateValue,
        amountPkr: params.amountPkr,
        taxWithheldPkr,
        paymentMethod: params.paymentMethod as any,
        referenceNumber: params.referenceNumber ?? null,
        isAdvance,
        status: derivePaymentStatus({ isAdvance, clearanceStatus, amountPkr: params.amountPkr, allocatedPkr: allocTotal }),
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
          await refreshInvoiceSettlement(tx, alloc.invoice_id);
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
              party: customer,
              assetAccountCode,
            })
          : buildJE02PaymentReceived({
              paymentId: payment.id,
              paymentDate: payment.paymentDate,
              amountPkr: cashReceiptAmount,
              taxWithheldPkr,
              paymentMethod: payment.paymentMethod,
              referenceNumber: payment.referenceNumber,
              bookType,
              party: customer,
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

      return formatPayment(await this.refreshStatus(tx, payment.id));
    });
  }

  async list(
    facilityId: string,
    query: {
      partyId?: string;
      invoiceId?: string;
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
        invoiceId: query.invoiceId,
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

  /**
   * Apply a receipt's remaining money to invoices — the one allocate action for both
   * kinds of unapplied cash (docs/25 R-13). A normal receipt already credited AR when
   * it was recorded, so applying it moves nothing in the ledger; an advance sits in
   * 2010 until applied, so EVERY application posts JE-04 (R-02 — only the first one
   * used to). Loans are settled at receipt time or through the loan itself.
   */
  async allocate(
    facilityId: string,
    id: string,
    allocations: AllocationInput[],
    userId: string,
    appliedDateInput?: string,
  ) {
    if (allocations.some((a) => a.target === 'LOAN')) {
      throw Errors.VALIDATION_ERROR(
        'A peshgi is settled when the receipt is recorded, or from the loan itself — not by allocating a receipt later.',
        'allocations',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payments', id, facilityId))) throw Errors.PAYMENT_NOT_FOUND();
      const payment = await tx.payment.findFirstOrThrow({
        where: { id, facilityId },
        include: {
          party: { select: RECEIVABLE_PARTY_SELECT },
          allocations: { where: { voidedAt: null }, select: { allocatedAmountPkr: true } },
        },
      });
      if (payment.clearanceStatus === 'BOUNCED') throw Errors.PAYMENT_ALREADY_DISHONOURED();

      const existingTotal = payment.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
      const newTotal = allocations.reduce((s, a) => s + a.allocated_amount_pkr, 0);
      if (existingTotal + newTotal > Number(payment.amountPkr) + 0.001) throw Errors.PAYMENT_OVER_ALLOCATED();

      // An advance is applied on the day it is applied — that is when 2010 becomes AR.
      const appliedDate = new Date(`${appliedDateInput ?? toIsoDate(new Date())}T00:00:00.000Z`);
      if (payment.isAdvance && appliedDate < payment.paymentDate) {
        throw Errors.VALIDATION_ERROR('An advance cannot be applied before it was received', 'applied_date');
      }

      for (const alloc of allocations) {
        if (alloc.target !== 'INVOICE') continue;
        const book = await validateInvoiceAllocation(tx, facilityId, payment.partyId, alloc);
        if (book !== payment.bookType) {
          throw Errors.VALIDATION_ERROR(
            `This receipt is on the ${payment.bookType} book and cannot settle a ${book} invoice`,
            'allocations',
          );
        }
        await tx.paymentAllocation.create({
          data: { paymentId: id, invoiceId: alloc.invoice_id, allocatedAmountPkr: alloc.allocated_amount_pkr },
        });
        await refreshInvoiceSettlement(tx, alloc.invoice_id);

        if (payment.isAdvance) {
          const inv = await tx.invoice.findFirstOrThrow({
            where: { id: alloc.invoice_id },
            select: { invoiceNumber: true, invoiceDate: true },
          });
          if (appliedDate < inv.invoiceDate) {
            throw Errors.VALIDATION_ERROR('An advance cannot be applied to an invoice before the invoice date', 'applied_date');
          }
          await this.journalEntry.postInTransaction(
            tx,
            facilityId,
            userId,
            buildJE04AdvanceApplied({
              paymentId: id,
              appliedTo: `invoice ${inv.invoiceNumber}`,
              appliedDate,
              amountPkr: alloc.allocated_amount_pkr,
              bookType: payment.bookType,
              party: receivableParty(payment.party),
            }),
          );
        }
      }

      return formatPayment(await this.refreshStatus(tx, id));
    });
  }

  /**
   * The correction for advances an older version applied without JE-04 (docs/25
   * R-02, pre-update check C05): whatever is allocated beyond what the standing
   * JE-04s already moved out of 2010 is moved now, sourced to the payment so a
   * later dishonour finds it with the rest of the chain.
   */
  async postMissingAdvanceApplication(facilityId: string, id: string, userId: string, dateInput?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payments', id, facilityId))) throw Errors.PAYMENT_NOT_FOUND();
      const payment = await tx.payment.findFirstOrThrow({
        where: { id, facilityId },
        include: {
          party: { select: RECEIVABLE_PARTY_SELECT },
          allocations: { where: { voidedAt: null, invoiceId: { not: null } }, select: { allocatedAmountPkr: true } },
        },
      });
      if (!payment.isAdvance) throw Errors.VALIDATION_ERROR('Only an advance is applied through 2010', 'id');
      if (payment.clearanceStatus === 'BOUNCED') throw Errors.PAYMENT_ALREADY_DISHONOURED();

      const allocated = payment.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0);
      const applied = await tx.journalEntryLine.aggregate({
        where: {
          debitAmount: { gt: 0 },
          journalEntry: {
            facilityId,
            sourceTable: 'payments',
            sourceId: id,
            entryType: 'ADVANCE_APPLIED',
            postingStatus: 'POSTED',
            reversedById: null,
          },
        },
        _sum: { debitAmount: true },
      });
      const missing = round2(allocated - Number(applied._sum.debitAmount ?? 0));
      if (missing <= 0.005) {
        throw Errors.VALIDATION_ERROR('Every allocation of this advance already has its journal entry', 'id');
      }

      await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE04AdvanceApplied({
          paymentId: id,
          appliedTo: 'allocations recorded without their entry',
          appliedDate: new Date(`${dateInput ?? toIsoDate(new Date())}T00:00:00.000Z`),
          amountPkr: missing,
          bookType: payment.bookType,
          party: receivableParty(payment.party),
        }),
      );
      return formatPayment(await this.refreshStatus(tx, id));
    });
  }

  /** Re-derive and store a payment's status from its allocations and clearance. */
  private async refreshStatus(tx: Prisma.TransactionClient, id: string): Promise<PaymentWithRelations> {
    const p = await tx.payment.findUniqueOrThrow({
      where: { id },
      include: { allocations: { where: { voidedAt: null }, select: { allocatedAmountPkr: true } } },
    });
    const status = derivePaymentStatus({
      isAdvance: p.isAdvance,
      clearanceStatus: p.clearanceStatus,
      amountPkr: Number(p.amountPkr),
      allocatedPkr: p.allocations.reduce((s, a) => s + Number(a.allocatedAmountPkr), 0),
    });
    return this.repo.update(tx, id, { status });
  }

  /**
   * A cheque bounced: every entry it caused is reversed through
   * reverseInTransaction — the receipt (JE-02/03), each advance application
   * (JE-04), the clearing (JE-24) if it had cleared, and the peshgi recoveries
   * (JE-19) it funded — so each account returns exactly to where it was. A
   * cleared cheque therefore nets 1025 to zero and takes the money back out of
   * the bank (docs/25 R-05). The sub-ledger follows: allocations and repayments
   * are voided, the invoices and loans re-derived.
   *
   * The bank often reports a bounce days later, so the date is the caller's —
   * but never before the last entry in the chain.
   */
  async dishonour(facilityId: string, id: string, userId: string, notes?: string, dishonourDateInput?: string) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payments', id, facilityId))) throw Errors.PAYMENT_NOT_FOUND();
      const payment = await tx.payment.findFirstOrThrow({ where: { id, facilityId } });
      if (payment.clearanceStatus === 'BOUNCED') throw Errors.PAYMENT_ALREADY_DISHONOURED();
      if (payment.paymentMethod !== 'CHEQUE') throw Errors.PAYMENT_NOT_CHEQUE();

      const repayments = await tx.partyLoanRepayment.findMany({ where: { paymentId: id, voidedAt: null } });
      const chain = await tx.journalEntry.findMany({
        where: {
          facilityId,
          postingStatus: 'POSTED',
          reversedById: null,
          entryType: { not: 'REVERSAL' },
          OR: [
            { sourceTable: 'payments', sourceId: id },
            { id: { in: repayments.map((r) => r.journalEntryId).filter((v): v is string => Boolean(v)) } },
          ],
        },
        select: { id: true, entryDate: true, entryType: true },
      });

      const dishonourDate = new Date(`${dishonourDateInput ?? toIsoDate(new Date())}T00:00:00.000Z`);
      const latest = chain.reduce((d, e) => (e.entryDate > d ? e.entryDate : d), payment.paymentDate);
      if (dishonourDate < latest) {
        throw Errors.VALIDATION_ERROR(
          `This cheque's entries run to ${toIsoDate(latest)}; it cannot be dishonoured before then`,
          'dishonour_date',
        );
      }

      // The clearing first: it is what moved the money on from 1025.
      chain.sort((a, b) => Number(b.entryType === 'CHEQUE_CLEARED') - Number(a.entryType === 'CHEQUE_CLEARED'));
      const reason = `cheque ${payment.referenceNumber ?? payment.receiptNumber ?? id} dishonoured`;
      for (const entry of chain) {
        await this.journalEntry.reverseInTransaction(tx, facilityId, userId, entry.id, { reason, date: dishonourDate });
      }

      const now = new Date();
      const allocations = await tx.paymentAllocation.findMany({ where: { paymentId: id, voidedAt: null } });
      await tx.paymentAllocation.updateMany({ where: { paymentId: id, voidedAt: null }, data: { voidedAt: now, voidedBy: userId } });
      // Void, don't delete (F-11): the sub-ledger keeps the story of what this cheque funded.
      await tx.partyLoanRepayment.updateMany({ where: { paymentId: id, voidedAt: null }, data: { voidedAt: now, voidedBy: userId } });
      for (const alloc of allocations) {
        if (alloc.invoiceId) {
          await refreshInvoiceSettlement(tx, alloc.invoiceId);
        } else if (alloc.loanId) {
          await lockRow(tx, 'party_loans', alloc.loanId, facilityId);
          const loan = await tx.partyLoan.findUniqueOrThrow({ where: { id: alloc.loanId } });
          await tx.partyLoan.update({
            where: { id: alloc.loanId },
            data: {
              balanceOutstandingPkr: round2(Number(loan.balanceOutstandingPkr) + Number(alloc.allocatedAmountPkr)),
              status: 'ACTIVE',
            },
          });
        }
      }

      await tx.payment.update({ where: { id }, data: { clearanceStatus: 'BOUNCED', ...(notes ? { notes } : {}) } });
      return formatPayment(await this.refreshStatus(tx, id));
    });
  }

  /**
   * Mark a PENDING cheque cleared: posts JE-24 (DR 1020 Bank / CR 1025 Cheques
   * in Hand) for the FULL payment amount and moves clearance_status to
   * CLEARED. The full amount, not any loan-scaled figure, because 1025 is
   * what the physical cheque debited across every JE that used
   * assetAccountCode — the invoice/advance portion (JE-02/JE-03) and any loan
   * portion (JE-19, via applyLoanAllocation) both used it (phase/25).
   */
  async clear(facilityId: string, id: string, userId: string, clearDateInput?: string) {
    const clearDate = new Date(`${clearDateInput ?? toIsoDate(new Date())}T00:00:00.000Z`);
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payments', id, facilityId))) throw Errors.PAYMENT_NOT_FOUND();
      const fullPayment = await tx.payment.findFirst({
        where: { id, facilityId },
        include: {
          party: { select: RECEIVABLE_PARTY_SELECT },
        },
      });
      if (!fullPayment) throw Errors.PAYMENT_NOT_FOUND();
      if (fullPayment.paymentMethod !== 'CHEQUE') throw Errors.PAYMENT_NOT_CHEQUE();
      if (fullPayment.clearanceStatus !== 'PENDING') throw Errors.PAYMENT_NOT_PENDING_CLEARANCE();

      const draft = buildJE24ChequeCleared({
        paymentId: id,
        clearedDate: clearDate,
        // The cash leg, not the invoice amount: 1025 received the net, so
        // clearing the gross would leave it permanently short.
        amountPkr: round2(Number(fullPayment.amountPkr) - Number(fullPayment.taxWithheldPkr)),
        bookType: fullPayment.bookType as 'PACCI' | 'KATCHI',
        party: fullPayment.party,
        referenceNumber: fullPayment.referenceNumber,
      });
      await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        draft,
        { postingStatus: 'POSTED' },
      );

      const updated = await this.repo.update(tx, id, { clearanceStatus: 'CLEARED' });
      return formatPayment(updated);
    });
  }

  /** The party's statement on one book (the AR read model, docs/25 R-11). */
  async getPartyLedger(
    facilityId: string,
    partyId: string,
    opts: { fromDate?: string; toDate?: string; bookType?: 'PACCI' | 'KATCHI' } = {},
  ) {
    const party = await this.prisma.party.findFirst({ where: { id: partyId, facilityId } });
    if (!party) throw Errors.PARTY_NOT_FOUND();
    const book = opts.bookType ?? 'PACCI';
    const statement = await partyStatement(this.prisma, {
      facilityId,
      partyId,
      book,
      from: opts.fromDate ? new Date(`${opts.fromDate}T00:00:00.000Z`) : undefined,
      to: opts.toDate ? new Date(`${opts.toDate}T00:00:00.000Z`) : undefined,
    });
    return {
      party_id: partyId,
      party_name: party.name,
      party_type: party.partyType,
      book_type: book,
      date_from: opts.fromDate ?? null,
      date_to: opts.toDate ?? null,
      ...statement,
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

/** Lock and check an invoice a receipt is about to settle; returns the invoice's book. */
async function validateInvoiceAllocation(
  tx: Prisma.TransactionClient,
  facilityId: string,
  partyId: string,
  alloc: { invoice_id: string; allocated_amount_pkr: number },
): Promise<BookType> {
  if (!(await lockRow(tx, 'invoices', alloc.invoice_id, facilityId))) throw Errors.INVOICE_NOT_FOUND();
  const inv = await tx.invoice.findUniqueOrThrow({
    where: { id: alloc.invoice_id },
    select: { status: true, billingPartyId: true, totalPkr: true, amountPaidPkr: true, bookType: true },
  });
  if (inv.status !== 'FINALIZED') {
    throw Errors.VALIDATION_ERROR('Only FINALIZED invoices can be allocated', 'invoice_id');
  }
  if (inv.billingPartyId !== partyId) throw Errors.PAYMENT_PARTY_MISMATCH();
  const balanceDue = Number(inv.totalPkr) - Number(inv.amountPaidPkr);
  if (alloc.allocated_amount_pkr > balanceDue + 0.001) {
    throw Errors.PAYMENT_EXCEEDS_INVOICE_BALANCE();
  }
  return inv.bookType;
}

/** Lock and check a loan a receipt is about to recover; returns the loan's book. */
async function validateLoanAllocation(
  tx: Prisma.TransactionClient,
  facilityId: string,
  partyId: string,
  alloc: { loan_id: string; allocated_amount_pkr: number },
): Promise<BookType> {
  if (!(await lockRow(tx, 'party_loans', alloc.loan_id, facilityId))) throw Errors.PESHGI_NOT_FOUND();
  const loan = await tx.partyLoan.findUniqueOrThrow({
    where: { id: alloc.loan_id },
    select: { status: true, partyId: true, balanceOutstandingPkr: true, bookType: true },
  });
  if (loan.status !== 'ACTIVE') throw Errors.PESHGI_INACTIVE();
  if (loan.partyId !== partyId) throw Errors.PAYMENT_PARTY_MISMATCH();
  if (alloc.allocated_amount_pkr > Number(loan.balanceOutstandingPkr) + 0.005) {
    throw Errors.PESHGI_OVER_REPAYMENT();
  }
  return loan.bookType;
}
