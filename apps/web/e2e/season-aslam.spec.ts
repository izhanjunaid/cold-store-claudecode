/**
 * Muhammad Aslam's potato season — end-to-end UI walkthrough.
 *
 * Single farmer, single lot, three withdrawals spanning the season:
 *   1. Create party (OPERATOR)
 *   2. Gate inward + lot creation + parchi (SECURITY + OPERATOR)
 *   3. Link gate pass to lot
 *   4. Withdrawal #1 — 200 bags, cash payment, gate cleared
 *   5. Withdrawal #2 — 200 bags, cheque payment, gate cleared
 *   6. Withdrawal #3 — 100 bags FULL, partial payment + manager credit override
 *   7. Ledger review
 *
 * Captures one screenshot per major UI checkpoint to test-results/season-aslam/.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test, expect, API_URL, FACILITY_ID, resetFacility } from './fixtures';
import {
  ARTIFACT_DIR,
  authHeaders,
  getFacilityRefs,
  isoDaysAgo,
  shot,
  todayISO,
} from './helpers/season-helpers';
import { pickCombobox } from './helpers/ui';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
  await resetFacility();
});

test.describe('Muhammad Aslam — full potato season', () => {
  test('walks the entire season end-to-end', async ({ page, request, loginAs }) => {
    test.setTimeout(900_000);

    // Shared state across steps. We uniquify plates with a short tag so prior
    // runs (when ALLOW_TEST_RESET is off) don't make assertions brittle.
    const runTag = Date.now().toString(36).slice(-5).toUpperCase();
    const aslam = {
      name: `Muhammad Aslam ${runTag}`,
      phone: `0311${Math.floor(Math.random() * 9_000_000 + 1_000_000)}`,
    };
    const plates = {
      inbound: `LHR-${runTag}A`,
      out1: `LHR-${runTag}B`,
      out2: `LHR-${runTag}C`,
      out3: `LHR-${runTag}D`,
    };
    let partyId = '';
    let lotId = '';
    let lotNumber = '';
    let inwardPassId = '';

    const opHeaders = await authHeaders('OPERATOR');
    const mgrHeaders = await authHeaders('MANAGER');
    const acctHeaders = await authHeaders('ACCOUNTANT');
    const refs = await getFacilityRefs(request, opHeaders);

    // ─────────────────────────────────────────────────────────────────────
    await test.step('01 — create party Muhammad Aslam (OPERATOR)', async () => {
      await loginAs('OPERATOR');
      await page.goto('/parties/new');
      await expect(page.getByRole('heading', { name: /create.*party|new party/i })).toBeVisible({
        timeout: 15_000,
      });

      await page.locator('input[name="name"]').fill(aslam.name);
      await page.locator('input[name="name_urdu"]').fill('محمد اسلم');
      await page.locator('select[name="party_type"]').selectOption('FARMER');
      await page.locator('input[name="phone_primary"]').fill(aslam.phone);
      await page.locator('input[name="cnic"]').fill('35202-1234567-1');
      await page.locator('input[name="credit_limit_pkr"]').fill('250000');
      await page.locator('input[name="credit_terms_days"]').fill('45');
      await page.locator('input[name="address"]').fill('Chak 456, Okara District, Punjab');
      await page.locator('textarea[name="notes"]').fill('Reliable repeat customer; Sadaf variety grower.');

      await shot(page, '01a-party-form.png');

      await Promise.all([
        page.waitForURL(/\/parties\/[0-9a-f-]{36}/, { timeout: 15_000 }),
        page.getByRole('button', { name: /create party/i }).click(),
      ]);

      partyId = page.url().split('/parties/')[1]!.split(/[/?#]/)[0]!;
      expect(partyId).toMatch(/^[0-9a-f-]{36}$/);

      await expect(page.getByText(aslam.name).first()).toBeVisible();
      await shot(page, '01b-party-detail.png');
    });

    // ─────────────────────────────────────────────────────────────────────
    await test.step('02 — gate inward (SECURITY logs LHR-5234)', async () => {
      await loginAs('SECURITY');
      await page.goto('/gate');
      await expect(page.getByRole('heading', { name: /gate pass console/i })).toBeVisible({
        timeout: 15_000,
      });

      const vehicle = page.locator('input[type="text"]').first();
      await vehicle.fill(plates.inbound);
      // Tab to trigger blur uppercase, then fill rest
      await page.locator('input[placeholder="Ali Khan"]').fill('Khalid Mehmood');
      await page.locator('input[placeholder="0300-1234567"]').fill('0300-111-2222');
      await page.locator('input[placeholder*="transporter"]').fill(`TR-2026-${runTag}`);

      await shot(page, '02a-gate-arrival-form.png');

      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/v1/gate-passes/inward') && r.request().method() === 'POST',
        ),
        page.getByRole('button', { name: /log inward/i }).click(),
      ]);

      // Wait for the truck to show up in the "Vehicles Currently Inside" list
      await expect(page.getByText(plates.inbound).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, '02b-gate-console-with-truck.png');

      // Capture inward pass id via API
      const list = await request.get(
        `${API_URL}/v1/gate-passes?vehicle=${plates.inbound}&direction=INWARD&page_size=5`,
        { headers: opHeaders },
      );
      const listJson = await list.json();
      const passes = listJson.data ?? listJson;
      inwardPassId = passes[0]?.id;
      expect(inwardPassId).toBeTruthy();
    });

    // ─────────────────────────────────────────────────────────────────────
    await test.step('03 — create lot (OPERATOR) + bilingual parchi', async () => {
      await loginAs('OPERATOR');
      await page.goto('/lots/new');
      await expect(page.getByRole('heading', { name: /new inbound lot/i })).toBeVisible({
        timeout: 15_000,
      });

      // Wait for the reference data to populate (commodity is a native select).
      await expect(page.locator(`select[name="commodity_id"] option[value="${refs.commodityId}"]`)).toHaveCount(1, {
        timeout: 15_000,
      });

      // Owner is now a type-ahead Combobox (large party list).
      await pickCombobox(page, 'combobox-owner_party_id', aslam.name);
      await page.locator('select[name="commodity_id"]').selectOption(refs.commodityId);
      // Wait for chambers + rate plans to filter after commodity selection
      await expect(page.locator(`select[name="chamber_id"] option[value="${refs.chamberId}"]`)).toHaveCount(1, {
        timeout: 5_000,
      });
      await page.locator('select[name="chamber_id"]').selectOption(refs.chamberId);
      await page.locator('select[name="rate_plan_id"]').selectOption(refs.seasonalRatePlanId);
      await page.locator('input[name="quantity_bags"]').fill('500');
      await page.locator('input[name="accepted_weight_kg"]').fill('49850');
      await page.locator('input[name="declared_weight_kg"]').fill('50000');
      // 150 kg variance exceeds the facility's 5 kg dispute threshold → note required.
      await expect(page.locator('textarea[name="weight_dispute_note"]')).toBeVisible({ timeout: 5_000 });
      await page
        .locator('textarea[name="weight_dispute_note"]')
        .fill('150 kg shrinkage accepted by farmer at weigh-in.');
      await page.locator('input[name="vehicle_number"]').fill(plates.inbound);
      await page.locator('select[name="quality_grade_inbound"]').selectOption('A');
      // Inbound 120 days ago — well inside the seeded "Potato Seasonal 2026" window (Mar 1 – Sep 30)
      await page.locator('input[name="inbound_date"]').fill(isoDaysAgo(60));

      await shot(page, '03a-lot-form.png');

      await Promise.all([
        page.waitForURL(/\/lots\/[0-9a-f-]{36}/, { timeout: 30_000 }),
        page.getByRole('button', { name: /create inbound lot/i }).click(),
      ]);

      lotId = page.url().split('/lots/')[1]!.split(/[/?#]/)[0]!;
      expect(lotId).toMatch(/^[0-9a-f-]{36}$/);

      const lotInfo = await (
        await request.get(`${API_URL}/v1/lots/${lotId}`, { headers: opHeaders })
      ).json();
      lotNumber = (lotInfo.data ?? lotInfo).lot_number;
      expect(lotNumber).toBeTruthy();

      await shot(page, '03b-lot-detail.png');

      // Fetch the parchi PDF and save it (best-effort — Puppeteer in dev can be slow).
      // Skippable: on dev boxes where Chromium can't launch, a PDF request wedges
      // the API event loop, so E2E_SKIP_PDF lets the UI flow be verified standalone.
      if (!process.env['E2E_SKIP_PDF']) {
        try {
          const pdfRes = await request.get(`${API_URL}/v1/lots/${lotId}/receipt`, {
            headers: opHeaders,
            timeout: 60_000,
          });
          if (pdfRes.ok() && (pdfRes.headers()['content-type'] ?? '').match(/pdf/i)) {
            fs.writeFileSync(path.join(ARTIFACT_DIR, '03c-parchi.pdf'), await pdfRes.body());
          } else {
            console.warn(`parchi PDF skipped (status ${pdfRes.status()})`);
          }
        } catch (err) {
          console.warn(`parchi PDF threw: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });

    // ─────────────────────────────────────────────────────────────────────
    await test.step('04 — link gate pass to lot', async () => {
      const linkRes = await request.patch(
        `${API_URL}/v1/gate-passes/${inwardPassId}/link-lot`,
        {
          headers: { ...opHeaders, 'Content-Type': 'application/json' },
          data: { lot_id: lotId },
        },
      );
      expect(linkRes.ok()).toBeTruthy();

      // Verify the link succeeded server-side
      const verify = await (
        await request.get(`${API_URL}/v1/gate-passes/${inwardPassId}`, {
          headers: opHeaders,
        })
      ).json();
      const linked = verify.data ?? verify;
      expect(linked.status).toBe('WEIGHING');
      expect(linked.related_lot_number).toBe(lotNumber);

      // Best-effort UI screenshot — don't fail the test if the polluted dev DB
      // pushes our pass off the active list (page_size=50).
      await loginAs('SECURITY');
      await page.goto('/gate');
      await page
        .getByText(plates.inbound)
        .first()
        .waitFor({ timeout: 5_000 })
        .catch(() => {});
      await shot(page, '04-gate-after-link.png');
    });

    // ─────────────────────────────────────────────────────────────────────
    // Reusable inner helper that drives ONE withdrawal end-to-end through the UI.
    async function runWithdrawal(opts: {
      label: string;
      bags: number;
      weightKg: number;
      vehicle: string;
      withdrawalType: 'PARTIAL' | 'FULL';
      paymentMethod: 'CASH' | 'CHEQUE' | 'BANK_TRANSFER';
      paymentAmount: number; // PKR — what the accountant actually receives
      paymentRef?: string;
      creditAuthorize?: boolean; // true if the gate clear needs a manager override
      shotPrefix: string;
    }): Promise<{ invoiceId: string; invoiceTotal: number; balanceDueAfterPay: number }> {
      // (a) OPERATOR: create the withdrawal
      await loginAs('OPERATOR');
      await page.goto(`/lots/${lotId}/withdraw`);
      await expect(page.getByRole('heading', { name: /new withdrawal/i })).toBeVisible({
        timeout: 15_000,
      });
      await page.getByRole('button', { name: opts.withdrawalType === 'FULL' ? /^full \(/i : /^partial$/i }).click();
      if (opts.withdrawalType === 'PARTIAL') {
        await page.locator('input[type="number"]').first().fill(String(opts.bags));
      }
      await page.locator('input[type="date"]').fill(todayISO());
      await page.locator('input[placeholder="Optional"]').first().fill(opts.vehicle);
      await shot(page, `${opts.shotPrefix}-a-withdraw-form.png`);

      await Promise.all([
        page.waitForURL(/\/outbound-events\/[0-9a-f-]{36}/, { timeout: 30_000 }),
        page.getByRole('button', { name: /create withdrawal/i }).click(),
      ]);

      const outboundId = page.url().split('/outbound-events/')[1]!.split(/[/?#]/)[0]!;

      // (b) OPERATOR: record outbound weight
      await page.locator('input[type="number"]').first().fill(String(opts.weightKg));
      await Promise.all([
        page.waitForResponse((r) => r.url().includes(`/v1/outbound-events/${outboundId}/weight`)),
        page.getByRole('button', { name: /record weight/i }).click(),
      ]);
      await expect(page.getByText(/weighed/i).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, `${opts.shotPrefix}-b-outbound-weighed.png`);

      // (c) MANAGER: finalize + auto-invoice
      await loginAs('MANAGER');
      await page.goto(`/outbound-events/${outboundId}`);
      await page.getByRole('button', { name: /finalize.*dispatch/i }).click();
      await Promise.all([
        page.waitForResponse((r) =>
          r.url().includes(`/v1/outbound-events/${outboundId}/finalize`),
        ),
        page.getByRole('button', { name: /^confirm$/i }).click(),
      ]);
      await expect(page.getByText(/dispatched/i).first()).toBeVisible({ timeout: 10_000 });

      // Find the auto-generated draft invoice for this outbound
      const invListRes = await request.get(
        `${API_URL}/v1/invoices?lot_id=${lotId}&page_size=50`,
        { headers: mgrHeaders },
      );
      const invList = await invListRes.json();
      const allInvoices = invList.data ?? invList;
      // Latest invoice for this lot
      const draftInvoice = allInvoices[0];
      expect(draftInvoice).toBeTruthy();
      const invoiceId = draftInvoice.id as string;

      // (d) MANAGER: finalize the invoice
      await page.goto(`/invoices/${invoiceId}`);
      await expect(page.getByText(/DRAFT/i).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, `${opts.shotPrefix}-c-invoice-draft.png`);

      await page.getByRole('button', { name: /finalize invoice/i }).click();
      // Confirm modal may appear — accept any confirm-style button
      const confirmBtn = page.getByRole('button', { name: /^(confirm|yes|finalize)$/i });
      if (await confirmBtn.first().isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForResponse((r) => r.url().includes(`/v1/invoices/${invoiceId}/finalize`)),
          confirmBtn.first().click(),
        ]);
      } else {
        await page.waitForResponse((r) =>
          r.url().includes(`/v1/invoices/${invoiceId}/finalize`),
        );
      }
      // Wait for FINALIZED badge
      await expect(page.getByText(/FINALIZED/i).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, `${opts.shotPrefix}-d-invoice-finalized.png`);

      const finalInvoice = await (
        await request.get(`${API_URL}/v1/invoices/${invoiceId}`, { headers: mgrHeaders })
      ).json();
      const invoiceTotal = Number((finalInvoice.data ?? finalInvoice).total_pkr);
      expect(invoiceTotal).toBeGreaterThan(0);

      // (e) ACCOUNTANT: record the payment
      await loginAs('ACCOUNTANT');
      await page.goto(`/payments/new?party_id=${partyId}`);
      await expect(page.getByRole('heading', { name: /record payment/i })).toBeVisible({
        timeout: 15_000,
      });
      await page.locator('select').first().selectOption(partyId);
      // Amount and method
      await page.locator('input[type="number"]').first().fill(String(opts.paymentAmount));
      await page.locator('select').nth(1).selectOption(opts.paymentMethod);
      if (opts.paymentRef) {
        await page.locator('input[placeholder*="Cheque"]').fill(opts.paymentRef);
      }
      if (opts.paymentMethod === 'CHEQUE') {
        await page.locator('input[type="date"]').nth(1).fill(todayISO());
      }
      // Add allocation row, pick our invoice, fill balance
      await page.getByRole('button', { name: /\+ add invoice/i }).click();
      await page
        .locator('select')
        .last()
        .selectOption(invoiceId);
      await page
        .locator('input[type="number"]')
        .last()
        .fill(String(opts.paymentAmount));

      await shot(page, `${opts.shotPrefix}-e-payment-form.png`);

      await Promise.all([
        page.waitForURL(/\/payments\/[0-9a-f-]{36}/, { timeout: 30_000 }),
        page.getByRole('button', { name: /record payment/i }).click(),
      ]);

      // Re-fetch invoice for balance
      const settled = await (
        await request.get(`${API_URL}/v1/invoices/${invoiceId}`, { headers: acctHeaders })
      ).json();
      const balanceDueAfterPay = Number((settled.data ?? settled).balance_due_pkr);

      // (f) SECURITY logs the empty truck inward, then clears outward.
      await loginAs('SECURITY');
      await page.goto('/gate');
      await expect(page.getByRole('heading', { name: /gate pass console/i })).toBeVisible();
      await page.locator('input[type="text"]').first().fill(opts.vehicle);
      await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/v1/gate-passes/inward') && r.request().method() === 'POST',
        ),
        page.getByRole('button', { name: /log inward/i }).click(),
      ]);
      await expect(page.getByText(opts.vehicle).first()).toBeVisible({ timeout: 10_000 });

      // For credit-authorize scenario, we need MANAGER on the gate (only manager sees the checkbox).
      if (opts.creditAuthorize) {
        await loginAs('MANAGER');
        await page.goto('/gate');
        await expect(page.getByText(opts.vehicle).first()).toBeVisible();
      }

      // Click the Clear Outward button on this vehicle's row
      const row = page
        .locator('li')
        .filter({ hasText: opts.vehicle })
        .first();
      await row.getByRole('button', { name: /clear outward/i }).click();
      await expect(page.getByRole('heading', { name: /clear outward/i })).toBeVisible();

      if (opts.creditAuthorize) {
        await page.getByLabel(/authorize on credit/i).check();
        await shot(page, `${opts.shotPrefix}-f-credit-auth-modal.png`);
      }

      await page.getByRole('button', { name: /^clear outward$/i }).click();
      // Wait for the success flash OR the modal to disappear
      await expect(page.getByText(/cleared.*tat|TAT/i).first()).toBeVisible({ timeout: 15_000 });
      await shot(page, `${opts.shotPrefix}-g-gate-cleared.png`);

      return { invoiceId, invoiceTotal, balanceDueAfterPay };
    }

    // ─────────────────────────────────────────────────────────────────────
    let invoice1Total = 0;
    let invoice2Total = 0;
    let invoice3Total = 0;
    let invoice3Balance = 0;

    await test.step('05 — first withdrawal (200 bags, cash)', async () => {
      const r = await runWithdrawal({
        label: '#1 — 200 bags cash',
        bags: 200,
        weightKg: 19850,
        vehicle: plates.out1,
        withdrawalType: 'PARTIAL',
        paymentMethod: 'CASH',
        paymentAmount: 50_000, // 200 bags × Rs 250/bag (seasonal rate) = 50,000
        shotPrefix: '05',
      });
      invoice1Total = r.invoiceTotal;
      expect(r.balanceDueAfterPay).toBe(0);
    });

    await test.step('06 — second withdrawal (200 bags, cheque)', async () => {
      const r = await runWithdrawal({
        label: '#2 — 200 bags cheque',
        bags: 200,
        weightKg: 19900,
        vehicle: plates.out2,
        withdrawalType: 'PARTIAL',
        paymentMethod: 'CHEQUE',
        paymentAmount: 50_000,
        paymentRef: 'MCB-7788231',
        shotPrefix: '06',
      });
      invoice2Total = r.invoiceTotal;
      expect(r.balanceDueAfterPay).toBe(0);
    });

    await test.step('07 — final withdrawal (100 bags FULL, partial pay + credit auth)', async () => {
      // Final 100 bags @ Rs 250 = Rs 25,000 owed.
      // Aslam pays Rs 15,000 by bank transfer → Rs 10,000 remains → manager credit-authorizes the gate.
      const r = await runWithdrawal({
        label: '#3 — 100 bags credit',
        bags: 100,
        weightKg: 9920,
        vehicle: plates.out3,
        withdrawalType: 'FULL',
        paymentMethod: 'BANK_TRANSFER',
        paymentAmount: 15_000,
        paymentRef: 'HBL-TRX-998877',
        creditAuthorize: true,
        shotPrefix: '07',
      });
      invoice3Total = r.invoiceTotal;
      invoice3Balance = r.balanceDueAfterPay;
      expect(invoice3Balance).toBeGreaterThan(0);

      // Lot should now be CLOSED
      const lotAfter = await (
        await request.get(`${API_URL}/v1/lots/${lotId}`, { headers: opHeaders })
      ).json();
      expect((lotAfter.data ?? lotAfter).status).toBe('CLOSED');

      // Capture a screenshot of the closed lot detail
      await loginAs('OPERATOR');
      await page.goto(`/lots/${lotId}`);
      await expect(page.getByText(/closed/i).first()).toBeVisible({ timeout: 10_000 });
      await shot(page, '07h-lot-closed.png');
    });

    // ─────────────────────────────────────────────────────────────────────
    await test.step('08 — review ledger (party detail → Ledger tab)', async () => {
      await loginAs('OPERATOR');
      await page.goto(`/parties/${partyId}`);
      await expect(page.getByText(aslam.name).first()).toBeVisible({ timeout: 10_000 });
      await page.getByRole('button', { name: /^ledger$/i }).click();
      await expect(page.getByText(/outstanding/i)).toBeVisible({ timeout: 15_000 });
      await shot(page, '08-ledger.png');

      const ledger = await (
        await request.get(`${API_URL}/v1/parties/${partyId}/ledger`, { headers: opHeaders })
      ).json();
      const data = ledger.data ?? ledger;
      expect(Number(data.total_debit_pkr)).toBe(invoice1Total + invoice2Total + invoice3Total);
      expect(Number(data.closing_balance_pkr)).toBe(invoice3Balance);
    });

    // ─────────────────────────────────────────────────────────────────────
    await test.step('09 — party statement PDF', async () => {
      if (process.env['E2E_SKIP_PDF']) return; // Puppeteer unavailable in this env
      const today = todayISO();
      const url =
        `${API_URL}/v1/reports/party-statement` +
        `?party_id=${partyId}&start_date=${isoDaysAgo(180)}&end_date=${today}&format=pdf`;
      const res = await request.get(url, { headers: opHeaders });
      if (res.ok() && (res.headers()['content-type'] ?? '').match(/pdf/i)) {
        fs.writeFileSync(
          path.join(ARTIFACT_DIR, '09-party-statement.pdf'),
          await res.body(),
        );
      } else {
        // If the report endpoint shape differs, that's fine — log and move on.
        console.warn(`party-statement PDF skipped (status ${res.status()})`);
      }
    });
  });
});
