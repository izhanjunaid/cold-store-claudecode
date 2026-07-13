import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  CreateUserRequest,
  UpdateUserRequest,
  ResetPasswordRequest,
  UserListQuery,
} from '@coldchain/shared';
import { sendSuccess } from '../../common/response';
import { UserService } from './user.service';

const IdParam = z.object({ id: z.string().uuid() });

export async function userRoutes(app: FastifyInstance) {
  const service = new UserService(app.prisma);

  // GET /v1/users — OWNER only
  app.route({
    method: 'GET',
    url: '/v1/users',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    schema: { querystring: UserListQuery },
    handler: async (request, reply) => {
      const q = request.query as z.infer<typeof UserListQuery>;
      const result = await service.list(request.user!.facilityId, q);
      return sendSuccess(reply, result.data, result.meta);
    },
  });

  // GET /v1/users/:id — OWNER only
  app.route({
    method: 'GET',
    url: '/v1/users/:id',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    schema: { params: IdParam },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const data = await service.getById(request.user!.facilityId, id);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/users — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/users',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    schema: { body: CreateUserRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof CreateUserRequest>;
      const data = await service.create(request.user!.facilityId, body);
      return sendSuccess(reply.status(201), data);
    },
  });

  // PATCH /v1/users/:id — OWNER only
  app.route({
    method: 'PATCH',
    url: '/v1/users/:id',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    schema: { params: IdParam, body: UpdateUserRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof UpdateUserRequest>;
      const data = await service.update(request.user!.facilityId, id, body);
      return sendSuccess(reply, data);
    },
  });

  // POST /v1/users/:id/reset-password — OWNER only
  app.route({
    method: 'POST',
    url: '/v1/users/:id/reset-password',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    schema: { params: IdParam, body: ResetPasswordRequest },
    handler: async (request, reply) => {
      const { id } = request.params as z.infer<typeof IdParam>;
      const body = request.body as z.infer<typeof ResetPasswordRequest>;
      const data = await service.resetPassword(request.user!.facilityId, id, body.new_password);
      return sendSuccess(reply, data);
    },
  });
}
