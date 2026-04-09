import type { FastifyInstance } from 'fastify';
import { CreateChamberRequest, UpdateChamberRequest, ChamberListQuery, LogTemperatureRequest } from '@coldchain/shared';
import { ChamberService } from './chamber.service';
import { ChamberRepository } from './chamber.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function chamberRoutes(app: FastifyInstance) {
  const service = new ChamberService(new ChamberRepository(app.prisma));

  // GET /v1/chambers
  app.route({
    method: 'GET',
    url: '/v1/chambers',
    preHandler: [app.authenticate],
    schema: { querystring: ChamberListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof ChamberListQuery>;
      const result = await service.list(request.user!.facilityId, query.is_active);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/chambers
  app.route({
    method: 'POST',
    url: '/v1/chambers',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { body: CreateChamberRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateChamberRequest>;
      const result = await service.create(request.user!.facilityId, {
        name: body.name,
        commodityRestrictionId: body.commodity_restriction_id,
        maxCapacityBags: body.max_capacity_bags,
        temperatureMinC: body.temperature_min_c,
        temperatureMaxC: body.temperature_max_c,
        notes: body.notes,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/chambers/:id
  app.route({
    method: 'GET',
    url: '/v1/chambers/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PATCH /v1/chambers/:id
  app.route({
    method: 'PATCH',
    url: '/v1/chambers/:id',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: UpdateChamberRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateChamberRequest>;
      const result = await service.update(request.user!.facilityId, id, {
        name: body.name,
        commodityRestrictionId: body.commodity_restriction_id,
        maxCapacityBags: body.max_capacity_bags,
        temperatureMinC: body.temperature_min_c,
        temperatureMaxC: body.temperature_max_c,
        notes: body.notes,
      });
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/chambers/:id/temperature
  app.route({
    method: 'POST',
    url: '/v1/chambers/:id/temperature',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam, body: LogTemperatureRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof LogTemperatureRequest>;
      const result = await service.logTemperature(
        request.user!.facilityId,
        id,
        request.user!.userId,
        {
          temperatureC: body.temperature_c,
          recordedAt: body.recorded_at,
          source: body.source,
        },
      );
      return sendSuccess(reply.status(201), result);
    },
  });
}
