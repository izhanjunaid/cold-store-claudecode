import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SurchargeService } from './surcharge.service';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';

const IdParam = z.object({ id: z.string().uuid() });
const SuggestionsQuery = z.object({
  as_of: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
const ApplyBody = z.object({
  notes: z.string().max(500).optional(),
});

export async function surchargeRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new SurchargeService(app.prisma, journalEntry);

  // GET /v1/surcharges/suggestions — ACCOUNTANT+
  app.route({
    method: 'GET',
    url: '/v1/surcharges/suggestions',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: SuggestionsQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof SuggestionsQuery>;
      const result = await service.listSuggestions(request.user!.facilityId, query.as_of);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/invoices/:id/surcharges — ACCOUNTANT+ (one-click apply)
  app.route({
    method: 'POST',
    url: '/v1/invoices/:id/surcharges',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: ApplyBody },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ApplyBody>;
      const result = await service.apply(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body.notes,
      );
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/invoices/:id/surcharges — authenticated
  app.route({
    method: 'GET',
    url: '/v1/invoices/:id/surcharges',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.listByInvoice(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });
}
