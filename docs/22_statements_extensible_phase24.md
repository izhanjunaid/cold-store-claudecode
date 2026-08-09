# Statements Extensible, Statement Leak Fixed, Cash Exceptions (phase/24, 2026-08-09)

Branch `phase/24-statements-extensible`, off `phase/23-coa-hardening`. One migration
(`0015`).

This phase exists because a self-correction was warranted. Phase 23's write-up
(`docs/21`) deferred making the Chart of Accounts' statement grouping extensible, and
justified it in part with a claim — *"presentational, not a misstatement"* — that
turned out to be false. The operator pushed back specifically on that reasoning
("*it's currently unreachable* — the Add Account dialog hardcodes `account_type:
'DETAIL'*"), and re-examining it under that pressure surfaced a real numeric defect
that had shipped with no test catching it, plus two mis-specified reasons for the
original deferral. This document is deliberately explicit about what was wrong in
`docs/21`, not just what phase/24 built.

## What was wrong in the phase/23 write-up

**"The gap has zero current victims" was circular.** The API accepted
`account_type: 'HEADER'` with no restriction the whole time — three integration tests
proved it end to end, at the `accounting.manage_accounts` permission owners hold by
default. The only reason nobody had hit the gap is that the UI hardcoded the one
literal that prevented reaching it. Citing the absence of victims as a reason not to
fix the cause of that absence was backwards.

**"Presentational, not a misstatement" was false.** `total_unclassified_pkr` entered
`net_profit_pkr` and *nothing else*
(`financial-statements.service.ts:64,93,104` as they stood before this phase). Any
P&L-class account the hardcoded header rollups failed to place left
`operating_profit_pkr`, `ebitda_pkr`, and every margin percentage **wrong** —
`net_profit_pkr` was the one figure that happened to be correct. EBITDA is a number a
bank reads. `accounting.integration.test.ts:632` already asserted the correct
identity (`net_profit_pkr ≈ operating_profit_pkr + total_other_income_pkr`) — it
passed only because the shared fixture had no unclassified activity, the same shape
as a concurrency test that stays green only because nothing ever raced it.

## Part 1 — The leak, fixed

`financial-statements.service.ts` — unclassified P&L accounts now fold into the
subtotal their class belongs to (REVENUE → operating revenue, COST_OF_SERVICE → cost
of service, EXPENSE → operating expense), not just the bottom line. There is no
judgement call here the way there is on the balance sheet: `accountClass` maps 1:1
onto a P&L subtotal. `net_profit_pkr` is mathematically unchanged; every subtotal
above it is now correct instead of merely present in the response.

Proved the fix mattered the way the advisory lock was proved in phase/23: reverted it
and re-ran the new assertions. `operating_profit_pkr` and `ebitda_pkr` read `0`
instead of `-500` with an unclassified expense posted; `total_operating_revenue_pkr`
read `0` instead of `800` with an unclassified revenue account posted. New coverage
included a revenue-side case the existing F-6b tests never exercised — a distinct
code branch (credit-normal, added directly) from the expense/cost side (debit-normal,
subtracted as a magnitude).

The balance sheet's current/non-current split is a genuine accounting judgement a
parent link cannot answer, so it is **not** auto-placed — but the existing test
assertion for it was still wrong (`current + non_current ≈ total`, omitting the
unclassified term that the code has always added to the grand total). Fixed the test
to the true identity, not the code.

Also closed a related trap: a HEADER nested under another HEADER would have orphaned
its own children (`buildGroups` matches exactly one level), even though nothing
prevented constructing one. `coa.service.ts` now rejects a HEADER given a parent.

## Part 2 — `statement_section`, and the chart becomes genuinely extensible

Migration `0015`: nullable `StatementSection` enum column on `chart_of_accounts`,
backfilled on the 12 seeded headers — a 1:1 mapping onto the nine arrays it replaces.
Verified against the live DB, not just read from the trigger definition: the
migration applied cleanly, and a standalone `UPDATE ... SET statement_section` on
`1000` — a header with posted DETAIL children — was neither blocked by
`guard_chart_of_accounts` nor by the live API (flipped and restored through
`PATCH /v1/accounting/accounts/6000` in a test, not just SQL).

`financial-statements.service.ts`'s nine hardcoded header-code arrays are gone,
replaced by `sectionHeaders(accounts, section)` — a lookup, sorted ascending, that
reproduces the old arrays' order exactly so response shape and group order are
unchanged for every existing consumer. Validation in `coa.service.ts` + the shared
schema: a section only on a HEADER, matching that header's class, never on EQUITY
(equity aggregates by class, not by header — phase/19's design, unchanged).

The web Add Account form gained a Type field (Detail / Header). Choosing Header swaps
the Parent selector for a Statement Section selector, filtered to the sections valid
for the chosen class; EQUITY shows a disabled, explained field rather than an empty
one. Leaving the section unset is a first-class choice — the account still creates,
into the unclassified bucket, exactly as every header did before this column existed.

## Part 3 — Cash exceptions, replacing a guard that was never rebuilt

Re-examining P1-6 (`docs/20_audit_backlog.md`) alongside the statement question
surfaced that its deferral reasoning was *also* incomplete: **no overdraft facility
is modelled anywhere in this system**. A bank running-finance facility is standard in
Pakistani agri business, and a negative `1020` under one is legitimate — the reverted
guard's premise ("a debit-normal balance below zero is physically impossible") holds
for `1010`/`1030` and is false for `1020`. Separately, a hard block is the wrong
enforcement for the failure mode it was guarding against: if the ledger says zero but
real cash exists, refusing the posting means the operator cannot record what actually
happened — an unrecorded transaction is worse than a visible negative balance.

`GET /v1/reports/cash-exceptions` catches the same control failure — an unrecorded
deposit, or a payment that never happened — as a detection report instead of a
posting-time block. The cash set is derived from `1000`'s children, never a hardcoded
code list. Gated on `reports.financial` (ACCOUNTANT+), alongside receivables aging
and party statements. Proved the design point directly in the test: posting an entry
that drives `1030` negative **succeeds** (201), and the report flags it afterward —
nothing in this feature ever rejects a transaction.

The four `describe.skip` tests from the original P1-6 attempt stay skipped; their
premise needs splitting per account (never guard 1020 without an overdraft-limit
concept) before they're the right spec for anything.

---

## What's still deliberately not built

- **A posting-time cash-negative guard.** Superseded by the detection approach above,
  not merely deferred — building the original guard would now be a regression against
  a documented decision, not a missing feature.
- **An overdraft-limit setting.** Would be the prerequisite for ever guarding `1020`
  specifically. No current requirement names one.
- **Nested headers, nested sections, more than one level of the hierarchy.** The chart
  is one level deep (HEADER → DETAIL) by construction; extending that is a materially
  bigger change than anything in this phase and nothing has asked for it.

## Suite

217 unit + 521 integration (api) + 131 unit (web), zero regressions across all five
phases.
