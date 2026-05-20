# Phase 11: Admin, Polish & Pre-Launch

**Objective**: Admin screens, full E2E testing, performance optimization, security hardening.
**Branch**: `phase/11-admin-polish`
**Prerequisites**: Phases 0-10
**Started**: 2026-05-18

## Buckets (in execution order — one commit per bucket)

- [x] 11.0 — Branch setup
- [x] 11.1 — Deferred PDFs (salary slip, loan acknowledgment, gate pass receipt)
- [x] 11.2 — Four deferred report detail pages + new `/v1/reports/ownership-transfers` endpoint
- [x] 11.3 — S-29 Visual Chamber Map (P1)
- [x] 11.4 — S-39 User Management (OWNER-only CRUD + must-change-password flow)
- [x] 11.5 — S-40 System Settings (Facility info + operational settings via JSONB)
- [x] 11.6 — Playwright E2E Suite (WF-01→WF-07, WF-05 fixme'd for Phase 6 deferral)
- [x] 11.7 — Performance baseline + targeted fixes (10 endpoints vs. <500ms p95)
- [x] 11.8 — Security Hardening (OWASP Top 10 checklist)
- [x] 11.9 — OpenAPI Documentation (@fastify/swagger + swagger-ui at /docs)

## Definition of Done
- All 40 screens render; 6 of 7 E2E workflows pass (WF-05 fixme for Phase 6); NFR targets met; OWASP addressed; OpenAPI at /docs.

## 11.1 — Deferred PDFs (shipped)

**Files added**
- `apps/api/src/modules/pdf/templates/salary-slip.html` — bilingual A5
- `apps/api/src/modules/pdf/templates/loan-acknowledgment.html` — bilingual A5 with prominent principal banner
- `apps/api/src/modules/pdf/templates/gate-pass-receipt.html` — bilingual A5 with direction banner
- 3 unit test files (21 tests total — bilingual headers, conditional rendering, fields)

**Files modified**
- `apps/api/src/modules/pdf/pdf.service.ts` — added 3 data interfaces, 3 `renderXxxHtml`, 3 `renderXxx` (Puppeteer), and a shared `htmlToA5Pdf` helper to avoid further duplication.
- `apps/api/src/modules/payroll/payroll.controller.ts` — `GET /v1/payroll-runs/:id/lines/:lineId/slip` now accepts `?format=pdf` (default JSON, backwards-compatible).
- `apps/api/src/modules/peshgi/peshgi.controller.ts` — `GET /v1/loans/:id/acknowledgment?format=pdf`. Fetches facility + party.nameUrdu for bilingual rendering.
- `apps/api/src/modules/gate-pass/gate-pass.controller.ts` — new `GET /v1/gate-passes/:id/receipt?format=pdf|json` (SECURITY+).
- `apps/web/src/app/(app)/accounting/payroll/runs/[id]/page.tsx` — Slip button downloads blob.
- `apps/web/src/app/(app)/loans/[id]/page.tsx` — Download Acknowledgment button next to existing actions.
- `apps/web/src/app/(app)/loans/issue/page.tsx` — removed stale "PDF rendering deferred" notice.
- `apps/web/src/app/(app)/gate/page.tsx` — Print buttons on Currently Inside and Recently Cleared lists; added `printGatePassReceipt(passId)` helper.

## 11.2 — Four report detail pages (shipped)

**API**
- `apps/api/src/modules/reporting/reports/ownership-transfers.ts` — new module. `getOwnershipTransfers()` reads `TRANSFER_OUT` history rows, pairs each event with the next-available child lot via `parentLotId` (cursor-walked oldest-first to handle multiple partial transfers off the same parent). Filters: date range + party_id (either side).
- `apps/api/src/modules/reporting/reporting.controller.ts` — `GET /v1/reports/ownership-transfers` (MANAGER+) wired.
- `packages/shared/src/schemas/reports.ts` — `OwnershipTransfersReportQuery` (date + party filter, paginated) and `OwnershipTransferRow` shape (transfer_id, lot_number, child_lot_number, from/to party, quantity, transfer_price, type FULL|PARTIAL, notes).

**Web (4 stub pages replaced)**
- `apps/web/src/app/(app)/reports/commodity-inventory/page.tsx` — accordion list per commodity with expandable per-chamber breakdown (bags + occupancy%).
- `apps/web/src/app/(app)/reports/weight-variance/page.tsx` — table with rows red-flagged when |variance_pct| ≥ 2%, date-range filters, paginated.
- `apps/web/src/app/(app)/reports/seasonal-summary/page.tsx` — OWNER-only, 4 KPI cards (inbound/outbound/revenue/avg storage days) + per-commodity table. Defaults to last 6 months.
- `apps/web/src/app/(app)/reports/ownership-transfers/page.tsx` — events grouped by date, FULL/PARTIAL badges, lot → child-lot arrow, from→to party flow, quantity + price.
- `apps/web/src/app/(app)/reports/page.tsx` — hub copy no longer references "Phase 11" stubs.

**Tests**
- 3 new integration tests in `reporting.integration.test.ts`: happy path (PARTIAL transfer surfaces with from/to + child_lot_id), party_id filter (matches both sides), OPERATOR 403. Suite: 222 integration (was 219).

## 11.7 — Performance pass (shipped)

`scripts/perf-baseline.ts` runs autocannon against 10 endpoints (30s each, concurrency 10). Run with `pnpm perf:baseline` after the API is up locally. Results land in `phases/phase-11-baseline.json`.

Baseline captured 2026-05-20 on local dev (Windows 10, Postgres 15):

| Endpoint                       | p95   | Budget | Notes |
|--------------------------------|-------|--------|-------|
| `GET /v1/parties`              | 28ms  | 500ms  | within budget |
| `GET /v1/lots`                 | 21ms  | 500ms  | within budget |
| `GET /v1/invoices`             | 22ms  | 500ms  | within budget |
| `GET /v1/payments`             | 21ms  | 500ms  | within budget |
| `GET /v1/reports/dashboard`    | 21ms  | 5000ms | within budget |
| `GET /v1/reports/lot-aging`    | 22ms  | 5000ms | within budget |
| `GET /v1/reports/receivables-aging` | 21ms | 5000ms | within budget |
| `GET /v1/reports/commodity-inventory` | 20ms | 5000ms | within budget |
| `GET /v1/reports/weight-variance` | 22ms | 5000ms | within budget |
| `GET /v1/parties/:id/ledger`   | 24ms  | 5000ms | within budget |

All endpoints comfortably within their NFR budgets — no fixes required this pass. The script exits 1 if any endpoint goes over budget on future runs, so it can be wired into CI as a guardrail.
