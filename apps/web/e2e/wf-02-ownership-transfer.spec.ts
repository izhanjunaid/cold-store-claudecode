/**
 * WF-02 Mid-Storage Ownership Transfer (docs/12_e2e_workflows.md §2).
 *
 * Manager partially transfers ownership of a lot. Asserts:
 *   - child lot with -T1 suffix exists
 *   - transfer acknowledgment PDF endpoint returns application/pdf
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-02 — Mid-Storage Ownership Transfer', () => {
  test('manager runs PARTIAL transfer; child lot + ack PDF available', async ({
    page,
    request,
    loginAs,
  }) => {
    const session = await loginAs('MANAGER');
    const headers = {
      Authorization: `Bearer ${session.accessToken}`,
      'X-Facility-ID': FACILITY_ID,
    };

    // Seed: two parties, one lot.
    const partyA = await (
      await request.post(`${API_URL}/v1/parties`, {
        data: {
          name: `WF02 From ${Date.now()}`,
          party_type: 'FARMER',
          phone_primary: `0302${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
          credit_terms_days: 30,
        },
        headers,
      })
    ).json();
    const partyB = await (
      await request.post(`${API_URL}/v1/parties`, {
        data: {
          name: `WF02 To ${Date.now()}`,
          party_type: 'TRADER',
          phone_primary: `0303${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
          credit_terms_days: 30,
        },
        headers,
      })
    ).json();

    const commodities = (await (await request.get(`${API_URL}/v1/commodities`, { headers })).json()).data;
    const chambers = (await (await request.get(`${API_URL}/v1/chambers`, { headers })).json()).data;
    const ratePlans = (await (await request.get(`${API_URL}/v1/rate-plans`, { headers })).json()).data;

    const lot = (
      await (
        await request.post(`${API_URL}/v1/lots`, {
          data: {
            owner_party_id: partyA.data.id,
            commodity_id: commodities[0].id,
            rate_plan_id: ratePlans[0].id,
            chamber_id: chambers[0].id,
            quantity_bags: 40,
            accepted_weight_kg: 800,
            inbound_date: new Date().toISOString().slice(0, 10),
          },
          headers,
        })
      ).json()
    ).data;

    // Run the transfer.
    const transferRes = await request.post(`${API_URL}/v1/lots/${lot.id}/transfer`, {
      data: {
        transfer_type: 'PARTIAL',
        to_party_id: partyB.data.id,
        quantity_bags: 15,
        transfer_price_pkr: 500,
        effective_date: new Date().toISOString().slice(0, 10),
      },
      headers,
    });
    expect(transferRes.ok()).toBeTruthy();
    const transfer = (await transferRes.json()).data;
    expect(transfer.child_lot_id).toBeTruthy();
    expect(transfer.child_lot_number).toContain('-T1');

    // UI smoke: parent lot detail should now show the transfer.
    await page.goto(`/lots/${lot.id}`);
    await expect(page.getByText(lot.lot_number)).toBeVisible();

    // Acknowledgment PDF.
    const ackRes = await request.get(
      `${API_URL}/v1/lots/${lot.id}/transfer/${transfer.id}/acknowledgment`,
      { headers },
    );
    expect(ackRes.ok()).toBeTruthy();
    expect(ackRes.headers()['content-type']).toContain('application/pdf');
  });
});
