import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import { verifyAccessToken, type JwtPayload } from '../common/jwt';
import { Errors } from '../common/errors';

async function authPlugin(app: FastifyInstance) {
  app.decorateRequest('user', null);

  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw Errors.AUTH_INVALID('Missing or malformed Authorization header');
    }

    try {
      const token = authHeader.slice(7);
      const payload = verifyAccessToken(token);
      request.user = payload;

      // Set user_id in PG session for audit triggers
      await app.prisma.$executeRawUnsafe(
        `SET LOCAL app.user_id = '${payload.userId}'`,
      );
    } catch {
      throw Errors.AUTH_INVALID();
    }
  });

  app.decorate(
    'requireRole',
    (...roles: string[]) =>
      async (request: FastifyRequest, _reply: FastifyReply) => {
        if (!request.user) {
          throw Errors.AUTH_INVALID();
        }
        if (!roles.includes(request.user.role)) {
          throw Errors.FORBIDDEN(`Role ${request.user.role} cannot access this resource`);
        }
      },
  );
}

export default fp(authPlugin);

// Hierarchy: OWNER > MANAGER > ACCOUNTANT > OPERATOR > SECURITY > VIEWER
const ROLE_HIERARCHY: Record<string, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

export function roleAtLeast(role: string | undefined, minRole: string): boolean {
  return (ROLE_HIERARCHY[role ?? ''] ?? 0) >= (ROLE_HIERARCHY[minRole] ?? 0);
}

export function requireMinRole(minRole: string) {
  const minLevel = ROLE_HIERARCHY[minRole] ?? 0;
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.user) {
      throw Errors.AUTH_INVALID();
    }
    const userLevel = ROLE_HIERARCHY[request.user.role] ?? 0;
    if (userLevel < minLevel) {
      throw Errors.FORBIDDEN(`Requires ${minRole} or higher`);
    }
  };
}

// Type augmentation
declare module 'fastify' {
  interface FastifyRequest {
    user: JwtPayload | null;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
