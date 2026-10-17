/**
 * Dispatch Desk (fast-dispatch Phases A + B) — the whole truck in the UI, with every click counted.
 *
 *   1. MANAGER on /dispatch: find the lot, tap the truck's plate, book, weigh, Dispatch & Collect.
 *      The clicks are counted and capped: this is the number the redesign exists to shrink
 *      (it used to be lot list → lot → Withdraw → form → withdrawal page → invoice → payment → gate pass).
 *   2. SECURITY on /gate: the truck is under "Ready to leave"; one Release + the blind bag count.
 *   3. MANAGER: a booked withdrawal is cancelled from its desk row (and leaves the queue), then a
 *      partial one is dispatched with the racks the bags came off.
 *
 * The dispatch-note PDF is stubbed: this spec is about the desk, and rendering needs Chromium.
 */
import type { APIRequestContext } from '@playwright/test';
import { test, expect, API_URL, resetFacility } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo } from './helpers/season-helpers';

test.describe.configure({ mode: 'serial' });

/** Clicks on the desk, from the desk being open to the truck being paid for. */
const MAX_DESK_CLICKS = 6;

/** Two racks of their own in a chamber, so the spec does not lean on fixture ids the seed does not create. */
async function makeRacks(request: APIRequestContext, chamberId: string, tag: string) {
  const owner = await authHeaders('OWNER');
  const rack = async (name: string) => {
    const res = await request.post(`${API_URL}/v1/chambers/${chamberId}/racks`, {
      headers: owner,
      data: { name, max_capacity_bags: 500 },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).data.id as string;
  };
  return { a: await rack(`E2E-${tag}-1`), b: await rack(`E2E-${tag}-2`) };
}

const plate = () => `LHR-${1000 + Math.floor(Math.random() * 8999)}`;

test.beforeAll(async () => {
  await resetFacility();
});

test('the desk path: booked, weighed, dispatched and paid in a handful of clicks — then the guard releases it', async ({
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
  const truck = plate();

  // ── Setup through the API: a party with a lot in two racks, and its truck inside the gate.
  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `Desk Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0312${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const partyId = party.data.id as string;

  const racks = await makeRacks(request, refs.chamberId, tag);

  async function makeLot(bags: number, placements: { rack_id: string; bags: number }[]) {
    const res = await request.post(`${API_URL}/v1/lots`, {
      headers: op,
      data: {
        owner_party_id: partyId,
        commodity_id: refs.commodityId,
        rate_plan_id: refs.seasonalRatePlanId,
        chamber_id: refs.chamberId,
        quantity_bags: bags,
        accepted_weight_kg: bags * 20,
        inbound_date: isoDaysAgo(60),
        placements,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const lot = (await res.json()).data as { id: string; lot_number: string };
    return lot;
  }

  const lot = await makeLot(200, [
    { rack_id: racks.a, bags: 120 },
    { rack_id: racks.b, bags: 80 },
  ]);
  const inward = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: sec, data: { vehicle_number: truck } });
  expect(inward.ok(), await inward.text()).toBeTruthy();

  // The desk prints the dispatch note after a checkout; do not start Chromium for it.
  await page.route('**/dispatch-note', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );

  // ── 1. The desk.
  await loginAs('MANAGER');
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
  await row.getByLabel(/Weight in kg/).fill('3900'); // typing
  await tap(row.getByRole('button', { name: 'Weigh', exact: true }));

  await tap(row.getByRole('button', { name: /Dispatch & Collect/ }));
  await tap(page.getByRole('button', { name: /Dispatch & Collect Rs\s?[\d,]+/ }));
  await expect(page.getByText(/Dispatched and collected/i).first()).toBeVisible({ timeout: 30_000 });

  console.log(`dispatch desk: ${clicks} clicks from the open desk to a paid, dispatched truck`);
  expect(clicks).toBeLessThanOrEqual(MAX_DESK_CLICKS);

  // The books agree with the screen: dispatched, billed, and paid in the same step.
  const events = (await (await request.get(`${API_URL}/v1/lots/${lot.id}/outbound-events`, { headers: mgr })).json()).data as {
    id: string;
    status: string;
  }[];
  expect(events).toHaveLength(1);
  expect(events[0]!.status).toBe('DISPATCHED');
  const invoices = (await (await request.get(`${API_URL}/v1/invoices?lot_id=${lot.id}&page_size=10`, { headers: mgr })).json()).data as {
    status: string;
    balance_due_pkr: number;
  }[];
  expect(invoices).toHaveLength(1);
  expect(invoices[0]!.status).not.toBe('DRAFT');
  expect(Number(invoices[0]!.balance_due_pkr)).toBe(0);

  // ── 2. The gate: nothing to read, nothing to decide — the truck is ready, release it.
  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 20_000 });
  await ready.getByRole('button', { name: 'Release' }).click();
  await page.getByLabel(/bags counted/i).fill('200');
  await page.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 20_000 });

  const passes = (await (await request.get(`${API_URL}/v1/gate-passes?vehicle=${truck}&page_size=5`, { headers: sec })).json()).data as {
    status: string;
    direction?: string;
  }[];
  expect(passes.some((p) => p.status === 'CLEARED')).toBeTruthy();
});

test('cancel a booked withdrawal from its desk row; then dispatch a partial one with the racks it came off', async ({
  page,
  request,
  loginAs,
}) => {
  test.setTimeout(300_000);
  const op = await authHeaders('OPERATOR');
  const mgr = await authHeaders('MANAGER');
  const refs = await getFacilityRefs(request, op);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();

  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `Desk Farmer B ${tag}`, party_type: 'FARMER', phone_primary: `0313${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const racks = await makeRacks(request, refs.chamberId, tag);
  const lotRes = await request.post(`${API_URL}/v1/lots`, {
    headers: op,
    data: {
      owner_party_id: party.data.id,
      commodity_id: refs.commodityId,
      rate_plan_id: refs.seasonalRatePlanId,
      chamber_id: refs.chamberId,
      quantity_bags: 100,
      accepted_weight_kg: 2000,
      inbound_date: isoDaysAgo(60),
      placements: [
        { rack_id: racks.a, bags: 60 },
        { rack_id: racks.b, bags: 40 },
      ],
    },
  });
  expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
  const lotId = (await lotRes.json()).data.id as string;

  async function book(plateNo: string) {
    const res = await request.post(`${API_URL}/v1/outbound-events`, {
      headers: op,
      data: {
        lot_id: lotId,
        withdrawal_type: 'PARTIAL',
        quantity_withdrawn_bags: 50,
        outbound_date: new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' }),
        vehicle_number: plateNo,
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).data.id as string;
  }

  await page.route('**/dispatch-note', (route) =>
    route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }),
  );
  await loginAs('MANAGER');

  // A booking that never happens: cancelled from the row, gone from the queue, bags free again.
  const gone = plate();
  const goneId = await book(gone);
  await page.goto('/dispatch');
  const goneRow = page.locator('tr', { hasText: gone });
  await expect(goneRow).toBeVisible({ timeout: 20_000 });
  await goneRow.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByLabel('Reason').fill('Truck did not come');
  await page.getByRole('button', { name: 'Cancel withdrawal' }).click();
  await expect(goneRow).toHaveCount(0, { timeout: 20_000 });
  const cancelled = (await (await request.get(`${API_URL}/v1/outbound-events/${goneId}`, { headers: mgr })).json()).data;
  expect(cancelled.status).toBe('CANCELLED');

  // The same 50 bags booked again: weighed, then dispatched naming the racks.
  const truck = plate();
  const id = await book(truck);
  const w = await request.patch(`${API_URL}/v1/outbound-events/${id}/weight`, { headers: op, data: { outbound_weight_kg: 975 } });
  expect(w.ok(), await w.text()).toBeTruthy();

  const placements = (await (await request.get(`${API_URL}/v1/lots/${lotId}/placements`, { headers: mgr })).json()).data
    .placements as { rack_id: string; rack_name: string }[];
  const rackB = placements.find((p) => p.rack_id === racks.b)!;

  await page.reload();
  const row = page.locator('tr', { hasText: truck });
  await row.getByRole('button', { name: /Dispatch & Collect/ }).click();
  await page.getByLabel(`Bags picked from ${rackB.rack_name}`).fill('40');
  await page.getByRole('button', { name: /Dispatch & Collect Rs\s?[\d,]+/ }).click();
  await expect(page.getByText(/Dispatched and collected/i).first()).toBeVisible({ timeout: 30_000 });

  // 40 off the rack named; the other 10 trimmed from the fullest by the server.
  const after = (await (await request.get(`${API_URL}/v1/lots/${lotId}/placements`, { headers: mgr })).json()).data as {
    current_balance_bags: number;
    placements: { rack_id: string; bags: number }[];
  };
  expect(after.current_balance_bags).toBe(50);
  expect(after.placements.find((p) => p.rack_id === racks.b)?.bags ?? 0).toBe(0);
  expect(after.placements.find((p) => p.rack_id === racks.a)?.bags).toBe(50);
});

test('the gate guard counts blind: the lot pages open for them with no bag count anywhere', async ({ page, request, loginAs }) => {
  test.setTimeout(180_000);
  const op = await authHeaders('OPERATOR');
  const sec = await authHeaders('SECURITY');
  const refs = await getFacilityRefs(request, op);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `Blind Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0315${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const lotRes = await request.post(`${API_URL}/v1/lots`, {
    headers: op,
    data: {
      owner_party_id: party.data.id,
      commodity_id: refs.commodityId,
      rate_plan_id: refs.seasonalRatePlanId,
      chamber_id: refs.chamberId,
      quantity_bags: 321,
      accepted_weight_kg: 6420,
      inbound_date: isoDaysAgo(30),
    },
  });
  expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
  const lot = (await lotRes.json()).data as { id: string; lot_number: string };

  // The API: the guard's copy has the field, empty; an operator's has the number.
  const asGuard = (await (await request.get(`${API_URL}/v1/lots/${lot.id}`, { headers: sec })).json()).data;
  expect(asGuard.current_balance_bags).toBeNull();
  expect(asGuard.quantity_bags).toBeNull();
  const asOperator = (await (await request.get(`${API_URL}/v1/lots/${lot.id}`, { headers: op })).json()).data;
  expect(asOperator.current_balance_bags).toBe(321);

  // The pages: they open, show a dash, and never print 321 or NaN.
  await loginAs('SECURITY');
  await page.goto(`/lots/${lot.id}`);
  await expect(page.getByRole('heading', { name: lot.lot_number })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('321');
  await expect(page.locator('body')).not.toContainText('NaN');
  await page.goto('/lots');
  await expect(page.getByText(lot.lot_number).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText('NaN');
});