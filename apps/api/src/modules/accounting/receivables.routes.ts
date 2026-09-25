import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  RevenueAccrualPeriodQuery,
  RunRevenueAccrualRequest,
  GstSettlementQuery,
  PostGstSettlementRequest,
  CreateCreditNoteRequest,
  CreditNoteListQuery,
  BadDebtWriteOffRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed } from './book-gate';
import { JournalEntryService } from './journal-entry.service';
import { PeriodLockService } from './period-lock.service';
import { CreditNoteService } from './credit-note.service';
import { BadDebtService } from './bad-debt.service';
import { RevenueAccrualService } from './revenue-accrual.service';
import { GstSettlementService } from './gst-settlement.service';

const IdParam = z.object({ id: z.string().uuid() });
const InvoiceIdParam = z.object({ invoiceId: z.string().uuid() });

/**
 * The receivable side of the ledger: storage-revenue accrual, output-tax
 * settlement, credit notes and bad-debt write-off (docs/25 Stream R).
 */
export async function receivablesAccountingRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const creditNote = new CreditNoteService(app.prisma, journalEntry);
  const badDebt = new BadDebtService(app.prisma, journalEntry);
  const revenueAccrual = new RevenueAccrualService(app.prisma, journalEntry);
  const gstSettlement = new GstSettlementService(app.prisma, journalEntry);

  // ==========================================================
  // REVENUE ACCRUAL (JE-25)
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/revenue-accrual',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: RevenueAccrualPeriodQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof RevenueAccrualPeriodQuery>;
      const data = await revenueAccrual.preview(request.user!.facilityId, q.period_year, q.period_month);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/revenue-accrual',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: RunRevenueAccrualRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof RunRevenueAccrualRequest>;
      const data = await revenueAccrual.run(
        request.user!.facilityId,
        request.user!.userId,
        body.period_year,
        body.period_month,
      );
      return sendSuccess(reply.status(201), data);
    },
  });


  // ==========================================================
  // GST / SALES TAX SETTLEMENT (JE-26)
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/gst-settlement',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: GstSettlementQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof GstSettlementQuery>;
      const data = await gstSettlement.preview(request.user!.facilityId, q.period_year, q.period_month);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/gst-settlement',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: PostGstSettlementRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof PostGstSettlementRequest>;
      const data = await gstSettlement.settle(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });


  // ==========================================================
  // CREDIT NOTES (JE-05)
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/credit-notes',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
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
    preHandler: [app.authenticate, app.requirePermission('billing.view')],
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
    preHandler: [app.authenticate, app.requirePermission('billing.view')],
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
    preHandler: [app.authenticate, app.requirePermission('billing.view')],
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
    preHandler: [app.authenticate, app.requirePermission('invoices.write_off')],
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
