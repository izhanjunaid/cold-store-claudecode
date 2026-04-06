# ColdChain — Product Requirements Document (PRD)

**Version**: 1.0  
**Date**: March 2026  
**Status**: Draft for Review  
**Product**: ColdChain — Agri Cold Storage & Mandi Supply Chain Platform  
**Scope**: MVP — Single facility, Lahore, Pakistan

---

## 1. Executive Summary

ColdChain is a purpose-built software platform for agri cold storage facilities integrated into Pakistan's mandi supply chain. It replaces paper registers and informal Excel tracking with a structured digital system that manages produce intake, multi-owner lot tracking, mid-storage ownership transfers, flexible billing, and party-level financial ledgers.

The platform is designed for cold store operators in Lahore's peri-urban mandi belt, serving farmers, commission agents (arhtis), and traders who store seasonal produce (primarily potato and apple) to capitalize on market price movements.

---

## 2. Problem Statement

Cold storage facilities serving mandi ecosystems operate with chronic inefficiency due to:

1. **No lot-level traceability** — produce from 10–30 different owners in a single chamber is tracked manually via paper tags
2. **Missing ownership transfer mechanism** — when a farmer sells to a trader mid-storage, the change is recorded in a physical register, creating disputes and errors
3. **Opaque billing** — billing is informal and settlement is delayed; disputes arise from undocumented agreements
4. **No receivables visibility** — cold store operators have no clear view of who owes what across seasonal credit cycles
5. **Weight dispute dead-ends** — no system to record declared vs. accepted weight or dispute resolution notes
6. **Quality degradation ignored** — produce approaching spoilage is not systematically flagged

These problems result in financial leakage, client disputes, and operational chaos during peak season.

---

## 3. Product Vision

> **"Give cold store operators real-time control over their facility, their clients, and their money — with the simplicity that mandi operations demand."**

ColdChain will be the operational backbone for agri cold storage businesses, enabling:
- **Operators** to manage every lot from inbound to dispatch without paper
- **Business owners** to see real-time financial exposure and occupancy
- **Clients (farmers/traders)** to receive accurate, timely bills and receipts

---

## 4. Target Users & Personas

### Persona 1: Cold Store Manager (Mushtaq, 35)
- Runs day-to-day operations: receiving produce, assigning chambers, issuing receipts
- Phone-literate; can use a tablet app but not complex software
- Pain: manually tracking which bags belong to which owner in a shared chamber
- Need: fast inbound entry, clear lot dashboard, simple withdrawal processing

### Persona 2: Cold Store Owner / Business Head (Tariq, 48)
- Reviews finances, manages client relationships, authorizes credit
- Uses WhatsApp; occasionally checks Excel files
- Pain: no clear picture of total outstanding receivables during season
- Need: financial dashboard, aging report, dispute log

### Persona 3: Commission Agent / Arhti (Hameed, 52)
- Brings farmer produce to the cold store; may manage multiple farmer lots
- Pays cold store bills from farmer sale proceeds
- Pain: getting accurate weight and bill at withdrawal time
- Need: SMS/print receipt confirmation, easy lot inquiry

### Persona 4: Farmer (Ghulam, 44)
- Brings produce from field; limited literacy; speaks Punjabi/Urdu
- Pain: not knowing current lot status or exact bill amount
- Need: simple printed receipt at deposit and withdrawal

### Persona 5: Security Guard (Rashid, 28)
- Manages the physical entrance/exit of the facility
- Pain: trucks piling up at the gate, drivers losing slips
- Need: extremely fast interface to log vehicle IN and OUT; no complex data entry

---

## 5. Feature Requirements — MVP

### M1: Party Management
| ID | Feature | Priority |
|---|---|---|
| PM-01 | Create/edit party profiles: name, type (farmer/trader/arhti/buyer), contact, address | P0 |
| PM-02 | Link farmers to arhtis (optional parent-child relationship) | P0 |
| PM-03 | Set billing party per lot (can differ from owner) | P0 |
| PM-04 | Party credit profile: current balance, credit limit (soft), payment history | P1 |
| PM-05 | Attach supporting documents (CNIC photo, land record) | P2 |
| PM-06 | Urdu name field support | P0 |

### M2: Inbound & Lot Management
| ID | Feature | Priority |
|---|---|---|
| IB-01 | Create inbound lot: party, commodity, variety, quantity (bags/crates), declared weight, accepted weight | P0 |
| IB-02 | Auto-generate lot number with date prefix (e.g., LOT-250301-0042) | P0 |
| IB-03 | Assign lot to chamber + stack/row position | P0 |
| IB-04 | Capture vehicle number and transporter at inbound | P1 |
| IB-05 | Flag weight dispute if declared vs. accepted delta > threshold (configurable) | P0 |
| IB-06 | Generate printable/PDF storage receipt (parchi) | P0 |
| IB-07 | Attach inbound photos for quality documentation | P1 |
| IB-08 | Set billing terms at lot level (rate plan selection) | P0 |
| IB-09 | Record inbound quality grade (A/B/C or custom) | P1 |

### M3: Ownership Transfer Engine
| ID | Feature | Priority |
|---|---|---|
| OT-01 | Transfer full lot ownership from party A to party B | P0 |
| OT-02 | Transfer partial quantity from a lot to a new owner (creates child lot) | P0 |
| OT-03 | Record transfer price (optional, for financial reference) | P1 |
| OT-04 | Maintain ownership history log per lot (old owner, new owner, date, operator) | P0 |
| OT-05 | Notify both parties (SMS/printed notice) on transfer | P1 |
| OT-06 | Require manager authorization for ownership transfer | P0 |

### M4: Outbound & Dispatch
| ID | Feature | Priority |
|---|---|---|
| OB-01 | Initiate withdrawal request: lot ID, quantity to withdraw | P0 |
| OB-02 | Record outbound weight at dispatch | P0 |
| OB-03 | Calculate weight variance (inbound accepted weight vs outbound weight) | P0 |
| OB-04 | Update lot balance after partial withdrawal; close lot on full withdrawal | P0 |
| OB-05 | Generate dispatch note / gate pass | P0 |
| OB-06 | Link dispatch to invoice (auto-trigger billing) | P0 |
| OB-07 | Record buyer/recipient at outbound | P1 |
| OB-08 | Require lot balance > 0 validation before withdrawal | P0 |

### M5: Billing Engine
| ID | Feature | Priority |
|---|---|---|
| BL-01 | Define rate plans: seasonal per-bag, monthly per-bag, daily per-bag | P0 |
| BL-02 | Rate plan assigned per commodity + client tier | P0 |
| BL-03 | Auto-calculate storage charges: quantity × rate × duration | P0 |
| BL-04 | Add service charge line items: loading, unloading, sorting, grading | P0 |
| BL-05 | Preview invoice before finalization | P0 |
| BL-06 | Finalize and lock invoice; assign invoice number | P0 |
| BL-07 | Adjustment/credit note on finalized invoice | P1 |
| BL-08 | Backdated invoice support (with override log) | P1 |
| BL-09 | GST field (optional; configurable per party) | P1 |
| BL-10 | Print/PDF invoice | P0 |

### M6: Quality & Spoilage Management
| ID | Feature | Priority |
|---|---|---|
| QS-01 | Log periodic quality inspection per lot (date, inspector, grade, notes) | P0 |
| QS-02 | Record spoilage/damage event: quantity affected, cause, operator note | P0 |
| QS-03 | Adjust lot quantity on confirmed spoilage (with approval) | P0 |
| QS-04 | Attach photos to quality/spoilage records | P1 |
| QS-05 | Flag lots that have been in storage > threshold days for review | P0 |
| QS-06 | Damage claim record: disputed vs. settled status | P1 |

### M7: Financial Ledger & AR
| ID | Feature | Priority |
|---|---|---|
| FL-01 | Party ledger: all invoices, payments, adjustments per party | P0 |
| FL-02 | Record payments: cash, cheque, bank transfer | P0 |
| FL-03 | Receivables aging report: 0–30, 31–60, 61–90, 90+ days | P0 |
| FL-04 | Soft credit limit alerts | P1 |
| FL-05 | Advance payment recording (credit before bill) | P1 |
| FL-06 | Settlement summary at season end | P1 |
| FL-07 | Daily cash receipt summary | P0 |
| FL-08 | **Book Type Filter**: Toggle ledgers/dashboards between `KATCHI` (actual internal) and `PACCI` (official/taxable) views | P0 |
| FL-09 | **Katchi Edit Rights**: Allow OWNER role to modify/delete `KATCHI` entries to support informal bookkeeping flexibility | P0 |

### M8: Chamber & Capacity Management
| ID | Feature | Priority |
|---|---|---|
| CM-01 | Define chambers: name, commodity type, max capacity (bags/tons) | P0 |
| CM-02 | View current occupancy per chamber | P0 |
| CM-03 | Visual chamber map with lot positions | P1 |
| CM-04 | Alert on chamber approaching capacity (>90%) | P0 |
| CM-05 | Temperature log per chamber (manual entry in MVP) | P1 |

### M9: Reporting & Analytics
| ID | Feature | Priority |
|---|---|---|
| RP-01 | Operational dashboard: total lots active, occupancy %, commodity breakdown | P0 |
| RP-02 | Financial dashboard: total AR, collected today, overdue | P0 |
| RP-03 | Lot aging report: lots by days in storage | P0 |
| RP-04 | Commodity inventory report: total bags per commodity | P0 |
| RP-05 | Party statement (downloadable PDF) | P0 |
| RP-06 | Weight variance report: inbound vs outbound across lots | P1 |
| RP-07 | Seasonal summary: total intake, total dispatched, revenue | P1 |

### M10: Gate Pass Management (Security)
| ID | Feature | Priority |
|---|---|---|
| GP-01 | Log truck arrival (Inward Pass): Vehicle No, Driver, Bilty No | P0 |
| GP-02 | Log truck dispatch (Outward Pass): Validate against cleared outbound event/invoice | P0 |
| GP-03 | Track facility turnaround time (Inward to Outward delta) | P1 |

### M11: Peshgi (Informal Loans)
| ID | Feature | Priority |
|---|---|---|
| PL-01 | Issue cash/bank advance (Peshgi) to Farmer/Arhti | P0 |
| PL-02 | Track Peshgi recovery against inbound lots or cash repayments | P0 |
| PL-03 | Maintain separate Peshgi balance vs Storage AR balance on Party Profile | P0 |

---

## 6. User Stories (Critical Paths)

### US-01: Farmer Deposits Produce
> As a **cold store manager**, I want to register a new inbound lot for a farmer, record the weight, assign a chamber, and print a storage receipt — so the farmer has formal confirmation of deposit.

### US-02: Farmer Sells to Trader Mid-Storage
> As a **cold store manager**, I want to transfer ownership of a lot from a farmer to a trader without physically moving the stock — so the ledger reflects the new owner immediately with a clear history trail.

### US-03: Trader Withdraws Partial Stock
> As a **cold store manager**, I want to process a partial withdrawal for a trader's lot, record the outbound weight, auto-generate a bill for the withdrawn quantity, and update the remaining lot balance.

### US-04: Owner Reviews Outstanding Receivables
> As a **cold store owner**, I want to see a live receivables aging report showing which clients owe money and for how long — so I can follow up before the season ends.

### US-05: Quality Inspection Flags Spoiling Lot
> As a **cold store manager**, I want to log a quality inspection finding that 200 bags in a lot are spoiling, adjust the lot quantity, and notify the owner — so there is a documented record for any future dispute.

---

## 7. Success Metrics

| Metric | Target (6 months post-launch) |
|---|---|
| Daily inbound/outbound operations logged digitally | 100% |
| Paper-based billing eliminated | > 90% |
| Billing disputes resolved within system | > 80% |
| Receivables aging visibility | Real-time |
| Ownership transfer events tracked | 100% |
| Time to generate invoice | < 2 minutes |
| System uptime | > 99% |

---

## 8. Release Roadmap

### MVP (Phase 1) — Months 1–3
- All P0 features across M1–M9
- Web-based portal (desktop + tablet)
- PDF receipt and invoice generation
- Manual weight entry

### Phase 2 — Months 4–6
- Mobile app for managers (Android)
- Urdu UI throughout
- Weighbridge integration (if available)
- SMS notifications to clients
- Offline mode for entry with sync
- IoT temperature logging

### Phase 3 — Months 7–12
- Multi-facility support
- Farmer-facing portal (lot status enquiry)
- Mandi price feed integration (advisory)
- Bank transfer / mobile wallet payment integration
- Export compliance documentation
- Insurance claim management module
