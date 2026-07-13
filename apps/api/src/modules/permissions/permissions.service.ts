import type { PrismaClient, Prisma } from '@coldchain/db';
import {
  EDITABLE_ROLES,
  ALL_PERMISSION_KEYS,
  isPermissionKey,
  isAlwaysOwnerKey,
  defaultPermissionsForRole,
  computeEffectivePermissions,
  type PermissionOverrides,
  type PermissionsResponseType,
  type UpdatePermissionsRequestType,
  type Role,
} from '@coldchain/shared';
import { Errors } from '../../common/errors';

function readOverrides(settings: unknown): PermissionOverrides {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  const raw = (settings as Record<string, unknown>)['permissions'];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: PermissionOverrides = {};
  for (const [role, delta] of Object.entries(raw as Record<string, unknown>)) {
    if (!EDITABLE_ROLES.includes(role as Role)) continue;
    const d = (delta ?? {}) as { grant?: unknown; revoke?: unknown };
    out[role as Role] = {
      grant: Array.isArray(d.grant) ? d.grant.filter((x): x is string => typeof x === 'string') : [],
      revoke: Array.isArray(d.revoke) ? d.revoke.filter((x): x is string => typeof x === 'string') : [],
    };
  }
  return out;
}

function buildResponse(overrides: PermissionOverrides): PermissionsResponseType {
  const defaults: Record<string, string[]> = {};
  const effective: Record<string, string[]> = {};
  for (const role of ['OWNER', ...EDITABLE_ROLES] as Role[]) {
    defaults[role] = defaultPermissionsForRole(role);
    effective[role] = computeEffectivePermissions(role, overrides);
  }
  return { defaults, overrides, effective };
}

export class PermissionsService {
  constructor(private prisma: PrismaClient) {}

  async get(facilityId: string): Promise<PermissionsResponseType> {
    const facility = await this.prisma.facility.findUnique({
      where: { id: facilityId },
      select: { settings: true },
    });
    if (!facility) throw Errors.AUTH_INVALID('Facility not found');
    return buildResponse(readOverrides(facility.settings));
  }

  async update(
    facilityId: string,
    body: UpdatePermissionsRequestType,
  ): Promise<PermissionsResponseType> {
    // Validate: known keys, no OWNER row, no alwaysOwner key in any delta.
    const clean: PermissionOverrides = {};
    for (const [role, delta] of Object.entries(body.overrides)) {
      if (!EDITABLE_ROLES.includes(role as Role)) {
        throw Errors.VALIDATION_ERROR(`Role ${role} is not editable`);
      }
      const grant = delta?.grant ?? [];
      const revoke = delta?.revoke ?? [];
      for (const key of [...grant, ...revoke]) {
        if (!isPermissionKey(key)) throw Errors.VALIDATION_ERROR(`Unknown permission: ${key}`);
      }
      for (const key of grant) {
        if (isAlwaysOwnerKey(key)) {
          throw Errors.VALIDATION_ERROR(`Permission ${key} is reserved for OWNER and cannot be granted`);
        }
      }
      clean[role as Role] = { grant: [...new Set(grant)], revoke: [...new Set(revoke)] };
    }

    await this.writePermissions(facilityId, clean);
    return buildResponse(clean);
  }

  async reset(facilityId: string): Promise<PermissionsResponseType> {
    await this.writePermissions(facilityId, {});
    return buildResponse({});
  }

  // Merge the permissions key into the settings JSON without disturbing other
  // keys. Runs in an interactive transaction so the facilities audit trigger
  // attributes the change to the acting user (app.user_id GUC).
  private async writePermissions(facilityId: string, overrides: PermissionOverrides): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const facility = await tx.facility.findUnique({
        where: { id: facilityId },
        select: { settings: true },
      });
      if (!facility) throw Errors.AUTH_INVALID('Facility not found');
      const current =
        facility.settings && typeof facility.settings === 'object' && !Array.isArray(facility.settings)
          ? (facility.settings as Record<string, unknown>)
          : {};
      const nextSettings = { ...current, permissions: overrides };
      await tx.facility.update({
        where: { id: facilityId },
        data: { settings: nextSettings as unknown as Prisma.InputJsonValue },
      });
    });
  }
}

export { ALL_PERMISSION_KEYS };
