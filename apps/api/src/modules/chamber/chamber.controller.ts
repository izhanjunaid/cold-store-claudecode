import type { FastifyInstance } from 'fastify';
import {
  CreateChamberRequest,
  UpdateChamberRequest,
  ChamberListQuery,
  LogTemperatureRequest,
  CreateRackRequest,
  UpdateRackRequest,
} from '@coldchain/shared';
import { ChamberService } from './chamber.service';
import { ChamberRepository } from './chamber.repository';
import { sendSuccess } from '../../common/response';
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
    preHandler: [app.authenticate, app.requirePermission('chambers.manage')],
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
    preHandler: [app.authenticate, app.requirePermission('chambers.manage')],
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
    preHandler: [app.authenticate, app.requirePermission('chambers.log_temperature')],
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

  // POST /v1/chambers/:id/racks
  app.route({
    method: 'POST',
    url: '/v1/chambers/:id/racks',
    preHandler: [app.authenticate, app.requirePermission('chambers.manage')],
    schema: { params: IdParam, body: CreateRackRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof CreateRackRequest>;
      const result = await service.createRack(request.user!.facilityId, id, {
        name: body.name,
        maxCapacityBags: body.max_capacity_bags,
        position: body.position,
        notes: body.notes,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // PATCH /v1/racks/:id
  app.route({
    method: 'PATCH',
    url: '/v1/racks/:id',
    preHandler: [app.authenticate, app.requirePermission('chambers.manage')],
    schema: { params: IdParam, body: UpdateRackRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateRackRequest>;
      const result = await service.updateRack(request.user!.facilityId, id, {
        name: body.name,
        maxCapacityBags: body.max_capacity_bags,
        position: body.position,
        notes: body.notes,
        isActive: body.is_active,
      });
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/racks/:id/lots
  app.route({
    method: 'GET',
    url: '/v1/racks/:id/lots',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getRackLots(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/chambers/:id/rack-labels
  app.route({
    method: 'GET',
    url: '/v1/chambers/:id/rack-labels',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { filename, pdf } = await service.getRackLabelsPdf(request.user!.facilityId, id);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdf);
    },
  });
}
