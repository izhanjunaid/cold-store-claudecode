# ColdChain — Data Model

**Version**: 1.0  
**Date**: March 2026  
**Database**: PostgreSQL 15

---

## Entity Relationship Overview

```
Facility ──< Chamber ──< Lot(s)
Party ──< Lot (owner_party)
Party ──< Lot (billing_party)
Party ──< OwnershipHistory (from/to)
Lot ──< OwnershipHistory
Lot ──< OutboundEvent ──< Invoice ──< InvoiceLineItem
Invoice ──< Payment (via allocation)
Invoice ──< CreditNote
Party ──< Payment
Lot ──< QualityInspection
Lot ──< SpoilageRecord
Lot ──< InboundEvent
RatePlan ──< Lot

─── Accounting Layer (see accounting_spec.md §6) ───
Facility ──< ChartOfAccounts
Invoice ──> JournalEntry (source)
Payment ──> JournalEntry (source)
CreditNote ──> JournalEntry (source)
JournalEntry ──< JournalEntryLines
JournalEntryLines.account_code ──> ChartOfAccounts
JournalEntryLines.party_id ──> Party   (AR sub-ledger)
JournalEntryLines.lot_id   ──> Lot     (revenue by lot)
```

> **Accounting layer specification**: All accounting entities, their columns, constraints, and journal entry templates are fully specified in [`accounting_spec.md`](accounting_spec.md). The tables below cover the operational layer. Accounting tables are documented at the end of this file.

---

## Core Entities

### 1. `facilities`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `name` | VARCHAR(200) | NOT NULL | |
| `address` | TEXT | | |
| `city` | VARCHAR(100) | DEFAULT 'Lahore' | |
| `phone` | VARCHAR(20) | | |
| `gst_number` | VARCHAR(50) | NULLABLE | Optional |
| `settings` | JSONB | DEFAULT '{}' | Threshold configs, feature flags |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `updated_at` | TIMESTAMPTZ | NOT NULL | |

---

### 2. `parties`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(200) | NOT NULL | |
| `name_urdu` | VARCHAR(200) | NULLABLE | For printed receipts |
| `party_type` | ENUM | NOT NULL | FARMER\|TRADER\|ARHTI\|BUYER\|OTHER |
| `phone_primary` | VARCHAR(20) | NOT NULL | |
| `phone_secondary` | VARCHAR(20) | NULLABLE | |
| `address` | TEXT | NULLABLE | |
| `cnic` | VARCHAR(15) | NULLABLE | |
| `parent_arhti_id` | UUID | FK → parties | NULLABLE; farmer→arhti link |
| `credit_limit_pkr` | DECIMAL(12,2) | NULLABLE | Soft limit |
| `credit_terms_days` | INT | DEFAULT 30 | |
| `is_active` | BOOLEAN | DEFAULT TRUE | |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

**Indexes**: `(facility_id, phone_primary)`, `(facility_id, party_type)`, `(parent_arhti_id)`

---

### 3. `commodities` (Master)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `name` | VARCHAR(100) | UNIQUE, NOT NULL | e.g., POTATO |
| `unit_label` | VARCHAR(20) | NOT NULL | e.g., "Bags", "Crates" |
| `default_storage_days_alert` | INT | NULLABLE | e.g., 180 for potato |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

**Seed data**: POTATO (Bags, 180d), APPLE (Crates, 90d), ONION (Bags, 120d), KINNOW (Crates, 60d)

---

### 4. `varieties` (Master)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `commodity_id` | UUID | FK → commodities | |
| `name` | VARCHAR(100) | NOT NULL | e.g., "Cardinal", "Desiree" |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

---

### 5. `chambers`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(100) | NOT NULL | e.g., "Chamber A", "Bay 3" |
| `commodity_restriction` | UUID | FK → commodities, NULLABLE | NULL = multi-commodity |
| `max_capacity_bags` | INT | NOT NULL | |
| `temperature_min_c` | DECIMAL(4,1) | NULLABLE | |
| `temperature_max_c` | DECIMAL(4,1) | NULLABLE | |
| `is_active` | BOOLEAN | DEFAULT TRUE | |
| `notes` | TEXT | NULLABLE | |

---

### 6. `rate_plans`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(200) | NOT NULL | e.g., "Potato Standard 2026" |
| `commodity_id` | UUID | FK → commodities, NULLABLE | NULL = all commodities |
| `rate_type` | ENUM | NOT NULL | SEASONAL_PER_BAG\|MONTHLY_PER_BAG\|DAILY_PER_BAG |
| `rate_amount_pkr` | DECIMAL(10,2) | NOT NULL | |
| `season_start_date` | DATE | NULLABLE | Required for SEASONAL type |
| `season_end_date` | DATE | NULLABLE | Required for SEASONAL type |
| `min_billing_days` | INT | DEFAULT 1 | Minimum chargeable period |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

---

### 7. `service_charges` (Catalog)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(100) | NOT NULL | e.g., "Loading", "Grading" |
| `unit_type` | ENUM | NOT NULL | PER_BAG\|PER_TON\|FLAT |
| `unit_price_pkr` | DECIMAL(10,2) | NOT NULL | |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

---

### 8. `lots` ← **Central Entity**

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `lot_number` | VARCHAR(30) | UNIQUE, NOT NULL | LOT-YYMMDD-NNNN |
| `facility_id` | UUID | FK → facilities | |
| `chamber_id` | UUID | FK → chambers | |
| `owner_party_id` | UUID | FK → parties | Current owner |
| `billing_party_id` | UUID | FK → parties | Defaults to owner |
| `commodity_id` | UUID | FK → commodities | |
| `variety_id` | UUID | FK → varieties, NULLABLE | |
| `rate_plan_id` | UUID | FK → rate_plans | |
| `quantity_bags` | INT | NOT NULL, > 0 | Original inbound quantity |
| `current_balance_bags` | INT | NOT NULL, >= 0 | Real-time balance |
| `accepted_weight_kg` | DECIMAL(10,2) | NOT NULL | Facility-measured inbound weight |
| `declared_weight_kg` | DECIMAL(10,2) | NULLABLE | Farmer/transporter declared |
| `weight_dispute_flag` | BOOLEAN | DEFAULT FALSE | |
| `weight_dispute_note` | TEXT | NULLABLE | Required if flag = TRUE |
| `quality_grade_inbound` | VARCHAR(10) | NULLABLE | A/B/C |
| `inbound_date` | DATE | NOT NULL | Physical arrival date |
| `entry_date` | DATE | NOT NULL DEFAULT TODAY | System entry date |
| `parent_lot_id` | UUID | FK → lots, NULLABLE | For child lots (partial transfers) |
| `vehicle_number` | VARCHAR(20) | NULLABLE | |
| `status` | ENUM | NOT NULL DEFAULT 'ACTIVE' | ACTIVE\|CLOSED\|SUSPENDED |
| `closed_at` | DATE | NULLABLE | Set on full withdrawal |
| `storage_alert_sent` | BOOLEAN | DEFAULT FALSE | Aging alert flag |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | PACCI (Official) \| KATCHI (Internal) |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

**Indexes**: `(facility_id, status)`, `(owner_party_id, status)`, `(chamber_id, status)`, `(inbound_date)`, `(lot_number)`

---

### 9. `ownership_history`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `lot_id` | UUID | FK → lots, NOT NULL | |
| `event_type` | ENUM | NOT NULL | INITIAL\|TRANSFER_IN\|TRANSFER_OUT |
| `from_party_id` | UUID | FK → parties, NULLABLE | NULL for INITIAL |
| `to_party_id` | UUID | FK → parties, NOT NULL | |
| `quantity_bags` | INT | NOT NULL | Quantity transferred |
| `transfer_price_pkr` | DECIMAL(12,2) | NULLABLE | Optional sale price |
| `effective_date` | DATE | NOT NULL | When transfer is effective for billing |
| `operator_id` | UUID | FK → users | Who performed it |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Constraint**: `ownership_history` is append-only (no UPDATE, no DELETE enforced via trigger)

---

### 10. `outbound_events`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `lot_id` | UUID | FK → lots | |
| `facility_id` | UUID | FK → facilities | |
| `withdrawal_type` | ENUM | NOT NULL | FULL\|PARTIAL |
| `quantity_withdrawn_bags` | INT | NOT NULL | |
| `outbound_weight_kg` | DECIMAL(10,2) | NULLABLE | Required before invoice finalize |
| `outbound_date` | DATE | NOT NULL | |
| `receiving_party_id` | UUID | FK → parties, NULLABLE | Buyer receiving the produce |
| `vehicle_number` | VARCHAR(20) | NULLABLE | |
| `dispatch_note_number` | VARCHAR(30) | UNIQUE | Gate pass number |
| `status` | ENUM | NOT NULL DEFAULT 'PENDING' | PENDING\|DISPATCHED\|DISPUTED |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

---

### 11. `invoices`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `invoice_number` | VARCHAR(30) | UNIQUE | INV-YYYYMM-NNNN |
| `facility_id` | UUID | FK → facilities | |
| `lot_id` | UUID | FK → lots | |
| `outbound_event_id` | UUID | FK → outbound_events, NULLABLE | NULL for periodic invoices |
| `billing_party_id` | UUID | FK → parties | |
| `invoice_date` | DATE | NOT NULL | |
| `period_start` | DATE | NOT NULL | Storage billing start date |
| `period_end` | DATE | NOT NULL | Storage billing end date |
| `sub_total_pkr` | DECIMAL(12,2) | NOT NULL | |
| `gst_rate` | DECIMAL(5,2) | DEFAULT 0 | % |
| `gst_amount_pkr` | DECIMAL(12,2) | DEFAULT 0 | |
| `total_pkr` | DECIMAL(12,2) | NOT NULL | |
| `amount_paid_pkr` | DECIMAL(12,2) | DEFAULT 0 | |
| `balance_due_pkr` | DECIMAL(12,2) | GENERATED | total - paid |
| `status` | ENUM | NOT NULL DEFAULT 'DRAFT' | DRAFT\|FINALIZED\|PAID\|DISPUTED\|CANCELLED |
| `finalized_at` | TIMESTAMPTZ | NULLABLE | |
| `finalized_by` | UUID | FK → users, NULLABLE | |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | Inherited from lot |
| `notes` | TEXT | NULLABLE | |

---

### 12. `invoice_line_items`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `invoice_id` | UUID | FK → invoices | |
| `line_type` | ENUM | NOT NULL | STORAGE\|SERVICE\|ADJUSTMENT\|ADVANCE_APPLIED |
| `description` | VARCHAR(300) | NOT NULL | Human-readable label |
| `quantity` | DECIMAL(10,2) | NOT NULL | Bags or tons |
| `unit_price_pkr` | DECIMAL(10,2) | NOT NULL | |
| `amount_pkr` | DECIMAL(12,2) | NOT NULL | quantity × unit_price |
| `service_charge_id` | UUID | FK → service_charges, NULLABLE | If SERVICE type |
| `rate_plan_id` | UUID | FK → rate_plans, NULLABLE | If STORAGE type |

---

### 13. `payments`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `party_id` | UUID | FK → parties | |
| `payment_date` | DATE | NOT NULL | |
| `amount_pkr` | DECIMAL(12,2) | NOT NULL | |
| `payment_method` | ENUM | NOT NULL | CASH\|CHEQUE\|BANK_TRANSFER\|MOBILE_WALLET |
| `reference_number` | VARCHAR(100) | NULLABLE | Cheque/TRX number |
| `is_advance` | BOOLEAN | DEFAULT FALSE | Payment before invoice |
| `status` | ENUM | NOT NULL DEFAULT 'RECORDED' | RECORDED \| ALLOCATED \| ADVANCE \| DISHONOURED |
| `clearance_status` | ENUM | NOT NULL DEFAULT 'CLEARED' | NA \| PENDING \| CLEARED \| BOUNCED |
| `cheque_date` | DATE | NULLABLE | Used for post-dated cheques |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | PACCI \| KATCHI |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

---

### 14. `payment_allocations`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `payment_id` | UUID | FK → payments | |
| `invoice_id` | UUID | FK → invoices | |
| `allocated_amount_pkr` | DECIMAL(12,2) | NOT NULL | |

---

### 15. `quality_inspections`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `lot_id` | UUID | FK → lots | |
| `inspection_date` | DATE | NOT NULL | |
| `inspector_name` | VARCHAR(100) | NOT NULL | |
| `quality_grade` | VARCHAR(10) | NULLABLE | A/B/C |
| `condition_flags` | JSONB | DEFAULT '[]' | Array of flags |
| `observations` | TEXT | NULLABLE | |
| `photo_urls` | JSONB | DEFAULT '[]' | Array of S3 URLs |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

---

### 16. `spoilage_records`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `lot_id` | UUID | FK → lots | |
| `event_date` | DATE | NOT NULL | |
| `quantity_affected_bags` | INT | NOT NULL | |
| `estimated_loss_kg` | DECIMAL(10,2) | NULLABLE | |
| `cause` | ENUM | NOT NULL | TEMPERATURE_FAILURE\|NATURAL_DECAY\|HANDLING\|PEST\|OTHER |
| `status` | ENUM | NOT NULL DEFAULT 'PENDING_REVIEW' | PENDING_REVIEW\|CONFIRMED\|DISPUTED |
| `dispute_note` | TEXT | NULLABLE | |
| `confirmed_by` | UUID | FK → users, NULLABLE | |
| `confirmed_at` | TIMESTAMPTZ | NULLABLE | |
| `photo_urls` | JSONB | DEFAULT '[]' | |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

---

### 17. `temperature_logs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `chamber_id` | UUID | FK → chambers | |
| `recorded_at` | TIMESTAMPTZ | NOT NULL | |
| `temperature_c` | DECIMAL(4,1) | NOT NULL | |
| `recorded_by` | UUID | FK → users | |
| `source` | ENUM | DEFAULT 'MANUAL' | MANUAL\|SENSOR |

---

### 18. `audit_log` ← Immutable

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `facility_id` | UUID | |
| `table_name` | VARCHAR(100) | e.g., "lots" |
| `record_id` | UUID | The mutated record's PK |
| `action` | ENUM | INSERT\|UPDATE |
| `changed_by` | UUID | FK → users |
| `changed_at` | TIMESTAMPTZ | |
| `old_values` | JSONB | NULL for INSERT |
| `new_values` | JSONB | |
| `reason` | TEXT | NULLABLE; required for manager overrides |

**Implementation**: PostgreSQL trigger on all operational tables populates `audit_log` automatically.

---

## Critical Business Rules in DB Layer

```sql
-- Prevent current_balance_bags going negative
ALTER TABLE lots ADD CONSTRAINT chk_balance_non_negative 
  CHECK (current_balance_bags >= 0);

-- Prevent quantity_withdrawn exceeding lot balance (handled in service layer too)
ALTER TABLE outbound_events ADD CONSTRAINT chk_withdrawal_positive 
  CHECK (quantity_withdrawn_bags > 0);

-- Ownership history is append-only
CREATE RULE no_delete_ownership AS ON DELETE TO ownership_history DO INSTEAD NOTHING;

-- Invoice total integrity
ALTER TABLE invoices ADD CONSTRAINT chk_invoice_total 
  CHECK (total_pkr >= 0);

-- Journal entry balance: enforced by trigger
-- (application service also validates before insert)
CREATE OR REPLACE FUNCTION check_journal_balance()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT ABS(SUM(debit_amount) - SUM(credit_amount))
      FROM journal_entry_lines
      WHERE journal_entry_id = NEW.journal_entry_id) > 0.01 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced', NEW.journal_entry_id;
  END IF;
  RETURN NEW;
END;
$$;
```

---

## Accounting Layer Entities

> Full specification of all accounting entities, journal entry templates, and business logic is in [`accounting_spec.md`](accounting_spec.md). The table definitions below are the canonical schema for implementation.

---

### 19. `chart_of_accounts`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `account_code` | VARCHAR(10) | UNIQUE per facility, NOT NULL | e.g., "1110" |
| `account_name` | VARCHAR(200) | NOT NULL | e.g., "Receivable — Farmers" |
| `account_class` | ENUM | NOT NULL | ASSET\|LIABILITY\|EQUITY\|REVENUE\|COST_OF_SERVICE\|EXPENSE |
| `account_type` | ENUM | NOT NULL | HEADER\|DETAIL |
| `parent_account_code` | VARCHAR(10) | NULLABLE | e.g., "1100" is parent of "1110" |
| `normal_balance` | ENUM | NOT NULL | DEBIT\|CREDIT |
| `is_system_account` | BOOLEAN | DEFAULT FALSE | System accounts cannot be deleted or have code changed |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

**Indexes**: `(facility_id, account_code)`, `(facility_id, account_class)`  
**Seed on facility creation**: Full CoA from `accounting_spec.md` §2 (40+ accounts).  
**System-protected accounts**: 1110, 1120, 1130, 2010, 2020 — these back core operational journal entries and must always exist.

---

### 20. `journal_entries`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `entry_number` | VARCHAR(20) | UNIQUE per facility | JE-YYYYMM-NNNN |
| `entry_date` | DATE | NOT NULL | Economic date of the triggering event |
| `entry_type` | ENUM | NOT NULL | INVOICE\|PAYMENT\|ADVANCE\|CREDIT_NOTE\|ADJUSTMENT\|ACCRUAL\|BAD_DEBT\|REVERSAL |
| `source_table` | VARCHAR(50) | NOT NULL | "invoices", "payments", "credit_notes", "manual" |
| `source_id` | UUID | NULLABLE | FK to the triggering record's PK; NULL for manual entries |
| `description` | VARCHAR(500) | NOT NULL | Auto-generated from operational context |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | Inherited from source record |
| `posting_status` | ENUM | NOT NULL DEFAULT 'AUTO_DRAFT' | AUTO_DRAFT\|POSTED\|REVERSED |
| `period_month` | INT | NOT NULL | 1–12 |
| `period_year` | INT | NOT NULL | e.g., 2026 |
| `is_period_locked` | BOOLEAN | DEFAULT FALSE | Set TRUE on period close; blocks further entries |
| `reversed_by_entry_id` | UUID | FK → journal_entries, NULLABLE | Reference to the reversal entry |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

**Indexes**: `(facility_id, period_year, period_month)`, `(source_table, source_id)`, `(posting_status)`  
**Immutability**: No UPDATE or DELETE allowed on POSTED entries. Corrections via REVERSAL entry type only.

---

### 21. `journal_entry_lines`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `journal_entry_id` | UUID | FK → journal_entries, NOT NULL | |
| `line_number` | INT | NOT NULL | Sequence within entry (1, 2, 3…) |
| `account_code` | VARCHAR(10) | NOT NULL | References `chart_of_accounts.account_code` |
| `debit_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | One of debit/credit is 0 per line |
| `credit_amount` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | |
| `party_id` | UUID | FK → parties, NULLABLE | Populated on AR/AP lines for sub-ledger drill-down |
| `lot_id` | UUID | FK → lots, NULLABLE | Populated on revenue lines for lot-level P&L |
| `description` | VARCHAR(300) | NULLABLE | Line-level narrative |

**Constraint**: `CHECK (debit_amount >= 0 AND credit_amount >= 0)`  
**Constraint**: `CHECK (NOT (debit_amount > 0 AND credit_amount > 0))` — a single line is either debit or credit, never both  
**Balance constraint**: Enforced via trigger — `SUM(debit) = SUM(credit)` per `journal_entry_id`

---

### 22. `credit_notes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `credit_note_number` | VARCHAR(30) | UNIQUE | CN-YYYYMM-NNNN |
| `facility_id` | UUID | FK → facilities | |
| `original_invoice_id` | UUID | FK → invoices, NOT NULL | Must reference a FINALIZED invoice |
| `billing_party_id` | UUID | FK → parties | Inherited from original invoice |
| `credit_date` | DATE | NOT NULL | |
| `reason` | TEXT | NOT NULL | Mandatory justification |
| `total_pkr` | DECIMAL(12,2) | NOT NULL | Must be ≤ original invoice total |
| `status` | ENUM | NOT NULL DEFAULT 'ISSUED' | ISSUED\|APPLIED\|CANCELLED |
| `created_by` | UUID | FK → users | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Trigger**: On INSERT of `credit_notes` → auto-generates a `journal_entry` of type `CREDIT_NOTE` (JE-05 template from `accounting_spec.md`)

---

## Column Additions to Existing Tables

These columns are **added to existing tables** to enable journal entry routing. They must be present before any accounting functions are active.

### `rate_plans` — add column
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `revenue_account_code` | VARCHAR(10) | NOT NULL | References `chart_of_accounts`; e.g., "4010" for Potato |

### `service_charges` — add column
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `revenue_account_code` | VARCHAR(10) | NOT NULL | References `chart_of_accounts`; e.g., "4110" for Loading |

### `payments` — add column
| Column | Type | Constraints | Notes |
|---|---|---|---|
| `asset_account_code` | VARCHAR(10) | NOT NULL DEFAULT '1020' | "1010" cash / "1020" bank / "1030" mobile wallet |
| `dishonoured` | BOOLEAN | DEFAULT FALSE | Triggers JE-06 reversal when set TRUE |
| `dishonoured_at` | DATE | NULLABLE | Date cheque was returned |

---

## Expanding Cost-Side Modules (HR, FA, Expenses)

The following tables handle the cost-side operations and flow into the General Ledger via `accounting_spec.md`.

### 23. `fixed_assets`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `asset_name` | VARCHAR(200) | NOT NULL | e.g., "Bitzer Compressor Unit 1" |
| `asset_category` | ENUM | NOT NULL | COLD_PLANT \| BUILDING \| VEHICLE \| COMPUTER \| OTHER |
| `asset_account_code` | VARCHAR(10) | NOT NULL | e.g., "1310" |
| `accum_depr_account_code` | VARCHAR(10) | NOT NULL | e.g., "1311" |
| `depr_expense_account_code` | VARCHAR(10) | NOT NULL | e.g., "5040" |
| `purchase_date` | DATE | NOT NULL | |
| `purchase_cost_pkr` | DECIMAL(14,2) | NOT NULL | |
| `residual_value_pkr` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | |
| `useful_life_years` | DECIMAL(5,2) | NULLABLE | Required for SLM |
| `depreciation_method` | ENUM | NOT NULL | SLM \| WDV |
| `wdv_rate_percent` | DECIMAL(5,2) | NULLABLE | Required for WDV |
| `depreciation_start_date` | DATE | NULLABLE | When IN_SERVICE |
| `status` | ENUM | NOT NULL DEFAULT 'PURCHASED' | PLANNED \| PURCHASED \| IN_SERVICE \| DISPOSED \| WRITTEN_OFF |
| `accumulated_depreciation_pkr` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | Updated monthly |
| `net_book_value_pkr` | DECIMAL(14,2) | GENERATED | purchase_cost − accumulated_depreciation |
| `disposal_date` | DATE | NULLABLE | |
| `disposal_proceeds_pkr` | DECIMAL(14,2) | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

### 24. `depreciation_schedules`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `fixed_asset_id` | UUID | FK → fixed_assets | |
| `period_month` | INT | NOT NULL | 1–12 |
| `period_year` | INT | NOT NULL | |
| `opening_nbv` | DECIMAL(14,2) | NOT NULL | |
| `depreciation_amount` | DECIMAL(14,2) | NOT NULL | |
| `closing_nbv` | DECIMAL(14,2) | NOT NULL | |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | Set when POSTED |
| `status` | ENUM | NOT NULL | PENDING \| POSTED |

### 25. `employees`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(200) | NOT NULL | |
| `name_urdu` | VARCHAR(200) | NULLABLE | |
| `cnic` | VARCHAR(15) | NULLABLE | |
| `employee_type` | ENUM | NOT NULL | SALARIED \| DAILY_WAGE |
| `designation` | VARCHAR(100) | NULLABLE | |
| `join_date` | DATE | NOT NULL | |
| `basic_salary_pkr` | DECIMAL(10,2) | NULLABLE | |
| `daily_wage_pkr` | DECIMAL(8,2) | NULLABLE | |
| `eobi_registered` | BOOLEAN | DEFAULT FALSE | |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

### 26. `payroll_runs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `run_number` | VARCHAR(20) | UNIQUE | PAY-YYYYMM-NNN |
| `payroll_type` | ENUM | NOT NULL | MONTHLY_SALARY \| DAILY_WAGES |
| `period_month` | INT | NOT NULL | |
| `period_year` | INT | NOT NULL | |
| `total_gross_pkr` | DECIMAL(14,2) | NOT NULL | |
| `total_deductions_pkr` | DECIMAL(14,2) | NOT NULL | |
| `total_net_payable_pkr` | DECIMAL(14,2) | NOT NULL | |
| `status` | ENUM | NOT NULL | DRAFT \| FINALIZED \| PAID |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | |

### 27. `payroll_line_items`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `payroll_run_id` | UUID | FK → payroll_runs | |
| `employee_id` | UUID | FK → employees | |
| `days_worked` | DECIMAL(5,2) | NULLABLE | |
| `gross_pay_pkr` | DECIMAL(10,2) | NOT NULL | |
| `eobi_employee_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `eobi_employer_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `income_tax_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `net_pay_pkr` | DECIMAL(10,2) | NOT NULL | |

### 28. `expense_vouchers`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `voucher_number` | VARCHAR(20) | UNIQUE | EXP-YYYYMM-NNNN |
| `voucher_date` | DATE | NOT NULL | |
| `expense_account_code` | VARCHAR(10) | NOT NULL | References CoA (Class 5/6) |
| `description` | VARCHAR(500) | NOT NULL | |
| `amount_pkr` | DECIMAL(12,2) | NOT NULL | |
| `is_accrual` | BOOLEAN | DEFAULT FALSE | TRUE if bill received/unpaid |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | PACCI \| KATCHI |
| `status` | ENUM | NOT NULL DEFAULT 'DRAFT' | DRAFT \| APPROVED \| ACCRUED \| PAID \| CANCELLED |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | |
| `receipt_url` | VARCHAR(500) | NULLABLE | Uploaded bill scan |
| `approved_by` | UUID | FK → users, NULLABLE | |
| `created_by` | UUID | FK → users | |

---

## Mandi Context Entities (Gate Pass & Peshgi)

### 29. `gate_passes`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `pass_number` | VARCHAR(30) | UNIQUE | GP-YYMMDD-NNNN |
| `direction` | ENUM | NOT NULL | INWARD \| OUTWARD |
| `vehicle_number` | VARCHAR(30) | NOT NULL | |
| `driver_name` | VARCHAR(100) | NULLABLE | |
| `driver_phone` | VARCHAR(20) | NULLABLE | |
| `bilty_number` | VARCHAR(50) | NULLABLE | Transporter receipt |
| `status` | ENUM | NOT NULL | ARRIVED \| WEIGHING \| CLEARED \| CANCELLED |
| `related_lot_id` | UUID | FK → lots, NULLABLE | Linked after inbound creation |
| `related_outbound_id` | UUID | FK → outbound_events, NULLABLE | Linked at dispatch |
| `created_at` | TIMESTAMPTZ | NOT NULL | Arrival time |
| `cleared_at` | TIMESTAMPTZ | NULLABLE | Departure time |
| `created_by` | UUID | FK → users | Usually the security guard |

### 30. `party_loans` (Peshgi)

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `party_id` | UUID | FK → parties | Farmer or Arhti |
| `loan_number` | VARCHAR(30) | UNIQUE | L-YYMMDD-NNN |
| `issue_date` | DATE | NOT NULL | |
| `principal_amount_pkr` | DECIMAL(14,2) | NOT NULL | |
| `balance_pkr` | DECIMAL(14,2) | NOT NULL | |
| `status` | ENUM | NOT NULL DEFAULT 'ACTIVE' | ACTIVE \| RECOVERED \| WRITTEN_OFF |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | PACCI \| KATCHI |
| `journal_entry_id` | UUID | FK → journal_entries | |
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

### 31. `party_loan_repayments`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `loan_id` | UUID | FK → party_loans | |
| `repayment_date` | DATE | NOT NULL | |
| `amount_pkr` | DECIMAL(12,2) | NOT NULL | |
| `payment_method` | ENUM | NOT NULL | CASH \| BANK_TRANSFER \| DEDUCTED_FROM_PRODUCE |
| `journal_entry_id` | UUID | FK → journal_entries | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

