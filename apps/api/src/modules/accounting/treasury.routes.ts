import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CashTransferListQuery,
  CreateCashTransferRequest,
  RemitWithholdingRequest,
  VoidDocumentRequest,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { resolveBookTypeForRead } from './book-gate';
import { CashTransferService } from './cash-transfer.service';
import { JournalEntryService } from './journal-entry.service';
import { PeriodLockService } from './period-lock.service';
import { WithholdingRemittanceService } from './withholding-remittance.service';
import { payablesRoutes } from '../payables/payables.routes';

const IdParam = z.object({ id: z.string().uuid() });

/**
 * Money leaving or moving between the facility's own accounts: supplier bills and
 * payments, statutory remittances and cash/bank transfers (docs/25 Stream C-b).
 * Payables live in their own module and are registered from here, so the module
 * needs no line of its own in app.ts and the test app.
 */
export async function treasuryRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const withholdingRemittance = new WithholdingRemittanceService(app.prisma, journalEntry);
  const cashTransfers = new CashTransferService(app.prisma, journalEntry);

  await payablesRoutes(app, journalEntry);

  // ==========================================================
  // WITHHOLDING TAX REMITTANCE (JE-29)
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/accounting/withholding-remittance',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: RemitWithholdingRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof RemitWithholdingRequest>;
      const data = await withholdingRemittance.remit(
        request.user!.facilityId,
        request.user!.userId,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  // ==========================================================
  // CASH / BANK TRANSFERS (docs/25 C-44)
  // ==========================================================

  app.route({
    method: 'GET',
    url: '/v1/accounting/cash-transfers',
    preHandler: [app.authenticate, app.requirePermission('accounting.view')],
    schema: { querystring: CashTransferListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof CashTransferListQuery>;
      const book = resolveBookTypeForRead(request.user!.role, q.book_type);
      const result = await cashTransfers.list(request.user!.facilityId, book, q);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/cash-transfers',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: CreateCashTransferRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateCashTransferRequest>;
      const data = await cashTransfers.create(request.user!.facilityId, request.user!.userId, request.user!.role, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/accounting/cash-transfers/:id/void',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { params: IdParam, body: VoidDocumentRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof VoidDocumentRequest>;
      const data = await cashTransfers.void(request.user!.facilityId, request.user!.userId, request.user!.role, id, body);
      return sendSuccess(reply, data);
    },
  });
}
