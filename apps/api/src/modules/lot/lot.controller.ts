import type { FastifyInstance } from 'fastify';
import {
  CreateLotRequest,
  UpdateLotRequest,
  LotListQuery,
  SetLotPlacementsRequest,
  MoveLotRequest,
} from '@coldchain/shared';
import { LotService } from './lot.service';
import { LotRepository } from './lot.repository';
import { PlacementService } from './placement.service';
import { OutboundService } from '../outbound/outbound.service';
import { OutboundRepository } from '../outbound/outbound.repository';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function lotRoutes(app: FastifyInstance) {
  const service = new LotService(app.prisma, new LotRepository(app.prisma));
  const outboundService = new OutboundService(app.prisma, new OutboundRepository(app.prisma));
  const placementService = new PlacementService(app.prisma);

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
    preHandler: [app.authenticate, app.requirePermission('lots.manage')],
    schema: { body: CreateLotRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateLotRequest>;
      // The lot's book flows into its invoice and JE-01 (invoice.builder),
      // so the KATCHI decision is gated here at the source (F-9).
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const result = await service.create({
        facilityId: request.user!.facilityId,
        createdBy: request.user!.userId,
        userRole: request.user!.role,
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
        marka: body.marka,
        notes: body.notes,
        bookType: body.book_type,
        placements: body.placements?.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/lots/:id/placements
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/placements',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await placementService.getPlacements(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // PUT /v1/lots/:id/placements
  app.route({
    method: 'PUT',
    url: '/v1/lots/:id/placements',
    preHandler: [app.authenticate, app.requirePermission('lots.manage')],
    schema: { params: IdParam, body: SetLotPlacementsRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof SetLotPlacementsRequest>;
      const existingLot = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existingLot.book_type);
      const result = await placementService.setPlacements(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body.placements.map((p) => ({ rackId: p.rack_id, bags: p.bags })),
      );
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/lots/:id/move
  app.route({
    method: 'POST',
    url: '/v1/lots/:id/move',
    preHandler: [app.authenticate, app.requirePermission('lots.manage')],
    schema: { params: IdParam, body: MoveLotRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof MoveLotRequest>;
      const existingLot = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existingLot.book_type);
      const result = await placementService.move(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/lots/:id/movements
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/movements',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await placementService.getMovements(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/lots/:id/placement-slip
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/placement-slip',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const { filename, pdf } = await placementService.getPlacementSlipPdf(
        request.user!.facilityId,
        id,
      );
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="${filename}"`)
        .send(pdf);
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
    preHandler: [app.authenticate, app.requirePermission('lots.manage')],
    schema: { params: IdParam, body: UpdateLotRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateLotRequest>;
      const existingLot = await service.getById(request.user!.facilityId, id);
      assertKatchiWriteAllowed(request.user!.role, existingLot.book_type);
      const result = await service.update(request.user!.facilityId, id, {
        notes: body.notes,
        qualityGradeInbound: body.quality_grade_inbound,
        marka: body.marka,
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

  // GET /v1/lots/:id/outbound-events
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/outbound-events',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await outboundService.getByLot(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/lots/:id/receipt
  app.route({
    method: 'GET',
    url: '/v1/lots/:id/receipt',
    preHandler: [app.authenticate, app.requirePermission('lots.manage')],
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
