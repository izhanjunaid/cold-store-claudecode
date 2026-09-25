import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { CreateCashTransferRequest, RemitWithholdingRequest } from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { Errors } from '../../common/errors';
import { assertKatchiWriteAllowed } from './book-gate';
import { JournalEntryService } from './journal-entry.service';
import { PeriodLockService } from './period-lock.service';
import { WithholdingRemittanceService } from './withholding-remittance.service';
import { buildJE27CashTransfer, CASH_TRANSFER_ACCOUNTS } from './templates/je-27-cash-transfer';

/**
 * Money leaving or moving between the facility's own accounts: withholding tax
 * paid over and cash/bank transfers (docs/25 Stream C-b).
 */
export async function treasuryRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const withholdingRemittance = new WithholdingRemittanceService(app.prisma, journalEntry);

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
  // CASH / BANK TRANSFER (JE-27)
  // ==========================================================

  app.route({
    method: 'POST',
    url: '/v1/accounting/cash-transfers',
    preHandler: [app.authenticate, app.requirePermission('accounting.post_journal')],
    schema: { body: CreateCashTransferRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateCashTransferRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);

      const allowed = CASH_TRANSFER_ACCOUNTS as readonly string[];
      for (const [field, code] of [
        ['from_account_code', body.from_account_code],
        ['to_account_code', body.to_account_code],
      ] as const) {
        if (!allowed.includes(code)) {
          throw Errors.VALIDATION_ERROR(
            `A transfer may only move money between cash and bank accounts (${allowed.join(', ')}).`,
            field,
          );
        }
      }
      if (body.from_account_code === body.to_account_code) {
        throw Errors.VALIDATION_ERROR(
          'The source and destination must be different accounts.',
          'to_account_code',
        );
      }

      const posted = await journalEntry.post(
        request.user!.facilityId,
        request.user!.userId,
        buildJE27CashTransfer({
          transferDate: new Date(body.transfer_date),
          amountPkr: body.amount_pkr,
          fromAccountCode: body.from_account_code,
          toAccountCode: body.to_account_code,
          bookType: body.book_type,
          userId: request.user!.userId,
          note: body.note,
        }),
        { postingStatus: 'POSTED' },
      );
      const full = await journalEntry.getById(request.user!.facilityId, posted.id);
      return sendSuccess(reply.status(201), full);
    },
  });

}
