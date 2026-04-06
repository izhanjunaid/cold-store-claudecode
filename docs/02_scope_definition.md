# Phase 3: System Scope Definition — ColdChain Platform

> **Product Name**: ColdChain  
> **Platform Type**: Agri Cold Storage Management & Mandi Supply Chain Platform  
> **MVP Scope**: Single facility, Lahore, Pakistan  
> **Future Scope**: Multi-facility, multi-city rollout  
> **Date**: March 2026

---

## 1. System Boundaries

### In Scope (MVP)
| Area | Included Functionality |
|---|---|
| Party Management | Farmers, traders, arhtis — account creation, ledgers, credit tracking |
| Inbound Operations | Lot creation, weigh-in, chamber assignment, storage receipt generation |
| Lot Management | Real-time lot tracking, partial/full withdrawals, location mapping |
| Ownership Transfer | Mid-storage ownership change with full audit trail |
| Billing Engine | Seasonal per-bag rate, per-bag-per-month rate, service charges (loading, grading) |
| Outbound Operations | Withdrawal requests, weigh-out, invoice generation, dispatch |
| Financial Ledger | Per-party accounts receivable/payable, payment recording, aging |
| Quality & Spoilage | Periodic inspection records, spoilage/damage entry, adjustment entries |
| Reporting & Dashboard | Occupancy, receivables, lot status, commodity breakdown |
| Gate Pass (Security) | Inward/Outward physical gate tracking, linked to inbound/outbound workflows |
| Peshgi (Informal Loans) | Recording cash advances given to farmers/arhtis and their recovery |
| Katchi/Pacci Ledgers | Dual-bookkeeping support allowing strict (Pacci) vs flexible (Katchi) record keeping |

### Out of Scope (MVP, future phases)
| Area | Reason |
|---|---|
| Mandi price feed integration | Requires external API partnerships |
| Mobile app for farmers | Phase 2 feature (web-first MVP) |
| GPS/transport tracking | Integration complexity; third-party system |
| Multi-facility management | Post-MVP; architecture supports it |
| Formal auction module | Not a current operational need |
| Insurance claim management | Too complex for MVP; placeholder records sufficient |
| Full ERP (procurement, payroll) | Out of scope; focus is cold store operations only |
| Bank/BNPL integrations | Phase 3 |
| Export compliance documentation | Phase 3 |

---

## 2. Major Modules

| # | Module | Core Function |
|---|---|---|
| M1 | **Party Management** | Manage all stakeholders — farmers, traders, arhtis, buyers — with accounts, credit profiles, document storage |
| M2 | **Inbound & Lot Management** | Receive produce, create lots, assign chambers, track weight, generate storage receipts |
| M3 | **Ownership Transfer Engine** | Transfer lot ownership mid-storage with full event history; critical differentiator |
| M4 | **Outbound & Dispatch** | Process withdrawals (full/partial), weigh-out, generate dispatch notes |
| M5 | **Billing Engine** | Configurable billing rules per commodity/client; generate invoices on trigger events |
| M6 | **Quality & Spoilage Management** | Log quality inspections, spoilage events, damage adjustments |
| M7 | **Financial Ledger & AR** | Party ledgers, payment recording, receivables aging, credit limit enforcement |
| M8 | **Chamber & Capacity Management** | Define physical chambers, track occupancy, flag overloading |
| M9 | **Reporting & Analytics** | Operational dashboards, financial summaries, commodity reports |
| M10 | **Gate Pass Management** | Security-driven inward and outward vehicle logging |
| M11 | **Peshgi (Informal Loans)** | Manage cash advances to farmers/arhtis and automated recovery |

---

## 3. Key Design Decisions

### 3.1 Party Hierarchy
```
Party
 ├── Farmer
 ├── Trader
 ├── Arhti (can be parent to multiple farmers)
 └── Buyer

Billing Party ≠ Lot Owner always
→ Separate "billing_party" and "owner_party" fields on every lot
```

### 3.2 Ownership Transfer as First-Class Event
- Not a workaround — a fully modeled event in the system
- Every lot has an `ownership_history` chain
- Transfer triggers: notification to old owner, new owner ledger entry, updated lot record
- Physical stock does not move; only the ownership record changes

### 3.3 Billing Engine Architecture
- Billing rules defined at `commodity × client_type × rate_type` level
- Rate types: `seasonal_per_bag`, `monthly_per_bag`, `per_day_per_bag`
- Service charges (loading, unloading, sorting, grading) as additive line items
- Bills auto-generated on: full withdrawal, partial withdrawal, month-end (for periodic billing)
- Bills can be pre-viewed and adjusted before finalization

### 3.4 Weight Dispute Handling
- Two weight fields at inbound: `declared_weight` (farmer/transporter) and `accepted_weight` (facility scale)
- Dispute flag raised if delta exceeds configurable threshold (e.g., >2%)
- Audit note field for resolution record
- Billing uses `accepted_weight` unless overridden by manager with justification

### 3.5 "Katchi" vs "Pacci" Bookkeeping (Dual Ledger)
- The system explicitly acknowledges the Pakistani agri reality of informal ("Katchi") vs official ("Pacci" / tax-compliant) business operations.
- All transactional records carry a `book_type` flag (`KATCHI` or `PACCI`).
- `PACCI` records are strictly immutable (no edits/deletes after posting).
- `KATCHI` records allow the `OWNER` role to perform "fudging" (soft deletes, silent edits) without visible frontend audit trails to maintain internal flexibility.

---

## 4. Stated Assumptions

| # | Assumption |
|---|---|
| A1 | Commodities are primarily potato and apple; system generalizes to any commodity |
| A2 | All billing in PKR; multi-currency not required in MVP |
| A3 | Single facility; multi-facility architecture will be supported via `facility_id` namespace but not exposed in MVP UI |
| A4 | Digital weighbridge integration is desirable but not mandatory in MVP; manual weight entry with override log is sufficient |
| A5 | Users (operators) have basic smartphone/tablet/PC access; Urdu UI labels required on key operational screens |
| A6 | GST invoicing is optional; system supports both formal and informal receipt modes |
| A7 | No automated payment gateway in MVP; payments are recorded manually |
| A8 | No offline mode in MVP; assume reliable internet at facility office; progressive enhancement in Phase 2 |
| A9 | Arhtis can be either billing parties or intermediary-only; the system supports both patterns without forcing structure |
| A10 | Cold chain failure events (power outage, temperature breach) are recorded manually by operator; IoT integration is Phase 2 |

---

## 5. Identified Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **Adoption resistance** from staff used to paper | High | Prioritize simplicity; minimal screens for daily ops; training plan |
| **Weight dispute escalation** without audit trail | High | Mandatory dual-weight capture; dispute flag workflow |
| **Informal billing disputes** from migrated legacy data | Medium | Allow backdated lot entry with override permissions |
| **Ownership chain integrity** during partial transfers | High | Atomic ownership transfer events; rollback on failure |
| **Credit overextension** without credit limits | Medium | Real-time AR aging dashboard; soft limit alerts |
| **Data loss from power failure** | Medium | Cloud-hosted with local caching; auto-save on critical forms |
| **Commodity mis-identification** | Medium | Commodity library with sub-variety options; operator confirmation on inbound |
| **Spoilage liability disputes** | High | Damage record with photo upload, timestamped, owner-notified |
| **Multi-owner lot confusion** in shared chambers | High | Visual chamber map with color-coded lot ownership overlay |

---

*Phase 3 complete. Proceeding to Phase 4: Full Documentation Suite.*
