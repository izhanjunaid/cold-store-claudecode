/**
 * The gate's count (C3 part 1, docs/28 D3 + D4), on the real gate page.
 *
 *   1. The guard counts a dispatched, paid truck wrong three times: each try says which it was, the
 *      fourth is refused even with the right number, and a manager releases it.
 *   2. A truck whose load is only booked is sent back to the desk: no recount, no override.
 *
 * Setup goes through the API; the dispatch-note PDF is never opened here.
 */
import type { APIRequestContext } from '@playwright/test';
import { test, expect, API_URL, resetFacility } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo } from './helpers/season-helpers';

test.describe.configure({ mode: 'serial' });

const plate = () => `LHR-${1000 + Math.floor(Math.random() * 8999)}`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

test.beforeAll(async () => {
  await resetFacility();
});

/** A lot of `bags`, fully booked onto `truck`; dispatched and paid in cash when `dispatch` is set. */
async function bookTruck(request: APIRequestContext, truck: string, bags: number, dispatch: boolean) {
  const op = await authHeaders('OPERATOR');
  const mgr = await authHeaders('MANAGER');
  const refs = await getFacilityRefs(request, op);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `Count Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0314${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const lotRes = await request.post(`${API_URL}/v1/lots`, {
    headers: op,
    data: {
      owner_party_id: party.data.id,
      commodity_id: refs.commodityId,
      rate_plan_id: refs.seasonalRatePlanId,
      chamber_id: refs.chamberId,
      quantity_bags: bags,
      accepted_weight_kg: bags * 20,
      inbound_date: isoDaysAgo(40),
    },
  });
  expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
  const lotId = (await lotRes.json()).data.id as string;
  const ob = await request.post(`${API_URL}/v1/outbound-events`, {
    headers: op,
    data: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: bags, outbound_date: today(), vehicle_number: truck },
  });
  expect(ob.ok(), await ob.text()).toBeTruthy();
  const outboundId = (await ob.json()).data.id as string;
  if (dispatch) {
    const preview = (await (await request.get(`${API_URL}/v1/outbound-events/${outboundId}/checkout-preview`, { headers: mgr })).json()).data;
    const co = await request.post(`${API_URL}/v1/outbound-events/${outboundId}/dispatch-and-collect`, {
      headers: mgr,
      data: { expected_total_pkr: preview.total_pkr, payment: { mode: 'CASH' } },
    });
    expect(co.ok(), await co.text()).toBeTruthy();
  }
  const sec = await authHeaders('SECURITY');
  const inward = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: sec, data: { vehicle_number: truck } });
  expect(inward.ok(), await inward.text()).toBeTruthy();
}

test('three wrong counts lock the truck for the guard; a manager releases it', async ({ page, request, loginAs }) => {
  test.setTimeout(240_000);
  const truck = plate();
  await bookTruck(request, truck, 50, true);

  const tryCount = async (n: string) => {
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/bags counted/i).fill(n);
    await dialog.getByRole('button', { name: /^clear outward$/i }).click();
  };

  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await ready.getByRole('button', { name: 'Release' }).click();

  const dialog = page.getByRole('dialog');
  await tryCount('41');
  await expect(dialog.getByText('Try 1 of 3, recount.')).toBeVisible({ timeout: 20_000 });
  await tryCount('42');
  await expect(dialog.getByText('Try 2 of 3, recount.')).toBeVisible({ timeout: 20_000 });
  await tryCount('43');
  await expect(dialog.getByText('Try 3 of 3 — call a manager.')).toBeVisible({ timeout: 20_000 });

  // The right number no longer helps the guard.
  await tryCount('50');
  await expect(dialog.getByText(/did not match 3 times/i)).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByRole('button', { name: /^clear outward$/i })).toBeDisabled();

  // A manager sees the three counts and releases the truck.
  await loginAs('MANAGER');
  await page.goto('/gate');
  const mgrReady = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(mgrReady).toBeVisible({ timeout: 30_000 });
  await mgrReady.getByRole('button', { name: 'Release' }).click();
  const mgrDialog = page.getByRole('dialog');
  await expect(mgrDialog.getByText('Earlier counts on this pass')).toBeVisible();
  await expect(mgrDialog.getByText(/counted 41, dispatch said 50/)).toBeVisible();
  await mgrDialog.getByLabel(/bags counted/i).fill('50');
  await mgrDialog.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 20_000 });

  const sec = await authHeaders('SECURITY');
  const passes = (await (await request.get(`${API_URL}/v1/gate-passes?vehicle_number=${truck}&page_size=5`, { headers: sec })).json()).data as {
    status: string;
  }[];
  expect(passes.some((p) => p.status === 'CLEARED')).toBeTruthy();
});

test('a truck whose load is only booked is sent back to the desk — no recount, no override', async ({ page, request, loginAs }) => {
  test.setTimeout(180_000);
  const truck = plate();
  await bookTruck(request, truck, 30, false);

  await loginAs('SECURITY');
  await page.goto('/gate');
  const inside = page.locator('li', { hasText: truck });
  await expect(inside).toBeVisible({ timeout: 30_000 });
  await inside.getByRole('button', { name: /^clear outward$/i }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel(/bags counted/i).fill('0');
  await dialog.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(dialog.getByText('Send the truck back to the desk.')).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByText(/recount/i)).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /release anyway/i })).toHaveCount(0);
});
