import type { FastifyInstance } from 'fastify';
import {
  CreateOutboundRequest,
  UpdateOutboundWeightRequest,
  FinalizeOutboundRequest,
  CancelOutboundRequest,
  OutboundListQuery,
  DispatchAndCollectRequest,
  TruckDispatchRequest,
} from '@coldchain/shared';
import { OutboundService } from './outbound.service';
import { OutboundRepository } from './outbound.repository';
import { DispatchCheckoutService } from './dispatch-checkout.service';
import { InvoiceService } from '../invoice/invoice.service';
import { InvoiceRepository } from '../invoice/invoice.repository';
import { PaymentService } from '../payment/payment.service';
import { PaymentRepository } from '../payment/payment.repository';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { sendSuccess } from '../../common/response';
import { z } from 'zod';

const IdParam = z.object({ id: z.string().uuid() });

export async function outboundRoutes(app: FastifyInstance) {
  const service = new OutboundService(app.prisma, new OutboundRepository(app.prisma));
  const journalEntry = new JournalEntryService(app.prisma, new PeriodLockService(app.prisma));
  const checkout = new DispatchCheckoutService(
    app.prisma,
    service,
    new InvoiceService(app.prisma, new InvoiceRepository(app.prisma), journalEntry),
    new PaymentService(app.prisma, new PaymentRepository(app.prisma), journalEntry),
  );

  // GET /v1/outbound-events — the dispatch desk's queue. outbound.record (the guard's
  // gate_passes.log is not enough): the rows carry bag counts, which the guard counts blind.
  app.route({
    method: 'GET',
    url: '/v1/outbound-events',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { querystring: OutboundListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof OutboundListQuery>;
      const result = await checkout.list(request.user!.facilityId, query);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // POST /v1/outbound-events
  app.route({
    method: 'POST',
    url: '/v1/outbound-events',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
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
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
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
    preHandler: [app.authenticate, app.requirePermission('outbound.finalize')],
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

  // GET /v1/outbound-events/:id/checkout-preview — the bill a weighed withdrawal will carry.
  // outbound.record, not .finalize: the munshi reads the bill, and the preview says whether the
  // owner's solo switch lets them finish it.
  app.route({
    method: 'GET',
    url: '/v1/outbound-events/:id/checkout-preview',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      return sendSuccess(reply, await checkout.preview(request.user!.facilityId, id));
    },
  });

  // POST /v1/outbound-events/:id/dispatch-and-collect — dispatch, bill and collect in one
  // transaction. The route needs outbound.record; the handler then wants outbound.finalize,
  // invoices.manage and (unless on credit) payments.record, or the owner's solo switch for a
  // clean truck (cash in full, or approved credit) — checked before anything is written.
  app.route({
    method: 'POST',
    url: '/v1/outbound-events/:id/dispatch-and-collect',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { params: IdParam, body: DispatchAndCollectRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof DispatchAndCollectRequest>;
      const result = await checkout.dispatchAndCollect(
        {
          facilityId: request.user!.facilityId,
          userId: request.user!.userId,
          role: request.user!.role,
          permissions: await app.ensurePermissions(request),
        },
        id,
        body,
      );
      return sendSuccess(reply, result);
    },
  });

  // The whole truck (C2): a truck is its plate, as at the gate. Same rules as the single
  // checkout — outbound.record for the route, then the manager keys or the solo door.
  app.route({
    method: 'GET',
    url: '/v1/dispatch/trucks',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    handler: async (request, reply) => sendSuccess(reply, await checkout.trucks(request.user!.facilityId)),
  });

  app.route({
    method: 'GET',
    url: '/v1/dispatch/trucks/:id/checkout-preview',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      return sendSuccess(reply, await checkout.truckPreview(request.user!.facilityId, id));
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/dispatch/trucks/:id/dispatch-and-collect',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { params: IdParam, body: TruckDispatchRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await checkout.truckDispatchAndCollect(
        {
          facilityId: request.user!.facilityId,
          userId: request.user!.userId,
          role: request.user!.role,
          permissions: await app.ensurePermissions(request),
        },
        id,
        request.body as z.infer<typeof TruckDispatchRequest>,
      );
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/outbound-events/:id/cancel — a withdrawal that has not left
  // (PENDING/WEIGHED/DISPUTED); frees the bags it held. Same key as booking one.
  app.route({
    method: 'POST',
    url: '/v1/outbound-events/:id/cancel',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
    schema: { params: IdParam, body: CancelOutboundRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof CancelOutboundRequest>;
      const result = await service.cancel(
        request.user!.facilityId,
        id,
        request.user!.userId,
        body.reason,
      );
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/outbound-events/:id/dispatch-note
  app.route({
    method: 'GET',
    url: '/v1/outbound-events/:id/dispatch-note',
    preHandler: [app.authenticate, app.requirePermission('outbound.record')],
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
