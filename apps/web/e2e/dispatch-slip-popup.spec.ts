/**
 * The load slip opens in a new tab even when it takes a while to render (fast-dispatch C2).
 *
 * Playwright launches Chromium with its pop-up blocker off; a desk PC's Chrome has it on. Chrome only
 * lets a page open a tab while the click that asked for it still counts as the user's — about five
 * seconds — and Chromium on a busy box can take longer than that to render a slip. So this file turns
 * the blocker back on (it is a launch option, hence a file of its own) and slows the slip down.
 */
import { test, expect, API_URL } from './fixtures';
import { authHeaders, getFacilityRefs, isoDaysAgo, todayISO } from './helpers/season-helpers';

test.use({ launchOptions: { ignoreDefaultArgs: ['--disable-popup-blocking'] } });

const plate = () => `LHR-${1000 + Math.floor(Math.random() * 8999)}`;

test('"Load slip" opens its tab even when the slip takes a while to render', async ({ page, request, loginAs }) => {
  test.setTimeout(300_000);
  const op = await authHeaders('OPERATOR');
  const mgr = await authHeaders('MANAGER');
  const sec = await authHeaders('SECURITY');
  const refs = await getFacilityRefs(request, op);
  const tag = Date.now().toString(36).slice(-5).toUpperCase();
  const truck = plate();

  // A truck already checked out (through the API): its card offers the slip.
  const party = await request.post(`${API_URL}/v1/parties`, {
    headers: op,
    data: { name: `Slip Farmer ${tag}`, party_type: 'FARMER', phone_primary: `0316${Math.floor(Math.random() * 9_000_000 + 1_000_000)}` },
  });
  expect(party.ok(), await party.text()).toBeTruthy();
  const partyId = (await party.json()).data.id as string;
  const inward = await request.post(`${API_URL}/v1/gate-passes/inward`, { headers: sec, data: { vehicle_number: truck } });
  expect(inward.ok(), await inward.text()).toBeTruthy();
  const passId = (await inward.json()).data.id as string;
  for (const bags of [10, 8]) {
    const lotRes = await request.post(`${API_URL}/v1/lots`, {
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
    expect(lotRes.ok(), await lotRes.text()).toBeTruthy();
    const book = await request.post(`${API_URL}/v1/outbound-events`, {
      headers: op,
      data: { lot_id: (await lotRes.json()).data.id, withdrawal_type: 'PARTIAL', quantity_withdrawn_bags: bags - 2, outbound_date: todayISO(), vehicle_number: truck },
    });
    expect(book.ok(), await book.text()).toBeTruthy();
    const weigh = await request.patch(`${API_URL}/v1/outbound-events/${(await book.json()).data.id}/weight`, {
      headers: op,
      data: { outbound_weight_kg: (bags - 2) * 19.5 },
    });
    expect(weigh.ok(), await weigh.text()).toBeTruthy();
  }
  const preview = (await (await request.get(`${API_URL}/v1/dispatch/trucks/${passId}/checkout-preview`, { headers: mgr })).json()).data as {
    lines: { outbound_id: string; total_pkr: number }[];
    groups: { billing_party: { id: string }; book_type: string }[];
  };
  const out = await request.post(`${API_URL}/v1/dispatch/trucks/${passId}/dispatch-and-collect`, {
    headers: mgr,
    data: {
      lines: preview.lines.map((l) => ({ outbound_id: l.outbound_id, expected_total_pkr: l.total_pkr })),
      payments: preview.groups.map((g) => ({ billing_party_id: g.billing_party.id, book_type: g.book_type, mode: 'CASH' })),
    },
  });
  expect(out.ok(), await out.text()).toBeTruthy();

  // The slip takes longer than the click's grace period, as Chromium on a busy desk PC can.
  await page.route('**/load-slip', async (route) => {
    await new Promise((r) => setTimeout(r, 6_500));
    await route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.4\n%%EOF' });
  });
  await loginAs('MANAGER');
  await page.goto('/dispatch');
  const card = page.locator('[data-truck]', { has: page.locator('[data-truck-plate]', { hasText: truck }) });
  await expect(card.getByRole('button', { name: 'Load slip' })).toBeVisible({ timeout: 20_000 });

  const popup = page.waitForEvent('popup', { timeout: 20_000 });
  await card.getByRole('button', { name: 'Load slip' }).click();
  expect(await popup).toBeTruthy();
});
