# 19 — Employee Advances (Phase 21)

**Date:** 2026-07-26/30 · **Branch:** `phase/20-audit-remediation` (continuing directly off the phase/20 batches)
**Scope:** build the receivable and payroll integration that phase/20 §9 left open — three prior audits (`docs/16`, `/17`, `/18`) had flagged employee salary advances as entirely absent.

---

## Context

`payroll_line_items.other_deductions_pkr` is documented as *"Advances repaid, etc."* — the only slot that ever pointed at this capability. Phase 20 found it silently breaking payroll: subtracted from net pay but reaching no journal line, so any run carrying a nonzero value failed the balance check and could never leave DRAFT. It was made to reject explicitly (`PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED`) rather than post through a wrong account, because the correct credit for an advance recovery is an employee **receivable**, and no such account existed — crediting a liability instead would leave the receivable standing while inventing an obligation, and the entry would still balance, so no invariant would catch it.

This phase builds that receivable.

---

## Accounting design

**New account `1230 Advances to Employees`** — ASSET / DETAIL, under `1200 Other Current Assets`, **not** `1100 Trade Receivables`: an employee advance isn't a trade receivable, and filing it there would inflate the AR rollup on the balance sheet with money customers don't owe. `1210 Advance Payments to Suppliers` already sits under 1200 for the same reason.

**JE-22 (issue):** `DR 1230 / CR 1010|1020` by payment method.
**JE-23 (write-off):** `DR 6080 Bad Debt / CR 1230` — mirrors peshgi's JE-20 exactly.
**Recovery posts no entry of its own.** It rides inside that period's JE-15/JE-15B as one more credit line to 1230, alongside the EOBI/tax lines already there. Verified algebraically before writing any code: `net = gross − empEobi − tax − advanceRecovery`, so `credits = gross + employerEobi = debits` — the same identity phase/20 established for tax, extended by one term.

`advance_recovery_pkr` is a **new, separate column** — it does not reuse `other_deductions_pkr`. The two are economically different (an advance recovery reduces an asset; a third-party deduction is a liability), and keeping them apart means the phase/20 guard stays meaningful for whatever "other deductions" turns out to mean once it has a real design.

---

## Decisions taken with the operator

| Question | Decision |
|---|---|
| Recovery mechanism | **Auto-suggest, accountant confirms.** Each payroll draft pre-fills `min(monthly_installment, outstanding)`; editable (including to zero) before finalizing, validated against the live outstanding balance. |
| Employee leaves owing | **Recover from final pay, then explicit OWNER write-off** for any remainder. No bespoke settlement flow — the final run behaves like any other month. |
| Limits | **One ACTIVE advance per employee**, principal capped at one month's pay (basic salary for SALARIED; `daily_wage_pkr × 26` for DAILY_WAGE, reusing the constant `createDraft` already applies). Both employee types eligible. |
| Payroll line-edit UI | **Folded into this phase** — see below. |

---

## Two correctness gaps that testing surfaced, not written into the original plan

**1. The "one active advance" check had no lock.** `issue()`'s guard was a plain `findFirst`-then-`create` — two concurrent issue calls could both see no ACTIVE advance and both insert. Same race class as the payroll duplicate-period guard phase/20 Batch C fixed. Closed with the same tool: an `advisoryXactLock` keyed per employee before the check, proven by a concurrent-issue integration test asserting exactly one `201`.

**2. Payroll reversal (phase/20 Batch E, shipped hours earlier in the same session) had to be reopened to unwind recoveries.** Getting this wrong silently forgives an employee's debt: the balance would stay reduced while the payroll that reduced it had been undone. Follows `PaymentService.dishonour()`'s shape — capture the recovery rows *before* anything is voided, lock each advance, restore balance and status, **then** soft-void the recovery row, never delete it. A `WRITTEN_OFF` advance deliberately does not revert to `ACTIVE` on reversal (that is a separate OWNER decision this must not undo); the resulting balance/status edge case — an advance can show `WRITTEN_OFF` with a nonzero restored balance if it was written off after a since-reversed recovery — is documented in code rather than left implicit, since the numbers are self-consistent with the GL but the combination looks odd on first read.

A third, smaller gap found the same way: `JE-15B` was missing its `2070` income-tax credit line in **`docs/09`** (the code had carried it since phase/20 Batch C; the doc never caught up). Fixed as part of the same edit that added the `1230` line, since leaving it inconsistent while editing the adjacent lines would have been worse than fixing it.

---

## Frontend

- **`/accounting/payroll/advances`** — list, status facet, outstanding stat tiles. Mirrors `loans/page.tsx`.
- **`/accounting/payroll/advances/new`** — issue form. Employee picker uses the shared `Combobox` primitive (not the RHF-bound `ComboboxField` — this page, like every other payroll/loans screen, uses plain `useState`, so the primitive was the fit). Shows the one-month-pay cap as a hint.
- **`/accounting/payroll/advances/[id]`** — detail, recovery timeline (linked to the payroll run, not a journal entry — recovery posts none), OWNER write-off dialog.
- **Employee detail** gained a Salary Advances card, and — the reason it earns its place — the **terminate dialog now warns when the employee still owes a balance**. Termination posts nothing by design, so without this the person deciding to terminate had no way to see the debt existed.
- **Payroll run detail — closed the line-edit gap.** `PATCH /v1/payroll-runs/:id/lines/:lineId` had zero callers anywhere in the web app before this phase: the run page rendered Income Tax and Other Deductions as read-only cells while `createDraft` hardcodes both to 0, so from the screen those columns were structurally always zero, and the phase/20 JE-15B tax fix was unreachable from the UI. A per-line Edit dialog (DRAFT runs only, gated on `payroll.draft`) now covers days worked, gross, income tax, and advance recovery. `other_deductions_pkr` stays read-only in the table — making it editable would guarantee a later `PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED` failure at finalize.

---

## Verification

**Live end-to-end pass against the running dev server** (not just the test database) — the Chrome extension wasn't available, so every endpoint the new/modified screens call was driven directly with the exact payload shapes those screens send, and every derived number checked by hand:

| Step | Result |
|---|---|
| Issue (`advances/new`'s POST) | JE-22: `DR 1230 10000 / CR 1010 10000` |
| Payroll draft pre-fill | `advance_recovery_pkr = 5000` = `min(5000 installment, 10000 outstanding)` |
| Line-edit over-recovery (the dialog's PATCH) | `12000 > 10000` outstanding → `422 EMPLOYEE_ADVANCE_OVER_RECOVERY` |
| Line-edit valid change | `3000` → net recomputed to `46625 = 50000 − 375 − 3000` |
| Finalize | JE-15 balanced (`51875 = 51875`), credits `1230` for `3000`; advance `10000 → 7000`, stays `ACTIVE` |
| **Reverse** | Advance balance restored `7000 → 10000`; recovery row soft-voided (0 visible) |
| Employee-detail advances query | Returns correctly post-reversal |
| One-active-advance guard | Second issue → `409 EMPLOYEE_ADVANCE_ALREADY_ACTIVE` |

Automated suite: TypeScript-checked across all 8 workspace tasks (api/web/shared/db/ui). Two Prisma migrations — `0013` (tables + `advance_recovery_pkr` column, purely additive) and `0014` (two new `EntryType` values, split into its own migration because PostgreSQL forbids using a new enum value in the same transaction that adds it).

**Suite after this phase: 213 unit + 499 integration (api) + 99 unit (web) green** — up from 209 / 486 / 99. New coverage: JE-15/15B balance with a nonzero advance recovery + omit-when-zero (unit), 2 salary-slip conditional-row cases (unit), 7 employee-advances integration tests (issue, cap, concurrent-issue, write-off, RBAC, GL-1230-vs-subledger invariant), 8 payroll-side integration tests (pre-fill, edit-to-zero, over-recovery rejection, full-recovery-to-RECOVERED, reversal-restores-balance, WRITTEN_OFF-not-resurrected). One pre-existing test's hardcoded CoA count updated `83 → 84`.

No frontend unit tests were added — the logic all lives in the backend, which the integration suite covers; the one client-side derived value (the one-month cap hint) is advisory only and re-enforced server-side at issue.

---

## Deliberately not done

- **No `2050` holding account** for `other_deductions_pkr` — unchanged from phase/20; the column still has no correct account until its actual meaning (third-party deduction vs. something else) is designed.
- **No settlement automation at termination** — by decision; see above.
- **No PDF acknowledgment** for an issued advance (peshgi has one; advances do not) — not requested, and the write-off/issue confirmation is sufficient for now.

Remaining phase/20 backlog (GST settlement, contra vouchers, cash-negative guard, `number_format` wiring, PDF money formatting, the cheque-clearing model) is untouched by this phase and still lives in `docs/18` §9.
