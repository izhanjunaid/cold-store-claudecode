import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  IssuePeshgiRequestType,
  RecordRepaymentRequestType,
  WriteOffPeshgiRequestType,
  PartyLoanListQueryType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { generatePeshgiNumber } from './peshgi-number';
import { buildJE18PeshgiIssued } from './templates/je-18-peshgi-issued';
import { buildJE19PeshgiRecovered } from './templates/je-19-peshgi-recovered';
import { buildJE20PeshgiWriteOff } from './templates/je-20-peshgi-write-off';

const PAYMENT_METHOD_ASSET: Record<string, string> = {
  CASH: '1010',
  BANK_TRANSFER: '1020',
};

export class PeshgiService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async issue(facilityId: string, userId: string, body: IssuePeshgiRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const party = await tx.party.findFirst({
        where: { facilityId, id: body.party_id, isActive: true },
      });
      if (!party) throw Errors.PARTY_NOT_FOUND();

      const issueDate = new Date(body.issue_date);
      const loanNumber = await generatePeshgiNumber(tx, facilityId, issueDate);
      const bookType = body.book_type ?? 'PACCI';
      const sourceAccount =
        body.source_asset_account_code ?? PAYMENT_METHOD_ASSET[body.payment_method] ?? '1010';

      const loan = await tx.partyLoan.create({
        data: {
          facilityId,
          loanNumber,
          partyId: body.party_id,
          issueDate,
          principalPkr: body.principal_pkr,
          balanceOutstandingPkr: body.principal_pkr,
          status: 'ACTIVE',
          bookType,
          sourceAssetAccountCode: sourceAccount,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });

      const draft = buildJE18PeshgiIssued({
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        partyId: party.id,
        partyName: party.name,
        entryDate: issueDate,
        amountPkr: Number(loan.principalPkr),
        fromAssetAccountCode: sourceAccount,
        bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.partyLoan.update({
        where: { id: loan.id },
        data: { issueJournalEntryId: posted.id },
      });

      return this.getByIdInternal(facilityId, loan.id, tx);
    });
  }

  async recordRepayment(
    facilityId: string,
    userId: string,
    loanId: string,
    body: RecordRepaymentRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM party_loans WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        loanId,
        facilityId,
      );

      const loan = await tx.partyLoan.findFirst({
        where: { facilityId, id: loanId },
        include: { party: { select: { name: true } } },
      });
      if (!loan) throw Errors.PESHGI_NOT_FOUND();
      if (loan.status !== 'ACTIVE') throw Errors.PESHGI_INACTIVE();

      const amount = body.amount_pkr;
      const balance = Number(loan.balanceOutstandingPkr);
      if (amount > balance + 0.005) {
        throw Errors.PESHGI_OVER_REPAYMENT();
      }

      // DEDUCTED_FROM_PRODUCE may not have a cash-side; the JE-19 is built only when
      // a cash-side asset account is supplied. The combined-settlement allocator
      // (see payment.service) supplies it via the payment's asset_account_code.
      const isProduceDeduction = body.payment_method === 'DEDUCTED_FROM_PRODUCE';
      const assetAccount = body.asset_account_code ?? null;
      if (!isProduceDeduction && !assetAccount) {
        throw Errors.VALIDATION_ERROR(
          'asset_account_code is required for CASH or BANK_TRANSFER',
          'asset_account_code',
        );
      }

      const repayment = await tx.partyLoanRepayment.create({
        data: {
          loanId,
          repaymentDate: new Date(body.repayment_date),
          amountPkr: amount,
          paymentMethod: body.payment_method,
          assetAccountCode: assetAccount,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });

      if (assetAccount) {
        const draft = buildJE19PeshgiRecovered({
          loanId: loan.id,
          loanNumber: loan.loanNumber,
          repaymentId: repayment.id,
          partyId: loan.partyId,
          partyName: loan.party.name,
          entryDate: new Date(body.repayment_date),
          amountPkr: amount,
          toAssetAccountCode: assetAccount,
          bookType: loan.bookType,
        });
        const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
          postingStatus: 'POSTED',
        });

        await tx.partyLoanRepayment.update({
          where: { id: repayment.id },
          data: { journalEntryId: posted.id },
        });
      }

      const newBalance = round2(balance - amount);
      await tx.partyLoan.update({
        where: { id: loanId },
        data: {
          balanceOutstandingPkr: newBalance,
          status: newBalance <= 0.005 ? 'RECOVERED' : 'ACTIVE',
        },
      });

      return this.getByIdInternal(facilityId, loanId, tx);
    });
  }

  async writeOff(
    facilityId: string,
    userId: string,
    loanId: string,
    body: WriteOffPeshgiRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM party_loans WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        loanId,
        facilityId,
      );

      const loan = await tx.partyLoan.findFirst({
        where: { facilityId, id: loanId },
        include: { party: { select: { name: true } } },
      });
      if (!loan) throw Errors.PESHGI_NOT_FOUND();
      if (loan.status !== 'ACTIVE') throw Errors.PESHGI_ALREADY_CLOSED();

      const writeOffDate = body.write_off_date ? new Date(body.write_off_date) : new Date();
      const amount = Number(loan.balanceOutstandingPkr);
      if (amount <= 0) {
        // Active loan with zero balance shouldn't really happen, but guard anyway.
        throw Errors.PESHGI_ALREADY_CLOSED();
      }

      const draft = buildJE20PeshgiWriteOff({
        loanId: loan.id,
        loanNumber: loan.loanNumber,
        partyId: loan.partyId,
        partyName: loan.party.name,
        entryDate: writeOffDate,
        amountPkr: amount,
        reason: body.reason,
        bookType: loan.bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.partyLoan.update({
        where: { id: loanId },
        data: {
          status: 'WRITTEN_OFF',
          balanceOutstandingPkr: 0,
          writeOffJournalEntryId: posted.id,
          writeOffReason: body.reason,
          writeOffAt: new Date(),
        },
      });

      return this.getByIdInternal(facilityId, loanId, tx);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.getByIdInternal(facilityId, id, this.prisma);
  }

  private async getByIdInternal(
    facilityId: string,
    id: string,
    db: PrismaClient | Prisma.TransactionClient,
  ) {
    const loan = await db.partyLoan.findFirst({
      where: { facilityId, id },
      include: {
        party: { select: { name: true } },
        // Voided rows (dishonoured cheques) are audit history, not repayments.
        repayments: { where: { voidedAt: null }, orderBy: { repaymentDate: 'asc' } },
      },
    });
    if (!loan) throw Errors.PESHGI_NOT_FOUND();
    return formatLoan(loan);
  }

  async list(facilityId: string, query: PartyLoanListQueryType) {
    const where: Prisma.PartyLoanWhereInput = { facilityId };
    if (query.party_id) where.partyId = query.party_id;
    if (query.status) where.status = query.status;
    const [data, total] = await Promise.all([
      this.prisma.partyLoan.findMany({
        where,
        include: { party: { select: { name: true } } },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.partyLoan.count({ where }),
    ]);
    return {
      data: data.map((l) => formatLoanSummary(l)),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }
}

function formatLoanSummary(l: any) {
  return {
    id: l.id,
    loan_number: l.loanNumber,
    party_id: l.partyId,
    party_name: l.party?.name,
    issue_date: l.issueDate.toISOString().slice(0, 10),
    principal_pkr: Number(l.principalPkr),
    balance_outstanding_pkr: Number(l.balanceOutstandingPkr),
    status: l.status,
    book_type: l.bookType,
    source_asset_account_code: l.sourceAssetAccountCode,
    issue_journal_entry_id: l.issueJournalEntryId,
    write_off_journal_entry_id: l.writeOffJournalEntryId ?? null,
    write_off_reason: l.writeOffReason ?? null,
    write_off_at: l.writeOffAt ? l.writeOffAt.toISOString() : null,
    notes: l.notes,
    created_at: l.createdAt.toISOString(),
  };
}

function formatLoan(l: any) {
  return {
    ...formatLoanSummary(l),
    repayments: (l.repayments ?? []).map((r: any) => ({
      id: r.id,
      repayment_date: r.repaymentDate.toISOString().slice(0, 10),
      amount_pkr: Number(r.amountPkr),
      payment_method: r.paymentMethod,
      asset_account_code: r.assetAccountCode,
      payment_id: r.paymentId ?? null,
      journal_entry_id: r.journalEntryId,
      notes: r.notes,
      created_at: r.createdAt.toISOString(),
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
