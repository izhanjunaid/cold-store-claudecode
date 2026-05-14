/**
 * Default landing route per role. SECURITY users go straight to the gate console
 * (touch-optimised); everyone else lands on the dashboard.
 */
export function defaultRouteForRole(role: string | undefined | null): string {
  if (role === 'SECURITY') return '/gate';
  return '/dashboard';
}
