import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  toIsoDate,
  type ConvertExpenseVoucherRequestType,
  type ExpenseVoucherActionType,
  type ExpenseVoucherListQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { payableSupplier } from '../payables/supplier';
import { buildJE35VoucherConversion } from '../payables/templates/je-35-voucher-conversion';

type Tx = Prisma.TransactionClient;

const include = { convertedToBill: { select: { id: true } } } satisfies Prisma.ExpenseVoucherInclude;
type Row = Prisma.ExpenseVoucherGetPayload<{ include: typeof include }>;

/**
 * Expense vouchers, retired (docs/25 C-03 / C-08 / C-04). The three ways a voucher used
 * to book a cost — paid at once (JE-17A), accrued then paid (JE-17B), petty cash
 * (JE-17C) — are gone; costs are supplier bills. What a box already holds stays
 * readable, a voucher that posted nothing can be cancelled, and an accrued one is
 * converted to a bill.
 */
export class ExpenseService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  async cancel(facilityId: string, role: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const v = await lock(tx, facilityId, id);
      assertKatchiWriteAllowed(role, v.bookType);
      if (v.status !== 'DRAFT' && v.status !== 'APPROVED') {
        throw Errors.EXPENSE_VOUCHER_INVALID_STATUS(`Cannot cancel a voucher in status ${v.status}`);
      }
      const updated = await tx.expenseVoucher.update({ where: { id }, data: { status: 'CANCELLED' }, include });
      return formatVoucher(updated);
    });
  }

  /**
   * Turn an accrued voucher into a posted bill of the chosen supplier (JE-35): the bill
   * carries the voucher's cost line, dated when the cost was incurred, and the entry
   * moves the liability from 2040 onto the supplier's account on the conversion date.
   * The voucher's own accrual stands — the cost is not booked a second time, so the
   * expense-account rule is not re-run on a line nothing posts to.
   */
  async convertToBill(
    facilityId: string,
    userId: string,
    role: string,
    id: string,
    body: ConvertExpenseVoucherRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const v = await lock(tx, facilityId, id);
      assertKatchiWriteAllowed(role, v.bookType);
      if (v.status !== 'ACCRUED') {
        throw Errors.EXPENSE_VOUCHER_INVALID_STATUS('Only an ACCRUED voucher is converted to a bill');
      }
      const supplier = await payableSupplier(tx, facilityId, body.supplier_party_id);
      const conversionDate = new Date(`${body.conversion_date ?? toIsoDate(new Date())}T00:00:00.000Z`);
      if (conversionDate < v.voucherDate) {
        throw Errors.VALIDATION_ERROR('A voucher cannot be converted before its own date', 'conversion_date');
      }

      const billNumber = await nextDocumentNumber(
        tx,
        facilityId,
        'bills',
        documentNumberPrefix('BILL', v.voucherDate, 'monthly'),
        4,
      );
      const amount = Number(v.amountPkr);
      const bill = await tx.bill.create({
        data: {
          facilityId,
          billNumber,
          supplierPartyId: supplier.id,
          billDate: v.voucherDate,
          dueDate: body.due_date ? new Date(`${body.due_date}T00:00:00.000Z`) : null,
          supplierReference: v.referenceNumber,
          description: v.description,
          subtotalPkr: amount,
          inputTaxPkr: 0,
          totalPkr: amount,
          status: 'POSTED',
          bookType: v.bookType,
          legacyExpenseVoucherId: v.id,
          createdBy: userId,
          lines: {
            create: [
              {
                facilityId,
                lineNumber: 1,
                expenseAccountCode: v.expenseAccountCode,
                description: v.description.slice(0, 300),
                amountPkr: amount,
              },
            ],
          },
        },
      });
      const posted = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE35VoucherConversion({
          billId: bill.id,
          billNumber,
          voucherNumber: v.voucherNumber,
          conversionDate,
          supplier,
          amountPkr: amount,
          bookType: v.bookType,
        }),
      );
      await tx.bill.update({ where: { id: bill.id }, data: { journalEntryId: posted.id } });
      const updated = await tx.expenseVoucher.update({ where: { id }, data: { status: 'CONVERTED' }, include });
      return formatVoucher(updated);
    });
  }

  async getById(facilityId: string, id: string) {
    const v = await this.prisma.expenseVoucher.findFirst({ where: { facilityId, id }, include });
    if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
    return formatVoucher(v);
  }

  async list(facilityId: string, query: ExpenseVoucherListQueryType) {
    const where: Prisma.ExpenseVoucherWhereInput = {
      facilityId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.expense_account_code ? { expenseAccountCode: query.expense_account_code } : {}),
      ...(query.date_from || query.date_to
        ? {
            voucherDate: {
              ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
              ...(query.date_to ? { lte: new Date(query.date_to) } : {}),
            },
          }
        : {}),
    };
    const [data, total] = await Promise.all([
      this.prisma.expenseVoucher.findMany({
        where,
        include,
        orderBy: [{ voucherDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.expenseVoucher.count({ where }),
    ]);
    return { data: data.map(formatVoucher), meta: { total, page: query.page, per_page: query.page_size } };
  }
}

async function lock(tx: Tx, facilityId: string, id: string) {
  if (!(await lockRow(tx, 'expense_vouchers', id, facilityId))) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
  return tx.expenseVoucher.findFirstOrThrow({ where: { facilityId, id } });
}

/** What may still happen to a voucher (docs/25 C-11): the web reads this, never its own rule. */
function allowedActions(status: string): ExpenseVoucherActionType[] {
  if (status === 'DRAFT' || status === 'APPROVED') return ['cancel'];
  if (status === 'ACCRUED') return ['convert_to_bill'];
  return [];
}

function formatVoucher(v: Row) {
  return {
    id: v.id,
    voucher_number: v.voucherNumber,
    voucher_date: toIsoDate(v.voucherDate),
    payment_date: v.paymentDate ? toIsoDate(v.paymentDate) : null,
    expense_account_code: v.expenseAccountCode,
    description: v.description,
    vendor_name: v.vendorName,
    reference_number: v.referenceNumber,
    amount_pkr: Number(v.amountPkr),
    payment_method: v.paymentMethod,
    asset_account_code: v.assetAccountCode,
    is_accrual: v.isAccrual,
    status: v.status,
    book_type: v.bookType,
    accrual_journal_entry_id: v.accrualJournalEntryId,
    payment_journal_entry_id: v.paymentJournalEntryId,
    bill_id: v.convertedToBill?.id ?? null,
    receipt_url: v.receiptUrl,
    approved_by: v.approvedBy,
    approved_at: v.approvedAt?.toISOString() ?? null,
    notes: v.notes,
    allowed_actions: allowedActions(v.status),
    created_at: v.createdAt.toISOString(),
  };
}
