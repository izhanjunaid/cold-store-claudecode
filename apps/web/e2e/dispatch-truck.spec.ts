/**
 * A truck carrying several lots (fast-dispatch C2) — booked onto the truck from its card,
 * weighed lot by lot, checked out in one step, and released by the guard on the summed count.
 *
 *   1. MANAGER on /dispatch: "Add a lot" twice from the truck's card, weigh both, "Check out truck",
 *      cash. Every click is counted: the alternative is two separate checkouts, receipts and notes.
 *   2. The books: both lots dispatched, two bills paid, and ONE receipt covering both.
 *   3. SECURITY on /gate: one Release for the truck, the bag count is the sum of both lots.
 *   4. The load slip lists both withdrawals before and after the truck leaves.
 *
 * The load-slip PDF is stubbed in the page (rendering needs Chromium); its HTML is read at the API.
 */
import { test, expect, API_URL, resetFacility } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo } from './helpers/season-helpers';

test.describe.configure({ mode: 'serial' });

/** Clicks on the desk, from the truck's card to the truck paid for: 2 × (add, pick, book) + 2 weighs + 2 to check out. */
const MAX_TRUCK_CLICKS = 10;

const plate = () => `LHR-${1000 + Math.floor(Math.random() * 8999)}`;

test.beforeAll(async () => {
  await resetFacility();
});

test('a two-lot truck: booked from its card, checked out in one step, released on the summed count', async ({
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

  // ── Setup through the API: one party with two lots, and the truck inside the gate.
  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `Truck Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0314${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const partyId = party.data.id as string;

  async function makeLot(bags: number) {
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
      },
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    return (await res.json()).data as { id: string; lot_number: string };
  }
  const lots = [await makeLot(60), await makeLot(40)];

  const inward = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: sec, data: { vehicle_number: truck } });
  expect(inward.ok(), await inward.text()).toBeTruthy();
  const passId = (await inward.json()).data.id as string;

  await page.route('**/load-slip', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));

  // ── 1. The desk.
  await loginAs('MANAGER');
  await page.goto('/dispatch');
  await expect(page.getByRole('heading', { name: /dispatch desk/i })).toBeVisible({ timeout: 20_000 });

  let clicks = 0;
  const tap = async (target: ReturnType<typeof page.locator>) => {
    clicks += 1;
    await target.click();
  };
  const card = page.locator('[data-truck]', { has: page.locator('[data-truck-plate]', { hasText: truck }) });
  await expect(card).toBeVisible({ timeout: 20_000 });

  for (const lot of lots) {
    await tap(card.getByRole('button', { name: 'Add a lot' }));
    await page.getByLabel('Find a lot').fill(lot.lot_number); // typing, not a click
    await tap(page.getByRole('button', { name: new RegExp(lot.lot_number) }));
    await tap(page.getByRole('button', { name: 'Create Withdrawal' }));
    await expect(card.getByText(lot.lot_number)).toBeVisible({ timeout: 20_000 });
  }

  for (const [i, lot] of lots.entries()) {
    const row = page.locator('tr', { hasText: lot.lot_number });
    await row.getByLabel(/Weight in kg/).fill(String((i === 0 ? 60 : 40) * 19.5)); // typing
    await tap(row.getByRole('button', { name: 'Weigh', exact: true }));
    await expect(row.getByText('Check out with the truck')).toBeVisible({ timeout: 20_000 });
  }

  await tap(card.getByRole('button', { name: 'Check out truck' }));
  await tap(page.getByRole('button', { name: /Check out truck Rs\s?[\d,]+/ }));
  await expect(page.getByText(/checked out/i).first()).toBeVisible({ timeout: 30_000 });

  console.log(`dispatch truck: ${clicks} clicks from the truck's card to two lots dispatched and paid`);
  expect(clicks).toBeLessThanOrEqual(MAX_TRUCK_CLICKS);

  // ── 2. The books: both dispatched, both bills paid, by one receipt.
  for (const lot of lots) {
    const events = (await (await request.get(`${API_URL}/v1/lots/${lot.id}/outbound-events`, { headers: mgr })).json()).data as {
      status: string;
    }[];
    expect(events.map((e) => e.status)).toEqual(['DISPATCHED']);
    const invoices = (await (await request.get(`${API_URL}/v1/invoices?lot_id=${lot.id}&page_size=10`, { headers: mgr })).json()).data as {
      id: string;
      balance_due_pkr: number;
    }[];
    expect(invoices).toHaveLength(1);
    expect(Number(invoices[0]!.balance_due_pkr)).toBe(0);
  }
  const receipts = (await (await request.get(`${API_URL}/v1/payments?party_id=${partyId}&page_size=10`, { headers: mgr })).json()).data;
  expect(receipts).toHaveLength(1);

  const slipBefore = await request.get(`${API_URL}/v1/dispatch/trucks/${passId}/load-slip?format=html`, { headers: mgr });
  expect(slipBefore.ok(), await slipBefore.text()).toBeTruthy();

  // ── 3. The gate: one truck, one release, the count of both lots together.
  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 20_000 });
  await ready.getByRole('button', { name: 'Release' }).click();
  await page.getByLabel(/bags counted/i).fill('100');
  await page.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 20_000 });

  // ── 4. The slip after the truck has left still names both withdrawals; the guard never gets it.
  const slip = await (await request.get(`${API_URL}/v1/dispatch/trucks/${passId}/load-slip?format=html`, { headers: mgr })).text();
  for (const lot of lots) expect(slip).toContain(lot.lot_number);
  expect((await request.get(`${API_URL}/v1/dispatch/trucks/${passId}/load-slip?format=html`, { headers: sec })).status()).toBe(403);
});
