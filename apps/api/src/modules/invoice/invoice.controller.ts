import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AddInvoiceLineRequest,
  UpdateDraftInvoiceRequest,
  FinalizeInvoiceRequest,
  VoidInvoiceRequest,
  InvoiceListQuery,
} from '@coldchain/shared';
import { InvoiceService } from './invoice.service';
import { InvoiceRepository } from './invoice.repository';
import { sendSuccess } from '../../common/response';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';

const IdParam = z.object({ id: z.string().uuid() });
const LineIdParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });

export async function invoiceRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new InvoiceService(
    app.prisma,
    new InvoiceRepository(app.prisma),
    journalEntry,
  );

  // GET /v1/invoices — ACCOUNTANT+
  app.route({
    method: 'GET',
    url: '/v1/invoices',
    preHandler: [app.authenticate, app.requirePermission('billing.view')],
    schema: { querystring: InvoiceListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof InvoiceListQuery>;
      const result = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // GET /v1/invoices/:id — authenticated
  app.route({
    method: 'GET',
    url: '/v1/invoices/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PATCH /v1/invoices/:id — MANAGER+ (DRAFT only: gst_rate, discount)
  app.route({
    method: 'PATCH',
    url: '/v1/invoices/:id',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
    schema: { params: IdParam, body: UpdateDraftInvoiceRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateDraftInvoiceRequest>;
      const result = await service.updateDraft(request.user!.facilityId, id, body);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/invoices/:id/lines — MANAGER+
  app.route({
    method: 'POST',
    url: '/v1/invoices/:id/lines',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
    schema: { params: IdParam, body: AddInvoiceLineRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof AddInvoiceLineRequest>;
      const result = await service.addLine(request.user!.facilityId, id, body);
      return sendSuccess(reply.status(201), result);
    },
  });

  // DELETE /v1/invoices/:id/lines/:lineId — MANAGER+
  app.route({
    method: 'DELETE',
    url: '/v1/invoices/:id/lines/:lineId',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
    schema: { params: LineIdParam },
    handler: async (request, reply) => {
      const { id, lineId } = request.params as z.infer<typeof LineIdParam>;
      const result = await service.removeLine(request.user!.facilityId, id, lineId);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/invoices/:id/finalize — MANAGER+
  app.route({
    method: 'POST',
    url: '/v1/invoices/:id/finalize',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
    schema: { params: IdParam, body: FinalizeInvoiceRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof FinalizeInvoiceRequest>;
      const result = await service.finalize(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/invoices/:id/void — invoices.void (OWNER default)
  app.route({
    method: 'POST',
    url: '/v1/invoices/:id/void',
    preHandler: [app.authenticate, app.requirePermission('invoices.void')],
    schema: { params: IdParam, body: VoidInvoiceRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof VoidInvoiceRequest>;
      const result = await service.void(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/invoices/:id/pdf — authenticated
  app.route({
    method: 'GET',
    url: '/v1/invoices/:id/pdf',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { filename, pdf } = await service.getPdf(request.user!.facilityId, id);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdf);
    },
  });

  // GET /v1/lots/:id/invoices — authenticated
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/invoices',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getByLot(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });
}
