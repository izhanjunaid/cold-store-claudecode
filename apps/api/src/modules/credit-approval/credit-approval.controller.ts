import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CreateCreditApprovalRequest, RevokeCreditApprovalRequest } from '@coldchain/shared';
import { CreditApprovalService } from './credit-approval.service';
import { sendSuccess } from '../../common/response';

const IdParam = z.object({ id: z.string().uuid() });

/** Standing credit approvals (fast-dispatch Phase C1a). Granting and revoking are `parties.credit_terms`. */
export async function creditApprovalRoutes(app: FastifyInstance) {
  const service = new CreditApprovalService(app.prisma);

  // GET /v1/parties/:id/credit-approval — anyone signed in sees whether credit is approved;
  // the ceiling and the note only go to holders of parties.credit_terms.
  app.route({
    method: 'GET',
    url: '/v1/parties/:id/credit-approval',
    preHandler: [app.authenticate],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const canSee = (await app.ensurePermissions(request)).has('parties.credit_terms');
      return sendSuccess(reply, await service.get(request.user!.facilityId, id, canSee));
    },
  });

  // POST /v1/parties/:id/credit-approval
  app.route({
    method: 'POST',
    url: '/v1/parties/:id/credit-approval',
    preHandler: [app.authenticate, app.requirePermission('parties.credit_terms')],
    schema: { params: IdParam, body: CreateCreditApprovalRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof CreateCreditApprovalRequest>;
      const result = await service.grant(request.user!.facilityId, id, request.user!.userId, body);
      return sendSuccess(reply.status(201), result);
    },
  });

  // POST /v1/parties/:id/credit-approval/revoke
  app.route({
    method: 'POST',
    url: '/v1/parties/:id/credit-approval/revoke',
    preHandler: [app.authenticate, app.requirePermission('parties.credit_terms')],
    schema: { params: IdParam, body: RevokeCreditApprovalRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof RevokeCreditApprovalRequest>;
      return sendSuccess(reply, await service.revoke(request.user!.facilityId, id, request.user!.userId, body.reason));
    },
  });
}
