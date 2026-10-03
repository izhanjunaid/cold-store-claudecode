import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  MONEY_EPSILON,
  SYSTEM_ACCOUNTS,
  monthEnd,
  round2,
  toIsoDate,
  type CreateTaxRemittanceRequestType,
  type TaxRemittanceActionType,
  type TaxRemittanceListQueryType,
  type VoidDocumentRequestType,
} from '@coldchain/shared';
import { AppError, Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { lockRow } from '../../common/row-lock';
import { assertKatchiWriteAllowed } from './book-gate';
import { assertCashAccount } from './cash-account';
import { postedLinesWhere } from './ledger';
import { postedEntryNumber, type JournalEntryService } from './journal-entry.service';
import { buildJE34TaxRemittance } from './templates/je-34-tax-remittance';

type Db = PrismaClient | Prisma.TransactionClient;
type Book = 'PACCI' | 'KATCHI';

/** Every liability the facility collects for the state and pays over by period. */
export const STATUTORY_LIABILITY_ACCOUNTS: readonly string[] = [
  SYSTEM_ACCOUNTS.EOBI_EMPLOYEE,
  SYSTEM_ACCOUNTS.EOBI_EMPLOYER,
  SYSTEM_ACCOUNTS.WHT_SALARIES,
  SYSTEM_ACCOUNTS.WHT_SUPPLIERS,
  SYSTEM_ACCOUNTS.WHT_RENT,
];

/**
 * Lines that pay a liability over, rather than create or correct it: this document's
 * entries and their reversals, the retired JE-29 (`withholding_remittance`) and the
 * retired per-run JE-16B (GOVT_REMITTANCE).
 */
const REMITTANCE_SOURCES = ['tax_remittances', 'withholding_remittance'];
export const REMITTANCE_ENTRIES: Prisma.JournalEntryWhereInput = {
  OR: [{ sourceTable: { in: REMITTANCE_SOURCES } }, { entryType: 'GOVT_REMITTANCE' }],
};
export const isRemittanceEntry = (e: { sourceTable: string; entryType: string }) =>
  REMITTANCE_SOURCES.includes(e.sourceTable) || e.entryType === 'GOVT_REMITTANCE';

const NOT_FOUND = () => new AppError('TAX_REMITTANCE_NOT_FOUND', 'Remittance does not exist', 404);
const ALREADY_VOIDED = () => new AppError('TAX_REMITTANCE_ALREADY_VOIDED', 'This remittance has already been voided', 409);
const NOTHING_OUTSTANDING = (name: string, periodEnd: string) =>
  new AppError('TAX_NOTHING_OUTSTANDING', `Nothing is outstanding on ${name} for the period ended ${periodEnd}`, 422);

const periodEndOf = (year: number, month: number) => monthEnd(year, month);

/**
 * What is still owed on each statutory account for a period: everything that created
 * or corrected the liability up to the period end, less every remittance whenever it
 * was made. The asymmetric windows are deliberate (the GST settlement uses the same):
 * tax withheld in March is paid over in April, so a remittance dated after the period
 * still clears it — and so the same period cannot be paid twice. A voided remittance
 * nets to zero (its reversal is a remittance line too), so voiding owes it again.
 */
export async function outstandingByAccount(
  db: Db,
  facilityId: string,
  book: Book,
  periodEnd: Date,
  accounts: readonly string[] = STATUTORY_LIABILITY_ACCOUNTS,
): Promise<Map<string, number>> {
  const [accrued, remitted] = await Promise.all([
    db.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: {
        AND: [postedLinesWhere({ facilityId, book, to: periodEnd }), { journalEntry: { NOT: REMITTANCE_ENTRIES } }],
        accountCode: { in: [...accounts] },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
    db.journalEntryLine.groupBy({
      by: ['accountCode'],
      where: {
        AND: [postedLinesWhere({ facilityId, book }), { journalEntry: REMITTANCE_ENTRIES }],
        accountCode: { in: [...accounts] },
      },
      _sum: { debitAmount: true, creditAmount: true },
    }),
  ]);
  const net = (r: { _sum: { debitAmount: unknown; creditAmount: unknown } }) =>
    Number(r._sum.creditAmount ?? 0) - Number(r._sum.debitAmount ?? 0);
  const result = new Map(accounts.map((code) => [code, 0]));
  for (const r of accrued) result.set(r.accountCode, (result.get(r.accountCode) ?? 0) + net(r));
  for (const r of remitted) result.set(r.accountCode, (result.get(r.accountCode) ?? 0) + net(r));
  for (const [code, v] of result) result.set(code, round2(v));
  return result;
}

const include = {
  liabilityAccount: { select: { accountName: true } },
  paidFromAccount: { select: { accountName: true } },
  journalEntry: { select: { entryNumber: true } },
} satisfies Prisma.TaxRemittanceInclude;

type Row = Prisma.TaxRemittanceGetPayload<{ include: typeof include }>;

/**
 * One period-based statutory remittance (docs/25 C-10) for EOBI, s.149, s.153 and
 * s.155 — a document with a challan number and a void, replacing JE-29 and the payroll
 * run's own per-run remittance.
 */
export class TaxRemittanceService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  async outstanding(facilityId: string, book: Book, year: number, month: number) {
    const [amounts, accounts] = await Promise.all([
      outstandingByAccount(this.prisma, facilityId, book, periodEndOf(year, month)),
      this.prisma.chartOfAccounts.findMany({
        where: { facilityId, accountCode: { in: [...STATUTORY_LIABILITY_ACCOUNTS] } },
        select: { accountCode: true, accountName: true },
      }),
    ]);
    const names = new Map(accounts.map((a) => [a.accountCode, a.accountName]));
    return STATUTORY_LIABILITY_ACCOUNTS.filter((code) => names.has(code)).map((code) => ({
      account_code: code,
      account_name: names.get(code)!,
      outstanding_pkr: amounts.get(code) ?? 0,
    }));
  }

  async remit(facilityId: string, userId: string, role: string, body: CreateTaxRemittanceRequestType) {
    assertKatchiWriteAllowed(role, body.book_type);
    if (!STATUTORY_LIABILITY_ACCOUNTS.includes(body.liability_account_code)) {
      throw Errors.VALIDATION_ERROR(
        `${body.liability_account_code} is not a statutory liability (EOBI or tax withheld)`,
        'liability_account_code',
      );
    }
    const periodEnd = periodEndOf(body.period_year, body.period_month);
    const remittanceDate = new Date(`${body.remittance_date}T00:00:00.000Z`);
    if (remittanceDate < periodEnd) {
      throw Errors.VALIDATION_ERROR(
        `The remittance date must fall on or after the end of the period (${toIsoDate(periodEnd)}).`,
        'remittance_date',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await assertCashAccount(tx, facilityId, body.paid_from_account_code);
      // One remitter per liability and book at a time; the amount is read inside the lock.
      await advisoryXactLock(tx, `${facilityId}:tax-remittance:${body.book_type}:${body.liability_account_code}`);
      const liability = await tx.chartOfAccounts.findUniqueOrThrow({
        where: { facilityId_accountCode: { facilityId, accountCode: body.liability_account_code } },
        select: { accountCode: true, accountName: true },
      });
      const amount =
        (await outstandingByAccount(tx, facilityId, body.book_type, periodEnd, [liability.accountCode])).get(
          liability.accountCode,
        ) ?? 0;
      if (amount < MONEY_EPSILON) throw NOTHING_OUTSTANDING(liability.accountName, toIsoDate(periodEnd));

      const doc = await tx.taxRemittance.create({
        data: {
          facilityId,
          liabilityAccountCode: liability.accountCode,
          periodYear: body.period_year,
          periodMonth: body.period_month,
          remittanceDate,
          amountPkr: amount,
          paidFromAccountCode: body.paid_from_account_code,
          challanNumber: body.challan_number ?? null,
          bookType: body.book_type,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });
      const posted = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE34TaxRemittance({
          remittanceId: doc.id,
          remittanceDate,
          periodEnd: toIsoDate(periodEnd),
          liability: { code: liability.accountCode, name: liability.accountName },
          paidFromAccountCode: body.paid_from_account_code,
          amountPkr: amount,
          challanNumber: doc.challanNumber,
          bookType: body.book_type,
        }),
      );
      const saved = await tx.taxRemittance.update({ where: { id: doc.id }, data: { journalEntryId: posted.id }, include });
      return format(saved);
    });
  }

  /** Void a remittance recorded in error: reverse its entry; the liability is owed again. */
  async void(facilityId: string, userId: string, role: string, id: string, body: VoidDocumentRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'tax_remittances', id, facilityId))) throw NOT_FOUND();
      const doc = await tx.taxRemittance.findFirstOrThrow({ where: { id, facilityId } });
      assertKatchiWriteAllowed(role, doc.bookType);
      if (doc.voidedAt) throw ALREADY_VOIDED();
      if (!doc.journalEntryId) throw new Error(`Tax remittance ${id} has no journal entry`);

      await this.journal.reverseInTransaction(tx, facilityId, userId, doc.journalEntryId, {
        reason: `statutory remittance voided — ${body.reason}`,
        date: body.void_date ? new Date(`${body.void_date}T00:00:00.000Z`) : undefined,
      });
      const saved = await tx.taxRemittance.update({
        where: { id },
        data: { voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
        include,
      });
      return format(saved);
    });
  }

  async list(facilityId: string, book: Book, query: TaxRemittanceListQueryType) {
    const where: Prisma.TaxRemittanceWhereInput = {
      facilityId,
      bookType: book,
      ...(query.period_year ? { periodYear: query.period_year } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.taxRemittance.findMany({
        where,
        include,
        orderBy: [{ remittanceDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.taxRemittance.count({ where }),
    ]);
    return { data: rows.map(format), meta: { total, page: query.page, per_page: query.page_size } };
  }
}

function allowedActions(r: { voidedAt: Date | null }): TaxRemittanceActionType[] {
  return r.voidedAt ? [] : ['void'];
}

function format(r: Row) {
  return {
    id: r.id,
    liability_account_code: r.liabilityAccountCode,
    liability_account_name: r.liabilityAccount.accountName,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    remittance_date: toIsoDate(r.remittanceDate),
    amount_pkr: Number(r.amountPkr),
    paid_from_account_code: r.paidFromAccountCode,
    paid_from_account_name: r.paidFromAccount.accountName,
    challan_number: r.challanNumber,
    book_type: r.bookType,
    journal_entry_id: r.journalEntryId,
    entry_number: r.journalEntry ? postedEntryNumber(r.journalEntry) : null,
    voided_at: r.voidedAt?.toISOString() ?? null,
    void_reason: r.voidReason,
    notes: r.notes,
    allowed_actions: allowedActions(r),
    created_at: r.createdAt.toISOString(),
  };
}
