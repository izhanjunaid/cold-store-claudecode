# Phase 8: Accounting System (M7 Extended)

**Objective**: Full double-entry accounting — CoA, 22 JE templates, GL, financial statements, credit notes, period locking, dual ledger, fixed assets, payroll, expenses, peshgi.
**Branch**: `phase/08-accounting`
**Prerequisites**: Phase 7
**Status**: **Phase 8 fully complete** — 8A revenue-side shipped 2026-05-05; 8B cost-side (backend + frontend) shipped 2026-05-08. Salary-slip endpoint returns JSON; bilingual PDF render deferred to Phase 11 polish. Peshgi UI is Phase 9 (backend + JE templates ship in 8B per plan).

## Tasks

### Phase 8A — Core Ledger (shipped 2026-05-05)
- [x] 8.1 — Schema additions (CoA, JE, JE lines, credit notes, period locks; FKs on Invoice/Payment/RatePlan/ServiceCharge). Pushed via `prisma db push`.
- [x] 8.2 — CoA Seed (73 accounts: 62 detail + 11 header per `docs/09_accounting_spec.md` §2; rate plans + service charges wired to revenue accounts)
- [x] 8.3 — Journal Entry Service + 11 templates (JE-01..08, JE-10, JE-11, JE-11R) with balance enforcement, period-lock check, header/inactive account guards
- [x] 8.4 — Wire JE Triggers (invoice finalize→JE-01, payment record→JE-02/03, allocate advance→JE-04, dishonour→JE-06+JE-02 reversed)
- [x] 8.4b — Backfill script for pre-Phase-8 invoices/payments (idempotent)
- [x] 8.5 — Credit Note Backend (JE-05) with `CN-YYYYMM-NNNN` numbering
- [x] 8.6 — Accounting API (CoA, JE manual, GL, trial balance, P&L, BS, period lock/unlock, credit notes, bad-debt write-off)
- [x] 8.9a — S-35 Chart of Accounts (frontend)
- [x] 8.10a — S-36 Journal Entry List + Detail + Manual Entry form
- [x] 8.11a — S-37 GL Account Ledger
- [x] 8.12a — S-38 Financial Statements (Trial Balance, P&L, Balance Sheet)
- [x] 8.13 — Dual Ledger (`book_type` filter on every accounting query; manual JE form blocks non-OWNER from posting KATCHI)

### Phase 8B — Cost-side (shipped 2026-05-07)
- [x] 8B.0 — Schema additions: 9 new enums + 8 new models (FixedAsset, DepreciationSchedule, Employee, PayrollRun, PayrollLineItem, ExpenseVoucher, PartyLoan, PartyLoanRepayment) with full FK/relation wiring including JE inverse relations. Pushed via `prisma db push`.
- [x] 8B.0 — CoA seed extended with 8 accounts (1350, 1360, 1361, 4230, 6110, 6120, 6130, 6140). Total CoA: 81 accounts.
- [x] 8.7 — Fixed Assets module: 3 JE templates (JE-12 purchase, JE-13 monthly depreciation, JE-14 disposal A/B/C cases), `ASSET_CATEGORY_ACCOUNT_DEFAULTS` routing constant (cold-plant → 5040 direct cost, building/vehicle/computer → 6120/6130/6140 indirect), `depreciation-calc.ts` (SLM and WDV with pro-rata for mid-month start, residual floor), `fixed-asset-number.ts` (FA-YYYY-NNNN advisory-lock), repository, service (purchase → JE-12, commission, dispose → JE-14, runMonthlyDepreciation batch → JE-13 idempotent), 8 routes (`/v1/fixed-assets`, `/v1/depreciation/runs`).
- [x] 8.8 — Payroll module: 4 JE templates (JE-15 monthly salaried with zero-tax-line omission, JE-15B daily-wages routing to 5030/5035 not 6010, JE-16 salary payment, JE-16B EOBI/tax remittance), `payroll-number.ts` (PAY-YYYYMM-NNN), `EmployeeService` CRUD with terminate, `PayrollRunService` (DRAFT snapshot of active employees with EOBI 375/1875 rates, finalize → JE-15 or JE-15B, pay → JE-16, remit → JE-16B), 13 routes; salary-slip endpoint returns JSON (PDF deferred to Phase 11 polish).
- [x] 8.9 — Expense Vouchers module: 4 JE templates (JE-17A immediate-pay expense, JE-17B accrual to 2040, JE-17B-PAY clearing accrued, JE-17C petty-cash float restoration as single transfer JE), `expense-number.ts` (EXP-YYYYMM-NNNN), `ExpenseService` (DRAFT → APPROVED → ACCRUED/PAID lifecycle), 9 routes.
- [x] 8.10 — Peshgi (loans) backend: 2 JE templates (JE-18 issue, JE-19 recovery), `peshgi-number.ts` (PSH-YYYYMM-NNNN), `PeshgiService` (issue → JE-18, recordRepayment with row-level `FOR UPDATE` to serialise repayments, auto-status to FULLY_RECOVERED at zero balance), 4 routes. **Frontend deferred to Phase 9.**
- [x] 8.11a — Backend verification: full integration suite passes (16 files, 178 tests), unit suite passes (12 files, 76 tests). API typecheck clean.
- [x] 8.11b — **Frontend pages built**: `accounting/fixed-assets/` (list + new + [id] + runs), `accounting/payroll/employees/` (list + new + [id]), `accounting/payroll/runs/` (list + new + [id] with finalize/pay/remit modals + slip viewer), `accounting/expenses/` (list + new + [id] with approve/accrue/pay/cancel actions). Accounting landing page extended with five new nav cards. Web typecheck clean; Next.js production build succeeds. Salary slip currently rendered as JSON-driven alert (PDF template deferred).
- [ ] 8.11c — **Salary-slip PDF deferred to Phase 11 polish**: bilingual Handlebars template + Puppeteer rendering. Endpoint returns JSON; UI shows alert dialog. Acknowledged scope trim.
- [ ] 8.11d — **Manual UI smoke (per plan §Verification steps 9–11) deferred**: integration tests cover the same KATCHI/period-lock logic. UI smoke against running dev servers is a Phase 11 polish item.

JE-09 / JE-09B (spoilage) still deferred — depends on Phase 6 (Quality & Spoilage). **Audit-trigger gap**: only `facilities` and `users` have `audit_log` triggers in dev DB; `parties`, `invoices`, `payments`, `journal_entries`, and all 8B operational tables have none. This is a **pre-existing** state (8A didn't add triggers either), not a 8B regression — but the CLAUDE.md "audit-first" guarantee is currently aspirational and should either be backfilled with a proper migration or the docs should be honest that audit logging is partial.

## Key Phase 8B Endpoints

| Method | URL | Role | JE | Purpose |
|--------|-----|------|----|---------|
| POST | `/v1/fixed-assets` | OWNER | JE-12 | Create asset, post purchase JE |
| POST | `/v1/fixed-assets/:id/commission` | OWNER | — | PURCHASED → IN_SERVICE |
| POST | `/v1/fixed-assets/:id/dispose` | OWNER | JE-14 | Record disposal with gain/loss |
| POST | `/v1/depreciation/runs` | OWNER | JE-13 | Monthly batch run, idempotent |
| POST | `/v1/employees` | MANAGER+ | — | Create employee |
| POST | `/v1/payroll-runs` | ACCOUNTANT+ | — | DRAFT run, snapshot active employees |
| POST | `/v1/payroll-runs/:id/finalize` | MANAGER+ | JE-15 / JE-15B | Post payroll JE |
| POST | `/v1/payroll-runs/:id/pay` | MANAGER+ | JE-16 | Disburse net payable |
| POST | `/v1/payroll-runs/:id/remit` | OWNER | JE-16B | Remit EOBI/tax to govt |
| POST | `/v1/expense-vouchers` | ACCOUNTANT+ | — | Create DRAFT |
| POST | `/v1/expense-vouchers/:id/approve` | MANAGER+ | — | DRAFT → APPROVED |
| POST | `/v1/expense-vouchers/:id/accrue` | ACCOUNTANT+ | JE-17B | APPROVED → ACCRUED |
| POST | `/v1/expense-vouchers/:id/pay` | ACCOUNTANT+ | JE-17A or JE-17B-PAY | Pay direct or settle accrual |
| POST | `/v1/expense-vouchers/petty-cash-replenish` | ACCOUNTANT+ | JE-17C | Restore petty-cash float |
| POST | `/v1/peshgi` | OWNER | JE-18 | Issue loan to party |
| POST | `/v1/peshgi/:id/repayments` | ACCOUNTANT+ | JE-19 | Record repayment, update balance |

## Definition of Done

### Phase 8B backend — DONE
- ✅ 22 JE templates auto-fire on operational events (11 from 8A + 11 from 8B: JE-12, JE-13, JE-14 cases A/B/C, JE-15, JE-15B, JE-16, JE-16B, JE-17A, JE-17B, JE-17B-PAY, JE-17C, JE-18, JE-19)
- ✅ Trial balance balances (DR = CR) — verified across 178 integration tests
- ✅ Period locking enforced for all JE-posting flows: Invoice finalize, Payment record, Manual JE, Depreciation run, Payroll finalize/pay/remit, Expense pay/accrue, Peshgi issue/repayment
- ✅ KATCHI/PACCI dual ledger (schema + filter; OWNER-only KATCHI on all 8B mutating endpoints)
- ✅ Fixed asset register with monthly depreciation runs (idempotent), three disposal cases (gain/loss/scrap)
- ✅ Pakistan EOBI payroll (Rs. 375 employee + Rs. 1,875 employer per registered worker), salaried vs. daily-wage routing
- ✅ Expense voucher lifecycle (DRAFT → APPROVED → ACCRUED/PAID) with accrual reversal pattern (JE-17B + JE-17B-PAY)
- ✅ Peshgi loans with FOR-UPDATE concurrency, partial/full recovery, status transitions
- ✅ 80 new Phase 8B tests (34 unit + 46 integration) — all green
- ✅ Cumulative across all phases: **76 unit + 178 integration = 254 tests passing**

### Phase 8B frontend — DONE
- ✅ S-39/40/41 Fixed Assets (list, new, detail, depreciation runs)
- ✅ S-42 Employees (list, new, detail with terminate)
- ✅ S-43/44 Payroll Runs (list, new, detail with finalize → JE-15/15B, pay → JE-16, remit → JE-16B, salary slip viewer)
- ✅ S-46/47 Expense Vouchers (list, new, detail with approve/accrue/pay/cancel)
- ✅ Accounting landing page extended with 5 new nav cards
- ✅ Web typecheck + Next.js production build green

### Deferred to Phase 11 polish (not blocking 8B sign-off)
- 🟡 Salary-slip bilingual PDF (Handlebars + Puppeteer) — endpoint returns JSON, UI shows alert
- 🟡 Manual UI smoke against running dev servers
