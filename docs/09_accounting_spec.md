# ColdChain — Integrated Accounting Specification

**Version**: 1.0  
**Date**: March 2026  
**Replaces / Supersedes**: M7 (Financial Ledger & AR) in `functional_specs.md`  
**Read together with**: `functional_specs.md`, `data_model.md`, `BRD_coldchain.md`

> **Design Mandate**: Accounting is not a module that receives data from operations.  
> It IS the operation. Every transaction that physically happens in the cold store  
> — a lot dispatched, a payment received, an ownership transferred — simultaneously  
> writes a balanced journal entry in the General Ledger. There is no gap between  
> what happened operationally and what is recorded financially.

---

## 1. Accounting Philosophy

### Why Double-Entry, Not Just AR Tracking

The original M7 draft was effectively a one-sided party ledger: invoices raised debits; payments raised credits. This works for simple AR tracking but fails across four dimensions that matter in a mandi cold store:

1. **Revenue reporting**: Without proper revenue accounts, you cannot produce a P&L. You cannot tell the cold store owner: "You earned Rs. 4.2 million from potato storage and Rs. 600k from services this season." You only know who paid you — not what they paid for.

2. **Cash vs. Accrual**: Cold stores operate on accrual — storage charges accrue daily even if not yet invoiced. A one-sided ledger cannot distinguish between earned-but-not-billed revenue and earned-and-billed revenue.

3. **Advance payments create a liability**: When a client pays before an invoice is raised (common in mandi relationships — farmers pay as a deposit against the season), that is not revenue — it is a liability (Advance from Client). A single-sided ledger cannot represent this correctly.

4. **Audit and owner trust**: The cold store owner needs to know their actual financial position at any point in the season — not just AR. A balanced trial balance is the only mechanism that catches entry errors through the fundamental check: Total Debits = Total Credits.

### Accounting Standard Applied
- **Framework**: Cash-and-Accrual hybrid appropriate for SME Pakistan businesses
- **Standard**: Aligned with IFRS for SMEs (International Financial Reporting Standard for Small and Medium-sized Entities), simplified for operational use
- **Tax basis**: Pakistan Income Tax / GST where applicable; tax-reportable but not enforced

### The Katchi vs Pacci Reality (Dual Ledger Flag)
- Because Pakistan's agri sector operates heavily in informal ("Katchi") cash markets alongside formal ("Pacci") taxable channels, **every journal entry carries a `book_type` flag (PACCI or KATCHI)**.
- **PACCI Ledger (Official)**: Immutable. Once `POSTED`, you cannot `UPDATE` or `DELETE` these entries. Corrections require `REVERSAL` journal entries.
- **KATCHI Ledger (Internal/Informal)**: Mutable *only* by the `OWNER`. Katchi entries can be soft-deleted or modified without a visible UI reversal entry to allow for internal bookkeeping flexibility ("fudging"). The backend postgres `audit_log` still triggers for technical security, but reports treat Katchi deletions as if they never happened.

---

## 2. Chart of Accounts (CoA)

The CoA is designed for a cold storage business: every account name and number reflects what actually happens at the facility. There are no generic ERP account names here.

### Account Numbering Convention
```
1XXX  =  Assets
2XXX  =  Liabilities  
3XXX  =  Equity
4XXX  =  Revenue
5XXX  =  Cost of Services (Direct)
6XXX  =  Operating Expenses (Indirect)
```

Leading digits **0, 7, 8 and 9 are unassigned and stay legal** — an owner may open
a custom head outside the seeded ranges. `coa.service.ts` rejects only a code whose
leading digit belongs to *another* class's assigned range (an EXPENSE numbered 1999).
Accounts under a custom head surface in the statements' "unclassified" bucket.

**Codes are permanent.** Once an account carries a posting, `guard_chart_of_accounts`
and the journal-entry-line FK's `ON UPDATE RESTRICT` block any change to its code,
class, type, parent or normal balance. There is no renumber or merge tooling, and
none is planned — reclassifying means opening a new account. The Add Account form
therefore *prefills* a suggested code from the parent's block but leaves it editable;
it never auto-assigns.

### Statement Structure Is Data-Driven (phase/24)

Every HEADER account carries a nullable `statement_section` column (migration `0015`).
`financial-statements.service.ts` places accounts by querying headers with a matching
section — `sectionHeaders(accounts, 'CURRENT_ASSET')` — not by a hardcoded array of
codes. The nine sections:

| Section | Statement | Seeded headers |
|---|---|---|
| `CURRENT_ASSET` | Balance sheet | 1000, 1100, 1200 |
| `NON_CURRENT_ASSET` | Balance sheet | 1300 |
| `CURRENT_LIABILITY` | Balance sheet | 2000 |
| `NON_CURRENT_LIABILITY` | Balance sheet | 2100 |
| `REVENUE` | P&L | 4000, 4100 |
| `CONTRA_REVENUE` | P&L | 4900 |
| `OTHER_INCOME` | P&L | 4200 |
| `COST_OF_SERVICE` | P&L | 5000 |
| `OPERATING_EXPENSE` | P&L | 6000 |

**A header with no section** — the default for anything the API accepted before this
column existed, and still the default for a header an owner creates without picking
one — routes its children into `unclassified_asset_lines` / `unclassified_liability_lines`
(balance sheet) or `unclassified_lines` (P&L). This is the F-6b fallback, unchanged from
phase/19: the statement stays complete and `is_balanced` still holds.

**EQUITY headers take no section, by validation, not by omission.** Equity aggregates
by `accountClass` directly (`equity_lines` in `financial-statements.service.ts`), not by
header — 3010/3020/3030 sit at the root with no parent. `coa.service.ts` rejects a
`statement_section` on an EQUITY header outright.

**On the P&L, unclassified activity folds into the matching class subtotal, not just
`net_profit_pkr`.** `accountClass` maps 1:1 onto a P&L subtotal (REVENUE → operating
revenue, COST_OF_SERVICE → cost of service, EXPENSE → operating expense), so there is no
judgement call to defer the way there is on the balance sheet — an unclassified expense
account correctly reduces `operating_profit_pkr` and `ebitda_pkr`, not only the bottom
line. (Phase 24 also fixed a real defect here: before this, unclassified activity
reached `net_profit_pkr` only, leaving every subtotal above it wrong whenever an
unclassified account had activity.)

**On the balance sheet, current vs. non-current is not inferred.** That split is a real
accounting judgement a parent link cannot answer, so an unclassified asset or liability
is still added to the grand total (`total_assets_pkr` / `total_liabilities_pkr`) but
**excluded** from the current/non-current subtotals. A current ratio or working-capital
figure read off those subtotals will understate them until the account is given a
section — the balance-sheet screen shows this disclosure whenever `has_unclassified`.

**Section is presentation, not structure.** Unlike `account_code` / `account_class` /
`account_type` / `parent_account_code` / `normal_balance` — locked by
`guard_chart_of_accounts` the moment an account carries a posting — `statement_section`
stays editable on a header at any time, including one whose DETAIL children already have
postings. `PATCH /v1/accounting/accounts/:code` accepts it.

**A header never takes a parent.** `coa.service.ts` rejects `account_type: 'HEADER'`
with a `parent_account_code` set. `buildGroups`/`buildLines` match exactly one level
(`parentAccountCode === headerCode`); a header nested under another header would orphan
its own children into the unclassified bucket even though its grandparent has a section —
so nesting is refused at creation rather than silently mis-placed at report time.

---

### CLASS 1: ASSETS

| Code | Account Name | Type | Notes |
|---|---|---|---|
| **1000** | **Cash & Bank** | Header | |
| 1010 | Cash on Hand | Detail | Physical petty cash at facility |
| 1020 | Bank Account — Main | Detail | Primary operating account |
| 1030 | Mobile Wallet Receipts | Detail | JazzCash / EasyPaisa collections |
| **1100** | **Trade Receivables** | Header | |
| 1110 | Receivable — Farmers | Detail | AR from farmer billing parties |
| 1120 | Receivable — Traders | Detail | AR from trader billing parties |
| 1130 | Receivable — Arhtis | Detail | AR from commission agents as billing party |
| 1140 | Receivable — Peshgi (Loans) | Detail | Cash advances issued to farmers/arhtis |
| 1150 | Receivable — Other | Detail | Any other billing party type |
| **1200** | **Other Current Assets** | Header | |
| 1210 | Advance Payments to Suppliers | Detail | Prepaid for supplies, packaging |
| 1220 | Prepaid Electricity (Security Deposit) | Detail | LESCO / FESCO security deposits |
| 1230 | Advances to Employees | Detail | Cash advances against future salary (Phase 21); recovered via payroll, see §12.7 |
| **1300** | **Fixed Assets** | Header | |
| 1310 | Cold Storage Plant & Equipment | Detail | Compressors, refrigeration units |
| 1311 | Accum. Depreciation — Plant & Equipment | Detail | Contra-asset (credit balance) |
| 1320 | Building / Civil Works | Detail | Storage structure |
| 1321 | Accum. Depreciation — Building | Detail | Contra-asset |
| 1330 | Vehicles | Detail | Facility-owned forklifts, trucks |
| 1331 | Accum. Depreciation — Vehicles | Detail | Contra-asset |
| 1340 | Computer & Software | Detail | Tablets, PCs, ColdChain subscription |
| 1341 | Accum. Depreciation — Computer | Detail | Contra-asset |
| 1350 | Capital Work in Progress | Detail | Assets under construction, not yet depreciating |
| 1360 | Intangible Assets — Software | Detail | Capitalised software licences |
| 1361 | Accum. Amortisation — Software | Detail | Contra-asset |

---

### CLASS 2: LIABILITIES

| Code | Account Name | Type | Notes |
|---|---|---|---|
| **2000** | **Current Liabilities** | Header | |
| 2010 | Advance Receipts from Clients | Detail | ⚠️ Cash received before invoice — this is a LIABILITY until earned |
| 2020 | GST Payable — Output Tax | Detail | If facility is GST-registered |
| 2030 | Salaries Payable | Detail | Wages earned but not yet paid |
| 2040 | Utility Bills Payable | Detail | Electricity, gas accrued |
| 2060 | EOBI Payable — Employee Portion | Detail | Deducted from salary, to be remitted to EOBI |
| 2061 | EOBI Payable — Employer Portion | Detail | Cold store's own contribution, to be remitted to EOBI |
| 2070 | Income Tax Withheld Payable | Detail | Salary tax deducted, to be filed with FBR |
| 2080 | Damage / Spoilage Liability Payable | Detail | Cold store liability for spoilage when at fault (JE-09) |
| **2100** | **Long-Term Liabilities** | Header | |
| 2110 | Bank Loan — Equipment Finance | Detail | ZTBL / commercial loan for compressors |
| 2120 | Loan from Director / Owner | Detail | Owner-injected capital treated as loan |

---

### CLASS 3: EQUITY

| Code | Account Name | Type | Notes |
|---|---|---|---|
| 3010 | Owner's Capital | Detail | Initial and subsequent equity injections. Also the plug account for the guided opening-balance entry (there is no separate "Opening Balance Equity" account) |
| 3020 | Retained Earnings | Detail | Posted only by opening balances. On the balance sheet it is **presented** as posted 3020 + accumulated prior fiscal years' result — see §5.3 virtual closing |
| 3030 | Current Year Profit / (Loss) | Detail | **Never posted to.** The balance sheet computes the current fiscal year's result live and presents it on this line |

---

### CLASS 4: REVENUE

| Code | Account Name | Type | Notes |
|---|---|---|---|
| **4000** | **Storage Revenue** | Header | |
| 4010 | Storage Revenue — Potato | Detail | Seasonal/monthly storage fees, potato lots |
| 4020 | Storage Revenue — Apple | Detail | Apple lots |
| 4030 | Storage Revenue — Onion | Detail | Onion lots |
| 4040 | Storage Revenue — Kinnow | Detail | Kinnow lots |
| 4050 | Storage Revenue — Other | Detail | Any other commodity |
| **4100** | **Handling & Service Revenue** | Header | |
| 4110 | Loading Revenue | Detail | Per-bag loading charges |
| 4120 | Unloading Revenue | Detail | Per-bag unloading charges |
| 4130 | Sorting & Grading Revenue | Detail | Per-bag sorting/grading |
| 4140 | Packing Revenue | Detail | Packaging service if offered |
| 4150 | Other Service Revenue | Detail | Miscellaneous services |
| **4200** | **Other Income** | Header | |
| 4210 | Late Payment Surcharge | Detail | Charged on overdue accounts — see JE-21 |
| 4220 | Damage Settlement Received | Detail | Insurance or third-party claim recovery |
| 4230 | Gain on Disposal of Asset | Detail | Proceeds above net book value |
| **4900** | **Contra Revenue** | Header | Deducted from operating revenue to reach net revenue |
| 4910 | Discounts Allowed | Detail | Contra-revenue (**debit** normal balance); posted by JE-01 when a draft invoice carries a discount |

---

### CLASS 5: COST OF SERVICES (Direct)

| Code | Account Name | Type | Notes |
|---|---|---|---|
| **5000** | **Direct Operating Costs** | Header | |
| 5010 | Electricity — Refrigeration | Detail | Single largest cost; cold chain power |
| 5020 | Electricity — Facility (Non-Refrig.) | Detail | Lighting, offices |
| 5030 | Direct Labor — Loaders & Handlers | Detail | Daily wage workers at facility |
| 5035 | Employer EOBI — Direct Labor | Detail | EOBI employer contribution for daily wage workers |
| 5040 | Depreciation — Cold Plant | Detail | Allocated from 1311 |
| 5050 | Refrigerant & Consumables | Detail | Gas refills, lubricants |
| 5060 | Packaging & Materials | Detail | Bags, crates used in operations |

---

### CLASS 6: OPERATING EXPENSES (Indirect)

| Code | Account Name | Type | Notes |
|---|---|---|---|
| **6000** | **Indirect / Overhead Expenses** | Header | |
| 6010 | Salaries — Management & Office | Detail | Managers, accountant, admin |
| 6015 | Employer EOBI — Management & Office | Detail | EOBI employer contribution for salaried staff |
| 6020 | Rent (if leased land/building) | Detail | |
| 6030 | Maintenance & Repairs | Detail | Equipment servicing |
| 6040 | Fuel & Vehicle | Detail | Forklift fuel, company vehicle |
| 6050 | Insurance | Detail | Fire, cold chain breakdown, theft |
| 6060 | Communication | Detail | Phone, internet |
| 6070 | Computer & Software | Detail | ColdChain subscription, IT support |
| 6080 | Bad Debt Expense | Detail | Uncollectable receivables written off |
| 6090 | Bank Charges | Detail | Transaction fees, cheque charges |
| 6100 | Miscellaneous | Detail | Petty cash unclassified |
| 6110 | Loss on Disposal of Asset | Detail | Net book value above disposal proceeds |
| 6120 | Depreciation — Building | Detail | Non-plant depreciation (P&L; added back for EBITDA) |
| 6130 | Depreciation — Vehicles | Detail | P&L; added back for EBITDA |
| 6140 | Amortisation — Software | Detail | P&L; added back for EBITDA |
| 6150 | Spoilage / Damage Compensation Expense | Detail | Cold store liability for spoilage (JE-09) |

---

## 3. Journal Entry Templates — Operational Event Triggers

This is the core integration: every operational event in ColdChain (defined in `functional_specs.md` and `BRD_coldchain.md`) automatically creates a balanced journal entry. The entry is not created by accounting staff — it is generated by the system at the moment the operational event is finalized.

---

### JE-01: Invoice Finalized (Storage + Services)

**Operational trigger**: Manager clicks "Finalize" on an invoice in M5 (Billing Engine) / M4 (Outbound).  
**Source document**: `invoices` table, linked to `invoice_line_items`  
**Timing**: At `finalized_at` timestamp

The system reads each line item's `line_type` and maps to the correct revenue account using commodity + service type:

```
DEBIT   1110 / 1120 / 1130  Receivable — [Party Type]        total_pkr
  CREDIT  4010–4050           Storage Revenue — [Commodity]    storage_amount
  CREDIT  4110–4150           Service Revenue — [Service Type] services_amount
  CREDIT  2020                GST Payable (if gst_amount > 0)  gst_amount_pkr
```

**Example — Farmer Ghulam, Potato, Seasonal Storage + Loading:**
```
DR  1110  Receivable — Farmers           26,000
  CR  4010  Storage Revenue — Potato        25,000
  CR  4110  Loading Revenue                  1,000
——————————————————————————————————————————————————
Check: Debits (26,000) = Credits (26,000) ✓
```

**Commodity → Revenue Account Mapping** (enforced in system config):
| Commodity | Default Storage Revenue Account |
|---|---|
| POTATO | 4010 |
| APPLE | 4020 |
| ONION | 4030 |
| KINNOW | 4040 |
| OTHER | 4050 |

**Service → Revenue Account Mapping:**
| Service Charge Name | Revenue Account |
|---|---|
| Loading | 4110 |
| Unloading | 4120 |
| Sorting / Grading | 4130 |
| Packing | 4140 |
| Other | 4150 |

> Each `service_charges` record carries a `revenue_account_code` field (see data model additions below). This is set once when the service is created and drives journal routing — no manual intervention at billing time.

---

### JE-02: Payment Received (Against Invoice)

**Operational trigger**: Accountant records payment in M7 and allocates to one or more invoices.  
**Source document**: `payments` table + `payment_allocations`  
**Timing**: At `payment_date`

```
DEBIT   1010 / 1020 / 1030  Cash / Bank / Mobile Wallet      amount_pkr
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]        amount_pkr
```

**Example — Trader Ahmad pays Rs. 26,000 by bank transfer:**
```
DR  1020  Bank Account — Main             26,000
  CR  1120  Receivable — Traders            26,000
——————————————————————————————————————————————————
Check: Debits (26,000) = Credits (26,000) ✓
```

**Payment method → Asset account mapping:**
| Payment Method | Debit Account |
|---|---|
| CASH | 1010 Cash on Hand |
| CHEQUE | 1020 Bank Account (on clearance) |
| BANK_TRANSFER | 1020 Bank Account |
| MOBILE_WALLET | 1030 Mobile Wallet Receipts |

> For cheque: the entry is created on receipt date but flagged `pending_clearance = true`. On clearance confirmation, no new entry is needed (already posted). If cheque bounces, see JE-06.

> ⚠️ **Superseded — decision of 2026-07-31.** The paragraph above contradicts §364-368 below: it debits `1020` on receipt (overstating the bank) while §366 says *"Do NOT post JE-02 until the cheque clears."* The as-built code satisfies neither — `payment.service.ts:97` stamps every cheque `CLEARED` on receipt and posts straight to `1020`, and `PENDING` is never assigned.
>
> **The adopted model is a Cheques-in-Hand clearing account**, which satisfies both intents:
>
> ```
> RECEIPT (any cheque, post-dated or not)
>   DR  1025 Cheques in Hand      amount
>     CR  1110-1150 <party AR>      amount     clearance_status = PENDING
>
> CLEARANCE (dated the clearance date)
>   DR  1020 Bank Account         amount
>     CR  1025 Cheques in Hand      amount     clearance_status = CLEARED
>
> BOUNCE — reverses out of 1025, never 1020 (see JE-06)
> ```
>
> The payment is recognised when received (this section's intent) and the bank balance never includes an uncleared cheque (§366's intent). Requires new CoA account `1025`, a clearance action, and JE-02/JE-06 changes. **Not yet implemented** — tracked as P1-12 in `20_audit_backlog.md`. Rewrite §259 and §364-368 to match when it is built.

---

### JE-03: Advance Payment Received (Before Invoice)

**Operational trigger**: A client pays before an invoice exists (deposit for the season).  
**Source document**: `payments` table where `is_advance = true`  
**Why it differs**: Advance is NOT revenue — it is a liability until the service is performed.

```
DEBIT   1010 / 1020 / 1030  Cash / Bank / Mobile Wallet      amount_pkr
  CREDIT  2010                Advance Receipts from Clients    amount_pkr
```

**Example — Farmer Hameed pays Rs. 20,000 advance at season start:**
```
DR  1020  Bank Account — Main             20,000
  CR  2010  Advance Receipts from Clients  20,000
——————————————————————————————————————————————————
Check: Debits (20,000) = Credits (20,000) ✓
```

---

### JE-04: Advance Applied to Invoice

**Operational trigger**: When an invoice is finalized and the billing party has an advance balance, the system applies (offsets) the advance against the invoice. This appears as an `ADVANCE_APPLIED` line item on the invoice.  
**Source document**: `invoice_line_items` where `line_type = ADVANCE_APPLIED`  
**Effect**: Converts a liability (2010) into a reduction of receivables

```
DEBIT   2010  Advance Receipts from Clients   advance_applied_amount
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]  advance_applied_amount
```

**Example — Farmer Hameed's Rs. 20,000 advance applied to his Rs. 79,500 invoice:**
```
DR  2010  Advance Receipts from Clients   20,000
  CR  1110  Receivable — Farmers            20,000

(Separately, JE-01 already posted Rs. 79,500 to AR)
Net AR balance for Hameed = 79,500 − 20,000 = Rs. 59,500 ✓
```

---

### JE-05: Credit Note Issued (Invoice Adjustment)

**Operational trigger**: Manager issues a credit note against a finalized invoice (disputed charge, loading fee error, spoilage adjustment).  
**Source document**: `credit_notes` table (referencing original `invoice_id`)  
**Effect**: Reverses revenue; reduces receivable

```
DEBIT   4010–4150  Revenue Account (same account as original line)  credit_amount
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]               credit_amount
```

**Example — Loading fee of Rs. 3,000 disputed by Arhti Hameed; credit note issued:**
```
DR  4110  Loading Revenue                  3,000
  CR  1130  Receivable — Arhtis             3,000
——————————————————————————————————————————————————
Check: Debits (3,000) = Credits (3,000) ✓
```

> Revenue is reduced, not cash. If cash was already paid, the excess becomes a credit balance on the party account (JE-07 handles overpayment credit).

---

### JE-06: Cheque Dishonoured (Bounce)

**Operational trigger**: Accountant marks a previously recorded cheque payment as dishonoured.  
**Source document**: `payments` table, `status → DISHONOURED`  
**Effect**: Reverses the bank debit; re-opens the receivable; flags the party; marks original JE as reversed

```
DEBIT   1110 / 1120 / 1130  Receivable — [Party Type]   amount_pkr
  CREDIT  1020                Bank Account — Main          amount_pkr
```

**Full system actions on cheque bounce (all atomic within one transaction):**

1. **Payment record**: `payments.status → DISHONOURED`
2. **Original journal entry** (JE-02): `posting_status → REVERSED`, `reversed_by → JE-06.id`
3. **Payment allocations**: All `payment_allocations` linked to this payment are voided (`status → VOIDED`)
4. **Invoice(s)**: Each linked invoice's `amount_paid` is recalculated; if `amount_paid < total`, `status → FINALIZED` (re-opened from PAID/PARTIALLY_PAID)
5. **Party profile**: `dishonoured_cheque_flag = true` (operational warning for future credit decisions)
6. **New journal entry**: JE-06 posted with `entry_type = REVERSAL`, referencing the original JE-02

**Example — Trader Ahmad's Rs. 26,000 cheque bounces:**
```
DR  1120  Receivable — Traders            26,000
  CR  1020  Bank Account — Main            26,000
——————————————————————————————————————————————————
Party profile: dishonoured_cheque_flag = true
Invoice INV-202603-0088: status → FINALIZED (re-opened)
Original JE-02: posting_status → REVERSED
Payment PAY-202603-0012: status → DISHONOURED
```

**Post-dated cheque handling:**
- When a post-dated cheque is received, create the payment record with `clearance_status = PENDING` and `cheque_date` set to the future date.
- **Do NOT post JE-02 until the cheque clears.** This prevents the bank balance from being overstated.
- On clearance day: set `clearance_status = CLEARED` and then post JE-02 as normal.
- If the cheque bounces before or after deposit: set `clearance_status = BOUNCED` and follow the JE-06 workflow above.

> **Required data model additions for `payments` table:**
> - `status ENUM('RECORDED', 'ALLOCATED', 'ADVANCE', 'DISHONOURED') NOT NULL DEFAULT 'RECORDED'`
> - `cheque_date DATE NULLABLE` — the date written on the cheque
> - `clearance_status ENUM('NA', 'PENDING', 'CLEARED', 'BOUNCED') DEFAULT 'NA'` — for cheque payments only

---

### JE-07: Overpayment — Client Credit Balance

> **NOT IMPLEMENTED (phase/19). Template removed — it had zero callers.**
> Over-allocation is *rejected* rather than split: `PAYMENT_OVER_ALLOCATED` and
> `PAYMENT_EXCEEDS_INVOICE_BALANCE` guard the payment path. A receipt larger
> than the invoice is instead recorded as a normal payment with a partial (or
> no) allocation; the unallocated remainder credits GL AR and is reported as
> `unapplied_credit_pkr` on the AR aging (§5.4). Use JE-03 (advance) when the
> intent is a genuine advance against future work.

**Operational trigger**: Payment received exceeds the outstanding invoice balance; excess becomes a credit.  
**Effect**: Receivable goes to zero; excess posted to Advance Receipts (liability) for future offset

```
DEBIT   1010 / 1020  Cash / Bank                         full_payment_amount
  CREDIT  1110 / 1120  Receivable — [Party Type]    invoice_balance
  CREDIT  2010         Advance Receipts from Clients  overpayment_amount
```

---

### JE-08: Bad Debt Write-Off

**Operational trigger**: Owner decides a receivable is uncollectable (party disappeared, estate insolvent).  
**Role required**: OWNER only  
**Effect**: Expense recognised; asset eliminated

```
DEBIT   6080  Bad Debt Expense           write_off_amount
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]  write_off_amount
```

> A write-off does not close the original invoice — it is marked `WRITTEN_OFF`. If the party later pays (unexpected recovery), a reverse entry is posted: DR Receivable → CR Bad Debt Expense, then a normal payment entry.

---

### JE-09: Spoilage Write-Off (Cold Store Bears Liability)

**Operational trigger**: Spoilage confirmed in M6 AND the cold store accepts liability (e.g., temperature failure caused by power-cut — cold store's fault).  
**Effect**: Expense posted; no revenue impact (no invoice was raised for the spoiled quantity)

```
DEBIT   6150  Spoilage / Damage Compensation Expense    estimated_monetary_loss
  CREDIT  2080  Damage / Spoilage Liability Payable       estimated_monetary_loss
```

> **Natural spoilage (cause = NATURAL_DECAY) where cold store does NOT accept liability**: No journal entry is created. The lot quantity adjustment is the only system action. Both parties accept the loss; the cold store loses potential future revenue but there is no accounting impact today.

> **CRITICAL**: Do NOT post a Credit Note (JE-05) if the cold store uses this accepted liability to "discount" the customer's storage invoice. A Credit Note would reduce revenue, double-counting the loss already recognized in JE-09. Instead, use JE-09B to settle the liability against the receivable.

---

### JE-09B: Damage Liability Settlement Against Receivable

**Operational trigger**: Manager applies a confirmed Damage Liability (from M6) to offset a customer's outstanding storage invoice (M5), effectively settling the dispute without cash changing hands.  
**Effect**: Extinguishes the liability (2080) and reduces the customer's Trade Receivable, without artificially reducing Storage Revenue.

```
DEBIT   2080  Damage / Spoilage Liability Payable       settlement_amount
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]   settlement_amount
```

---

### JE-10: Ownership Transfer — Billing Reassignment

> **No AR-shift entry is posted (phase/19). The template was removed — it had
> zero callers.** The split-billing model below is what is actually built: a
> FULL transfer writes a same-lot TRANSFER_IN event plus a standalone DRAFT
> invoice for the outgoing owner's accrued period (phase/16), and that invoice
> books revenue through the normal **JE-01** on finalize. Nothing moves a
> balance directly between two parties' AR accounts.

**Operational trigger**: Ownership transfer completed in M3. This is a *custodial* event — the cold store does not buy or sell the produce. No revenue is recognized directly from the transfer action.
**Accounting impact**: 
1. The transfer event automatically generates a **DRAFT invoice** for the old owner, covering storage and services up to the transfer date.
2. If the manager finalizes this invoice, **JE-01** fires to book the revenue against the old owner. (If the new owner formally assumes the balance, the old owner's invoice is cleared via JE-04 Advance/Credit offset, and billed to the new owner later).
3. Future storage charges accrue to the new owner starting from the transfer date.

> This alignment — operational system splits billing at transfer date (M3), billing engine computes separate invoices (M5), journal entries follow invoices (JE-01) — means the accounting is derived from operations, not duplicated alongside them.

---

### JE-11: Accrued Revenue (Month-End, Ongoing Storage)

> **DECISION (2026-07-09, docs/16 Gap 4): NOT IMPLEMENTED — deliberately.**
> Revenue is recognized on an invoice basis (JE-01 at invoice finalization,
> typically at withdrawal); no month-end accrual is posted. The JE-11/JE-11R
> template code was removed. Rationale: for a single owner-run facility, every
> revenue number tracing 1:1 to an invoice is worth more than monthly P&L
> smoothness, and an automatic accrue-and-reverse cycle doubles journal volume
> for users who don't read accrual books. The monthly P&L screen carries a
> basis-of-preparation note stating this. Revisit if the facility ever needs
> bank-grade monthly statements during storage season.

**Operational trigger**: Month-end close procedure for lots under `MONTHLY_PER_BAG` or `MONTHLY_PER_KG` rate plans that are still active (not yet dispatched).  
**Effect**: Revenue is earned by passage of time; it should not wait for outbound to be recognised.

```
DEBIT   1110 / 1120 / 1130  Receivable — [Party Type]      accrued_amount
  CREDIT  4010–4050           Storage Revenue — [Commodity]  accrued_amount
```

**Rule for `SEASONAL_PER_BAG`**: Seasonal rates are a flat per-bag fee for the entire season. They are **not accrued monthly**. Instead, they are charged proportionately on each withdrawal (e.g., if a farmer withdraws 100 out of 500 bags, they are invoiced for 100 bags at the seasonal rate via JE-01).

---

### JE-11R: Accrued Revenue Reversal

**Operational trigger**: An invoice is finalized at outbound for a lot that previously had JE-11 accruals posted in prior locked months.
**Effect**: Reverses all prior accruals so that the final JE-01 (which posts the total accumulated invoice amount) does not double-count the revenue.

```
DEBIT   4010–4050           Storage Revenue — [Commodity]  total_prior_accrued
  CREDIT  1110 / 1120 / 1130  Receivable — [Party Type]      total_prior_accrued
```

*(Note: JE-11R fires immediately before JE-01. This "reversal-and-repost" method ensures clean P&L reporting across periods without complex net-adjustments.)*

---

### JE-21: Late Payment Surcharge (implemented phase/19)

**Operational trigger**: A FINALIZED invoice is overdue beyond the facility's
grace period and the owner applies a surcharge (one click on the invoice, or
from the suggestions list). Requires `invoices.manage`.
**Rule**: facility setting `late_payment_surcharge { enabled, pct_per_month, grace_days }`.

```
DEBIT   1110 / 1120 / 1130 / 1150  Receivable — [Party Type]   surcharge_amount
  CREDIT  4210  Late Payment Surcharge                          surcharge_amount
```

Mechanics:
- Ages from `invoice_date` (same basis as the AR aging); whole 30-day blocks
  past `grace_days`, **no pro-rating and no compounding** — each month charges
  `pct_per_month` on the outstanding principal (`total − paid`, surcharges
  excluded; payments are deemed to settle principal first).
- **One posted entry per chargeable month** (`entry_type = ACCRUAL`,
  `source_table = 'invoice_surcharge'`, `source_id = invoice_id`). The count of
  posted entries *is* the months-already-charged tally, which makes re-applying
  inside the same 30-day block a no-op (`SURCHARGE_ALREADY_APPLIED`).
- The surcharge lives **in the general ledger only** — it is not folded into the
  invoice's `balance_due`. It appears on the AR aging and the party statement,
  and is settled by an on-account receipt.
- An erroneous surcharge is corrected with a manual REVERSAL entry; posted
  entries are never edited.

---

### Invoice Void (implemented phase/19, no dedicated template)

**Operational trigger**: An invoice was finalized in error and has not been paid,
credit-noted or surcharged. Requires `invoices.void` (OWNER by default).
**Effect**: A full mirror reversal of the original JE-01 is posted
(`entry_type = REVERSAL`, `source_table = 'invoices'`), the original entry is
marked REVERSED and cross-linked, and the invoice moves to `VOID`. The period
lock is enforced on the reversal date, so voiding an invoice from a closed month
posts the reversal in the open one. Anything already paid or credited must go
through a credit note (JE-05) or a bad-debt write-off (JE-08) instead.

---

## 4. General Ledger Structure

Every journal entry in ColdChain follows this structure:

```
journal_entries
├── header: date, type, reference (invoice/payment ID), description, posting_status
└── lines:  account_code, debit_amount, credit_amount, lot_id (optional), party_id (optional)
```

**Posting status lifecycle:**
```
AUTO_DRAFT → POSTED (on operational event finalization)
           → REVERSED (on credit note / correction)
```

Auto-draft entries are created the moment the operational trigger fires but are only committed to the GL when the operational record is finalized (e.g., invoice moves from DRAFT → FINALIZED). This prevents half-completed transactions from polluting the ledger.

**Immutability**: Posted journal entries cannot be modified or deleted. Corrections are made via reversal entries (debit/credit swapped) plus new correcting entries — always maintaining the audit trail.

> **Naming hazard — "opening balance" means two different things.** Both ship in
> the same API surface, so read the context before trusting the name:
>
> 1. **The go-live entry** — the guided one-shot journal entry with
>    `source_table = 'opening_balances'` (§7.4). Exists only if someone entered it.
> 2. **A period carry-forward** — `opening_balance_pkr` / `opening_debit_pkr` /
>    `opening_credit_pkr` in the general ledger, trial balance and party statement.
>    This is the computed net of everything posted *before* `date_from`, and it
>    exists whether or not (1) was ever entered.

---

## 5. Financial Statement Outputs

The following financial statements are derived directly from the GL — no manual construction.

### 5.1 Trial Balance
- Lists every account with total debits and credits for a period
- Fundamental check: Total Debits = Total Credits (if not equal → data integrity error)
- Run at any time; month-end close locks the period

### 5.2 Profit & Loss Statement

As built (`financial-statements.service.ts` `getProfitLoss`), the statement is
presented IFRS-style over a required `[date_from, date_to]` range:

- Operating revenue (headers 4000 + 4100) **less contra revenue** (4900/4910) = **Net revenue**
- Net revenue less Cost of Services (5000) = **Gross profit**
- Gross profit less Operating expenses (6000) = **Operating profit (EBIT)**
- Plus Other income (4200) = **Net profit / (loss)**
- **EBITDA** = operating profit + depreciation/amortisation add-back (5040, 6120, 6130, 6140)
- Margin percentages are expressed on net revenue and are **null** (rendered "—") when net revenue is zero or negative — a margin has no meaning without a revenue base
- **Unclassified bucket (F-6b):** any detail P&L account that the header rollups could not place is surfaced as its own section, signed as its contribution to net profit, so activity is never silently dropped
- Filterable by: period, book (PACCI default), commodity (using the 4010–4050 breakdown)

**Example ColdChain P&L — Potato Season 2026**
```
REVENUE
  Storage Revenue — Potato          4,200,000
  Storage Revenue — Apple             600,000
  Loading / Unloading Revenue         380,000
  Total Revenue                     5,180,000

COST OF SERVICES
  Electricity — Refrigeration       1,800,000
  Direct Labor                        420,000
  Depreciation — Cold Plant           350,000
  Total Cost of Services            2,570,000

GROSS PROFIT                        2,610,000   (50.4% margin)

OPERATING EXPENSES
  Management Salaries                 480,000
  Maintenance & Repairs               120,000
  Insurance                            60,000
  Other                                80,000
  Total Operating Expenses            740,000

NET PROFIT                          1,870,000
```

### 5.3 Balance Sheet (At a Date)

**Virtual closing (as built).** No closing / year-end journal entries are ever
posted — posted entries are immutable by DB trigger, and a closing entry would
be a fabricated posting. Instead the equity section is *presented* closed:

- `current_year_pl_pkr` covers **only the fiscal year containing `as_of_date`**
  (fiscal year start from the facility setting `fiscal_year_start_month`,
  default 7 = July).
- `prior_years_pl_pkr` = all-time result up to `as_of_date` − current-year result.
- **Retained Earnings** is presented as posted 3020 + `prior_years_pl_pkr`.
- Account 3030 is excluded from `equity_lines` (it is never posted to).

The identity is preserved exactly: `retained + current = posted-3020 + all-time
P&L`, which is what the single pre-phase-19 "Current Year" line summed.

> **The Trial Balance is deliberately pre-closing** — income and expense
> accounts there show cumulative movement for the queried range, with no
> roll-forward into equity. The balance sheet is the only statement that applies
> the virtual closing.

**Bad debts** are a direct write-off to 6080 (JE-08); there is no allowance /
provision account, so no "Less: Allowance for Bad Debt" line exists.

```
ASSETS
  Cash & Bank                         XXX,XXX
  Trade Receivables                 X,XXX,XXX
  Fixed Assets (Net of Depreciation) X,XXX,XXX   ← accum. deprec. nets inside this line
  Total Assets                      X,XXX,XXX

LIABILITIES
  Advance Receipts from Clients       XXX,XXX
  GST Payable                          XX,XXX
  Salaries Payable                     XX,XXX
  Bank Loan                           XXX,XXX
  Total Liabilities                   XXX,XXX

EQUITY
  Owner's Capital                   X,XXX,XXX
  Retained Earnings                   XXX,XXX
  Current Year Profit                 XXX,XXX
  Total Equity                      X,XXX,XXX

Total Liabilities + Equity = Total Assets ✓
```

### 5.4 Accounts Receivable Aging (Sub-ledger Report)

Basis (as built, `reports/receivables-aging.ts`):
- `invoices` where `status = FINALIZED` and `balance_due > 0` (there is **no**
  DISPUTED status in the schema — the enum is DRAFT / FINALIZED / VOID /
  WRITTEN_OFF), bucketed 0–30 / 31–60 / 61–90 / 90+ days from `invoice_date`
- **plus** per-party opening balances (journal lines with `source_table =
  'opening_balances'`), bucketed by the opening entry date
- **plus** late-payment surcharge lines (`source_table = 'invoice_surcharge'`),
  bucketed by their entry date
- **less** unapplied on-account credits: a non-advance, non-dishonoured payment
  that is not fully allocated still credits GL AR for the whole receipt, so its
  unallocated remainder is reported per party as `unapplied_credit_pkr` and
  netted into `net_due_pkr` (which may go negative when a party is in credit).
  Buckets stay gross so the ageing profile is not distorted.

**GL tie-out (not an assumption).** The report returns
`gl_ar_control_total_pkr` — the balance of accounts 1110/1120/1130/1150 (POSTED,
PACCI, up to `as_of_date`) — together with `variance_pkr` (net total − control)
and a `reconciled` flag (|variance| < 0.01). Earlier revisions of this document
asserted the aging "reconciles automatically"; it did not, and nothing checked.
The variance is now surfaced on the report and on the aging screen so a
divergence is visible instead of assumed. Note 1140 (Peshgi) is a separate loan
control and is deliberately excluded.

### 5.5 Revenue by Commodity Report
- Pulls from GL accounts 4010–4050 by date range
- Cross-references with lot data to show: revenue per bag per commodity
- Essential for understanding profitability by commodity and rate plan

---

## 6. Accounting Data Model Additions

These tables are **added to** (not replacements of) the existing `data_model.md`. They are the accounting layer that sits alongside the operational tables.

### New Entity: `chart_of_accounts`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `account_code` | VARCHAR(10) | UNIQUE per facility | e.g., "1110" |
| `account_name` | VARCHAR(200) | NOT NULL | |
| `account_class` | ENUM | NOT NULL | ASSET \| LIABILITY \| EQUITY \| REVENUE \| COST_OF_SERVICE \| EXPENSE |
| `account_type` | ENUM | NOT NULL | HEADER \| DETAIL |
| `parent_account_code` | VARCHAR(10) | NULLABLE | For hierarchy |
| `normal_balance` | ENUM | NOT NULL | DEBIT \| CREDIT |
| `is_system_account` | BOOLEAN | DEFAULT FALSE | System accounts cannot be deleted |
| `is_active` | BOOLEAN | DEFAULT TRUE | |

**Seed data**: The full CoA defined in Section 2 above is seeded on facility creation.  
**System accounts**: 1110, 1120, 1130, 2010, 2020 are `is_system_account = true` — cannot be deleted, renamed only.

---

### New Entity: `journal_entries`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `entry_number` | VARCHAR(20) | UNIQUE per facility | JE-YYYYMM-NNNN |
| `entry_date` | DATE | NOT NULL | Economic date of the event |
| `entry_type` | ENUM | NOT NULL | INVOICE \| PAYMENT \| ADVANCE \| ADVANCE_APPLIED \| CREDIT_NOTE \| ADJUSTMENT \| ACCRUAL \| BAD_DEBT \| REVERSAL \| SPOILAGE \| SPOILAGE_SETTLEMENT \| DEPRECIATION \| ASSET_PURCHASE \| ASSET_DISPOSAL \| PAYROLL \| PAYROLL_PAYMENT \| GOVT_REMITTANCE \| EXPENSE \| PESHGI_ISSUE \| PESHGI_RECOVERY |
| `book_type` | ENUM | NOT NULL DEFAULT 'PACCI' | PACCI \| KATCHI — the dual-ledger flag (see §1) |
| `source_table` | VARCHAR(50) | NOT NULL | See valid values below |
| `source_id` | UUID | NOT NULL | FK to the triggering record |
| `description` | VARCHAR(500) | NOT NULL | Auto-generated description |
| `posting_status` | ENUM | NOT NULL DEFAULT 'AUTO_DRAFT' | AUTO_DRAFT \| POSTED \| REVERSED |
| `period_month` | INT | NOT NULL | Month (1–12) |
| `period_year` | INT | NOT NULL | Year (e.g., 2026)|
| `is_period_locked` | BOOLEAN | DEFAULT FALSE | TRUE after month-end close |
| `reversed_by` | UUID | FK → journal_entries, NULLABLE | If this entry was reversed |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

**Valid `source_table` values:**
| Value | Used By |
|---|---|
| `invoices` | JE-01 (Invoice), JE-04 (Advance Applied) |
| `payments` | JE-02 (Payment), JE-03 (Advance), JE-06 (Cheque Bounce), JE-07 (Overpayment) |
| `credit_notes` | JE-05 (Credit Note) |
| `spoilage_records` | JE-09 (Spoilage), JE-09B (Settlement) |
| `fixed_assets` | JE-12 (Purchase), JE-14 (Disposal) |
| `depreciation_schedules` | JE-13 (Monthly Depreciation) |
| `payroll_runs` | JE-15, JE-15B, JE-16 (Payroll), JE-16B (Govt Remittance) |
| `expense_vouchers` | JE-17A/B/C (Expenses) |
| `party_loans` | JE-18 (Peshgi Issue) |
| `party_loan_repayments` | JE-19 (Peshgi Recovery) |
| `manual` | ADJUSTMENT entries created by Accountant/Owner |

**`book_type` business rules:**
- **PACCI (Official/Formal)**: Once `posting_status = POSTED`, the entry is **immutable**. No UPDATE or DELETE is permitted. Corrections require a REVERSAL entry (JE with swapped debits/credits referencing the original).
- **KATCHI (Internal/Informal)**: OWNER role can soft-delete or modify KATCHI entries. The PostgreSQL `audit_log` trigger still fires on all changes for technical security, but KATCHI reports treat deleted entries as if they never existed.
- **Default**: All system-generated journal entries default to `PACCI`. Only manual entries or entries explicitly flagged by the OWNER at creation time can be `KATCHI`.
- **Filtering**: All financial statements and reports MUST allow filtering by `book_type`. The default view shows `PACCI` only. `KATCHI` view is accessible to OWNER and MANAGER roles only.
- **Source documents**: Invoices, payments, and credit notes should also carry a `book_type` field for consistency with their generated journal entries.

---

### New Entity: `journal_entry_lines`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `journal_entry_id` | UUID | FK → journal_entries | |
| `line_number` | INT | NOT NULL | Sequence within entry |
| `account_code` | VARCHAR(10) | NOT NULL | References chart_of_accounts |
| `debit_amount` | DECIMAL(14,2) | DEFAULT 0 | |
| `credit_amount` | DECIMAL(14,2) | DEFAULT 0 | |
| `party_id` | UUID | FK → parties, NULLABLE | For AR/AP lines — enables party sub-ledger |
| `lot_id` | UUID | FK → lots, NULLABLE | For revenue lines — enables lot-level P&L |
| `description` | VARCHAR(300) | NULLABLE | Line-level narrative |

**Constraint**: For every `journal_entry_id`, `SUM(debit_amount) = SUM(credit_amount)`. Enforced by application service before insert; PostgreSQL trigger as second line of defense.

---

### Additions to Existing Entities

**`service_charges` table** — add column:
- `revenue_account_code` VARCHAR(10) NOT NULL → references `chart_of_accounts.account_code` → drives JE routing

**`rate_plans` table** — add column:
- `revenue_account_code` VARCHAR(10) NOT NULL → references `chart_of_accounts.account_code` → drives JE routing for storage revenue by commodity

**`payments` table** — add column:
- `asset_account_code` VARCHAR(10) NOT NULL → references `chart_of_accounts.account_code` → 1010/1020/1030 based on payment method (default-mapped, overridable)

**`credit_notes`** — new table (extracted from invoice status in original data model):

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | PK |
| `credit_note_number` | VARCHAR(30) | CN-YYYYMM-NNNN |
| `facility_id` | UUID | FK → facilities |
| `original_invoice_id` | UUID | FK → invoices |
| `billing_party_id` | UUID | FK → parties |
| `credit_date` | DATE | NOT NULL |
| `reason` | TEXT | NOT NULL |
| `total_pkr` | DECIMAL(12,2) | NOT NULL |
| `status` | ENUM | ISSUED \| APPLIED \| CANCELLED |
| `created_by` | UUID | FK → users |
| `created_at` | TIMESTAMPTZ | |

---

### Updated Entity Relationship

```
chart_of_accounts ──< journal_entry_lines >── journal_entries
invoice          ──> journal_entries (source)
payment          ──> journal_entries (source)
credit_note      ──> journal_entries (source)
journal_entry_lines.party_id ──> parties  (sub-ledger drill-down)
journal_entry_lines.lot_id   ──> lots     (lot-level revenue attribution)
```

---

## 7. Account Reconciliation Controls

### 7.1 AR Sub-Ledger Reconciliation

Checked **on demand, inside the AR aging report** (there is no daily background
job — earlier revisions of this document described one that was never built):

```
Net receivable per the aging report
  (FINALIZED invoice balances + opening balances + surcharges − unapplied credits)
= GL balance of accounts 1110 + 1120 + 1130 + 1150      ← gl_ar_control_total_pkr
```

The report returns `variance_pkr` and `reconciled` on every call; the aging
screen renders a green "Reconciled" banner or an amber variance warning. A
non-zero variance is expected and explainable in one case: invoices written in
the KATCHI book, since the control total is PACCI-only.

### 7.2 Advance Receipts Reconciliation
```
Sum of unapplied advance payment balances (payment.is_advance = true, not fully applied)
= GL balance of account 2010
```
Not yet automated — verify manually from the general ledger when needed.

### 7.3 Period Locking (Month-End Close)
- At month end, OWNER or ACCOUNTANT can "Lock Period" for a given month/year
- Once locked: no new journal entries can be posted with `entry_date` in that period
- Correction after lock: requires OWNER override; generates a correction entry in the current open period
- Locked periods can still be viewed and reported on — read-only

**As built it is a closed-through watermark, not per-month flags.** The highest
still-locked period closes every period at or below it, including months nobody
explicitly locked. A month below the watermark is open only while it carries an
explicit unlock row (an OWNER-created reopen exception). Enforcement is in
`postInTransaction`, so it covers *every* posted entry in the system.

> **Trap — opening balances.** Opening balances are backdated by nature, so once a
> first month-end close exists, both *entering* and *reversing* them fail with
> `PERIOD_LOCKED` (409) until an OWNER reopens the period. Enter opening balances
> before the first close. The opening-balances screen warns when the chosen as-of
> date falls at or below the watermark.

---

## 8. GST / Sales Tax Handling

### When GST Applies
- Only if the facility is GST-registered (`facilities.gst_number IS NOT NULL`)
- Applied at invoice level; a configurable `gst_rate` per invoice (currently 0% for most stores)
- Standard rate: 17% where applicable; reduced rates apply for some agri commodities

### Journal Entry — GST Component (appended to JE-01)
```
DEBIT   1110 / 1120 / 1130  Receivable — [Party Type]   gst_amount_pkr
  CREDIT  2020                GST Payable — Output Tax     gst_amount_pkr
```

### GST Filing Support
- System generates a "GST Output Tax Summary" report by tax period
- Lists: invoice number, party NTN (if captured), taxable amount, GST amount
- Supporting data only — actual filing is done externally (FBR portal)

---

## 9. Revised M7 Functional Spec — Accounting & Finance Module

**This section replaces the M7 description in `functional_specs.md` in its entirety.**

### Overview
M7 is the accounting backbone of ColdChain. It is not an independent financial module — it is the financial expression of every operational event. Every invoice raised in M5, every payment recorded, every credit note issued, every advance received automatically generates a balanced double-entry journal entry posted to the General Ledger. Accountants do not manually post entries for operational transactions; they only handle exceptional items (manual adjustments, corrections, write-offs).

### Functional Behavior

**General Ledger (GL)**
- Central register of all financial transactions
- Organized by account per the Chart of Accounts in Section 2
- Every account maintains a running balance and period-wise balance
- Filterable by account, period, party, lot

**Chart of Accounts Management**
- Pre-seeded CoA loaded on facility creation (cannot be deleted for system accounts)
- OWNER can: add new accounts, rename non-system accounts, deactivate unused accounts
- Account hierarchy displayed as tree (Header → Detail)
- Accounts can be mapped to commodity/service types for automatic journal routing

**Automatic Journal Entry Generation**
- Triggered by: invoice finalization, payment recording, credit note issuance, advance receipt, advance application, bad debt write-off
- Each trigger maps to a template from Section 3 of this document
- Generated entries are first `AUTO_DRAFT`; they become `POSTED` atomically when the operational record is finalized
- If the operational action fails (e.g., invoice finalization fails validation), the journal entry is rolled back — there are never orphan journal entries

**Manual Journal Entries**
- OWNER and ACCOUNTANT can create manual journals for items outside operational triggers:
  - Depreciation entries (monthly)
  - Salary accruals
  - Electricity bill accrued but not yet paid
  - Correction entries
- Manual entries require: debit/credit lines (balanced), date, description, authorization
- Manual entries go through `AUTO_DRAFT → POSTED` workflow with OWNER approval

**Party Sub-Ledger**
- Every AR journal line carries `party_id`; this enables filtering the GL to show a single party's movements
- Party Statement (report) = filtered GL view for a party for a period
- Reconciles automatically to the AR total on the Balance Sheet

**Financial Statements**
- Trial Balance: any date range
- Profit & Loss Statement: any period; commodity-level revenue breakdown
- Balance Sheet: any date
- AR Aging: reconciled to GL
- Revenue by Commodity: cross-referenced with lot data
- GST Output Summary: by tax period

**Period Locking**
- Month-end close: lock period to prevent backdated entries
- Locked periods are read-only; corrections posted in current period

**Edge Cases**
- Invoice re-opened after payment (cheque bounce): reversal journal auto-generated (JE-06)
- Credit note reduces AR below zero: excess posted to advance liability (2010) — not left as a negative receivable
- Partial payment: allocated to specific invoices; journal entry debits bank for full payment amount, credits AR per allocation amounts
- Backdated invoice (with manager override): journal entry posted with the backdated `entry_date`, not today; period must be unlocked for that month
- Multi-currency (future): Journal entries carry `currency` and `exchange_rate` fields; PKR equivalents used for GL; FX gain/loss account (to be added in Phase 3)

---

## 10. Fixed Asset Register & Depreciation

### 10.1 Why This Is Part of ColdChain Accounting

A cold storage facility's single largest asset is its **refrigeration plant** (compressors, condensers, evaporators). These cost Rs. 5–15 million and last 10–20 years. If depreciation is not recorded monthly:
- The P&L overstates profit (cost of the asset is not charged against revenue)
- The Balance Sheet overstates asset value (shows cost, not net book value)
- The owner cannot make informed decisions on equipment replacement

Depreciation is also the only cost that requires no cash payment — it is a non-cash expense that reduces taxable income, which is directly relevant for income tax purposes in Pakistan.

---

### 10.2 Depreciation Methods Supported

#### Method A: Straight-Line Method (SLM)
Most appropriate for: **Building, civil structures, computers**

```
Annual Depreciation = (Cost − Residual Value) / Useful Life in Years
Monthly Depreciation = Annual Depreciation / 12
```

**Example — Cold Store Building:**
```
Cost:              Rs. 8,000,000
Residual Value:    Rs. 500,000
Useful Life:       30 years
Annual Depr.:      (8,000,000 − 500,000) / 30 = Rs. 250,000/year
Monthly Depr.:     Rs. 250,000 / 12 = Rs. 20,833/month
```

#### Method B: Reducing Balance / Written-Down Value (WDV)
Most appropriate for: **Compressors, refrigeration plant, vehicles**  
Also called: Diminishing Balance Method

```
Annual Depreciation = Net Book Value × Depreciation Rate %
Monthly Depreciation = Annual Depreciation / 12
Net Book Value = Cost − Accumulated Depreciation to date
```

> **Pro-rata rule for mid-year additions**: For the first year (from `depreciation_start_date` to fiscal year end), depreciation is calculated as: `NBV × rate% × (months_in_service / 12)`. Months are counted as whole months; the month of commissioning counts if the asset enters service on or before the 15th of the month.

**Example — Refrigeration Compressor:**
```
Cost:              Rs. 4,500,000
WDV Rate:         20% per annum
Year 1 Depr.:      4,500,000 × 20% = Rs. 900,000/year → Rs. 75,000/month
Year 2 NBV:        4,500,000 − 900,000 = Rs. 3,600,000
Year 2 Depr.:      3,600,000 × 20% = Rs. 720,000/year → Rs. 60,000/month
```
*(Charge reduces every year — realistic for plant that loses value faster when new)*

---

### 10.3 Asset Lifecycle States
```
PLANNED → PURCHASED → IN_SERVICE → DISPOSED / WRITTEN_OFF
```

- **PLANNED**: Budgeted, not yet acquired
- **PURCHASED**: Payment made; asset on books at cost; not yet in service
- **IN_SERVICE**: Depreciating; `depreciation_start_date` set
- **DISPOSED**: Sold or scrapped; disposal journal entry posted; accumulated depreciation cleared

---

### 10.4 Chart of Accounts Additions (Fixed Assets)

Add to CoA (§2) — Class 1 Assets:

| Code | Account Name | Notes |
|---|---|---|
| 1350 | Capital Work in Progress | Assets under construction / installation — not yet depreciating |
| 1360 | Intangible Assets — Software | Purchased software licenses with multi-year life |
| 1361 | Accum. Amortisation — Software | Contra-asset |

Add to CoA — Class 4 Other Income:

| Code | Account Name | Notes |
|---|---|---|
| 4230 | Gain on Disposal of Asset | Proceeds > Net Book Value |

Add to CoA — Class 6 Expenses:

| Code | Account Name | Notes |
|---|---|---|
| 6110 | Loss on Disposal of Asset | Proceeds < Net Book Value |
| 6120 | Depreciation — Building | Monthly SLM charge |
| 6130 | Depreciation — Vehicles | Monthly WDV charge |
| 6140 | Amortisation — Software | Monthly straight-line |

*(Note: Depreciation — Cold Plant already at 5040 as a direct cost. Building/Vehicle depreciation is indirect — Class 6.)*

---

### 10.5 Journal Entry Templates — Fixed Assets

#### JE-12: Asset Purchased (Cash or Bank)

**Trigger**: Accountant records asset purchase in the Fixed Asset Register.

```
DEBIT   1310 / 1320 / 1330 / 1340  Fixed Asset — [Category]   purchase_cost
  CREDIT  1020                        Bank Account — Main         purchase_cost
```

**Example — Compressor purchased for Rs. 4,500,000:**
```
DR  1310  Cold Storage Plant & Equipment   4,500,000
  CR  1020  Bank Account — Main              4,500,000
```

#### JE-13: Monthly Depreciation Charge

**Trigger**: Month-end depreciation run (automated from depreciation schedule).  
**Frequency**: Monthly, for every asset in `IN_SERVICE` status.

For **Cold Plant** (direct cost — affects Gross Profit):
```
DEBIT   5040  Depreciation — Cold Plant    monthly_depr_amount
  CREDIT  1311  Accum. Depr. — Plant & Equipment  monthly_depr_amount
```

For **Building** (indirect cost — affects Net Profit only):
```
DEBIT   6120  Depreciation — Building      monthly_depr_amount
  CREDIT  1321  Accum. Depr. — Building      monthly_depr_amount
```

For **Vehicles**:
```
DEBIT   6130  Depreciation — Vehicles      monthly_depr_amount
  CREDIT  1331  Accum. Depr. — Vehicles      monthly_depr_amount
```

**Example — Month of March 2026, Compressor (WDV 20%, NBV Rs. 4,500,000 at start of year):**
```
DR  5040  Depreciation — Cold Plant        75,000
  CR  1311  Accum. Depr. — Plant             75,000
——————————————————————————————————————————————————
Check: Debits (75,000) = Credits (75,000) ✓
Asset NBV on Balance Sheet: 4,500,000 − 75,000 = 4,425,000
```

#### JE-14: Asset Disposed (Sold)

**Trigger**: Accountant records asset disposal.  
Three sub-cases based on sale proceeds vs. Net Book Value:

**Case A — Sold at book value (no gain/loss):**
```
DEBIT   1020  Bank (proceeds received)        NBV
DEBIT   1311  Accum. Depr. (clear to date)    accum_depr
  CREDIT  1310  Fixed Asset — Cost              full_cost
```

**Case B — Sold above book value (GAIN):**
```
DEBIT   1020  Bank                            sale_proceeds
DEBIT   1311  Accum. Depr.                   accum_depr
  CREDIT  1310  Fixed Asset — Cost              full_cost
  CREDIT  4230  Gain on Disposal of Asset       gain_amount
```

**Case C — Sold below book value (LOSS) or scrapped:**
```
DEBIT   1020  Bank (if any proceeds)          sale_proceeds
DEBIT   1311  Accum. Depr.                   accum_depr
DEBIT   6110  Loss on Disposal of Asset       loss_amount
  CREDIT  1310  Fixed Asset — Cost              full_cost
```

---

### 10.6 Data Model — Fixed Asset Entities

#### New Entity: `fixed_assets`

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
| `notes` | TEXT | NULLABLE | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |
| `created_by` | UUID | FK → users | |

#### New Entity: `depreciation_schedules`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `fixed_asset_id` | UUID | FK → fixed_assets | |
| `period_month` | INT | NOT NULL | 1–12 |
| `period_year` | INT | NOT NULL | |
| `opening_nbv` | DECIMAL(14,2) | NOT NULL | NBV at start of month |
| `depreciation_amount` | DECIMAL(14,2) | NOT NULL | Monthly charge |
| `closing_nbv` | DECIMAL(14,2) | NOT NULL | NBV at end of month |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | Set when JE-13 is posted |
| `status` | ENUM | NOT NULL DEFAULT 'PENDING' | PENDING \| POSTED |

**Business rule**: A `depreciation_schedule` row is generated for every future month when an asset enters `IN_SERVICE`. The month-end close process posts all `PENDING` rows for the closing month as a batch JE-13 run, setting their `status = POSTED`.

---

## 11. Payroll

### 11.1 Staff Types at a Cold Store

A Lahore agri cold store typically operates with two distinct payroll categories:

| Category | Examples | Pay Basis | Payment Frequency |
|---|---|---|---|
| Monthly Salaried | Manager, Accountant, Gate Officer | Fixed monthly | End of month |
| Daily Wage Workers | Loaders, handlers, sorters, cleaners | Per day worked | Weekly or end of month |

Daily wage workers are critical during peak loading/unloading seasons and may be hired ad hoc. Their attendance must be tracked separately from monthly staff.

---

### 11.2 Pakistan-Specific Payroll Elements

| Element | Description | Who Pays |
|---|---|---|
| **Basic Salary** | Fixed gross salary | Employee earns |
| **EOBI Contribution (Employee)** | Employees' Old-Age Benefits Institution — 1% of minimum wage (Rs. 375/month at 2026 rates) | Deducted from employee |
| **EOBI Contribution (Employer)** | 5% of minimum wage per registered employee (Rs. 1,875/month per employee) | Paid by cold store |
| **Income Tax Withholding** | Only applies if annual salary exceeds Rs. 600,000 — most cold store daily workers exempt | Deducted from employee if applicable |
| **Overtime** | If applicable — 2× hourly rate beyond 8 hours | Employee earns |

> For most cold store staff earning below Rs. 50,000/month, income tax withholding is zero. The system records it if applicable but does not enforce FBR tax tables automatically (manual override field for tax amount).

---

### 11.3 Payroll Journal Entry Templates

#### JE-15: Monthly Payroll Run (Salaried Staff)

**Trigger**: Accountant finalizes monthly payroll for management/office staff.  
**Source document**: `payroll_runs` table

```
DEBIT   6010  Salaries — Management & Office        gross_salary_total
DEBIT   6015  Employer EOBI — Management & Office    employer_eobi_total
  CREDIT  2030  Salaries Payable                       net_payable_total
  CREDIT  2060  EOBI Payable — Employee Portion        employee_eobi_total
  CREDIT  2061  EOBI Payable — Employer Portion        employer_eobi_total
  CREDIT  2070  Income Tax Withheld Payable             tax_withheld_total (if > 0)
  CREDIT  1230  Advances to Employees                  advance_recovery_total (if > 0; Phase 21)
```

*(Net Payable = Gross − Employee EOBI − Income Tax Withholding − Advance Recovery)*  
*(Note: Do NOT create journal entry lines with zero amounts. If income tax is zero, omit the CR 2070 line entirely; same rule for the CR 1230 line when no employee has an advance recovery this run.)*
*(Advance recovery is deducted from net pay per employee, pre-filled from that employee's active `employee_advances` instalment and confirmable/editable by the accountant before finalizing — see §12.7. It reduces the 1230 receivable, not a liability; `other_deductions_pkr` remains a separate, currently-unsupported field for anything that is genuinely a third-party deduction rather than an advance recovery.)*

**Example — March 2026, 3 salaried staff:**
```
Manager:     Rs. 45,000 gross
Accountant:  Rs. 35,000 gross
Gate Officer: Rs. 25,000 gross
Total Gross: Rs. 105,000

Employee EOBI (1% of min wage × 3): Rs. 375 × 3 = Rs. 1,125
Employer EOBI (5% of min wage × 3): Rs. 1,875 × 3 = Rs. 5,625
Income Tax: Rs. 0 (all below Rs. 600k threshold) — omit from JE
Net Payable: Rs. 105,000 − Rs. 1,125 = Rs. 103,875

DR  6010  Salaries — Mgmt & Office         105,000
DR  6015  Employer EOBI — Mgmt & Office       5,625
  CR  2030  Salaries Payable                 103,875
  CR  2060  EOBI Payable (Employee)            1,125
  CR  2061  EOBI Payable (Employer)            5,625
——————————————————————————————————————————————————
Check: Debits (110,625) = Credits (110,625) ✓
```

#### JE-15B: Daily Wages Payroll Run

**Trigger**: Accountant finalizes weekly/monthly wages for daily workers.

```
DEBIT   5030  Direct Labor — Loaders & Handlers   total_wages
DEBIT   5035  Employer EOBI — Direct Labor         employer_eobi_total
  CREDIT  2030  Salaries Payable                     net_wages_payable
  CREDIT  2060  EOBI Payable (Employee)               employee_eobi
  CREDIT  2061  EOBI Payable (Employer)               employer_eobi
  CREDIT  2070  Income Tax Withheld Payable           tax_withheld_total (if > 0; Phase 20)
  CREDIT  1230  Advances to Employees                 advance_recovery_total (if > 0; Phase 21)
```

*(Note: Direct Labor posts to account 5030 — a Cost of Service, affecting Gross Profit, unlike salaried management which is 6010 — Operating Expense. Employer EOBI for direct labor posts to 5035 — also a Cost of Service, keeping all direct labor costs in Class 5. Daily-wage staff are equally eligible for salary advances and income-tax withholding as salaried staff; both credit lines follow the same zero-omission rule as JE-15.)*

#### JE-16: Salary Payment (Salaries Payable → Cash/Bank)

**Trigger**: Accountant records payment of salaries via bank transfer or cash.

```
DEBIT   2030  Salaries Payable     amount_paid
  CREDIT  1020  Bank Account — Main   amount_paid
```

*(EOBI and tax liabilities are paid separately to EOBI office / FBR — see JE-16B below)*

#### JE-16B: EOBI / Tax Remittance to Government

**Trigger**: Accountant remits accumulated EOBI contributions to EOBI office and/or withheld income tax to FBR.  
**Frequency**: Monthly (EOBI by 15th of following month; tax per FBR schedule).  
**Source document**: `payroll_runs` aggregate for the period.

```
DEBIT   2060  EOBI Payable — Employee Portion    employee_eobi_total
DEBIT   2061  EOBI Payable — Employer Portion    employer_eobi_total
DEBIT   2070  Income Tax Withheld Payable         tax_total (if > 0)
  CREDIT  1020  Bank Account — Main                total_remittance
```

---

### 11.4 Payroll Data Model Additions

> **Note**: Payroll liability accounts (2060, 2061, 2070) and expense accounts (6015, 5035) are already defined in the master CoA in §2. No additional CoA additions are needed for payroll.

#### New Entity: `employees`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `name` | VARCHAR(200) | NOT NULL | |
| `name_urdu` | VARCHAR(200) | NULLABLE | For salary slip |
| `cnic` | VARCHAR(15) | NULLABLE | National ID |
| `employee_type` | ENUM | NOT NULL | SALARIED \| DAILY_WAGE |
| `designation` | VARCHAR(100) | NULLABLE | e.g., "Manager", "Loader" |
| `join_date` | DATE | NOT NULL | |
| `basic_salary_pkr` | DECIMAL(10,2) | NULLABLE | For SALARIED type |
| `daily_wage_pkr` | DECIMAL(8,2) | NULLABLE | For DAILY_WAGE type |
| `eobi_registered` | BOOLEAN | DEFAULT FALSE | Whether enrolled in EOBI scheme |
| `bank_account_number` | VARCHAR(30) | NULLABLE | For salary transfer |
| `bank_name` | VARCHAR(100) | NULLABLE | |
| `is_active` | BOOLEAN | DEFAULT TRUE | |
| `termination_date` | DATE | NULLABLE | |
| `notes` | TEXT | NULLABLE | |

#### New Entity: `payroll_runs`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `run_number` | VARCHAR(20) | UNIQUE | PAY-YYYYMM-NNN |
| `payroll_type` | ENUM | NOT NULL | MONTHLY_SALARY \| DAILY_WAGES |
| `period_month` | INT | NOT NULL | |
| `period_year` | INT | NOT NULL | |
| `period_from` | DATE | NOT NULL | |
| `period_to` | DATE | NOT NULL | |
| `total_gross_pkr` | DECIMAL(14,2) | NOT NULL | |
| `total_deductions_pkr` | DECIMAL(14,2) | NOT NULL | EOBI employee + income tax |
| `total_employer_eobi_pkr` | DECIMAL(14,2) | NOT NULL DEFAULT 0 | |
| `total_net_payable_pkr` | DECIMAL(14,2) | NOT NULL | |
| `status` | ENUM | NOT NULL DEFAULT 'DRAFT' | DRAFT \| FINALIZED \| PAID |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | Set on finalization |
| `finalized_by` | UUID | FK → users, NULLABLE | |
| `finalized_at` | TIMESTAMPTZ | NULLABLE | |
| `notes` | TEXT | NULLABLE | |

#### New Entity: `payroll_line_items`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `payroll_run_id` | UUID | FK → payroll_runs | |
| `employee_id` | UUID | FK → employees | |
| `days_worked` | DECIMAL(5,2) | NULLABLE | For DAILY_WAGE type |
| `gross_pay_pkr` | DECIMAL(10,2) | NOT NULL | |
| `eobi_employee_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `eobi_employer_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `income_tax_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | |
| `other_deductions_pkr` | DECIMAL(8,2) | NOT NULL DEFAULT 0 | Advances repaid, etc. |
| `net_pay_pkr` | DECIMAL(10,2) | NOT NULL | gross − all deductions |

**Trigger**: On `payroll_runs.status → FINALIZED` → auto-generates JE-15 (or JE-15B for daily wages).  
**Salary Slip**: Printable PDF per employee per payroll run — shows: gross, deductions, net, CNIC, period.

---

## 12. Expense Vouchers (Operational Costs)

### 12.1 What This Covers

Operational costs that are NOT triggered by other system events — electricity bills, maintenance work, fuel, rent, insurance, petty cash spending. These are the Class 5 and Class 6 expenses in the CoA that reduce profit and must be recorded to get an accurate P&L.

Without expense vouchers:
- Electricity bill of Rs. 180,000 is paid from bank but never hits the P&L
- Maintenance of Rs. 15,000 is invisible to the owner's accounting
- The P&L overstates net profit

---

### 12.2 Expense Voucher Types

| Type | Example | CoA Account |
|---|---|---|
| Electricity Bill | LESCO invoice — refrigeration | 5010 or 5020 |
| Maintenance & Repairs | Compressor servicing invoice | 6030 |
| Fuel | Forklift diesel, company vehicle | 6040 |
| Insurance Premium | Annual cold store insurance | 6050 |
| Communication | Monthly internet, mobile | 6060 |
| Petty Cash | Miscellaneous small expenses | 6100 |
| Refrigerant Purchase | Gas refill for compressors | 5050 |
| Packaging Materials | Bags, crates purchased | 5060 |
| Rent | Monthly land/building rent | 6020 |
| Bank Charges | Transaction fees, cheque books | 6090 |

---

### 12.3 Expense Voucher Lifecycle

```
DRAFT → APPROVED (MANAGER+) → PAID → GL POSTED
```

- **DRAFT**: Entered by operator/accountant; awaiting approval
- **APPROVED**: Manager authorizes; amount confirmed
- **PAID**: Payment recorded (cash or bank); journal entry fires
- **GL POSTED**: JE-17 written to GL; period balance updated

---

### 12.4 Journal Entry Templates — Expense Vouchers

#### JE-17A: Expense Paid Immediately (Cash or Bank)

**Trigger**: Expense voucher marked PAID with cash or bank transfer.

```
DEBIT   5XXX / 6XXX  Expense Account   amount_pkr
  CREDIT  1010 / 1020   Cash / Bank       amount_pkr
```

**Example — Electricity bill Rs. 185,000 paid via bank transfer:**
```
DR  5010  Electricity — Refrigeration    155,000
DR  5020  Electricity — Facility (Other)  30,000
  CR  1020  Bank Account — Main           185,000
——————————————————————————————————————————————————
Check: Debits (185,000) = Credits (185,000) ✓
```

#### JE-17B: Expense Accrued (Bill Received, Not Yet Paid)

**Trigger**: Bill received, payment scheduled for later — record the cost now, pay later.  
**Why**: Accrual accounting — expenses belong to the period they are incurred, not when paid.

```
DEBIT   5XXX / 6XXX  Expense Account     amount_pkr
  CREDIT  2040         Utility Bills Payable / Accrued Expenses  amount_pkr
```

**Example — March electricity bill received on 28 March, paid on 5 April:**
```
March 28:
DR  5010  Electricity — Refrigeration    185,000
  CR  2040  Utility Bills Payable          185,000

```
April 5 (payment):
DR  2040  Utility Bills Payable           185,000
  CR  1020  Bank Account — Main           185,000
```
*(Note: This payment on April 5 is formally recorded as **JE-17B-PAY**)*

#### JE-17B-PAY: Payment of Accrued Expense

**Trigger**: An expense voucher that was previously accrued (status = `ACCRUED`, via JE-17B) is now paid via cash or bank (moves to `PAID`).  
**Effect**: Clears the liability that was created by JE-17B. No new expense is recognized.

```
DEBIT   2040  Utility Bills Payable / Accrued Expenses  amount_pkr
  CREDIT  1010 / 1020  Cash / Bank                      amount_pkr
```

**Lifecycle Note**: An accrued expense voucher follows this state transition:
`DRAFT` → `APPROVED` → `ACCRUED` (triggers JE-17B) → `PAID` (triggers JE-17B-PAY).

#### JE-17C: Petty Cash Replenishment

**Pattern**: Petty cash float is maintained at a fixed amount (e.g., Rs. 10,000). When spent, expenses are posted to individual accounts; float is replenished from bank.

**Step 1 — Record petty cash expenses (from petty cash vouchers):**
```
DEBIT   6040  Fuel & Vehicle              2,500
DEBIT   6100  Miscellaneous               1,200
DEBIT   6060  Communication                 800
  CREDIT  1010  Cash on Hand               4,500   (petty cash spent)
```

**Step 2 — Replenish float from bank:**
```
DEBIT   1010  Cash on Hand               4,500
  CREDIT  1020  Bank Account              4,500
```

---

### 12.5 Expense Voucher Data Model

#### New Entity: `expense_vouchers`

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | UUID | PK | |
| `facility_id` | UUID | FK → facilities | |
| `voucher_number` | VARCHAR(20) | UNIQUE | EXP-YYYYMM-NNNN |
| `voucher_date` | DATE | NOT NULL | Date of expense / bill |
| `payment_date` | DATE | NULLABLE | When actually paid |
| `expense_account_code` | VARCHAR(10) | NOT NULL | Main expense account (5XXX/6XXX) |
| `description` | VARCHAR(500) | NOT NULL | What the expense is for |
| `vendor_name` | VARCHAR(200) | NULLABLE | Supplier / utility company |
| `reference_number` | VARCHAR(100) | NULLABLE | Bill number, invoice number |
| `amount_pkr` | DECIMAL(12,2) | NOT NULL | |
| `payment_method` | ENUM | NULLABLE | CASH \| CHEQUE \| BANK_TRANSFER |
| `asset_account_code` | VARCHAR(10) | NULLABLE | 1010/1020 — which cash/bank was used |
| `is_accrual` | BOOLEAN | DEFAULT FALSE | TRUE if bill received, not yet paid |
| `status` | ENUM | NOT NULL DEFAULT 'DRAFT' | DRAFT \| APPROVED \| PAID \| CANCELLED |
| `journal_entry_id` | UUID | FK → journal_entries, NULLABLE | Set on payment |
| `receipt_url` | VARCHAR(500) | NULLABLE | S3 URL of uploaded bill scan |
| `approved_by` | UUID | FK → users, NULLABLE | |
| `approved_at` | TIMESTAMPTZ | NULLABLE | |
| `created_by` | UUID | FK → users | |
| `created_at` | TIMESTAMPTZ | NOT NULL | |

**Trigger**: On `expense_vouchers.status → PAID` → auto-generates JE-17A.  
**Receipt Upload**: Bill scan uploaded to S3 — operators photograph the LESCO/SNGPL bill and attach it before submitting for approval.

---

## 12.6 Peshgi (Informal Loans) Operations

Cold store owners often act as financiers, lending cash (*Peshgi*) to farmers during the growing season to secure their produce for storage. This is maintained strictly separate from the AR (Storage bills) ledger.

### JE-18: Peshgi Issued (Advance to Farmer)

**Operational trigger**: Owner issues a cash or bank loan to a party.  
**Source document**: `party_loans` table

```
DEBIT   1140  Receivable — Peshgi (Loans)    amount_pkr
  CREDIT  1010  Cash on Hand                   amount_pkr
```

### JE-19: Peshgi Recovered

**Operational trigger**: Repayment collected (via cash/bank or deducted from lot final settlement).  
**Source document**: `party_loan_repayments` table

```
DEBIT   1010 / 1020  Cash / Bank Account             amount_pkr
  CREDIT  1140       Receivable — Peshgi (Loans)     amount_pkr
```

---

## 12.7 Employee Advances (Phase 21)

Three accounting audits (docs/16, /17, /18) flagged salary advances as absent: no model, no account, no endpoint, no screen. `payroll_line_items.other_deductions_pkr` — documented elsewhere as "Advances repaid, etc." — was the only candidate hook, and Phase 20 made it reject rather than post: crediting a *liability* for an advance recovery would leave the employee's receivable standing while inventing an obligation, and the entry would still balance, so no invariant would catch it. This section is the receivable that makes recovery correct, kept **strictly separate from the AR (storage bills) ledger and from Peshgi**, mirroring the separation §12.6 already establishes for farmer loans.

### JE-22: Employee Advance Issued

**Operational trigger**: Owner issues a cash advance against an employee's future salary.
**Source document**: `employee_advances` table

```
DEBIT   1230  Advances to Employees          principal_pkr
  CREDIT  1010 / 1020  Cash / Bank Account      principal_pkr
```

**Limits, enforced at issue**: one ACTIVE advance per employee (a second attempt while a balance is outstanding is rejected), and the principal cannot exceed the employee's own one-month pay — basic salary for SALARIED staff, `daily_wage_pkr × 26` for DAILY_WAGE staff, the same 26-working-day figure payroll already uses when snapshotting a wage line. Both SALARIED and DAILY_WAGE employees are eligible.

### Recovery — no journal entry of its own

Recovery does not post a standalone entry. It rides inside that period's payroll entry (JE-15 or JE-15B, §11.3) as one more credit line to 1230, alongside the EOBI/tax credit lines already there:

```
  CREDIT  1230  Advances to Employees          advance_recovery_pkr (if > 0)
```

**Mechanism — auto-suggest, accountant confirms.** When a payroll draft is created, each employee's line is pre-filled with `min(monthly_installment, balance_outstanding)` from their ACTIVE advance, if one exists. The accountant may edit the figure (including down to zero, to skip a month) before finalizing; any edit is validated against the advance's live outstanding balance, not the pre-filled figure. On finalize, one `employee_advance_recoveries` row is written per line that carried a non-zero recovery, the advance's `balance_outstanding_pkr` is decremented, and the advance closes to `RECOVERED` once it reaches zero.

**Reversing the payroll run unwinds the recovery.** If a finalized run is later reversed (`PayrollRunStatus.REVERSED`, added in Phase 20 — see docs/18), each recovery row it created is soft-voided and the corresponding advance balance is restored — otherwise the balance would stay reduced while the payroll that reduced it had been undone. A `WRITTEN_OFF` advance is never reverted back to `ACTIVE` by this — that is a separate OWNER decision write-off (below) makes, and reversal must not silently undo it.

### JE-23: Employee Advance Written Off

**Operational trigger**: OWNER writes off an advance's remaining balance as bad debt — typically an employee who has left with an unrecovered amount the final payroll run could not fully cover.
**Source document**: `employee_advances` table

```
DEBIT   6080  Bad Debt Expense               balance_outstanding_pkr
  CREDIT  1230  Advances to Employees          balance_outstanding_pkr
```

Mirrors JE-20 (Peshgi write-off) exactly, substituting 1230 for 1140.

**Leaver settlement has no separate flow.** Terminating an employee (`employees.terminate`) posts nothing and does not touch any advance; it only flips the employee to inactive. The employee's final payroll run recovers what it can like any other month, and whatever remains outstanding afterward is the write-off case above. The employee-detail screen surfaces the outstanding balance at termination time precisely because nothing else will.

---

## 13. Updated P&L — With All Cost Modules

With Fixed Assets (§10), Payroll (§11), and Expense Vouchers (§12) all feeding into the GL, the P&L now shows a fully loaded picture:

```
REVENUE
  Storage Revenue — Potato                  4,200,000
  Storage Revenue — Apple                     600,000
  Service Revenue (Loading/Grading etc.)      380,000
  ────────────────────────────────────────────────────
  Total Revenue                              5,180,000

COST OF SERVICES (Direct)
  Electricity — Refrigeration               1,800,000   ← JE-17
  Direct Labor — Loaders & Handlers           420,000   ← JE-15B
  Employer EOBI — Direct Labor                  9,000   ← JE-15B
  Depreciation — Cold Plant                   350,000   ← JE-13
  Refrigerant & Consumables                    45,000   ← JE-17
  Packaging & Materials                        30,000   ← JE-17
  ────────────────────────────────────────────────────
  Total Cost of Services                     2,654,000
  ────────────────────────────────────────────────────
  GROSS PROFIT                               2,526,000   (48.8% margin)

OPERATING EXPENSES (Indirect)
  Salaries — Management & Office              480,000   ← JE-15
  Employer EOBI — Mgmt & Office                22,500   ← JE-15
  Maintenance & Repairs                        95,000   ← JE-17
  Electricity — Facility (Non-Refrig.)         75,000   ← JE-17
  Depreciation — Building                      62,500   ← JE-13
  Depreciation — Vehicles                      40,000   ← JE-13
  Insurance                                    60,000   ← JE-17
  Fuel & Vehicle                               28,000   ← JE-17
  Communication                                18,000   ← JE-17
  Bank Charges                                  8,000   ← JE-17
  Miscellaneous Petty Cash                     12,000   ← JE-17
  ────────────────────────────────────────────────────
  Total Operating Expenses                     901,000
  ────────────────────────────────────────────────────
  NET PROFIT                                 1,625,000   (31.4% net margin)
```

Every line in the above P&L is sourced from a journal entry in the GL. No manual tallying.

---

## 14. System Module Summary — Full Accounting Coverage

| Accounting Area | Triggered By | Journal Entry | Module | Accounts Affected |
|---|---|---|---|---|
| Storage Revenue | Invoice finalized | JE-01 | M5 + M7 | DR 1110-1130, CR 4010-4150, CR 2020 |
| Client Payment | Payment recorded | JE-02 | M7 | DR 1010/1020/1030, CR 1110-1130 |
| Advance Received | Advance payment | JE-03 | M7 | DR 1010/1020/1030, CR 2010 |
| Advance Applied | Invoice with advance offset | JE-04 | M7 | DR 2010, CR 1110-1130 |
| Credit Note | Dispute resolved | JE-05 | M5 + M7 | DR 4010-4150, CR 1110-1130 |
| Cheque Bounce | Payment dishonoured | JE-06 | M7 | DR 1110-1130, CR 1020 |
| Overpayment | Payment exceeds balance | JE-07 | M7 | DR 1010/1020, CR 1110-1130 + 2010 |
| Bad Debt | Owner write-off | JE-08 | M7 | DR 6080, CR 1110-1130 |
| Spoilage Liability | Cold store at fault | JE-09 | M6 | DR 6150, CR 2080 |
| Spoilage Settlement | Liability offset vs AR | JE-09B | M6 | DR 2080, CR 1110-1130 |
| Revenue Accrual | Month-end close | JE-11 | M7 | DR 1110-1130, CR 4010-4050 |
| Accrual Reversal | Invoice finalized | JE-11R | M7 | DR 4010-4050, CR 1110-1130 |
| Asset Purchase | FA Register entry | JE-12 | Fixed Assets | DR 1310-1340, CR 1020 |
| Depreciation | Month-end close | JE-13 | Fixed Assets | DR 5040/6120-6140, CR 1311-1341 |
| Asset Disposal | FA Register closure | JE-14 | Fixed Assets | DR 1020 + 1311, CR 1310 (±4230/6110) |
| Payroll — Salary | Payroll run finalized | JE-15 | Payroll | DR 6010 + 6015, CR 2030/2060/2061/2070 |
| Payroll — Wages | Payroll run finalized | JE-15B | Payroll | DR 5030 + 5035, CR 2030/2060/2061 |
| Salary Payment | Bank transfer | JE-16 | Payroll | DR 2030, CR 1020 |
| Govt Remittance | EOBI/Tax paid | JE-16B | Payroll | DR 2060/2061/2070, CR 1020 |
| Expense — Direct | Voucher paid | JE-17A | Expenses | DR 5XXX/6XXX, CR 1010/1020 |
| Expense — Accrued | Bill received | JE-17B | Expenses | DR 5XXX/6XXX, CR 2040 |
| Petty Cash Replenish | Float replenished | JE-17C | Expenses | DR 1010, CR 1020 |
| Peshgi Issued | Advance granted | JE-18 | Peshgi | DR 1140, CR 1010/1020 |
| Peshgi Recovered | Advance repaid | JE-19 | Peshgi | DR 1010/1020, CR 1140 |

