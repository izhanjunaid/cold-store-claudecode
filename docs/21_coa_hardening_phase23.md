# Chart of Accounts — Audit & Hardening (phase/23, 2026-08-07)

Branch `phase/23-coa-hardening`, off `phase/22-audit-backlog`. Zero migrations.

Driven by four operator concerns about the Chart of Accounts. This document records
what was found, what was fixed, and — as importantly — the two concerns that turned
out to be non-problems and the one real gap that was deliberately **not** closed.

## Verdict

The CoA's accounting model is sound. Double-entry is enforced at three layers, posted
entries are immutable by DB trigger, contra accounts are modelled correctly (normal
balance is independent of class), header accounts are unpostable, and opening balances
post a real balanced journal entry rather than living in a shadow table.

One genuine correctness defect was found — it was in no backlog — plus a cluster of
frontend gaps that made the whole area *feel* broken.

---

## 1. Cash & Bank — no change (concern dissolved)

**The accounts are already separate.** `1000 Cash & Bank` is a HEADER: it holds no
balance and cannot be posted to. The real accounts are three independent DETAIL
accounts — `1010` Cash on Hand, `1020` Bank Account — Main, `1030` Mobile Wallet
Receipts — each with its own balance, GL drill-down and trial-balance row.

What is grouped is the **presentation**, and grouping is correct: IAS 1 / IAS 7 require
"cash and cash equivalents" as one face-of-statement line with composition disclosed.
QuickBooks, Xero and SAP all do the same. Splitting them into two balance-sheet
sections would be non-standard and would add nothing the GL doesn't already give.

The two things an operator usually *means* by this request are already on record and
remain deferred: **bank reconciliation** (`docs/16` Gap 6) and **`1025 Cheques in Hand`**
(`docs/20` L98-111, blocked on the P1-12 cheque-recognition model — today a cheque hits
1020 immediately, so the bank balance includes uncleared cheques).

## 2. Opening balances — logic correct, concurrency defect fixed

**The accounting was already right**: separate non-negative `debit_amount` /
`credit_amount` columns (never a signed amount), single-side enforcement at service, posting
path and DB CHECK constraint, plug arithmetic that balances by construction, a service
balance check, and a *deferred* `guard_journal_entry_balanced` trigger firing at commit.
Plugging to `3010 Owner's Capital` instead of a dedicated "Opening Balance Equity"
account is a documented policy decision (`docs/17` Finding 17) and the right one — a
separate OBE account that must be manually cleared later is a well-known source of
stale suspense balances in QuickBooks migrations.

**The defect was the one-shot guard.** `opening-balance.service.ts` did a `findFirst`
for an existing POSTED entry and then posted — inside a transaction, but with no row
lock, no advisory lock, and **no unique constraint behind it** (`@@index([sourceTable,
sourceId])` is an index, not a unique). Under READ COMMITTED two concurrent POSTs both
saw nothing and both posted.

The consequence would have been two POSTED opening entries, both immutable by trigger,
permanently doubling every opening balance — AR aging, party statements, balance sheet,
cash position — while `getStatus` returned the newest and the screen looked correct.
Recovery would require an OWNER reversal with the period reopened.

Same class of race the ten document-number generators were repaired for in phase/20;
this path was missed. Fixed with `advisoryXactLock` (`bc226e2`).

> The regression test **asserts the loser** — exactly one 201 and one 409, plus a count
> of one posted entry. Verified in both directions: with the lock removed it reports
> `[201, 201]` and fails. Per CLAUDE.md, the lot-number test that asserted "all 5
> succeeded" stayed green for years while its lock did nothing.

## 3. Account pickers were blind to the chart (`558b5ea`)

Four screens held literal account lists, so an account created through the Chart of
Accounts screen never appeared where it would actually be used — a create path with no
matching read path:

| Screen | Was |
|---|---|
| `expenses/new` | literal 12-entry `EXPENSE_ACCOUNTS` array |
| `expenses/[id]` | literal 1010 / 1020 |
| `fixed-assets/new` | literal 1020 / 1010 / 2110 |
| `payroll/runs/[id]` | **no picker** — `from_asset_account_code: '1020'` was a bare literal |

All four now read a shared `useAccounts()` hook (added beside the existing
`useParties`/`useChambers` reference-data hooks), returning active DETAIL accounts.

> **The hardcoded list was half right, and only running the app showed which half.**
> Replacing it with "every EXPENSE/COST_OF_SERVICE account" re-exposed 11 accounts the
> old list had deliberately omitted — 5030/5035/6010/6015 (posted by the payroll run),
> 5040/6120/6130/6140 (depreciation run), 6110 (asset disposal), 6080 (JE-08), 6150
> (spoilage). A manual expense voucher against any of them double-counts against the
> automated entry. What was worth keeping was the **policy** (which accounts a human may
> book to), not the **inventory** (what the chart contains). `AUTOMATED_COST_ACCOUNTS`
> now encodes that policy, so the picker shows the original 12 plus anything added later.
> The stubbed unit test could not have caught this — it asserted the filter did what it
> was written to do.

Behaviour is preserved where money moves: every cash/bank picker still defaults to
`DEFAULT_BANK_ACCOUNT_CODE`, so an untouched payroll run or expense payment posts
exactly as before. Payroll is additionally constrained to children of `1000` — salaries
must not become payable from an arbitrary detail account. Fixed assets keep the
liability option (2100's children): buying an asset on equipment finance was a real
path a cash/bank-only filter would have removed.

## 4. Add Account rebuilt (`8b9e384`)

The form asked for the **account code first** — a blank field with only a placeholder —
while the code depends on the parent and the normal balance depends on the class. It
asked for derived values before their inputs.

Fields now follow the dependency graph: **Class → Parent → Name → Code**, with normal
balance behind an Advanced disclosure (it exists only for contra accounts).

**Codes are prefilled, not auto-generated.** `suggestNextCode()` offers the next free
slot in the chosen parent's block and the field stays editable. Full auto-assignment was
rejected because `guard_chart_of_accounts` plus the JE-line FK's `ON UPDATE RESTRICT`
make a code permanent once the account has postings — a silently-wrong auto-assignment
could never be corrected, and `docs/16` item 7 records renumber/merge tooling as a
deliberate *never build*. When the suggester cannot place a code with confidence (block
full, or the next slot would cross into the following header's range) it returns nothing
rather than guess. **That branch is the one under test**: the unique constraint catches
duplicates, never a code filed under the wrong heading.

Also fixed a genuinely dead state: filtering the table to a class then opening "Add
account" reset the draft to ASSET while the parent dropdown drew from the
already-filtered list — leaving it empty and the submit button permanently disabled with
nothing on screen explaining why.

Plus inline validation mirroring the server's rules (duplicate code, foreign class
range, missing fields), a search box, `maxLength` on the code, and one `CLASS_LABEL` map
for both dropdowns — which previously disagreed ("Cost of Service" vs "COST OF SERVICE").

## 5. Opening-balance traps

- **`1030 Mobile Wallet` now has a labelled field.** The request shape only carries
  `cash_pkr` → 1010 and `bank_pkr` → 1020, so 1030 was reachable only by knowing to pick
  it out of the "Other" dropdown. It now has its own box in Cash & Bank and rides in as
  an `other_line`; the three cash accounts are excluded from the Other dropdown so the
  same balance cannot be entered twice. No API change.
- **Period-lock warning.** Opening balances are backdated by nature and
  `postInTransaction` asserts a closed-through watermark, so after the first month-end
  close both entering *and reversing* them fail with `PERIOD_LOCKED` until an OWNER
  reopens the period. The screen now warns when the as-of date falls at or below the
  watermark, before the form is filled in.
- **Opening client advances remain unsupported** — `party_receivables` is positive-only,
  so a party who prepaid has no home. Already accepted in `docs/17` Finding 17; left as
  a product decision, not a defect.

---

## Deliberately not done

**Extensible statement sections.** The balance sheet's section structure is a hardcoded
list of header codes (`['1000','1100','1200']`, `['1300']`, `['2000']`, `['2100']`) and the
UI does not expose HEADER creation. The `parent_account_code` hierarchy exists in the data
but the statements don't walk it generically, so a custom header's children fall into the
`unclassified_*` bucket.

Not closed, for four reasons: the gap has **zero current victims** (the UI cannot create a
header, so nobody has hit it); the failure mode is **cosmetic, not numeric** — the F-6b
fallback keeps the sheet complete and `is_balanced` true; the current/non-current split is
a **genuine accounting judgement** that cannot be inferred from a parent link and is already
made correctly once; and it would be the **highest-risk change** in the set — a migration
on a trigger-guarded table altering the statement every audit tie-out depends on — bought
against the weakest evidence of need.

The deferral is cheap to reverse: a nullable `statement_section` column and ~30 lines.
**Revisit when** an owner needs a section that doesn't exist, or a second facility needs a
materially different chart. Documented in `docs/09` §2 so the constraint is visible rather
than implicit.

**P1-6 cash-negative guard** stays deferred, but `docs/20`'s reasoning was corrected: the
claim that "no facility ever establishes an opening cash position" is operationally true
but literally false — `cash_pkr`/`bank_pkr` have posted to 1010/1020 since Gap 1 shipped.
The blocker is narrower than recorded (the flow is optional and no fixture invokes it), but
the 57-test blast radius is unchanged, so re-opening it remains a scoping decision.

Also corrected in `docs/20`: **P2-11, P3-2 and P3-5** were marked OPEN in the tables while
the Batch H notes recorded them shipped. All three re-verified against source and flipped.

## Multi-currency / multi-company

**Multi-currency: no.** No currency field exists anywhere; every money field is `_pkr`.
Adding it means transaction + functional currency and a rate on every line, FX gain/loss
accounts, period-end revaluation, reporting-currency translation, and renaming the entire
money surface. That is a rewrite of the money layer, not a feature, for one facility
trading in PKR. The `Decimal(14,2)` columns and derived-balance design don't obstruct it
later.

**Multi-company: already supported at the data layer.** `facilityId` is on
`chart_of_accounts`, codes are unique per facility, and the composite FK
`(facility_id, account_code)` makes it structurally impossible for a JE line to reference
another tenant's account. What's missing is product — facility switching, consolidated
statements, intercompany elimination — not architecture.

> **Watch item:** the seed *copies* the chart per facility, so N facilities means N
> independently drifting charts with no way to push a change to all. The fix (global
> template + per-facility overlay) is a real restructure — not warranted for one facility,
> but expensive if deferred past facility #3.
