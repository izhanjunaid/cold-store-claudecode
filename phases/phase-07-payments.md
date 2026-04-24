# Phase 7: Financial Ledger & Payments (M7)

**Objective**: Payment recording, invoice allocation, advance handling, cheque dishonour, party ledger.
**Branch**: `phase/05-billing-engine` (continued)
**Prerequisites**: Phase 5
**Status**: COMPLETED (2026-04-24/25)

## Tasks

- [x] 7.1 — Migration `0006_payments` — Payment + PaymentAllocation models; PaymentMethod/PaymentStatus/ClearanceStatus enums
- [x] 7.2 — Payment Backend — payment.repository.ts, payment.service.ts, payment.controller.ts (6 routes)
- [x] 7.3 — S-25 Payment Recording (/payments/new) — party preselect via ?party_id=, allocation grid, Fill-balance shortcut
- [x] 7.4 — S-24 Payments List (/payments) — filters, pagination; S-26 Payment Detail — amount summary, dishonour flow
- [x] 7.5 — Wire Party Detail Tabs — Active Lots, Invoices, Payments (with Record CTA), Ledger (chronological DR/CR)
- [x] 7.6 — Enable Invoice Record Payment button → routes to /payments/new?party_id=
- [x] 7.7 — Integration tests — 12 cases covering all allocation rules, error paths, WF-04 e2e
- [x] 7.8 — E2E UI verification (playwright-cli) — full WF-04 walkthrough: 0 errors

## Key Endpoints

| Method | URL | Role | Purpose |
|--------|-----|------|---------|
| POST | `/v1/payments` | ACCOUNTANT+ | Create payment with optional allocations |
| GET | `/v1/payments` | ACCOUNTANT+ | List with status/method/date filters |
| GET | `/v1/payments/:id` | ACCOUNTANT+ | Detail + allocations |
| POST | `/v1/payments/:id/allocate` | ACCOUNTANT+ | Allocate to FINALIZED invoices |
| POST | `/v1/payments/:id/dishonour` | ACCOUNTANT+ | Mark DISHONOURED; reverse allocations |
| GET | `/v1/parties/:id/ledger` | ACCOUNTANT+ | Chronological party ledger |

## Business Rules Implemented

- Sum of allocations ≤ amount_pkr; over-allocation → 422
- is_advance=true → allocations empty; status=ADVANCE
- CHEQUE payments: clearanceStatus=CLEARED on create
- Dishonour: only CHEQUE; reverses all allocations in one tx; restores invoice balances
- Allocation requires invoice status=FINALIZED and billingPartyId === payment.partyId
- Party ledger merges FINALIZED invoices (debit) + non-DISHONOURED payments (credit) sorted chronologically with running balance

## Definition of Done
✅ All payment methods; allocation updates invoices; advance tracking; cheque dishonour; party ledger; 12 tests; WF-04 e2e verified via playwright-cli
