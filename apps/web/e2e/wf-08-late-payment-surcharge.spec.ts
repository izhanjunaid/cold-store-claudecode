/**
 * WF-08 Late Payment Surcharge (Phase 12 configurability).
 *
 * Enable the surcharge rule in facility settings → finalize an invoice and
 * backdate it overdue → accountant applies the suggested surcharge → the
 * surcharge appears in the invoice balance → a payment settles total +
 * surcharge → balance_due = 0.
 *
 * The invoice is backdated directly via a small admin helper rather than by
 * waiting real days; everything else goes through the public API/UI.
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

async function login(role: 'OWNER' | 'MANAGER' | 'ACCOUNTANT' | 'OPERATOR') {
  const creds: Record<string, { email: string; password: string }> = {
    OWNER: { email: 'admin@coldchain.pk', password: 'admin123' },
    MANAGER: { email: 'manager@coldchain.pk', password: 'admin123' },
    ACCOUNTANT: { email: 'accountant@coldchain.pk', password: 'admin123' },
    OPERATOR: { email: 'operator@coldchain.pk', password: 'admin123' },
  };
  const res = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
    body: JSON.stringify(creds[role]),
  });
  const body = (await res.json()).data;
  return {
    Authorization: `Bearer ${body.access_token}`,
    'X-Facility-ID': FACILITY_ID,
  } as Record<string, string>;
}

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-08 — Late Payment Surcharge', () => {
  test('enable rule → apply surcharge on overdue invoice → settle total + surcharge', async ({
    request,
  }) => {
    const ownerHeaders = await login('OWNER');
    const opHeaders = await login('OPERATOR');
    const mgrHeaders = await login('MANAGER');
    const acctHeaders = await login('ACCOUNTANT');

    // 1. Owner enables the surcharge rule: 2%/month, 30-day grace.
    const settingsRes = await request.patch(`${API_URL}/v1/facilities/me`, {
      data: {
        settings: { late_payment_surcharge: { enabled: true, pct_per_month: 2, grace_days: 30 } },
      },
      headers: ownerHeaders,
    });
    expect(settingsRes.ok()).toBeTruthy();

    // 2. Build a finalized invoice via the normal flow.
    const party = (
      await (
        await request.post(`${API_URL}/v1/parties`, {
          data: {
            name: `WF08 Trader ${Date.now()}`,
            party_type: 'TRADER',
            phone_primary: `0306${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
            credit_terms_days: 30,
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    const commodities = (await (await request.get(`${API_URL}/v1/commodities`, { headers: opHeaders })).json()).data;
    const chambers = await (await request.get(`${API_URL}/v1/chambers`, { headers: opHeaders })).json();
    const ratePlans = (await (await request.get(`${API_URL}/v1/rate-plans`, { headers: opHeaders })).json()).data;

    const lot = (
      await (
        await request.post(`${API_URL}/v1/lots`, {
          data: {
            owner_party_id: party.id,
            commodity_id: commodities[0].id,
            rate_plan_id: ratePlans[0].id,
            chamber_id: chambers[0].id,
            quantity_bags: 20,
            accepted_weight_kg: 400,
            inbound_date: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    const outbound = (
      await (
        await request.post(`${API_URL}/v1/outbound-events`, {
          data: {
            lot_id: lot.id,
            withdrawal_type: 'FULL',
            quantity_withdrawn_bags: 20,
            outbound_date: new Date().toISOString().slice(0, 10),
          },
          headers: opHeaders,
        })
      ).json()
    ).data;
    await request.patch(`${API_URL}/v1/outbound-events/${outbound.id}/weight`, {
      data: { outbound_weight_kg: 390 },
      headers: opHeaders,
    });
    const draftInvoiceId = (
      await (
        await request.post(`${API_URL}/v1/outbound-events/${outbound.id}/finalize`, {
          data: {},
          headers: mgrHeaders,
        })
      ).json()
    ).data.invoice_id;

    const invoice = (
      await (
        await request.post(`${API_URL}/v1/invoices/${draftInvoiceId}/finalize`, {
          data: {},
          headers: mgrHeaders,
        })
      ).json()
    ).data;
    const baseTotal = Number(invoice.total_pkr);
    expect(baseTotal).toBeGreaterThan(0);

    // 3. Make the invoice overdue (100 days) via the E2E admin helper.
    const backdateRes = await fetch(`${API_URL}/v1/_test/backdate-invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoice_id: invoice.id, days_overdue: 100 }),
    });
    expect(backdateRes.ok).toBeTruthy();

    // 4. Accountant sees the suggestion.
    const suggestions = (
      await (
        await request.get(`${API_URL}/v1/surcharges/suggestions`, { headers: acctHeaders })
      ).json()
    ).data;
    expect(suggestions.enabled).toBe(true);
    const suggestion = suggestions.suggestions.find((s: { invoice_id: string }) => s.invoice_id === invoice.id);
    expect(suggestion).toBeDefined();
    expect(suggestion.chargeable_months).toBe(2); // (100 - 30) / 30 → 2
    const surchargeAmount = Number(suggestion.suggested_amount_pkr);
    expect(surchargeAmount).toBeCloseTo(baseTotal * 0.02 * 2, 2);

    // 5. Apply it (one-click).
    const applyRes = await request.post(`${API_URL}/v1/invoices/${invoice.id}/surcharges`, {
      data: {},
      headers: acctHeaders,
    });
    expect(applyRes.ok()).toBeTruthy();

    // 6. Invoice balance now includes the surcharge.
    const withSurcharge = (
      await (
        await request.get(`${API_URL}/v1/invoices/${invoice.id}`, { headers: acctHeaders })
      ).json()
    ).data;
    expect(Number(withSurcharge.surcharge_total_pkr)).toBeCloseTo(surchargeAmount, 2);
    expect(Number(withSurcharge.balance_due_pkr)).toBeCloseTo(baseTotal + surchargeAmount, 2);

    // 7. A payment for total + surcharge settles the invoice fully.
    const settleAmount = baseTotal + surchargeAmount;
    const payRes = await request.post(`${API_URL}/v1/payments`, {
      data: {
        party_id: party.id,
        amount_pkr: settleAmount,
        payment_method: 'CASH',
        payment_date: new Date().toISOString().slice(0, 10),
        book_type: 'PACCI',
        allocations: [
          { target: 'INVOICE', invoice_id: invoice.id, allocated_amount_pkr: settleAmount },
        ],
      },
      headers: acctHeaders,
    });
    expect(payRes.ok()).toBeTruthy();

    const settled = (
      await (
        await request.get(`${API_URL}/v1/invoices/${invoice.id}`, { headers: acctHeaders })
      ).json()
    ).data;
    expect(Number(settled.balance_due_pkr)).toBe(0);
  });
});
