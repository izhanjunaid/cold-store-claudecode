import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IssuePeshgiRequest,
  RecordRepaymentRequest,
  WriteOffPeshgiRequest,
  PartyLoanListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { PeshgiService } from './peshgi.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function peshgiRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new PeshgiService(app.prisma, journalEntry);

  // GET /v1/loans — ACCOUNTANT+ read access (per docs/07:97)
  app.route({
    method: 'GET',
    url: '/v1/loans',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { querystring: PartyLoanListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof PartyLoanListQuery>;
      const data = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  // POST /v1/loans/issue — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/loans/issue',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { body: IssuePeshgiRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof IssuePeshgiRequest>;
      if (body.book_type === 'KATCHI' && request.user!.role !== 'OWNER') {
        throw Errors.FORBIDDEN('Only OWNER can post KATCHI entries');
      }
      const data = await service.issue(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  // GET /v1/loans/:id
  app.route({
    method: 'GET',
    url: '/v1/loans/:id',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/loans/:id/repayments — MANAGER+ (per docs/07:98 "Record Peshgi Recovery")
  app.route({
    method: 'POST',
    url: '/v1/loans/:id/repayments',
    preHandler: [app.authenticate, requireMinRole('MANAGER')],
    schema: { params: IdParam, body: RecordRepaymentRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof RecordRepaymentRequest>;
      const data = await service.recordRepayment(
        request.user!.facilityId,
        request.user!.userId,
        id,
        body,
      );
      return sendSuccess(reply.status(201), data);
    },
  });

  // POST /v1/loans/:id/write-off — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/loans/:id/write-off',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { params: IdParam, body: WriteOffPeshgiRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof WriteOffPeshgiRequest>;
      const data = await service.writeOff(
        request.user!.facilityId,
        request.user!.userId,
        id,
        body,
      );
      return sendSuccess(reply, data);
    },
  });

  // GET /v1/loans/:id/acknowledgment — JSON acknowledgment (PDF deferred to Phase 11)
  app.route({
    method: 'GET',
    url: '/v1/loans/:id/acknowledgment',
    preHandler: [app.authenticate, requireMinRole('ACCOUNTANT')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const loan = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, {
        loan_number: loan.loan_number,
        party_id: loan.party_id,
        party_name: loan.party_name,
        issue_date: loan.issue_date,
        principal_pkr: loan.principal_pkr,
        source_asset_account_code: loan.source_asset_account_code,
        journal_entry_id: loan.issue_journal_entry_id,
        notes: loan.notes,
        // Note: PDF rendering deferred to Phase 11 polish (mirrors salary-slip).
        format: 'json',
      });
    },
  });
}
