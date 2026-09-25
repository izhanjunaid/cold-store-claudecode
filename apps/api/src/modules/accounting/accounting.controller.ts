import { randomUUID } from 'crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateAccountRequest,
  UpdateAccountRequest,
  ChartOfAccountsListQuery,
  JournalEntryListQuery,
  CreateManualJournalEntryRequest,
  ReverseJournalEntryRequest,
  GeneralLedgerQuery,
  TrialBalanceQuery,
  ProfitLossQuery,
  BalanceSheetQuery,
  CashFlowQuery,
  ChangesInEquityQuery,
  LockPeriodRequest,
  UnlockPeriodRequest,
  EnterOpeningBalancesRequest,
  CreateOwnerEquityRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed, resolveBookTypeForRead } from './book-gate';
import { CoaService } from './coa.service';
import { JournalEntryService } from './journal-entry.service';
import { GlService } from './gl.service';
import { FinancialStatementsService } from './financial-statements.service';
import { CashFlowService } from './cash-flow.service';
import { PeriodLockService } from './period-lock.service';
import { OpeningBalanceService } from './opening-balance.service';
import { CASH_TRANSFER_ACCOUNTS } from './templates/je-27-cash-transfer';
import { buildJE30OwnerEquity } from './templates/je-30-owner-equity';
import { DERIVED_EQUITY_ACCOUNTS } from './equity-accounts';
import { Errors } from '../../common/errors';

const CodeParam = z.object({ code: z.string().regex(/^[0-9]+$/) });
const IdParam = z.object({ id: z.string().uuid() });

export async function accountingRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const coa = new CoaService(app.prisma);
  const gl = new GlService(app.prisma);
  const financials = new FinancialStatementsService(app.prisma);
  const cashFlow = new CashFlowService(app.prisma);
  const openingBalance = new OpeningBalanceService(app.prisma, journalEntry);

  // ==========================================================
  // CHART OF ACCOUNTS — S-35
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/accounts',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: ChartOfAccountsListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof ChartOfAccountsListQuery>;
      const data = await coa.list(request.user!.facilityId, query);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/accounts/:code',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { params: CodeParam },
    handler: async (request, reply) => {
      const { code } = request.params as z.infer<typeof CodeParam>;
      const data = await coa.getByCode(request.user!.facilityId, code);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/accounts',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_accounts')],
    schema: { body: CreateAccountRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateAccountRequest>;
      const data = await coa.create(request.user!.facilityId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/accounting/accounts/:code',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_accounts')],
    schema: { params: CodeParam, body: UpdateAccountRequest },
    handler: async (request, reply) => {
      const { code } = request.params as z.infer<typeof CodeParam>;
      const body = request.body as z.infer<typeof UpdateAccountRequest>;
      const data = await coa.update(request.user!.facilityId, code, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/v1/accounting/accounts/:code',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_accounts')],
    schema: { params: CodeParam },
    handler: async (request, reply) => {
      const { code } = request.params as z.infer<typeof CodeParam>;
      const data = await coa.remove(request.user!.facilityId, code);
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // JOURNAL ENTRIES — S-36
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/journal-entries',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: JournalEntryListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof JournalEntryListQuery>;
      const data = await journalEntry.list(request.user!.facilityId, {
        entryType: q.entry_type,
        bookType: resolveBookTypeForRead(request.user!.role, q.book_type),
        sourceTable: q.source_table,
        sourceId: q.source_id,
        dateFrom: q.date_from,
        dateTo: q.date_to,
        postingStatus: q.posting_status,
        reversed: q.reversed,
        page: q.page,
        pageSize: q.page_size,
      });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/journal-entries/:id',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await journalEntry.getById(request.user!.facilityId, id);
      if (data.book_type === 'KATCHI') {
        resolveBookTypeForRead(request.user!.role, 'KATCHI');
      }
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/journal-entries',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: CreateManualJournalEntryRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateManualJournalEntryRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      // A manual entry has no document behind it: it is its own source.
      const id = randomUUID();
      const draft = {
        id,
        entryType: 'ADJUSTMENT' as const,
        bookType: body.book_type,
        sourceTable: 'manual',
        sourceId: id,
        entryDate: new Date(body.entry_date),
        description: body.description,
        lines: body.lines.map((l) => ({
          accountCode: l.account_code,
          debitAmount: l.debit_amount,
          creditAmount: l.credit_amount,
          partyId: l.party_id ?? null,
          lotId: l.lot_id ?? null,
          description: l.description ?? null,
        })),
      };
      const posted = await journalEntry.post(
        request.user!.facilityId,
        request.user!.userId,
        draft,
        { postingStatus: body.posting_status },
      );
      const full = await journalEntry.getById(request.user!.facilityId, posted.id);
      return sendSuccess(reply.status(201), full);
    },
  });

  // Promote an AUTO_DRAFT entry into the books (F-7).
  app.route({
    method: 'POST',
    url: '/v1/accounting/journal-entries/:id/post',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const existing = await journalEntry.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existing.book_type);
      await journalEntry.postDraft(request.user!.facilityId, id);
      const full = await journalEntry.getById(request.user!.facilityId, id);
      return sendSuccess(reply, full);
    },
  });

  // Reverse a posted manual entry (audit Gap 2).
  app.route({
    method: 'POST',
    url: '/v1/accounting/journal-entries/:id/reverse',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { params: IdParam, body: ReverseJournalEntryRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ReverseJournalEntryRequest>;
      const existing = await journalEntry.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existing.book_type);
      const reversal = await journalEntry.reverse(
        request.user!.facilityId,
        request.user!.userId,
        id,
        body.reason,
        body.entry_date ? new Date(body.entry_date) : undefined,
      );
      const full = await journalEntry.getById(request.user!.facilityId, reversal.id);
      return sendSuccess(reply.status(201), full);
    },
  });

  // ==========================================================
  // GENERAL LEDGER — S-37
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/general-ledger',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: GeneralLedgerQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof GeneralLedgerQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await gl.getAccountLedger(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/trial-balance',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: TrialBalanceQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof TrialBalanceQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await gl.getTrialBalance(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // FINANCIAL STATEMENTS — S-38
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/profit-loss',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: ProfitLossQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof ProfitLossQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await financials.getProfitLoss(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/balance-sheet',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: BalanceSheetQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof BalanceSheetQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await financials.getBalanceSheet(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/changes-in-equity',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: ChangesInEquityQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof ChangesInEquityQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await financials.getChangesInEquity(request.user!.facilityId, {
        ...q,
        book_type: bookType,
      });
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/cash-flow',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: CashFlowQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof CashFlowQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await cashFlow.getCashFlow(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // OWNER CAPITAL AND DRAWINGS (JE-30)
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/accounting/owner-equity',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: CreateOwnerEquityRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateOwnerEquityRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);

      const cashAllowed = CASH_TRANSFER_ACCOUNTS as readonly string[];
      if (!cashAllowed.includes(body.cash_account_code)) {
        throw Errors.VALIDATION_ERROR(
          `Money must move to or from a cash or bank account (${cashAllowed.join(', ')}).`,
          'cash_account_code',
        );
      }

      // The equity side must be a real, postable equity account belonging to an
      // owner. Retained earnings and the current-year result are computed by the
      // statements rather than posted, so they are refused by name.
      if ((DERIVED_EQUITY_ACCOUNTS as readonly string[]).includes(body.equity_account_code)) {
        throw Errors.VALIDATION_ERROR(
          `${body.equity_account_code} is worked out by the statements and cannot be posted to. Use the owner's own capital or drawings account.`,
          'equity_account_code',
        );
      }
      const equityAccount = await app.prisma.chartOfAccounts.findUnique({
        where: {
          facilityId_accountCode: {
            facilityId: request.user!.facilityId,
            accountCode: body.equity_account_code,
          },
        },
        select: { accountClass: true, accountType: true, isActive: true },
      });
      if (!equityAccount || !equityAccount.isActive) {
        throw Errors.VALIDATION_ERROR('That account does not exist, or is inactive.', 'equity_account_code');
      }
      if (equityAccount.accountClass !== 'EQUITY' || equityAccount.accountType !== 'DETAIL') {
        throw Errors.VALIDATION_ERROR(
          "An owner's money in or out belongs to an equity account. What an owner takes is a share of profit, not a business cost — booking it anywhere else understates both profit and taxable income (Income Tax Ordinance 2001 s.21(j)).",
          'equity_account_code',
        );
      }

      const posted = await journalEntry.post(
        request.user!.facilityId,
        request.user!.userId,
        buildJE30OwnerEquity({
          movementDate: new Date(body.movement_date),
          amountPkr: body.amount_pkr,
          direction: body.direction,
          equityAccountCode: body.equity_account_code,
          cashAccountCode: body.cash_account_code,
          bookType: body.book_type,
          userId: request.user!.userId,
          note: body.note,
        }),
        { postingStatus: 'POSTED' },
      );
      const full = await journalEntry.getById(request.user!.facilityId, posted.id);
      return sendSuccess(reply.status(201), full);
    },
  });

  // ==========================================================
  // OPENING BALANCES (Gap 1)
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/opening-balances',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    handler: async (request, reply) => {
      const data = await openingBalance.getStatus(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/opening-balances',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: EnterOpeningBalancesRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof EnterOpeningBalancesRequest>;
      const entryId = await openingBalance.enter(
        request.user!.facilityId,
        request.user!.userId,
        body,
      );
      const full = await journalEntry.getById(request.user!.facilityId, entryId);
      return sendSuccess(reply.status(201), full);
    },
  });

  // ==========================================================
  // PERIOD LOCKS
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/period-locks',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    handler: async (request, reply) => {
      const data = await periodLock.list(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/period-locks',
    preHandler: [app.authenticate, app.requirePermission('accounting.period_lock')],
    schema: { body: LockPeriodRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof LockPeriodRequest>;
      const data = await periodLock.lock(
        request.user!.facilityId,
        request.user!.userId,
        body.period_year,
        body.period_month,
        body.reason,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/period-locks/:year/:month/unlock',
    preHandler: [app.authenticate, app.requirePermission('accounting.period_unlock')],
    schema: {
      params: z.object({
        year: z.coerce.number().int(),
        month: z.coerce.number().int().min(1).max(12),
      }),
      body: UnlockPeriodRequest,
    },
    handler: async (request, reply) => {
      const { year, month } = request.params as { year: number; month: number };
      const body = request.body as z.infer<typeof UnlockPeriodRequest>;
      const data = await periodLock.unlock(
        request.user!.facilityId,
        request.user!.userId,
        year,
        month,
        body.reason,
      );
      return sendSuccess(reply, data);
    },
  });

}
