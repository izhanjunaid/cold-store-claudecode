# ColdChain — Business Requirements Document (BRD)

**Version**: 1.0  
**Date**: March 2026  
**Audience**: Business stakeholders, founders, cold store operators  
**Platform**: ColdChain — Agri Cold Storage & Mandi Supply Chain Platform

---

## 1. Business Context

### 1.1 Industry Background
Pakistan's cold storage sector is a critical but underdeveloped node in the agricultural value chain. An estimated 30–40% of Pakistan's fruit and vegetable production is lost annually due to post-harvest handling failures, of which inadequate cold chain infrastructure and disorganized storage operations are leading contributors.

Lahore's mandi belt (Badami Bagh, Ravi Road, and peri-urban storage clusters) serves as the primary hub for Central Punjab's agri trade, handling millions of bags of potato, apple, onion, and seasonal produce annually. Cold stores in this zone function as **price discovery enablers** — allowing producers and traders to hold stock and sell at optimal prices — but operate with near-zero digitization.

### 1.2 Business Model of a Mandi Cold Store
A typical Lahore agri cold store earns revenue from:

| Revenue Stream | Description |
|---|---|
| Storage charges | Per-bag seasonal or monthly rate (e.g., Rs. 150–400/bag/season for potato) |
| Loading/unloading charges | Per-bag fee for physical handling at inbound/outbound |
| Sorting/grading fees | Per-bag fee when produce is sorted before dispatch |
| Cold store services | Any additional value-added services (washing, packing) |

Cost base includes: electricity (major), labor, maintenance, depreciation of cold equipment.

---

## 2. Strategic Objectives

| # | Objective | Business Value |
|---|---|---|
| O1 | Eliminate paper-based lot tracking | Reduce internal disputes; reduce loss from misplaced stock |
| O2 | Enable accurate billing for every lot | Recover full dues; eliminate billing leakage |
| O3 | Provide real-time receivables visibility | Enable proactive collections; reduce seasonal cash flow risk |
| O4 | Formally track ownership transfers | Eliminate mid-season disputes between farmers and traders |
| O5 | Create a quality/spoilage record trail | Reduce liability exposure in damage disputes |
| O6 | Build foundation for multi-facility growth | Support business scaling without re-implementing systems |

---

## 3. Stakeholder Analysis

| Stakeholder | Role | Primary Concern | Success Criteria |
|---|---|---|---|
| Cold Store Owner | Executive decision-maker | Revenue visibility, cash flow, client disputes | AR dashboard, revenue reports, dispute reduction |
| Cold Store Manager | Day-to-day operations | Accurate lot tracking, fast receipt generation | Under 3 min per inbound entry, minimal errors |
| Commission Agent (Arhti) | Client + intermediary | Accurate bills, lot accessibility | Correct billing, quick receipt confirmation |
| Farmer | Primary depositor | Secure storage, honest billing | Storage receipt, transparent bill |
| Trader | Speculator/buyer | Ownership clarity, withdrawal speed | Fast transfer processing, accurate lot balance |
| Security Guard | Gate control | Zero-friction data entry | Sub-15 second truck logging time |
| Accountant | Financial reconciliation | Ledger accuracy, payment tracking | Clean ledger, aging report |
| Software Vendor (ColdChain) | Product delivery | Adoption, satisfaction, renewal | User adoption rate, support escalation rate |

---

## 4. Core Business Processes

### BP-01: Produce Inbound (Lot Creation)

**Trigger**: A farmer, trader, or arhti arrives at the facility with produce.

**Steps**:
1. Gate operator verifies identity and commodity type
2. Produce is weighed on facility scale (accepted weight captured)
3. Operator records: party, commodity, variety, quantity, declared weight, vehicle
4. System assigns lot number and chamber location
5. Billing terms confirmed (rate plan selected)
6. Storage receipt (parchi) printed and given to depositor
7. Produce physically moved to assigned chamber

**Business Rules**:
- BR-01: Every inbound lot must have an assigned owner party before receipt can be issued
- BR-02: If declared weight vs. accepted weight differs by >2%, system flags dispute and operator must add resolution note
- BR-03: Billing terms must be locked at inbound; changes require manager override with audit log

---

### BP-02: Mid-Storage Ownership Transfer

**Trigger**: Current lot owner (farmer) sells produce to a buyer (trader) while lot remains in storage.

**Steps**:
1. Manager receives request from seller to transfer lot (or partial quantity) to new party
2. Manager verifies: requestor is current owner (or authorized agent), lot has sufficient quantity
3. System presents: current owner, lot details, quantity to transfer
4. Manager confirms: new owner party, transfer date, optional transfer price
5. System updates lot record: new owner_party, creates TRANSFER event in ownership_history
6. Old and new owners can receive printed/SMS notification
7. Billing for future storage accrues to new owner from transfer date

**Business Rules**:
- BR-04: Only the current owner or a manager can initiate an ownership transfer
- BR-05: Partial transfers create a new child lot; original lot quantity is reduced accordingly
- BR-06: Billing up to the transfer date is billed to the old owner; post-transfer to new owner. The transfer cannot be executed unless the old owner settles their accrued balance up to the transfer date OR the new owner explicitly assumes the liability.
- BR-07: Ownership transfer history must be immutable — no deletion allowed, only corrections with audit trail

---

### BP-03: Outbound Withdrawal & Billing

**Trigger**: Owner (or authorized party) requests withdrawal of all or part of a lot.

**Steps**:
1. Withdrawal request raised: lot ID, quantity to withdraw
2. System validates: requesting party is current owner / authorized
3. Produce physically removed, weighed out
4. Outbound weight recorded; variance from inbound calculated and displayed
5. System auto-calculates storage bill: quantity × rate × days
6. Service charges added (loading, etc.)
7. Invoice previewed and confirmed by manager
8. Dispatch note and invoice printed/emailed
9. Lot balance updated (or closed if full withdrawal)
10. Invoice posted to party ledger

**Business Rules**:
- BR-08: Withdrawal quantity cannot exceed current lot balance
- BR-09: Invoice cannot be finalized without outbound weight entry
- BR-10: Partial withdrawal does not close the lot; remaining balance continues to accrue storage charges
- BR-11: A dispatch note (gate pass) must be generated before produce leaves the facility

---

### BP-04: Quality Management

**Trigger**: Routine inspection cycle, owner complaint, or observable quality issue.

**Steps**:
1. Inspector records quality inspection: lot, date, observations, grade
2. If spoilage detected: spoilage record created with quantity affected and cause
3. Manager reviews: confirms or disputes spoilage assessment
4. If confirmed: lot quantity adjusted downward; adjustment note attached
5. Owner notified of spoilage event
6. If disputed: dispute flag raised; mediating process begins (offline)

**Business Rules**:
- BR-12: Lot quantity adjustments for spoilage require manager-level authorization
- BR-13: All spoilage records are permanent; quantity can only be reduced, not reversed without a counter-adjustment entry

---

### BP-05: Financial Settlement

**Trigger**: End of withdrawal cycle, month-end, or seasonal settlement.

**Steps**:
1. Party ledger reviewed: all outstanding invoices for the party
2. Payments received (cash/cheque/bank) are recorded against invoices
3. Partial payments allocated to oldest invoices first (configurable)
4. Any advances applied before payment allocation
5. Outstanding balance updated in real-time
6. Aging report generated; manager follows up with overdue parties

**Business Rules**:
- BR-14: Payments must be attributed to specific invoices; unattributed payments held as advance credit on party account
- BR-15: No invoice can be deleted once finalized; only credit notes can be issued for adjustments

### BP-06: Gate Pass Flow (Security)

**Trigger**: A truck arrives at or is ready to leave the facility gates.

**Steps**:
1. Guard logs arriving vehicle: Vehicle Number, Driver Name, Bilty No.
2. System generates `Inward Gate Pass` marking truck as ARRIVED.
3. Truck proceeds to weighbridge.
4. After unloading/loading and billing, guard verifies clearance.
5. System generates `Outward Gate Pass`, changing state to CLEARED.

**Business Rules**:
- BR-16: A truck cannot be marked CLEARED without a corresponding PAID invoice (or an explicit Manager Credit Authorization overriding the payment requirement) or cleared outbound event. A finalized invoice alone is insufficient to allow dispatch.
- BR-17: Turnaround time is tracked per vehicle.

---

### BP-07: Peshgi (Informal Loans)

**Trigger**: A farmer/arhti requests a cash advance (loan) secured against future storage.

**Steps**:
1. Owner issues cash/bank advance to party.
2. Operator records `Peshgi Issued` event (Asset created in ledger).
3. Party brings produce for storage over the season.
4. At settlement or withdrawal, the loan is recovered: `Peshgi Recovered` event.

**Business Rules**:
- BR-18: Peshgi balances are maintained strictly separate from Storage AR balances.
- BR-19: Only Owner can authorize a Peshgi issuance.

---

## 5. Non-Business Process Requirements

### 5.1 Information Requirements
- The system must retain all operational records (lots, invoices, payments, events) for a minimum of 5 years
- All mutations to lot records (weight, ownership, quantity) must carry an audit trail with operator ID, timestamp, and reason

### 5.2 Access Control Requirements
- Cold store owners must be able to view all data but restrict data-edit permissions to named operators
- Operators must not be able to delete records; only create and update with logging
- Managers have override capability for flagged transactions (disputes, adjustments)

### 5.3 Reporting Requirements
- Daily operational summary (inbound, outbound, payments) available by 8 PM each day
- Monthly party statements available for download/print
- Seasonal summary report for tax-filing purposes

### 5.4 Integration Requirements (Phase 2+)
- Weighbridge integration via serial/USB for automated weight capture
- SMS gateway for client notifications (Twilio / local provider)
- WhatsApp business API for digital parchi delivery

---

## 6. Compliance Considerations

| Area | Current Reality | System Support |
|---|---|---|
| Dual Bookkeeping | Market operates on Katchi (informal) and Pacci (official) ledgers | Platform-wide `book_type` flag (KATCHI/PACCI) supporting flexible mutable internal books and strict immutable official books |
| GST / Sales Tax | Many cold stores informal; some registered | Optional GST field on invoices; configurable per party |
| Income Tax | Presumptive tax for agri sector | Not enforced by system; reportable data available |
| Mandi regulations | Vary by commodity and district | Commodity-linked regulatory notes field |
| CNIC verification | Best practice for large transactions | CNIC capture as optional field on party profile |

---

## 7. Implementation Approach

### 7.1 Phased Rollout
1. **Week 1–2**: Data migration — enter all current clients (parties) and active lots as opening balances
2. **Week 3–4**: Operator training — inbound and outbound workflows on 2 test lots per day
3. **Month 2**: Full parallel operations — paper + system; reconcile daily
4. **Month 3**: System-only operations; paper retired

### 7.2 Change Management
- Champion model: identify one operator who becomes the in-house system expert
- Laminated one-page flow guide posted at weighbridge station
- WhatsApp support group for queries from operator team
- Monthly review with cold store owner on dashboard metrics

### 7.3 Support Model
- Tier 1: In-house champion resolves daily queries
- Tier 2: ColdChain support (9 AM – 6 PM, 6 days)
- Tier 3: Engineering escalation for system bugs
