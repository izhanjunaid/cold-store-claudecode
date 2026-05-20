/**
 * WF-03 Partial Withdrawal with Service Charges (docs/12_e2e_workflows.md §3).
 *
 * Operator partially withdraws bags, weight is recorded, finalize creates a
 * DRAFT invoice with auto-generated line items.
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-03 — Partial Withdrawal', () => {
  test('operator withdraws portion → finalize creates DRAFT invoice with lines', async ({
    page,
    request,
    loginAs,
  }) => {
    const op = await loginAs('OPERATOR');
    const mgrSession = await fetch(`${API_URL}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
      body: JSON.stringify({ email: 'manager@coldchain.pk', password: 'admin123' }),
    }).then((r) => r.json());

    const opHeaders = { Authorization: `Bearer ${op.accessToken}`, 'X-Facility-ID': FACILITY_ID };
    const mgrHeaders = {
      Authorization: `Bearer ${mgrSession.data.access_token}`,
      'X-Facility-ID': FACILITY_ID,
    };

    const party = (
      await (
        await request.post(`${API_URL}/v1/parties`, {
          data: {
            name: `WF03 Farmer ${Date.now()}`,
            party_type: 'FARMER',
            phone_primary: `0304${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
            credit_terms_days: 30,
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    const commodities = (await (await request.get(`${API_URL}/v1/commodities`, { headers: opHeaders })).json()).data;
    const chambers = await (await request.get(`${API_URL}/v1/chambers`, { headers: opHeaders })).json();
    const ratePlans = (await (await request.get(`${API_URL}/v1/rate-plans`, { headers: opHeaders })).json()).data;

    // Inbound 60 days ago so MONTHLY rate plans produce a non-zero invoice.
    const inboundDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lot = (
      await (
        await request.post(`${API_URL}/v1/lots`, {
          data: {
            owner_party_id: party.id,
            commodity_id: commodities[0].id,
            rate_plan_id: ratePlans[0].id,
            chamber_id: chambers[0].id,
            quantity_bags: 50,
            accepted_weight_kg: 1000,
            inbound_date: inboundDate,
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    // Partial withdrawal.
    const outbound = (
      await (
        await request.post(`${API_URL}/v1/outbound-events`, {
          data: {
            lot_id: lot.id,
            withdrawal_type: 'PARTIAL',
            quantity_withdrawn_bags: 20,
            outbound_date: new Date().toISOString().slice(0, 10),
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    // Record weight.
    await request.patch(`${API_URL}/v1/outbound-events/${outbound.id}/weight`, {
      data: { outbound_weight_kg: 395 },
      headers: opHeaders,
    });

    // Finalize → DRAFT invoice id.
    const finRes = await request.post(`${API_URL}/v1/outbound-events/${outbound.id}/finalize`, {
      data: {},
      headers: mgrHeaders,
    });
    expect(finRes.ok()).toBeTruthy();
    const invoiceId = (await finRes.json()).data.invoice_id as string;

    // Inspect the draft invoice.
    const invoice = (
      await (await request.get(`${API_URL}/v1/invoices/${invoiceId}`, { headers: mgrHeaders })).json()
    ).data;
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.line_items.length).toBeGreaterThan(0);
    const hasStorage = invoice.line_items.some((li: { line_type: string }) => li.line_type === 'STORAGE');
    expect(hasStorage).toBe(true);

    // UI smoke: navigate to the invoice detail page.
    await page.goto(`/invoices/${invoiceId}`);
    await expect(page.getByText(/DRAFT/i).first()).toBeVisible();
  });
});
