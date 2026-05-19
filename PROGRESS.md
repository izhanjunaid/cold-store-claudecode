# ColdChain — Build Progress

## Current Status
- **Active Phase**: Phase 11 (Admin & Polish) — branch `phase/11-admin-polish` off Phase 10. Buckets 11.1 + 11.2 + 11.3 shipped.
- **Active Task**: 11.4 — S-39 User Management
- **Blockers**: None
- **Last Updated**: 2026-05-18
- **Deferred (still remaining)**: Phase 6 (Quality & Spoilage) remains skipped per Phase 11 scope decision.

## Phase Completion

| Phase | Name | Status | Started | Completed |
|-------|------|--------|---------|-----------|
| 0 | Project Foundation | COMPLETED | 2026-04-06 | 2026-04-07 |
| 1 | Party Management + Chambers | COMPLETED | 2026-04-08 | 2026-04-08 |
| 2 | Inbound & Lot Management | COMPLETED | 2026-04-10 | 2026-04-14 |
| 3 | Ownership Transfer | COMPLETED | 2026-04-15 | 2026-04-15 |
| 4 | Outbound & Dispatch | COMPLETED | 2026-04-17 | 2026-04-17 |
| 5 | Billing Engine | COMPLETED | 2026-04-20 | 2026-04-21 |
| 6 | Quality & Spoilage | SKIPPED (deferred to end) | — | — |
| 7 | Financial Ledger & Payments | COMPLETED | 2026-04-24 | 2026-04-25 |
| 8A | Core Ledger (CoA, JE, GL, Statements) | COMPLETED | 2026-04-28 | 2026-05-05 |
| 8B | Cost-side (FA, Payroll, Expenses, Peshgi-API) | COMPLETED | 2026-05-06 | 2026-05-08 |
| 9 | Gate Pass + Peshgi (UI + spec realignment + combined settlement) | COMPLETED | 2026-05-09 | 2026-05-10 |
| 10 | Reporting & Dashboards | COMPLETED | 2026-05-17 | 2026-05-18 |
| 11 | Admin, Polish & Pre-Launch | IN PROGRESS | 2026-05-18 | — |

## Test Counts

| Phase | Unit | Integration | E2E | Total |
|-------|------|-------------|-----|-------|
| 0 | 14 | 13 | — | 27 |
| 1 | — | 25 | — | 25 |
| 2 | 9 | 24 | — | 33 |
| 3 | — | 9 | — | 9 |
| 4 | — | 13 | — | 13 |
| 5 | 8 | 12 | — | 20 |
| 7 | — | 12 | 1 | 13 |
| 8A | 16 | 24 | — | 40 |
| 8B | 34 | 46 | — | 80 |
| 9 | 6 | 27 | — | 33 |
| 10 | 10 | 20 | — | 30 |
| 11 (so far) | 21 | 3 | — | 24 |

## Completed Tasks Log

- [2026-04-06] 0.1 — Monorepo Scaffold — Turborepo with apps/web, apps/api, packages/shared, packages/db, packages/ui
- [2026-04-06] 0.2 — TypeScript & Tooling — TS strict, ESLint, Prettier configured
- [2026-04-06] 0.3 — CI Pipeline — GitHub Actions workflow
- [2026-04-06] 0.4 — Prisma Setup — PostgreSQL 15 connected via local MCP
- [2026-04-06] 0.5 — Foundation Migration — facilities, users, audit_log, refresh_tokens + RLS + audit triggers
- [2026-04-06] 0.6 — Seed Data — Lahore Cold Store facility + 5 users (OWNER, MANAGER, ACCOUNTANT, OPERATOR, SECURITY)
- [2026-04-06] 0.7 — Fastify Server — CORS, helmet, rate-limit, error handler, facility scope plugin, /health
- [2026-04-06] 0.8 — Zod Validation — fastify-type-provider-zod, shared schemas (auth, common, enums)
- [2026-04-06] 0.9 — JWT Auth — login/refresh/logout/me, bcrypt, 5-attempt lockout, role guards
- [2026-04-06] 0.10 — App Shell — S-01 Login page, S-02 Layout (sidebar, topbar), Zustand auth store, apiClient
- [2026-04-07] 0.11 — Testing Infrastructure — Vitest configs, test helpers, 9 unit + 5 web + 13 integration tests
- [2026-04-07] Phase 0 audit trigger bugfix — empty session vars safe UUID fallback
- [2026-04-08] 1.1 — Migration 0002_parties_chambers — parties, commodities, varieties, chambers, temperature_logs
- [2026-04-08] 1.2 — Seed Data — 4 commodities, 8 varieties, 4 chambers, 5 parties (FARMER, ARHTI, TRADER, BUYER)
- [2026-04-08] 1.3 — Party CRUD Backend — GET/POST/PATCH/DELETE /v1/parties with search, filter, pagination, role guards
- [2026-04-08] 1.4 — Chamber CRUD Backend — GET/POST/PATCH /v1/chambers, POST /v1/chambers/:id/temperature
- [2026-04-08] 1.5 — Commodity/Variety CRUD — GET/POST/PATCH /v1/commodities, varieties nested routes
- [2026-04-08] 1.6 — S-05 Party List — table with filters, search, pagination, type badges
- [2026-04-08] 1.7 — S-06 Party Create/Edit — shared form component, Arhti dropdown, validation
- [2026-04-08] 1.8 — S-07 Party Detail — info card, credit profile, tabs (stubs), deactivate modal
- [2026-04-08] 1.9 — S-27 Chamber List + S-28 Chamber Detail — capacity bars, temp history, inline log form
- [2026-04-10] 2.1 — Migration 0003_lots_billing_config — rate_plans, service_charges, lots, ownership_history
- [2026-04-10] 2.2 — Lot number generation — LOT-YYMMDD-NNNN, concurrency-safe (FOR UPDATE + unique index)
- [2026-04-10] 2.3 — Lot CRUD backend — create (WF-01), list, detail, update (notes/quality only), ownership-history, receipt endpoints
- [2026-04-10] 2.4 — Rate Plan CRUD — SEASONAL/MONTHLY/DAILY_PER_BAG, season date validation, MANAGER+ create/edit
- [2026-04-10] 2.5 — Service Charge Catalog — PER_BAG/PER_TON/FLAT, name uniqueness per facility
- [2026-04-10] 2.6 — PDF Service + Storage Receipt — Puppeteer + Handlebars, bilingual (English/Urdu) parchi
- [2026-04-14] 2.7 — S-08 Lot List — paginated table, status/search filters, days_in_storage
- [2026-04-14] 2.8 — S-09 Lot Create — inbound form, weight dispute detection, capacity warning, commodity-filtered dropdowns
- [2026-04-14] 2.9 — S-10 Lot Detail — header card, tabs (overview/ownership history/stub phases), receipt PDF download
- [2026-04-14] 2.10 — S-11 Storage Receipt PDF — served via GET /v1/lots/:id/receipt, opened as blob URL in frontend
- [2026-04-14] 2.11 — S-17/S-18/S-19 Rate Plans & Service Charges screens — CRUD, modal, list + edit pages
- [2026-04-15] 3.1 — Ownership Transfer Backend — POST /v1/lots/:id/transfer (FULL/PARTIAL), OT-01→OT-06, MANAGER+ gated, row-locked, child lot `-Tn` numbering
- [2026-04-15] 3.2 — Transfer Acknowledgment PDF — renderTransferAcknowledgment + bilingual template, GET /v1/lots/:id/transfer/:transferId/acknowledgment
- [2026-04-15] 3.3 — S-12 Transfer Form — full/partial toggle, party picker (excludes current owner), balance-aware quantity validation
- [2026-04-15] 3.4 — S-13 Transfer Acknowledgment Viewer — blob iframe + download
- [2026-04-15] 3.5 — Lot Detail timeline — transfer price column, per-row PDF link, post-transfer banner with ack CTA, Transfer Ownership header button (MANAGER+)
- [2026-04-15] 3.6 — Integration tests — 9 cases: FULL, PARTIAL, sequential -T2, quantity>=balance reject, same-party reject, CLOSED reject, role gating, PDF endpoint, history endpoint
- [2026-04-17] 4.1 — Migration outbound_events — Prisma schema + db push (WithdrawalType, OutboundStatus enums; OutboundEvent model)
- [2026-04-17] 4.2 — Outbound Backend — POST /v1/outbound-events, GET /:id, PATCH /:id/weight, POST /:id/finalize, GET /:id/dispatch-note; DN-YYMMDD-NNNN number generation
- [2026-04-17] 4.3 — Dispatch Note PDF — bilingual Handlebars template, renderDispatchNote() in pdf.service.ts
- [2026-04-17] 4.4 — S-14 Withdrawal Form — /lots/:id/withdraw with FULL/PARTIAL toggle, balance-aware validation
- [2026-04-17] 4.5/4.6 — S-15 Outbound Event Detail — weight recording, variance display, finalize confirm, dispatch note print
- [2026-04-17] 4.7 — Lot Detail updated — "New Withdrawal" button (OPERATOR+), Withdrawals tab with outbound events table
- [2026-04-17] 4.8 — Integration tests — 13 cases: PARTIAL/FULL create, balance checks, CLOSED lot reject, GET by ID, weight→WEIGHED, finalize→DISPATCHED (partial/full), no-weight reject, role gating, PDF endpoint, lot events endpoint
- [2026-04-20] 5.1 — Migration 0005_invoices — Invoice + InvoiceLineItem Prisma models, InvoiceStatus/InvoiceLineType enums
- [2026-04-20] 5.2 — Invoice Zod schemas — CreateInvoiceRequest, AddInvoiceLineRequest, FinalizeInvoiceRequest, InvoiceListQuery, InvoiceResponse (in @coldchain/shared)
- [2026-04-20] 5.3 — Invoice backend module — storage-charge.ts (SEASONAL/MONTHLY/DAILY math), invoice-number.ts (INV-YYYYMM-NNNN advisory lock), invoice.repository.ts, invoice.builder.ts (idempotent, periodStart from ownership or lot.inboundDate), invoice.service.ts, invoice.controller.ts (7 routes)
- [2026-04-20] 5.4 — Wire outbound finalize → auto-create DRAFT invoice in same transaction; invoice_id in outbound response; getById/getByLot backfill; sequential fileParallelism fix for integration tests
- [2026-04-20] 5.5 — Invoice PDF — bilingual A5 Handlebars template (header, billing details, line items table, totals, DRAFT watermark); renderInvoice/renderInvoiceHtml in pdf.service.ts
- [2026-04-20] 5.6 — Invoice integration tests — 12 tests (SEASONAL/MONTHLY/DAILY math, min-days floor, add SERVICE/ADJUSTMENT lines, remove immutability, finalize numbering, post-finalize rejection, list filters, role gating, PDF endpoint, idempotency)
- [2026-04-21] 5.7 — S-20 Invoice List (/invoices) — status/party/date filters, role guard; S-21 Invoice Detail (/invoices/:id) — line items, add/delete modals, finalize modal, PDF print, disabled Record Payment; Lot billing tab live
- [2026-04-21] 5.8 — Docs updated: PROGRESS.md, TESTING.md, phases/phase-05-billing-engine.md
- [2026-04-24] 7.1 — Migration 0006_payments — Payment + PaymentAllocation Prisma models; PaymentMethod/PaymentStatus/ClearanceStatus enums
- [2026-04-24] 7.2 — Payment Zod schemas — CreatePaymentRequest, AllocatePaymentRequest, DishonourPaymentRequest, PaymentListQuery, PaymentResponse, PartyLedgerEntry, PartyLedgerResponse (in @coldchain/shared)
- [2026-04-24] 7.3 — Payment backend module — payment.repository.ts, payment.service.ts (record, list, getById, allocate, dishonour, getPartyLedger), payment.controller.ts (6 routes: POST /payments, GET /payments, GET /payments/:id, POST /payments/:id/allocate, POST /payments/:id/dishonour, GET /parties/:id/ledger)
- [2026-04-24] 7.4 — Payment integration tests — 12 cases: full CASH allocation, partial allocation, advance payment, cheque clearance, over-allocation reject, DRAFT invoice reject, party mismatch reject, balance exceeded reject, cheque dishonour reversal, non-cheque dishonour reject, role gating, WF-04 e2e ledger
- [2026-04-24] 7.5 — S-24 Payments List (/payments) — status/method/date filters, pagination; S-25 Record Payment (/payments/new) — party preselect, allocation grid with Fill-balance; S-26 Payment Detail (/payments/:id) — amount summary, allocations, cheque dishonour flow
- [2026-04-24] 7.6 — Party Detail tabs live — Active Lots, Invoices, Payments (with Record Payment CTA), Ledger (chronological DR/CR with running balance)
- [2026-04-24] 7.7 — Invoice Record Payment button enabled — routes to /payments/new?party_id= when status=FINALIZED and balance_due>0
- [2026-04-25] 7.8 — E2E UI verification (playwright-cli): login → lot create → outbound → invoice finalize → Record Payment → verify balance_due=0 → party ledger DR/CR — all flows pass, 0 console errors
- [2026-05-06] 8B.0 — Pre-flight chore commit (`c12d4e3`): @playwright/test devDep + party fetch per_page=100 cleanup
- [2026-05-06] 8B.0 — Schema additions to `packages/db/prisma/schema.prisma`: 9 new enums + 8 new models (FixedAsset, DepreciationSchedule, Employee, PayrollRun, PayrollLineItem, ExpenseVoucher, PartyLoan, PartyLoanRepayment) + JE inverse relations. Pushed via `prisma db push`, client regenerated.
- [2026-05-06] 8B.0 — CoA seed extended with 8 new accounts (1350, 1360, 1361, 4230, 6110, 6120, 6130, 6140). Total CoA: **81 accounts** (was 73).
- [2026-05-06] 8.7 — Fixed Assets: 3 JE templates (12/13/14), `ASSET_CATEGORY_ACCOUNT_DEFAULTS` routing constant, `depreciation-calc.ts` (SLM + WDV with pro-rata + residual floor), `fixed-asset-number.ts` (FA-YYYY-NNNN advisory-lock), repository, service (purchase/commission/dispose/runMonthlyDepreciation), controller (8 routes); shared `fixed-assets.ts` schemas. Tests: 18 unit + 13 integration.
- [2026-05-07] 8.8 — Payroll: 4 JE templates (15/15B/16/16B with EOBI 375/1875 rates and zero-tax-line omission), `payroll-number.ts` (PAY-YYYYMM-NNN), `EmployeeService` CRUD, `PayrollRunService` (snapshot-based DRAFT → finalize/JE-15 or 15B → pay/JE-16 → remit/JE-16B), 13 routes; salary-slip endpoint returns JSON (PDF deferred to Phase 11 polish); shared `payroll.ts`. Tests: 8 unit + 14 integration.
- [2026-05-07] 8.9 — Expense Vouchers: 4 JE templates (17A/17B/17B-PAY/17C), `expense-number.ts` (EXP-YYYYMM-NNNN), `ExpenseService` (DRAFT → APPROVED → ACCRUED/PAID lifecycle), 9 routes including `/petty-cash-replenish`; shared `expenses.ts`. JE-17C scoped to single replenishment JE per plan. Tests: 5 unit + 11 integration.
- [2026-05-07] 8.10 — Peshgi (loans, API only): 2 JE templates (18/19), `peshgi-number.ts` (PSH-YYYYMM-NNNN), `PeshgiService` (issue with row-locked recordRepayment + auto-status FULLY_RECOVERED), 4 routes; shared `peshgi.ts`. Frontend deferred to Phase 9 per plan. Tests: 3 unit + 8 integration.
- [2026-05-08] 8.11 — Frontend pages: `accounting/fixed-assets/` (list/new/detail/runs), `accounting/payroll/employees/` (list/new/detail), `accounting/payroll/runs/` (list/new/detail with finalize/pay/remit modals + JSON salary slip viewer), `accounting/expenses/` (list/new/detail with approve/accrue/pay/cancel). Accounting landing page extended with 5 new nav cards. Web typecheck clean; Next.js production build green.
- [2026-05-08] 8.11 — Tracking docs (PROGRESS.md, TESTING.md, phases/phase-08-accounting.md) and project memory updated. Audit-trigger gap (only `facilities` and `users` have triggers in dev DB) flagged in phase doc — pre-existing 8A state, not 8B regression, but should be backfilled or doc updated to match reality.
- [2026-05-09] 9.1 — Migration `0010_gate_peshgi`: GatePass model + GatePassDirection/GatePassStatus enums; `RepaymentMethod` enum (decoupled from ExpensePaymentMethod); `PartyLoanStatus` rename `FULLY_RECOVERED → RECOVERED` (loss-free `ALTER TYPE RENAME VALUE`); `EntryType += PESHGI_WRITE_OFF`; `payment_allocations.invoice_id` nullable + `loan_id` FK + CHECK XOR; `party_loans.write_off_*` columns; loan_number realign `PSH-YYYYMM-NNNN → L-YYMMDD-NNN` for shipped 8B rows.
- [2026-05-09] 9.2 — Gate Pass backend: `gate-pass-number.ts` (GP-YYMMDD-NNNN), `gate-pass.repository.ts`, `gate-pass.service.ts` (logInward/logOutward/linkLot/clearOutward with row-locking + invoice-paid validation + credit_authorization MANAGER+ override), `gate-pass.controller.ts` (6 routes under `/v1/gate-passes`); shared `gate-pass.ts` Zod schemas; gate-pass error codes added to `errors.ts`. **No JE for gate pass — custodial only.**
- [2026-05-09] 9.3 — Peshgi realignment: `/v1/peshgi → /v1/loans` URL prefix; `peshgi-number.ts` rewritten to `L-YYMMDD-NNN`; service uses `RECOVERED` enum value; `IssuePeshgiRequest` requires `payment_method` (CASH→1010 / BANK_TRANSFER→1020 routing); `RecordRepaymentRequest` allows `DEDUCTED_FROM_PRODUCE` with optional `asset_account_code`. Added `POST /v1/loans/:id/write-off` (OWNER) + JE-20 template (DR 6080 / CR 1140). `GET /v1/loans/:id/acknowledgment` returns JSON (PDF deferred Phase 11).
- [2026-05-10] 9.4 — Combined settlement: `AllocatePaymentRequest` accepts discriminated union `{target:'INVOICE',invoice_id} | {target:'LOAN',loan_id}` with legacy `{invoice_id}` shape auto-normalized at the schema layer. `payment.service` forks per-line: invoice path increments `amount_paid_pkr`; loan path row-locks `party_loans`, validates ACTIVE+party-match+balance, decrements balance, transitions to RECOVERED, creates `PartyLoanRepayment(method=DEDUCTED_FROM_PRODUCE, payment_id)`, and posts JE-19 in the same tx. Cheque dishonour reverses both invoice and loan allocations (deletes linked repayment rows, restores balance, reverts ACTIVE status).
- [2026-05-10] 9.5 — S-32 Gate Pass Console at `/gate`: touch-optimized split layout with 15s polling, Log Arrival form, Vehicles Currently Inside list, Clear Outward modal with credit_authorization toggle (visible to MANAGER+). SECURITY-only; redirect-on-mount for lower roles.
- [2026-05-10] 9.6 — S-33 `/loans/issue` (OWNER) with debounced party search and PKR formatter; S-34 `/loans` dashboard with summary card and status filter; `/loans/[id]` detail with repayment timeline, Record Repayment (MANAGER+), Write Off (OWNER) reason modal. Party Detail Peshgi tab replaced placeholder with live loan table + Issue CTA.
- [2026-05-10] 9.7 — Login post-auth helper `apps/web/src/lib/auth-redirect.ts:defaultRouteForRole`. SECURITY → `/gate`; everyone else → `/dashboard`.
- [2026-05-10] 9.8 — Tests: 6 new unit (gate-pass-number x3, JE-20 template x2, L-YYMMDD-NNN format) + 27 net-new integration (gate-pass: 7 cases including outward-blocked-on-unpaid, credit-auth, role gating, turnaround_seconds; peshgi-realigned: 12 cases including L- format, RECOVERED status, write-off happy + role + already-closed, MANAGER-only repayment, JSON acknowledgment; combined-settlement: 7 cases including JE-02 books invoice-only, total cash debit = payment amount, loan-only skips JE-02, /allocate rejects LOAN, cheque dishonour reverses both sides). Total: 82 unit + 199 integration tests pass.
- [2026-05-10] 9.9 — Tracking docs (PROGRESS.md, TESTING.md, phases/phase-09-gate-peshgi.md) updated.
- [2026-05-14] 9.10 — Bugfix `3ff6ed2`: JE-02 was double-debiting cash on combined invoice+loan payments (150k payment posting 250k cash debit because both JE-02 and JE-19 booked cash). JE-02/JE-03 now book only `payment.amountPkr - sum(LOAN allocations)`; skipped entirely for loan-only payments. POST /v1/payments/:id/allocate rejects LOAN target (post-creation AR-transfer JE not built). dishonour() scales JE-06 to invoice portion and posts per-loan REVERSAL JE (DR 1140 / CR cash) marking original JE-19s as REVERSED.
- [2026-05-14] 9.11 — Regression test `c4aa3c9`: cheque+combined+dishonour end-to-end verifies the new reversal path (scaled JE-06, per-loan REVERSAL JE, REVERSED postingStatus on original JE-02/JE-19, net cash on 1020 sums to zero).
- [2026-05-17] 10.0 — Branch `phase/10-reporting` off `phase/09-gate-peshgi`. Recharts installed. React Query provider wired at `(app)/providers.tsx` (scoped to new Phase 10 pages).
- [2026-05-17] 10.1.9 — Migration `0011_reporting_indexes`: 5 composite indexes (invoices×2, outbound_events, lots, payments) applied via `prisma db execute`; mirrored as `@@index` blocks in `schema.prisma`.
- [2026-05-17] 10.1.1 — `packages/shared/src/schemas/reports.ts`: 7 query schemas + response shapes. `PartyLedgerEntry.type` extended with `CREDIT_NOTE`; `PartyLedgerResponse` gained `opening_balance_pkr`.
- [2026-05-17] 10.1.10 — `paymentService.getPartyLedger` extended with optional `{ fromDate, toDate, bookType }` opts. Includes CreditNote rows on credit side. Computes pre-period opening balance. Backwards-compatible. `daysInStorage` extracted to `lot/days-in-storage.ts`.
- [2026-05-17] 10.1.2–10.1.8 — `apps/api/src/modules/reporting/`: 7 endpoints (`/v1/reports/dashboard`, `lot-aging`, `receivables-aging`, `commodity-inventory`, `weight-variance`, `seasonal-summary`, `party-statement/:partyId`). Role gating per endpoint, server-side strip of financial fields for non-ACCOUNTANT on `/dashboard`. AR aging reconciles to GL 1110+1120+1130+1150.
- [2026-05-17] 10.2 — Bilingual A5 party-statement Handlebars template + `renderPartyStatement` / `renderPartyStatementHtml` in `pdf.service.ts`. Wired via `?format=pdf` on the party-statement endpoint.
- [2026-05-17] 10.3 — `/dashboard` rewritten: KPI cards (5 ops + 3 financial), Recharts BarChart with 90% threshold ref-line, AttentionPanel (lots over storage threshold), SpoilagePlaceholder. 30s `refetchInterval`.
- [2026-05-17] 10.4 — `/dashboards/financial`: 3 KPI cards, Recharts donut for receivables aging, top-5 overdue table. Manual Refresh button (no polling). OWNER + ACCOUNTANT only.
- [2026-05-17] 10.5 — `/reports` hub (role-based tile hiding); detail pages for `/reports/lot-aging` and `/reports/receivables-aging`; 4 stub pages for commodity-inventory, weight-variance, seasonal-summary, ownership-transfers.
- [2026-05-17] 10.6 — `/reports/party-statement` picker (debounced party search + date range + book-type radio) → `/reports/party-statement/[partyId]` detail page with opening/totals/closing cards, ledger table, Download PDF button (blob → new tab).
- [2026-05-17] 10.7 — Sidebar: added "Financial" nav item. Web `tsc --noEmit` + `next build` green.
- [2026-05-17] 10.8 — Tests: 10 unit (`aging-buckets.unit.test.ts` x6, `days-in-storage.unit.test.ts` x4) + 20 integration (`reporting.integration.test.ts`) including **AR reconciliation against GL 1110+1120+1130+1150**, format=pdf returns `application/pdf`, opening-balance math, PACCI/KATCHI filter, all 7 endpoints' happy + role gates.
- [2026-05-18] 11.0 — Branch `phase/11-admin-polish` off `phase/10-reporting`.
- [2026-05-18] 11.1 — Deferred PDFs shipped. New bilingual A5 Handlebars templates: `salary-slip.html`, `loan-acknowledgment.html`, `gate-pass-receipt.html`. New `renderXxxHtml/renderXxx` functions in `pdf.service.ts` + shared `htmlToA5Pdf` helper. Endpoints accept `?format=pdf` (default JSON, backwards-compatible): `GET /v1/payroll-runs/:id/lines/:lineId/slip`, `GET /v1/loans/:id/acknowledgment`, new `GET /v1/gate-passes/:id/receipt`. Web wired: payroll runs detail Slip button → blob, loan detail Download Acknowledgment button, gate console Print on each row. 21 new template unit tests pass.
- [2026-05-18] 11.2 — Four report detail pages built; one new endpoint. New `GET /v1/reports/ownership-transfers` (MANAGER+) in `reports/ownership-transfers.ts` pairs TRANSFER_OUT events with child lots via `parentLotId` walk; `OwnershipTransfersReportQuery` + `OwnershipTransferRow` schemas added to `@coldchain/shared`. Four pages replaced (no more stubs): `/reports/commodity-inventory` (expandable per-chamber rows), `/reports/weight-variance` (variance ≥2% red-flagged, date filters), `/reports/seasonal-summary` (OWNER-only, KPI cards + per-commodity table), `/reports/ownership-transfers` (timeline grouped by date, FULL/PARTIAL badges). Reports hub copy updated. 3 new integration tests pass (222 total).
- [2026-05-19] 11.3 — S-29 Visual Chamber Map shipped. New page `/chambers/map` (MANAGER+) renders a color-coded grid (4 tiers: empty / open <70% / busy 70–89% / full ≥90%). Click → modal with active lot list (calls `GET /v1/lots?chamber_id=…&status=ACTIVE`), with links to lot detail and chamber detail. `Map View` toggle button added on `/chambers`. No backend changes.
