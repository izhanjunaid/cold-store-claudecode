# Phase 8: Accounting System (M7 Extended)

**Objective**: Full double-entry accounting — CoA, 19 JE templates, GL, financial statements, credit notes, period locking, dual ledger, fixed assets, payroll, expenses.
**Branch**: `phase/08-accounting`
**Prerequisites**: Phase 7

## Tasks

- [ ] 8.1 — Migration `0008_accounting` (CoA, JE, JE lines, credit notes, balance trigger)
- [ ] 8.2 — CoA Seed (40+ accounts from 09_accounting_spec.md §2)
- [ ] 8.3 — Journal Entry Service (all 19 JE templates)
- [ ] 8.4 — Wire JE Triggers (invoice→JE-01, payment→JE-02/03, advance→JE-04, dishonour→JE-06, spoilage→JE-09)
- [ ] 8.5 — Credit Note Backend (JE-05)
- [ ] 8.6 — Accounting API (CoA, JE, GL, trial balance, P&L, BS, period locking)
- [ ] 8.7 — Migration `0009_cost_side` (fixed assets, depreciation, employees, payroll, expenses)
- [ ] 8.8 — Cost-Side APIs (FA, payroll, expenses)
- [ ] 8.9 — S-35 Chart of Accounts
- [ ] 8.10 — S-36 Journal Entry List
- [ ] 8.11 — S-37 GL Account Ledger
- [ ] 8.12 — S-38 Financial Statements
- [ ] 8.13 — Dual Ledger (PACCI immutable, KATCHI mutable by OWNER)

## Definition of Done
- All 19 JE templates fire; trial balance balances; P&L/BS render; credit notes; period locking; Katchi/Pacci; WF-06; 20+ tests
