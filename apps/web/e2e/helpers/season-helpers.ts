import type { APIRequestContext, Page } from '@playwright/test';
import { API_URL, FACILITY_ID, ROLE_CREDENTIALS } from '../fixtures';

export const ARTIFACT_DIR = 'test-results/season-aslam';

export async function shot(page: Page, name: string): Promise<string> {
  const path = `${ARTIFACT_DIR}/${name}`;
  await page.screenshot({ path, fullPage: true });
  return path;
}

export interface RoleHeaders extends Record<string, string> {
  Authorization: string;
  'X-Facility-ID': string;
}

export async function authHeaders(role: keyof typeof ROLE_CREDENTIALS): Promise<RoleHeaders> {
  const cred = ROLE_CREDENTIALS[role];
  if (!cred) throw new Error(`Unknown role ${role}`);
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
    body: JSON.stringify({ email: cred.email, password: cred.password }),
  });
  if (!res.ok) throw new Error(`Login as ${role} failed: ${res.status}`);
  const body = await res.json();
  return {
    Authorization: `Bearer ${body.data.access_token}`,
    'X-Facility-ID': FACILITY_ID,
  };
}

export interface FacilityRefs {
  commodityId: string;
  varietyId?: string;
  chamberId: string;
  seasonalRatePlanId: string;
}

export async function getFacilityRefs(
  request: APIRequestContext,
  headers: RoleHeaders,
): Promise<FacilityRefs> {
  const commoditiesRes = await request.get(`${API_URL}/v1/commodities`, { headers });
  const commoditiesJson = await commoditiesRes.json();
  const commodities = commoditiesJson.data ?? commoditiesJson;
  const potato = commodities[0];
  if (!potato) throw new Error('No commodities seeded');

  const chambersRes = await request.get(`${API_URL}/v1/chambers`, { headers });
  const chambersJson = await chambersRes.json();
  const chambers = Array.isArray(chambersJson) ? chambersJson : chambersJson.data;
  const chamber =
    chambers.find(
      (c: { commodity_restriction_id?: string | null }) =>
        !c.commodity_restriction_id || c.commodity_restriction_id === potato.id,
    ) ?? chambers[0];
  if (!chamber) throw new Error('No chambers seeded');

  const plansRes = await request.get(`${API_URL}/v1/rate-plans?is_active=true`, { headers });
  const plansJson = await plansRes.json();
  const plans = plansJson.data ?? plansJson;
  const seasonal =
    plans.find(
      (p: { rate_type?: string; commodity_id?: string | null }) =>
        p.rate_type === 'SEASONAL_PER_BAG' && (!p.commodity_id || p.commodity_id === potato.id),
    ) ?? plans.find((p: { commodity_id?: string | null }) => !p.commodity_id || p.commodity_id === potato.id) ?? plans[0];
  if (!seasonal) throw new Error('No rate plans seeded');

  return {
    commodityId: potato.id,
    chamberId: chamber.id,
    seasonalRatePlanId: seasonal.id,
  };
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
