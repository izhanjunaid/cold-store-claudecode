import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { UpdateFacilityRequest, TestEmailRequest } from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { FacilityService } from './facility.service';
import { MailService, mailConfigFromSettings } from '../mail/mail.service';

export async function facilityRoutes(app: FastifyInstance) {
  const service = new FacilityService(app.prisma);
  const mail = app.mailService ?? new MailService();

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
    preHandler: [app.authenticate, app.requirePermission('settings.manage')],
    schema: { body: UpdateFacilityRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof UpdateFacilityRequest>;
      const data = await service.updateFacility(request.user!.facilityId, body);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/facilities/me/test-email — OWNER only. Verifies the configured SMTP
  // settings actually deliver; failures are returned as a result, not an error.
  app.route({
    method: 'POST',
    url: '/v1/facilities/me/test-email',
    preHandler: [app.authenticate, app.requirePermission('settings.manage')],
    schema: { body: TestEmailRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof TestEmailRequest>;
      const row = await app.prisma.facility.findUnique({ where: { id: request.user!.facilityId } });
      const config = row ? mailConfigFromSettings(row.settings) : null;
      if (!row || !config) {
        return sendSuccess(reply, { sent: false, error: 'Email sending is not configured or not enabled.' });
      }
      const to = body.to || config.adminEmail;
      if (!to) {
        return sendSuccess(reply, { sent: false, error: 'No recipient: set an administrator email first.' });
      }
      try {
        await mail.send(config, {
          to,
          subject: 'ColdChain test email',
          template: 'test-email',
          context: { facilityName: row.name, sentAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC' },
        });
        return sendSuccess(reply, { sent: true });
      } catch (err) {
        request.log.warn({ err }, 'test email failed');
        return sendSuccess(reply, { sent: false, error: err instanceof Error ? err.message : 'Send failed' });
      }
    },
  });
}
