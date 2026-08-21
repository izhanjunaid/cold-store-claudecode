import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { ACCOUNT_GST_PAYABLE } from './templates/types';
import { buildJE26GstSettlement, ACCOUNT_SALES_TAX_INPUT } from './templates/je-26-gst-settlement';
import type { JournalEntryService } from './journal-entry.service';

const SETTLEMENT_ACCOUNTS = ['1010', '1020', '1030'];

/**
 * Sales tax is a statutory liability, which only the official book carries.
 * A KATCHI invoice credits 2020 on the informal book; letting that leak into
 * the settlement would remit money the PACCI books never owed.
 */
const BOOK_TYPE = 'PACCI' as const;

const periodEndDate = (year: number, month: number) => new Date(Date.UTC(year, month, 0));
const periodStartDate = (year: number, month: number) => new Date(Date.UTC(year, month - 1, 1));

export type GstSettlementPreview = {
  period_year: number;
  period_month: number;
  period_end: string;
  /** Output tax credited to 2020 during this period alone — what the return form asks for. */
  period_output_tax_pkr: number;
  /** Input tax debited to 1260 during this period alone. */
  period_input_tax_pkr: number;
  /** Output tax accrued through the period end that has not yet been settled. */
  outstanding_output_tax_pkr: number;
  /** Input tax accrued through the period end that has not yet been applied. */
  available_input_tax_pkr: number;
  input_tax_applied_pkr: number;
  net_payable_pkr: number;
  /**
   * True when the outstanding amount exceeds this period's own output tax,
   * which means an earlier period was never settled and this settlement will
   * clear it too. Surfaced rather than silently rolled up.
   */
  includes_earlier_periods: boolean;
};

export class GstSettlementService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  private async sumSide(
    db: PrismaClient | Prisma.TransactionClient,
    facilityId: string,
    accountCode: string,
    window?: { gte?: Date; lte: Date },
  ) {
    const agg = await db.journalEntryLine.aggregate({
      where: {
        facilityId,
        accountCode,
        journalEntry: {
          postingStatus: 'POSTED',
          bookType: BOOK_TYPE,
          ...(window ? { entryDate: window } : {}),
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return {
      debit: Number(agg._sum.debitAmount ?? 0),
      credit: Number(agg._sum.creditAmount ?? 0),
    };
  }

  /**
   * What is still owed for everything accrued up to `periodEnd`.
   *
   * The two sides use **different windows on purpose**. Tax accrues inside the
   * period, but is settled weeks later — the March settlement is dated in
   * April. Comparing both sides at the period end would never see a
   * settlement's own debit, so re-running March after settling it would
   * settle March a second time. Counting every settlement regardless of date
   * is correct because a settlement only ever clears tax already accrued, and
   * it makes re-running a settled period return zero, which is what stops the
   * double post.
   */
  private async figures(
    db: PrismaClient | Prisma.TransactionClient,
    facilityId: string,
    year: number,
    month: number,
  ) {
    const periodEnd = periodEndDate(year, month);
    const inPeriod = { gte: periodStartDate(year, month), lte: periodEnd };
    const toPeriodEnd = { lte: periodEnd };

    const [outputInPeriod, inputInPeriod, outputToDate, inputToDate, outputEver, inputEver] =
      await Promise.all([
        this.sumSide(db, facilityId, ACCOUNT_GST_PAYABLE, inPeriod),
        this.sumSide(db, facilityId, ACCOUNT_SALES_TAX_INPUT, inPeriod),
        this.sumSide(db, facilityId, ACCOUNT_GST_PAYABLE, toPeriodEnd),
        this.sumSide(db, facilityId, ACCOUNT_SALES_TAX_INPUT, toPeriodEnd),
        this.sumSide(db, facilityId, ACCOUNT_GST_PAYABLE),
        this.sumSide(db, facilityId, ACCOUNT_SALES_TAX_INPUT),
      ]);

    const round = (n: number) => Math.round(n * 100) / 100;
    // 2020 accrues on the credit side and is settled on the debit side; 1260
    // is the mirror image.
    const outstanding = round(outputToDate.credit - outputEver.debit);
    const availableInput = round(inputToDate.debit - inputEver.credit);
    const applied = Math.max(Math.min(availableInput, outstanding), 0);

    return {
      periodEnd,
      periodOutput: round(outputInPeriod.credit - outputInPeriod.debit),
      periodInput: round(inputInPeriod.debit - inputInPeriod.credit),
      outstanding,
      availableInput,
      applied,
      netPayable: round(outstanding - applied),
    };
  }

  async preview(facilityId: string, year: number, month: number): Promise<GstSettlementPreview> {
    const f = await this.figures(this.prisma, facilityId, year, month);
    return {
      period_year: year,
      period_month: month,
      period_end: f.periodEnd.toISOString().slice(0, 10),
      period_output_tax_pkr: f.periodOutput,
      period_input_tax_pkr: f.periodInput,
      outstanding_output_tax_pkr: f.outstanding,
      available_input_tax_pkr: f.availableInput,
      input_tax_applied_pkr: f.applied,
      net_payable_pkr: f.netPayable,
      includes_earlier_periods: f.outstanding > f.periodOutput + 0.005,
    };
  }

  /**
   * Post the settlement.
   *
   * Idempotency falls out of the figures rather than an entry key: once a
   * period is settled its outstanding amount is zero, so a second run has
   * nothing to clear and refuses. A skipped period is handled by the same
   * arithmetic — the next settlement picks up both.
   */
  async settle(
    facilityId: string,
    userId: string,
    params: {
      period_year: number;
      period_month: number;
      payment_date: string;
      bank_account_code?: string;
    },
  ) {
    const bankAccountCode = params.bank_account_code ?? '1020';
    if (!SETTLEMENT_ACCOUNTS.includes(bankAccountCode)) {
      throw Errors.VALIDATION_ERROR(
        `Sales tax must be remitted from a cash or bank account (${SETTLEMENT_ACCOUNTS.join(', ')}).`,
        'bank_account_code',
      );
    }

    const paymentDate = new Date(`${params.payment_date}T00:00:00.000Z`);
    const periodEnd = periodEndDate(params.period_year, params.period_month);
    if (paymentDate < periodEnd) {
      throw Errors.VALIDATION_ERROR(
        `The payment date must fall on or after the end of the tax period (${periodEnd.toISOString().slice(0, 10)}) — the amount owed is not known until the period closes.`,
        'payment_date',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      // Two concurrent settlements would each read the same outstanding
      // amount and each post it. The result is immutable by trigger.
      await advisoryXactLock(tx, `${facilityId}:gst-settlement`);

      const f = await this.figures(tx, facilityId, params.period_year, params.period_month);

      if (f.outstanding <= 0.005) {
        throw Errors.VALIDATION_ERROR(
          `There is no sales tax outstanding for the period ended ${f.periodEnd.toISOString().slice(0, 10)} — nothing to settle.`,
          'period',
        );
      }

      const entry = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE26GstSettlement({
          facilityId,
          bookType: BOOK_TYPE,
          paymentDate,
          taxPeriodEnd: f.periodEnd,
          outputTaxPkr: f.outstanding,
          inputTaxAppliedPkr: f.applied,
          netRemittedPkr: f.netPayable,
          bankAccountCode,
        }),
      );

      return {
        entry_number: entry.entryNumber,
        journal_entry_id: entry.id,
        output_tax_pkr: f.outstanding,
        input_tax_applied_pkr: f.applied,
        net_remitted_pkr: f.netPayable,
        bank_account_code: bankAccountCode,
      };
    });
  }
}
