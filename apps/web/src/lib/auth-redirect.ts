/**
 * Default landing route per role. SECURITY users go straight to the gate console
 * (touch-optimised); everyone else lands on the dashboard. Users carrying a
 * must_change_password flag are diverted to /change-password.
 */
export function defaultRouteForRole(
  role: string | undefined | null,
  mustChangePassword?: boolean,
): string {
  if (mustChangePassword) return '/change-password';
  if (role === 'SECURITY') return '/gate';
  return '/dashboard';
}
