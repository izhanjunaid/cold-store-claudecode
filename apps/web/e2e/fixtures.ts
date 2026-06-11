/**
 * Playwright test fixtures for ColdChain E2E.
 *
 * - `apiUrl` / `webUrl`: resolved from env (NEXT_PUBLIC_API_URL / E2E_BASE_URL).
 * - `loginAs(role)`: hits POST /v1/auth/login programmatically, stashes tokens
 *   in localStorage so the page can mount as that role.
 * - `resetFacility()`: hits POST /v1/_test/reset to wipe operational rows.
 *
 * The base @playwright/test is re-exported as `test` for convenience.
 */
import { test as base, expect } from '@playwright/test';

export const FACILITY_ID = '00000000-0000-0000-0000-000000000001';
export const API_URL = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:3001';
export const WEB_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3000';

export const ROLE_CREDENTIALS: Record<string, { email: string; password: string }> = {
  OWNER: { email: 'admin@coldchain.pk', password: 'admin123' },
  MANAGER: { email: 'manager@coldchain.pk', password: 'admin123' },
  ACCOUNTANT: { email: 'accountant@coldchain.pk', password: 'admin123' },
  OPERATOR: { email: 'operator@coldchain.pk', password: 'admin123' },
  SECURITY: { email: 'security@coldchain.pk', password: 'admin123' },
};

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: { id: string; email: string; role: string; facility_id: string };
}

async function apiLogin(role: string): Promise<LoginResult> {
  const cred = ROLE_CREDENTIALS[role];
  if (!cred) throw new Error(`Unknown role: ${role}`);
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  });
  if (!res.ok) throw new Error(`Login as ${role} failed: ${res.status}`);
  const body = await res.json();
  return {
    accessToken: body.data.access_token,
    refreshToken: body.data.refresh_token,
    user: body.data.user,
  };
}

export async function resetFacility(): Promise<void> {
  const res = await fetch(`${API_URL}/v1/_test/reset`, { method: 'POST' });
  if (!res.ok) {
    console.warn(`WARNING: Test reset skipped (${res.status}). API might be running without ALLOW_TEST_RESET=1.`);
  }
}

type Fixtures = {
  loginAs: (role: string) => Promise<LoginResult>;
};

export const test = base.extend<Fixtures>({
  loginAs: async ({ page }, use) => {
    await use(async (role: string) => {
      const result = await apiLogin(role);
      // Stash auth in localStorage on the web origin so the (app) layout
      // picks it up via loadFromStorage.
      await page.goto('/login');
      await page.evaluate(
        ({ at, rt, fid }) => {
          localStorage.setItem('access_token', at);
          localStorage.setItem('refresh_token', rt);
          localStorage.setItem('facility_id', fid);
        },
        { at: result.accessToken, rt: result.refreshToken, fid: result.user.facility_id },
      );
      return result;
    });
  },
});

export { expect };
