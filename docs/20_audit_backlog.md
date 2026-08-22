# 20 — Accounting Audit Backlog (phase/20 findings, live status)

**Purpose:** the durable register of all 40 findings raised by the phase/20 audit (`docs/18`), with severity and current status. `docs/18:133` previously pointed at a phase plan file for this list; that file was overwritten and the backlog existed nowhere in the repo. This document replaces that reference.

**Last reconciled:** 2026-08-22, against `accounting/F-completion` (see §Phase 29 below). Prior reconciliation 2026-08-05, against HEAD `f56f8b8` on `phase/22-audit-backlog`. Every `OPEN` row below was re-verified against source on that date — the `file:line` in the status column is the evidence, not a memory.

**Legend** — `FIXED — <batch>`: shipped, see the linked doc section. `OPEN`: verified still present. `DEFERRED`: decided, deliberately not built yet.

---

## P0

| ID | Finding | Status |
|---|---|---|
| P0-1 | Advance-cheque dishonour posted the wrong reversal — `JE-06` had no advance branch, so dishonouring an unapplied advance left the 2010 liability standing **and** invented a receivable: a misstatement of twice the cheque that still balanced | **FIXED** — Batch A, `docs/18` §2 |
| P0-2 | Cheques booked as cleared bank funds on receipt; post-dated cheques inflate today's bank balance | **FIXED** — Phase 25, per the decided model below |
| P0-3 | **Every advisory lock in the system acquired nothing** — `... OR TRUE` was constant-folded, so all ten document-number generators serialised on nothing. Found during implementation, not in the audit | **FIXED** — Batch C, `docs/18` §1 |

## P1

| ID | Finding | Status |
|---|---|---|
| P1-1 | `other_deductions_pkr` never reached the journal entry; `JE-15B` had no `2070` tax line, so any daily-wage run with income tax could never leave DRAFT | **FIXED** — Batch C (partial, `docs/18` §4) + Phase 21 (full) |
| P1-2 | Employee advances absent entirely; `other_deductions` was the only hook | **FIXED** — Phase 21, `docs/19` |
| P1-3 | Payroll runs and fixed assets were terminal — no cancel, reverse or un-dispose existed | **FIXED** — Batch E, `docs/18` §5 |
| P1-4 | **GST Payable 2020 is credited forever and never debited** — no settlement path exists | **FIXED** — Phase 29, JE-26 + `/v1/accounting/gst-settlement` |
| P1-5 | One account map, four copies — two of them in the browser | **FIXED** — Batch B, `docs/18` §6 |
| P1-6 | **No cash-negative guard** — a posted entry can drive Cash on Hand below zero | **RESOLVED, by detection instead of prevention** — `GET /v1/reports/cash-exceptions` (phase/24); the posting-time guard itself stays un-built, deliberately; see below |
| P1-7 | **`number_format` setting is wired to nothing** | **FIXED** — Batch G, phase/22 (`c162472`) |
| P1-8 | **No PDF surface formats money** — invoices print `1234567.5` | **FIXED** — Batch G, phase/22 (`dc08cf4`) |
| P1-9 | Payroll remittance was repeatable and unvalidated | **FIXED** — Batch C |
| P1-10 | No contra / cash-book voucher; petty-cash replenishment is one-way and has no UI | **FIXED** — Phase 29, JE-27 + `/accounting/cash-transfers` (any direction between 1010/1020/1030). JE-17C stays as the petty-cash-specific sibling; the new screen is the only UI, so there is one place to record a transfer |
| P1-11 | Expenses was the only financial module taking no row lock — two concurrent `pay()` calls both posted | **FIXED** — Batch A, `docs/18` §3 |
| P1-12 | Cheque clearance never implemented — `clearance_status` is stamped `CLEARED` on receipt, `PENDING` is never assigned, `cheque_date` is never read. **Not a policy**: `docs/09` §258/§364-366/§372 require the opposite | **FIXED** — Phase 25, `docs/09` §JE-24, `payment.service.ts:clear()` |
| P1-13 | JE-09/JE-09B spoilage path absent while `2080`/`6150` are seeded and postable | **OPEN** — no `je-09*` template exists |

## P2

| ID | Finding | Status |
|---|---|---|
| P2-0 | Document numbering cluster (umbrella for a/b/c) | **FIXED** — Batch D |
| P2-0a | `invoice_number` had no unique constraint — the only document number without one. Revised **up to P1** once the advisory lock was proven inert | **FIXED** — Batch D, migration `0011` |
| P2-0b | `expense-number` used local time, not UTC | **FIXED** — Batch D |
| P2-0c | Invoices numbered from the wall clock, not the invoice's own date | **FIXED** — Batch D |
| P2-1 | **Money inputs are scroll-mutable** — a stray wheel over a focused number input silently changes an amount | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-2 | **Petty-cash JE points at a voucher row that does not exist** — the audit trail asserts a source document that was never created | **FIXED** — Batch H part 3, phase/22. Retagged `sourceTable: 'manual'`, `sourceId: <acting user>`, matching the one other source-document-less template rather than fabricating a voucher row |
| P2-3 | Account picker is a plain `<select>` over 84 accounts; `ComboboxField` ships and is used elsewhere | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-4 | Voucher running totals bypass the shared formatter | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-5 | No per-employee subledger — payroll posts a single aggregate `2030` line | **CLOSED — won't build.** IFRS for SMEs s.28 requires the *liability* be recognised, not a GL account per employee, and the per-employee detail already exists in `payroll_line_items`. The aggregate posting is correct. Phase 29 built invariant 16 instead (below), which closes the actual gap |
| P2-6 | `PLANNED` / `WRITTEN_OFF` asset statuses have no writer | **MOSTLY FIXED** — Phase 29's impairment writes `WRITTEN_OFF` when a write-down leaves no carrying amount. `PLANNED` remains a dead enum value, which is not an accounting defect |
| P2-7 | No partial disposal, revaluation, impairment or CWIP | **PARTLY FIXED — impairment only, deliberately.** Phase 29 shipped IFRS for SMEs s.27 impairment (JE-28, accounts `6160`/`1370`, migration `0023`), because s.27 *requires* an assessment at each reporting date and a failed compressor is a realistic indicator here. **Revaluation: won't build** — s.17 permits cost *or* revaluation; cost is chosen, implemented and compliant. **Partial disposal / CWIP: won't build** — you do not sell half a compressor, `1350` CWIP is seeded, and a manual JE covers the rare case |
| P2-8 | Depreciation period ordering unconstrained — March can be run before February | **FIXED** — Batch H part 3, phase/22. Per-asset "eligible last period" guard using the same `computeMonthlyDepreciation` calc the run itself uses, so a calendar gap with zero `IN_SERVICE` assets can't permanently deadlock a later run |
| P2-9 | Employee termination has no settlement / gratuity and posts no JE | **OPEN — awaiting the facility's accountant, not an engineering decision.** Gratuity depends on establishment size and the terms of employment; IFRS for SMEs s.28 would require accruing it *as it is earned*, so if the facility owes it and never accrues, liabilities and cost are understated and the understatement compounds per employee per year of service. Building it blind means inventing a rate, a vesting rule and an eligibility test, and a wrong accrual is worse than a disclosed absent one. **The question to put to them:** does the facility employ 20 or more workers, and do the terms of employment (or any standing order applying to it) provide for gratuity or any other end-of-service benefit? If yes, this becomes a real work item and needs the rate, the vesting rule, and whether past service is already owed. If no, record that finding here and the item closes legitimately |
| P2-10 | **KATCHI gate applied on create only, not later stages** | **FIXED (22 of 23 routes) — Batch H part 2, phase/22.** `POST /v1/depreciation/runs` still ungated — it batches every `IN_SERVICE` asset regardless of book, so there's no single record to gate on; deferred as a product decision, see below |
| P2-11 | Dishonour date forced to `new Date()` | **FIXED** (Batch H1, `e8edad8`) — `payment.service.ts:355,363` takes `dishonourDateInput`; re-verified 2026-08-07 |
| P2-12 | Payroll duplicate-period guard ran outside its transaction | **FIXED** — Batch C |
| P2-13 | Statement and operational formatters disagree on the zero/null glyph | **FIXED** — Batch G, phase/22 (`c162472`) |
| P2-14 | Payments have no document / receipt number at all | **FIXED** — Phase 29, `RCP-YYYYMM-NNNN` via the advisory-locked generator, migration `0022`. Existing payments deliberately not backfilled — a receipt number belongs to a receipt that was issued |
| P2-15 | Voucher creator can approve their own voucher; cancel reason silently discarded | **FIXED** — Batch H part 3, phase/22. `approve()` rejects same-user (`EXPENSE_VOUCHER_SELF_APPROVAL`); cancel reason now read from the request body and appended to `notes`. Backend-only: `formatVoucher()` doesn't return `created_by`, so the web Approve button isn't hidden for the creator — clicking it now correctly 422s with a toast instead of silently succeeding, same as any other permission rejection on this screen. Not a bug; a client-side hide is a follow-on, not part of this fix |

## P3

| ID | Finding | Status |
|---|---|---|
| P3-1 | Grouped amount input yields a silent zero — typing `40,00,000` posts `0` | **FIXED** — Batch G, phase/22 (`c162472`) |
| P3-2 | Dead export `defaultsForCategory` | **FIXED** (Batch H1, `e8edad8`) — removed; zero hits repo-wide, re-verified 2026-08-07 |
| P3-3 | Dev-DB drift: `invoice_surcharges` exists in the live dev database but not in this branch's schema | **CLOSED — cosmetic, won't change.** The GL is the system of record and there is deliberately no surcharge table; the `sourceTable` string is merely misleading, and renaming it would break idempotency counting that relies on existing rows. Invariant 17 already carries it as a named gap. Original note: **OPEN** — ops check, not code. Confirmed absent from the Prisma schema (`schema.prisma` has no `invoice_surcharge`/`invoice_surcharges` model at all). **Now also confirmed live**: `je-21-late-payment-surcharge.ts:34`, `invoice.service.ts:300`, `payment.service.ts:646`, `reporting/reports/receivables-aging.ts:204` all stamp `sourceTable: 'invoice_surcharge'` on posted JEs — the audit trail asserts a document type with no backing table anywhere on this branch, the same shape as P2-2, found by the invariant-17 test rather than by reading. Not restructuring JE-21 in this batch; invariant 17 carries it as a named, documented gap so it isn't silently skipped or a crash risk |
| P3-4 | Depreciation batch runs in one transaction on Prisma's 5 s default timeout | **FIXED** — Batch H part 3, phase/22. Explicit `{ timeout: 30_000, maxWait: 10_000 }` — the first explicit Prisma transaction timeout anywhere in this codebase (confirmed via full-repo grep before choosing the shape) |
| P3-5 | `PaymentService` constructed without its journal-entry dependency in reporting | **FIXED** (Batch H1, `e8edad8`) — `reporting.controller.ts:39-43` passes the `JournalEntryService`; the constructor param is now required, no `if (this.journalEntry)` guard remains. Re-verified 2026-08-07 |
| P3-6 | ~~No account for income tax withheld *from* the facility~~ **FIXED — Phase 29**, built to exactly the shape recorded below: `1240`, `Payment.taxWithheldPkr` (migration `0024`), JE-02 splits `DR cash (net) + DR 1240 (withheld) / CR AR (gross)`. Original note follows. No account for income tax withheld *from* the facility (s.153, when the billing party is a prescribed/withholding-agent payer) — a short payment today has to be cleared via credit note, and `CreditNoteLineItem.revenueAccountCode` is non-nullable, so the workaround debits revenue instead of a receivable. Found in the phase/25 ERPNext/Odoo benchmark (`docs/09` §2) | **DEFERRED** — genuinely low-frequency today: most billing parties (farmers, traders, arhtis) are not prescribed withholding agents. Build when the facility onboards its first corporate/institutional billing party. Shape: seed `1240 Tax Withheld at Source — Receivable`, add `Payment.taxWithheldPkr`, JE-02 splits into `DR cash/bank (net) + DR 1240 (withheld) / CR AR (gross)` |

---

## Invariant tests

The audit proposed ten ledger invariants (11–20) and marked several "MISSING — add". **Those labels describe the pre-remediation state.** Re-checked against the suite on 2026-07-31:

| # | Invariant | Finding | Status |
|---|---|---|---|
| 11 | Every FINALIZED payroll run has a balanced JE | P1-1 | **Covered by construction** — `postInTransaction` rejects unbalanced entries; plus `payroll-templates.unit.test.ts:15,45` |
| 12 | Advance liability (2010) nets to zero after an advance is dishonoured | P0-1 | **EXISTS** — `payment.integration.test.ts:397` (unallocated) and `:451` (partly allocated) |
| 13 | No `1020` balance includes a non-`CLEARED` cheque | P0-2 / P1-12 | **EXISTS** — Phase 25; `1025` holds every PENDING cheque, `payment.integration.test.ts` "clears a PENDING cheque" et al. |
| 14 | No cash-class account ever goes negative | P1-6 | **NOT ENFORCED, by decision** — a negative balance is still possible and is meant to be: `GET /v1/reports/cash-exceptions` (phase/24) surfaces it instead of blocking the posting that caused it; see below |
| 15 | Every payroll run has at most one remittance JE | P1-9 | **EXISTS** — guard `payroll-run.service.ts:411-412`, test `payroll.integration.test.ts:583` |
| 16 | Σ `2030` credits = Σ per-employee net pay | P2-5 | **EXISTS** — Phase 29. Computed on the payroll run itself (`reconciliation` on the run response) and shown on the run screen, so an accountant sees it for the run in front of them rather than trusting that a test passed once. Null on a draft run: there is no entry to reconcile against yet |
| 17 | Every JE `sourceId` resolves to a real row in `sourceTable` | P2-2 | **EXISTS** — `accounting-hardening.integration.test.ts`, "every JE sourceId resolves to a live row" (self-verifying: an unmapped `sourceTable` fails loudly rather than being silently skipped). Surfaced P3-3 as a second instance of the same defect shape — see below |
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

**Built — Phase 25.** `1025 Cheques in Hand (Under Collection)`, `POST /v1/payments/:id/clear` (JE-24), and the receipt-side account resolution in `receiptAssetAccountForPaymentMethod()` — the account code and posting shape here matched what shipped exactly. `docs/09` §JE-24 has the full write-up.

---

## Decision on record: KATCHI later-stage gate count, 15 → 23 (P2-10)

The phase/22 plan enumerated 15 ungated later-stage routes and separately listed 8 more (payroll remit/reverse, fixed-assets commission/dispose/reverse-disposal/depreciation-runs, employee-advances write-off, peshgi write-off) as "confirmed not gaps, OWNER already exceeds what a KATCHI check would require." That confirmation was wrong, caught before implementing by reading `computeEffectivePermissions` in `packages/shared/src/permissions.ts` directly rather than trusting the carried-over note.

`defaultMinRole: 'OWNER'` is not a floor. Only `alwaysOwner: true` is — and exactly three keys in the entire 42-key registry have it (`users.manage`, `settings.manage`, `permissions.manage`). Every other OWNER-default key, including all 8 listed above, is grantable to any role via `PUT /v1/permissions` (`computeEffectivePermissions` deletes only `alwaysOwner` keys for non-owners; `EDITABLE_ROLES` includes MANAGER down to VIEWER). So a facility owner can grant `payroll.reverse` to MANAGER — a supported, intended action — and without a gate in the route itself, that MANAGER could then reverse a KATCHI-book payroll run with no OWNER check anywhere in the path. That is exactly the drift `CLAUDE.md` says keeping KATCHI outside the owner-configurable matrix was meant to prevent: the fixed rule and the matrix disagreeing.

Corrected count: **23 later-stage routes across 7 of the 8 controllers that already import `assertKatchiWriteAllowed`** (the create-only gate proved the module already has a KATCHI-bearing document; the fix doesn't spread to modules that never had the gate). `accounting.controller.ts`, the 8th, contributed zero — its journal-entry routes were already fully gated on create, post-draft, and reverse. 22 gated in Batch H part 2 — the established `const existing = await service.getById(...); assertKatchiWriteAllowed(role, existing.book_type)` shape (`accounting.controller.ts:184-185`) for 21 later-stage mutations, `body.book_type` directly for the one later-stage *create* (`petty-cash-replenish`, which has its own optional `book_type` rather than operating on an existing record).

**One left open, on purpose: `POST /v1/depreciation/runs`.** `RunDepreciationRequest` carries only `period_year`/`period_month` — no `book_type` — because the run isn't scoped to one record: `runMonthlyDepreciation` (`fixed-asset.service.ts:326-353`) loops every `IN_SERVICE` asset regardless of book and posts each one's JE-13 in that asset's own `bookType`. A single run can touch both PACCI and KATCHI assets. Fetch-then-gate doesn't apply — there's no single `existing` to check. Fixing this is a product decision (reject the whole run when any IN_SERVICE asset is KATCHI and the caller isn't OWNER, vs. silently scope non-OWNER runs to PACCI-only assets, vs. something else) with real behavioral consequences, not a mechanical audit-gate insertion — so it's deferred rather than guessed at. Still ungated today; tracked here so it isn't lost.

Tests: one non-OWNER-on-KATCHI-403 per controller in the existing `KATCHI source-document gates (F-9)` block (`accounting-hardening.integration.test.ts`), not one per route. Two of the seven (fixed-assets commission, employee-advances write-off) specifically grant the route's permission to MANAGER via `PUT /v1/permissions` first, then confirm the KATCHI gate still holds — proving the exact scenario that motivated the count correction, not just the default-role case.

---

## Decision on record: cash-negative guard (P1-6 / invariant 14)

Attempted 2026-07-31 in Batch H, reverted the same day. The guard itself (`assertCashAccountsStayNonNegative` in `journal-entry.service.ts`, deriving the cash-class set from the `1000` HEADER's children rather than a hardcoded list, locked per-account via `advisoryXactLock` against the same TOCTOU race Batch C fixed for document numbering) was correct in what it checked. It was wired into both places a line becomes `POSTED` — `postInTransaction` and the `postDraft` promotion path — and rejected with a new `CASH_ACCOUNT_WOULD_GO_NEGATIVE` (422).

Running it against the integration suite turned up the real finding: **57 of 503 tests failed across 9 files**, every one a legitimate cash-out operation — loan issuance (`peshgi.integration.test.ts`'s `issueLoan()` helper going 201→422) among them — rejected because the account it debited or credited had no funded balance to draw down. The guard is not buggy; the precondition it enforces has no producer anywhere in the system. **No facility, seeded fixture or otherwise, ever establishes an opening cash position** — 1010/1020/1030 all start at an implicit zero with nothing that deposits into them except ordinary operating postings, which is exactly what the guard then blocks. Building a synthetic balance into the shared test fixture to make the suite pass would have hidden the same gap in production: a real facility's first cash payout on day one would 422 for the same reason, and nothing in the product currently prompts an owner to enter one.

This is the same shape of finding as P1-1 in `docs/18` §4 — `other_deductions_pkr` had no account to post to, so the fix was to refuse honestly rather than post to the wrong place. Here the missing piece is an account **balance**, not an account, so the same discipline means: don't post through a hole, and don't force output out of a check whose input the system can't supply yet. Reverted: the function, both call sites, the error code, and the now-unused `advisoryXactLock` import. Kept, skipped, with the reasoning inline: the four tests in `accounting-hardening.integration.test.ts` under `describe.skip('cash-class accounts cannot go negative ...')` — they're the spec for whichever phase adds opening cash balances (a prerequisite this shares with invariant 13/P1-12 above; the two could plausibly land together, since both are "the ledger needs a real starting position" problems).

> **Correction (phase/23).** The sentence above — "no facility ever establishes an
> opening cash position" — is **operationally true but literally false**, and the
> distinction is what P1-6 actually hinges on. `POST /v1/accounting/opening-balances`
> has accepted `cash_pkr` → 1010 and `bank_pkr` → 1020 since Gap 1 shipped, and
> phase/23 added 1030 to the same screen. What is true is that the flow is
> **optional, one-shot and human-driven**: no fixture, no provisioning path and no
> onboarding step invokes it, which is why the integration suite starts every cash
> account at zero.
>
> So the blocker is narrower than recorded. P1-6 does not need a new capability —
> it needs (a) the shared test fixture to post a real opening cash position, and
> (b) a decision about facilities that never enter one. **Still DEFERRED**: the
> 57-test blast radius is unchanged, and re-opening it is a scoping decision, not
> a mechanical fix. Recorded here so the next session starts from the accurate
> constraint rather than re-deriving a false one.

> **Resolution (phase/24) — not a guard, and the guard's premise turned out to be
> wrong.** Re-examining P1-6 surfaced a second, more basic problem than the fixture
> gap above: **no overdraft facility is modelled anywhere in this system** —
> nothing in `schema.prisma`, facility settings, or the accounting module. A bank
> *running-finance* facility is standard for Pakistani agri businesses, and a
> negative `1020` under one is legitimate, not an error. The skipped tests'
> premise — *"a debit-normal balance below zero is physically impossible"* — holds
> for `1010` (physical cash) and `1030` (wallet), and is simply **false** for
> `1020`.
>
> That reframes the finding: even with the fixture gap fixed, a hard 422 on 1020
> would be *wrong*, not just untested. And a hard block is the wrong enforcement
> in general for this failure mode — if the ledger says zero but there is real
> cash in the drawer (the fixture-gap scenario), refusing the entry means the
> operator cannot record a transaction that genuinely happened. An unrecorded
> transaction is a worse outcome than a visible negative balance: the ledger
> diverges from reality either way, and only one of the two paths hides it.
>
> **Shipped instead: `GET /v1/reports/cash-exceptions`** — every cash-class
> account (the children of header 1000, derived from the chart, never a
> hardcoded code list) with its balance as of a date, flagging negatives. It
> catches the identical control failure (an unrecorded deposit, or a payment
> that never happened) without ever touching the posting path. No fixture
> surgery required, no opening-balance dependency, and the 57-test blast radius
> from the original attempt never applies — nothing is rejected.
>
> **The four `describe.skip` tests in `accounting-hardening.integration.test.ts`
> stay skipped, and their premise needs revisiting, not just their fixture.** A
> future guard, if ever built, would need to exclude `1020` (or gate it on a
> configured overdraft limit once that concept exists) rather than apply
> uniformly to all three cash accounts as originally written.

---

## Scope note

Phase 22 (`Batches G/H/I`) clears the **defect** half of the open list: P1-6, P1-7, P1-8, P2-1, P2-2, P2-3, P2-4, P2-8, P2-10, P2-11, P2-13, P2-15, P3-1, P3-2, P3-4, P3-5, invariants 14/16/17, and web UI for the two reversal endpoints that shipped with no callers.

**Batch G (presentation) shipped 2026-07-31** — `c162472` (web) + `dc08cf4` (PDF): P1-7, P1-8, P2-1, P2-3, P2-4, P2-13, P3-1. All seven verified against the running suite: 216 unit + 499 integration (api, unchanged from baseline — no regressions) + 111 unit (web, up from 99).

**Batch H part 1 shipped 2026-07-31** — `e8edad8`: P2-11 (H4, dishonour date), P3-5 (H7, required JE dependency), invariant 16 (H3), P3-2 (H9, dead export). P1-6/invariant 14 (H1) attempted and reverted — see decision above. Suite unchanged (216/499+4skip/111), zero regressions.

**Batch H part 2 shipped 2026-08-01** — P2-10 (H5): 22 of 23 later-stage KATCHI gaps closed across 7 controllers (payment, lot, expense, payroll, peshgi, fixed-assets, employee-advances) — see decision above for the 15→23 count correction and why `POST /v1/depreciation/runs` stays open. Seven new tests in the `KATCHI source-document gates (F-9)` block, one per controller; two (fixed-assets, employee-advances) specifically grant the route's permission to MANAGER first, then confirm the gate still holds — verified as real regression tests, not tautologies, by temporarily stashing the two controller edits and watching both go `403 → 200`. Suite: 506 integration passing + 4 skipped (up from 499+4, zero regressions), 216 unit / 111 unit unchanged.

**Batch H part 3 shipped 2026-08-01** (`f56f8b8`) — P2-2 (H2), P2-15 (H6), P2-8/P3-4 (H8), invariant 17. JE-17C (petty-cash-replenish) retagged `sourceTable: 'manual'` / `sourceId: <acting user>`, matching the one other source-document-less template instead of the fabricated-uuid-into-`expense_vouchers` it used before; also makes it reversible, which the audit called correct. Invariant 17 lands as a self-verifying resolver map (12 document tables + the `manual`/`opening_balances` acting-user/facility convention), asserting every `sourceTable` value actually present is either resolvable or a named gap — which is what caught P3-3 as a live code defect, not just dev-DB drift, on the first run. Expense `approve()` gained a same-user rejection and `cancel` now actually reads and persists its reason (both req'd only a controller/service fix, no schema change — the request schema already validated the field). Depreciation runs gained an explicit 30 s transaction timeout (the codebase's first — grepped every `$transaction(` call site first to confirm) and a per-asset "prior period must be posted" guard that reuses the run's own eligibility calc rather than a facility-wide sequential rule, so a calendar gap with zero `IN_SERVICE` assets can't deadlock a later run. Test-hygiene fix alongside it: this file's shared-facility fixtures for H5 (payroll runs, employees) had no cleanup, so a second run of the file 409'd on a duplicate payroll period — fixed by extending `cleanup()` to the specific collision (payroll-run period uniqueness), then narrowed again after review flagged that the broader employee/employeeAdvance deletion it was bundled with risked deleting rows out from under other integration files sharing the same facility. Also root-caused (not fixed — out of this batch's scope) a shared dev-DB test-infra defect found while verifying: `backdating_max_days` can get stuck non-null forever if a test run mutating it is interrupted mid-flight, because the seed/setup upsert only applies its "unlimited" override on `create`, never `update`.

**Batch I shipped 2026-08-06** — `POST /v1/payroll-runs/:id/reverse` and `POST /v1/fixed-assets/:id/reverse-disposal` (Batch E) had zero web callers; the only way to reach an owner-only correction path was curl. Both permission keys (`payroll.reverse`, `fixed_assets.reverse`) already existed in the matrix with no gap to fix — this was UI wiring only. Added a "Reverse…" action to the payroll-run and fixed-asset detail pages, following the mandatory-reason `Dialog` pattern already used for JE reversal, gated on status (`FINALIZED`/`PAID` and not `REVERSED` for a run; `DISPOSED` for an asset) matching each service's own guard.

Batch H and Batch I are now both closed. Still open: the depreciation-run KATCHI gap (`POST /v1/depreciation/runs`, deferred product decision, see P2-10 above) and everything under Deferred below.

Everything else above is new capability rather than repair, and is deliberately held: P1-4, P1-10, P1-13, P2-5, P2-6, P2-7, P2-9, P2-14, and depreciation-run reversal (`DepreciationScheduleStatus` has no `REVERSED` member — it does not exist at all). **P1-6 joined this list mid-batch**, not by original scoping — it looked like defect repair until the test suite showed it depends on opening cash balances existing first (see decision above), which is new capability. **P1-12 left this list in Phase 25** — built, see the decision-on-record above.

**Still open for production** (`docs/18:145`): run the duplicate-invoice-number pre-check in the `0011` migration banner before deploying. Dev returned clean but holds zero invoices, which proves nothing.

---

## Phase 29 — accounting completion (2026-08-22, `accounting/F-completion`)

Closes P1-4, P1-10, P2-14, P3-6 and invariant 16; ships the narrow slice of
P2-7; adds Pakistani withholding on payments out, which the audit never raised
because nothing in the system could do it. Migrations `0022` (receipt number),
`0023` (accumulated impairment), `0024` (tax withheld on receipts).

**Journal entry numbering.** The plan reserved JE-27 for impairment. Templates
were numbered in build order instead, so: **JE-26** GST settlement, **JE-27**
cash transfer, **JE-28** asset impairment, **JE-29** withholding remittance.
Stated here because the plan file says otherwise.

### FINDING — every reversal in the ledger is applied twice

**This is larger than anything else on this page and it is not fixed.** It was
found while building P3-6 and is unrelated to it: it reproduces with no
withholding involved at all.

`markReversed()` sets the original entry's `posting_status` to `REVERSED`,
**and** the caller separately posts a full mirror entry. Every statement, the
GL and the trial balance filter `posting_status = 'POSTED'`, so the original
drops out of the ledger entirely *and* the mirror is applied. The reversal
therefore lands twice.

Measured on a 10,000 cheque receipt, dishonoured, **no withholding**:

| Account | Before | After receipt | After bounce | Should be |
|---|---|---|---|---|
| AR control (1110–1150) | 0 | −10,000 | **+10,000** | 0 |
| 1025 Cheques in Hand | 0 | +10,000 | **−10,000** | 0 |

Equal and opposite, so **the trial balance still balances** — which is why
three accounting audits did not see it. AR is overstated by the full amount of
every bounced cheque, and `1025` is driven negative.

**Six call sites share the shape**, each posting a mirror *and* calling
`markReversed`: payment dishonour (`payment.service.ts:544`, `:589`), invoice
VOID (`invoice.service.ts:334`), asset disposal reversal
(`fixed-asset.service.ts:363`), payroll run reversal
(`payroll-run.service.ts:573`), and the generic
`JournalEntryService.reverse()` (`journal-entry.service.ts:195`) which serves
manual entries and opening balances. Only the dishonour path was measured; the
others are read, not proven.

**Check this on the client's box before anything else** — if bounced cheques
have driven `1025` negative there, `GET /v1/reports/cash-exceptions` has been
flagging this defect all along and nobody read it as this:

```sql
SELECT l.account_code, ROUND(SUM(l.debit_amount - l.credit_amount), 2) AS balance
FROM journal_entry_lines l
JOIN journal_entries j ON j.id = l.journal_entry_id
WHERE j.posting_status = 'POSTED' AND j.book_type = 'PACCI'
  AND l.account_code IN ('1010','1020','1025','1030')
GROUP BY l.account_code ORDER BY l.account_code;

SELECT source_table, entry_type, count(*) FROM journal_entries
WHERE posting_status = 'REVERSED' GROUP BY 1, 2 ORDER BY 3 DESC;
```

**Two candidate fixes.**

1. **Stop writing `REVERSED`; let both entries stand.** The original really
   happened and belongs in its own period; the mirror is dated when the
   reversal happened. This is the same argument the JE-25 docblock already
   makes — marking an original REVERSED erases it from the period it was
   recognising. `reverse()`'s already-reversed guard moves to `reversedById`,
   and the UI badge reads `reversed_by` instead of the status.
2. **Keep `REVERSED`; stop posting the mirror.** Rejected: the original's
   effect then vanishes retroactively from its own period, so a bounce in
   April silently restates March.

**Option 1 is the recommendation**, and it is a phase of its own, not a patch.
It changes what `posting_status` means, which migration `0002` enforces with a
trigger permitting exactly one POSTED → REVERSED transition, and it reaches
six services plus the journal-entry list filter and status badge.

`apps/api/src/modules/payment/__tests__/tax-withheld.integration.test.ts`
carries a comment recording this at the exact place someone will next look,
and deliberately does **not** assert the post-bounce end state.

### Also open, and newly created here

- **`2071` / `2072` remittance is built (JE-29); `1240` has no relief path.**
  Tax withheld *from* the facility accumulates in `1240` as an advance of its
  own income tax and is only relieved when that tax is assessed — which this
  system does not model. Expect `1240` to grow across a tax year and be
  cleared by a manual JE at assessment. Not a defect; a documented boundary.
- **The withholding report is not a return.** A s.165 filing needs each
  payee's CNIC/NTN, which is not held anywhere: expense vouchers carry a
  free-text `vendor_name` and payroll withholding is against staff
  collectively. The screen says so on its face.
