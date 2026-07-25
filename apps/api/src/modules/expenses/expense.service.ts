import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { generateExpenseVoucherNumber } from './expense-number';
import { buildJE17AExpensePaid } from './templates/je-17a-expense-paid';
import { buildJE17BExpenseAccrued } from './templates/je-17b-expense-accrued';
import { buildJE17BPayAccruedExpense } from './templates/je-17b-pay-accrued-payment';
import { buildJE17CPettyCashReplenish } from './templates/je-17c-petty-cash-replenish';
import { randomUUID } from 'node:crypto';

type Tx = Prisma.TransactionClient;

/**
 * Row-lock a voucher for the rest of the transaction, so a status check and the JE post
 * that follows it cannot interleave with a concurrent caller. Mirrors the guard already
 * used on invoices (`invoice.service.ts`), payments and loans.
 */
async function lockVoucher(tx: Tx, facilityId: string, id: string): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT id FROM expense_vouchers WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
    id,
    facilityId,
  );
}

export class ExpenseService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async create(facilityId: string, userId: string, body: any) {
    const voucherDate = new Date(body.voucher_date);
    return this.prisma.$transaction(async (tx) => {
      const voucherNumber = await generateExpenseVoucherNumber(tx, facilityId, voucherDate);
      const created = await tx.expenseVoucher.create({
        data: {
          facilityId,
          voucherNumber,
          voucherDate,
          expenseAccountCode: body.expense_account_code,
          description: body.description,
          vendorName: body.vendor_name ?? null,
          referenceNumber: body.reference_number ?? null,
          amountPkr: body.amount_pkr,
          paymentMethod: body.payment_method ?? null,
          assetAccountCode: body.asset_account_code ?? null,
          isAccrual: body.is_accrual ?? false,
          receiptUrl: body.receipt_url ?? null,
          bookType: body.book_type ?? 'PACCI',
          notes: body.notes ?? null,
          status: 'DRAFT',
          createdBy: userId,
        },
      });
      return formatVoucher(created);
    });
  }

  async update(facilityId: string, id: string, body: any) {
    const v = await this.prisma.expenseVoucher.findFirst({ where: { facilityId, id } });
    if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
    if (v.status !== 'DRAFT') {
      throw Errors.EXPENSE_VOUCHER_INVALID_STATUS('Only DRAFT vouchers can be edited');
    }
    const updated = await this.prisma.expenseVoucher.update({
      where: { id },
      data: {
        ...(body.voucher_date !== undefined ? { voucherDate: new Date(body.voucher_date) } : {}),
        ...(body.expense_account_code !== undefined
          ? { expenseAccountCode: body.expense_account_code }
          : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.vendor_name !== undefined ? { vendorName: body.vendor_name } : {}),
        ...(body.reference_number !== undefined ? { referenceNumber: body.reference_number } : {}),
        ...(body.amount_pkr !== undefined ? { amountPkr: body.amount_pkr } : {}),
        ...(body.payment_method !== undefined ? { paymentMethod: body.payment_method } : {}),
        ...(body.asset_account_code !== undefined ? { assetAccountCode: body.asset_account_code } : {}),
        ...(body.receipt_url !== undefined ? { receiptUrl: body.receipt_url } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
    return formatVoucher(updated);
  }

  async approve(facilityId: string, userId: string, id: string) {
    const v = await this.prisma.expenseVoucher.findFirst({ where: { facilityId, id } });
    if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
    if (v.status !== 'DRAFT') {
      throw Errors.EXPENSE_VOUCHER_INVALID_STATUS(`Cannot approve voucher in status ${v.status}`);
    }
    const updated = await this.prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: userId, approvedAt: new Date() },
    });
    return formatVoucher(updated);
  }

  async cancel(facilityId: string, id: string) {
    const v = await this.prisma.expenseVoucher.findFirst({ where: { facilityId, id } });
    if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
    if (v.status === 'PAID' || v.status === 'ACCRUED') {
      throw Errors.EXPENSE_VOUCHER_INVALID_STATUS(`Cannot cancel voucher in status ${v.status}`);
    }
    const updated = await this.prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
    return formatVoucher(updated);
  }

  async accrue(facilityId: string, userId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      // Row-lock before reading the status: without it two concurrent calls both see
      // APPROVED and both post, and nothing downstream stops them —
      // (source_table, source_id) on journal_entries is an index, not a unique key.
      await lockVoucher(tx, facilityId, id);

      const v = await tx.expenseVoucher.findFirst({ where: { facilityId, id } });
      if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
      if (v.status !== 'APPROVED') {
        throw Errors.EXPENSE_VOUCHER_INVALID_STATUS('Voucher must be APPROVED to accrue');
      }

      const draft = buildJE17BExpenseAccrued({
        voucherId: v.id,
        voucherNumber: v.voucherNumber,
        entryDate: v.voucherDate,
        expenseAccountCode: v.expenseAccountCode,
        amountPkr: Number(v.amountPkr),
        bookType: v.bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      const updated = await tx.expenseVoucher.update({
        where: { id },
        data: { status: 'ACCRUED', accrualJournalEntryId: posted.id, isAccrual: true },
      });
      return formatVoucher(updated);
    });
  }

  async pay(facilityId: string, userId: string, id: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      // See accrue(): the lock must precede the status read, or concurrent pays double-post.
      await lockVoucher(tx, facilityId, id);

      const v = await tx.expenseVoucher.findFirst({ where: { facilityId, id } });
      if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
      if (v.status !== 'APPROVED' && v.status !== 'ACCRUED') {
        throw Errors.EXPENSE_VOUCHER_INVALID_STATUS('Voucher must be APPROVED or ACCRUED to pay');
      }

      const paymentDate = new Date(body.payment_date);
      const assetAccount = body.asset_account_code;

      let draft;
      if (v.status === 'ACCRUED') {
        // JE-17B-PAY: clear liability
        draft = buildJE17BPayAccruedExpense({
          voucherId: v.id,
          voucherNumber: v.voucherNumber,
          entryDate: paymentDate,
          assetAccountCode: assetAccount,
          amountPkr: Number(v.amountPkr),
          bookType: v.bookType,
        });
      } else {
        // JE-17A: direct expense + payment
        draft = buildJE17AExpensePaid({
          voucherId: v.id,
          voucherNumber: v.voucherNumber,
          entryDate: paymentDate,
          expenseAccountCode: v.expenseAccountCode,
          assetAccountCode: assetAccount,
          amountPkr: Number(v.amountPkr),
          bookType: v.bookType,
        });
      }

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      const updated = await tx.expenseVoucher.update({
        where: { id },
        data: {
          status: 'PAID',
          paymentDate,
          paymentMethod: body.payment_method,
          assetAccountCode: assetAccount,
          paymentJournalEntryId: posted.id,
        },
      });
      return formatVoucher(updated);
    });
  }

  async pettyCashReplenish(facilityId: string, userId: string, body: any) {
    const ref = randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const draft = buildJE17CPettyCashReplenish({
        entryDate: new Date(body.replenishment_date),
        amountPkr: body.amount_pkr,
        sourceBankAccountCode: body.source_bank_account_code ?? '1020',
        bookType: body.book_type ?? 'PACCI',
        reference: ref,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });
      return {
        journal_entry_id: posted.id,
        amount_pkr: body.amount_pkr,
        replenishment_date: body.replenishment_date,
      };
    });
  }

  async getById(facilityId: string, id: string) {
    const v = await this.prisma.expenseVoucher.findFirst({ where: { facilityId, id } });
    if (!v) throw Errors.EXPENSE_VOUCHER_NOT_FOUND();
    return formatVoucher(v);
  }

  async list(facilityId: string, query: any) {
    const where: Prisma.ExpenseVoucherWhereInput = { facilityId };
    if (query.status) where.status = query.status;
    if (query.expense_account_code) where.expenseAccountCode = query.expense_account_code;
    if (query.date_from || query.date_to) {
      where.voucherDate = {};
      if (query.date_from) (where.voucherDate as any).gte = new Date(query.date_from);
      if (query.date_to) (where.voucherDate as any).lte = new Date(query.date_to);
    }
    const [data, total] = await Promise.all([
      this.prisma.expenseVoucher.findMany({
        where,
        orderBy: [{ voucherDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.expenseVoucher.count({ where }),
    ]);
    return {
      data: data.map(formatVoucher),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }
}

function formatVoucher(v: any) {
  return {
    id: v.id,
    voucher_number: v.voucherNumber,
    voucher_date: v.voucherDate.toISOString().slice(0, 10),
    payment_date: v.paymentDate ? v.paymentDate.toISOString().slice(0, 10) : null,
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
    receipt_url: v.receiptUrl,
    approved_by: v.approvedBy,
    approved_at: v.approvedAt?.toISOString() ?? null,
    notes: v.notes,
    created_at: v.createdAt.toISOString(),
  };
}
