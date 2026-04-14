import type { FastifyInstance } from 'fastify';
import { CreateLotRequest, UpdateLotRequest, LotListQuery } from '@coldchain/shared';
import { LotService } from './lot.service';
import { LotRepository } from './lot.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function lotRoutes(app: FastifyInstance) {
  const service = new LotService(app.prisma, new LotRepository(app.prisma));

  // GET /v1/lots
  app.route({
    method: 'GET',
    url: '/v1/lots',
    preHandler: [app.authenticate],
    schema: { querystring: LotListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof LotListQuery>;
      const result = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // POST /v1/lots
  app.route({
    method: 'POST',
    url: '/v1/lots',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { body: CreateLotRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateLotRequest>;
      const result = await service.create({
        facilityId: request.user!.facilityId,
        createdBy: request.user!.userId,
        ownerPartyId: body.owner_party_id,
        billingPartyId: body.billing_party_id,
        commodityId: body.commodity_id,
        varietyId: body.variety_id,
        ratePlanId: body.rate_plan_id,
        chamberId: body.chamber_id,
        quantityBags: body.quantity_bags,
        acceptedWeightKg: body.accepted_weight_kg,
        declaredWeightKg: body.declared_weight_kg,
        weightDisputeNote: body.weight_dispute_note,
        qualityGradeInbound: body.quality_grade_inbound,
        inboundDate: body.inbound_date,
        vehicleNumber: body.vehicle_number,
        notes: body.notes,
        bookType: body.book_type,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/lots/:id
  app.route({
    method: 'GET',
    url: '/v1/lots/:id',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PATCH /v1/lots/:id
  app.route({
    method: 'PATCH',
    url: '/v1/lots/:id',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam, body: UpdateLotRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateLotRequest>;
      const result = await service.update(request.user!.facilityId, id, {
        notes: body.notes,
        qualityGradeInbound: body.quality_grade_inbound,
      });
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/lots/:id/ownership-history
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/ownership-history',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getOwnershipHistory(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/lots/:id/receipt
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/receipt',
    preHandler: [app.authenticate, requireMinRole('OPERATOR')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { lotNumber, pdfBuffer } = await service.getReceipt(
        request.user!.facilityId,
        id,
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${lotNumber}.pdf"`)
        .send(pdfBuffer);
    },
  });
}
