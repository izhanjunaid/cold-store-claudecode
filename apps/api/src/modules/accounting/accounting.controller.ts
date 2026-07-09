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
  LockPeriodRequest,
  UnlockPeriodRequest,
  CreateCreditNoteRequest,
  CreditNoteListQuery,
  BadDebtWriteOffRequest,
  EnterOpeningBalancesRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { assertKatchiWriteAllowed, resolveBookTypeForRead } from './book-gate';
import { CoaService } from './coa.service';
import { JournalEntryService } from './journal-entry.service';
import { GlService } from './gl.service';
import { FinancialStatementsService } from './financial-statements.service';
import { PeriodLockService } from './period-lock.service';
import { CreditNoteService } from './credit-note.service';
import { BadDebtService } from './bad-debt.service';
import { OpeningBalanceService } from './opening-balance.service';
import { Errors } from '../../common/errors';

const CodeParam = z.object({ code: z.string().regex(/^[0-9]+$/) });
const IdParam = z.object({ id: z.string().uuid() });
const InvoiceIdParam = z.object({ invoiceId: z.string().uuid() });

export async function accountingRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const coa = new CoaService(app.prisma);
  const gl = new GlService(app.prisma);
  const financials = new FinancialStatementsService(app.prisma);
  const creditNote = new CreditNoteService(app.prisma, journalEntry);
  const badDebt = new BadDebtService(app.prisma, journalEntry);
  const openingBalance = new OpeningBalanceService(app.prisma, journalEntry);

  // ==========================================================
  // CHART OF ACCOUNTS — S-35
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/accounts',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('OWNER')],
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
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { params: CodeParam, body: UpdateAccountRequest },
    handler: async (request, reply) => {
      const { code } = request.params as z.infer<typeof CodeParam>;
      const body = request.body as z.infer<typeof UpdateAccountRequest>;
      const data = await coa.update(request.user!.facilityId, code, body);
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // JOURNAL ENTRIES — S-36
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/journal-entries',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
        page: q.page,
        pageSize: q.page_size,
      });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/accounting/journal-entries/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { body: CreateManualJournalEntryRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateManualJournalEntryRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const draft = {
        entryType: 'ADJUSTMENT' as const,
        bookType: body.book_type,
        sourceTable: 'manual',
        sourceId: request.user!.userId,
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
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
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
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: BalanceSheetQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof BalanceSheetQuery>;
      const bookType = resolveBookTypeForRead(request.user!.role, q.book_type);
      const data = await financials.getBalanceSheet(request.user!.facilityId, { ...q, book_type: bookType });
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // OPENING BALANCES (Gap 1)
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/opening-balances',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    handler: async (request, reply) => {
      const data = await openingBalance.getStatus(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/opening-balances',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
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
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    handler: async (request, reply) => {
      const data = await periodLock.list(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/period-locks',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
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
    preHandler: [app.authenticate, requireMinRole('OWNER')],
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

  // ==========================================================
  // CREDIT NOTES (JE-05)
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/credit-notes',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { body: CreateCreditNoteRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateCreditNoteRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const data = await creditNote.create(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/credit-notes',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: CreditNoteListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof CreditNoteListQuery>;
      const data = await creditNote.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/credit-notes/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await creditNote.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/credit-notes',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: InvoiceIdParam },
    handler: async (request, reply) => {
      const { invoiceId } = request.params as z.infer<typeof InvoiceIdParam>;
      const data = await creditNote.listByInvoice(request.user!.facilityId, invoiceId);
      return sendSuccess(reply, data);
    },
  });

  // ==========================================================
  // BAD DEBT WRITE-OFF (JE-08) — OWNER only
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/write-off',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: {
      params: InvoiceIdParam,
      body: BadDebtWriteOffRequest.omit({ invoice_id: true }),
    },
    handler: async (request, reply) => {
      const { invoiceId } = request.params as z.infer<typeof InvoiceIdParam>;
      const body = request.body as Omit<z.infer<typeof BadDebtWriteOffRequest>, 'invoice_id'>;
      const data = await badDebt.writeOff(request.user!.facilityId, request.user!.userId, {
        ...body,
        invoice_id: invoiceId,
      });
      return sendSuccess(reply.status(201), data);
    },
  });
}
