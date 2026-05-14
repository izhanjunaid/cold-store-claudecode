import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  ClearOutwardRequest,
  GatePassListQuery,
  LinkLotRequest,
  LogInwardRequest,
  LogOutwardRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { GatePassRepository } from './gate-pass.repository';
import { GatePassService } from './gate-pass.service';

const IdParam = z.object({ id: z.string().uuid() });

const LogOutwardWithCreditAuth = LogOutwardRequest.extend({
  credit_authorization: z.boolean().optional(),
});

export async function gatePassRoutes(app: FastifyInstance) {
  const service = new GatePassService(app.prisma, new GatePassRepository(app.prisma));

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/inward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { body: LogInwardRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof LogInwardRequest>;
      const data = await service.logInward(
        request.user!.facilityId,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/outward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { body: LogOutwardWithCreditAuth },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof LogOutwardWithCreditAuth>;
      const data = await service.logOutward(
        request.user!.facilityId,
        request.user!.userId,
        request.user!.role,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/gate-passes',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { querystring: GatePassListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof GatePassListQuery>;
      const data = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/gate-passes/:id',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/gate-passes/:id/link-lot',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam, body: LinkLotRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof LinkLotRequest>;
      const data = await service.linkLot(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/gate-passes/:id/outward',
    preHandler: [app.authenticate, requireMinRole('SECURITY')],
    schema: { params: IdParam, body: ClearOutwardRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ClearOutwardRequest>;
      const data = await service.clearOutward(
        request.user!.facilityId,
        id,
        request.user!.role,
        body,
      );
      return sendSuccess(reply, data);
    },
  });
}
