import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { WITHHOLDING_ACCOUNTS, WITHHOLDING_LABELS } from '../expenses/templates/withholding';
import { buildJE29WithholdingRemittance } from './templates/je-29-withholding-remittance';
import type { JournalEntryService } from './journal-entry.service';

const SETTLEMENT_ACCOUNTS = ['1010', '1020', '1030'];
const BOOK_TYPE = 'PACCI' as const;

const periodEndDate = (year: number, month: number) => new Date(Date.UTC(year, month, 0));

export type WithholdingSectionKey = keyof typeof WITHHOLDING_ACCOUNTS;

export class WithholdingRemittanceService {
  constructor(
    private prisma: PrismaClient,
    private journal: JournalEntryService,
  ) {}

  /**
   * Tax withheld up to the period end that has not yet been paid over.
   *
   * Same asymmetric windows as the GST settlement, for the same reason: the
   * tax is withheld inside the period but paid over weeks later, so measuring
   * both sides at the period end would never see a remittance's own
   * later-dated debit and would let the same period be paid twice.
   */
  async outstanding(
    db: PrismaClient | Prisma.TransactionClient,
    facilityId: string,
    accountCode: string,
    periodEnd: Date,
  ) {
    const [withheld, remitted] = await Promise.all([
      db.journalEntryLine.aggregate({
        where: {
          facilityId,
          accountCode,
          journalEntry: { postingStatus: 'POSTED', bookType: BOOK_TYPE, entryDate: { lte: periodEnd } },
        },
        _sum: { creditAmount: true },
      }),
      db.journalEntryLine.aggregate({
        where: {
          facilityId,
          accountCode,
          journalEntry: { postingStatus: 'POSTED', bookType: BOOK_TYPE },
        },
        _sum: { debitAmount: true },
      }),
    ]);
    return (
      Math.round(
        (Number(withheld._sum.creditAmount ?? 0) - Number(remitted._sum.debitAmount ?? 0)) * 100,
      ) / 100
    );
  }

  async remit(
    facilityId: string,
    userId: string,
    params: {
      section: WithholdingSectionKey;
      period_year: number;
      period_month: number;
      payment_date: string;
      bank_account_code?: string;
    },
  ) {
    const accountCode = WITHHOLDING_ACCOUNTS[params.section];
    if (!accountCode) {
      // s.149 is deliberately not remittable here — 2070 clears through the
      // payroll run's own remittance step, and a second path to it would let
      // the same liability be paid over twice.
      throw Errors.VALIDATION_ERROR(
        'Only s.153 and s.155 are paid over here. Salary tax (s.149) is remitted from the payroll run that withheld it.',
        'section',
      );
    }

    const bankAccountCode = params.bank_account_code ?? '1020';
    if (!SETTLEMENT_ACCOUNTS.includes(bankAccountCode)) {
      throw Errors.VALIDATION_ERROR(
        `Tax must be paid from a cash or bank account (${SETTLEMENT_ACCOUNTS.join(', ')}).`,
        'bank_account_code',
      );
    }

    const paymentDate = new Date(`${params.payment_date}T00:00:00.000Z`);
    const periodEnd = periodEndDate(params.period_year, params.period_month);
    if (paymentDate < periodEnd) {
      throw Errors.VALIDATION_ERROR(
        `The payment date must fall on or after the end of the tax period (${periodEnd.toISOString().slice(0, 10)}).`,
        'payment_date',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      await advisoryXactLock(tx, `${facilityId}:withholding-remittance:${params.section}`);

      const amount = await this.outstanding(tx, facilityId, accountCode, periodEnd);
      if (amount <= 0.005) {
        throw Errors.VALIDATION_ERROR(
          `There is no ${params.section} tax outstanding for the period ended ${periodEnd.toISOString().slice(0, 10)} — nothing to pay over.`,
          'period',
        );
      }

      const entry = await this.journal.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE29WithholdingRemittance({
          facilityId,
          bookType: BOOK_TYPE,
          paymentDate,
          taxPeriodEnd: periodEnd,
          section: params.section,
          sectionLabel: WITHHOLDING_LABELS[params.section] ?? params.section,
          withholdingAccountCode: accountCode,
          amountPkr: amount,
          bankAccountCode,
        }),
        { postingStatus: 'POSTED' },
      );

      return {
        entry_number: entry.entryNumber,
        journal_entry_id: entry.id,
        section: params.section,
        account_code: accountCode,
        amount_pkr: amount,
        bank_account_code: bankAccountCode,
      };
    });
  }
}
