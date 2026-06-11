# ColdChain — API Design Document

**Version**: 1.0  
**Date**: March 2026  
**Style**: RESTful JSON API  
**Base URL**: `https://api.coldchain.pk/v1`

---

## 1. Design Principles

- **RESTful resource-oriented** URLs
- **Versioned** via URL path (`/v1/`)
- All responses in **JSON**; UTF-8 encoding
- **Pagination** on all list endpoints (`page`, `per_page` query params; default `per_page=50`)
- **Filtering** via query parameters on list endpoints
- **Soft deletes** only — no hard DELETE on operational records
- **Idempotency keys** on critical write operations (inbound lot creation, invoice finalization)

---

## 2. Authentication

```
Authorization: Bearer <jwt_access_token>
X-Facility-ID: <facility_uuid>
```

- JWT issued on login; expires in 8 hours
- Refresh via `POST /auth/refresh`
- All endpoints require valid JWT except `/auth/login` and `/auth/refresh`
- `X-Facility-ID` header scopes all responses to the specified facility

---

## 3. Standard Response Envelope

### Success
```json
{
  "success": true,
  "data": { ... },
  "meta": {
    "page": 1,
    "per_page": 50,
    "total": 243
  }
}
```

### Error
```json
{
  "success": false,
  "error": {
    "code": "LOT_BALANCE_INSUFFICIENT",
    "message": "Cannot withdraw 300 bags. Lot balance is 250 bags.",
    "field": "quantity_withdrawn_bags"
  }
}
```

---

## 4. API Endpoints

### 4.1 Authentication

| Method | Endpoint | Description |
|---|---|---|
| POST | `/auth/login` | Email + password → JWT |
| POST | `/auth/refresh` | Rotate access token |
| POST | `/auth/logout` | Invalidate session |
| GET | `/auth/me` | Current user profile + role |

---

### 4.2 Parties (`/parties`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/parties` | List parties; filter by `type`, `is_active`, `search` | All |
| POST | `/parties` | Create new party | OPERATOR+ |
| GET | `/parties/:id` | Get party detail | All |
| PATCH | `/parties/:id` | Update party fields | OPERATOR+ |
| DELETE | `/parties/:id` | Deactivate party (soft) | MANAGER+ |
| GET | `/parties/:id/ledger` | Party ledger entries | ACCOUNTANT+ |
| GET | `/parties/:id/lots` | Active lots for party | All |
| GET | `/parties/:id/invoices` | All invoices for party | All |

**POST /parties — Request**
```json
{
  "name": "Ghulam Hussain",
  "name_urdu": "غلام حسین",
  "party_type": "FARMER",
  "phone_primary": "03001234567",
  "parent_arhti_id": "uuid-of-arhti",
  "credit_limit_pkr": 500000,
  "credit_terms_days": 30
}
```

---

### 4.3 Lots (`/lots`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/lots` | List lots; filter by `status`, `party_id`, `commodity_id`, `chamber_id`, `inbound_date_from/to`, `marka` (case-insensitive prefix), and `search` (lot number or marka, contains) | All |
| POST | `/lots` | Create inbound lot | OPERATOR+ |
| GET | `/lots/:id` | Lot detail + current balance + ownership current | All |
| PATCH | `/lots/:id` | Update lot metadata (notes, grade, marka) — logged | OPERATOR+ |
| GET | `/lots/:id/ownership-history` | Full ownership chain | All |
| GET | `/lots/:id/inspections` | Quality inspections | All |
| GET | `/lots/:id/spoilage` | Spoilage records | All |
| GET | `/lots/:id/outbound-events` | All withdrawals | All |
| GET | `/lots/:id/receipt` | Generate/return storage receipt PDF URL | OPERATOR+ |

**POST /lots — Request**
```json
{
  "owner_party_id": "uuid",
  "billing_party_id": "uuid",
  "commodity_id": "uuid",
  "variety_id": "uuid",
  "quantity_bags": 500,
  "accepted_weight_kg": 10200.5,
  "declared_weight_kg": 10500.0,
  "chamber_id": "uuid",
  "rate_plan_id": "uuid",
  "inbound_date": "2026-03-01",
  "vehicle_number": "LHR-1234",
  "marka": "ASLAM-7",
  "quality_grade_inbound": "A",
  "notes": "Good quality, no visible damage"
}
```
*`marka` is optional (≤100 chars), the goods-identification mark on the bardana/crates. It is echoed on `GET /lots/:id` as `marka`, printed on the parchi/dispatch-note/gate-pass PDFs, and inherited by child lots on partial transfer.*

**POST /lots — Response (201)**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "lot_number": "LOT-260301-0042",
    "status": "ACTIVE",
    "weight_dispute_flag": true,
    "weight_dispute_note": null,
    "receipt_url": null
  }
}
```
*Note: If `weight_dispute_flag: true`, client must PATCH with `weight_dispute_note` before receipt is generated.*

---

### 4.4 Ownership Transfers (`/lots/:id/transfer`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/lots/:id/transfer` | Full or partial ownership transfer | MANAGER+ |

**POST /lots/:id/transfer — Request**
```json
{
  "transfer_type": "PARTIAL",
  "quantity_bags": 200,
  "new_owner_party_id": "uuid",
  "effective_date": "2026-03-15",
  "transfer_price_pkr": 1200000,
  "notes": "Sold to trader Ahmad at Rs.6000/bag"
}
```

**Response (200)**
```json
{
  "success": true,
  "data": {
    "original_lot": {
      "id": "uuid",
      "lot_number": "LOT-260301-0042",
      "current_balance_bags": 300
    },
    "child_lot": {
      "id": "uuid",
      "lot_number": "LOT-260301-0042-T1",
      "owner_party_id": "new-owner-uuid",
      "quantity_bags": 200,
      "status": "ACTIVE"
    },
    "ownership_history_id": "uuid"
  }
}
```

---

### 4.5 Outbound Events (`/outbound-events`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/outbound-events` | Initiate withdrawal | OPERATOR+ |
| GET | `/outbound-events/:id` | Outbound event detail | All |
| PATCH | `/outbound-events/:id/weight` | Record outbound weight | OPERATOR+ |
| POST | `/outbound-events/:id/finalize` | Finalize and close (triggers invoice) | MANAGER+ |
| GET | `/outbound-events/:id/dispatch-note` | Get dispatch note PDF URL | OPERATOR+ |

**POST /outbound-events — Request**
```json
{
  "lot_id": "uuid",
  "withdrawal_type": "PARTIAL",
  "quantity_withdrawn_bags": 100,
  "outbound_date": "2026-03-20",
  "receiving_party_id": "uuid",
  "vehicle_number": "LHR-5678"
}
```

---

### 4.6 Billing — Rate Plans (`/rate-plans`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/rate-plans` | List all active rate plans | All |
| POST | `/rate-plans` | Create rate plan | MANAGER+ |
| PATCH | `/rate-plans/:id` | Update rate plan | MANAGER+ |
| DELETE | `/rate-plans/:id` | Deactivate rate plan | MANAGER+ |

---

### 4.7 Billing — Invoices (`/invoices`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/invoices` | List invoices; filter by `party_id`, `status`, `date_from/to` | ACCOUNTANT+ |
| GET | `/invoices/:id` | Invoice detail with line items | All |
| POST | `/invoices/:id/finalize` | Lock invoice; assign number | MANAGER+ |
| POST | `/invoices/:id/credit-note` | Issue credit note against finalized invoice | MANAGER+ |
| GET | `/invoices/:id/pdf` | Get invoice PDF URL | All |

**POST /invoices/:id/finalize — Request**
```json
{
  "finalize_notes": "Approved by Tariq"
}
```

---

### 4.8 Quality & Spoilage

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/lots/:id/inspections` | Create quality inspection | OPERATOR+ |
| GET | `/lots/:id/inspections` | List inspections | All |
| POST | `/lots/:id/spoilage` | Create spoilage record | OPERATOR+ |
| PATCH | `/spoilage/:id/confirm` | Confirm spoilage → adjust lot qty | MANAGER+ |
| PATCH | `/spoilage/:id/dispute` | Mark as disputed | MANAGER+ |

---

### 4.9 Payments (`/payments`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/payments` | Record payment | ACCOUNTANT+ |
| GET | `/payments` | List payments; filter by `party_id`, `date_from/to` | ACCOUNTANT+ |
| GET | `/payments/:id` | Payment detail + allocations | ACCOUNTANT+ |
| POST | `/payments/:id/allocate` | Allocate payment to invoices | ACCOUNTANT+ |

**POST /payments — Request**
```json
{
  "party_id": "uuid",
  "payment_date": "2026-03-20",
  "amount_pkr": 250000,
  "payment_method": "BANK_TRANSFER",
  "reference_number": "TXN-7788991",
  "is_advance": false,
  "allocations": [
    { "invoice_id": "uuid", "amount_pkr": 150000 },
    { "invoice_id": "uuid", "amount_pkr": 100000 }
  ]
}
```

---

### 4.10 Chambers (`/chambers`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/chambers` | List chambers with occupancy | All |
| POST | `/chambers` | Create chamber | MANAGER+ |
| PATCH | `/chambers/:id` | Update chamber | MANAGER+ |
| GET | `/chambers/:id/lots` | Active lots in chamber | All |
| POST | `/chambers/:id/temperature` | Log temperature reading | OPERATOR+ |

---

### 4.11 Reports (`/reports`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/reports/dashboard` | Operational + financial KPIs snapshot | MANAGER+ |
| GET | `/reports/lot-aging` | Active lots sorted by days in storage | MANAGER+ |
| GET | `/reports/receivables-aging` | AR aging by party | ACCOUNTANT+ |
| GET | `/reports/commodity-inventory` | Bags per commodity per chamber | All |
| GET | `/reports/weight-variance` | Inbound vs outbound weight by lot | MANAGER+ |
| GET | `/reports/seasonal-summary` | Totals for a date range | OWNER |
| GET | `/reports/party-statement/:party_id` | Full party ledger statement (PDF) | ACCOUNTANT+ |

---

## 5. Error Codes

| Code | HTTP | Description |
|---|---|---|
| `AUTH_INVALID` | 401 | Invalid or expired JWT |
| `FORBIDDEN` | 403 | Role lacks permission |
| `PARTY_NOT_FOUND` | 404 | Party does not exist |
| `LOT_NOT_FOUND` | 404 | Lot does not exist |
| `LOT_CLOSED` | 409 | Lot is closed; no operations allowed |
| `LOT_BALANCE_INSUFFICIENT` | 422 | Withdrawal exceeds balance |
| `WEIGHT_DISPUTE_UNRESOLVED` | 422 | Dispute note required |
| `INVOICE_ALREADY_FINALIZED` | 409 | Cannot edit finalized invoice |
| `CHAMBER_CAPACITY_EXCEEDED` | 422 | Chamber at max capacity |
| `TRANSFER_SAME_PARTY` | 422 | New owner must differ from current |
| `JOURNAL_UNBALANCED` | 422 | Debit total ≠ credit total on journal entry |
| `PERIOD_LOCKED` | 409 | Accounting period is closed; cannot post entries |
| `ACCOUNT_NOT_FOUND` | 404 | Account code does not exist in CoA |
| `SYSTEM_ACCOUNT_PROTECTED` | 409 | System accounts cannot be deleted or recoded |
| `CREDIT_NOTE_EXCEEDS_INVOICE` | 422 | Credit note total exceeds original invoice |
| `VALIDATION_ERROR` | 400 | Invalid input; field-level detail in error.field |
| `INTERNAL_ERROR` | 500 | Unexpected server error |

---

### 4.12 Credit Notes (`/credit-notes`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/invoices/:id/credit-note` | Issue credit note against a finalized invoice | MANAGER+ |
| GET | `/credit-notes` | List credit notes; filter by `party_id`, `date_from/to` | ACCOUNTANT+ |
| GET | `/credit-notes/:id` | Credit note detail + linked journal entry | ACCOUNTANT+ |
| GET | `/credit-notes/:id/pdf` | PDF of credit note | All |

**POST /invoices/:id/credit-note — Request**
```json
{
  "credit_date": "2026-03-25",
  "reason": "Loading charge disputed and accepted. Reducing by Rs. 3,000.",
  "line_items": [
    {
      "account_code": "4110",
      "description": "Loading charge reversal — agreed with Arhti Hameed",
      "amount_pkr": 3000
    }
  ]
}
```

**Response (201)**
```json
{
  "success": true,
  "data": {
    "credit_note_number": "CN-202603-0003",
    "total_pkr": 3000,
    "status": "ISSUED",
    "journal_entry_id": "uuid",
    "journal_entry_number": "JE-202603-0091"
  }
}
```

> The `journal_entry_id` in the response lets developers immediately verify the double-entry was posted correctly: DR 4110 Loading Revenue / CR 1130 Receivable — Arhtis.

---

### 4.13 General Ledger & Accounting (`/accounting`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/accounting/chart-of-accounts` | Full CoA tree for facility | ACCOUNTANT+ |
| POST | `/accounting/chart-of-accounts` | Add new account | OWNER |
| PATCH | `/accounting/chart-of-accounts/:code` | Rename or deactivate account | OWNER |
| GET | `/accounting/journal-entries` | List journal entries; filter by `type`, `status`, `period_month`, `period_year`, `source_table` | ACCOUNTANT+ |
| GET | `/accounting/journal-entries/:id` | Journal entry detail with all lines | ACCOUNTANT+ |
| POST | `/accounting/journal-entries` | Create manual journal entry | ACCOUNTANT+ (OWNER approval for posting) |
| POST | `/accounting/journal-entries/:id/post` | Post a manual AUTO_DRAFT entry | OWNER |
| POST | `/accounting/journal-entries/:id/reverse` | Reverse a POSTED entry | OWNER |
| GET | `/accounting/gl/:account_code` | GL account ledger — all entries for account in period | ACCOUNTANT+ |
| GET | `/accounting/trial-balance` | Trial balance for period | ACCOUNTANT+ |
| POST | `/accounting/periods/:year/:month/lock` | Lock accounting period | OWNER |
| GET | `/accounting/periods` | List periods with lock status | ACCOUNTANT+ |

**GET /accounting/gl/:account_code — Query params**
```
?period_year=2026&period_month=3&party_id=uuid&lot_id=uuid
```

**GET /accounting/gl/1110 — Response example**
```json
{
  "success": true,
  "data": {
    "account_code": "1110",
    "account_name": "Receivable — Farmers",
    "normal_balance": "DEBIT",
    "opening_balance": 450000,
    "entries": [
      {
        "date": "2026-03-01",
        "journal_entry_number": "JE-202603-0041",
        "description": "Invoice INV-202603-0088 — Ghulam Hussain",
        "debit": 79500,
        "credit": 0,
        "running_balance": 529500,
        "party_id": "uuid",
        "lot_id": "uuid"
      },
      {
        "date": "2026-03-20",
        "journal_entry_number": "JE-202603-0078",
        "description": "Payment received — Bank transfer TXN-9927",
        "debit": 0,
        "credit": 59500,
        "running_balance": 470000,
        "party_id": "uuid",
        "lot_id": null
      }
    ],
    "closing_balance": 470000
  }
}
```

**POST /accounting/journal-entries — Manual Entry Request**
```json
{
  "entry_date": "2026-03-31",
  "entry_type": "ADJUSTMENT",
  "description": "Monthly depreciation — Cold Plant (March 2026)",
  "lines": [
    { "account_code": "5040", "debit_amount": 29167, "credit_amount": 0, "description": "Depreciation expense" },
    { "account_code": "1311", "debit_amount": 0, "credit_amount": 29167, "description": "Accum. depreciation — cold plant" }
  ]
}
```
*Server validates: SUM(debit) = SUM(credit). If not → `JOURNAL_UNBALANCED` error.*

---

### 4.14 Financial Statements (`/accounting/reports`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| GET | `/accounting/reports/trial-balance` | Trial balance for period | ACCOUNTANT+ |
| GET | `/accounting/reports/profit-loss` | P&L statement for period | OWNER, ACCOUNTANT |
| GET | `/accounting/reports/balance-sheet` | Balance sheet as at date | OWNER, ACCOUNTANT |
| GET | `/accounting/reports/receivables-reconciliation` | AR sub-ledger vs GL 1110+1120+1130 check | ACCOUNTANT+ |
| GET | `/accounting/reports/revenue-by-commodity` | Revenue split 4010–4050 for period | OWNER, ACCOUNTANT |
| GET | `/accounting/reports/gst-output` | GST output tax summary by period | ACCOUNTANT+ |
| GET | `/accounting/reports/cash-flow-summary` | Cash receipts vs invoiced; net movement | OWNER |

**GET /accounting/reports/trial-balance — Query params**:
```
?period_year=2026&period_month=3
```

**GET /accounting/reports/profit-loss — Query params**:
```
?from=2026-01-01&to=2026-03-31&commodity_code=4010
```
*`commodity_code` filter restricts revenue to a single commodity account (e.g., 4010 = Potato only)*

---

### 4.15 Fixed Assets & Depreciation (`/accounting/fixed-assets`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/accounting/fixed-assets` | Record a new asset purchase | ACCOUNTANT+ |
| GET | `/accounting/fixed-assets` | List FA register | ACCOUNTANT+ |
| PATCH | `/accounting/fixed-assets/:id` | Update asset status (e.g., IN_SERVICE) | ACCOUNTANT+ |
| POST | `/accounting/fixed-assets/depreciation/run` | Run month-end depreciation batch | ACCOUNTANT+ |
| POST | `/accounting/fixed-assets/:id/dispose` | Record asset disposal/sale | OWNER |

### 4.16 Payroll (`/accounting/payroll`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/accounting/payroll/employees` | Create employee | ACCOUNTANT+ |
| GET | `/accounting/payroll/employees` | List employees | ACCOUNTANT+ |
| POST | `/accounting/payroll/runs` | Create draft payroll run | ACCOUNTANT+ |
| POST | `/accounting/payroll/runs/:id/finalize` | Finalize payroll (Triggers JE-15/15B) | MANAGER+ |
| POST | `/accounting/payroll/runs/:id/pay` | Record salary payout (Triggers JE-16) | ACCOUNTANT+ |
| GET | `/accounting/payroll/runs/:id/slips/:emp_id` | Get employee salary slip PDF | All |

### 4.17 Expense Vouchers (`/accounting/expenses`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/accounting/expenses` | Create draft expense voucher (with receipt upload) | All |
| GET | `/accounting/expenses` | List expense vouchers | All |
| POST | `/accounting/expenses/:id/approve` | Approve voucher | MANAGER+ |
| POST | `/accounting/expenses/:id/pay` | Record payment (Triggers JE-17A/B) | ACCOUNTANT+ |

### 4.18 Gate Passes (`/gate-passes`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/gate-passes/inward` | Log arriving truck | SECURITY+ |
| GET | `/gate-passes` | List active vehicles | All |
| PATCH | `/gate-passes/:id/link-lot` | Link to generated lot after weigh-in | OPERATOR+ |
| POST | `/gate-passes/:id/outward` | Dispatch truck (Clear) | SECURITY+ |

### 4.19 Peshgi / Loans (`/loans`)

| Method | Endpoint | Description | Role |
|---|---|---|---|
| POST | `/loans/issue` | Issue new cash/bank advance (Triggers JE-18) | OWNER |
| GET | `/loans` | List active loans | OWNER, MANAGER, ACCOUNTANT |
| POST | `/loans/:id/repay` | Record cash/bank repayment (Triggers JE-19) | OWNER, MANAGER |
| GET | `/loans/:id/statement` | View loan statement | OWNER, MANAGER, ACCOUNTANT |

---

## 7. Webhooks (Phase 2)

Future webhook events for integration:
- `lot.created`
- `lot.ownership_transferred`
- `outbound.dispatched`
- `invoice.finalized`
- `payment.recorded`
- `spoilage.confirmed`
- `journal_entry.posted`
- `period.locked`

