# Phase 4: Outbound & Dispatch (M4)

**Objective**: Withdrawal processing, weight recording, dispatch notes, lot balance updates.
**Branch**: `phase/04-outbound-dispatch`
**Prerequisites**: Phase 3
**Status**: COMPLETED — 2026-04-17

## Tasks

- [x] 4.1 — Migration `0004_outbound_events` — via `prisma db push` (shadow DB permissions unavailable); enums `WithdrawalType`, `OutboundStatus` added to Prisma schema
- [x] 4.2 — Outbound Events Backend — 5 endpoints: POST create, GET by ID, PATCH weight, POST finalize, GET dispatch-note PDF. Dispatch note number `DN-YYMMDD-NNNN` with advisory lock. Row-lock on lot during create and finalize.
- [x] 4.3 — Dispatch Note PDF — bilingual (English/Urdu) Handlebars template + `renderDispatchNote()` in pdf.service.ts
- [x] 4.4 — S-14 Withdrawal Form — `/lots/:id/withdraw` page with FULL/PARTIAL toggle, balance validation
- [x] 4.5 — S-15 Outbound Event Detail — `/outbound-events/:id` page with weight recording, finalize confirm dialog, dispatch note print button
- [x] 4.6 — S-16 Dispatch Note PDF — served via blob fetch from detail page (no separate route needed)
- [x] 4.7 — Lot Detail updated — "New Withdrawal" button (OPERATOR+, ACTIVE lots), Withdrawals tab fetches `GET /v1/lots/:id/outbound-events` and renders events table

## Notes
- CANCELLED and DISPUTED statuses exist in the enum but have no dedicated endpoints in Phase 4 (deferred to Phase 6/admin)
- `GET /v1/lots/:id/outbound-events` added to lot controller (not in original API spec §4.5 but required by frontend tab)

## Definition of Done
- [x] Withdrawal validates balance; finalize deducts; full withdrawal closes lot; dispatch PDF; 13 tests all passing
