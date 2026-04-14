import type { FastifyInstance } from 'fastify';
import {
  CreateServiceChargeRequest,
  UpdateServiceChargeRequest,
  ServiceChargeListQuery,
} from '@coldchain/shared';
import { ServiceChargeService } from './service-charge.service';
import { ServiceChargeRepository } from './service-charge.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function serviceChargeRoutes(app: FastifyInstance) {
  const service = new ServiceChargeService(new ServiceChargeRepository(app.prisma));

  app.route({
    method: 'GET',
    url: '/v1/service-charges',
    preHandler: [app.authenticate],
    schema: { querystring: ServiceChargeListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof ServiceChargeListQuery>;
      const result = await service.list(request.user!.facilityId, query.is_active);
      return sendSuccess(reply, result);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/service-charges',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { body: CreateServiceChargeRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateServiceChargeRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        name: body.name,
        unitType: body.unit_type,
        unitPricePkr: body.unit_price_pkr,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/service-charges/:id',
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
    url: '/v1/service-charges/:id',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: UpdateServiceChargeRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateServiceChargeRequest>;
      const result = await service.update(request.user!.facilityId, id, {
        name: body.name,
        unitType: body.unit_type,
        unitPricePkr: body.unit_price_pkr,
        isActive: body.is_active,
      });
      return sendSuccess(reply, result);
    },
  });

  app.route({
    method: 'DELETE',
    url: '/v1/service-charges/:id',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.deactivate(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });
}
