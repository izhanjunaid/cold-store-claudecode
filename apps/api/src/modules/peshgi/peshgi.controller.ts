import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IssuePeshgiRequest,
  RecordRepaymentRequest,
  PartyLoanListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { PeshgiService } from './peshgi.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function peshgiRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new PeshgiService(app.prisma, journalEntry);

  app.route({
    method: 'GET',
    url: '/v1/peshgi',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: PartyLoanListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof PartyLoanListQuery>;
      const data = await service.list(request.user!.facilityId, { ...q, pageSize: q.page_size });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/peshgi',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { body: IssuePeshgiRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof IssuePeshgiRequest>;
      if (body.book_type === 'KATCHI' && request.user!.role !== 'OWNER') {
        throw Errors.FORBIDDEN('Only OWNER can post KATCHI entries');
      }
      const data = await service.issue(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/peshgi/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/peshgi/:id/repayments',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: RecordRepaymentRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof RecordRepaymentRequest>;
      const data = await service.recordRepayment(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });
}
