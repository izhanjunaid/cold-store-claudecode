# 18 — Accounting Audit & Remediation (Phase 20)

**Date:** 2026-07-25 · **Branch:** `phase/20-audit-remediation` (off `phase/19-accounting-audit`)
**Scope:** a third audit round targeting the territory `docs/16` and `docs/17` never covered — payroll, fixed assets, employee advances, cash/bank/cheque mechanics, tax, expense vouchers, concurrency, and the presentation layer — followed by correctness-first remediation.
**Method:** graphify orientation, three parallel read-only exploration passes under a strict "report file:line, no judgment" mandate, then verification of every consequential claim against source and existing tests before any change.

Companion to `16_accounting_module_audit.md` and `17_accounting_audit_phase19.md`. Those findings were re-confirmed in place, not re-litigated.

---

## Verdict

The ledger core held up. The audit's central guarantee was verified exhaustively rather than assumed: **`postInTransaction` is the only production code that inserts journal rows** — no raw SQL, no repository wrapper, no migration, no trigger, nothing in `packages/` bypasses it. Every money column is `numeric(p,2)` (zero floats repo-wide), the operational write and the journal post always share one transaction, and all 22 JE templates have live production callers.

That is why this round surfaced blocked operations, a silent double-post, and one genuinely wrong figure — rather than widespread corruption.

**The most serious defect was not in the audit's findings at all. It was discovered during implementation.**

---

## 1. [P0] Every advisory lock in the system acquired nothing

All ten document-number generators serialised themselves with:

```sql
SELECT 1 AS _lock WHERE pg_advisory_xact_lock(hashtext($1)) IS NOT NULL OR TRUE
```

This acquires no lock. PostgreSQL folds the `OR TRUE` disjunction and never evaluates the call. **Verified directly:** inside a transaction, `pg_locks` shows **0** advisory locks held after that statement and **1** after a form that casts the result.

The idiom existed for a real reason — Prisma's `$queryRaw` cannot deserialise `void`, so the plain `SELECT pg_advisory_xact_lock(...)` throws — but the workaround compiled, ran, returned a row, and did nothing.

**How it surfaced.** A new payroll concurrency test kept returning two successes. Rather than guess, a standalone probe called the service twice concurrently and confirmed both `createDraft` calls succeeded; a direct `pg_locks` query settled the cause.

**Blast radius.** Nine of the ten generators were still safe, because a `@@unique` constraint sat behind them. `invoice_number` had only a plain `@@index` — so invoice numbering had **no concurrency protection of any kind**, for the entire life of the system. Two invoices finalized in the same month at the same moment could take the same number, and an invoice number is what a customer quotes in a dispute.

**Worth noting for future audits:** the pre-existing lot-number concurrency test ("5 concurrent creates → unique numbers") passed throughout. It was green on the unique constraint, not on the lock it named. A concurrency test that only asserts the winner cannot detect a broken lock.

**Fix.** `apps/api/src/common/advisory-lock.ts` wraps the working form; all ten call sites route through it. An integration test asserts the lock is genuinely held, released at commit, and actually serialises two transactions — plus a regression case pinning that the legacy idiom acquires nothing. A CI gate fails on any raw `pg_advisory_*` call outside the helper.

---

## 2. [P0] Advance-cheque dishonour posted the wrong reversal

`JE-06` was a fixed `DR party AR / CR bank` shape with no advance branch, and `dishonour()` gated only on payment method — never on `isAdvance`.

An advance credits `2010 Advance Receipts` (JE-03); only *applying* it moves the money to AR (JE-04). So dishonouring an unapplied advance left the advance liability standing **and** invented a receivable: a misstatement of **twice the cheque**, on both sides of the balance sheet, that still balanced so no integrity check fired. `markReversed` then cross-linked the entries, so the audit trail asserted a reversal that had not happened.

**The fix is narrower than the finding first stated, and the nuance matters.** For a *fully allocated* advance, JE-03 + JE-04 net to `DR bank / CR AR`, so the existing DR-AR reversal was already correct. The general rule is therefore: **DR 2010 for whatever is still unapplied, DR AR for whatever JE-04 already moved, CR bank for the total** — which collapses to exactly the previous behaviour when the payment is not an advance.

`record()` forces `allocations = []` when `is_advance`, and `allocate()` rejects LOAN targets, so every allocation an advance can carry went through JE-04. That makes the remainder exact rather than heuristic.

No test had covered it: the only advance test used `payment_method: 'CASH'`, which `dishonour()` rejects outright.

---

## 3. [P1] Expenses was the only financial module taking no row lock

`accrue()` and `pay()` read the voucher with `findFirst`, checked status, then posted. Two concurrent `pay()` calls both passed and both posted, crediting the bank twice for one voucher. Nothing downstream stopped it: JE-17A stamps the real voucher id, but `(source_table, source_id)` on `journal_entries` is an `@@index`, not `@@unique`.

The new integration test reproduced it — **both calls returned 201 before the fix**. Every other financial module (payments, invoices, loans, surcharges) already took `FOR UPDATE`; expenses was the outlier, which is what makes this a gap rather than a design choice.

---

## 4. [P1] Payroll could not be finalized with any deduction

Two defects, split by whether the accounting semantics were defined.

**JE-15B had no `2070` line at all**, and `finalize` never passed tax to it, so any daily-wage run carrying income tax failed the balance check and could never leave DRAFT. Fixed properly — the account exists and JE-15 already does it.

**`other_deductions_pkr` never reached the journal entry.** `finalize`'s reduce omitted it while net pay already nets it out, so the entry was short by exactly that amount and threw `JOURNAL_UNBALANCED` — a message that tells the accountant nothing. It now accumulates the value and rejects with `PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED`.

**It was deliberately not given an account.** `docs/09` §1324 defines the column as *"Advances repaid, etc."* Recovering an advance should credit an employee **receivable**; crediting a liability instead would leave the receivable standing while inventing an obligation — the identical receivable-plus-liability error as finding 2, and one that *balances*, so no invariant would catch it. Employee advances do not exist yet, so there is no correct account to credit. This is a **partial fix, stated as such**: the common case and daily-wage tax now work, and other-deductions is refused honestly instead of failing cryptically.

---

## 5. [P1] The cost side was terminal — no correction path existed

Once a payroll run was finalized or an asset disposed, no cancel, reverse or un-dispose existed anywhere. `JournalEntryService.reverse` rejects any entry whose `sourceTable` is not `manual`/`opening_balances` — and payroll/fixed-asset templates stamp their own. That restriction is deliberate (system entries are corrected through their own flow); the gap was that these two were never given one. For payroll it compounded: the duplicate-period guard then blocked creating a corrected replacement, so a wrong run poisoned its month permanently.

Both now follow the invoice-VOID pattern from phase/19 — post a reversing entry, cross-link both ways, move the record to a reversed state — preserving ledger immutability rather than mutating posted rows.

- `POST /v1/payroll-runs/:id/reverse` (`payroll.reverse`, OWNER) — reverses all of the run's entries together, opposite to posting order. Status → `REVERSED` (migration `0012`). A reversed run no longer blocks a replacement, and the number generator continues that month's sequence.
- `POST /v1/fixed-assets/:id/reverse-disposal` (`fixed_assets.reverse`, OWNER) — reverses JE-14 and restores the asset. Prior status is derived: `commission()` is the only writer of `depreciation_start_date`, so its presence means IN_SERVICE. Accumulated depreciation needs no repair — the mirror debits the contra straight back.

Tests assert the strong property, not just the happy path: **every account the original entry touched nets to exactly zero** once the mirror is posted.

---

## 6. [P1] One account map, four copies — two of them in the browser

The canonical payment-method → account map lived in the API's journal templates and was used only by the payment module. Peshgi kept its own copy; expenses, payroll and fixed assets hardcoded `'1020'` defaults; and the **browser carried two copies** of `method === 'CASH' ? '1010' : '1020'`, which silently mis-routes anything that is not CASH (MOBILE_WALLET belongs to 1030).

A real divergence was fixed while unifying: `allocate()` and `dishonour()` fell back to `'1010'` when a payment's stored `asset_account_code` was null, while the map routes CHEQUE to `'1020'` — so a legacy cheque row could credit cash on a loan reversal. Both now derive the fallback from the payment's own method.

Routing now lives in `packages/shared/src/accounting-accounts.ts`. Account codes that are part of a template's accounting *definition* (2010, 2040, the 1010 in JE-17C) deliberately stayed with their templates.

---

## 7. Document numbering

- **`invoice_number` gained a unique constraint** (migration `0011`). It was the only document number without one. The migration deliberately fails on apply if duplicates exist — choosing which historical document gets renumbered is a data-repair decision, not something a migration should guess. **The pre-check query is in the migration banner and must be run against production before deploying.**
- **Invoice and expense numbering moved to UTC.** phase/19 fixed this for journal entries; both other generators were missed. Same defect class: a document raised near a month boundary on a non-UTC server is numbered into a different month than the period it posts to.
- **Invoices are numbered from their own date**, not the wall clock at finalize, so a backdated invoice joins its own month's sequence. The advisory lock is keyed off the same date, so lock and number always agree on which month is being extended.

---

## 8. Corrected during the audit

Two classifications were revised as evidence arrived. Both are recorded because the reasoning matters more than the conclusion.

**Cheque recognition (P1-12) — first called a policy, actually an unimplemented requirement.** The behaviour (cheques booked to bank as `CLEARED` on receipt, `PENDING` never assigned, `cheque_date` never read) was initially filed as a deliberate choice, reconciled against a passing test that asserts exactly that. **The spec was not checked, and it says the opposite:**

- §258 — the JE-02 debit table reads `CHEQUE | 1020 Bank Account **(on clearance)**`
- §364 — a post-dated cheque is to be recorded with `clearance_status = PENDING`
- §365 — *"**Do NOT post JE-02 until the cheque clears.** This prevents the bank balance from being overstated."*
- §372 — `clearance_status ENUM('NA','PENDING','CLEARED','BOUNCED')` is a **required** data-model addition

So `PENDING` is unused because the requirement was never implemented, not because anyone declined it — and the spec states the exact consequence the audit had derived independently. **No "policy" note was written into the docs**, because recording the current behaviour as intended would entrench the defect. It remains unfixed (it is a new capability, outside this phase's correctness-first scope) and is the strongest candidate for the next batch.

One genuine spec inconsistency to settle when implementing: §262 says the entry "is created on receipt date but flagged `pending_clearance = true`", contradicting §258 and §365. The post-dated block is unambiguous; ordinary-cheque treatment needs a decision. **The code satisfies neither reading.**

**`invoice_number` (P2-0a) — revised upward from P2 to P1** once the advisory lock was proven inert. Rated P2 on the assumption the lock worked and the missing constraint was defence-in-depth; with neither in place, it was the most exposed document number in the system.

---

## 9. Deliberately not done

- **No web UI** for the two reversal endpoints — the presentation layer was scoped out of this phase.
- **No depreciation-run reversal** — `DepreciationScheduleStatus` has no `REVERSED` member; a separate change.
- **No `2050` holding account** for payroll other-deductions — see finding 4.
- **No cheque-clearing model** — see finding 8.
- ~~Employee advances~~ — **built in Phase 21** (docs/19). GST settlement (2020 is credited forever and never debited), contra/cash-book vouchers, a cash-negative guard, the `number_format` setting being wired to nothing, and PDF money formatting all remain open. The full backlog with severities lives in the phase plan.

---

## Verification

TypeScript-checked (api + web + shared) and covered by unit and integration tests, each written first and watched fail. Two Prisma migrations: `0011` (invoice-number unique) and `0012` (payroll `REVERSED` status).

**Suite after this phase: 209 unit + 486 integration (api) + 99 unit (web) green** — up from 200 / 468 / 99.

Known flake, unrelated: `password-reset.integration.test.ts` and `placement.integration.test.ts` can hit the 15 s `hookTimeout` when the whole suite runs on a loaded machine; both pass in isolation. `eslint` is not installed in this workspace, so `pnpm typecheck` plus the CI grep gates are the enforced gates.

**Open for production:** run the duplicate-invoice-number query in the `0011` migration banner before deploying. Dev returned clean but holds zero invoices, which proves nothing.
