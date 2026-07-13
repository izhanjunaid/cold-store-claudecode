import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  LoginRequest,
  RefreshRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  ResetPasswordWithOtpRequest,
  Verify2faRequest,
  Enable2faRequest,
  Disable2faRequest,
} from '@coldchain/shared';
import type { z } from 'zod';
import { AuthService } from './auth.service';
import { AuthRepository } from './auth.repository';
import { OtpService } from './otp.service';
import { UserService } from '../user/user.service';
import { sendSuccess } from '../../common/response';
import { Errors } from '../../common/errors';

// Neutral response for both steps of the reset flow — never reveals whether
// an account exists or whether an email actually went out.
const FORGOT_PASSWORD_MESSAGE = 'If an account with that email exists, a code has been sent.';

// Device context recorded against the session (refresh-token row) at issue time.
function sessionMeta(request: FastifyRequest): { userAgent: string | null; ip: string | null } {
  const ua = request.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null, ip: request.ip };
}

// Enrich a login/2FA success result with the user's effective permissions so
// the web app can gate nav/pages from a single source. 2FA-pending results
// (no user) pass through untouched.
async function withPermissions<T extends object>(app: FastifyInstance, result: T): Promise<T> {
  if (!('user' in result) || !result.user) return result;
  const user = result.user as { facility_id: string; role: string };
  const permissions = await app.getEffectivePermissions(user.facility_id, user.role);
  return { ...result, user: { ...user, permissions } };
}

export async function authRoutes(app: FastifyInstance) {
  const service = new AuthService(
    new AuthRepository(app.prisma),
    app.prisma,
    new OtpService(app.prisma),
    app.mailService,
  );
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
      const result = await service.login(facilityId, body.email, body.password, sessionMeta(request));
      return sendSuccess(reply, await withPermissions(app, result));
    },
  });

  // POST /v1/auth/forgot-password — public, tightly rate-limited.
  app.route({
    method: 'POST',
    url: '/v1/auth/forgot-password',
    schema: { body: ForgotPasswordRequest },
    config: { rateLimit: { max: 3, timeWindow: '15 minutes' } },
    handler: async (request, reply) => {
      const facilityId = request.headers['x-facility-id'] as string | undefined;
      if (!facilityId) {
        throw Errors.VALIDATION_ERROR('X-Facility-ID header is required');
      }
      const body = request.body as z.infer<typeof ForgotPasswordRequest>;
      const result = await service.forgotPassword(facilityId, body.email, request.ip);
      request.log.info({ email: body.email, sent: result.sent }, 'forgot-password request');
      return sendSuccess(reply, { message: FORGOT_PASSWORD_MESSAGE });
    },
  });

  // POST /v1/auth/reset-password — public, tightly rate-limited.
  app.route({
    method: 'POST',
    url: '/v1/auth/reset-password',
    schema: { body: ResetPasswordWithOtpRequest },
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
    handler: async (request, reply) => {
      const facilityId = request.headers['x-facility-id'] as string | undefined;
      if (!facilityId) {
        throw Errors.VALIDATION_ERROR('X-Facility-ID header is required');
      }
      const body = request.body as z.infer<typeof ResetPasswordWithOtpRequest>;
      const result = await service.resetPassword(facilityId, body.email, body.code, body.new_password);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/login/verify-2fa — public, completes a pending 2FA login.
  app.route({
    method: 'POST',
    url: '/v1/auth/login/verify-2fa',
    schema: { body: Verify2faRequest },
    config: { rateLimit: { max: 5, timeWindow: '5 minutes' } },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof Verify2faRequest>;
      const result = await service.verify2fa(body.pending_token, body.code, sessionMeta(request));
      return sendSuccess(reply, await withPermissions(app, result));
    },
  });

  // POST /v1/auth/2fa/request-enable — emails a code to the caller's own address.
  app.route({
    method: 'POST',
    url: '/v1/auth/2fa/request-enable',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const result = await service.request2faEnable(request.user!.userId);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/2fa/enable — verify the code, switch 2FA on.
  app.route({
    method: 'POST',
    url: '/v1/auth/2fa/enable',
    preHandler: [app.authenticate],
    schema: { body: Enable2faRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof Enable2faRequest>;
      const result = await service.enable2fa(request.user!.userId, body.code);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/2fa/disable — confirm password, switch 2FA off.
  app.route({
    method: 'POST',
    url: '/v1/auth/2fa/disable',
    preHandler: [app.authenticate],
    schema: { body: Disable2faRequest },
    handler: async (request, reply) => {
      const body = request.body as z.infer<typeof Disable2faRequest>;
      const result = await service.disable2fa(request.user!.userId, body.password);
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
      const result = await service.refresh(body.refresh_token, sessionMeta(request));
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
      const permissions = await app.getEffectivePermissions(result.facility_id, result.role);
      return sendSuccess(reply, { ...result, permissions });
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

  // GET /v1/auth/sessions — the caller's own active sessions.
  app.route({
    method: 'GET',
    url: '/v1/auth/sessions',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const result = await service.listSessions(request.user!.userId, request.user!.sid);
      return sendSuccess(reply, result);
    },
  });

  // DELETE /v1/auth/sessions/:id — sign out one of the caller's own sessions.
  app.route({
    method: 'DELETE',
    url: '/v1/auth/sessions/:id',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await service.revokeSession(request.user!.userId, id);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/auth/sessions/revoke-others — sign out every other device.
  app.route({
    method: 'POST',
    url: '/v1/auth/sessions/revoke-others',
    preHandler: [app.authenticate],
    handler: async (request, reply) => {
      const result = await service.revokeOtherSessions(request.user!.userId, request.user!.sid);
      return sendSuccess(reply, result);
    },
  });

  // GET /v1/users/:id/sessions — admin view of another user's sessions.
  app.route({
    method: 'GET',
    url: '/v1/users/:id/sessions',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await service.listUserSessions(id);
      return sendSuccess(reply, result);
    },
  });

  // POST /v1/users/:id/sessions/revoke-all — admin force sign-out.
  app.route({
    method: 'POST',
    url: '/v1/users/:id/sessions/revoke-all',
    preHandler: [app.authenticate, app.requirePermission('users.manage')],
    handler: async (request, reply) => {
      const { id } = request.params as { id: string };
      const result = await service.revokeAllSessions(id);
      return sendSuccess(reply, result);
    },
  });
}
