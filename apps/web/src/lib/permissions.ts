import { useAuthStore } from '@/stores/auth.store';

interface UserLike {
  role?: string | null;
  permissions?: string[];
}

/**
 * Whether the current user holds a permission key. OWNER always passes (matches
 * the server's OWNER short-circuit). Otherwise checks the effective permission
 * list the server put on the user at login / /me. When the list is missing
 * (older session, still loading) we fall back to `false` — the API remains the
 * real gate, so a hidden button is a courtesy, never a security boundary.
 */
export function can(user: UserLike | null | undefined, key: string): boolean {
  if (!user) return false;
  if (user.role === 'OWNER') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}

/** Hook form: `const canFinalize = useCan('invoices.manage')`. */
export function useCan(key: string): boolean {
  const user = useAuthStore((s) => s.user);
  return can(user, key);
}
