/**
 * A cold store that doesn't weigh (docs/27): "We weigh produce" is off, so no weight box from
 * inward to the gate, and a booked withdrawal is checked out straight away. The desk's clicks are
 * counted: one fewer than the weighing desk (dispatch-desk.spec.ts caps that at 6).
 *
 *   1. The lot form shows Quantity and no weight boxes; Reports has no Weight Variance.
 *   2. MANAGER on /dispatch: find the lot, tap the truck, book, then Dispatch & Collect. No Weigh.
 *   3. SECURITY on /gate: the truck is ready; one Release and the blind bag count.
 *
 * The setting is the facility's, shared with every spec, so it is switched in `beforeAll` and put
 * back in `afterAll`: a test that times out need not run a `finally`, and the next spec would then
 * find no weight boxes.
 * The dispatch-note PDF is stubbed (rendering needs Chromium); the papers' weight lines are the
 * API tests' job (lot, outbound integration and the template unit tests).
 */
import type { APIRequestContext } from '@playwright/test';
import { test, expect, API_URL, resetFacility } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo } from './helpers/season-helpers';

test.describe.configure({ mode: 'serial' });

/** Clicks on the desk, from the desk being open to the truck being paid for: no Weigh step. */
const MAX_DESK_CLICKS = 5;

async function hideWeights(request: APIRequestContext, hide: boolean) {
  const res = await request.patch(`${API_URL}/v1/facilities/me`, {
    headers: await authHeaders('OWNER'),
    data: { settings: { hide_weights: hide } },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ playwright }) => {
  await resetFacility();
  const ctx = await playwright.request.newContext();
  await hideWeights(ctx, true);
  await ctx.dispose();
});

test.afterAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await hideWeights(ctx, false);
  await ctx.dispose();
});

test('a store that does not weigh: no weight box from inward to the gate, and a click fewer at the desk', async ({
  page,
  request,
  loginAs,
}) => {
  test.setTimeout(300_000);
  const op = await authHeaders('OPERATOR');
  const mgr = await authHeaders('MANAGER');
  const sec = await authHeaders('SECURITY');
  const refs = await getFacilityRefs(request, op);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  const truck = `LHR-${1000 + Math.floor(Math.random() * 8999)}`;

  // ── 1. Inward: the form has bags and no weights; the API takes a lot with none.
  await loginAs('OPERATOR');
  await page.goto('/lots/new');
  await expect(page.getByLabel(/^Quantity/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel(/^Accepted weight/)).toHaveCount(0);
  await expect(page.getByLabel(/^Declared weight/)).toHaveCount(0);

  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `No-Weigh Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0316${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const lotRes = await request.post(`${API_URL}/v1/lots`, {
    headers: op,
    data: {
      owner_party_id: party.data.id,
      commodity_id: refs.commodityId,
      rate_plan_id: refs.seasonalRatePlanId,
      chamber_id: refs.chamberId,
      quantity_bags: 120,
      inbound_date: isoDaysAgo(60),
    },
  });
  expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
  const lot = (await lotRes.json()).data as { id: string; lot_number: string; accepted_weight_kg: number | null };
  expect(lot.accepted_weight_kg).toBeNull();

  await page.goto(`/lots/${lot.id}`);
  await expect(page.getByRole('heading', { name: lot.lot_number })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Weight (Accepted / Declared)')).toHaveCount(0);

  const inward = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: sec, data: { vehicle_number: truck } });
  expect(inward.ok(), await inward.text()).toBeTruthy();

  // ── 2. The desk: booked, then straight to the checkout.
  await page.route('**/dispatch-note', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );
  await loginAs('MANAGER');
  await page.goto('/reports');
  await expect(page.getByText('Lot Aging')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Weight Variance')).toHaveCount(0);

  await page.goto('/dispatch');
  await expect(page.getByRole('heading', { name: /dispatch desk/i })).toBeVisible({ timeout: 20_000 });

  let clicks = 0;
  const tap = async (target: ReturnType<typeof page.locator>) => {
    clicks += 1;
    await target.click();
  };

  await page.getByLabel('Find a lot').fill(lot.lot_number); // typing, not a click
  await tap(page.getByRole('button', { name: new RegExp(lot.lot_number) }));
  await tap(page.getByLabel('Trucks inside').getByRole('button', { name: truck, exact: true }));
  await tap(page.getByRole('button', { name: 'Create Withdrawal' }));

  const row = page.locator('tr', { hasText: truck });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText('Booked', { exact: true })).toBeVisible();
  await expect(row.getByLabel(/Weight in kg/)).toHaveCount(0);
  await tap(row.getByRole('button', { name: /Dispatch & Collect/ }));
  await tap(page.getByRole('button', { name: /Dispatch & Collect Rs\s?[\d,]+/ }));
  await expect(page.getByText(/Dispatched and collected/i).first()).toBeVisible({ timeout: 30_000 });

  console.log(`no-weigh desk: ${clicks} clicks from the open desk to a paid, dispatched truck`);
  expect(clicks).toBeLessThanOrEqual(MAX_DESK_CLICKS);

  // The books agree: dispatched with no weight, billed and paid.
  const events = (await (await request.get(`${API_URL}/v1/lots/${lot.id}/outbound-events`, { headers: mgr })).json()).data as {
    status: string;
    outbound_weight_kg: number | null;
  }[];
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ status: 'DISPATCHED', outbound_weight_kg: null });
  const invoices = (await (await request.get(`${API_URL}/v1/invoices?lot_id=${lot.id}&page_size=10`, { headers: mgr })).json()).data as {
    balance_due_pkr: number;
  }[];
  expect(invoices).toHaveLength(1);
  expect(Number(invoices[0]!.balance_due_pkr)).toBe(0);

  // ── 3. The gate: ready, released on the guard's count.
  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 20_000 });
  await ready.getByRole('button', { name: 'Release' }).click();
  await page.getByLabel(/bags counted/i).fill('120');
  await page.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 20_000 });
});
