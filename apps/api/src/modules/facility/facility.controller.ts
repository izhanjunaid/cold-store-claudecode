import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UpdateFacilityRequest } from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { requireMinRole } from '../../plugins/auth';
import { FacilityService } from './facility.service';

export async function facilityRoutes(app: FastifyInstance) {
  const service = new FacilityService(app.prisma);

  // GET /v1/facilities/me — any authenticated user
  app.route({
    method: 'GET',
    url: '/v1/facilities/me',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const data = await service.getFacility(request.user!.facilityId);
      return sendSuccess(reply, data);
    },
  });

  // PATCH /v1/facilities/me — OWNER only
  app.route({
    method: 'PATCH',
    url: '/v1/facilities/me',
    preHandler: [app.authenticate, requireMinRole('OWNER')],
    schema: { body: UpdateFacilityRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof UpdateFacilityRequest>;
      const data = await service.updateFacility(request.user!.facilityId, body);
      return sendSuccess(reply, data);
    },
  });
}
