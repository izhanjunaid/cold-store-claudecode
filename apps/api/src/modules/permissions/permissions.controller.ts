import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UpdatePermissionsRequest } from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { invalidatePermissionCache } from '../../plugins/permissions';
import { PermissionsService } from './permissions.service';

export async function permissionsRoutes(app: FastifyInstance) {
  const service = new PermissionsService(app.prisma);

  // GET /v1/permissions — the matrix (defaults, overrides, effective per role).
  app.route({
    method: 'GET',
    url: '/v1/permissions',
    preHandler: [app.authenticate, app.requirePermission('permissions.manage')],
    handler: async (request, reply) => {
      const data = await service.get(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  // PUT /v1/permissions — replace the override deltas.
  app.route({
    method: 'PUT',
    url: '/v1/permissions',
    preHandler: [app.authenticate, app.requirePermission('permissions.manage')],
    schema: { body: UpdatePermissionsRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof UpdatePermissionsRequest>;
      const data = await service.update(request.user!.facilityId, body);
      invalidatePermissionCache(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/permissions/reset — clear all overrides (back to defaults).
  app.route({
    method: 'POST',
    url: '/v1/permissions/reset',
    preHandler: [app.authenticate, app.requirePermission('permissions.manage')],
    handler: async (request, reply) => {
      const data = await service.reset(request.user!.facilityId);
      invalidatePermissionCache(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });
}
