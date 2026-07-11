import type { FastifyInstance } from 'fastify';
import {
  CreateOutboundRequest,
  UpdateOutboundWeightRequest,
  FinalizeOutboundRequest,
} from '@coldchain/shared';
import { OutboundService } from './outbound.service';
import { OutboundRepository } from './outbound.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function outboundRoutes(app: FastifyInstance) {
  const service = new OutboundService(app.prisma, new OutboundRepository(app.prisma));

  // POST /v1/outbound-events
  app.route({
    method: 'POST',
    url: '/v1/outbound-events',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { body: CreateOutboundRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateOutboundRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        createdBy: request.user!.userId,
        userRole: request.user!.role,
        lotId: body.lot_id,
        withdrawalType: body.withdrawal_type,
        quantityWithdrawnBags: body.quantity_withdrawn_bags,
        outboundDate: body.outbound_date,
        receivingPartyId: body.receiving_party_id,
        thirdPartyRelease: body.third_party_release,
        vehicleNumber: body.vehicle_number,
        notes: body.notes,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/outbound-events/:id
  app.route({
    method: 'GET',
    url: '/v1/outbound-events/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PATCH /v1/outbound-events/:id/weight
  app.route({
    method: 'PATCH',
    url: '/v1/outbound-events/:id/weight',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam, body: UpdateOutboundWeightRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateOutboundWeightRequest>;
      const result = await service.recordWeight(
        request.user!.facilityId,
        id,
        body.outbound_weight_kg,
      );
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/outbound-events/:id/finalize
  app.route({
    method: 'POST',
    url: '/v1/outbound-events/:id/finalize',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: FinalizeOutboundRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof FinalizeOutboundRequest>;
      const result = await service.finalize(
        request.user!.facilityId,
        id,
        body.notes,
        body.picked_from?.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
        request.user!.userId,
      );
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/outbound-events/:id/dispatch-note
  app.route({
    method: 'GET',
    url: '/v1/outbound-events/:id/dispatch-note',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { filename, pdf } = await service.getDispatchNotePdf(
        request.user!.facilityId,
        id,
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdf);
    },
  });
}
