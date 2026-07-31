# 20 — Accounting Audit Backlog (phase/20 findings, live status)

**Purpose:** the durable register of all 40 findings raised by the phase/20 audit (`docs/18`), with severity and current status. `docs/18:133` previously pointed at a phase plan file for this list; that file was overwritten and the backlog existed nowhere in the repo. This document replaces that reference.

**Last reconciled:** 2026-07-31, against HEAD `67a5d18` on `phase/20-audit-remediation`. Every `OPEN` row below was re-verified against source on that date — the `file:line` in the status column is the evidence, not a memory.

**Legend** — `FIXED — <batch>`: shipped, see the linked doc section. `OPEN`: verified still present. `DEFERRED`: decided, deliberately not built yet.

---

## P0

| ID | Finding | Status |
|---|---|---|
| P0-1 | Advance-cheque dishonour posted the wrong reversal — `JE-06` had no advance branch, so dishonouring an unapplied advance left the 2010 liability standing **and** invented a receivable: a misstatement of twice the cheque that still balanced | **FIXED** — Batch A, `docs/18` §2 |
| P0-2 | Cheques booked as cleared bank funds on receipt; post-dated cheques inflate today's bank balance | **DEFERRED** — merged into P1-12; model now decided, see below |
| P0-3 | **Every advisory lock in the system acquired nothing** — `... OR TRUE` was constant-folded, so all ten document-number generators serialised on nothing. Found during implementation, not in the audit | **FIXED** — Batch C, `docs/18` §1 |

## P1

| ID | Finding | Status |
|---|---|---|
| P1-1 | `other_deductions_pkr` never reached the journal entry; `JE-15B` had no `2070` tax line, so any daily-wage run with income tax could never leave DRAFT | **FIXED** — Batch C (partial, `docs/18` §4) + Phase 21 (full) |
| P1-2 | Employee advances absent entirely; `other_deductions` was the only hook | **FIXED** — Phase 21, `docs/19` |
| P1-3 | Payroll runs and fixed assets were terminal — no cancel, reverse or un-dispose existed | **FIXED** — Batch E, `docs/18` §5 |
| P1-4 | **GST Payable 2020 is credited forever and never debited** — no settlement path exists | **OPEN** — `je-01-invoice-finalized.ts:137` credits it; repo-wide, nothing debits it |
| P1-5 | One account map, four copies — two of them in the browser | **FIXED** — Batch B, `docs/18` §6 |
| P1-6 | **No cash-negative guard** — a posted entry can drive Cash on Hand below zero | **OPEN** — `journal-entry.service.ts:346-359` checks exists/active/not-HEADER only |
| P1-7 | **`number_format` setting is wired to nothing** | **FIXED** — Batch G, phase/22 (`c162472`) |
| P1-8 | **No PDF surface formats money** — invoices print `1234567.5` | **FIXED** — Batch G, phase/22 (`dc08cf4`) |
| P1-9 | Payroll remittance was repeatable and unvalidated | **FIXED** — Batch C |
| P1-10 | No contra / cash-book voucher; petty-cash replenishment is one-way and has no UI | **OPEN** |
| P1-11 | Expenses was the only financial module taking no row lock — two concurrent `pay()` calls both posted | **FIXED** — Batch A, `docs/18` §3 |
| P1-12 | Cheque clearance never implemented — `clearance_status` is stamped `CLEARED` on receipt, `PENDING` is never assigned, `cheque_date` is never read. **Not a policy**: `docs/09` §258/§364-366/§372 require the opposite | **DEFERRED** — model decided, see below. Still live at `payment.service.ts:97` |
| P1-13 | JE-09/JE-09B spoilage path absent while `2080`/`6150` are seeded and postable | **OPEN** — no `je-09*` template exists |

## P2

| ID | Finding | Status |
|---|---|---|
| P2-0 | Document numbering cluster (umbrella for a/b/c) | **FIXED** — Batch D |
| P2-0a | `invoice_number` had no unique constraint — the only document number without one. Revised **up to P1** once the advisory lock was proven inert | **FIXED** — Batch D, migration `0011` |
| P2-0b | `expense-number` used local time, not UTC | **FIXED** — Batch D |
| P2-0c | Invoices numbered from the wall clock, not the invoice's own date | **FIXED** — Batch D |
| P2-1 | **Money inputs are scroll-mutable** — a stray wheel over a focused number input silently changes an amount | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-2 | **Petty-cash JE points at a voucher row that does not exist** — the audit trail asserts a source document that was never created | **OPEN** — `expense.service.ts:203` mints `randomUUID()`; `je-17c-petty-cash-replenish.ts:25-26` stamps it as `sourceTable: 'expense_vouchers'` |
| P2-3 | Account picker is a plain `<select>` over 84 accounts; `ComboboxField` ships and is used elsewhere | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-4 | Voucher running totals bypass the shared formatter | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-5 | No per-employee subledger — payroll posts a single aggregate `2030` line | **OPEN** — `je-15:55`, `je-15b:58`, `je-16:29` |
| P2-6 | `PLANNED` / `WRITTEN_OFF` asset statuses have no writer | **OPEN** — `fixed-asset.service.ts:165` reads `WRITTEN_OFF`; nothing sets it for an asset |
| P2-7 | No partial disposal, revaluation, impairment or CWIP | **OPEN** — zero matches repo-wide |
| P2-8 | Depreciation period ordering unconstrained — March can be run before February | **OPEN** — `fixed-asset.service.ts:308-317` guards only the same year/month |
| P2-9 | Employee termination has no settlement / gratuity and posts no JE | **OPEN** — Phase 21 added an outstanding-debt warning to the terminate dialog, but no accounting |
| P2-10 | **KATCHI gate applied on create only, not later stages** | **OPEN** — `assertKatchiWriteAllowed` is imported by 8 controllers but called only in create handlers, e.g. `payment.controller.ts:32` and nowhere else in that file |
| P2-11 | Dishonour date forced to `new Date()` | **OPEN** — `payment.service.ts:472` |
| P2-12 | Payroll duplicate-period guard ran outside its transaction | **FIXED** — Batch C |
| P2-13 | Statement and operational formatters disagree on the zero/null glyph | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-14 | Payments have no document / receipt number at all | **OPEN** — zero matches for `payment_number` / `receipt_number` |
| P2-15 | Voucher creator can approve their own voucher; cancel reason silently discarded | **OPEN** — `expense.service.ts:95` sets `approvedBy: userId` with no separation-of-duties check |

## P3

| ID | Finding | Status |
|---|---|---|
| P3-1 | Grouped amount input yields a silent zero — typing `40,00,000` posts `0` | **FIXED** — Batch G, phase/22 (`c162472`) |
| P3-2 | Dead export `defaultsForCategory` | **OPEN** — `fixed-assets/templates/types.ts:27`, zero callers repo-wide |
| P3-3 | Dev-DB drift: `invoice_surcharges` exists in the live dev database but not in this branch's schema | **OPEN** — ops check, not code. Confirmed absent from the Prisma schema |
| P3-4 | Depreciation batch runs in one transaction on Prisma's 5 s default timeout | **OPEN** — `fixed-asset.service.ts:299` opens the transaction; `:326` loops every in-service asset doing a `postInTransaction` (`:354`) and an upsert (`:358`) inside it |
| P3-5 | `PaymentService` constructed without its journal-entry dependency in reporting | **OPEN** — `reporting.controller.ts:32-35` passes 2 args vs `payment.controller.ts:22`'s 3; `payment.service.ts:449` then guards with `if (this.journalEntry)`, so a future write path would silently skip its JE |

---

## Invariant tests

The audit proposed ten ledger invariants (11–20) and marked several "MISSING — add". **Those labels describe the pre-remediation state.** Re-checked against the suite on 2026-07-31:

| # | Invariant | Finding | Status |
|---|---|---|---|
| 11 | Every FINALIZED payroll run has a balanced JE | P1-1 | **Covered by construction** — `postInTransaction` rejects unbalanced entries; plus `payroll-templates.unit.test.ts:15,45` |
| 12 | Advance liability (2010) nets to zero after an advance is dishonoured | P0-1 | **EXISTS** — `payment.integration.test.ts:397` (unallocated) and `:451` (partly allocated) |
| 13 | No `1020` balance includes a non-`CLEARED` cheque | P0-2 / P1-12 | **BLOCKED** — becomes checkable once the clearing model below is built |
| 14 | No cash-class account ever goes negative | P1-6 | **MISSING** |
| 15 | Every payroll run has at most one remittance JE | P1-9 | **EXISTS** — guard `payroll-run.service.ts:411-412`, test `payroll.integration.test.ts:583` |
| 16 | Σ `2030` credits = Σ per-employee net pay | P2-5 | **MISSING** — checkable today without the subledger |
| 17 | Every JE `sourceId` resolves to a real row in `sourceTable` | P2-2 | **MISSING** |
| 18 | One expense voucher never has more than one payment JE | P1-11 | **EXISTS** — `expense.integration.test.ts:339-344` |
| 19 | `invoice_number` is unique per facility | P2-0a | **EXISTS** — as a DB constraint, migration `0011` |
| 20 | No production code inserts journal rows outside `postInTransaction` | core guarantee | **EXISTS** — CI grep gate in `.github/workflows/ci.yml` |

---

## Decision on record: cheque recognition (P0-2 / P1-12)

Taken 2026-07-31. `docs/09` contradicts itself — §262 says post on receipt with a pending flag, §258/§365 say do not post until clearance — and **the code satisfies neither**. The adopted model reconciles both:

```
RECEIPT (any cheque, post-dated or not)
  DR  1025 Cheques in Hand        amount
    CR  1110-1150 <party AR>        amount
  clearance_status = PENDING

CLEARANCE (new action, dated the clearance date)
  DR  1020 Bank Account           amount
    CR  1025 Cheques in Hand        amount
  clearance_status = CLEARED

BOUNCE
  reverses out of 1025, not 1020
```

The payment is recognised when received (§262) and the bank balance never includes an uncleared cheque (§258/§365). Requires a new CoA account `1025`, a clearance endpoint and UI, and changes to JE-02/JE-06. Unblocks invariant 13.

**Not yet built** — recorded here so the next session starts from the decision rather than re-litigating the spec contradiction.

---

## Scope note

Phase 22 (`Batches G/H/I`) clears the **defect** half of the open list: P1-6, P1-7, P1-8, P2-1, P2-2, P2-3, P2-4, P2-8, P2-10, P2-11, P2-13, P2-15, P3-1, P3-2, P3-4, P3-5, invariants 14/16/17, and web UI for the two reversal endpoints that shipped with no callers.

**Batch G (presentation) shipped 2026-07-31** — `c162472` (web) + `dc08cf4` (PDF): P1-7, P1-8, P2-1, P2-3, P2-4, P2-13, P3-1. All seven verified against the running suite: 216 unit + 499 integration (api, unchanged from baseline — no regressions) + 111 unit (web, up from 99). Batch H (integrity defects) and Batch I (reversal UI) remain.

Everything else above is new capability rather than repair, and is deliberately held: P1-4, P1-10, P1-12, P1-13, P2-5, P2-6, P2-7, P2-9, P2-14, and depreciation-run reversal (`DepreciationScheduleStatus` has no `REVERSED` member — it does not exist at all).

**Still open for production** (`docs/18:145`): run the duplicate-invoice-number pre-check in the `0011` migration banner before deploying. Dev returned clean but holds zero invoices, which proves nothing.
