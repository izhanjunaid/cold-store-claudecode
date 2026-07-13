import type { FastifyInstance } from 'fastify';
import { DigestService } from './digest.service';
import { sendSuccess } from '../../common/response';

export async function notificationRoutes(app: FastifyInstance) {
  const digest = new DigestService(app.prisma, app.mailService);

  // POST /v1/notifications/digest/send-now — send the daily digest immediately
  // (the "Send now" button + a test hook). Guarded like the settings that own it.
  app.route({
    method: 'POST',
    url: '/v1/notifications/digest/send-now',
    preHandler: [app.authenticate, app.requirePermission('settings.manage')],
    handler: async (request, reply) => {
      const result = await digest.sendNow(request.user!.facilityId);
      return sendSuccess(reply, result);
    },
  });
}
