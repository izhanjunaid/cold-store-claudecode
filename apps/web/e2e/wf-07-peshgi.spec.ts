/**
 * WF-07 Peshgi Loan Issue & Recovery (docs/12_e2e_workflows.md §7).
 *
 * Owner issues a loan, manager records a repayment, loan transitions to RECOVERED.
 */
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';

test.beforeAll(async () => {
  await resetFacility();
});

test.describe('WF-07 — Peshgi Issue & Recovery', () => {
  test('owner issues a loan; manager records full repayment; loan RECOVERED', async ({
    page,
    request,
    loginAs,
  }) => {
    const owner = await loginAs('OWNER');
    const mgr = (
      await (
        await fetch(`${API_URL}/v1/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Facility-ID': FACILITY_ID },
          body: JSON.stringify({ email: 'manager@coldchain.pk', password: 'admin123' }),
        })
      ).json()
    ).data;

    const ownerHeaders = { Authorization: `Bearer ${owner.accessToken}`, 'X-Facility-ID': FACILITY_ID };
    const mgrHeaders = { Authorization: `Bearer ${mgr.access_token}`, 'X-Facility-ID': FACILITY_ID };

    // Seed a borrower party.
    const party = (
      await (
        await request.post(`${API_URL}/v1/parties`, {
          data: {
            name: `WF07 Borrower ${Date.now()}`,
            party_type: 'FARMER',
            phone_primary: `0307${(Date.now() % 1_000_000).toString().padStart(7, '0').slice(0, 7)}`,
            credit_terms_days: 30,
          },
          headers: ownerHeaders,
        })
      ).json()
    ).data;

    // Issue loan (OWNER-only).
    const loanRes = await request.post(`${API_URL}/v1/loans/issue`, {
      data: {
        party_id: party.id,
        principal_pkr: 100_000,
        issue_date: new Date().toISOString().slice(0, 10),
        payment_method: 'CASH',
        book_type: 'PACCI',
        notes: 'WF-07 E2E loan',
      },
      headers: ownerHeaders,
    });
    expect(loanRes.ok()).toBeTruthy();
    const loan = (await loanRes.json()).data;
    expect(loan.status).toBe('ACTIVE');

    // UI smoke: loan detail.
    await page.goto(`/loans/${loan.id}`);
    await expect(page.getByText(loan.loan_number)).toBeVisible();

    // Record full repayment as MANAGER.
    const repayRes = await request.post(`${API_URL}/v1/loans/${loan.id}/repayments`, {
      data: {
        amount_pkr: 100_000,
        payment_method: 'CASH',
        repayment_date: new Date().toISOString().slice(0, 10),
      },
      headers: mgrHeaders,
    });
    expect(repayRes.ok()).toBeTruthy();

    // Re-fetch — loan should be RECOVERED, balance 0.
    const updated = (
      await (await request.get(`${API_URL}/v1/loans/${loan.id}`, { headers: ownerHeaders })).json()
    ).data;
    expect(updated.status).toBe('RECOVERED');
    expect(Number(updated.balance_outstanding_pkr)).toBe(0);
  });
});
