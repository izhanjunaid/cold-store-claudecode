# Phase 10: Reporting & Dashboards (M9)

**Objective**: All dashboard views and report endpoints.
**Branch**: `phase/10-reporting` (off `phase/09-gate-peshgi`)
**Prerequisites**: Phases 0-9

## Tasks

- [x] 10.1 — Report Endpoints (dashboard, lot-aging, receivables-aging, commodity-inventory, weight-variance, seasonal-summary, party-statement)
- [x] 10.2 — Party Statement PDF (bilingual)
- [x] 10.3 — S-03 Operational Dashboard
- [x] 10.4 — S-04 Financial Dashboard
- [x] 10.5 — S-30 Report Hub (3 detail pages: Lot Aging, Receivables Aging, Party Statement; 4 stubs)
- [x] 10.6 — S-31 Party Statement (picker + detail)

## What shipped

### Backend (`apps/api/src/modules/reporting/`)
- 7 GET endpoints under `/v1/reports/*`:
  - `/dashboard` — OPERATOR+. Financial fields stripped for OPERATOR (returned as `null`).
  - `/lot-aging` — MANAGER+. Paginated.
  - `/receivables-aging` — ACCOUNTANT+. Buckets 0–30 / 31–60 / 61–90 / 90+ via pure `bucketFor` helper.
  - `/commodity-inventory` — MANAGER+.
  - `/weight-variance` — MANAGER+. Prorated inbound × `(withdrawn_bags / quantity_bags)`.
  - `/seasonal-summary` — OWNER. `date_from` + `date_to` required.
  - `/party-statement/:partyId` — ACCOUNTANT+. `format=json` (default) or `format=pdf`.
- Helpers: `aging-buckets.ts`, `days-in-storage.ts` (re-export from lot module).
- AR aging reconciles to GL accounts **1110 + 1120 + 1130 + 1150** (per locked decision).

### Schema / DB
- Migration `0011_reporting_indexes` — 5 composite indexes:
  - `invoices (facility_id, status, invoice_date)`
  - `invoices (facility_id, billing_party_id, status)`
  - `outbound_events (facility_id, outbound_date, status)`
  - `lots (facility_id, status, inbound_date)`
  - `payments (facility_id, payment_date, status)`
- Mirrored as `@@index` in `schema.prisma`.

### Extensions
- `paymentService.getPartyLedger(facilityId, partyId, opts?)` now accepts `{ fromDate, toDate, bookType }`.
  Includes CreditNote rows on the credit side (status ∈ {ISSUED, APPLIED}). Returns `opening_balance_pkr`.
  Backwards-compatible — existing `/v1/parties/:id/ledger` callers unaffected.
- `daysInStorage` extracted to `apps/api/src/modules/lot/days-in-storage.ts`.

### PDF
- `renderPartyStatement` + `renderPartyStatementHtml` in `pdf.service.ts`.
- Bilingual A5 template at `apps/api/src/modules/pdf/templates/party-statement.html`.

### Shared
- `packages/shared/src/schemas/reports.ts` — 7 query schemas + response shapes.
- `PartyLedgerEntry.type` enum extended with `CREDIT_NOTE`. `PartyLedgerResponse` gained `opening_balance_pkr` (default 0).

### Frontend
- React Query provider wired at `(app)/providers.tsx`. Scoped to new Phase 10 pages only.
- Recharts installed.
- `/dashboard` (S-03) — rewritten with KPI cards, Recharts BarChart (chamber occupancy + threshold ref line), AttentionPanel, SpoilagePlaceholder. **30s polling**.
- `/dashboards/financial` (S-04) — KPI cards, Recharts PieChart donut, top-5 overdue parties table. **Manual refresh button.**
- `/reports` (S-30) — 7 nav tiles with role-based hiding.
- `/reports/lot-aging` — full table with pagination.
- `/reports/receivables-aging` — buckets card grid + parties table with as-of-date input.
- `/reports/party-statement` (picker) + `/reports/party-statement/[partyId]` (detail) — party search, date range, book-type radio, JSON view + **Download PDF** button (blob → new tab pattern).
- `/reports/{commodity-inventory,weight-variance,seasonal-summary,ownership-transfers}` — stub pages (detail in Phase 11).
- Sidebar: added "Financial" nav item.

### Tests
- **10 unit**: aging-buckets boundaries (6) + days-in-storage (4).
- **20 integration** (`reporting.integration.test.ts`):
  - Dashboard: MANAGER full / OPERATOR financial=null / occupancy_pct sanity (3)
  - Lot Aging: happy / commodity filter / OPERATOR 403 (3)
  - Receivables Aging: aged buckets / OPERATOR 403 / **AR reconciliation against GL 1110+1120+1130+1150** (3)
  - Commodity Inventory: grouping (1)
  - Weight Variance: prorated row / excludes lots without DISPATCHED outbound (2)
  - Seasonal Summary: happy / missing date_from 400 / MANAGER 403 (OWNER-only) (3)
  - Party Statement: JSON / opening balance with date_from / PACCI vs KATCHI / format=pdf returns application/pdf / OPERATOR 403 (5)

## Definition of Done
- [x] Dashboards with real KPIs.
- [x] All 7 report endpoints live with role gating.
- [x] Party statement PDF.
- [x] Dashboard <3s (parallel queries, indexed).
- [x] Reports <5s p95 (composite indexes from 0011).
- [x] 92 unit + 219 integration green (added 10 + 20).
- [x] Web typecheck + production build green.

## Locked decisions (from planning)
1. Branch base: `phase/09-gate-peshgi` (foundation is bare).
2. AR aging includes account 1150 (BUYER/OTHER), not just 1110+1120+1130.
3. Ship 3 detail pages + 4 stubs; all 7 backend endpoints live.
4. React Query adopted only on new Phase 10 pages.
5. M6 (Quality & Spoilage) stays deferred — operational dashboard shows static placeholder.
6. Recharts is the chart lib.
7. S-03 polls every 30s; S-04 static load with manual refresh.
8. Auto-resolved: DISPUTED filter dropped (enum has no DISPUTED for invoices), `/dashboards/financial` sibling URL, party statement includes CreditNote rows.
