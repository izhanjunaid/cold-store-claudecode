import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CashHandoverListQuery,
  CreateCashHandoverRequest,
  DispatchDayQuery,
  VoidCashHandoverRequest,
} from '@coldchain/shared';
import { CashHandoverService } from './cash-handover.service';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { sendSuccess } from '../../common/response';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * The dispatch desk's money (fast-dispatch Phase C1c): the day's totals per collector and the cash
 * handover. The day is anyone's who books withdrawals (their own row); counting cash and seeing
 * everyone's is `cash_handovers.confirm`.
 */
export async function cashHandoverRoutes(app: FastifyInstance) {
  const service = new CashHandoverService(app.prisma, new JournalEntryService(app.prisma, new PeriodLockService(app.prisma)));

  // GET /v1/dispatch/day
  app.route({
    method: 'GET',
    url: '/v1/dispatch/day',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { querystring: DispatchDayQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof DispatchDayQuery>;
      const seeAll = (await app.ensurePermissions(request)).has('cash_handovers.confirm');
      return sendSuccess(reply, await service.day(request.user!.facilityId, request.user!.userId, seeAll, query.date));
    },
  });

  // POST /v1/cash-handovers
  app.route({
    method: 'POST',
    url: '/v1/cash-handovers',
    preHandler: [app.authenticate, app.requirePermission('cash_handovers.confirm')],
    schema: { body: CreateCashHandoverRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateCashHandoverRequest>;
      const result = await service.create(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), result);
    },
  });

  // POST /v1/cash-handovers/:id/void
  app.route({
    method: 'POST',
    url: '/v1/cash-handovers/:id/void',
    preHandler: [app.authenticate, app.requirePermission('cash_handovers.confirm')],
    schema: { params: IdParam, body: VoidCashHandoverRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof VoidCashHandoverRequest>;
      return sendSuccess(reply, await service.void(request.user!.facilityId, request.user!.userId, id, body.reason));
    },
  });

  // GET /v1/cash-handovers
  app.route({
    method: 'GET',
    url: '/v1/cash-handovers',
    preHandler: [app.authenticate, app.requirePermission('cash_handovers.confirm')],
    schema: { querystring: CashHandoverListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof CashHandoverListQuery>;
      const result = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });
}
