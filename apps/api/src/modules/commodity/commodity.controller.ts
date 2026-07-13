import type { FastifyInstance } from 'fastify';
import { CreateCommodityRequest, UpdateCommodityRequest, CreateVarietyRequest } from '@coldchain/shared';
import { CommodityService } from './commodity.service';
import { CommodityRepository } from './commodity.repository';
import { sendSuccess } from '../../common/response';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function commodityRoutes(app: FastifyInstance) {
  const service = new CommodityService(new CommodityRepository(app.prisma));

  // GET /v1/commodities
  app.route({
    method: 'GET',
    url: '/v1/commodities',
    preHandler: [app.authenticate],
    handler: async (_request, reply) => {
      const result = await service.list();
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/varieties — flat list of all varieties (each with commodity_id), for the lot form
  // and other reference dropdowns. The web's useVarieties() hook calls this.
  app.route({
    method: 'GET',
    url: '/v1/varieties',
    preHandler: [app.authenticate],
    handler: async (_request, reply) => {
      const result = await service.listAllVarieties();
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/commodities
  app.route({
    method: 'POST',
    url: '/v1/commodities',
    preHandler: [app.authenticate, app.requirePermission('commodities.manage')],
    schema: { body: CreateCommodityRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateCommodityRequest>;
      const result = await service.create({
        name: body.name,
        unitLabel: body.unit_label,
        defaultStorageDaysAlert: body.default_storage_days_alert,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // PATCH /v1/commodities/:id
  app.route({
    method: 'PATCH',
    url: '/v1/commodities/:id',
    preHandler: [app.authenticate, app.requirePermission('commodities.manage')],
    schema: { params: IdParam, body: UpdateCommodityRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateCommodityRequest>;
      const result = await service.update(id, {
        name: body.name,
        unitLabel: body.unit_label,
        defaultStorageDaysAlert: body.default_storage_days_alert,
      });
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/commodities/:id/varieties
  app.route({
    method: 'GET',
    url: '/v1/commodities/:id/varieties',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.listVarieties(id);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/commodities/:id/varieties
  app.route({
    method: 'POST',
    url: '/v1/commodities/:id/varieties',
    preHandler: [app.authenticate, app.requirePermission('commodities.manage')],
    schema: { params: IdParam, body: CreateVarietyRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof CreateVarietyRequest>;
      const result = await service.createVariety(id, body.name);
      return sendSuccess(reply.status(201), result);
    },
  });
}
