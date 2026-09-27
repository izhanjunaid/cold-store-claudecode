import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  DEFAULT_BANK_ACCOUNT_CODE,
  MONEY_EPSILON,
  SYSTEM_ACCOUNTS,
  payrollLineNet,
  payrollRunTotals,
  round2,
  type CreatePayrollRunRequestType,
  type PayPayrollRequestType,
  type PayrollRunActionType,
  type UpdatePayrollLineRequestType,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { lockRow } from '../../common/row-lock';
import { documentNumberPrefix, nextDocumentNumber } from '../../common/document-number';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { accountBalances, signedBalance } from '../accounting/ledger';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { resolveFacilitySettings } from '../facility/facility.service';
import { buildJE15Payroll } from './templates/je-15-payroll';
import { buildJE16SalaryPayment } from './templates/je-16-salary-payment';
import { buildJE16BGovtRemittance } from './templates/je-16b-govt-remittance';

type Db = PrismaClient | Prisma.TransactionClient;
type Tx = Prisma.TransactionClient;

type LineRow = {
  grossPayPkr: unknown;
  eobiEmployeePkr: unknown;
  eobiEmployerPkr: unknown;
  incomeTaxPkr: unknown;
  advanceRecoveryPkr: unknown;
};

/** A stored line's amounts, in the shape the shared net/total rules read. */
function amountsOf(l: LineRow) {
  return {
    gross_pay_pkr: Number(l.grossPayPkr),
    eobi_employee_pkr: Number(l.eobiEmployeePkr),
    eobi_employer_pkr: Number(l.eobiEmployerPkr),
    income_tax_pkr: Number(l.incomeTaxPkr),
    advance_recovery_pkr: Number(l.advanceRecoveryPkr),
  };
}

/** Recompute a run's stored totals from its lines — the one place they are written. */
async function saveRunTotals(tx: Tx, runId: string) {
  const lines = await tx.payrollLineItem.findMany({ where: { payrollRunId: runId } });
  const t = payrollRunTotals(lines.map(amountsOf));
  await tx.payrollRun.update({
    where: { id: runId },
    data: {
      totalGrossPkr: t.gross,
      totalDeductionsPkr: t.deductions,
      totalEmployerEobiPkr: t.employerEobi,
      totalNetPayablePkr: t.net,
    },
  });
  return t;
}

export class PayrollRunService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async createDraft(facilityId: string, role: string, body: CreatePayrollRunRequestType) {
    const { payroll_type, period_year, period_month } = body;
    const bookType = body.book_type ?? 'PACCI';
    assertKatchiWriteAllowed(role, bookType);

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent creates for the same period+type before checking. The rule
      // is "no *live* run for this period" — a reversed run must stay replaceable — and
      // a partial unique index carrying that predicate cannot be expressed in the Prisma
      // schema, so an advisory lock guards it.
      await advisoryXactLock(
        tx,
        `${facilityId}:payroll-run:${payroll_type}:${period_year}:${period_month}`,
      );

      const existing = await tx.payrollRun.findFirst({
        where: {
          facilityId,
          payrollType: payroll_type,
          periodYear: period_year,
          periodMonth: period_month,
          status: { in: ['DRAFT', 'FINALIZED', 'PAID'] },
        },
      });
      if (existing) throw Errors.PAYROLL_RUN_DUPLICATE_PERIOD();

      const runNumber = await nextDocumentNumber(
        tx,
        facilityId,
        'payroll_runs',
        documentNumberPrefix('PAY', new Date(Date.UTC(period_year, period_month - 1, 1)), 'monthly'),
        3,
      );

      const facility = await tx.facility.findUniqueOrThrow({ where: { id: facilityId }, select: { settings: true } });
      const settings = resolveFacilitySettings(facility.settings).payroll;

      // Snapshot all active employees of the matching type
      const employeeType = payroll_type === 'MONTHLY_SALARY' ? 'SALARIED' : 'DAILY_WAGE';
      const employees = await tx.employee.findMany({
        where: { facilityId, isActive: true, employeeType },
        orderBy: { name: 'asc' },
      });

      // Pre-fill each employee's ACTIVE advance instalment (phase 21) — a suggestion
      // the accountant can edit per line. Finalize re-checks it against the live
      // balance, because a later draft may pre-fill from the same balance (C-14).
      const activeAdvances = await tx.employeeAdvance.findMany({
        where: { facilityId, employeeId: { in: employees.map((e) => e.id) }, status: 'ACTIVE' },
      });
      const advanceByEmployee = new Map(activeAdvances.map((a) => [a.employeeId, a]));

      const run = await tx.payrollRun.create({
        data: {
          facilityId,
          runNumber,
          payrollType: payroll_type,
          periodYear: period_year,
          periodMonth: period_month,
          periodFrom: new Date(body.period_from),
          periodTo: new Date(body.period_to),
          bookType,
          status: 'DRAFT',
          notes: body.notes ?? null,
        },
      });

      for (let i = 0; i < employees.length; i++) {
        const e = employees[i]!;
        const isSalaried = e.employeeType === 'SALARIED';
        const daysWorked = isSalaried ? null : settings.standard_working_days;
        const gross = isSalaried
          ? Number(e.basicSalaryPkr ?? 0)
          : round2(settings.standard_working_days * Number(e.dailyWagePkr ?? 0));
        const employeeEobi = e.eobiRegistered ? settings.eobi_employee_monthly_pkr : 0;
        const employerEobi = e.eobiRegistered ? settings.eobi_employer_monthly_pkr : 0;
        const advance = advanceByEmployee.get(e.id);
        // Never pre-fill more than the pay can cover: the line would open negative.
        const advanceRecovery = advance
          ? round2(
              Math.max(
                0,
                Math.min(
                  Number(advance.monthlyInstallmentPkr),
                  Number(advance.balanceOutstandingPkr),
                  gross - employeeEobi,
                ),
              ),
            )
          : 0;
        const amounts = {
          gross_pay_pkr: gross,
          eobi_employee_pkr: employeeEobi,
          eobi_employer_pkr: employerEobi,
          income_tax_pkr: 0,
          advance_recovery_pkr: advanceRecovery,
        };

        await tx.payrollLineItem.create({
          data: {
            payrollRunId: run.id,
            employeeId: e.id,
            daysWorked,
            grossPayPkr: gross,
            eobiEmployeePkr: employeeEobi,
            eobiEmployerPkr: employerEobi,
            incomeTaxPkr: 0,
            advanceRecoveryPkr: advanceRecovery,
            netPayPkr: payrollLineNet(amounts),
            sortOrder: i,
          },
        });
      }

      await saveRunTotals(tx, run.id);
      return this.getByIdInternal(facilityId, run.id, tx);
    });
  }

  async updateLine(facilityId: string, role: string, runId: string, lineId: string, body: UpdatePayrollLineRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payroll_runs', runId, facilityId))) throw Errors.PAYROLL_RUN_NOT_FOUND();
      const run = await tx.payrollRun.findFirstOrThrow({ where: { facilityId, id: runId } });
      assertKatchiWriteAllowed(role, run.bookType);
      if (run.status !== 'DRAFT') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Cannot edit lines of a non-DRAFT run');
      }

      const line = await tx.payrollLineItem.findFirst({
        where: { id: lineId, payrollRunId: runId },
        include: { employee: true },
      });
      if (!line) throw Errors.PAYROLL_LINE_NOT_FOUND();

      // A daily-wage gross is days worked x daily wage, never typed (docs/25 C-18).
      let daysWorked: number | null = line.daysWorked === null ? null : Number(line.daysWorked);
      let gross: number;
      if (line.employee.employeeType === 'DAILY_WAGE') {
        if (body.gross_pay_pkr !== undefined) {
          throw Errors.VALIDATION_ERROR(
            "A daily-wage line's gross is days worked x daily wage; change the days worked instead",
            'gross_pay_pkr',
          );
        }
        const days = body.days_worked ?? daysWorked;
        if (days === null) throw Errors.VALIDATION_ERROR('Enter the days worked', 'days_worked');
        daysWorked = days;
        gross = round2(days * Number(line.employee.dailyWagePkr ?? 0));
      } else {
        if (body.days_worked !== undefined) {
          throw Errors.VALIDATION_ERROR('A salaried line has no days worked', 'days_worked');
        }
        gross = body.gross_pay_pkr ?? Number(line.grossPayPkr);
      }

      const amounts = {
        gross_pay_pkr: gross,
        eobi_employee_pkr: body.eobi_employee_pkr ?? Number(line.eobiEmployeePkr),
        eobi_employer_pkr: body.eobi_employer_pkr ?? Number(line.eobiEmployerPkr),
        income_tax_pkr: body.income_tax_pkr ?? Number(line.incomeTaxPkr),
        advance_recovery_pkr: body.advance_recovery_pkr ?? Number(line.advanceRecoveryPkr),
      };

      // Against the employee's live outstanding balance, not what the draft was
      // pre-filled with. Finalize checks again under the advance's lock.
      if (amounts.advance_recovery_pkr > MONEY_EPSILON) {
        const advance = await tx.employeeAdvance.findFirst({
          where: { facilityId, employeeId: line.employeeId, status: 'ACTIVE' },
        });
        const outstanding = advance ? Number(advance.balanceOutstandingPkr) : 0;
        if (amounts.advance_recovery_pkr > outstanding + MONEY_EPSILON) throw Errors.EMPLOYEE_ADVANCE_OVER_RECOVERY();
      }

      const net = payrollLineNet(amounts);
      if (net < 0) {
        throw Errors.VALIDATION_ERROR(
          `Deductions exceed gross pay for ${line.employee.name}; net pay cannot be negative`,
        );
      }

      await tx.payrollLineItem.update({
        where: { id: lineId },
        data: {
          daysWorked,
          grossPayPkr: amounts.gross_pay_pkr,
          eobiEmployeePkr: amounts.eobi_employee_pkr,
          eobiEmployerPkr: amounts.eobi_employer_pkr,
          incomeTaxPkr: amounts.income_tax_pkr,
          advanceRecoveryPkr: amounts.advance_recovery_pkr,
          netPayPkr: net,
        },
      });

      await saveRunTotals(tx, runId);
      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async finalize(facilityId: string, userId: string, role: string, runId: string) {
    return this.prisma.$transaction(async (tx) => {
      // A double-click used to post the payroll twice: both requests read DRAFT
      // before either wrote (docs/25 C-13).
      if (!(await lockRow(tx, 'payroll_runs', runId, facilityId))) throw Errors.PAYROLL_RUN_NOT_FOUND();
      const run = await tx.payrollRun.findFirstOrThrow({
        where: { facilityId, id: runId },
        include: { lineItems: { include: { employee: { select: { name: true, costAccountCode: true } } } } },
      });
      assertKatchiWriteAllowed(role, run.bookType);
      if (run.status !== 'DRAFT') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Only DRAFT runs can be finalized');
      }
      if (run.lineItems.length === 0) {
        throw Errors.VALIDATION_ERROR('Cannot finalize a payroll run with no line items');
      }

      // Net pay is derived, never trusted from storage: a draft saved before
      // other_deductions_pkr was retired may still carry a net that subtracted it
      // (docs/25 C-17). Those deductions never had a ledger home and are ignored.
      for (const l of run.lineItems) {
        const net = payrollLineNet(amountsOf(l));
        if (net < 0) {
          throw Errors.VALIDATION_ERROR(`Deductions exceed gross pay for ${l.employee.name}; net pay cannot be negative`);
        }
        if (Math.abs(net - Number(l.netPayPkr)) >= MONEY_EPSILON) {
          await tx.payrollLineItem.update({ where: { id: l.id }, data: { netPayPkr: net } });
        }
      }
      await saveRunTotals(tx, runId);

      // The accrual is dated the last day of the period.
      const entryDate = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));

      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE15Payroll({
          payrollRunId: run.id,
          runNumber: run.runNumber,
          payrollType: run.payrollType,
          entryDate,
          bookType: run.bookType,
          lines: run.lineItems.map((l) => ({
            ...amountsOf(l),
            employeeName: l.employee.name,
            costAccountCode: l.employee.costAccountCode,
          })),
        }),
        { postingStatus: 'POSTED' },
      );

      // Recovery does not post its own journal entry — it rode inside the entry just
      // posted, as the 1230 credit line. This settles the subledger side: one
      // EmployeeAdvanceRecovery row per line that carried a recovery, the advance
      // balance decremented, and the advance closed once it reaches zero.
      //
      // Each advance is locked and re-read here. Two drafts (January and February)
      // pre-fill from the same balance, so the second finalize must check the
      // balance as it stands now, not as it stood when its draft was made (C-14).
      // Locks are taken in id order so two finalizes cannot deadlock.
      const recoveringLines = run.lineItems.filter((l) => Number(l.advanceRecoveryPkr) > MONEY_EPSILON);
      const candidates = await tx.employeeAdvance.findMany({
        where: { facilityId, employeeId: { in: recoveringLines.map((l) => l.employeeId) }, status: 'ACTIVE' },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      for (const c of candidates) await lockRow(tx, 'employee_advances', c.id, facilityId);

      for (const line of recoveringLines) {
        const recoveryAmount = Number(line.advanceRecoveryPkr);
        const advance = await tx.employeeAdvance.findFirst({
          where: { facilityId, employeeId: line.employeeId, status: 'ACTIVE' },
        });
        if (!advance || recoveryAmount > Number(advance.balanceOutstandingPkr) + MONEY_EPSILON) {
          throw Errors.EMPLOYEE_ADVANCE_OVER_RECOVERY();
        }

        await tx.employeeAdvanceRecovery.create({
          data: {
            advanceId: advance.id,
            payrollRunId: run.id,
            payrollLineItemId: line.id,
            recoveryDate: entryDate,
            amountPkr: recoveryAmount,
            createdBy: userId,
          },
        });

        const newBalance = round2(Number(advance.balanceOutstandingPkr) - recoveryAmount);
        await tx.employeeAdvance.update({
          where: { id: advance.id },
          data: {
            balanceOutstandingPkr: newBalance,
            status: newBalance <= MONEY_EPSILON ? 'RECOVERED' : 'ACTIVE',
          },
        });
      }

      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'FINALIZED',
          payrollJournalEntryId: posted.id,
          finalizedBy: userId,
          finalizedAt: new Date(),
        },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async pay(facilityId: string, userId: string, role: string, runId: string, body: PayPayrollRequestType) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payroll_runs', runId, facilityId))) throw Errors.PAYROLL_RUN_NOT_FOUND();
      const run = await tx.payrollRun.findFirstOrThrow({
        where: { facilityId, id: runId },
        include: { lineItems: true },
      });
      assertKatchiWriteAllowed(role, run.bookType);
      if (run.status !== 'FINALIZED') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Only FINALIZED runs can be paid');
      }

      const posted = await this.journalEntry.postInTransaction(
        tx,
        facilityId,
        userId,
        buildJE16SalaryPayment({
          payrollRunId: run.id,
          runNumber: run.runNumber,
          entryDate: new Date(body.payment_date),
          // The same figure the accrual credited to Salaries Payable.
          amountPkr: payrollRunTotals(run.lineItems.map(amountsOf)).net,
          fromAssetAccountCode: body.from_asset_account_code,
          bookType: run.bookType,
        }),
        { postingStatus: 'POSTED' },
      );

      await tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'PAID', paymentJournalEntryId: posted.id, paidAt: new Date() },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async remit(facilityId: string, userId: string, runId: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      await lockRow(tx, 'payroll_runs', runId, facilityId);

      const run = await tx.payrollRun.findFirst({ where: { facilityId, id: runId } });
      if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
      if (run.status === 'DRAFT') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Cannot remit for a DRAFT run');
      }
      // The pointer column is @unique, but the code used to overwrite it — so a second
      // remit posted a second JE-16B and silently orphaned the first entry's link.
      if (run.remittanceJournalEntryId) {
        throw Errors.PAYROLL_ALREADY_REMITTED();
      }

      // Remitted amounts came straight from the request body with nothing tying them to
      // what the run actually withheld, so any figure could be paid to the government and
      // posted against the liability accounts. Bound each leg by the run's own totals.
      const empEobi = Number(body.remit_employee_eobi_pkr);
      const emperEobi = Number(body.remit_employer_eobi_pkr);
      const tax = Number(body.remit_income_tax_pkr ?? 0);

      const lineTotals = await tx.payrollLineItem.aggregate({
        where: { payrollRunId: runId },
        _sum: { eobiEmployeePkr: true, incomeTaxPkr: true },
      });
      const withheldEmpEobi = Number(lineTotals._sum.eobiEmployeePkr ?? 0);
      const withheldTax = Number(lineTotals._sum.incomeTaxPkr ?? 0);
      const withheldEmperEobi = Number(run.totalEmployerEobiPkr);

      const over = (paid: number, withheld: number) => paid > withheld + 0.005;
      if (over(empEobi, withheldEmpEobi) || over(emperEobi, withheldEmperEobi) || over(tax, withheldTax)) {
        throw Errors.PAYROLL_REMITTANCE_EXCEEDS_LIABILITY(
          `Remittance exceeds what this run withheld (employee EOBI ${withheldEmpEobi}, employer EOBI ${withheldEmperEobi}, income tax ${withheldTax})`,
        );
      }

      const draft = buildJE16BGovtRemittance({
        payrollRunId: run.id,
        runNumber: run.runNumber,
        entryDate: new Date(body.remittance_date),
        employeeEobiPkr: body.remit_employee_eobi_pkr,
        employerEobiPkr: body.remit_employer_eobi_pkr,
        incomeTaxPkr: body.remit_income_tax_pkr ?? 0,
        fromAssetAccountCode: body.from_asset_account_code ?? DEFAULT_BANK_ACCOUNT_CODE,
        bookType: run.bookType,
      });

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.payrollRun.update({
        where: { id: runId },
        data: { remittanceJournalEntryId: posted.id },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  /**
   * Reverse a run finalized in error: undo its accrual (JE-15) and any advance
   * recoveries it made. Only while it is unpaid — a paid run's salary cash really
   * left, so reversing the payment along with the accrual pretended it had not
   * (docs/25 C-15). A paid run's payment is voided first (voidPayment); a remitted
   * run cannot be reversed, because the remittance is real cash paid to the
   * government and has no void of its own here.
   */
  async reverse(
    facilityId: string,
    userId: string,
    role: string,
    runId: string,
    body: { reason: string; reversal_date?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payroll_runs', runId, facilityId))) throw Errors.PAYROLL_RUN_NOT_FOUND();
      const run = await tx.payrollRun.findFirstOrThrow({ where: { facilityId, id: runId } });
      assertKatchiWriteAllowed(role, run.bookType);
      if (run.status === 'DRAFT') {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE(
          'A DRAFT run has posted nothing to reverse; edit its lines instead',
        );
      }
      if (run.status === 'REVERSED') {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE('This run has already been reversed');
      }
      if (run.status === 'PAID') {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE('This run has been paid; void the salary payment first');
      }
      if (run.remittanceJournalEntryId) {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE(
          'EOBI / tax for this run has already been paid to the government; the run cannot be reversed',
        );
      }

      // Unwind advance recoveries (phase 21). Getting this wrong silently forgives an
      // employee's debt: the balance would stay reduced while the payroll that
      // reduced it has been undone. Lock each advance (in id order) before restoring
      // its balance, then soft-void the recovery rows so the audit trail survives.
      const recoveries = await tx.employeeAdvanceRecovery.findMany({
        where: { payrollRunId: runId, voidedAt: null },
        orderBy: { advanceId: 'asc' },
      });
      for (const recovery of recoveries) {
        await lockRow(tx, 'employee_advances', recovery.advanceId, facilityId);
        const advance = await tx.employeeAdvance.findFirstOrThrow({
          where: { id: recovery.advanceId, facilityId },
        });
        await tx.employeeAdvance.update({
          where: { id: advance.id },
          data: {
            balanceOutstandingPkr: round2(
              Number(advance.balanceOutstandingPkr) + Number(recovery.amountPkr),
            ),
            // Only a RECOVERED advance can have been closed by this run's recovery;
            // WRITTEN_OFF is a separate decision this reversal must not undo. If the
            // advance was later written off, the restored amount was genuinely never
            // written off (JE-23 covered only what was outstanding then), so the GL
            // stays correct; the status just cannot say "partly written off".
            status: advance.status === 'RECOVERED' ? 'ACTIVE' : advance.status,
          },
        });
        await tx.employeeAdvanceRecovery.update({
          where: { id: recovery.id },
          data: { voidedAt: new Date(), voidedBy: userId },
        });
      }

      if (run.payrollJournalEntryId) {
        await this.journalEntry.reverseInTransaction(tx, facilityId, userId, run.payrollJournalEntryId, {
          reason: `payroll ${run.runNumber} reversed — ${body.reason}`,
          date: body.reversal_date ? new Date(body.reversal_date) : undefined,
        });
      }

      await tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'REVERSED', voidedAt: new Date(), voidedBy: userId, voidReason: body.reason },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  /**
   * Void a salary payment made in error (wrong account, wrong date): reverse JE-16
   * and return the run to FINALIZED so it can be paid again. The accrual stands.
   */
  async voidPayment(
    facilityId: string,
    userId: string,
    role: string,
    runId: string,
    body: { reason: string; void_date?: string },
  ) {
    return this.prisma.$transaction(async (tx) => {
      if (!(await lockRow(tx, 'payroll_runs', runId, facilityId))) throw Errors.PAYROLL_RUN_NOT_FOUND();
      const run = await tx.payrollRun.findFirstOrThrow({ where: { facilityId, id: runId } });
      assertKatchiWriteAllowed(role, run.bookType);
      if (run.status !== 'PAID' || !run.paymentJournalEntryId) {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Only a PAID run has a salary payment to void');
      }

      await this.journalEntry.reverseInTransaction(tx, facilityId, userId, run.paymentJournalEntryId, {
        reason: `salary payment for ${run.runNumber} voided — ${body.reason}`,
        date: body.void_date ? new Date(body.void_date) : undefined,
      });

      // The reversed payment still points at this run through its source; the run's
      // own pointer is cleared so the next payment can take it.
      await tx.payrollRun.update({
        where: { id: runId },
        data: { status: 'FINALIZED', paymentJournalEntryId: null, paidAt: null },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.getByIdInternal(facilityId, id, this.prisma);
  }

  private async getByIdInternal(facilityId: string, id: string, db: Db) {
    const run = await db.payrollRun.findFirst({
      where: { facilityId, id },
      include: {
        lineItems: {
          orderBy: { sortOrder: 'asc' },
          include: { employee: { select: { name: true, employeeType: true } } },
        },
      },
    });
    if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
    return {
      ...formatRun(run),
      salaries_payable: await salariesPayableTieOut(db, facilityId, run.bookType),
    };
  }

  async list(facilityId: string, query: any) {
    const where: Prisma.PayrollRunWhereInput = { facilityId };
    if (query.payroll_type) where.payrollType = query.payroll_type;
    if (query.status) where.status = query.status;
    if (query.period_year) where.periodYear = query.period_year;
    if (query.period_month) where.periodMonth = query.period_month;

    const [data, total] = await Promise.all([
      this.prisma.payrollRun.findMany({
        where,
        orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.payrollRun.count({ where }),
    ]);

    return {
      data: data.map((r) => formatRun(r)),
      meta: { total, page: query.page, per_page: query.pageSize },
    };
  }

  async getSlipData(facilityId: string, runId: string, lineId: string) {
    const run = await this.prisma.payrollRun.findFirst({
      where: { facilityId, id: runId },
      include: {
        facility: { select: { name: true } },
        lineItems: {
          where: { id: lineId },
          include: { employee: true },
        },
      },
    });
    if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
    const line = run.lineItems[0];
    if (!line) throw Errors.PAYROLL_LINE_NOT_FOUND();

    const monthLabel = new Date(Date.UTC(run.periodYear, run.periodMonth - 1, 1)).toLocaleString('en', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    });

    return {
      // A slip for a draft or reversed run is not a record of pay; it says so (C-24).
      status: run.status,
      facilityName: run.facility.name,
      runNumber: run.runNumber,
      payrollPeriod: monthLabel,
      employeeName: line.employee.name,
      employeeNameUrdu: line.employee.nameUrdu,
      employeeCnic: line.employee.cnic,
      employeeDesignation: line.employee.designation,
      grossPay: Number(line.grossPayPkr),
      eobiEmployee: Number(line.eobiEmployeePkr),
      incomeTax: Number(line.incomeTaxPkr),
      advanceRecovery: Number(line.advanceRecoveryPkr),
      netPay: payrollLineNet(amountsOf(line)),
      daysWorked: line.daysWorked ? Number(line.daysWorked) : null,
    };
  }
}

/**
 * Does the ledger agree with the payroll register? 2030 Salaries Payable must equal
 * the net pay of every finalised run not yet paid (docs/25 C-22). The check this
 * replaces compared a run's own entry with the lines that entry was built from, so it
 * could never disagree.
 */
async function salariesPayableTieOut(db: Db, facilityId: string, book: 'PACCI' | 'KATCHI') {
  const [balances, unpaid] = await Promise.all([
    accountBalances(db, { facilityId, book, accounts: [SYSTEM_ACCOUNTS.SALARIES_PAYABLE] }),
    db.payrollLineItem.aggregate({
      where: { payrollRun: { facilityId, bookType: book, status: 'FINALIZED' } },
      _sum: { netPayPkr: true },
    }),
  ]);
  const gl = signedBalance(balances.get(SYSTEM_ACCOUNTS.SALARIES_PAYABLE), 'CREDIT');
  const register = round2(Number(unpaid._sum.netPayPkr ?? 0));
  return {
    gl_salaries_payable_pkr: gl,
    unpaid_net_pay_pkr: register,
    difference_pkr: round2(gl - register),
    is_reconciled: Math.abs(gl - register) < MONEY_EPSILON,
  };
}

function allowedActions(r: { status: string; remittanceJournalEntryId: string | null }): PayrollRunActionType[] {
  const canRemit = !r.remittanceJournalEntryId;
  switch (r.status) {
    case 'DRAFT':
      return ['edit_lines', 'finalize'];
    case 'FINALIZED':
      return canRemit ? ['pay', 'reverse', 'remit'] : ['pay'];
    case 'PAID':
      return canRemit ? ['void_payment', 'remit'] : ['void_payment'];
    default:
      return [];
  }
}

function formatRun(r: any) {
  return {
    id: r.id,
    run_number: r.runNumber,
    payroll_type: r.payrollType,
    period_year: r.periodYear,
    period_month: r.periodMonth,
    period_from: r.periodFrom.toISOString().slice(0, 10),
    period_to: r.periodTo.toISOString().slice(0, 10),
    total_gross_pkr: Number(r.totalGrossPkr),
    total_deductions_pkr: Number(r.totalDeductionsPkr),
    total_employer_eobi_pkr: Number(r.totalEmployerEobiPkr),
    total_net_payable_pkr: Number(r.totalNetPayablePkr),
    status: r.status,
    book_type: r.bookType,
    payroll_journal_entry_id: r.payrollJournalEntryId,
    payment_journal_entry_id: r.paymentJournalEntryId,
    remittance_journal_entry_id: r.remittanceJournalEntryId,
    finalized_at: r.finalizedAt?.toISOString() ?? null,
    paid_at: r.paidAt?.toISOString() ?? null,
    notes: r.notes,
    voided_at: r.voidedAt?.toISOString() ?? null,
    void_reason: r.voidReason ?? null,
    allowed_actions: allowedActions(r),
    created_at: r.createdAt.toISOString(),
    line_items: (r.lineItems ?? []).map((l: any) => ({
      id: l.id,
      employee_id: l.employeeId,
      employee_name: l.employee.name,
      employee_type: l.employee.employeeType,
      days_worked: l.daysWorked ? Number(l.daysWorked) : null,
      gross_pay_pkr: Number(l.grossPayPkr),
      eobi_employee_pkr: Number(l.eobiEmployeePkr),
      eobi_employer_pkr: Number(l.eobiEmployerPkr),
      income_tax_pkr: Number(l.incomeTaxPkr),
      advance_recovery_pkr: Number(l.advanceRecoveryPkr),
      net_pay_pkr: Number(l.netPayPkr),
    })),
  };
}
