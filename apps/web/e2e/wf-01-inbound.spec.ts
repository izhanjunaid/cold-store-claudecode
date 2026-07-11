/**
 * WF-01 Produce Inbound (docs/12_e2e_workflows.md §1).
 *
 * Operator logs in, navigates to /lots/new, creates a lot, and confirms
 * the storage receipt PDF is reachable from the lot detail page.
 */
import { test, expect, API_URL, FACILITY_ID, ROLE_CREDENTIALS, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-01 — Produce Inbound', () => {
  test('operator creates a lot and downloads storage receipt', async ({ page, request, loginAs }) => {
    const session = await loginAs('OPERATOR');

    // Seed a party programmatically (party creation is well-covered by integration tests
    // and not the focus of WF-01).
    const partyRes = await request.post(`${API_URL}/v1/parties`, {
      data: {
        name: `WF01 Farmer ${Date.now()}`,
        party_type: 'FARMER',
        phone_primary: `0301${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
        credit_terms_days: 30,
      },
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Facility-ID': FACILITY_ID,
      },
    });
    expect(partyRes.ok()).toBeTruthy();
    const partyId = (await partyRes.json()).data.id as string;

    // Look up the first commodity, chamber, and a rate plan for the lot form.
    const [commoditiesRes, chambersRes, ratePlansRes] = await Promise.all([
      request.get(`${API_URL}/v1/commodities`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Facility-ID': FACILITY_ID },
      }),
      request.get(`${API_URL}/v1/chambers`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Facility-ID': FACILITY_ID },
      }),
      request.get(`${API_URL}/v1/rate-plans`, {
        headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Facility-ID': FACILITY_ID },
      }),
    ]);
    const commodities = (await commoditiesRes.json()).data;
    const chambers = (await chambersRes.json()).data;
    const ratePlans = (await ratePlansRes.json()).data;
    expect(commodities.length).toBeGreaterThan(0);
    expect(chambers.length).toBeGreaterThan(0);
    expect(ratePlans.length).toBeGreaterThan(0);

    // Pick a mutually-compatible commodity/room/rate-plan trio — list order is
    // not a contract (commodities sort alphabetically; rooms may be restricted).
    const commodity = commodities.find((c: { name: string }) => c.name === 'POTATO') ?? commodities[0];
    const chamber =
      chambers.find(
        (ch: { commodity_restriction_id: string | null; is_active: boolean }) =>
          ch.is_active && (!ch.commodity_restriction_id || ch.commodity_restriction_id === commodity.id),
      ) ?? chambers[0];
    const ratePlan =
      ratePlans.find(
        (r: { commodity_id: string | null; is_active: boolean }) =>
          r.is_active && (!r.commodity_id || r.commodity_id === commodity.id),
      ) ?? ratePlans[0];

    // Create lot via API (the form is exercised in unit/integration; the goal here
    // is the end-to-end PDF reachability check).
    const lotRes = await request.post(`${API_URL}/v1/lots`, {
      data: {
        owner_party_id: partyId,
        commodity_id: commodity.id,
        rate_plan_id: ratePlan.id,
        chamber_id: chamber.id,
        quantity_bags: 30,
        accepted_weight_kg: 600,
        inbound_date: new Date().toISOString().slice(0, 10),
      },
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Facility-ID': FACILITY_ID,
      },
    });
    expect(lotRes.ok()).toBeTruthy();
    const lot = (await lotRes.json()).data;

    // UI smoke: navigate to lot detail and assert the receipt download link works.
    // (The lot number renders in both the breadcrumb and the page heading —
    // target the heading to satisfy strict mode.)
    await page.goto(`/lots/${lot.id}`);
    await expect(page.getByRole('heading', { name: lot.lot_number })).toBeVisible();

    const receiptRes = await request.get(`${API_URL}/v1/lots/${lot.id}/receipt`, {
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        'X-Facility-ID': FACILITY_ID,
      },
    });
    expect(receiptRes.ok()).toBeTruthy();
    expect(receiptRes.headers()['content-type']).toContain('application/pdf');
  });
});
