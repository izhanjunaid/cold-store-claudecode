import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  IssueEmployeeAdvanceRequest,
  WriteOffEmployeeAdvanceRequest,
  EmployeeAdvanceListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { EmployeeAdvanceService } from './employee-advance.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function employeeAdvanceRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const service = new EmployeeAdvanceService(app.prisma, journalEntry);

  // GET /v1/employee-advances
  app.route({
    method: 'GET',
    url: '/v1/employee-advances',
    preHandler: [app.authenticate, app.requirePermission('employee_advances.view')],
    schema: { querystring: EmployeeAdvanceListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof EmployeeAdvanceListQuery>;
      const data = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  // POST /v1/employee-advances/issue — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/employee-advances/issue',
    preHandler: [app.authenticate, app.requirePermission('employee_advances.issue')],
    schema: { body: IssueEmployeeAdvanceRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof IssueEmployeeAdvanceRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const data = await service.issue(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  // GET /v1/employee-advances/:id
  app.route({
    method: 'GET',
    url: '/v1/employee-advances/:id',
    preHandler: [app.authenticate, app.requirePermission('employee_advances.view')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/employee-advances/:id/write-off — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/employee-advances/:id/write-off',
    preHandler: [app.authenticate, app.requirePermission('employee_advances.write_off')],
    schema: { params: IdParam, body: WriteOffEmployeeAdvanceRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof WriteOffEmployeeAdvanceRequest>;
      const data = await service.writeOff(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply, data);
    },
  });
}
