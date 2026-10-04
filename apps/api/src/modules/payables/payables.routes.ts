import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AllocateSupplierPaymentRequest,
  BillListQuery,
  BillRequest,
  CreateSupplierPaymentRequest,
  PayablesAgingQuery,
  PostBillRequest,
  SupplierPaymentListQuery,
  SupplierStatementQuery,
  VoidDocumentRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { resolveBookTypeForRead } from '../accounting/book-gate';
import type { JournalEntryService } from '../accounting/journal-entry.service';
import { BillService } from './bill.service';
import { PayablesReportService } from './payables-report.service';
import { SupplierPaymentService } from './supplier-payment.service';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * Accounts payable (docs/25 Q3). Recording bills and payments needs `expenses.record`;
 * posting a bill into the books and voiding either needs `expenses.approve` — the same
 * split the expense voucher's approve step had.
 */
export async function payablesRoutes(app: FastifyInstance, journal: JournalEntryService) {
  const payments = new SupplierPaymentService(app.prisma, journal);
  const bills = new BillService(app.prisma, journal, payments);
  const reports = new PayablesReportService(app.prisma);

  const record = [app.authenticate, app.requirePermission('expenses.record')];
  const approve = [app.authenticate, app.requirePermission('expenses.approve')];

  // ---------------------------------------------------------------- bills
  app.get('/v1/bills', { preHandler: record, schema: { querystring: BillListQuery } }, async (request, reply) => {
    const q = request.query as z.infer<typeof BillListQuery>;
    const result = await bills.list(request.user!.facilityId, resolveBookTypeForRead(request.user!.role, q.book_type), q);
    return sendSuccess(reply, result.data, result.meta);
  });

  app.get('/v1/bills/:id', { preHandler: record, schema: { params: IdParam } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    return sendSuccess(reply, await bills.getById(request.user!.facilityId, id));
  });

  app.post('/v1/bills', { preHandler: record, schema: { body: BillRequest } }, async (request, reply) => {
    const u = request.user!;
    const data = await bills.create(u.facilityId, u.userId, u.role, request.body as z.infer<typeof BillRequest>);
    return sendSuccess(reply.status(201), data);
  });

  app.patch('/v1/bills/:id', { preHandler: record, schema: { params: IdParam, body: BillRequest } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    const u = request.user!;
    return sendSuccess(reply, await bills.update(u.facilityId, u.role, id, request.body as z.infer<typeof BillRequest>));
  });

  app.delete('/v1/bills/:id', { preHandler: record, schema: { params: IdParam } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    return sendSuccess(reply, await bills.remove(request.user!.facilityId, request.user!.role, id));
  });

  app.post('/v1/bills/:id/post', { preHandler: approve, schema: { params: IdParam, body: PostBillRequest } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    const u = request.user!;
    return sendSuccess(reply, await bills.post(u.facilityId, u.userId, u.role, id, request.body as z.infer<typeof PostBillRequest>));
  });

  app.post('/v1/bills/:id/void', { preHandler: approve, schema: { params: IdParam, body: VoidDocumentRequest } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    const u = request.user!;
    return sendSuccess(reply, await bills.void(u.facilityId, u.userId, u.role, id, request.body as z.infer<typeof VoidDocumentRequest>));
  });

  // ---------------------------------------------------------------- supplier payments
  app.get('/v1/supplier-payments', { preHandler: record, schema: { querystring: SupplierPaymentListQuery } }, async (request, reply) => {
    const q = request.query as z.infer<typeof SupplierPaymentListQuery>;
    const result = await payments.list(request.user!.facilityId, resolveBookTypeForRead(request.user!.role, q.book_type), q);
    return sendSuccess(reply, result.data, result.meta);
  });

  app.get('/v1/supplier-payments/:id', { preHandler: record, schema: { params: IdParam } }, async (request, reply) => {
    const { id } = request.params as z.infer<typeof IdParam>;
    return sendSuccess(reply, await payments.getById(request.user!.facilityId, id));
  });

  app.post('/v1/supplier-payments', { preHandler: record, schema: { body: CreateSupplierPaymentRequest } }, async (request, reply) => {
    const u = request.user!;
    const data = await payments.create(u.facilityId, u.userId, u.role, request.body as z.infer<typeof CreateSupplierPaymentRequest>);
    return sendSuccess(reply.status(201), data);
  });

  app.post(
    '/v1/supplier-payments/:id/allocate',
    { preHandler: record, schema: { params: IdParam, body: AllocateSupplierPaymentRequest } },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const u = request.user!;
      return sendSuccess(reply, await payments.allocate(u.facilityId, u.role, id, request.body as z.infer<typeof AllocateSupplierPaymentRequest>));
    },
  );

  app.post(
    '/v1/supplier-payments/:id/void',
    { preHandler: approve, schema: { params: IdParam, body: VoidDocumentRequest } },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const u = request.user!;
      return sendSuccess(reply, await payments.void(u.facilityId, u.userId, u.role, id, request.body as z.infer<typeof VoidDocumentRequest>));
    },
  );

  // ---------------------------------------------------------------- read model
  const financial = [app.authenticate, app.requirePermission('reports.financial')];

  app.get('/v1/payables/aging', { preHandler: financial, schema: { querystring: PayablesAgingQuery } }, async (request, reply) => {
    const q = request.query as z.infer<typeof PayablesAgingQuery>;
    return sendSuccess(reply, await reports.aging(request.user!.facilityId, resolveBookTypeForRead(request.user!.role, q.book_type)));
  });

  app.get(
    '/v1/payables/suppliers/:id/statement',
    { preHandler: financial, schema: { params: IdParam, querystring: SupplierStatementQuery } },
    async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const q = request.query as z.infer<typeof SupplierStatementQuery>;
      const book = resolveBookTypeForRead(request.user!.role, q.book_type);
      return sendSuccess(reply, await reports.statement(request.user!.facilityId, id, book, q));
    },
  );
}
