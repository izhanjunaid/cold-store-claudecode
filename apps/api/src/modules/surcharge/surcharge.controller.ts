import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ApplySurchargeRequest } from '@coldchain/shared';
import { SurchargeService } from './surcharge.service';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { sendSuccess } from '../../common/response';

const InvoiceIdParam = z.object({ invoiceId: z.string().uuid() });
const SuggestionsQuery = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function surchargeRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new SurchargeService(app.prisma, journalEntry);

  // GET /v1/surcharges/suggestions — reports.financial
  app.route({
    method: 'GET',
    url: '/v1/surcharges/suggestions',
    preHandler: [app.authenticate, app.requirePermission('reports.financial')],
    schema: { querystring: SuggestionsQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof SuggestionsQuery>;
      const result = await service.listSuggestions(request.user!.facilityId, query.as_of);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/invoices/:invoiceId/surcharges — invoices.manage (one-click apply)
  app.route({
    method: 'POST',
    url: '/v1/invoices/:invoiceId/surcharges',
    preHandler: [app.authenticate, app.requirePermission('invoices.manage')],
    schema: { params: InvoiceIdParam, body: ApplySurchargeRequest },
    handler: async (request, reply) => {
      const { invoiceId } = request.params as z.infer<typeof InvoiceIdParam>;
      const body = request.body as z.infer<typeof ApplySurchargeRequest>;
      const result = await service.apply(
        request.user!.facilityId,
        invoiceId,
        request.user!.userId,
        body.as_of_date,
      );
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/invoices/:invoiceId/surcharges — billing.view
  app.route({
    method: 'GET',
    url: '/v1/invoices/:invoiceId/surcharges',
    preHandler: [app.authenticate, app.requirePermission('billing.view')],
    schema: { params: InvoiceIdParam },
    handler: async (request, reply) => {
      const { invoiceId } = request.params as z.infer<typeof InvoiceIdParam>;
      const result = await service.listByInvoice(request.user!.facilityId, invoiceId);
      return sendSuccess(reply, result);
    },
  });
}
