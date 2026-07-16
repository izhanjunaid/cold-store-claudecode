import type { APIRequestContext } from '@playwright/test';
import { API_URL } from '../fixtures';

export interface LotFixtureRefs {
  commodityId: string;
  chamberId: string;
  ratePlanId: string;
}

/**
 * Picks a mutually-compatible, active commodity/room/rate-plan trio for lot
 * creation. Reference data (commodities/chambers/rate-plans) is NOT wiped by
 * resetFacility() — it's reference data shared with the API integration suite
 * against the same facility — so it accumulates inactive/incompatible rows
 * over time. Blindly taking index [0] is never safe; filter for activity and
 * compatibility instead (mirrors the selection WF-01 and the season-aslam
 * helpers already use).
 */
export async function pickLotFixtures(
  request: APIRequestContext,
  headers: Record<string, string>,
  preferredCommodityName = 'POTATO',
): Promise<LotFixtureRefs> {
  const [commoditiesRes, chambersRes, ratePlansRes] = await Promise.all([
    request.get(`${API_URL}/v1/commodities`, { headers }),
    request.get(`${API_URL}/v1/chambers`, { headers }),
    request.get(`${API_URL}/v1/rate-plans?is_active=true`, { headers }),
  ]);
  const commodities = (await commoditiesRes.json()).data as
    | { id: string; name: string; is_active: boolean }[]
    | undefined;
  const chambers = (await chambersRes.json()).data as
    | { id: string; is_active: boolean; commodity_restriction_id: string | null }[]
    | undefined;
  const ratePlans = (await ratePlansRes.json()).data as { id: string; commodity_id: string | null }[] | undefined;

  const commodity =
    commodities?.find((c) => c.is_active && c.name === preferredCommodityName) ??
    commodities?.find((c) => c.is_active) ??
    commodities?.[0];
  if (!commodity) throw new Error('No commodities seeded');

  const chamber =
    chambers?.find(
      (ch) => ch.is_active && (!ch.commodity_restriction_id || ch.commodity_restriction_id === commodity.id),
    ) ??
    chambers?.find((ch) => ch.is_active) ??
    chambers?.[0];
  if (!chamber) throw new Error('No active chambers seeded');

  const ratePlan =
    ratePlans?.find((r) => !r.commodity_id || r.commodity_id === commodity.id) ?? ratePlans?.[0];
  if (!ratePlan) throw new Error('No active rate plans seeded for the chosen commodity');

  return { commodityId: commodity.id, chamberId: chamber.id, ratePlanId: ratePlan.id };
}
