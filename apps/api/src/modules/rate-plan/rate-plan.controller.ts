import type { FastifyInstance } from 'fastify';
import {
  CreateRatePlanRequest,
  UpdateRatePlanRequest,
  RatePlanListQuery,
} from '@coldchain/shared';
import { RatePlanService } from './rate-plan.service';
import { RatePlanRepository } from './rate-plan.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function ratePlanRoutes(app: FastifyInstance) {
  const service = new RatePlanService(new RatePlanRepository(app.prisma));

  app.route({
    method: 'GET',
    url: '/v1/rate-plans',
    preHandler: [app.authenticate],
    schema: { querystring: RatePlanListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof RatePlanListQuery>;
      const result = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, result);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/rate-plans',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { body: CreateRatePlanRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateRatePlanRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        name: body.name,
        commodityId: body.commodity_id,
        rateType: body.rate_type,
        rateAmountPkr: body.rate_amount_pkr,
        seasonStartDate: body.season_start_date,
        seasonEndDate: body.season_end_date,
        minBillingDays: body.min_billing_days,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/rate-plans/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/rate-plans/:id',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: UpdateRatePlanRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateRatePlanRequest>;
      const result = await service.update(request.user!.facilityId, id, {
        name: body.name,
        commodityId: body.commodity_id,
        rateAmountPkr: body.rate_amount_pkr,
        seasonStartDate: body.season_start_date,
        seasonEndDate: body.season_end_date,
        minBillingDays: body.min_billing_days,
        isActive: body.is_active,
      });
      return sendSuccess(reply, result);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/v1/rate-plans/:id',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.deactivate(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });
}
