import { randomUUID } from 'node:crypto';
import type { PrismaClient, Prisma } from '@coldchain/db';
import type {
  EmployeeAdvanceActionType,
  IssueEmployeeAdvanceRequestType,
  RecordEmployeeAdvanceRepaymentRequestType,
  VoidEmployeeAdvanceRepaymentRequestType,
  VoidEmployeeAdvanceRequestType,
  WriteOffEmployeeAdvanceRequestType,
  EmployeeAdvanceListQueryType,
} from '@coldchain/shared';
import { MONEY_EPSILON, assetAccountForPaymentMethod, round2, toIsoDate } from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { resolveFacilitySettings } from '../facility/facility.service';
import { advisoryXactLock } from '../../common/advisory-lock';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { assertCashAccount } from '../accounting/cash-account';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { buildJE22EmployeeAdvanceIssued } from './templates/je-22-employee-advance-issued';
import { buildJE23EmployeeAdvanceWriteOff } from './templates/je-23-employee-advance-write-off';
import { buildJE31EmployeeAdvanceRepayment } from './templates/je-31-employee-advance-repayment';

type Tx = Prisma.TransactionClient;

export class EmployeeAdvanceService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async issue(facilityId: string, userId: string, role: string, body: IssueEmployeeAdvanceRequestType) {
    const bookType = body.book_type ?? 'PACCI';
    assertKatchiWriteAllowed(role, bookType);
    return this.prisma.$transaction(async (tx) => {
      const employee = await tx.employee.findFirst({
        where: { facilityId, id: body.employee_id, isActive: true },
      });
      if (!employee) throw Errors.EMPLOYEE_NOT_FOUND();

      // Serialize everything that can make an advance ACTIVE for this employee —
      // a new issue here, a voided repayment reopening one in voidRepayment() —
      // before checking. Without it two could both see none and both proceed.
      await lockEmployeeAdvances(tx, facilityId, body.employee_id);

      // One active advance per employee — keeps payroll's pre-fill unambiguous (exactly
      // one instalment per employee, no priority ordering needed when salary can't cover
      // several) and stops a balance from growing indefinitely.
      const activeExisting = await tx.employeeAdvance.findFirst({
        where: { facilityId, employeeId: body.employee_id, status: 'ACTIVE' },
      });
      if (activeExisting) throw Errors.EMPLOYEE_ADVANCE_ALREADY_ACTIVE();

      // Capped at one month's pay: basic salary for SALARIED, the facility's standard
      // working days' wage for DAILY_WAGE — the same figure a payroll draft pre-fills,
      // so the cap matches what the employee will actually earn that month (C-19).
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { settings: true } });
      const { standard_working_days } = resolveFacilitySettings(facility.settings).payroll;
      const monthlyPay =
        employee.employeeType === 'SALARIED'
          ? Number(employee.basicSalaryPkr ?? 0)
          : round2(Number(employee.dailyWagePkr ?? 0) * standard_working_days);
      if (body.principal_pkr > monthlyPay + MONEY_EPSILON) {
        throw Errors.EMPLOYEE_ADVANCE_EXCEEDS_CAP(
          `Principal (${body.principal_pkr}) exceeds this employee's one-month pay cap (${monthlyPay})`,
        );
      }

      const sourceAccount =
        body.source_asset_account_code ?? assetAccountForPaymentMethod(body.payment_method);
      await assertCashAccount(tx, facilityId, sourceAccount);

      const issueDate = new Date(body.issue_date);
      const advanceNumber = await nextDocumentNumber(
        tx,
        facilityId,
        'employee_advances',
        documentNumberPrefix('ADV', issueDate, 'daily'),
        3,
      );

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
    role: string,
    advanceId: string,
    body: WriteOffEmployeeAdvanceRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const advance = await lockAdvance(tx, facilityId, advanceId);
      assertKatchiWriteAllowed(role, advance.bookType);
      if (advance.status !== 'ACTIVE') throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED('write it off');

      const writeOffDate = body.write_off_date ? new Date(body.write_off_date) : new Date();
      const amount = Number(advance.balanceOutstandingPkr);
      if (amount <= 0) {
        // Active advance with zero balance shouldn't happen — recovery flips it to
        // RECOVERED at zero — but guard anyway rather than post a zero-amount JE.
        throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED('write it off');
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

  /**
   * Void an advance issued in error (docs/25 C-26): reverse its issue entry. Only
   * while nothing has been recovered — a recovery is real money, undone by
   * reversing its payroll run or voiding the repayment first.
   */
  async void(
    facilityId: string,
    userId: string,
    role: string,
    advanceId: string,
    body: VoidEmployeeAdvanceRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const advance = await lockAdvance(tx, facilityId, advanceId);
      assertKatchiWriteAllowed(role, advance.bookType);
      if (advance.status !== 'ACTIVE') throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED('void it');
      const liveRecoveries = await tx.employeeAdvanceRecovery.count({ where: { advanceId, voidedAt: null } });
      if (liveRecoveries > 0) throw Errors.EMPLOYEE_ADVANCE_HAS_RECOVERIES();

      if (advance.issueJournalEntryId) {
        await this.journalEntry.reverseInTransaction(tx, facilityId, userId, advance.issueJournalEntryId, {
          reason: `advance ${advance.advanceNumber} voided — ${body.reason}`,
          date: body.void_date ? new Date(body.void_date) : undefined,
        });
      }
      await tx.employeeAdvance.update({
        where: { id: advanceId },
        data: {
          status: 'VOIDED',
          balanceOutstandingPkr: 0,
          voidedAt: new Date(),
          voidedBy: userId,
          voidReason: body.reason,
        },
      });

      return this.getByIdInternal(facilityId, advanceId, tx);
    });
  }

  /** The employee pays back in cash: DR the cash account / CR 1230 (JE-31). */
  async recordRepayment(
    facilityId: string,
    userId: string,
    role: string,
    advanceId: string,
    body: RecordEmployeeAdvanceRepaymentRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const advance = await lockAdvance(tx, facilityId, advanceId);
      assertKatchiWriteAllowed(role, advance.bookType);
      if (advance.status !== 'ACTIVE') throw Errors.EMPLOYEE_ADVANCE_ALREADY_CLOSED('record a repayment');
      const issuedOn = toIsoDate(advance.issueDate);
      if (body.repayment_date < issuedOn) {
        throw Errors.VALIDATION_ERROR(
          `A repayment cannot be dated before the advance was issued (${issuedOn})`,
          'repayment_date',
        );
      }
      const amount = round2(body.amount_pkr);
      const balance = Number(advance.balanceOutstandingPkr);
      if (amount > balance + MONEY_EPSILON) throw Errors.EMPLOYEE_ADVANCE_OVER_RECOVERY();
      await assertCashAccount(tx, facilityId, body.asset_account_code);

      // The recovery row must name its entry (CHECK employee_advance_recoveries_one_kind),
      // so its id is fixed first and the entry is posted against it.
      const recoveryId = randomUUID();
      const repaymentDate = new Date(body.repayment_date);
      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE31EmployeeAdvanceRepayment({
          recoveryId,
          advanceNumber: advance.advanceNumber,
          employeeName: advance.employee.name,
          entryDate: repaymentDate,
          amountPkr: amount,
          toAssetAccountCode: body.asset_account_code,
          bookType: advance.bookType,
        }),
        { postingStatus: 'POSTED' },
      );
      await tx.employeeAdvanceRecovery.create({
        data: {
          id: recoveryId,
          advanceId,
          journalEntryId: posted.id,
          assetAccountCode: body.asset_account_code,
          recoveryDate: repaymentDate,
          amountPkr: amount,
          createdBy: userId,
        },
      });
      const newBalance = round2(balance - amount);
      await tx.employeeAdvance.update({
        where: { id: advanceId },
        data: { balanceOutstandingPkr: newBalance, status: newBalance <= MONEY_EPSILON ? 'RECOVERED' : 'ACTIVE' },
      });

      return this.getByIdInternal(facilityId, advanceId, tx);
    });
  }

  /**
   * Void a cash repayment recorded in error: reverse its entry and restore the
   * balance. A payroll deduction is undone by reversing its run instead.
   */
  async voidRepayment(
    facilityId: string,
    userId: string,
    role: string,
    advanceId: string,
    recoveryId: string,
    body: VoidEmployeeAdvanceRepaymentRequestType,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const advance = await lockAdvance(tx, facilityId, advanceId);
      assertKatchiWriteAllowed(role, advance.bookType);
      const recovery = await tx.employeeAdvanceRecovery.findFirst({ where: { id: recoveryId, advanceId } });
      if (!recovery) throw Errors.EMPLOYEE_ADVANCE_RECOVERY_NOT_FOUND();
      const refusal = repaymentVoidRefusal(advance, recovery);
      if (refusal) throw Errors.EMPLOYEE_ADVANCE_RECOVERY_NOT_VOIDABLE(refusal);

      // A RECOVERED advance becomes ACTIVE again: the same one-active-advance rule
      // as issue(), under the same lock.
      if (advance.status === 'RECOVERED') {
        await lockEmployeeAdvances(tx, facilityId, advance.employeeId);
        const otherActive = await tx.employeeAdvance.findFirst({
          where: { facilityId, employeeId: advance.employeeId, status: 'ACTIVE', id: { not: advanceId } },
        });
        if (otherActive) throw Errors.EMPLOYEE_ADVANCE_ALREADY_ACTIVE();
      }

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, recovery.journalEntryId!, {
        reason: `repayment of ${advance.advanceNumber} voided — ${body.reason}`,
        date: body.void_date ? new Date(body.void_date) : undefined,
      });
      await tx.employeeAdvanceRecovery.update({
        where: { id: recoveryId },
        data: { voidedAt: new Date(), voidedBy: userId },
      });
      await tx.employeeAdvance.update({
        where: { id: advanceId },
        data: {
          balanceOutstandingPkr: round2(Number(advance.balanceOutstandingPkr) + Number(recovery.amountPkr)),
          status: 'ACTIVE',
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
        // Voided rows (a reversed payroll run, a voided repayment) are audit
        // history, not live recoveries; their entries and reversals stay in the journal.
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
        include: {
          employee: { select: { name: true } },
          _count: { select: { recoveries: { where: { voidedAt: null } } } },
        },
        orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.page_size,
        take: query.page_size,
      }),
      this.prisma.employeeAdvance.count({ where }),
    ]);
    return {
      data: data.map((a) => formatAdvanceSummary(a, a._count.recoveries)),
      meta: { total, page: query.page, per_page: query.page_size },
    };
  }
}

async function lockAdvance(tx: Tx, facilityId: string, advanceId: string) {
  if (!(await lockRow(tx, 'employee_advances', advanceId, facilityId))) throw Errors.EMPLOYEE_ADVANCE_NOT_FOUND();
  return tx.employeeAdvance.findFirstOrThrow({
    where: { facilityId, id: advanceId },
    include: { employee: { select: { name: true } } },
  });
}

function lockEmployeeAdvances(tx: Tx, facilityId: string, employeeId: string) {
  return advisoryXactLock(tx, `${facilityId}:employee-advance:${employeeId}`);
}

type AdvanceState = { status: string };
type RecoveryState = { voidedAt: Date | null; journalEntryId: string | null };

/** Why a recovery cannot be voided here, or null when it can. */
function repaymentVoidRefusal(advance: AdvanceState, recovery: RecoveryState): string | null {
  if (recovery.voidedAt) return 'This repayment has already been voided';
  if (!recovery.journalEntryId) return 'A payroll deduction is undone by reversing its payroll run';
  // Restoring a balance on a written-off advance would strand it: nothing can
  // recover or write off an advance that is not ACTIVE.
  if (advance.status !== 'ACTIVE' && advance.status !== 'RECOVERED') {
    return 'The advance has since been written off; its balance cannot be reopened';
  }
  return null;
}

function allowedActions(advance: AdvanceState, liveRecoveries: number): EmployeeAdvanceActionType[] {
  if (advance.status !== 'ACTIVE') return [];
  return liveRecoveries === 0 ? ['repay', 'write_off', 'void'] : ['repay', 'write_off'];
}

function formatAdvanceSummary(a: any, liveRecoveries: number) {
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
    voided_at: a.voidedAt ? a.voidedAt.toISOString() : null,
    void_reason: a.voidReason ?? null,
    notes: a.notes,
    created_at: a.createdAt.toISOString(),
    allowed_actions: allowedActions(a, liveRecoveries),
  };
}

function formatAdvance(a: any) {
  const recoveries = a.recoveries ?? [];
  return {
    ...formatAdvanceSummary(a, recoveries.length),
    recoveries: recoveries.map((r: any) => ({
      id: r.id,
      kind: r.journalEntryId ? 'CASH' : 'PAYROLL',
      payroll_run_id: r.payrollRunId,
      payroll_run_number: r.payrollRun?.runNumber ?? null,
      journal_entry_id: r.journalEntryId,
      asset_account_code: r.assetAccountCode,
      recovery_date: r.recoveryDate.toISOString().slice(0, 10),
      amount_pkr: Number(r.amountPkr),
      voided_at: r.voidedAt ? r.voidedAt.toISOString() : null,
      created_at: r.createdAt.toISOString(),
      can_void: repaymentVoidRefusal(a, r) === null,
    })),
  };
}
