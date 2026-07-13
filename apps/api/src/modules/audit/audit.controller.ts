import type { FastifyInstance } from 'fastify';
import { AuditLogQuery } from '@coldchain/shared';
import type { z } from 'zod';
import { AuditService } from './audit.service';
import { sendSuccess } from '../../common/response';

export async function auditRoutes(app: FastifyInstance) {
  const service = new AuditService(app.prisma);

  // GET /v1/audit-logs — the facility activity log, filterable + paginated.
  app.route({
    method: 'GET',
    url: '/v1/audit-logs',
    preHandler: [app.authenticate, app.requirePermission('audit.view')],
    schema: { querystring: AuditLogQuery },
    handler: async (request, reply) => {
      const query = request.query as z.infer<typeof AuditLogQuery>;
      const { data, meta } = await service.list(request.user!.facilityId, query);
      return sendSuccess(reply, data, meta);
    },
  });
}
