import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateEmployeeRequest,
  UpdateEmployeeRequest,
  TerminateEmployeeRequest,
  EmployeeListQuery,
  CreatePayrollRunRequest,
  UpdatePayrollLineRequest,
  PayPayrollRequest,
  RemitGovtRequest,
  PayrollRunListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { assertKatchiWriteAllowed } from '../accounting/book-gate';
import { Errors } from '../../common/errors';
import { JournalEntryService } from '../accounting/journal-entry.service';
import { PeriodLockService } from '../accounting/period-lock.service';
import { EmployeeService } from './employee.service';
import { PayrollRunService } from './payroll-run.service';
import { renderSalarySlip } from '../pdf/pdf.service';

const IdParam = z.object({ id: z.string().uuid() });
const RunLineParam = z.object({ id: z.string().uuid(), lineId: z.string().uuid() });
const FormatQuery = z.object({ format: z.enum(['json', 'pdf']).default('json') });

export async function payrollRoutes(app: FastifyInstance) {
  const periodLock = new PeriodLockService(app.prisma);
  const journalEntry = new JournalEntryService(app.prisma, periodLock);
  const employees = new EmployeeService(app.prisma);
  const runs = new PayrollRunService(app.prisma, journalEntry);

  // ----- Employees -----

  app.route({
    method: 'GET',
    url: '/v1/employees',
    preHandler: [app.authenticate, app.requirePermission('payroll.view')],
    schema: { querystring: EmployeeListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof EmployeeListQuery>;
      const data = await employees.list(request.user!.facilityId, {
        employee_type: q.employee_type,
        is_active: q.is_active,
        page: q.page,
        pageSize: q.page_size,
      });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/employees',
    preHandler: [app.authenticate, app.requirePermission('employees.manage')],
    schema: { body: CreateEmployeeRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateEmployeeRequest>;
      const data = await employees.create(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/employees/:id',
    preHandler: [app.authenticate, app.requirePermission('payroll.view')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await employees.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/employees/:id',
    preHandler: [app.authenticate, app.requirePermission('employees.manage')],
    schema: { params: IdParam, body: UpdateEmployeeRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateEmployeeRequest>;
      const data = await employees.update(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/employees/:id/terminate',
    preHandler: [app.authenticate, app.requirePermission('employees.terminate')],
    schema: { params: IdParam, body: TerminateEmployeeRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof TerminateEmployeeRequest>;
      const data = await employees.terminate(request.user!.facilityId, id, body.termination_date);
      return sendSuccess(reply, data);
    },
  });

  // ----- Payroll runs -----

  app.route({
    method: 'GET',
    url: '/v1/payroll-runs',
    preHandler: [app.authenticate, app.requirePermission('payroll.view')],
    schema: { querystring: PayrollRunListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof PayrollRunListQuery>;
      const data = await runs.list(request.user!.facilityId, {
        ...q,
        pageSize: q.page_size,
      });
      return sendSuccess(reply, data.data, data.meta);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/payroll-runs',
    preHandler: [app.authenticate, app.requirePermission('payroll.draft')],
    schema: { body: CreatePayrollRunRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreatePayrollRunRequest>;
      assertKatchiWriteAllowed(request.user!.role, body.book_type);
      const data = await runs.createDraft(request.user!.facilityId, request.user!.userId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/payroll-runs/:id',
    preHandler: [app.authenticate, app.requirePermission('payroll.view')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await runs.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'PATCH',
    url: '/v1/payroll-runs/:id/lines/:lineId',
    preHandler: [app.authenticate, app.requirePermission('payroll.draft')],
    schema: { params: RunLineParam, body: UpdatePayrollLineRequest },
    handler: async (request, reply) => {
      const { id, lineId } = request.params as z.infer<typeof RunLineParam>;
      const body = request.body as z.infer<typeof UpdatePayrollLineRequest>;
      const data = await runs.updateLine(request.user!.facilityId, id, lineId, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/payroll-runs/:id/finalize',
    preHandler: [app.authenticate, app.requirePermission('payroll.finalize')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await runs.finalize(request.user!.facilityId, request.user!.userId, id);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/payroll-runs/:id/pay',
    preHandler: [app.authenticate, app.requirePermission('payroll.finalize')],
    schema: { params: IdParam, body: PayPayrollRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof PayPayrollRequest>;
      const data = await runs.pay(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply, data);
    },
  });

  app.route({
    method: 'POST',
    url: '/v1/payroll-runs/:id/remit',
    preHandler: [app.authenticate, app.requirePermission('payroll.remit')],
    schema: { params: IdParam, body: RemitGovtRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof RemitGovtRequest>;
      const data = await runs.remit(request.user!.facilityId, request.user!.userId, id, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  app.route({
    method: 'GET',
    url: '/v1/payroll-runs/:id/lines/:lineId/slip',
    preHandler: [app.authenticate, app.requirePermission('payroll.view')],
    schema: { params: RunLineParam, querystring: FormatQuery },
    handler: async (request, reply) => {
      const { id, lineId } = request.params as z.infer<typeof RunLineParam>;
      const { format } = request.query as z.infer<typeof FormatQuery>;
      const data = await runs.getSlipData(request.user!.facilityId, id, lineId);
      if (format === 'pdf') {
        const buf = await renderSalarySlip(data);
        reply
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `inline; filename="${data.runNumber}-${data.employeeName.replace(/\s+/g, '_')}.pdf"`,
          );
        return reply.send(buf);
      }
      return sendSuccess(reply, data);
    },
  });
}
