# ColdChain — Build Progress

## Current Status
- **Active Phase**: Phase 8 — Accounting System (Phase 6 deferred to end)
- **Active Task**: PENDING
- **Blockers**: None
- **Last Updated**: 2026-04-24

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
| 7 | Financial Ledger & Payments | COMPLETED | 2026-04-24 | 2026-04-24 |
| 8 | Accounting System | PENDING | — | — |
| 9 | Gate Pass + Peshgi | PENDING | — | — |
| 10 | Reporting & Dashboards | PENDING | — | — |
| 11 | Admin, Polish & Pre-Launch | PENDING | — | — |

## Test Counts

| Phase | Unit | Integration | E2E | Total |
|-------|------|-------------|-----|-------|
| 0 | 14 | 13 | — | 27 |
| 1 | — | 25 | — | 25 |
| 2 | 9 | 24 | — | 33 |
| 3 | — | 9 | — | 9 |
| 4 | — | 13 | — | 13 |
| 5 | 8 | 12 | — | 20 |
| 7 | — | 12 | — | 12 |

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
