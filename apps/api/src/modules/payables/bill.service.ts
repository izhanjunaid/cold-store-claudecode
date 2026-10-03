import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  MONEY_EPSILON,
  round2,
  sumMoney,
  toIsoDate,
  type BillActionType,
  type BillListQueryType,
  type BillRequestType,
  type PostBillRequestType,
  type VoidDocumentRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { postedEntryNumber, type JournalEntryService } from '../accounting/journal-entry.service';
import { PayablesErrors } from './errors';
import { assertExpenseAccount } from './expense-account';
import { payableSupplier } from './supplier';
import type { SupplierPaymentService } from './supplier-payment.service';
import { buildJE32Bill } from './templates/je-32-bill';

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;
type Book = 'PACCI' | 'KATCHI';

const include = {
  supplier: { select: { name: true } },
  journalEntry: { select: { entryNumber: true } },
  lines: { include: { account: { select: { accountName: true } } }, orderBy: { lineNumber: 'asc' } },
  allocations: {
    include: { supplierPayment: { select: { paymentNumber: true, paymentDate: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.BillInclude;

type Row = Prisma.BillGetPayload<{ include: typeof include }>;

const toDate = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/**
 * A supplier's bill (docs/25 Q3): drafted, then posted at its own date to the
 * supplier's control account, paid through supplier payments, voided through the
 * reversal path. Its payment state is derived from live allocations, never stored.
 */
export class BillService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
    private payments: SupplierPaymentService,
  ) {}

  async create(facilityId: string, userId: string, role: string, body: BillRequestType) {
    assertKatchiWriteAllowed(role, body.book_type);
    return this.prisma.$transaction(async (tx) => {
      const amounts = await validate(tx, facilityId, body);
      const bill = await tx.bill.create({
        data: {
          facilityId,
          supplierPartyId: body.supplier_party_id,
          billDate: toDate(body.bill_date),
          dueDate: body.due_date ? toDate(body.due_date) : null,
          supplierReference: body.supplier_reference ?? null,
          description: body.description,
          ...amounts,
          bookType: body.book_type,
          notes: body.notes ?? null,
          createdBy: userId,
          lines: { create: lineRows(facilityId, body) },
        },
      });
      return this.detail(tx, facilityId, bill.id);
    });
  }

  /** Replace a draft's header and lines. Nothing has posted, so nothing to undo. */
  async update(facilityId: string, role: string, id: string, body: BillRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const bill = await this.lockDraft(tx, facilityId, role, id);
      assertKatchiWriteAllowed(role, body.book_type);
      const amounts = await validate(tx, facilityId, body);
      await tx.billLine.deleteMany({ where: { billId: bill.id } });
      await tx.bill.update({
        where: { id },
        data: {
          supplierPartyId: body.supplier_party_id,
          billDate: toDate(body.bill_date),
          dueDate: body.due_date ? toDate(body.due_date) : null,
          supplierReference: body.supplier_reference ?? null,
          description: body.description,
          ...amounts,
          bookType: body.book_type,
          notes: body.notes ?? null,
          lines: { create: lineRows(facilityId, body) },
        },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  async remove(facilityId: string, role: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDraft(tx, facilityId, role, id);
      await tx.bill.delete({ where: { id } });
      return { id, deleted: true };
    });
  }

  /**
   * Post a draft (JE-32): numbered now, from the bill date, so an abandoned draft
   * consumes no number and an edited date never keeps a stale one (C-12). Every rule is
   * re-checked — the chart or the supplier may have changed since the draft was saved.
   * With `pay_now`, the bill is paid in full in the same transaction.
   */
  async post(facilityId: string, userId: string, role: string, id: string, body: PostBillRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const draft = await this.lockDraft(tx, facilityId, role, id);
      const lines = await tx.billLine.findMany({ where: { billId: id }, orderBy: { lineNumber: 'asc' } });
      for (const l of lines) await assertExpenseAccount(tx, facilityId, l.expenseAccountCode, 'lines');
      const supplier = await payableSupplier(tx, facilityId, draft.supplierPartyId);

      const billNumber = await nextDocumentNumber(
        tx,
        facilityId,
        'bills',
        documentNumberPrefix('BILL', draft.billDate, 'monthly'),
        4,
      );
      const posted = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE32Bill({
          billId: id,
          billNumber,
          billDate: draft.billDate,
          supplier,
          lines: lines.map((l) => ({
            expenseAccountCode: l.expenseAccountCode,
            description: l.description,
            amountPkr: Number(l.amountPkr),
          })),
          inputTaxPkr: Number(draft.inputTaxPkr),
          totalPkr: Number(draft.totalPkr),
          bookType: draft.bookType,
        }),
      );
      await tx.bill.update({ where: { id }, data: { status: 'POSTED', billNumber, journalEntryId: posted.id } });

      if (body.pay_now) {
        await this.payments.createInTransaction(tx, facilityId, userId, role, {
          ...body.pay_now,
          supplier_party_id: supplier.id,
          gross_amount_pkr: Number(draft.totalPkr),
          book_type: draft.bookType,
          allocations: [{ bill_id: id, amount_pkr: Number(draft.totalPkr) }],
        });
      }
      return this.detail(tx, facilityId, id);
    });
  }

  /**
   * Void a posted bill entered in error: reverse its entry, keep the row. A bill that
   * payments still settle cannot be voided — void those payments first, or the
   * supplier would show as paid for a bill that no longer exists.
   */
  async void(facilityId: string, userId: string, role: string, id: string, body: VoidDocumentRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'bills', id, facilityId))) throw PayablesErrors.BILL_NOT_FOUND();
      const bill = await tx.bill.findFirstOrThrow({ where: { id, facilityId }, include: { allocations: true } });
      assertKatchiWriteAllowed(role, bill.bookType);
      if (bill.status !== 'POSTED') throw PayablesErrors.BILL_INVALID_STATUS(`A ${bill.status} bill cannot be voided`);
      // Its entry only moved an accrued voucher's liability; reversing it would hand the
      // liability back to a voucher that can no longer be paid (C-03).
      if (bill.legacyExpenseVoucherId) {
        throw PayablesErrors.BILL_INVALID_STATUS(
          'A bill converted from an expense voucher cannot be voided; correct the supplier account with a journal entry',
        );
      }
      if (bill.allocations.some((a) => !a.voidedAt)) throw PayablesErrors.BILL_HAS_PAYMENTS();
      if (!bill.journalEntryId) throw new Error(`Bill ${id} has no journal entry`);

      await this.journal.reverseInTransaction(tx, facilityId, userId, bill.journalEntryId, {
        reason: `bill ${bill.billNumber} voided — ${body.reason}`,
        date: body.void_date ? toDate(body.void_date) : undefined,
      });
      await tx.bill.update({
        where: { id },
        data: { status: 'VOID', voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });
      return this.detail(tx, facilityId, id);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.detail(this.prisma, facilityId, id);
  }

  async list(facilityId: string, book: Book, query: BillListQueryType) {
    const where: Prisma.BillWhereInput = {
      facilityId,
      bookType: book,
      ...(query.supplier_party_id ? { supplierPartyId: query.supplier_party_id } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.date_from || query.date_to
        ? {
            billDate: {
              ...(query.date_from ? { gte: toDate(query.date_from) } : {}),
              ...(query.date_to ? { lte: toDate(query.date_to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.bill.findMany({
        where,
        include,
        orderBy: [{ billDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.bill.count({ where }),
    ]);
    return { data: rows.map(format), meta: { total, page: query.page, per_page: query.page_size } };
  }

  private async lockDraft(tx: Tx, facilityId: string, role: string, id: string) {
    if (!(await lockRow(tx, 'bills', id, facilityId))) throw PayablesErrors.BILL_NOT_FOUND();
    const bill = await tx.bill.findFirstOrThrow({ where: { id, facilityId } });
    assertKatchiWriteAllowed(role, bill.bookType);
    if (bill.status !== 'DRAFT') {
      throw PayablesErrors.BILL_INVALID_STATUS(`Bill ${bill.billNumber} is ${bill.status}; only a draft can change`);
    }
    return bill;
  }

  private async detail(db: Db, facilityId: string, id: string) {
    const row = await db.bill.findFirst({ where: { id, facilityId }, include });
    if (!row) throw PayablesErrors.BILL_NOT_FOUND();
    return format(row);
  }
}

/** The rules a bill obeys before it is saved, returning its amounts. */
async function validate(tx: Tx, facilityId: string, body: BillRequestType) {
  await payableSupplier(tx, facilityId, body.supplier_party_id);
  for (const [i, l] of body.lines.entries()) {
    await assertExpenseAccount(tx, facilityId, l.expense_account_code, `lines.${i}.expense_account_code`);
  }
  const inputTax = round2(body.input_tax_pkr);
  // The informal book carries no sales tax (docs/25 L-14, R-06).
  if (body.book_type === 'KATCHI' && inputTax > 0) {
    throw Errors.VALIDATION_ERROR('A bill in the informal book carries no sales tax.', 'input_tax_pkr');
  }
  const subtotal = sumMoney(body.lines.map((l) => round2(l.amount_pkr)));
  return { subtotalPkr: subtotal, inputTaxPkr: inputTax, totalPkr: round2(subtotal + inputTax) };
}

function lineRows(facilityId: string, body: BillRequestType) {
  return body.lines.map((l, i) => ({
    facilityId,
    lineNumber: i + 1,
    expenseAccountCode: l.expense_account_code,
    description: l.description,
    amountPkr: round2(l.amount_pkr),
  }));
}

function allowedActions(b: Row, paid: number, open: number): BillActionType[] {
  switch (b.status) {
    case 'DRAFT':
      return ['edit', 'delete', 'post'];
    case 'POSTED':
      return [
        ...(open > MONEY_EPSILON ? (['pay'] as const) : []),
        ...(paid > MONEY_EPSILON || b.legacyExpenseVoucherId ? [] : (['void'] as const)),
      ];
    default:
      return [];
  }
}

function format(b: Row) {
  const live = b.allocations.filter((a) => !a.voidedAt);
  const paid = sumMoney(live.map((a) => Number(a.allocatedAmountPkr)));
  const open = b.status === 'POSTED' ? round2(Number(b.totalPkr) - paid) : 0;
  return {
    id: b.id,
    bill_number: b.billNumber,
    supplier_party_id: b.supplierPartyId,
    supplier_name: b.supplier.name,
    bill_date: toIsoDate(b.billDate),
    due_date: b.dueDate ? toIsoDate(b.dueDate) : null,
    supplier_reference: b.supplierReference,
    description: b.description,
    subtotal_pkr: Number(b.subtotalPkr),
    input_tax_pkr: Number(b.inputTaxPkr),
    total_pkr: Number(b.totalPkr),
    status: b.status,
    book_type: b.bookType,
    journal_entry_id: b.journalEntryId,
    entry_number: b.journalEntry ? postedEntryNumber(b.journalEntry) : null,
    legacy_expense_voucher_id: b.legacyExpenseVoucherId,
    paid_pkr: paid,
    open_pkr: open,
    payment_status: b.status !== 'POSTED' ? null : paid < MONEY_EPSILON ? 'UNPAID' : open > MONEY_EPSILON ? 'PARTIAL' : 'PAID',
    lines: b.lines.map((l) => ({
      line_number: l.lineNumber,
      expense_account_code: l.expenseAccountCode,
      expense_account_name: l.account.accountName,
      description: l.description,
      amount_pkr: Number(l.amountPkr),
    })),
    payments: live.map((a) => ({
      supplier_payment_id: a.supplierPaymentId,
      payment_number: a.supplierPayment.paymentNumber,
      payment_date: toIsoDate(a.supplierPayment.paymentDate),
      amount_pkr: Number(a.allocatedAmountPkr),
    })),
    voided_at: b.voidedAt?.toISOString() ?? null,
    void_reason: b.voidReason,
    notes: b.notes,
    allowed_actions: allowedActions(b, paid, open),
    created_at: b.createdAt.toISOString(),
  };
}
