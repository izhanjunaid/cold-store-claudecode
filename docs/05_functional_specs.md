# ColdChain — Functional Specifications

**Version**: 1.0  
**Date**: March 2026  
**Audience**: Developers, QA engineers, product managers

---

## M1: Party Management

### Overview
Centralized registry of all business parties interacting with the cold store: farmers, commission agents (arhtis), traders, and buyers. Each party has a unique account, credit profile, and transaction history.

### Functional Behavior

**Party Creation**
- Required fields: full name, party type (enum: FARMER | TRADER | ARHTI | BUYER | OTHER), primary phone number
- Optional fields: secondary phone, address, CNIC number, Urdu name, notes
- Auto-generated: party_id (unique), created_at, created_by
- Urdu name stored separately and used on printed receipts

**Party Hierarchy (Arhti–Farmer Link)**
- A FARMER party can be linked to an ARHTI party as their broker
- This relationship is optional and can be changed
- When linked: invoice notifications can be routed to the arhti if configured; the arhti's account can be set as the billing party for farmer lots

**Billing Party Separation**
- Every lot has two party fields: `owner_party_id` (who owns the produce) and `billing_party_id` (who gets billed)
- Default: billing_party = owner_party
- Override: manager can set billing_party to an arhti or another linked party
- Billing party change is logged with reason

**Credit Profile**
- Fields: `credit_limit` (PKR, optional soft limit), `credit_terms_days` (default payment window)
- Current balance calculated from: sum of unpaid invoices minus unapplied advance payments
- When current balance exceeds credit_limit: system shows visual warning (does not block operations in MVP)

**Edge Cases**
- Duplicate phone: system warns but allows creation (common in Pakistan — shared family numbers)
- Party deactivation: parties with active lots cannot be deactivated; must resolve lots first
- Merge parties: admin-level function to merge duplicate party records (preserves all transaction history)

---

## M2: Inbound & Lot Management

### Overview
The core operational module. Records the arrival of produce, creates a lot record, assigns storage location, and generates a formal storage receipt.

### Functional Behavior

**Lot Creation Form**
Required fields:
- `owner_party_id`: who is depositing
- `billing_party_id`: defaults to owner, overridable
- `commodity`: from commodity master (e.g., POTATO, APPLE, ONION, KINNOW)
- `variety`: sub-type within commodity (e.g., Cardinal, Desiree for potato)
- `quantity`: integer, in bags or crates (unit configured per commodity)
- `accepted_weight_kg`: weight as measured at facility (mandatory)
- `inbound_date`: defaults to today, can be backdated with manager override
- `chamber_id`: assigned chamber (dropdown from available chambers)
- `rate_plan_id`: billing plan to apply

Optional fields:
- `declared_weight_kg`: as stated by transporter/farmer
- `vehicle_number`
- `marka`: goods-identification mark painted/stamped on the bardana or crates (free text, ≤100 chars; not unique). Used by operators and security to tell whose stack is whose in a shared chamber
- `quality_grade`: A/B/C (or facility-defined custom grades)
- `inbound_notes`
- `photos` (up to 5 images)

**Lot Number Generation**
- Format: `LOT-YYMMDD-NNNN` where NNNN is a zero-padded sequential number per day
- Example: `LOT-260301-0042`
- Lot number is immutable after creation

**Weight Dispute Detection**
- Trigger: `abs(accepted_weight_kg - declared_weight_kg) / declared_weight_kg > threshold`
- Default threshold: 2% (configurable in system settings)
- On trigger: form displays a yellow warning; `dispute_note` field becomes required
- Operator must enter resolution note (e.g., "Scale variance acknowledged by farmer Ghulam")
- Dispute flag stored; visible in lot record

**Chamber Assignment**
- Dropdown shows chambers filtered by commodity compatibility
- Available capacity shown: `(max_capacity - current_occupancy)` in bags
- If selected chamber is at >90% capacity: red warning shown
- System does not prevent assignment but warns; manager must acknowledge

**Storage Receipt (Parchi) Generation**
- Auto-generated PDF on lot save
- Contents: Lot number, date, owner name (English + Urdu), commodity + variety, **marka (when present)**, quantity, weight, chamber, rate plan, cold store name/stamp area
- Re-printable at any time from lot record
- A4 and half-page (A5) format options

**Backdated Lot Entry**
- Allowed up to manager override permission
- `inbound_date` can be set to a past date
- System records both `inbound_date` (physical event) and `entry_date` (system entry)
- Billing uses `inbound_date` for duration calculation

**Edge Cases**
- Zero bags: prevented by validation (minimum 1)
- Same party, same commodity, same day: allowed (each is a separate lot)
- Chamber not yet defined: operator must create chamber in M8 first
- Creating lot for inactive party: blocked with error message

---

## M3: Ownership Transfer Engine

### Overview
Supports the critical business event of mid-storage ownership change. This is a first-class event in ColdChain — not an administrative workaround — because it is a daily reality in agri cold storage trade.

### Functional Behavior

**Full Ownership Transfer**
- Input: source lot ID, new owner party ID, transfer date (default today), optional transfer price (PKR)
- Validation:
  - Requesting operator must have MANAGER or OWNER role
  - `new_owner_party_id` must exist and be active
  - Lot must be active and have balance > 0
  - Pre-requisite: The old owner's auto-generated invoice (accrued up to transfer date) must be PAID in full, OR the new owner must officially assume the liability before the transfer can proceed.
- Action:
  - `owner_party_id` on lot updated to new party
  - `billing_party_id` updated (unless manually separated)
  - `ownership_history` record created: {from_party, to_party, date, quantity, transfer_price, operator_id}
  - Billing accrual "reset point" set: old owner billed up to transfer; new owner billed from transfer date
- Receipt: "Ownership Transfer Acknowledgment" printable

**Partial Ownership Transfer**
- Input: source lot ID, quantity to transfer, new owner
- Validation: transfer_quantity <= lot.current_balance
- Action:
  - Source lot: `current_balance` reduced by transfer_quantity
  - Child lot created: new lot record with new_owner, transfer_quantity, same chamber, status=ACTIVE
  - Child lot number: `LOT-260301-0042-T1` (parent lot + `-T` suffix + sequence)
  - Child lot **inherits the parent's `marka`** — the physical mark stays on the bags, so the new owner's child lot carries the same marka
  - Ownership history record on both parent and child lots
- Billing: child lot starts fresh billing from transfer date

**Ownership History Log**
- Each lot maintains an append-only array of ownership events
- Fields per event: `event_type` (INITIAL | TRANSFER_IN | TRANSFER_OUT), `party_id`, `quantity`, `date`, `transfer_price`, `operator_id`, `notes`
- UI: "History" tab on lot detail page renders full ownership chain as timeline

**Authorization**
- Only roles with `can_transfer_ownership = true` can initiate transfers
- Additional: owner can configure "require dual authorization" → two managers must approve
- All transfers: email/SMS notification to both old and new owner (configurable)

**Edge Cases**
- Transfer to same party: blocked with error ("New owner must be different from current owner")
- Transfer of zero quantity: blocked
- Transfer date in the future: allowed (scheduled transfer) — billing split at scheduled date
- Reversal of transfer: not allowed automatically; requires admin correction entry with audit trail
- Multiple pending transfers (concurrent): serialized; second transfer waits for first to complete

---

## M4: Outbound & Dispatch

### Overview
Manages withdrawal of produce from storage — full or partial — records outbound weight, triggers billing, and generates dispatch documentation.

### Functional Behavior

**Withdrawal Request**
- Input: lot ID (or search by party/commodity), withdrawal type (FULL | PARTIAL), quantity (if partial), outbound date
- Validation:
  - Requested qty <= `lot.current_balance`
  - Lot status must be ACTIVE (not CLOSED or SUSPENDED)
  - Requesting party must be current owner (or authorized by owner in writing — noted in system)

**Outbound Weight Capture**
- Field: `outbound_weight_kg` (mandatory before invoice finalization)
- Comparison shown: `inbound_accepted_weight_kg` (prorated for partial) vs `outbound_weight_kg`
- Weight variance % displayed: `(inbound - outbound) / inbound × 100`
- No alert threshold in MVP (tracked for reporting only); Phase 2 will add anomaly flagging

**Bill Auto-Calculation**
- Storage duration: `outbound_date - inbound_date` (or `ownership_transfer_date` if applicable) in days
- Storage charge:
  - If rate_type = SEASONAL_PER_BAG: `quantity × seasonal_rate` (regardless of duration within season)
  - If rate_type = MONTHLY_PER_BAG: `quantity × monthly_rate × ceil(days / 30)`
  - If rate_type = DAILY_PER_BAG: `quantity × daily_rate × days`
- Service charge line items: added manually from service catalog
- Sub-total, optional GST, grand total

**Invoice Preview & Finalization**
- Preview screen shows all line items before save
- Manager can: add/remove service lines, override total (with reason logged)
- Finalize: invoice locked; `invoice_number` assigned (INV-YYYYMM-NNNN)
- Post-finalization: only credit notes allowed

**Lot Balance Update**
- On finalization:
  - PARTIAL: `lot.current_balance -= withdrawal_qty`; lot stays ACTIVE
  - FULL: `lot.current_balance = 0`; `lot.status = CLOSED`; `lot.closed_at = today`

**Dispatch Note (Gate Pass)**
- Generated alongside invoice
- Contents: lot number, owner, commodity, **marka (if present)**, withdrawal quantity, vehicle number (if entered), date, operator signature area
- At the gate, security cross-checks the physical marka on the departing bags against the dispatch note / gate pass (the marka does not change on transfer, so it must match the dispatched lot)
- Required at facility gate for produce exit
- System prevents dispatch note regeneration after lot is closed (can re-print but not re-generate)

**Edge Cases**
- Withdrawal with no outbound weight: invoice goes to DRAFT status; cannot finalize without weight
- Over-withdrawal attempt: blocked; error "Cannot withdraw 300 bags. Lot balance is 250 bags."
- Withdrawal from CLOSED lot: blocked; error with lot closure date
- Backdated outbound: allowed with manager override; billing recalculates from backdated outbound_date
- Disputed quantity at gate: operator can flag withdrawal as "under dispute"; dispatch note marked accordingly; lot quantity held pending resolution

---

## M5: Billing Engine

### Overview
Flexible billing system supporting multiple rate types, service charge add-ons, and multi-commodity billing profiles. Invoices are event-driven (triggered by outbound events) or periodic (month-end for active lots).

### Rate Plan Configuration

**Rate Plan Object**
```
RatePlan {
  rate_plan_id
  name                  // e.g., "Potato Standard 2026"
  commodity             // POTATO | APPLE | ONION | ALL
  rate_type             // SEASONAL_PER_BAG | MONTHLY_PER_BAG | DAILY_PER_BAG
  rate_amount (PKR)
  season_start_date     // for SEASONAL type
  season_end_date       // for SEASONAL type
  is_active
}
```

**Service Charge Catalog**
```
ServiceCharge {
  charge_id
  name                  // "Loading", "Unloading", "Grading", "Sorting"
  unit_price (PKR)
  unit_type             // PER_BAG | PER_TON | FLAT
  is_active
}
```

**Invoice Line Item Types**
1. STORAGE: computed from rate plan × duration × quantity
2. SERVICE: from service charge catalog × quantity
3. ADJUSTMENT: manual positive or negative adjustment (manager-authorized)
4. ADVANCE_APPLIED: deduction of pre-paid advance credit

**Invoice Lifecycle**
```
DRAFT → PREVIEW → FINALIZED → PAID (partial or full)
                          └──→ CREDIT_NOTE_ISSUED (on dispute/adjustment)
```

**Periodic Billing (Month-End)**
- For lots with MONTHLY_PER_BAG rate plans
- System generates "storage accrual" notification at month end
- Manager reviews and issues interim invoice for ongoing storage (lot remains active)
- Interim invoices do not close the lot; final invoice generated at outbound

**Billing for Transferred Lots**
- On ownership transfer, billing period is split at transfer date
- System auto-calculates:
  - Invoice 1: old owner → from inbound_date to transfer_date
  - Invoice 2: new owner → starts accruing from transfer_date
- Invoices can be issued separately or grouped at outbound

**Edge Cases**
- Zero-duration lot (same-day in/out): minimum 1-day billing (configurable floor)
- Lot closed without full payment: invoice marked OUTSTANDING; appears in aging report
- Rate plan change mid-storage: old rate plan applies up to change date; new rate plan from change date (with manager override + log)
- Client disputes invoice total: invoice put in DISPUTED status; credit note issued on resolution; original invoice immutable

---

## M6: Quality & Spoilage Management

### Overview
Tracks produce quality across the storage lifecycle. Enables periodic inspection records, damage logging, and quantity adjustments.

### Functional Behavior

**Quality Inspection Record**
- Triggered manually (periodic), at inbound, or at outbound
- Fields: lot_id, inspection_date, inspector_name, quality_grade, observations (free text), condition_flags (checkboxes: MOISTURE_LOSS, ROTTEN_SPOTS, PEST, OTHER), photos
- Does not change lot quantity; informational only

**Spoilage/Damage Record**
- Trigger: inspector or manager identifies material loss
- Fields: lot_id, event_date, quantity_affected (bags), cause (TEMPERATURE_FAILURE | NATURAL_DECAY | HANDLING_DAMAGE | PEST | OTHER), estimated_loss_kg, notes, photos
- Status: PENDING_REVIEW → CONFIRMED | DISPUTED
- On CONFIRMED (manager authorization):
  - `lot.current_balance -= quantity_affected`
  - Adjustment entry created in billing (negative adjustment if warranted)
  - Notification sent to lot owner

**Days-in-Storage Alert**
- Configurable per commodity (e.g., Potato: alert at 180 days; Apple: alert at 90 days)
- Lots that breach threshold appear on dashboard "Attention Required" panel
- No automatic action — alerts informational only

**Edge Cases**
- Spoilage removes more than lot balance: blocked; max adjustable = current_balance
- Disputed spoilage record: lot quantity not changed until dispute resolved; dispute_note required
- Multiple spoilage events on same lot: all recorded; cumulative loss tracked
- Spoilage discovered at outbound: recorded as outbound spoilage; billing adjustable

---

## M7: Accounting & Finance

### ⚠️ Full Specification in Dedicated Document

> **This module is fully specified in [`accounting_spec.md`](accounting_spec.md).**  
> That document supersedes the earlier draft of M7. Read it in full before implementing any financial functionality.

### Why M7 Was Redesigned

The original M7 draft was a one-sided party ledger (credits on payment, debits on invoice). This was replaced because:
- It could not produce a P&L — there were no revenue accounts, only AR tracking
- Advance payments were incorrectly treated as revenue instead of as a liability (Account 2010)
- There was no mechanism for the Trial Balance check (total debits = total credits)
- Revenue could not be attributed to commodity — no account-level breakdown

### What M7 Now Covers

M7 is ColdChain's double-entry accounting backbone. It is **not** a standalone module. It is the financial expression of every operational event defined in M2–M6.

| Area | Specification Location |
|---|---|
| Chart of Accounts (40+ accounts, 6 classes) | `accounting_spec.md` § 2 |
| Journal Entry Templates (JE-01 through JE-11) | `accounting_spec.md` § 3 |
| What triggers each journal entry | `accounting_spec.md` § 3 (per event) |
| General Ledger structure | `accounting_spec.md` § 4 |
| P&L, Balance Sheet, Trial Balance outputs | `accounting_spec.md` § 5 |
| New data model tables (CoA, journal entries, lines) | `accounting_spec.md` § 6 |
| Reconciliation controls | `accounting_spec.md` § 7 |
| GST / Sales Tax handling | `accounting_spec.md` § 8 |
| Revised functional behavior (replaces original M7) | `accounting_spec.md` § 9 |

### Key Integration Points with Other Modules

- **M5 Invoice Finalization** → triggers JE-01 (DR Receivable / CR Revenue + GST)
- **M7 Payment Recording** → triggers JE-02 (DR Cash/Bank / CR Receivable) or JE-03 (advance)
- **M7 Advance Applied** → triggers JE-04 (DR Advance Liability / CR Receivable reduction)
- **M5 Credit Note** → triggers JE-05 (DR Revenue / CR Receivable)
- **Cheque Dishonour** → triggers JE-06 (reversal of JE-02)
- **M6 Spoilage (cold store liable)** → triggers JE-09 (DR Damage Expense / CR Liability)
- **M3 Ownership Transfer** → no journal entry at transfer; billing split drives separate JE-01s per owner
- **Month-End** → triggers JE-11 accrual for ongoing MONTHLY_PER_BAG lots

---

## M8: Chamber & Capacity Management

### Overview
Physical facility modeled as a hierarchy: Facility → Chambers/Bays → Sections (optional for large chambers).

### Functional Behavior

**Chamber Setup**
- Fields: chamber_name, commodity_type (or MULTI), max_capacity_bags, temperature_range_c, section_layout (optional grid)
- Chambers can be restricted to specific commodities (e.g., "Apple Chamber" → APPLE only)
- Or set to MULTI for mixed commodity storage

**Occupancy Tracking**
- `current_occupancy_bags` = sum of `current_balance` of all ACTIVE lots assigned to chamber
- `available_capacity_bags` = max_capacity_bags - current_occupancy_bags
- Real-time recalculation on every lot inbound/outbound/adjustment event

**Visual Chamber Map (P1)**
- Grid view of chamber showing lot positions
- Color coding: Green (ample space), Yellow (>75% full), Red (>90% full)
- Click on cell shows lot summary: owner, commodity, quantity, days in storage

**Temperature Log**
- Manual entry: date, time, chamber, temperature_c, recorded_by
- Threshold alerts: configurable high/low per chamber
- Phase 2: IoT sensor feed replaces manual entry

**Edge Cases**
- Lot assigned to wrong commodity chamber: warning shown at inbound; override requires note
- Chamber decommissioned with active lots: system blocks decommission until lots cleared

---

## M9: Reporting & Analytics

### Overview
Operational and financial visibility for cold store owner and manager.

### Standard Reports

| Report | Description | Audience |
|---|---|---|
| Operational Dashboard | Live: active lots, occupancy %, today's inbound/outbound | Manager, Owner |
| Financial Dashboard | Total AR outstanding, payments today, overdue (90+) | Owner, Accountant |
| Lot Aging Report | All active lots sorted by days in storage | Manager |
| Commodity Inventory | Bags per commodity, per chamber | Manager |
| Party Statement | Full ledger for a party for chosen period | Owner, Client |
| Weight Variance Report | Inbound vs outbound weight by lot | Manager |
| Seasonal Summary | Total intake volume, dispatched volume, revenue | Owner |
| Receivables Aging | AR segmented by time bucket, per party | Owner, Accountant |
| Ownership Transfer Log | All transfers in period | Owner, Auditor |

### Report Parameters
- All reports filterable by date range, party, commodity, chamber
- Export formats: PDF, CSV
- Scheduled reports: daily summary emailed to owner (Phase 2)

---

## M10: Gate Pass Management (Security)

### Overview
A high-speed, simplified interface for the Security Guard at the facility gate to log the physical arrival and departure of vehicles.

### Functional Behavior

**Inward Pass**
- Security logs: Vehicle Number, Driver Name, Bilty No.
- System generates `pass_number` (GP-YYMMDD-NNNN).
- State = ARRIVED.
- Sent to Operator dashboard for inbound processing. Operation links the Gate Pass to the newly generated `lot_id`.

**Outward Pass**
- Truck arrives at gate to exit.
- Security enters Vehicle Number.
- System checks constraints: Is there a PAID invoice (or an explicitly Credit-Authorized finalized invoice) or an approved outbound dispatch note associated with this vehicle today?
  - Yes: Mark pass CLEARED and open gate.
  - No: Block exit. Warning shown ("Payment Pending").

**Metrics**
- Tracks Turnaround Time (TAT) per vehicle (ARRIVED vs CLEARED timestamp).

---

## M11: Peshgi (Informal Loans)

### Overview
A dedicated ledger specifically for cash advances (loans) given to farmers/arhtis, kept strictly separate from storage charge receivables.

### Functional Behavior

**Issuance**
- Owner creates new Peshgi issue.
- Selects party, enters amount, selects payment method (Cash/Bank).
- System triggers JE-18 (DR Receivable-Peshgi, CR Cash/Bank).
- Prints Loan Acknowledgment receipt.

**Recovery**
- Cash recovery: Owner records repayment; system triggers JE-19.
- Settlement recovery: During final invoice settlement (M5), Manager can apply produce sale proceeds to deduct from the outstanding Peshgi balance before netting the storage bill.
- Balances surface in the Dashboard under "Advances Exposure".
