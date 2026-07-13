import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fp from 'fastify-plugin';
import {
  computeEffectivePermissions,
  type PermissionOverrides,
  type Role,
} from '@coldchain/shared';
import { Errors } from '../common/errors';

// Per-facility cache of the stored permission overrides. Small and short-lived
// (60s): the matrix rarely changes and is explicitly invalidated on write, so
// enforcement is at most one DB read per facility per minute.
const CACHE_TTL_MS = 60_000;
const overridesCache = new Map<string, { expires: number; overrides: PermissionOverrides }>();

export function invalidatePermissionCache(facilityId: string): void {
  overridesCache.delete(facilityId);
}

/** Read + coerce facility.settings.permissions into a PermissionOverrides map. */
function readOverridesFromSettings(settings: unknown): PermissionOverrides {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const raw = (settings as Record<string, unknown>)['permissions'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PermissionOverrides = {};
  for (const [role, delta] of Object.entries(raw as Record<string, unknown>)) {
    if (!delta || typeof delta !== 'object') continue;
    const d = delta as { grant?: unknown; revoke?: unknown };
    out[role as Role] = {
      grant: Array.isArray(d.grant) ? d.grant.filter((x): x is string => typeof x === 'string') : [],
      revoke: Array.isArray(d.revoke) ? d.revoke.filter((x): x is string => typeof x === 'string') : [],
    };
  }
  return out;
}

async function loadOverrides(app: FastifyInstance, facilityId: string): Promise<PermissionOverrides> {
  const cached = overridesCache.get(facilityId);
  if (cached && cached.expires > Date.now()) return cached.overrides;
  const facility = await app.prisma.facility.findUnique({
    where: { id: facilityId },
    select: { settings: true },
  });
  const overrides = readOverridesFromSettings(facility?.settings);
  overridesCache.set(facilityId, { expires: Date.now() + CACHE_TTL_MS, overrides });
  return overrides;
}

async function permissionsPlugin(app: FastifyInstance) {
  app.decorateRequest('permissions', null);

  // Effective permission keys for a (facility, role) — OWNER short-circuits to all.
  app.decorate('getEffectivePermissions', async (facilityId: string, role: string): Promise<string[]> => {
    if (role === 'OWNER') return computeEffectivePermissions('OWNER');
    const overrides = await loadOverrides(app, facilityId);
    return computeEffectivePermissions(role as Role, overrides);
  });

  // Populate request.permissions once per request (idempotent).
  app.decorate('ensurePermissions', async (request: FastifyRequest): Promise<Set<string>> => {
    if (request.permissions) return request.permissions;
    if (!request.user) throw Errors.AUTH_INVALID();
    const keys = await app.getEffectivePermissions(request.user.facilityId, request.user.role);
    request.permissions = new Set(keys);
    return request.permissions;
  });

  // preHandler factory: require a specific permission key.
  app.decorate('requirePermission', (key: string) => {
    return async (request: FastifyRequest, _reply: FastifyReply) => {
      if (!request.user) throw Errors.AUTH_INVALID();
      const perms = await app.ensurePermissions(request);
      if (!perms.has(key)) {
        throw Errors.FORBIDDEN(`Missing permission: ${key}`);
      }
    };
  });
}

export default fp(permissionsPlugin);

declare module 'fastify' {
  interface FastifyRequest {
    permissions: Set<string> | null;
  }
  interface FastifyInstance {
    getEffectivePermissions: (facilityId: string, role: string) => Promise<string[]>;
    ensurePermissions: (request: FastifyRequest) => Promise<Set<string>>;
    requirePermission: (key: string) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
