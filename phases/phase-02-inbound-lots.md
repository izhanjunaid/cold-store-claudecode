# Phase 2: Inbound & Lot Management (M2)

**Objective**: Lot creation, rate plans, service charges, lot number generation, weight dispute, storage receipt PDF.
**Branch**: `phase/02-inbound-lots`
**Prerequisites**: Phase 1

## Tasks

- [ ] 2.1 — Migration `0003_lots_billing_config`: rate_plans, service_charges, lots, ownership_history
- [ ] 2.2 — Lot Number Generation (LOT-YYMMDD-NNNN, concurrency-safe)
- [ ] 2.3 — Lot CRUD Backend (IB-01→IB-09)
- [ ] 2.4 — Rate Plan CRUD
- [ ] 2.5 — Service Charge Catalog CRUD
- [ ] 2.6 — PDF Service + Storage Receipt (Parchi)
- [ ] 2.7 — S-08 Lot List
- [ ] 2.8 — S-09 Lot Create (Inbound Form)
- [ ] 2.9 — S-10 Lot Detail
- [ ] 2.10 — S-11 Storage Receipt PDF
- [ ] 2.11 — S-17/S-18/S-19 Rate Plans & Service Charges

## Definition of Done
- Lot creation e2e; lot number unique; weight dispute works; receipt bilingual; WF-01 steps 2-12; 10+ tests
