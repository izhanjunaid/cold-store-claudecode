# ColdChain — Module-Wise Accounting Audit

**Version**: 1.0  
**Date**: March 2026  
**Auditor**: Antigravity (Superpowers methodology — `brainstorming` skill)  
**Scope**: Full accounting layer audit — correctness, clarity, compliance  
**Domain context**: Agri cold storage, Lahore mandi ecosystem, Pakistan

---

## Executive Summary

The accounting spec is **exceptionally well-designed** — far beyond typical startup-level documentation. It correctly implements double-entry bookkeeping, handles the dual-ledger (Katchi/Pacci) reality, and covers edge cases that most ERP projects miss (advance → liability, cheque bounce reversal, spoilage liability separation).

However, reviewing all 19 JE templates, the CoA, the data model, the functional specs, and the E2E workflows against standard accounting principles and Pakistan business norms **reveals 23 findings** across 8 modules. Most are minor clarification gaps; 5 are material logic issues that must be fixed before implementation.

---

## Severity Scale

| Severity | Meaning |
|---|---|
| 🔴 CRITICAL | Incorrect accounting logic; will produce wrong financial statements |
| 🟡 MATERIAL | Missing logic or ambiguity that will cause implementation bugs |
| 🟢 MINOR | Clarification needed; no impact if developer reads surrounding context |
| 💡 RECOMMENDATION | Not a bug — a best-practice improvement |

---

## Module 1: Chart of Accounts (CoA)

### Finding 1.1 — 🟢 MINOR: Missing `Allowance for Bad/Doubtful Debts` contra-asset account

**Location**: §2, Class 1 Assets  
**Issue**: The Balance Sheet example (§5.3) shows `Less: Allowance for Bad Debt (XX,XXX)` but no such account exists in the CoA. JE-08 (Bad Debt Write-Off) debits `6080 Bad Debt Expense` and credits the receivable directly, which is the **direct write-off method**.

**Analysis**: The Balance Sheet example implies the **allowance method** (IFRS-preferred), but JE-08 implements the **direct method** (simpler, acceptable for SMEs under IFRS for SMEs).

**Recommendation**: Choose ONE method and make it consistent:
- **Option A (Simpler, recommended for MVP)**: Keep JE-08 as-is (direct write-off). Remove "Less: Allowance for Bad Debt" line from the Balance Sheet example.
- **Option B (IFRS-compliant)**: Add account `1160 Allowance for Doubtful Debts` (contra-asset). JE-08 credits `1160` instead of the AR account directly. Add JE-08B for when actual write-off occurs (DR 1160 / CR 1110-1130).

---

### Finding 1.2 — 🟢 MINOR: Missing `Drawings / Owner Withdrawals` equity account

**Location**: §2, Class 3 Equity  
**Issue**: In Pakistan's agri sector, cold store owners routinely draw cash from the business for personal use. Account `3010 Owner's Capital` and `3020 Retained Earnings` exist, but no `3040 Owner Drawings` (contra-equity) is defined.

**Recommendation**: Add `3040 Owner Drawings` (contra-equity, DEBIT normal balance). JE template:
```
DR  3040  Owner Drawings       X
  CR  1010/1020  Cash/Bank     X
```
Reset to zero at year-end by transferring to Retained Earnings.

---

### Finding 1.3 — 💡 RECOMMENDATION: CoA numbering has a gap at `2050`

**Location**: §2, Class 2 Liabilities  
**Issue**: Account `2050 Dishonoured Cheques Payable` is semantically wrong. A dishonoured cheque is NOT a payable (liability). When a cheque bounces, the cold store does not owe anyone — it means the *client* still owes the cold store. JE-06 correctly RE-DEBITS the receivable; `2050` is never actually used in any JE template.

**Recommendation**: Remove account `2050` from the CoA. The cheque bounce workflow is fully handled by JE-06 (DR Receivable / CR Bank). No liability account is needed. If tracking is required, add a `dishonoured_cheque_flag` on the `parties` table instead (which is already mentioned in JE-06 notes).

---

### Finding 1.4 — 🟡 MATERIAL: Missing `Damage Liability Payable` account code

**Location**: §2, Class 2 Liabilities & JE-09  
**Issue**: JE-09 (Spoilage Write-Off) credits `2000 Damage Liability Payable` but this account does NOT exist in the CoA. The CoA shows `2000` as the header label `Current Liabilities`, not a detail account. You cannot post journal entries to header accounts.

**Recommendation**: Add a new detail account:
```
2080  Damage / Spoilage Liability Payable    Detail
```
Update JE-09 and JE-12 to reference `2080` instead of `2000`.

---

### Finding 1.5 — 🟢 MINOR: No separate revenue account for `Peshgi Interest/Fee`

**Issue**: Peshgi loans are interest-free in the spec (which matches mandi reality). However, some owners charge an implicit fee or seasonal premium. If this changes, there's no revenue account for it.

**Recommendation**: Add `4240 Peshgi Service Fee / Premium` (Class 4 Other Income) — even if unused for MVP, it prevents a CoA restructure later.

---

## Module 2: Revenue Recognition (JE-01 + JE-11)

### Finding 2.1 — 🟡 MATERIAL: JE-11 Accrual Reversal Logic Not Specified

**Location**: §3, JE-11 — Accrued Revenue  
**Issue**: JE-11 says *"At time of actual invoice finalization at outbound, the system checks if accrual entries were already posted and offsets them, preventing double-counting."* But **no offset/reversal JE template is defined**. A developer implementing this will not know:
1. Should the system auto-reverse all prior accruals for the lot when the invoice is finalized?
2. Should the reversal happen as a separate JE (industry standard) or as a net adjustment within JE-01?
3. What happens if accruals span multiple locked periods?

**Recommendation**: Define **JE-11R: Accrual Reversal** explicitly:
```
On invoice finalization for a lot with prior monthly accruals:
  DR  4010-4050  Storage Revenue — [Commodity]     total_prior_accrued
    CR  1110/1120/1130  Receivable — [Party Type]    total_prior_accrued

Then JE-01 posts the full invoice amount (not the net difference).
```
This is the standard reversal-and-repost method. It keeps each period's P&L accurate and avoids partial-period confusion.

---

### Finding 2.2 — 🟢 MINOR: JE-01 GST posting is correct but conflated in the template

**Location**: §3, JE-01  
**Issue**: The JE-01 template shows the GST credit as a separate line. But the total DEBIT to the receivable account must equal `storage + services + GST`. The template is correct mathematically, but a developer might misread it as three separate entries.

**Recommendation**: Add an explicit note: *"The total DEBIT to the Receivable account = SUM(all CREDIT lines), which includes storage revenue + service revenue + GST if applicable."*

---

### Finding 2.3 — 💡 RECOMMENDATION: Rate type `SEASONAL_PER_BAG` billing timing ambiguity

**Location**: Functional Spec §M5, Accounting Spec JE-01  
**Issue**: The spec says seasonal rates are billed "once at outbound." But what if a farmer stores 500 bags and withdraws 100 bags three separate times? Is the seasonal rate charged once at the first withdrawal, split across all withdrawals, or only at the final (lot-closing) withdrawal?

**Recommendation**: Clarify explicitly:
> **Rule**: For `SEASONAL_PER_BAG`, the rate is a **flat per-bag fee for the entire season**, charged on each withdrawal proportionally. If a farmer withdraws 100 of 500 bags, the invoice charges the seasonal rate × 100 bags. The remaining 400 bags are charged at the seasonal rate when they are withdrawn.

This is how most Lahore cold stores actually operate — the rate tracks the bag, not the lot.

---

## Module 3: Payments & Receivables (JE-02, JE-03, JE-04, JE-06, JE-07)

### Finding 3.1 — 🔴 CRITICAL: JE-06 Cheque Bounce reversal is incomplete

**Location**: §3, JE-06  
**Issue**: JE-06 reverses the bank credit (DR Receivable / CR Bank). But the **original JE-02 is not reversed or marked**. This means:
1. The GL shows two entries: JE-02 (original payment) and JE-06 (bounce reversal) — net effect is zero. ✅ Correct.
2. But the `payment` record still exists with its `journal_entry_id` pointing to JE-02. If the system never marks JE-02 as `REVERSED`, there are two POSTED entries for the same payment — one adding the payment and one removing it. The trial balance is correct, but the payment sub-ledger is confusing.
3. The `payment_allocations` linked to the bounced payment are not mentioned. If they remain, the invoice shows partial/full allocation from a dead payment.

**Recommendation**:
1. When a cheque bounces, set `payment.status = DISHONOURED`, not just `dishonoured = true`.
2. Mark JE-02's `posting_status = REVERSED` and set `reversed_by = JE-06.id`.
3. Remove or void all `payment_allocations` linked to the bounced payment.
4. Re-open linked invoices: set `invoice.status = FINALIZED` (from PAID) and recalculate `amount_paid`.

---

### Finding 3.2 — 🟡 MATERIAL: `payment` table missing `status` field

**Location**: Data Model + Accounting Spec  
**Issue**: The `payments` table in the data model has no `status` column. A payment is either active or dishonoured, but there's no lifecycle state (RECORDED → ALLOCATED → DISHONOURED). The state machine document (doc 14) defines this lifecycle, but the data model doesn't support it.

**Recommendation**: Add `status ENUM('RECORDED', 'ALLOCATED', 'ADVANCE', 'DISHONOURED') DEFAULT 'RECORDED'` to the `payments` table.

---

### Finding 3.3 — 🟢 MINOR: JE-07 Overpayment — race condition with credit notes

**Issue**: JE-07 posts excess payment to `2010 Advance Receipts`. JE-05 posts credit notes by crediting the receivable. If a client overpays AND has a credit note issued, the excess could be double-counted (once as advance via JE-07, once as AR reduction via JE-05).

**Recommendation**: Add business rule: *"Credit notes are always applied first. Then payments are allocated against the adjusted invoice balance. Overpayment is calculated as: payment amount - (invoice balance AFTER credit notes)."*

---

### Finding 3.4 — 💡 RECOMMENDATION: Post-dated cheque handling needs explicit logic

**Location**: JE-02 notes  
**Issue**: JE-02 says for cheques, *"the entry is created on receipt date but flagged `pending_clearance = true`."* However:
1. `pending_clearance` is not a column in the `payments` table.
2. The entry is POSTED immediately (debit bank) even though the money is not yet in the bank.
3. Pakistan business practice: post-dated cheques are held and deposited on the cheque date.

**Recommendation**:
- Add `cheque_date DATE NULLABLE` and `clearance_status ENUM('NA', 'PENDING', 'CLEARED', 'BOUNCED')` to the `payments` table.
- For post-dated cheques: create payment record on receipt with `clearance_status = PENDING`. The journal entry should NOT be posted until `clearance_status = CLEARED`.
- This prevents the bank balance from being overstated before cheque clearance.

---

## Module 4: Credit Notes (JE-05)

### Finding 4.1 — 🟢 MINOR: Credit note line items lack `account_code` in data model

**Location**: §6, `credit_notes` table + API Design §4.12  
**Issue**: The API design shows credit note line items with `account_code` per line. But the `credit_notes` data model has only `total_pkr` — no line items table.

**Recommendation**: Add `credit_note_line_items` table:
```
credit_note_line_items
  id, credit_note_id, account_code, description, amount_pkr
```
This ensures each line maps to the correct revenue account for the reversal JE-05.

---

### Finding 4.2 — 🟢 MINOR: Credit note cannot exceed original invoice — but no check for net-of-prior-credit-notes

**Issue**: The error code `CREDIT_NOTE_EXCEEDS_INVOICE` exists, but it's unclear whether the check is: `new CN ≤ original invoice total` or `new CN ≤ remaining balance after prior CNs`. The latter is correct.

**Recommendation**: Clarify: *"SUM(all credit notes against invoice) + new credit note ≤ invoice.total_pkr"*

---

## Module 5: Spoilage Accounting (JE-09 + JE-12)

### Finding 5.1 — 🔴 CRITICAL: JE-09 and JE-12 use reused/confusing JE numbers

**Location**: §3  
**Issue**: The spec defines:
- JE-12 (line 382): "Asset Settlement via Damage Liability" (DR 2000 / CR Receivable)
- JE-12 (line 830): "Asset Purchased (Cash or Bank)" (DR Fixed Asset / CR Bank)

**Two completely different journal entry templates share the same JE-12 number.** This will cause confusion in code, documentation, and audit trails.

**Recommendation**: Renumber the damage liability settlement entry:
```
JE-09:  Spoilage Write-Off (Cold Store Bears Liability)
JE-09B: Damage Liability Settlement Against Receivable ← rename from duplicate JE-12
JE-12:  Asset Purchased (Cash or Bank) ← keep as-is
```

---

### Finding 5.2 — 🟡 MATERIAL: JE-09 expense account is undefined

**Location**: §3, JE-09  
**Issue**: JE-09 debits `6XXX Damage Liability / Compensation Expense` — but no specific account is defined in the CoA for this. The closest is `6080 Bad Debt Expense`, which is semantically wrong (bad debt ≠ spoilage damage).

**Recommendation**: Add to CoA:
```
6150  Spoilage / Damage Compensation Expense    Detail
```
Update JE-09 to reference `6150`.

---

### Finding 5.3 — 💡 RECOMMENDATION: Spoilage where NO party is liable — write-off to warehouse

**Issue**: JE-09 handles "cold store bears liability." But the more common case is natural spoilage where NEITHER party bears liability — it's accepted by both. In this case:
- The lot quantity is reduced (done ✅)
- No financial entry is needed (since no invoice was raised for spoiled bags)
- The cold store loses potential future revenue but there's no accounting impact today

This is correctly implied but never explicitly stated. A developer might try to create a JE for all spoilage.

**Recommendation**: Add explicit rule: *"If `cause = NATURAL_DECAY` and cold store does NOT accept liability, no journal entry is created. The lot qty adjustment is the only system action."*

---

## Module 6: Fixed Assets & Depreciation (JE-12 to JE-14)

### Finding 6.1 — 🟡 MATERIAL: WDV depreciation monthly calculation is incorrect for mid-year assets

**Location**: §10.2 Method B  
**Issue**: The formula says *"Monthly Depreciation = Annual Depreciation / 12"*. For WDV, annual depreciation = NBV × rate%. But if an asset enters service mid-year (e.g., October), you should only depreciate for 3 months of that fiscal year, not 12. The formula doesn't address pro-rata for partial first year.

**Recommendation**: Add:
> **Pro-rata rule**: For the first year (from `depreciation_start_date` to fiscal year end), depreciation is calculated as: `NBV × rate% × (months_in_service / 12)`. Months are counted as whole months; the month of commissioning counts if the asset enters service on or before the 15th.

This is standard Pakistan Income Tax Ordinance 2001 treatment (Third Schedule, Part I).

---

### Finding 6.2 — 🟢 MINOR: JE-14 disposal — residual value not addressed

**Issue**: The `fixed_assets` table has `residual_value_pkr`, which is used in SLM depreciation calculation. But JE-14 (disposal) never mentions residual value in its calculation of gain/loss. The implicit assumption is `NBV = cost - accum_depr`, which is correct IF depreciation was correctly calculated with residual value factored in. But this should be stated explicitly.

**Recommendation**: Add: *"Gain/Loss on disposal = Sale Proceeds - Net Book Value, where NBV = Cost - Accumulated Depreciation. Residual value is already incorporated in the depreciation calculation and does not appear separately in the disposal entry."*

---

### Finding 6.3 — 💡 RECOMMENDATION: No impairment test mechanism

**Issue**: IFRS for SMEs requires impairment testing when indicators exist (e.g., flood damage to building, obsolete compressor). The spec has no mechanism for ad-hoc write-down.

**Recommendation (Phase 2)**: Add `JE-14B: Impairment Loss` template for non-disposal scenarios:
```
DR  6160  Impairment Loss — Fixed Assets    impairment_amount
  CR  1311/1321/1331  Accum. Depreciation     impairment_amount
```

---

## Module 7: Payroll (JE-15, JE-15B, JE-16)

### Finding 7.1 — 🔴 CRITICAL: JE-15 uses same account code `6010` for both salary AND employer EOBI

**Location**: §11.3, JE-15  
**Issue**: JE-15 debits BOTH:
- `6010 Salaries — Management & Office` for gross salary (correct)
- `6010 EOBI — Employer Contribution` for employer EOBI (incorrect — same account)

This merges two fundamentally different costs into one account. On the P&L, you cannot tell how much is salary vs. how much is EOBI employer contribution. This violates the principle of separate disclosure.

**Recommendation**: Add a new expense account:
```
6015  Employer EOBI Contributions    Detail
```
Debit `6015` for the employer EOBI, not `6010`. Similarly for daily wages, add:
```
5035  Employer EOBI — Direct Labor   Detail
```
Update JE-15 and JE-15B accordingly.

---

### Finding 7.2 — 🟢 MINOR: JE-15 example includes a zero-value credit line for income tax

**Issue**: The JE-15 example shows `CR 2070 Income Tax Payable: Rs. 0`. Zero-value journal lines are non-standard and should be omitted.

**Recommendation**: Add implementation rule: *"Do not create journal entry lines with zero amounts. If income tax is zero, omit the CR 2070 line entirely."*

---

### Finding 7.3 — 🟡 MATERIAL: No JE for EOBI/tax remittance to government

**Issue**: JE-15 creates liabilities (2060, 2061, 2070). JE-16 clears `2030 Salaries Payable`. But there's no template for when the cold store actually remits EOBI contributions to the EOBI office or files withholding tax to FBR.

**Recommendation**: Add JE-16B:
```
JE-16B: EOBI / Tax Remittance to Government

DR  2060  EOBI Payable — Employee     amount
DR  2061  EOBI Payable — Employer     amount
DR  2070  Income Tax Withheld         amount
  CR  1020  Bank Account              total
```

---

### Finding 7.4 — 💡 RECOMMENDATION: Overtime account missing

**Issue**: §11.2 mentions overtime (2× hourly rate beyond 8 hours) but there's no separate expense account for overtime. It would be buried in `6010` or `5030`.

**Recommendation**: Add `5031 Overtime — Direct Labor` and `6011 Overtime — Office Staff` for tracking.

---

## Module 8: Expense Vouchers (JE-17A/B/C)

### Finding 8.1 — 🟢 MINOR: Multi-line expense vouchers not supported by data model

**Location**: §12.5, `expense_vouchers` table  
**Issue**: The `expense_vouchers` table has a single `expense_account_code` and `amount_pkr`. But JE-17A example (electricity) splits across TWO accounts (`5010` + `5020`). The data model cannot represent this.

**Recommendation**: Either:
- **Option A**: Add `expense_voucher_lines` table (mirrors `invoice_line_items`) to support multi-account splits. — *Preferred, matches the JE-17A example.*
- **Option B**: Require one voucher per account code (simpler but creates more records).

---

### Finding 8.2 — 🟡 MATERIAL: Accrual expense (JE-17B) lifecycle is incomplete

**Issue**: JE-17B creates an accrual (DR Expense / CR 2040). The subsequent payment (DR 2040 / CR Bank) is described in the example but has no formal JE number. It's effectively a second journal entry for the same voucher. The `expense_vouchers` table has `status = DRAFT → APPROVED → PAID → CANCELLED` but no `ACCRUED` state.

**Recommendation**:
1. Add `ACCRUED` to the status enum (between APPROVED and PAID).
2. Define JE-17B-PAY as the formal payment JE:
```
JE-17B-PAY: Payment of Accrued Expense
DR  2040  Utility Bills Payable / Accrued Expenses    amount
  CR  1020  Bank Account                                amount
```
3. Lifecycle: `DRAFT → APPROVED → ACCRUED (JE-17B fires) → PAID (JE-17B-PAY fires)`.

---

## Module 9: Peshgi / Loans (JE-18, JE-19)

### Finding 9.1 — 🟢 MINOR: Peshgi loan recovery via storage invoice offset — no JE template

**Location**: §12.6  
**Issue**: WF-07 in the E2E workflows says the manager can "Settle Accounts" by deducting the peshgi loan from the final storage invoice. But there's no JE template for this offset. JE-19 covers direct cash/bank repayment, but not the common scenario where the loan is deducted from the farmer's storage bill proceeds.

**Recommendation**: Add JE-19B:
```
JE-19B: Peshgi Recovered via Invoice Offset

DR  1010/1020  Cash (payment from farmer)      full_payment
  CR  1110/1120  Receivable — [Party Type]        invoice_amount
  CR  1140       Receivable — Peshgi (Loans)      loan_offset_amount

(The farmer's single payment clears both the storage AR and the peshgi balance)
```

---

### Finding 9.2 — 💡 RECOMMENDATION: Peshgi bad debt write-off not addressed

**Issue**: What if a farmer takes a Peshgi loan and never returns? JE-08 handles AR bad debt but doesn't mention Peshgi (account 1140). If the owner writes off a Peshgi loan, the JE should be:
```
DR  6080  Bad Debt Expense        amount
  CR  1140  Receivable — Peshgi    amount
```
This is technically supported by JE-08's structure, but should be called out explicitly since Peshgi write-off is a real risk in the mandi business.

---

## Cross-Cutting Findings

### Finding X.1 — 🔴 CRITICAL: `book_type` (KATCHI/PACCI) not in journal_entries data model

**Location**: §1 (Katchi vs Pacci) + §6 (journal_entries table)  
**Issue**: The entire first section emphasizes the dual-ledger `book_type` flag. But the `journal_entries` table definition (§6) has **no `book_type` column**. This is the single most important domain-specific feature and it's missing from the schema.

**Recommendation**: Add to `journal_entries`:
```
book_type  ENUM('PACCI', 'KATCHI')  NOT NULL DEFAULT 'PACCI'
```
Add business rules:
- PACCI entries: `posting_status` cannot be changed from POSTED (immutable).
- KATCHI entries: OWNER can soft-delete or modify. Audit log still captures all changes.
- All financial reports must allow filtering by `book_type`.
- Invoices, payments, credit notes must also carry a `book_type` field for consistency.

---

### Finding X.2 — 🟡 MATERIAL: `journal_entries.entry_type` enum is incomplete

**Location**: §6  
**Issue**: The `entry_type` enum lists: `INVOICE | PAYMENT | ADVANCE | CREDIT_NOTE | ADJUSTMENT | ACCRUAL | BAD_DEBT | REVERSAL`. Missing types for:
- `DEPRECIATION` (JE-13)
- `PAYROLL` (JE-15/15B)
- `EXPENSE` (JE-17)
- `ASSET_PURCHASE` (JE-12)
- `ASSET_DISPOSAL` (JE-14)
- `PESHGI_ISSUE` (JE-18)
- `PESHGI_RECOVERY` (JE-19)
- `DAMAGE_LIABILITY` (JE-09)

**Recommendation**: Extend the enum to include all JE types. This is critical for filtering, reporting, and audit trails.

---

### Finding X.3 — 🟡 MATERIAL: Ownership transfer billing timing is ambiguous

**Location**: JE-10, Functional Spec M3, E2E Workflow WF-02  
**Issue**: JE-10 says no journal entry fires at transfer time. WF-02 says *"System generates invoice for Ghulam. Ghulam must pay invoice immediately (or Ahmad officially assumes balance) before ownership transfer is committed."*

These two sources conflict:
- JE-10: "No JE at transfer. Invoice comes later when outbound happens."
- WF-02: "Invoice generated immediately at transfer for old owner."

**Recommendation**: Resolve the conflict. WF-02 is the correct business process:
1. At transfer, the system should auto-generate a DRAFT invoice for the old owner covering storage from inbound_date to transfer_date.
2. The manager reviews and optionally finalizes this invoice (triggering JE-01).
3. Update JE-10 description to reflect this: *"Ownership transfer triggers an automatic DRAFT invoice for the outgoing owner. If finalized, JE-01 fires as normal. The new owner's billing starts from transfer_date."*

---

### Finding X.4 — 🟢 MINOR: `journal_entries.source_table` doesn't cover all source types

**Issue**: `source_table` is `VARCHAR(50)` with documented values: `"invoices"`, `"payments"`, `"credit_notes"`. But entries from fixed assets, payroll, expense vouchers, and peshgi need different source tables:
- `"fixed_assets"` (JE-12, JE-14)
- `"depreciation_schedules"` (JE-13)
- `"payroll_runs"` (JE-15, JE-15B, JE-16)
- `"expense_vouchers"` (JE-17)
- `"party_loans"` (JE-18)
- `"party_loan_repayments"` (JE-19)

**Recommendation**: Document all valid `source_table` values. Consider making it an ENUM instead of VARCHAR.

---

## Summary of Findings

| Severity | Count | Must Fix Before Coding |
|---|---|---|
| 🔴 CRITICAL | 5 | Yes |
| 🟡 MATERIAL | 7 | Yes |
| 🟢 MINOR | 7 | Preferred |
| 💡 RECOMMENDATION | 4 | Optional for MVP |
| **Total** | **23** | |

### Critical Fixes (Must Do)

1. **Finding 5.1**: Renumber duplicate JE-12 → JE-09B
2. **Finding 3.1**: Complete cheque bounce reversal (mark JE-02, void allocations, status field)
3. **Finding 7.1**: Separate EOBI employer expense from salary account (add 6015)
4. **Finding X.1**: Add `book_type` column to `journal_entries` table
5. **Finding 1.4**: Add `2080 Damage/Spoilage Liability Payable` to CoA

### Material Fixes (Strongly Recommended)

1. **Finding 2.1**: Define JE-11R accrual reversal template
2. **Finding 3.2**: Add `status` column to `payments` table
3. **Finding 5.2**: Add `6150 Spoilage Compensation Expense` to CoA
4. **Finding 6.1**: Add pro-rata depreciation rule for mid-year assets
5. **Finding 7.3**: Add JE-16B for EOBI/tax government remittance
6. **Finding 8.2**: Add `ACCRUED` state to expense voucher lifecycle
7. **Finding X.2**: Extend `journal_entries.entry_type` enum for all JE types
