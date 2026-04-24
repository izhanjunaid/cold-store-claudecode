import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreatePaymentRequest,
  AllocatePaymentRequest,
  DishonourPaymentRequest,
  PaymentListQuery,
} from '@coldchain/shared';
import { PaymentService } from './payment.service';
import { PaymentRepository } from './payment.repository';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';

const IdParam = z.object({ id: z.string().uuid() });
const PartyIdParam = z.object({ partyId: z.string().uuid() });

export async function paymentRoutes(app: FastifyInstance) {
  const service = new PaymentService(app.prisma, new PaymentRepository(app.prisma));

  // POST /v1/payments — ACCOUNTANT+
  app.route({
    method: 'POST',
    url: '/v1/payments',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { body: CreatePaymentRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreatePaymentRequest>;
      const result = await service.record({
        facilityId: request.user!.facilityId,
        createdBy: request.user!.userId,
        partyId: body.party_id,
        paymentDate: body.payment_date,
        amountPkr: body.amount_pkr,
        paymentMethod: body.payment_method,
        referenceNumber: body.reference_number,
        isAdvance: body.is_advance,
        chequeDate: body.cheque_date,
        bookType: body.book_type,
        notes: body.notes,
        allocations: body.allocations,
      });
      return sendSuccess(reply.status(201), result);
    },
  });

  // GET /v1/payments — ACCOUNTANT+
  app.route({
    method: 'GET',
    url: '/v1/payments',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: PaymentListQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof PaymentListQuery>;
      const result = await service.list(request.user!.facilityId, {
        partyId: query.party_id,
        status: query.status,
        paymentMethod: query.payment_method,
        dateFrom: query.date_from,
        dateTo: query.date_to,
        page: query.page,
        pageSize: query.page_size,
      });
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // GET /v1/payments/:id — ACCOUNTANT+
  app.route({
    method: 'GET',
    url: '/v1/payments/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const result = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/payments/:id/allocate — ACCOUNTANT+
  app.route({
    method: 'POST',
    url: '/v1/payments/:id/allocate',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: AllocatePaymentRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof AllocatePaymentRequest>;
      const result = await service.allocate(request.user!.facilityId, id, body.allocations);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/payments/:id/dishonour — ACCOUNTANT+
  app.route({
    method: 'POST',
    url: '/v1/payments/:id/dishonour',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: DishonourPaymentRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof DishonourPaymentRequest>;
      const result = await service.dishonour(request.user!.facilityId, id, body.notes);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/parties/:partyId/ledger — ACCOUNTANT+
  app.route({
    method: 'GET',
    url: '/v1/parties/:partyId/ledger',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: PartyIdParam },
    handler: async (request, reply) => {
      const { partyId } = request.params as z.infer<typeof PartyIdParam>;
      const result = await service.getPartyLedger(request.user!.facilityId, partyId);
      return sendSuccess(reply, result);
    },
  });
}
