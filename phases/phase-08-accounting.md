# Phase 8: Accounting System (M7 Extended)

**Objective**: Full double-entry accounting — CoA, 19 JE templates, GL, financial statements, credit notes, period locking, dual ledger, fixed assets, payroll, expenses.
**Branch**: `phase/08-accounting`
**Prerequisites**: Phase 7
**Status**: **Phase 8A complete (2026-05-05)** — revenue-side core ledger shipped. Phase 8B (cost-side) deferred to its own plan.

## Tasks

### Phase 8A — Core Ledger (shipped)
- [x] 8.1 — Schema additions (CoA, JE, JE lines, credit notes, period locks; FKs on Invoice/Payment/RatePlan/ServiceCharge). Pushed via `prisma db push`.
- [x] 8.2 — CoA Seed (73 accounts: 62 detail + 11 header per `docs/09_accounting_spec.md` §2; rate plans + service charges wired to revenue accounts)
- [x] 8.3 — Journal Entry Service + 11 templates (JE-01..08, JE-10, JE-11, JE-11R) with balance enforcement, period-lock check, header/inactive account guards
- [x] 8.4 — Wire JE Triggers (invoice finalize→JE-01, payment record→JE-02/03, allocate advance→JE-04, dishonour→JE-06+JE-02 reversed)
- [x] 8.4b — Backfill script for pre-Phase-8 invoices/payments (idempotent)
- [x] 8.5 — Credit Note Backend (JE-05) with `CN-YYYYMM-NNNN` numbering
- [x] 8.6 — Accounting API (CoA, JE manual, GL, trial balance, P&L, BS, period lock/unlock, credit notes, bad-debt write-off)
- [x] 8.9 — S-35 Chart of Accounts (frontend)
- [x] 8.10 — S-36 Journal Entry List + Detail + Manual Entry form
- [x] 8.11 — S-37 GL Account Ledger
- [x] 8.12 — S-38 Financial Statements (Trial Balance, P&L, Balance Sheet)
- [x] 8.13 — Dual Ledger (`book_type` filter on every accounting query; manual JE form blocks non-OWNER from posting KATCHI)

### Phase 8B — Cost-side (deferred)
- [ ] 8.7 — Migration `0009_cost_side` (fixed assets, depreciation, employees, payroll, expenses)
- [ ] 8.8 — Cost-Side APIs (FA, payroll, expenses, peshgi)

JE-09 / JE-09B (spoilage) also deferred — depends on Phase 6 (Quality & Spoilage), which is itself deferred.

## Definition of Done — Phase 8A
- ✅ 11 JE templates auto-fire on operational events
- ✅ Trial balance balances (DR = CR) — verified in tests and live smoke check
- ✅ P&L renders revenue/cost-of-service/expense, net profit
- ✅ Balance sheet equation: Assets = Liabilities + Equity
- ✅ Credit notes (JE-05) — MANAGER+
- ✅ Bad-debt write-off (JE-08) — OWNER-only
- ✅ Period locking (MANAGER lock, OWNER unlock); JE service rejects backdated entries with `PERIOD_LOCKED`
- ✅ KATCHI/PACCI dual ledger (schema + filter; mutation UI deferred to polish)
- ✅ 40 new tests (16 unit + 24 integration) — all green; 132 integration + 16 unit = 148 total tests passing across all phases
