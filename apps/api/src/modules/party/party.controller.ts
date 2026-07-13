import type { FastifyInstance } from 'fastify';
import { CreatePartyRequest, UpdatePartyRequest, PartyListQuery } from '@coldchain/shared';
import { PartyService } from './party.service';
import { PartyRepository } from './party.repository';
import { sendSuccess } from '../../common/response';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function partyRoutes(app: FastifyInstance) {
  const service = new PartyService(new PartyRepository(app.prisma));

  // GET /v1/parties
  app.route({
    method: 'GET',
    url: '/v1/parties',
    preHandler: [app.authenticate],
    schema: { querystring: PartyListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof PartyListQuery>;
      const result = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // POST /v1/parties
  app.route({
    method: 'POST',
    url: '/v1/parties',
    preHandler: [app.authenticate, app.requirePermission('parties.manage')],
    schema: { body: CreatePartyRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreatePartyRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        name: body.name,
        nameUrdu: body.name_urdu,
        partyType: body.party_type,
        phonePrimary: body.phone_primary,
        phoneSecondary: body.phone_secondary,
        address: body.address,
        cnic: body.cnic,
        parentArhtiId: body.parent_arhti_id,
        creditLimitPkr: body.credit_limit_pkr,
        creditTermsDays: body.credit_terms_days,
        notes: body.notes,
        createdBy: request.user!.userId,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/parties/:id
  app.route({
    method: 'GET',
    url: '/v1/parties/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PATCH /v1/parties/:id
  app.route({
    method: 'PATCH',
    url: '/v1/parties/:id',
    preHandler: [app.authenticate, app.requirePermission('parties.manage')],
    schema: { params: IdParam, body: UpdatePartyRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdatePartyRequest>;
      const result = await service.update(request.user!.facilityId, id, {
        name: body.name,
        nameUrdu: body.name_urdu,
        partyType: body.party_type,
        phonePrimary: body.phone_primary,
        phoneSecondary: body.phone_secondary,
        address: body.address,
        cnic: body.cnic,
        parentArhtiId: body.parent_arhti_id,
        creditLimitPkr: body.credit_limit_pkr,
        creditTermsDays: body.credit_terms_days,
        notes: body.notes,
      });
      return sendSuccess(reply, result);
    },
  });

  // DELETE /v1/parties/:id (soft deactivate)
  app.route({
    method: 'DELETE',
    url: '/v1/parties/:id',
    preHandler: [app.authenticate, app.requirePermission('parties.delete')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.deactivate(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });
}
