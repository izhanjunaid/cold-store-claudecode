import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreatePartnerRequest,
  UpdatePartnerRequest,
  SetProfitSharesRequest,
  type CreatePartnerRequestType,
  type UpdatePartnerRequestType,
  type SetProfitSharesRequestType,
} from '@coldchain/shared';
import { PartnerService } from './partner.service';
import { sendSuccess } from '../../common/response';

const IdParam = z.object({ id: z.string().uuid() });

export async function partnerRoutes(app: FastifyInstance) {
  const service = new PartnerService(app.prisma);

  // GET /v1/partners — the owners, and which accounts are theirs.
  app.route({
    method: 'GET',
    url: '/v1/partners',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    handler: async (request, reply) =>
      sendSuccess(reply, await service.list(request.user!.facilityId)),
  });

  // POST /v1/partners — creates or adopts both accounts in one transaction.
  app.route({
    method: 'POST',
    url: '/v1/partners',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_partners')],
    schema: { body: CreatePartnerRequest },
    handler: async (request, reply) =>
      sendSuccess(
        reply.status(201),
        await service.create(request.user!.facilityId, request.body as CreatePartnerRequestType),
      ),
  });

  // PATCH /v1/partners/:id — rename, or retire. Never removes anything.
  app.route({
    method: 'PATCH',
    url: '/v1/partners/:id',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_partners')],
    schema: { params: IdParam, body: UpdatePartnerRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      return sendSuccess(
        reply,
        await service.update(request.user!.facilityId, id, request.body as UpdatePartnerRequestType),
      );
    },
  });

  // GET /v1/partners/profit-shares — every ratio window, oldest first.
  app.route({
    method: 'GET',
    url: '/v1/partners/profit-shares',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    handler: async (request, reply) =>
      sendSuccess(reply, await service.listShares(request.user!.facilityId)),
  });

  // PUT /v1/partners/profit-shares — replaces the window at effective_from.
  app.route({
    method: 'PUT',
    url: '/v1/partners/profit-shares',
    preHandler: [app.authenticate, app.requirePermission('accounting.manage_partners')],
    schema: { body: SetProfitSharesRequest },
    handler: async (request, reply) =>
      sendSuccess(
        reply,
        await service.setShares(request.user!.facilityId, request.body as SetProfitSharesRequestType),
      ),
  });
}
