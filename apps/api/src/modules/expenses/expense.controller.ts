import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateExpenseVoucherRequest,
  UpdateExpenseVoucherRequest,
  PayExpenseRequest,
  PettyCashReplenishRequest,
  ExpenseVoucherListQuery,
  CancelExpenseRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { ExpenseService } from './expense.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function expenseRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new ExpenseService(app.prisma, journalEntry);

  app.route({
    method: 'GET',
    url: '/v1/expense-vouchers',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: ExpenseVoucherListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof ExpenseVoucherListQuery>;
      const data = await service.list(request.user!.facilityId, { ...q, pageSize: q.page_size });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { body: CreateExpenseVoucherRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateExpenseVoucherRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const data = await service.create(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  // Petty-cash replenish must come BEFORE the :id routes so it isn't shadowed.
  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers/petty-cash-replenish',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { body: PettyCashReplenishRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof PettyCashReplenishRequest>;
      const data = await service.pettyCashReplenish(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/expense-vouchers/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/expense-vouchers/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: UpdateExpenseVoucherRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateExpenseVoucherRequest>;
      const data = await service.update(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers/:id/approve',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.approve(request.user!.facilityId, request.user!.userId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers/:id/accrue',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.accrue(request.user!.facilityId, request.user!.userId, id);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers/:id/pay',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam, body: PayExpenseRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof PayExpenseRequest>;
      const data = await service.pay(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/expense-vouchers/:id/cancel',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: CancelExpenseRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.cancel(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });
}
