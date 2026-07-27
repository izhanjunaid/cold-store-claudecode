import type { PrismaClient, Prisma } from '@coldchain/db';
import { Errors } from '../../common/errors';
import { advisoryXactLock } from '../../common/advisory-lock';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { DEFAULT_BANK_ACCOUNT_CODE } from '../accounting/templates/types';
import { generatePayrollRunNumber } from './payroll-number';
import { buildJE15MonthlyPayroll } from './templates/je-15-monthly-payroll';
import { buildJE15BDailyWages } from './templates/je-15b-daily-wages';
import { buildJE16SalaryPayment } from './templates/je-16-salary-payment';
import { buildJE16BGovtRemittance } from './templates/je-16b-govt-remittance';
import { formatEmployee } from './employee.service';

// EOBI rates per spec §11.2 (Pakistan, 2026 rates)
const EOBI_EMPLOYEE_PER_MONTH = 375; // 1% of minimum wage
const EOBI_EMPLOYER_PER_MONTH = 1875; // 5% of minimum wage

type Tx = Prisma.TransactionClient;

/** Row-lock a run so a status read and the JE post that follows cannot interleave. */
async function lockPayrollRun(tx: Tx, facilityId: string, runId: string): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT id FROM payroll_runs WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
    runId,
    facilityId,
  );
}

export class PayrollRunService {
  constructor(
    private prisma: PrismaClient,
    private journalEntry: JournalEntryService,
  ) {}

  async createDraft(facilityId: string, userId: string, body: any) {
    const { payroll_type, period_year, period_month } = body;
    const bookType = body.book_type ?? 'PACCI';

    return this.prisma.$transaction(async (tx) => {
      // Serialize concurrent creates for the same period+type before checking.
      //
      // This check used to run on `this.prisma`, outside the transaction opened below,
      // and the table carries only a NON-unique index on
      // (facility_id, period_year, period_month) — so two concurrent creates could both
      // see nothing and both insert. Moving it inside the transaction is not enough on
      // its own: under Read Committed both would still read before either wrote.
      //
      // An advisory lock is used rather than a unique constraint deliberately. The rule
      // is "no *live* run for this period" — a reversed run must remain replaceable
      // (audit P1-3) — and a partial unique index carrying that predicate cannot be
      // expressed in the Prisma schema, so it would register as permanent drift.
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

      const runNumber = await generatePayrollRunNumber(tx, facilityId, period_year, period_month);

      // Snapshot all active employees of the matching type
      const employeeType = payroll_type === 'MONTHLY_SALARY' ? 'SALARIED' : 'DAILY_WAGE';
      const employees = await tx.employee.findMany({
        where: { facilityId, isActive: true, employeeType },
        orderBy: { name: 'asc' },
      });

      // Pre-fill each employee's ACTIVE advance instalment (phase 21). One active
      // advance per employee (enforced at issue) makes this a plain lookup — no
      // priority ordering to decide when salary can't cover several. The accountant
      // can edit or zero it per line before finalizing; this is a suggestion, not a
      // commitment.
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

      let totalGross = 0;
      let totalEmployeeEobi = 0;
      let totalEmployerEobi = 0;
      let totalNet = 0;

      for (let i = 0; i < employees.length; i++) {
        const e = employees[i]!;
        const isSalaried = e.employeeType === 'SALARIED';
        const gross = isSalaried
          ? Number(e.basicSalaryPkr ?? 0)
          : Number(e.dailyWagePkr ?? 0) * 26; // default 26 working days for daily wage default
        const employeeEobi = e.eobiRegistered ? EOBI_EMPLOYEE_PER_MONTH : 0;
        const employerEobi = e.eobiRegistered ? EOBI_EMPLOYER_PER_MONTH : 0;
        const advance = advanceByEmployee.get(e.id);
        const advanceRecovery = advance
          ? Math.min(Number(advance.monthlyInstallmentPkr), Number(advance.balanceOutstandingPkr))
          : 0;
        const net = round2(gross - employeeEobi - advanceRecovery);

        await tx.payrollLineItem.create({
          data: {
            payrollRunId: run.id,
            employeeId: e.id,
            daysWorked: isSalaried ? null : 26,
            grossPayPkr: gross,
            eobiEmployeePkr: employeeEobi,
            eobiEmployerPkr: employerEobi,
            incomeTaxPkr: 0,
            otherDeductionsPkr: 0,
            advanceRecoveryPkr: round2(advanceRecovery),
            netPayPkr: net,
            sortOrder: i,
          },
        });

        totalGross = round2(totalGross + gross);
        totalEmployeeEobi = round2(totalEmployeeEobi + employeeEobi);
        totalEmployerEobi = round2(totalEmployerEobi + employerEobi);
        totalNet = round2(totalNet + net);
      }

      const updated = await tx.payrollRun.update({
        where: { id: run.id },
        data: {
          totalGrossPkr: totalGross,
          totalDeductionsPkr: round2(totalGross - totalNet),
          totalEmployerEobiPkr: totalEmployerEobi,
          totalNetPayablePkr: totalNet,
        },
      });
      return this.getByIdInternal(facilityId, updated.id, tx);
    });
  }

  async updateLine(facilityId: string, runId: string, lineId: string, body: any) {
    const run = await this.prisma.payrollRun.findFirst({ where: { facilityId, id: runId } });
    if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
    if (run.status !== 'DRAFT') {
      throw Errors.PAYROLL_RUN_INVALID_STATUS('Cannot edit lines of a non-DRAFT run');
    }

    return this.prisma.$transaction(async (tx) => {
      const line = await tx.payrollLineItem.findFirst({
        where: { id: lineId, payrollRunId: runId },
      });
      if (!line) throw Errors.PAYROLL_LINE_NOT_FOUND();

      const grossPay = body.gross_pay_pkr ?? Number(line.grossPayPkr);
      const empEobi = body.eobi_employee_pkr ?? Number(line.eobiEmployeePkr);
      const empyEobi = body.eobi_employer_pkr ?? Number(line.eobiEmployerPkr);
      const tax = body.income_tax_pkr ?? Number(line.incomeTaxPkr);
      const otherDed = body.other_deductions_pkr ?? Number(line.otherDeductionsPkr);

      // Validate against the employee's live outstanding balance, not the amount the
      // draft was pre-filled with — the accountant may be raising it back up after
      // lowering it, or the balance may have moved since the draft was created.
      const advanceRecovery = body.advance_recovery_pkr ?? Number(line.advanceRecoveryPkr);
      if (advanceRecovery > 0.005) {
        const advance = await tx.employeeAdvance.findFirst({
          where: { facilityId, employeeId: line.employeeId, status: 'ACTIVE' },
        });
        const outstanding = advance ? Number(advance.balanceOutstandingPkr) : 0;
        if (advanceRecovery > outstanding + 0.005) throw Errors.EMPLOYEE_ADVANCE_OVER_RECOVERY();
      }

      const net = round2(grossPay - empEobi - tax - otherDed - advanceRecovery);

      await tx.payrollLineItem.update({
        where: { id: lineId },
        data: {
          ...(body.days_worked !== undefined ? { daysWorked: body.days_worked } : {}),
          grossPayPkr: grossPay,
          eobiEmployeePkr: empEobi,
          eobiEmployerPkr: empyEobi,
          incomeTaxPkr: tax,
          otherDeductionsPkr: otherDed,
          advanceRecoveryPkr: advanceRecovery,
          netPayPkr: net,
        },
      });

      // Recompute run totals
      const lines = await tx.payrollLineItem.findMany({ where: { payrollRunId: runId } });
      const totals = lines.reduce(
        (acc, l) => {
          acc.gross += Number(l.grossPayPkr);
          acc.empEobi += Number(l.eobiEmployeePkr);
          acc.emperEobi += Number(l.eobiEmployerPkr);
          acc.tax += Number(l.incomeTaxPkr);
          acc.other += Number(l.otherDeductionsPkr);
          acc.advanceRecovery += Number(l.advanceRecoveryPkr);
          acc.net += Number(l.netPayPkr);
          return acc;
        },
        { gross: 0, empEobi: 0, emperEobi: 0, tax: 0, other: 0, advanceRecovery: 0, net: 0 },
      );

      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          totalGrossPkr: round2(totals.gross),
          totalDeductionsPkr: round2(totals.empEobi + totals.tax + totals.other + totals.advanceRecovery),
          totalEmployerEobiPkr: round2(totals.emperEobi),
          totalNetPayablePkr: round2(totals.net),
        },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async finalize(facilityId: string, userId: string, runId: string) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({
        where: { facilityId, id: runId },
        include: { lineItems: true },
      });
      if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
      if (run.status !== 'DRAFT') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Only DRAFT runs can be finalized');
      }
      if (run.lineItems.length === 0) {
        throw Errors.VALIDATION_ERROR('Cannot finalize a payroll run with no line items');
      }

      // Compute totals from current line items
      const totals = run.lineItems.reduce(
        (acc, l) => {
          acc.gross += Number(l.grossPayPkr);
          acc.empEobi += Number(l.eobiEmployeePkr);
          acc.emperEobi += Number(l.eobiEmployerPkr);
          acc.tax += Number(l.incomeTaxPkr);
          acc.other += Number(l.otherDeductionsPkr);
          acc.advanceRecovery += Number(l.advanceRecoveryPkr);
          acc.net += Number(l.netPayPkr);
          return acc;
        },
        { gross: 0, empEobi: 0, emperEobi: 0, tax: 0, other: 0, advanceRecovery: 0, net: 0 },
      );

      // `other_deductions_pkr` is subtracted from net pay (updateLine) but has no
      // journal line, so the entry came up short by exactly that amount and threw
      // JOURNAL_UNBALANCED — a message that tells the accountant nothing.
      //
      // It is deliberately not given an account here. docs/09 defines the column as
      // "Advances repaid, etc."; recovering an advance should credit an employee
      // *receivable*, and crediting a liability instead would leave the receivable
      // standing while inventing an obligation — the same receivable-plus-liability
      // error as the advance-cheque bug fixed in Batch A, and one that balances, so
      // no invariant would catch it. Employee advances do not exist yet (audit P1-2),
      // so there is no correct account to credit. Refuse explicitly until there is.
      if (round2(totals.other) > 0.005) {
        throw Errors.PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED();
      }

      // Use last day of period as entry date
      const entryDate = new Date(Date.UTC(run.periodYear, run.periodMonth, 0));

      const draft =
        run.payrollType === 'MONTHLY_SALARY'
          ? buildJE15MonthlyPayroll({
              payrollRunId: run.id,
              runNumber: run.runNumber,
              entryDate,
              totalGrossPkr: round2(totals.gross),
              totalEmployerEobiPkr: round2(totals.emperEobi),
              totalEmployeeEobiPkr: round2(totals.empEobi),
              totalIncomeTaxPkr: round2(totals.tax),
              totalAdvanceRecoveryPkr: round2(totals.advanceRecovery),
              totalNetPayablePkr: round2(totals.net),
              bookType: run.bookType,
            })
          : buildJE15BDailyWages({
              payrollRunId: run.id,
              runNumber: run.runNumber,
              entryDate,
              totalGrossPkr: round2(totals.gross),
              totalEmployerEobiPkr: round2(totals.emperEobi),
              totalEmployeeEobiPkr: round2(totals.empEobi),
              totalIncomeTaxPkr: round2(totals.tax),
              totalAdvanceRecoveryPkr: round2(totals.advanceRecovery),
              totalNetPayablePkr: round2(totals.net),
              bookType: run.bookType,
            });

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      // Recovery does not post its own journal entry — it rode inside the entry just
      // posted, as the 1230 credit line above. This settles the subledger side: one
      // EmployeeAdvanceRecovery row per line that carried a recovery, the advance
      // balance decremented, and the advance closed once it reaches zero.
      for (const line of run.lineItems) {
        const recoveryAmount = Number(line.advanceRecoveryPkr);
        if (recoveryAmount <= 0.005) continue;

        const advance = await tx.employeeAdvance.findFirst({
          where: { facilityId, employeeId: line.employeeId, status: 'ACTIVE' },
        });
        if (!advance) {
          // Line carried a recovery amount but the employee has no active advance to
          // apply it to — the advance must have been written off or fully recovered
          // by another path since this line was last edited. Refuse rather than post
          // a recovery against nothing.
          throw Errors.VALIDATION_ERROR(
            `Line for employee ${line.employeeId} has an advance recovery but no matching ACTIVE advance`,
          );
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
            status: newBalance <= 0.005 ? 'RECOVERED' : 'ACTIVE',
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

  async pay(facilityId: string, userId: string, runId: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.payrollRun.findFirst({ where: { facilityId, id: runId } });
      if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
      if (run.status !== 'FINALIZED') {
        throw Errors.PAYROLL_RUN_INVALID_STATUS('Only FINALIZED runs can be paid');
      }

      const draft = buildJE16SalaryPayment({
        payrollRunId: run.id,
        runNumber: run.runNumber,
        entryDate: new Date(body.payment_date),
        amountPkr: Number(run.totalNetPayablePkr),
        fromAssetAccountCode: body.from_asset_account_code ?? DEFAULT_BANK_ACCOUNT_CODE,
        bookType: run.bookType,
      });

      const posted = await this.journalEntry.postInTransaction(tx, facilityId, userId, draft, {
        postingStatus: 'POSTED',
      });

      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'PAID',
          paymentJournalEntryId: posted.id,
          paidAt: new Date(),
        },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async remit(facilityId: string, userId: string, runId: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      await lockPayrollRun(tx, facilityId, runId);

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
   * Reverse a finalized or paid run posted in error (audit P1-3).
   *
   * Mirrors the invoice VOID pattern: post a reversing entry for each journal entry the
   * run produced, cross-link both ways, and move the run to REVERSED — rather than
   * mutating posted rows, which the DB guard triggers forbid outright. The generic
   * `JournalEntryService.reverse` cannot be used here: it rejects any entry whose
   * sourceTable is not 'manual'/'opening_balances', and payroll templates stamp
   * 'payroll_runs'. That restriction is deliberate — system entries are meant to be
   * corrected through their own flow, which is what this is.
   *
   * All of the run's entries are reversed together (payroll, payment, remittance).
   * Reversing only some of them would leave the run half-posted with no way to express
   * that state.
   */
  async reverse(facilityId: string, userId: string, runId: string, body: any) {
    return this.prisma.$transaction(async (tx) => {
      await lockPayrollRun(tx, facilityId, runId);

      const run = await tx.payrollRun.findFirst({ where: { facilityId, id: runId } });
      if (!run) throw Errors.PAYROLL_RUN_NOT_FOUND();
      if (run.status === 'DRAFT') {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE(
          'A DRAFT run has posted nothing to reverse; edit its lines instead',
        );
      }
      if (run.status === 'REVERSED') {
        throw Errors.PAYROLL_RUN_NOT_REVERSIBLE('This run has already been reversed');
      }

      const reversalDate = body?.reversal_date ? new Date(body.reversal_date) : new Date();

      // Unwind advance recoveries BEFORE reversing the journal entries (phase 21).
      // Getting this wrong silently forgives an employee's debt: the balance would
      // stay reduced while the payroll that reduced it has been undone. Follows the
      // same shape as PaymentService.dishonour() unwinding loan allocations: capture
      // the affected rows first (they are the source of the amounts), lock each
      // parent before mutating its balance, restore balance and status, THEN
      // soft-void the child rows so the audit trail survives — never delete them.
      const recoveries = await tx.employeeAdvanceRecovery.findMany({
        where: { payrollRunId: runId, voidedAt: null },
      });
      for (const recovery of recoveries) {
        await tx.$queryRawUnsafe(
          `SELECT id FROM employee_advances WHERE id = $1::uuid AND facility_id = $2::uuid FOR UPDATE`,
          recovery.advanceId,
          facilityId,
        );
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
            // WRITTEN_OFF is a separate, OWNER-only decision this reversal must not undo.
            //
            // Edge case, left as-is rather than built out further: if the advance was
            // later written off (for whatever remained after this recovery), restoring
            // the balance here while the status stays WRITTEN_OFF is not a bug — the
            // write-off's JE-23 only covered what was outstanding at write-off time, so
            // the restored amount was genuinely never written off. The GL stays correct;
            // the subledger just cannot express "partly written off, partly reopened" as
            // a single status. There is no un-write-off flow to reconcile this further.
            status: advance.status === 'RECOVERED' ? 'ACTIVE' : advance.status,
          },
        });
        await tx.employeeAdvanceRecovery.update({
          where: { id: recovery.id },
          data: { voidedAt: new Date(), voidedBy: userId },
        });
      }

      // Reverse in the opposite order to posting, so the ledger reads as an unwind.
      const entryIds = [
        run.remittanceJournalEntryId,
        run.paymentJournalEntryId,
        run.payrollJournalEntryId,
      ].filter((id): id is string => Boolean(id));

      for (const originalId of entryIds) {
        const original = await tx.journalEntry.findFirstOrThrow({
          where: { id: originalId, facilityId },
          include: { lines: { orderBy: { lineNumber: 'asc' } } },
        });
        if (original.postingStatus === 'REVERSED') continue;

        const reversal = await this.journalEntry.postInTransaction(
          tx,
          facilityId,
          userId,
          {
            entryType: 'REVERSAL',
            bookType: original.bookType as 'PACCI' | 'KATCHI',
            sourceTable: 'payroll_runs',
            sourceId: runId,
            entryDate: reversalDate,
            description: `Reversal of ${original.entryNumber} (payroll ${run.runNumber}) — ${body.reason}`,
            lines: original.lines.map((l) => ({
              accountCode: l.accountCode,
              debitAmount: Number(l.creditAmount),
              creditAmount: Number(l.debitAmount),
              partyId: l.partyId,
              lotId: l.lotId,
              description: l.description ?? undefined,
            })),
          },
          { postingStatus: 'POSTED' },
        );
        await this.journalEntry.markReversed(tx, original.id, reversal.id);
      }

      const tag = `[REVERSED ${reversalDate.toISOString().slice(0, 10)}]: ${body.reason}`;
      await tx.payrollRun.update({
        where: { id: runId },
        data: {
          status: 'REVERSED',
          notes: run.notes ? `${run.notes}\n${tag}` : tag,
        },
      });

      return this.getByIdInternal(facilityId, runId, tx);
    });
  }

  async getById(facilityId: string, id: string) {
    return this.getByIdInternal(facilityId, id, this.prisma);
  }

  private async getByIdInternal(facilityId: string, id: string, db: PrismaClient | Prisma.TransactionClient) {
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
    return formatRun(run);
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

    const monthLabel = new Date(run.periodYear, run.periodMonth - 1, 1).toLocaleString('en', {
      month: 'long',
      year: 'numeric',
    });

    return {
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
      otherDeductions: Number(line.otherDeductionsPkr),
      advanceRecovery: Number(line.advanceRecoveryPkr),
      netPay: Number(line.netPayPkr),
      daysWorked: line.daysWorked ? Number(line.daysWorked) : null,
    };
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
    created_at: r.createdAt.toISOString(),
    line_items: (r.lineItems ?? []).map((l: any) => ({
      id: l.id,
      employee_id: l.employeeId,
      employee_name: l.employee?.name ?? '',
      employee_type: l.employee?.employeeType ?? 'SALARIED',
      days_worked: l.daysWorked ? Number(l.daysWorked) : null,
      gross_pay_pkr: Number(l.grossPayPkr),
      eobi_employee_pkr: Number(l.eobiEmployeePkr),
      eobi_employer_pkr: Number(l.eobiEmployerPkr),
      income_tax_pkr: Number(l.incomeTaxPkr),
      other_deductions_pkr: Number(l.otherDeductionsPkr),
      advance_recovery_pkr: Number(l.advanceRecoveryPkr),
      net_pay_pkr: Number(l.netPayPkr),
    })),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
