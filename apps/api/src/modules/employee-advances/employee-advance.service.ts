import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  IssueEmployeeAdvanceRequestType,
  WriteOffEmployeeAdvanceRequestType,
  EmployeeAdvanceListQueryType,
} from '@coldchain/shared';
import { assetAccountForPaymentMethod } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { generateEmployeeAdvanceNumber } from './employee-advance-number';
import { buildJE22EmployeeAdvanceIssued } from './templates/je-22-employee-advance-issued';
import { buildJE23EmployeeAdvanceWriteOff } from './templates/je-23-employee-advance-write-off';

export class EmployeeAdvanceService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async issue(facilityId: string, userId: string, body: IssueEmployeeAdvanceRequestType) {
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { facilityId, id: body.employee_id, isActive: true },
      });
      if (!employee) throw Errors.EMPLOYEE_NOT_FOUND();

      // Serialize concurrent issues for this employee before checking. Without this,
      // two concurrent issue() calls could both see no ACTIVE advance and both insert —
      // the same class of race the payroll duplicate-period guard was fixed for.
      await advisoryXactLock(tx, `${facilityId}:employee-advance:${body.employee_id}`);

      // One active advance per employee — keeps payroll's pre-fill unambiguous (exactly
      // one instalment per employee, no priority ordering needed when salary can't cover
      // several) and stops a balance from growing indefinitely.
      const activeExisting = await tx.employeeAdvance.findFirst({
        where: { facilityId, employeeId: body.employee_id, status: 'ACTIVE' },
      });
      if (activeExisting) throw Errors.EMPLOYEE_ADVANCE_ALREADY_ACTIVE();

      // Capped at one month's pay: basic salary for SALARIED, 26 working days' wage for
      // DAILY_WAGE — the same 26-day constant createDraft uses when snapshotting wage
      // lines, so the cap matches what the employee will actually earn that month.
      const monthlyPay =
        employee.employeeType === 'SALARIED'
          ? Number(employee.basicSalaryPkr ?? 0)
          : Number(employee.dailyWagePkr ?? 0) * 26;
      if (body.principal_pkr > monthlyPay + 0.005) {
        throw Errors.EMPLOYEE_ADVANCE_EXCEEDS_CAP(
          `Principal (${body.principal_pkr}) exceeds this employee's one-month pay cap (${monthlyPay})`,
        );
      }

      const issueDate = new Date(body.issue_date);
      const advanceNumber = await generateEmployeeAdvanceNumber(tx, facilityId, issueDate);
      const bookType = body.book_type ?? 'PACCI';
      const sourceAccount =
        body.source_asset_account_code ?? assetAccountForPaymentMethod(body.payment_method);

      const advance = await tx.employeeAdvance.create({
        data: {
          facilityId,
          advanceNumber,
          employeeId: body.employee_id,
          issueDate,
          principalPkr: body.principal_pkr,
          monthlyInstallmentPkr: body.monthly_installment_pkr,
          balanceOutstandingPkr: body.principal_pkr,
          status: 'ACTIVE',
          bookType,
          sourceAssetAccountCode: sourceAccount,
          notes: body.notes ?? null,
          createdBy: userId,
        },
      });

      const draft = buildJE22EmployeeAdvanceIssued({
        advanceId: advance.id,
        advanceNumber: advance.advanceNumber,
        employeeName: employee.name,
        entryDate: issueDate,
        amountPkr: Number(advance.principalPkr),
        fromAssetAccountCode: sourceAccount,
        bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.employeeAdvance.update({
        where: { id: advance.id },
        data: { issueJournalEntryId: posted.id },
      });

      return this.getByIdInternal(facilityId, advance.id, tx);
    });
  }

  async writeOff(
    facilityId: string,
    userId: string,
    advanceId: string,
    body: WriteOffEmployeeAdvanceRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        `SELECT id FROM employee_advances WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
        advanceId,
        facilityId,
      );

      const advance = await tx.employeeAdvance.findFirst({
        where: { facilityId, id: advanceId },
        include: { employee: { select: { name: true } } },
      });
      if (!advance) throw Errors.EMPLOYEE_ADVANCE_NOT_FOUND();
      if (advance.status !== 'ACTIVE') throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED();

      const writeOffDate = body.write_off_date ? new Date(body.write_off_date) : new Date();
      const amount = Number(advance.balanceOutstandingPkr);
      if (amount <= 0) {
        // Active advance with zero balance shouldn't happen — recovery flips it to
        // RECOVERED at zero — but guard anyway rather than post a zero-amount JE.
        throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED();
      }

      const draft = buildJE23EmployeeAdvanceWriteOff({
        advanceId: advance.id,
        advanceNumber: advance.advanceNumber,
        employeeName: advance.employee.name,
        entryDate: writeOffDate,
        amountPkr: amount,
        reason: body.reason,
        bookType: advance.bookType,
      });
      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.employeeAdvance.update({
        where: { id: advanceId },
        data: {
          status: 'WRITTEN_OFF',
          balanceOutstandingPkr: 0,
          writeOffJournalEntryId: posted.id,
          writeOffReason: body.reason,
          writeOffAt: new Date(),
        },
      });

      return this.getByIdInternal(facilityId, advanceId, tx);
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
    const advance = await db.employeeAdvance.findFirst({
      where: { facilityId, id },
      include: {
        employee: { select: { name: true } },
        // Voided rows (a reversed payroll run) are audit history, not live recoveries.
        recoveries: {
          where: { voidedAt: null },
          orderBy: { recoveryDate: 'asc' },
          include: { payrollRun: { select: { runNumber: true } } },
        },
      },
    });
    if (!advance) throw Errors.EMPLOYEE_ADVANCE_NOT_FOUND();
    return formatAdvance(advance);
  }

  async list(facilityId: string, query: EmployeeAdvanceListQueryType) {
    const where: Prisma.EmployeeAdvanceWhereInput = { facilityId };
    if (query.employee_id) where.employeeId = query.employee_id;
    if (query.status) where.status = query.status;
    const [data, total] = await Promise.all([
      this.prisma.employeeAdvance.findMany({
        where,
        include: { employee: { select: { name: true } } },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.employeeAdvance.count({ where }),
    ]);
    return {
      data: data.map((a) => formatAdvanceSummary(a)),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }
}

function formatAdvanceSummary(a: any) {
  return {
    id: a.id,
    advance_number: a.advanceNumber,
    employee_id: a.employeeId,
    employee_name: a.employee?.name,
    issue_date: a.issueDate.toISOString().slice(0, 10),
    principal_pkr: Number(a.principalPkr),
    monthly_installment_pkr: Number(a.monthlyInstallmentPkr),
    balance_outstanding_pkr: Number(a.balanceOutstandingPkr),
    status: a.status,
    book_type: a.bookType,
    source_asset_account_code: a.sourceAssetAccountCode,
    issue_journal_entry_id: a.issueJournalEntryId,
    write_off_journal_entry_id: a.writeOffJournalEntryId ?? null,
    write_off_reason: a.writeOffReason ?? null,
    write_off_at: a.writeOffAt ? a.writeOffAt.toISOString() : null,
    notes: a.notes,
    created_at: a.createdAt.toISOString(),
  };
}

function formatAdvance(a: any) {
  return {
    ...formatAdvanceSummary(a),
    recoveries: (a.recoveries ?? []).map((r: any) => ({
      id: r.id,
      payroll_run_id: r.payrollRunId,
      payroll_run_number: r.payrollRun?.runNumber,
      recovery_date: r.recoveryDate.toISOString().slice(0, 10),
      amount_pkr: Number(r.amountPkr),
      voided_at: r.voidedAt ? r.voidedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
    })),
  };
}
