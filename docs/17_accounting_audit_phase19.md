# 17 — Accounting Module Audit & Remediation (Phase 19)

**Date:** 2026-07-24/25 · **Branch:** `phase/19-accounting-audit` (off `phase/17-ops-quickwins`)
**Scope:** Chart of accounts (create/edit/delete, opening balances, account heads), financial reports (Trial Balance, P&L, Balance Sheet, General Ledger), payments, invoices, peshgi — API, web UI, and docs.
**Method:** graphify code-graph queries + three exploration passes + one design pass, every finding verified against source with file:line evidence and against existing tests/git history before any change. Reviewed as senior engineer + senior accountant.

This document is the companion to `16_accounting_module_audit.md` (the 2026-07-06 audit). The F-1…F-14 remediations from that audit were re-verified and remain in place; this phase addresses issues that survived or were introduced since.

---

## Verdict

The accounting core is **structurally sound**: a single posting path enforces balance/sign/period/account-validity; DB-level triggers (migration 0002) make posted entries immutable and unbalanced entries unreachable; there is no hard-delete of accounts; opening balances post a real balanced journal entry; contra accounts are modelled correctly (accumulated depreciation nets inside fixed assets, discounts allowed are contra-revenue); GST is computed on the post-discount base with gross revenue and a separate contra debit.

Seventeen issues were found and remediated (one HIGH, eight MEDIUM, the rest LOW/DOC/NOTE). The most consequential were the **balance-sheet "Current Year Profit/(Loss)" being cumulative since inception** (no fiscal-year boundary, no retained-earnings roll-forward) and the **AR aging never reconciling to the GL control accounts** while the docs claimed it did.

---

## Findings & fixes

### 1. [HIGH] Balance-sheet equity had no fiscal-year boundary — "virtual closing"

**Evidence:** `financial-statements.service.ts` `getBalanceSheet` computed `current_year_pl_pkr` as the sum of REVENUE − COST_OF_SERVICE − EXPENSE over **all posted lines up to `as_of_date`** (no lower bound). Account `3030 Current Year Profit/(Loss)` is never posted to; `3020 Retained Earnings` is only ever touched by opening balances; there are **no closing/year-end entries** anywhere in the module. The web read `fiscal_year_start_month` from facility settings, but the settings schema never defined the key, so it could not be set.

**Why it matters (accounting):** the moment a facility crosses one fiscal-year end, the "Current Year" line keeps accumulating prior years' results and Retained Earnings never grows — the equity section stops telling the truth even though the sheet still "balances."

**Fix:** implemented a **virtual closing** presentation on the Balance Sheet (no new postings, preserving ledger immutability):
- Added `fiscal_year_start_month` (1–12, default 7 = July) to `FacilitySettings` (JSON column, no migration; `mergeSettings` backfills existing facilities).
- New `apps/api/src/modules/accounting/fiscal-year.ts` `fiscalYearStart(asOf, month)` (UTC, mirroring `period.ts`).
- `getBalanceSheet` now fetches a second window `[fiscal_year_start, as_of]`: `current_year_pl_pkr` is the P&L-class net over **that fiscal year only**; `prior_years_pl_pkr` = all-time P&L − current-FY P&L; `retained_earnings_pkr` = posted 3020 + prior-years' result, shown as one line; `equity_lines` excludes both 3020 and 3030. The identity is preserved exactly: `retained + current = posted-3020 + all-time-P&L`, which is what the old single line summed.
- New response fields `retained_earnings_pkr`, `prior_years_pl_pkr`, `fiscal_year_start`; the Balance Sheet page renders a Retained Earnings row and a fiscal-year-labelled Current Year row.
- **Trial Balance intentionally stays pre-closing** (income/expense accounts show cumulative movement) — documented in code and in `docs/09` §5.

**Tests:** `balance-sheet-fiscal-year.integration.test.ts` (prior-FY vs current-FY split, totals equal the pre-change equity, `is_balanced`), `fiscal-year.unit.test.ts`, and the existing P&L↔BS tie-out test updated to run the P&L over the fiscal-year window.

### 2. [MED] CoA create had no code-range/class validation

**Evidence:** `coa.service.ts` `create` accepted any 2–10 digit code for any class — an EXPENSE numbered `1999`, etc. Miscoded accounts fall into the statements' "unclassified" bucket rather than corrupting totals, but CoA integrity should be enforced at the source.

**Fix:** reject a code whose **leading digit belongs to another class's assigned range** (1 ASSET … 6 EXPENSE). Unassigned leading digits (0/7/8/9) stay legal, because owners legitimately open custom heads outside the seeded ranges and those surface through the F-6b unclassified bucket (a shipped capability). `normal_balance` remains caller-chosen so contra accounts stay possible.

### 3. [MED] CoA deactivation ignored the account balance

**Evidence:** a non-system account with journal history could be deactivated regardless of its GL balance, silently freezing a live balance behind an inactive account.

**Fix:** block `is_active=false` when the account's POSTED GL balance is non-zero (`ACCOUNT_HAS_BALANCE`, 409). A fully-settled account (zero net, with history) may still be retired.

### 4. [MED] Opening-balance API weaker than its own UI

**Evidence:** the web opening-balances form blocks non-balance-sheet classes and the `3010` plug account in `other_lines`, but `opening-balance.service.ts` enforced neither — a direct API caller could post opening `other_lines` to REVENUE/EXPENSE accounts or to 3010 on top of the auto-plug.

**Fix:** server-side restrict `other_lines` to ASSET/LIABILITY/EQUITY **DETAIL** accounts and reject `3010` (mirrors the UI; the AR codes 1110–1150 were already blocked).

### 5. [MED] AR aging / dashboard never reconciled to the GL control accounts

**Evidence:** `receivables-aging.ts`, the party statement and the dashboard AR figure are derived from operational tables (FINALIZED invoices, payments, credit notes) plus opening-balance JE lines; none query the GL AR accounts (1110/1120/1130/1150), yet `docs/09` §5.4/§7 claimed the aging "reconciles automatically to the AR total on the Balance Sheet." Worse, on-account (unallocated) receipts credit GL AR for the full receipt (JE-02) but were only netted against **opening balances**, so an on-account payment against an invoice did not reduce the aging → aging overstated vs the Balance Sheet.

**Fix:**
- Fetch on-account payments unconditionally; opening balances absorb their share first (unchanged FIFO), and the **leftover reduces each party's net due** as `unapplied_credit_pkr`. Buckets stay gross; `net_due_pkr` may go negative for a party in credit.
- Added a **GL tie-out** to the response: `gl_ar_control_total_pkr` (sum of 1110/1120/1130/1150, POSTED, PACCI, ≤ as_of), `variance_pkr` (net total − GL control) and `reconciled` (|variance| < 0.01). The aging page shows Net Receivable / Unapplied Credits / GL Control tiles, a reconciliation banner, and Credits + Net Due columns.
- DISPUTED: the Prisma `InvoiceStatus` enum has no DISPUTED value, so aging stays FINALIZED-only; `docs/09` §5.4 corrected accordingly.

### 6. [MED] Late-payment surcharge was a setting that did nothing

**Evidence:** `LatePaymentSurchargeRule` exists in facility settings (and on the settings page), but this branch had **no JE-21 template and no posting code** — the phase/12 implementation (`4e0bbed`) was never an ancestor of this line. A configurable control with no effect is a defect.

**Fix:** implemented a **migration-free, GL-based** surcharge (the phase/12 version required a `invoice_surcharges` table + a `SURCHARGE` entry type; that is deliberately not reintroduced here):
- Ported the pure `surcharge-calc.ts` (whole 30-day blocks beyond grace, non-compounding, idempotent by months-already-charged).
- New JE-21 template `DR party AR / CR 4210 Late Payment Surcharge`, `entryType: ACCRUAL`, `sourceTable: 'invoice_surcharge'`, `sourceId = invoiceId`. **Idempotency** without a table: one POSTED JE per chargeable month, so the posted count *is* the months-charged tally and re-applying inside a block charges nothing.
- `surcharge.service.ts` (suggestions + apply + list) and `surcharge.controller.ts` (`GET /v1/surcharges/suggestions` → `reports.financial`; `POST /GET /v1/invoices/:invoiceId/surcharges` → `invoices.manage` / `billing.view`). Registered in `app.ts` + the test app.
- The surcharge is GL-first (not folded into invoice `balance_due`); it is settled by on-account receipts (finding 5's machinery). To keep everything consistent, **both AR aging and the party ledger include the surcharge JE lines**, so the party statement, aging and GL agree.
- Invoice-detail page gains a surcharge card (applied list + "Assess surcharge" for a manager when the invoice is overdue and the rule is enabled).

### 7. [MED] Invoice VOID status was unreachable (docs/16 Gap 3)

**Evidence:** `VOID` exists in the `InvoiceStatus` enum but no code path set it; a finalized-in-error invoice could only be credit-noted.

**Fix:** `POST /v1/invoices/:id/void` (`invoices.void`, default OWNER) voids a **FINALIZED invoice with no payments, credit notes or surcharges**: it posts a full reversal of JE-01 (`entryType: REVERSAL`, cross-linked via `markReversed`, period-lock enforced on the reversal date) and sets `status=VOID` with the reason appended to notes. Post-payment corrections still go through credit notes / bad-debt write-off. The stale shared `InvoiceStatus` enum was realigned to the Prisma enum (`DRAFT/FINALIZED/VOID/WRITTEN_OFF`) — it was unused elsewhere, and the invoice list filter already used the correct inline values.

### 8. [MED] Peshgi produce-deduction repayment posted no journal entry

**Evidence:** `peshgi.service.ts` `recordRepayment` allowed `DEDUCTED_FROM_PRODUCE` with no `asset_account_code`, which decremented the loan balance **without any JE** — GL `1140` then diverged from the loan subledger. (The combined-settlement allocator in the payment flow always posts JE-19; it does not use this path.)

**Fix:** the `/repayments` endpoint now accepts only `CASH`/`BANK_TRANSFER` with a **required** asset account (each posts JE-19); produce-deduction recoveries are created only by the combined-settlement allocator. New guard `PESHGI_REPAYMENT_REQUIRES_SETTLEMENT`. **Note:** any pre-fix produce-deduction rows recorded without a JE remain divergent and need a one-time manual adjusting entry — not auto-repaired.

### 9. [LOW] Web CoA management gated on role, not permission

**Evidence:** `chart-of-accounts/page.tsx` gated add/rename/deactivate on `user.role === 'OWNER'`, contradicting the phase/15 permission-matrix architecture — granting `accounting.manage_accounts` to another role did nothing in the UI.

**Fix:** gate on `useCan('accounting.manage_accounts')`.

### 10. [LOW] System-account rename allowed server-side but hidden in the UI

**Fix:** `coa.service.ts` `update` now rejects renaming a system account (`SYSTEM_ACCOUNT_PROTECTED`), matching the UI and the "cannot be recoded" semantics.

### 11. [LOW] JE/CN numbering used local-time month; period derivation uses UTC

**Evidence:** `journal-entry-number.ts` used `getMonth()/getFullYear()` while `period.ts` uses UTC — near a month boundary on a non-UTC server, a document could be numbered into a different month than its accounting period.

**Fix:** UTC getters throughout `journal-entry-number.ts` (JE- and CN- prefixes). Unit test asserts a 30-June-20:00-UTC date numbers into June.

### 12. [LOW] Manual-JE schema defaulted to AUTO_DRAFT while the UI posts

**Fix:** `CreateManualJournalEntryRequest.posting_status` now defaults to `POSTED` — matching the web form and F-7's intent that leaving an entry as a draft (invisible to every report) is an explicit choice.

### 13. [LOW] Dead templates JE-07 / JE-10

**Evidence:** `je-07-overpayment.ts` (overpayment split) and `je-10-ownership-transfer-billing.ts` (AR reassignment) had **zero production callers** — overpayment is prevented by allocation guards; FULL-transfer accrued billing splits a standalone draft invoice through JE-01.

**Fix:** removed both templates and their unit-test cases.

### 14. [LOW] P&L margins reported 0% on zero/negative net revenue

**Evidence:** `pct()` returned `0` when `net_revenue_pkr <= 0`, which reads as "break-even" when there is actually no revenue base.

**Fix:** `pct()` returns `null` (rendered "—"); the four margin fields are nullable in the shared schema and the P&L page.

### 15. [LOW] Stale shared `InvoiceStatus` enum

Realigned to the Prisma enum as part of finding 7 (it carried non-existent PREVIEW/PAID/DISPUTED/CANCELLED/OUTSTANDING values and lacked VOID; nothing imported it).

### 16. [DOC] Documentation drift

`docs/09_accounting_spec.md` updated: §2 CoA tables gained the 10 seeded-but-undocumented accounts (1350, 1360, 1361, 4230, 4900, 4910, 6110, 6120, 6130, 6140); §3 notes JE-07/JE-10 removed and JE-21 as implemented; §5.2/§5.3 describe the as-built P&L (contra revenue, EBITDA, unclassified) and the virtual-closing equity (with "TB is pre-closing"); §5.4/§7 replace the false "reconciles automatically" claim with the new tie-out fields and drop the DISPUTED basis. `docs/16` annotated with the remediation status of Gap 3 and the other items closed here.

### 17. [NOTE] Accepted / documented, no code change

- **Credit notes increment `amountPaidPkr`** (a non-cash reduction represented through the paid field) — internally consistent; left as-is.
- **Per-party opening *credit* balances** (client advances) can't be entered through `party_receivables` (positive-only); documented as a known limitation.
- **Opening plug reuses `3010 Owner's Capital`** rather than a dedicated "Opening Balance Equity" account — acceptable policy, now documented.
- **No payment void/refund endpoint** beyond cheque dishonour; **F-12** (CoA versioning), **F-14** (RLS) and audit Gaps 6 (bank reconciliation) and 8 (bad-debt allowance vs direct write-off) remain accepted deferrals.

---

## Verification

All changes are TypeScript-typechecked (api + web) and covered by unit and integration tests. No Prisma migrations were required (the surcharge was implemented GL-first specifically to avoid one). Integration tests that touch posted journal entries clean up with `withGuardsDisabled`.

**Suite after this phase: 200 unit + 468 integration (api) + 99 unit (web) green** — up from 187 / 444 / 98, i.e. +24 integration tests, matching exactly the new cases listed above (+15 unit, −2 for the removed dead-template cases).

Known flake, unrelated to this work: `password-reset.integration.test.ts` and `placement.integration.test.ts` can hit the 15 s `hookTimeout` when the whole suite runs sequentially on a slow machine; both pass in isolation (31 tests). `eslint` is not installed in this workspace, so `pnpm lint` cannot run locally — `pnpm typecheck` (api + web, both clean) is the enforced gate here, plus the CI rule that no `requireMinRole(` appears under `apps/api/src/modules` (verified).
