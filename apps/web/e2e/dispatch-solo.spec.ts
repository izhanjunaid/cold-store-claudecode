/**
 * One-person dispatch (fast-dispatch Phase C1) — the owner's switch, in the UI.
 *
 *   1. OPERATOR (the munshi) finishes a clean cash truck alone on /dispatch; SECURITY releases it at
 *      the gate; a MANAGER counts the munshi's cash on the desk and records the handover.
 *   2. A party a manager has pre-approved for credit: the munshi dispatches on credit alone, and the
 *      gate shows the truck as credit-approved and ready.
 *   3. A KATCHI-book truck: the sheet says a manager must finish it, and the button stays off.
 *
 * The test reset does not restore facility settings, so the switch and cash tracking are set here
 * and switched off again afterwards. The dispatch-note PDF is stubbed (rendering needs Chromium).
 */
import type { APIRequestContext } from '@playwright/test';
import { test, expect, API_URL, resetFacility } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo } from './helpers/season-helpers';

test.describe.configure({ mode: 'serial' });

const plate = () => `LHR-${1000 + Math.floor(Math.random() * 8999)}`;
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

async function setSettings(request: APIRequestContext, settings: Record<string, unknown>) {
  const res = await request.patch(`${API_URL}/v1/facilities/me`, { headers: await authHeaders('OWNER'), data: { settings } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A party with one lot, and a weighed FULL withdrawal of it booked on `truck`. */
async function weighedTruck(
  request: APIRequestContext,
  truck: string,
  opts: { bags?: number; book?: 'PACCI' | 'KATCHI'; label: string },
) {
  const op = await authHeaders('OPERATOR');
  const refs = await getFacilityRefs(request, op);
  const bags = opts.bags ?? 60;
  const party = await (
    await request.post(`${API_URL}/v1/parties`, {
      headers: op,
      data: { name: `${opts.label} ${Date.now().toString(36)}`, party_type: 'FARMER', phone_primary: `0316${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
    })
  ).json();
  const partyId = party.data.id as string;
  // A KATCHI lot is the owner's to create.
  const lotRes = await request.post(`${API_URL}/v1/lots`, {
    headers: opts.book === 'KATCHI' ? await authHeaders('OWNER') : op,
    data: {
      owner_party_id: partyId,
      commodity_id: refs.commodityId,
      rate_plan_id: refs.seasonalRatePlanId,
      chamber_id: refs.chamberId,
      quantity_bags: bags,
      accepted_weight_kg: bags * 20,
      inbound_date: isoDaysAgo(45),
      ...(opts.book === 'KATCHI' ? { book_type: 'KATCHI' } : {}),
    },
  });
  expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
  const lotId = (await lotRes.json()).data.id as string;
  const booked = await request.post(`${API_URL}/v1/outbound-events`, {
    headers: op,
    data: { lot_id: lotId, withdrawal_type: 'FULL', quantity_withdrawn_bags: bags, outbound_date: today(), vehicle_number: truck },
  });
  expect(booked.ok(), await booked.text()).toBeTruthy();
  const id = (await booked.json()).data.id as string;
  const w = await request.patch(`${API_URL}/v1/outbound-events/${id}/weight`, { headers: op, data: { outbound_weight_kg: bags * 19.5 } });
  expect(w.ok(), await w.text()).toBeTruthy();
  return { partyId, lotId, id, bags };
}

async function truckInside(request: APIRequestContext, truck: string) {
  const res = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: await authHeaders('SECURITY'), data: { vehicle_number: truck } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

test.beforeAll(async ({ request }) => {
  await resetFacility();
  await setSettings(request, { dispatch_solo_mode: true, cash_tracking_from: today() });
});

test.afterAll(async ({ request }) => {
  await setSettings(request, { dispatch_solo_mode: false, cash_tracking_from: null });
});

test('the munshi finishes a cash truck alone; the guard releases it; a manager counts the cash', async ({ page, request, loginAs }) => {
  test.setTimeout(300_000);
  const truck = plate();
  const { id, lotId, bags } = await weighedTruck(request, truck, { label: 'Solo Cash' });
  await truckInside(request, truck);
  await page.route('**/dispatch-note', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));

  // ── 1. The munshi, alone.
  await loginAs('OPERATOR');
  await page.goto('/dispatch');
  const row = page.locator('tr', { hasText: truck });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /Dispatch & Collect/ }).click();
  await expect(page.getByText(/finish this truck yourself/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Cheque' })).toBeDisabled();
  await page.getByRole('button', { name: /Dispatch & Collect Rs\s?[\d,]+/ }).click();
  await expect(page.getByText(/Dispatched and collected/i).first()).toBeVisible({ timeout: 30_000 });

  const mgr = await authHeaders('MANAGER');
  const ob = (await (await request.get(`${API_URL}/v1/outbound-events/${id}`, { headers: mgr })).json()).data;
  expect(ob.status).toBe('DISPATCHED');
  const invoices = (await (await request.get(`${API_URL}/v1/invoices?lot_id=${lotId}&page_size=5`, { headers: mgr })).json())
    .data as { status: string; total_pkr: number; balance_due_pkr: number }[];
  expect(invoices).toHaveLength(1);
  const bill = invoices[0]!;
  expect(bill.status).not.toBe('DRAFT');
  expect(Number(bill.balance_due_pkr)).toBe(0);

  // ── 2. The gate: paid, so ready; one Release and the blind count.
  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await ready.getByRole('button', { name: 'Release' }).click();
  await page.getByLabel(/bags counted/i).fill(String(bags));
  await page.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 30_000 });

  // ── 3. A manager counts the munshi's cash on the desk.
  await loginAs('MANAGER');
  await page.goto('/dispatch');
  const collector = page.locator('tr').filter({ has: page.getByRole('button', { name: 'Count cash' }) }).first();
  await expect(collector).toBeVisible({ timeout: 30_000 });
  await collector.getByRole('button', { name: 'Count cash' }).click();
  await page.getByLabel(/Cash counted/).fill(String(Number(bill.total_pkr)));
  await page.getByRole('button', { name: 'Record handover', exact: true }).click();
  await expect(page.getByText(/Handover CHO-\d{6}-\d{4} recorded/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Count cash' })).toHaveCount(0, { timeout: 30_000 });
});

test('a pre-approved party: the munshi dispatches on credit alone, and the gate calls it credit-approved', async ({
  page,
  request,
  loginAs,
}) => {
  test.setTimeout(300_000);
  const truck = plate();
  const { partyId, bags } = await weighedTruck(request, truck, { label: 'Solo Credit' });
  await truckInside(request, truck);
  const approve = await request.post(`${API_URL}/v1/parties/${partyId}/credit-approval`, {
    headers: await authHeaders('MANAGER'),
    data: { max_outstanding_pkr: 1_000_000 },
  });
  expect(approve.ok(), await approve.text()).toBeTruthy();
  await page.route('**/dispatch-note', (route) => route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' }));

  await loginAs('OPERATOR');
  await page.goto('/dispatch');
  const row = page.locator('tr', { hasText: truck });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /Dispatch & Collect/ }).click();
  await page.getByRole('button', { name: 'On credit' }).click();
  await page.getByRole('button', { name: /Dispatch on credit Rs\s?[\d,]+/ }).click();
  await expect(page.getByText(/Dispatched — bill on credit/i).first()).toBeVisible({ timeout: 30_000 });

  await loginAs('SECURITY');
  await page.goto('/gate');
  const ready = page.locator('li', { hasText: truck }).filter({ has: page.getByRole('button', { name: 'Release' }) });
  await expect(ready).toBeVisible({ timeout: 30_000 });
  await expect(ready.getByText(/Credit approved/i)).toBeVisible();
  await ready.getByRole('button', { name: 'Release' }).click();
  await page.getByLabel(/bags counted/i).fill(String(bags));
  await page.getByRole('button', { name: /^clear outward$/i }).click();
  await expect(page.getByText(/Cleared .*TAT/i).first()).toBeVisible({ timeout: 30_000 });
});

test('a KATCHI-book truck: the munshi is told a manager must finish it', async ({ page, request, loginAs }) => {
  test.setTimeout(180_000);
  const truck = plate();
  await weighedTruck(request, truck, { label: 'Solo Katchi', book: 'KATCHI' });

  await loginAs('OPERATOR');
  await page.goto('/dispatch');
  const row = page.locator('tr', { hasText: truck });
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole('button', { name: /Dispatch & Collect/ }).click();
  await expect(page.getByText(/needs a manager — a KATCHI-book bill is a manager decision/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: /Dispatch & Collect Rs/ })).toBeDisabled();
});
