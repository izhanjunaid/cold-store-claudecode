/**
 * WF-04 Full Withdrawal & Season Settlement (docs/12_e2e_workflows.md §4).
 *
 * Full withdrawal → invoice finalize → payment → balance_due = 0.
 * Mirrors the existing WF-04 integration test but exercises the UI path.
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-04 — Full Withdrawal & Settlement', () => {
  test('full lifecycle: lot → withdraw → finalize invoice → pay → balance_due=0', async ({
    page,
    request,
    loginAs,
  }) => {
    const op = await loginAs('OPERATOR');
    const mgrSession = (
      await (
        await fetch(`${API_URL}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
          body: JSON.stringify({ email: 'manager@coldchain.pk', password: 'admin123' }),
        })
      ).json()
    ).data;
    const acctSession = (
      await (
        await fetch(`${API_URL}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
          body: JSON.stringify({ email: 'accountant@coldchain.pk', password: 'admin123' }),
        })
      ).json()
    ).data;

    const opHeaders = { Authorization: `Bearer ${op.accessToken}`, 'X-Facility-ID': FACILITY_ID };
    const mgrHeaders = { Authorization: `Bearer ${mgrSession.access_token}`, 'X-Facility-ID': FACILITY_ID };
    const acctHeaders = {
      Authorization: `Bearer ${acctSession.access_token}`,
      'X-Facility-ID': FACILITY_ID,
    };

    const party = (
      await (
        await request.post(`${API_URL}/v1/parties`, {
          data: {
            name: `WF04 Farmer ${Date.now()}`,
            party_type: 'FARMER',
            phone_primary: `0305${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
            credit_terms_days: 30,
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    const commodities = (await (await request.get(`${API_URL}/v1/commodities`, { headers: opHeaders })).json()).data;
    const chambers = (await (await request.get(`${API_URL}/v1/chambers`, { headers: opHeaders })).json()).data;
    const ratePlans = (await (await request.get(`${API_URL}/v1/rate-plans`, { headers: opHeaders })).json()).data;

    const inboundDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lot = (
      await (
        await request.post(`${API_URL}/v1/lots`, {
          data: {
            owner_party_id: party.id,
            commodity_id: commodities[0].id,
            rate_plan_id: ratePlans[0].id,
            chamber_id: chambers[0].id,
            quantity_bags: 25,
            accepted_weight_kg: 500,
            inbound_date: inboundDate,
          },
          headers: opHeaders,
        })
      ).json()
    ).data;

    // FULL withdrawal.
    const outbound = (
      await (
        await request.post(`${API_URL}/v1/outbound-events`, {
          data: {
            lot_id: lot.id,
            withdrawal_type: 'FULL',
            quantity_withdrawn_bags: 25,
            outbound_date: new Date().toISOString().slice(0, 10),
          },
          headers: opHeaders,
        })
      ).json()
    ).data;
    await request.patch(`${API_URL}/v1/outbound-events/${outbound.id}/weight`, {
      data: { outbound_weight_kg: 495 },
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

    // Finalize the invoice.
    const finalRes = await request.post(`${API_URL}/v1/invoices/${draftInvoiceId}/finalize`, {
      data: {},
      headers: mgrHeaders,
    });
    expect(finalRes.ok()).toBeTruthy();
    const invoice = (await finalRes.json()).data;
    expect(invoice.status).toBe('FINALIZED');
    expect(Number(invoice.total_pkr)).toBeGreaterThan(0);

    // Record a CASH payment matching the invoice total.
    const payRes = await request.post(`${API_URL}/v1/payments`, {
      data: {
        party_id: party.id,
        amount_pkr: Number(invoice.total_pkr),
        payment_method: 'CASH',
        payment_date: new Date().toISOString().slice(0, 10),
        book_type: 'PACCI',
        allocations: [{ target: 'INVOICE', invoice_id: invoice.id, amount_pkr: Number(invoice.total_pkr) }],
      },
      headers: acctHeaders,
    });
    expect(payRes.ok()).toBeTruthy();

    // Re-fetch invoice → balance_due should be 0.
    const settledInvoice = (
      await (
        await request.get(`${API_URL}/v1/invoices/${invoice.id}`, { headers: acctHeaders })
      ).json()
    ).data;
    expect(Number(settledInvoice.balance_due_pkr)).toBe(0);

    // UI smoke.
    await page.goto(`/invoices/${invoice.id}`);
    await expect(page.getByText(invoice.invoice_number)).toBeVisible();
  });
});
