import type { FastifyInstance } from 'fastify';
import { LoginRequest, RefreshRequest, ChangePasswordRequest } from '@coldchain/shared';
import type { z } from 'zod';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { UserService } from '../user/user.service';
import { sendSuccess } from '../../common/response';
import { Errors } from '../../common/errors';

export async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(new AuthRepository(app.prisma));
  const userService = new UserService(app.prisma);

  // POST /v1/auth/login
  app.route({
    method: 'POST',
    url: '/v1/auth/login',
    schema: { body: LoginRequest },
    handler: async (request, reply) => {
      const facilityId = request.headers['x-facility-id'] as string | undefined;
      if (!facilityId) {
        throw Errors.VALIDATION_ERROR('X-Facility-ID header is required');
      }
      const body = request.body as { email: string; password: string };
      const result = await service.login(facilityId, body.email, body.password);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/refresh
  app.route({
    method: 'POST',
    url: '/v1/auth/refresh',
    schema: { body: RefreshRequest },
    handler: async (request, reply) => {
      const body = request.body as { refresh_token: string };
      const result = await service.refresh(body.refresh_token);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/logout
  app.route({
    method: 'POST',
    url: '/v1/auth/logout',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      await service.logout(request.user!.userId);
      return sendSuccess(reply, { message: 'Logged out successfully' });
    },
  });

  // GET /v1/auth/me
  app.route({
    method: 'GET',
    url: '/v1/auth/me',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const result = await service.me(request.user!.userId);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/change-password — any authenticated user
  app.route({
    method: 'POST',
    url: '/v1/auth/change-password',
    preHandler: [app.authenticate],
    schema: { body: ChangePasswordRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof ChangePasswordRequest>;
      const result = await userService.changeOwnPassword(
        request.user!.userId,
        body.current_password,
        body.new_password,
      );
      return sendSuccess(reply, result);
    },
  });
}
