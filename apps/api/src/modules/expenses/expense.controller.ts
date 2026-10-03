import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CancelExpenseRequest, ConvertExpenseVoucherRequest, ExpenseVoucherListQuery } from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { AppError } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { ExpenseService } from './expense.service';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * Legacy expense vouchers (docs/25 C-03): read, cancel, convert to a bill. Costs are
 * recorded as supplier bills; creating a voucher is refused with a pointer there.
 */
export async function expenseRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new ExpenseService(app.prisma, journalEntry);

  app.get(
    '/v1/expense-vouchers',
    { preHandler: [app.authenticate, app.requirePermission('expenses.record')], schema: { querystring: ExpenseVoucherListQuery } },
    async (request, reply) => {
      const q = request.query as z.infer<typeof ExpenseVoucherListQuery>;
      const data = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  );

  app.post('/v1/expense-vouchers', { preHandler: [app.authenticate, app.requirePermission('expenses.record')] }, async () => {
    throw new AppError(
      'EXPENSE_VOUCHERS_RETIRED',
      'Expense vouchers are retired. Record the cost as a supplier bill (Payables → Bills).',
      410,
    );
  });

  app.get(
    '/v1/expense-vouchers/:id',
    { preHandler: [app.authenticate, app.requirePermission('expenses.record')], schema: { params: IdParam } },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      return sendSuccess(reply, await service.getById(request.user!.facilityId, id));
    },
  );

  app.post(
    '/v1/expense-vouchers/:id/cancel',
    {
      preHandler: [app.authenticate, app.requirePermission('expenses.approve')],
      schema: { params: IdParam, body: CancelExpenseRequest },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      return sendSuccess(reply, await service.cancel(request.user!.facilityId, request.user!.role, id));
    },
  );

  app.post(
    '/v1/expense-vouchers/:id/convert-to-bill',
    {
      preHandler: [app.authenticate, app.requirePermission('expenses.approve')],
      schema: { params: IdParam, body: ConvertExpenseVoucherRequest },
    },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const u = request.user!;
      const data = await service.convertToBill(
        u.facilityId,
        u.userId,
        u.role,
        id,
        request.body as z.infer<typeof ConvertExpenseVoucherRequest>,
      );
      return sendSuccess(reply, data);
    },
  );
}
