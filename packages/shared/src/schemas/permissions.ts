import { z } from 'zod';
import { ALL_PERMISSION_KEYS, EDITABLE_ROLES } from '../permissions';

export const PermissionKey = z.enum(ALL_PERMISSION_KEYS as [string, ...string[]]);

const EditableRoleEnum = z.enum(EDITABLE_ROLES as unknown as [string, ...string[]]);

export const RoleDeltaSchema = z.object({
  grant: z.array(PermissionKey).default([]),
  revoke: z.array(PermissionKey).default([]),
});
export type RoleDeltaType = z.infer<typeof RoleDeltaSchema>;

export const PermissionOverridesSchema = z.record(EditableRoleEnum, RoleDeltaSchema);
export type PermissionOverridesType = z.infer<typeof PermissionOverridesSchema>;

export const UpdatePermissionsRequest = z.object({
  overrides: PermissionOverridesSchema,
});
export type UpdatePermissionsRequestType = z.infer<typeof UpdatePermissionsRequest>;

// Per-role arrays of effective / default permission keys.
const RoleKeyMap = z.record(z.string(), z.array(z.string()));

export const PermissionsResponse = z.object({
  defaults: RoleKeyMap,
  overrides: PermissionOverridesSchema,
  effective: RoleKeyMap,
});
export type PermissionsResponseType = z.infer<typeof PermissionsResponse>;
