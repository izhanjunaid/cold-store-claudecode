/**
 * WF-06 Month-End Financial Reconciliation (docs/12_e2e_workflows.md §6).
 *
 * Accountant opens receivables aging and downloads a party statement PDF.
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-06 — Month-End Reconciliation', () => {
  test('accountant lands on receivables aging and downloads party statement PDF', async ({
    page,
    request,
    loginAs,
  }) => {
    const acct = await loginAs('ACCOUNTANT');
    const headers = {
      Authorization: `Bearer ${acct.accessToken}`,
      'X-Facility-ID': FACILITY_ID,
    };

    // Receivables aging endpoint should respond (even with zero open AR after reset).
    const agingRes = await request.get(`${API_URL}/v1/reports/receivables-aging`, { headers });
    expect(agingRes.ok()).toBeTruthy();

    // UI: receivables aging page renders.
    await page.goto('/reports/receivables-aging');
    await expect(page.getByRole('heading', { name: /receivables aging/i })).toBeVisible();

    // Seed one party so we have something to statement.
    const partyRes = await request.post(`${API_URL}/v1/parties`, {
      data: {
        name: `WF06 Party ${Date.now()}`,
        party_type: 'TRADER',
        phone_primary: `0306${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
        credit_terms_days: 30,
      },
      headers,
    });
    const partyId = (await partyRes.json()).data.id as string;

    // Party-statement PDF should return application/pdf.
    const pdfRes = await request.get(
      `${API_URL}/v1/reports/party-statement/${partyId}?format=pdf&book_type=PACCI`,
      { headers },
    );
    expect(pdfRes.ok()).toBeTruthy();
    expect(pdfRes.headers()['content-type']).toContain('application/pdf');
  });
});
