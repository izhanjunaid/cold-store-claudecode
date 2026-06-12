export type Role = 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATOR' | 'SECURITY' | 'VIEWER';

// Mirrors ROLE_HIERARCHY in apps/api/src/plugins/auth.ts — keep in sync.
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 6,
  MANAGER: 5,
  ACCOUNTANT: 4,
  OPERATOR: 3,
  SECURITY: 2,
  VIEWER: 1,
};

export function hasMinRole(role: string | undefined | null, minRole: Role): boolean {
  return (ROLE_RANK[(role ?? '') as Role] ?? 0) >= ROLE_RANK[minRole];
}
