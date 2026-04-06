# ColdChain — Screen Inventory

**Version**: 1.0  
**Date**: March 2026  
**Framework**: Next.js 14 (App Router)  
**Derived from**: PRD, Functional Specs, API Design, E2E Workflows

---

## Authentication & Layout

### S-01: Login
- **URL**: `/login`
- **Content**: Email + password form, facility logo
- **Actions**: Login, Forgot Password
- **Role**: Public (unauthenticated)

### S-02: App Shell / Layout
- **URL**: `/` (wraps all authenticated routes)
- **Content**: Sidebar nav (modules), top bar (user name, role, facility name, logout), breadcrumbs
- **Actions**: Navigate between modules, switch book_type filter (Katchi/Pacci — OWNER/MANAGER/ACCOUNTANT only)
- **Role**: All authenticated

---

## Dashboard (M9 — Reporting)

### S-03: Operational Dashboard
- **URL**: `/dashboard`
- **Content**: KPI cards (active lots, today's inbound/outbound, total bags, occupancy %), chamber occupancy bar chart, "Attention Required" panel (lots past storage alert threshold, pending spoilage reviews)
- **Actions**: Click-through to lot detail, chamber detail
- **Role**: MANAGER, OWNER, OPERATOR (limited)

### S-04: Financial Dashboard
- **URL**: `/dashboard/financial`
- **Content**: Total AR outstanding, payments collected today, overdue (90+ days) amount, receivables aging donut chart, top 5 overdue parties
- **Actions**: Drill into party ledger, AR aging report
- **Role**: OWNER, ACCOUNTANT

---

## M1: Party Management

### S-05: Party List
- **URL**: `/parties`
- **Content**: Table of parties with columns: name, type, phone, active lots count, AR balance, credit limit, status
- **Filters**: Party type, is_active, search (name/phone)
- **Actions**: Create New Party, Export CSV, click row → Party Detail
- **Role**: All (view); OPERATOR+ (create)

### S-06: Party Create / Edit
- **URL**: `/parties/new` or `/parties/:id/edit`
- **Content**: Form: name, name_urdu, party_type, phone_primary, phone_secondary, address, CNIC, parent_arhti_id (dropdown), credit_limit_pkr, credit_terms_days, notes
- **Actions**: Save, Cancel
- **Role**: OPERATOR+

### S-07: Party Detail
- **URL**: `/parties/:id`
- **Content**: Party info card, credit profile, tabs: Active Lots | Invoices | Payments | Ledger | Peshgi Loans
- **Actions**: Edit Party, Deactivate, View Statement PDF, Issue Peshgi (OWNER only)
- **Role**: All (view)

---

## M2: Inbound & Lot Management

### S-08: Lot List
- **URL**: `/lots`
- **Content**: Table: lot_number, owner, commodity, variety, quantity, current_balance, chamber, inbound_date, days_in_storage, status
- **Filters**: Status, party, commodity, chamber, date range
- **Actions**: Create New Lot, Export CSV, click row → Lot Detail
- **Role**: All

### S-09: Lot Create (Inbound Form)
- **URL**: `/lots/new`
- **Content**: Form: owner_party (searchable), billing_party (defaults to owner), commodity, variety, quantity_bags, declared_weight, accepted_weight, chamber (dropdown filtered by commodity, shows capacity), rate_plan, vehicle_number, quality_grade, inbound_date, notes, photos upload. Weight dispute warning inline when threshold exceeded
- **Actions**: Save (generates lot + receipt), Cancel, Link Gate Pass (optional)
- **Role**: OPERATOR+

### S-10: Lot Detail
- **URL**: `/lots/:id`
- **Content**: Lot header card (number, owner, commodity, balance, status, days in storage, weight info, dispute flag). Tabs: Overview | Ownership History (timeline) | Inspections | Spoilage | Withdrawals | Billing History
- **Actions**: Transfer Ownership, New Withdrawal, New Inspection, Record Spoilage, Reprint Receipt
- **Role**: All (view); specific actions per role

### S-11: Storage Receipt (PDF Preview)
- **URL**: `/lots/:id/receipt`
- **Content**: Printable A4/A5 PDF: lot number, date, owner (English + Urdu), commodity, variety, quantity, weight, chamber, rate plan, cold store stamp area
- **Actions**: Print, Download PDF
- **Role**: OPERATOR+

---

## M3: Ownership Transfer

### S-12: Ownership Transfer Form
- **URL**: `/lots/:id/transfer` (modal or page)
- **Content**: Source lot summary, transfer_type (FULL/PARTIAL), quantity (if partial), new_owner_party (searchable), effective_date, transfer_price (optional), notes. Shows pre-transfer invoice for old owner
- **Actions**: Submit Transfer, Cancel
- **Role**: MANAGER+

### S-13: Transfer Acknowledgment (PDF)
- **URL**: `/lots/:id/transfer/:transfer_id/acknowledgment`
- **Content**: Printable PDF: old owner, new owner, lot, quantity transferred, date, transfer price, signatures area
- **Actions**: Print, Download
- **Role**: MANAGER+

---

## M4: Outbound & Dispatch

### S-14: New Withdrawal Form
- **URL**: `/lots/:id/withdraw` (or `/outbound-events/new?lot_id=:id`)
- **Content**: Lot summary, withdrawal_type (FULL/PARTIAL), quantity, outbound_date, outbound_weight_kg, receiving_party (optional), vehicle_number
- **Actions**: Save (creates PENDING outbound event), Cancel
- **Role**: OPERATOR+

### S-15: Outbound Event Detail
- **URL**: `/outbound-events/:id`
- **Content**: Withdrawal details, lot info, weight variance display (inbound vs outbound), linked invoice preview with auto-calculated storage + service charges
- **Actions**: Record Weight, Add Service Charges, Preview Invoice, Finalize Invoice (MANAGER+), Generate Dispatch Note
- **Role**: All (view); MANAGER+ (finalize)

### S-16: Dispatch Note (PDF)
- **URL**: `/outbound-events/:id/dispatch-note`
- **Content**: Lot number, owner, commodity, quantity withdrawn, vehicle, date, operator signature area
- **Actions**: Print, Download
- **Role**: OPERATOR+

---

## M5: Billing Engine

### S-17: Rate Plan List
- **URL**: `/billing/rate-plans`
- **Content**: Table: name, commodity, rate_type, rate_amount, season dates, status
- **Actions**: Create, Edit, Deactivate
- **Role**: MANAGER+

### S-18: Rate Plan Create / Edit
- **URL**: `/billing/rate-plans/new` or `/billing/rate-plans/:id/edit`
- **Content**: Form: name, commodity, rate_type, rate_amount, season_start/end (conditional), revenue_account_code, min_billing_days
- **Actions**: Save, Cancel
- **Role**: MANAGER+

### S-19: Service Charge Catalog
- **URL**: `/billing/service-charges`
- **Content**: Table: name, unit_type, unit_price, revenue_account_code, status
- **Actions**: Create, Edit, Deactivate
- **Role**: MANAGER+

### S-20: Invoice List
- **URL**: `/invoices`
- **Content**: Table: invoice_number, party, lot, date, total, paid, balance_due, status
- **Filters**: Party, status, date range, book_type
- **Actions**: Click → Invoice Detail, Export CSV
- **Role**: ACCOUNTANT+

### S-21: Invoice Detail / Preview
- **URL**: `/invoices/:id`
- **Content**: Invoice header (number, party, lot, date, status), line items table (STORAGE, SERVICE, ADJUSTMENT, ADVANCE_APPLIED), totals (sub, GST, grand), payment history
- **Actions**: Finalize (MANAGER+), Issue Credit Note (MANAGER+), Print PDF, Record Payment
- **Role**: All (view)

---

## M6: Quality & Spoilage

### S-22: Quality Inspection Form
- **URL**: `/lots/:id/inspections/new`
- **Content**: Form: inspection_date, inspector_name, quality_grade, condition_flags (checkboxes), observations, photo upload (up to 5)
- **Actions**: Save, Cancel
- **Role**: OPERATOR+

### S-23: Spoilage Record Form
- **URL**: `/lots/:id/spoilage/new`
- **Content**: Form: event_date, quantity_affected_bags, cause (dropdown), estimated_loss_kg, notes, photos
- **Actions**: Save (creates PENDING_REVIEW), Cancel
- **Role**: OPERATOR+

### S-24: Spoilage Review
- **URL**: `/spoilage/:id` (or within Lot Detail tab)
- **Content**: Spoilage details, photos, current status
- **Actions**: Confirm (adjusts lot qty — MANAGER+), Dispute (adds dispute note — MANAGER+)
- **Role**: MANAGER+

---

## M7: Financial Ledger & Payments

### S-25: Payment Recording
- **URL**: `/payments/new`
- **Content**: Form: party (searchable), payment_date, amount, payment_method, reference_number, is_advance flag, invoice allocation grid (shows open invoices for party, allocate amounts)
- **Actions**: Save, Cancel
- **Role**: ACCOUNTANT+

### S-26: Party Ledger View
- **URL**: `/parties/:id/ledger` (or tab within Party Detail)
- **Content**: Chronological ledger: date, description (invoice/payment/credit note/advance), debit, credit, running balance. Filterable by date range, book_type
- **Actions**: Export PDF (Party Statement), Export CSV
- **Role**: ACCOUNTANT+

---

## M8: Chamber & Capacity

### S-27: Chamber List
- **URL**: `/chambers`
- **Content**: Cards or table: chamber name, commodity restriction, capacity, current occupancy (bar), % full, temperature (last reading)
- **Actions**: Create Chamber, click → Chamber Detail
- **Role**: All (view); MANAGER+ (create/edit)

### S-28: Chamber Detail
- **URL**: `/chambers/:id`
- **Content**: Chamber info, occupancy stats, active lots table (with owner, commodity, quantity, days), temperature log history
- **Actions**: Edit Chamber, Log Temperature, View Lot
- **Role**: All (view)

### S-29: Visual Chamber Map (P1)
- **URL**: `/chambers/map`
- **Content**: Grid view of all chambers, color-coded by fill level (green/yellow/red). Click cell → lot summary popup
- **Actions**: Click-through to lot detail
- **Role**: MANAGER+

---

## M9: Reports

### S-30: Report Hub
- **URL**: `/reports`
- **Content**: Report cards: Lot Aging, Commodity Inventory, Receivables Aging, Weight Variance, Seasonal Summary, Ownership Transfer Log
- **Actions**: Click → individual report page
- **Role**: MANAGER+ (varies by report)

### S-31: Party Statement (PDF)
- **URL**: `/reports/party-statement/:party_id`
- **Content**: Full party ledger for chosen period, formatted for print
- **Actions**: Select date range, Download PDF
- **Role**: ACCOUNTANT+

---

## M10: Gate Pass (Security)

### S-32: Gate Pass Console
- **URL**: `/gate`
- **Content**: Split view: LEFT = "Log Arrival" form (vehicle number, driver name, bilty no). RIGHT = "Vehicles Currently Inside" list with status (ARRIVED/WEIGHING). Minimal UI, large buttons, touch-optimized
- **Actions**: Log Inward, Clear Outward (validates paid invoice or credit authorization), Link to Lot
- **Role**: SECURITY+

---

## M11: Peshgi (Loans)

### S-33: Peshgi Issue Form
- **URL**: `/loans/issue`
- **Content**: Form: party (searchable), amount, payment_method, notes
- **Actions**: Submit (OWNER only), Print Acknowledgment
- **Role**: OWNER

### S-34: Peshgi Dashboard
- **URL**: `/loans`
- **Content**: Table: party, loan number, issued date, principal, balance, status. Summary: total advances outstanding
- **Actions**: Record Repayment, View Statement, click → Loan Detail
- **Role**: OWNER, MANAGER, ACCOUNTANT

---

## Accounting (M7 Extended)

### S-35: Chart of Accounts
- **URL**: `/accounting/chart-of-accounts`
- **Content**: Tree view: account classes → headers → detail accounts. Columns: code, name, class, normal balance, system account flag
- **Actions**: Add Account (OWNER), Rename, Deactivate
- **Role**: ACCOUNTANT+

### S-36: Journal Entry List
- **URL**: `/accounting/journal-entries`
- **Content**: Table: entry_number, date, type, description, total_debit, total_credit, status (POSTED/REVERSED/AUTO_DRAFT), source
- **Filters**: Type, status, period, source_table
- **Actions**: View Detail, Create Manual Entry (ACCOUNTANT+), Post (OWNER), Reverse (OWNER)
- **Role**: ACCOUNTANT+

### S-37: GL Account Ledger
- **URL**: `/accounting/gl/:account_code`
- **Content**: Account header (code, name, normal balance), opening balance, entries table (date, JE number, description, debit, credit, running balance), closing balance
- **Filters**: Period, party, lot
- **Actions**: Export, Drill into JE detail
- **Role**: ACCOUNTANT+

### S-38: Financial Statements
- **URL**: `/accounting/reports/trial-balance`, `/accounting/reports/profit-loss`, `/accounting/reports/balance-sheet`
- **Content**: Standard formatted financial statements derived from GL
- **Filters**: Period (month/year), commodity (for P&L), as-at date (for BS)
- **Actions**: Export PDF, Print
- **Role**: OWNER, ACCOUNTANT

---

## System Administration

### S-39: User Management
- **URL**: `/settings/users`
- **Content**: Table: name, email, role, status, last login
- **Actions**: Create User, Edit Role, Deactivate
- **Role**: OWNER

### S-40: System Settings
- **URL**: `/settings`
- **Content**: Facility info, weight dispute threshold, storage alert thresholds per commodity, GST registration toggle, number formatting preference
- **Actions**: Save
- **Role**: OWNER

---

## Summary

| Module | Screens | Key Screen |
|---|---|---|
| Auth & Layout | 2 | Login, App Shell |
| Dashboard | 2 | Operational, Financial |
| M1 Party | 3 | Party List, Detail, Create/Edit |
| M2 Lots | 4 | Lot List, Create, Detail, Receipt PDF |
| M3 Transfer | 2 | Transfer Form, Acknowledgment PDF |
| M4 Outbound | 3 | Withdrawal, Outbound Detail, Dispatch PDF |
| M5 Billing | 5 | Rate Plans, Service Charges, Invoices List/Detail |
| M6 Quality | 3 | Inspection Form, Spoilage Form, Spoilage Review |
| M7 Payments | 2 | Payment Recording, Party Ledger |
| M8 Chambers | 3 | Chamber List, Detail, Visual Map |
| M9 Reports | 2 | Report Hub, Party Statement |
| M10 Gate | 1 | Gate Pass Console |
| M11 Peshgi | 2 | Issue Form, Dashboard |
| Accounting | 4 | CoA, Journal Entries, GL Ledger, Financial Statements |
| Admin | 2 | User Mgmt, Settings |
| **Total** | **40** | |
