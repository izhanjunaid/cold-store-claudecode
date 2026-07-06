# 16 — Accounting Module Audit (Post-Implementation)

**Date:** 2026-07-06
**Branch audited:** `phase/13-production-financials` (commit `851d90e`)
**Auditor:** Claude (senior accounting-systems review, code-level)
**Counterpart document:** `15_accounting_audit.md` was the *pre-implementation* spec review; this document audits the **implemented system** — code, schema, and live dev database.

**Evidence key** used on every finding:
- **VERIFIED** — the auditor read the cited code/SQL directly, or confirmed empirically against the live dev database.
- **CORROBORATED** — reported identically by two independent exploration passes with quoted code, not re-read line-by-line by the auditor.
- **INFERRED** — a conclusion that follows from verified facts but was not itself directly observed.

---

## 1. Executive Summary

The accounting engine's *application layer* is genuinely well-built: one atomic posting path, no delete endpoints anywhere on financial records, corrections modeled as compensating entries, and status-gated edits. The dominant risk pattern is that **every guarantee lives in that single application layer, while the database enforces nothing and records nothing** — so the system is honest as long as every write goes through the intended code path and nobody ever needs to *prove* it was honest.

Top risks, ranked (data integrity > compliance > usability):

| # | Risk | Severity |
|---|------|----------|
| R1 | **No audit trail on any financial record.** Audit triggers cover only `users` and `facilities`; journal entries, CoA, invoices, payments, and period locks leave no change history — and the spec claims otherwise. | Critical |
| R2 | **The audit log that does exist is silently rewritable.** The app's DB role owns `audit_log`, RLS is not forced, no UPDATE/DELETE is revoked, and `DELETE` isn't even a loggable action. Attribution is also broken: the `SET LOCAL app.user_id` call is a no-op, so `changed_by` is always the zero UUID. | Critical |
| R3 | **Ledger immutability and balance are enforced by exactly one app method; the DB permits anything.** No CHECK constraints; a posted journal entry can be hard-deleted at SQL level and its lines CASCADE away while the owning invoice is silently orphaned (`SET NULL`). | Critical |
| R4 | **Period close is structurally weak and practically unusable.** Per-month locks (never-locked months stay open forever), a single enforcement point, re-locking erases the unlock audit trail — and there is **no UI at all**, so in practice periods are never closed. | High |
| R5 | **Credit notes can over-credit a paid invoice** (`&&` where the logic needs `≤ balance due`), driving `amount_paid > total`, negative AR, and wrong party statements. Confirmed logic bug. | High |
| R6 | **User-created accounts can silently vanish from the P&L and Balance Sheet.** Account creation doesn't validate the parent; statements roll up only hardcoded header codes. The trial balance will include the account, the statements won't — and nothing warns. | High |
| R7 | **Manual journal entries default to a draft state that can never be posted.** No promotion endpoint exists and every report filters `POSTED` — a "saved" entry silently never enters the books. | High |
| R8 | **No segregation of duties, and the KATCHI (off-book) gate is inconsistent.** OWNER can do everything end-to-end (expected in this business, but the compensating control — the audit trail — is R1/R2). KATCHI entries are OWNER-only on five endpoints but reachable by ACCOUNTANT via payments and by OPERATOR via lots; KATCHI reports are visible to any ACCOUNTANT. | High |
| R9 | **Chart-of-accounts wiring is hardcoded with silent fallbacks, and only 5 of ~84 accounts are protected.** Deactivating `1010 Cash` (one click for OWNER, no dependency check) bricks every cash posting in the facility; unknown enum values silently misclassify into fallback accounts. | Medium |
| R10 | **Cheque dishonour hard-deletes subledger rows** (allocations, loan repayments) — the GL is correctly reversed, but the operational history of what was unwound is destroyed, unaudited. | Medium |

The single highest-leverage fix is **R1+R2 together**: extend the existing `audit_trigger_fn` to financial tables, fix attribution, and make `audit_log` append-only via a non-owner runtime DB role. In a 3–6 person facility, real segregation of duties (R8) is impossible — a tamper-evident audit trail is the compensating control the whole design leans on, and it currently isn't there.

---

## 2. Methodology

**What was examined.** Backend accounting engine (`apps/api/src/modules/accounting/` — CoA, journal entries, GL, financial statements, period locks, credit notes, bad debt), all posting subledgers (`invoice`, `payment`, `expenses`, `peshgi`, `payroll`, `fixed-assets`, `service-charge`), RBAC (`plugins/auth.ts`, route `preHandler`s), the full DB schema (`packages/db/prisma/schema.prisma` + the rebaselined `20260101000000_baseline/migration.sql` — the only migration), the CoA seed (`packages/db/prisma/chart-of-accounts.ts`), the accounting frontend (`apps/web/src/app/(app)/accounting/**`, invoices, payments, loans, expenses screens), and the specs (`docs/09_accounting_spec.md`, `docs/15_accounting_audit.md`) for spec-vs-code comparison. Worktree copies under `.claude/worktrees/` were excluded.

**How.** Three parallel code-exploration passes (core engine; subledgers/RBAC/audit trail; frontend), followed by direct re-reading of every load-bearing code fragment by the auditor, plus **empirical catalog queries against the live dev database** (`pg_trigger`, `pg_constraint`, `pg_class.relrowsecurity/relforcerowsecurity`, `pg_roles`, row counts). Findings below cite `file:line` as of commit `851d90e`.

**Applicable standard.** The system self-declares **IFRS for SMEs, simplified, on a cash-and-accrual hybrid**, Pakistan jurisdiction (`docs/09_accounting_spec.md:30-33`). The code corroborates this: single currency PKR (every monetary column is `*_pkr Decimal(_,2)`; no currency/FX columns exist anywhere in the schema), Pakistani GST modeled as a recordable-but-not-enforced output-tax liability (account 2020, invoice `gst_rate` defaulting 0%), Urdu bilingual fields, Lahore default facility. This is consistent with Pakistan's Companies Act 2017 framework, under which non-listed SMEs report under IFRS for SMEs (or AFRS for Small-Sized Entities for very small companies — the difference does not change any finding here). Where IFRS-for-SMEs and full IFRS/GAAP would diverge (inventory costing, revaluation, leases), the system holds no inventory of its own and owns simple fixed assets on cost less straight-line depreciation, so the divergences are not engaged — with one exception noted in Finding F-16 (revenue accrual timing) and one accepted simplification (direct write-off for bad debts rather than an allowance/impairment model, acknowledged in the spec and acceptable at this scale on materiality grounds).

**Principles evaluated against:** double-entry integrity, immutability of posted records (with corrections via reversal), accounting-period cut-off, completeness/faithful representation of statements, consistency of presentation across periods, auditability (who/when/before-after, tamper-evidence), and segregation of duties with compensating controls.

---

## 3. What Is Sound

These were verified and are called out deliberately — the report should not read as if the module is broken end-to-end. It is not.

- **One posting path, atomic, guarded.** Every GL write in the system flows through `JournalEntryService.postInTransaction` (`journal-entry.service.ts:32-121`), inside the same DB transaction as the source-document mutation. It enforces: ≥2 lines, non-negative amounts, no line with both debit and credit, no zero lines, SUM(debit)=SUM(credit) within 0.005, period-lock check, and account exists / is active / is not a HEADER. **VERIFIED.**
- **No delete endpoints on financial records — anywhere.** Journal entries, invoices, payments, expense vouchers, loans, payroll runs, and fixed assets have no DELETE routes. The only DELETEs in the API are draft-invoice line items and soft-deactivations (party, rate plan, service charge, lot). **VERIFIED** (route sweep, corroborated twice).
- **Corrections are compensating entries, not edits.** Credit note → JE-05; cheque dishonour → JE-06 plus per-loan JE-19 reversals with the original entries flipped to `REVERSED` and cross-linked via `reversed_by_id` (`payment.service.ts:439-505`); bad-debt and peshgi write-offs post new JEs and leave originals untouched. This is the correct accounting pattern. **VERIFIED.**
- **Posted documents are edit-locked at the service layer.** All invoice mutations guard `status !== 'DRAFT'` (`invoice.service.ts:109,135,159,183`); expenses likewise. **VERIFIED.**
- **Accounts with history cannot be deleted.** No delete route exists, and the DB backs this up: `journal_entry_lines → chart_of_accounts` is `ON DELETE RESTRICT` (`migration.sql`, FK on `(facility_id, account_code)`). **VERIFIED.**
- **The CoA edit surface is minimal by design.** `PATCH /accounts/:code` accepts only `account_name` and `is_active` (`UpdateAccountRequest`, `schemas/accounting.ts:43-46`; `coa.service.ts:78-84`). Code, class, type, parent, and normal balance are immutable through the API. System accounts can't be deactivated (`coa.service.ts:75-77`). **VERIFIED.**
- **Deactivation cannot hide history.** Statement and trial-balance account loads apply no `is_active` filter (`financial-statements.service.ts:202-208`, `gl.service.ts:173-176`), so a deactivated account's historical balances still report. **VERIFIED.**
- **The frontend exposes none of the dangerous operations.** The CoA screen is read-only (GET only — no create/edit/delete controls exist in the web app at all); the posted-JE page has no edit/delete/reverse buttons; finalized invoices show no mutation affordances. Role-gating in the UI is explicitly documented as a courtesy mirror of backend guards. **VERIFIED.**
- **Period locks, where they apply, are honored by every posting flow** — invoice finalize, payments, expenses, peshgi, payroll, and depreciation all post through `postInTransaction`, which calls `assertOpen` (`journal-entry.service.ts:66`). Integration tests assert `PERIOD_LOCKED` on several of these. **VERIFIED** (single call site confirmed; transitive coverage corroborated by tests).

The findings below are about what happens *around* this well-built core: the database that doesn't back it up, the audit trail that doesn't exist, the period control nobody can reach, and a handful of concrete logic bugs.

---

## 4. Findings

Severity scale: **Critical** (silent corruption of books or destruction of evidentiary value), **High** (wrong financial statements or missing key control), **Medium** (integrity risk requiring unusual-but-plausible action), **Low** (latent/edge).

---

### F-1 · No audit trail on any financial record — **Critical** · VERIFIED (code + live DB)

- **Concept.** Every accounting-relevant mutation (CoA change, journal posting, reversal, period lock/unlock, invoice finalization, payment) is an event a facility must be able to reconstruct — for internal dispute resolution (the katchi/pacci culture this product serves exists *because* parties dispute records), for FBR tax scrutiny, and for the spec's own promises.
- **Principle.** Auditability: who, when, before-value, after-value, for every change to the books.
- **Mechanics.** The `audit_log` infrastructure exists and is well-shaped (`old_values`/`new_values` JSONB, `changed_by`, `changed_at` — `migration.sql:158-171`), but triggers are attached to exactly two tables: `audit_users` and `audit_facilities` (`migration.sql:1399-1405`). Confirmed against the live dev DB: `pg_trigger` lists only those two plus a drifted `audit_invoice_surcharges` (see Open Questions). There is no application-level audit writer either (`apps/api/src/common/` has no audit module). Additionally `AuditAction` is `ENUM ('INSERT','UPDATE')` (`migration.sql:5`) and the trigger function returns NULL on any other op — **row deletion is unloggable even on covered tables**.
- **Violation.** A CoA rename, a journal posting, a reversal, a period unlock, an invoice finalization — none leave any trace beyond the record's own current state. The spec explicitly claims otherwise: KATCHI changes "still trigger audit_log for technical security" (`docs/09_accounting_spec.md:622-627`) — this is **false in the implementation**. The migration's own comment acknowledges the gap ("extending audit/RLS coverage is a separate task", `migration.sql:1327-1329`) — the task was never done.
- **Fix (structural).** Attach the existing `audit_trigger_fn` to: `chart_of_accounts`, `journal_entries`, `journal_entry_lines`, `period_locks`, `invoices`, `payments`, `payment_allocations`, `credit_notes`, `expense_vouchers`, `party_loans`, `party_loan_repayments`. Add `DELETE` to `AuditAction` and declare triggers `AFTER INSERT OR UPDATE OR DELETE` (logging `to_jsonb(OLD)` on delete). This is a single migration reusing infrastructure that already exists — high value, low effort. Do this before any of the UI work below.

---

### F-2 · The audit log is rewritable, and attribution never works — **Critical** · VERIFIED (code + live DB, empirical)

Two independent defects that together zero out the evidentiary value of even the coverage that exists:

**(a) Tamper-evidence: none.**
- **Mechanics.** Empirically confirmed on the dev DB: the application connects as role `admin`, which **owns** `audit_log`; `relforcerowsecurity = false` on every table; the only policy is `FOR ALL`; no `REVOKE UPDATE/DELETE` exists anywhere in the migration. In PostgreSQL, a table's owner bypasses non-forced RLS entirely — so the very connection every request runs on can `UPDATE` or `DELETE` audit rows without restriction, and (per F-1) the deletion of an audit row is itself unloggable.
- **Violation.** An audit log that the audited connection can rewrite is not an audit log; it's a notes table. Tamper-evidence is the property the katchi/pacci dispute model and any tax examination actually depend on.
- **Fix (structural).** Run the application under a dedicated non-owner role with `INSERT`/`SELECT` only on `audit_log` (`REVOKE UPDATE, DELETE`). Migrations run as the owner role; the app does not. This also makes the financial-table immutability triggers proposed in F-3 non-bypassable in normal operation. Hash-chaining each row to its predecessor would add cryptographic tamper-*evidence*; at this scale it is optional — the role separation is the part that matters.

**(b) Attribution: broken by a silent no-op.**
- **Mechanics.** `auth.ts:21-23` runs `SET LOCAL app.user_id = '<uuid>'` via `$executeRawUnsafe` as a standalone statement. `SET LOCAL` outside an explicit transaction block is a documented no-op in PostgreSQL (it warns and discards). Even if it took effect, it would apply only to that statement's own connection/transaction — subsequent Prisma queries run on other pooled connections. Result: `audit_trigger_fn`'s `current_setting('app.user_id')` is always empty and **every audit row ever written attributes to `00000000-0000-0000-0000-000000000000`**.
- **Violation.** "Who" is half of auditability. Every existing audit row (users/facilities changes) already demonstrates the failure.
- **Fix (structural).** Set the GUC *inside* the same transaction as the audited mutation — e.g., a Prisma `$transaction` wrapper/extension that issues `SELECT set_config('app.user_id', $1, true)` as the transaction's first statement (parameterized — also removing the string-interpolated `$executeRawUnsafe`, which is an injection-shaped pattern even though the current input is a server-signed JWT claim). The same wrapper should set `app.facility_id`.

---

### F-3 · Ledger integrity is single-layered: the DB enforces nothing — **Critical** · VERIFIED (code + migration + live DB)

- **Concept.** The general ledger — the PACCI book in particular — is the facility's official record. The spec is explicit: posted PACCI entries "cannot be UPDATE'd or DELETE'd"; corrections go through reversals; and a "PostgreSQL trigger as second line of defense" enforces balance (`docs/09_accounting_spec.md:622-627, 645`).
- **Principle.** Double-entry integrity and immutability of posted records must hold against *every* write path, not only the intended one — that is the entire point of a second line of defense.
- **Mechanics** (all confirmed in the migration and empirically via `pg_constraint`/`pg_trigger` on the live DB):
  - **Zero CHECK constraints** on any financial table. Balance is enforced only at `journal-entry.service.ts:62-64`. Any direct SQL, script, or future code path that bypasses `postInTransaction` can insert an unbalanced entry, negative amounts, or a line with both debit and credit — and no report would flag it (the trial balance would simply not balance, silently).
  - **A posted journal entry can be hard-deleted with one SQL statement.** `journal_entry_lines → journal_entries` is `ON DELETE CASCADE`; the lines vanish with it. The owning invoice/payment references the JE with `ON DELETE SET NULL` — so the source document survives, now silently orphaned from the ledger, still claiming to be FINALIZED/CLEARED. Nothing in the DB and (per F-1) nothing in the audit trail records that this happened.
  - **`journal_entry_lines → chart_of_accounts` is `ON UPDATE CASCADE`** on `(facility_id, account_code)`: a direct-DB renumber of an account code rewrites every historical journal line to the new code, silently.
  - `journal_entries` has **no `updated_at` column** (`schema.prisma:832-846`) — even naive drift detection is impossible.
  - The only sanctioned mutation of a posted entry is `markReversed` (`journal-entry.service.ts:142-150`) — which itself would be indistinguishable, at the DB level, from any other `UPDATE`.
- **Violation.** PACCI immutability as implemented is "no route exists today." That is an accident of the routing table, not a control — one future endpoint, one support script, or one psql session away from silent history rewriting. The spec's promised trigger was never built.
- **Fix (structural, in priority order).**
  1. `BEFORE UPDATE OR DELETE ON journal_entries / journal_entry_lines` trigger: reject everything except the exact reversal transition (`posting_status: 'POSTED' → 'REVERSED'` with `reversed_by_id` being set, no other column changing) on entries, and reject all UPDATE/DELETE on lines of non-draft entries. With the non-owner app role from F-2(a), this is effectively non-bypassable in operation.
  2. A `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` validating `SUM(debit) = SUM(credit)` per `journal_entry_id` at commit — the spec's promised second line of defense.
  3. Add per-line CHECKs while at it: `debit_amount >= 0`, `credit_amount >= 0`, `NOT (debit_amount > 0 AND credit_amount > 0)`, `debit_amount + credit_amount > 0`.
  4. Reconsider `ON UPDATE CASCADE` → `RESTRICT` on the account-code FK (the app never renumbers; the DB shouldn't quietly permit it).
  This is deliberately *not* a recommendation to snapshot or version the ledger — the reversal model is right; it just needs the DB to actually stand behind it.

---

### F-4 · Period close: structurally weak, historically erasable, and unreachable — **High** · VERIFIED

- **Concept.** Period locking is the cut-off control: once a month is closed and reported (or handed to the tax adviser), its numbers must not move.
- **Principle.** Accounting-period cut-off and the integrity of issued reports.
- **Mechanics.** Four distinct defects:
  1. **Per-month lock rows, not a watermark.** `assertOpen` (`period-lock.service.ts:10-22`) only blocks months with an active lock row. A month nobody ever locked — including any month *before* the facility started locking — accepts backdated postings forever, even while later months are locked. Nothing enforces "everything up to X is closed."
  2. **Unbounded backdating for everyone who can post.** `entry_date` is validated only as `YYYY-MM-DD` (`schemas/accounting.ts:12,111`; passed straight through at `accounting.controller.ts:150`). The facility-level `backdating_max_days` policy **is** enforced elsewhere — but only on lot inbound/outbound, and only for sub-MANAGER roles (`lot.service.ts:284-291`, `outbound.service.ts:136-148`). Manual JEs require MANAGER+, i.e., exactly the roles the backdating policy exempts. Net: for the ledger itself, the period lock is the *only* temporal control.
  3. **Re-locking erases the unlock trail.** `lock()` on a previously-unlocked period overwrites in place: `unlockedAt: null, unlockedBy: null, reason: <new>` (`period-lock.service.ts:57-66`). The OWNER who unlocks a closed month (with a mandatory reason — good), backdates an adjustment, and re-locks leaves *zero evidence a reopen ever happened* — and `period_locks` has no audit trigger (F-1).
  4. **No UI exists.** No screen, nav entry, or API call in the web app touches period locks (verified sweep of `apps/web/src`). MANAGER+ can lock via raw API; in practice nobody will. Combined with #1, the realistic production state is: **no period is ever locked, and every month of history is permanently open to backdated postings.**
- **Violation.** Cut-off exists as a mechanism but not as a control: incomplete in model (#1), exempting exactly the empowered roles (#2), self-erasing (#3), and unreachable (#4).
- **Fix.**
  - *Structural:* replace (or supplement) per-month rows with a single **"closed-through" watermark date** per facility — `assertOpen` rejects any `entry_date <= closed_through`. This fixes #1 and is simpler than the current model. Keep `period_locks` rows as the historical record but make them **append-only events** (`LOCKED`/`UNLOCKED` rows, never updated) — fixing #3. Both belong behind the audit triggers of F-1.
  - *UI:* a period-close screen (see UX-1). Consider a soft prompt at month-end ("June is unlocked — close it?") rather than auto-locking; auto-lock would fight the real workflow of a facility that bills at month-end.

---

### F-5 · Credit notes can over-credit a paid invoice — **High** · VERIFIED (concrete logic bug)

- **Concept.** A credit note reduces what a party owes on an invoice — it must be bounded by what is still owed.
- **Principle.** AR faithful representation; a receivable cannot be negative via a revenue adjustment.
- **Mechanics.** `credit-note.service.ts:64`:
  ```ts
  if (total > balanceDue + 0.001 && total > Number(invoice.totalPkr) + 0.001) throw ...
  ```
  Both conditions must be true to reject. On a fully paid invoice (`balanceDue = 0`), a credit note up to the full invoice total passes the guard. The service then posts JE-05 (DR revenue / CR the party's AR account) and increments `amountPaidPkr` by the credit total (`credit-note.service.ts:137-140`) — yielding `amount_paid > total`, a negative balance-due, and a **credit balance sitting in an AR account** with no refund-liability recognition. The party statement and AR aging (which reconciles to GL 1110/1120/1130/1150) both go wrong.
- **Violation.** Mechanical: the guard's `&&` should conceptually be "exceeds what can be credited." If crediting already-paid invoices is an intended refund path, the accounting is still wrong — a refund owed is a liability (or at minimum a documented AR credit memo), not an over-decremented paid-amount.
- **Fix (structural).** Change the guard to `total > balanceDue + 0.001 → reject`. If the business needs refunds on settled invoices, build that as its own flow (CR Advance Receipts 2010 or a refund-payable account, with a payment-out to clear it) — don't widen the credit-note bound.

---

### F-6 · User-created accounts can silently vanish from the statements — **High** · VERIFIED

- **Concept.** The P&L and balance sheet must include every account with activity — completeness is not optional per-account.
- **Principle.** Completeness / faithful representation; the trial balance, P&L, and balance sheet must articulate.
- **Mechanics.** Two verified facts compose badly:
  1. `CoaService.create` (`coa.service.ts:48-68`) performs **no validation of `parent_account_code`** — not that it exists, not that it's a HEADER, not that its class matches the child's.
  2. Statements roll up **only DETAIL accounts whose `parent_account_code` is in a hardcoded header list**: P&L uses `['4000','4100']`, `['4900']`, `['5000']`, `['6000']`, `['4200']` (`financial-statements.service.ts:43-66`); the balance sheet uses its own literal set. `buildLines`/`buildGroups` (`:252-278`) simply filter by those parents.
  An OWNER creates an account with a typo'd parent (`4010` instead of `4000`), a nonexistent parent, or a new custom header (`7000 Financing Costs`) — creation succeeds, posting to it succeeds, the **trial balance shows it** (grouped by `account_class`, all accounts loaded), and the **P&L/balance sheet silently omit it**. Net profit is overstated/understated; the balance sheet stops articulating with the P&L; no error, no warning, no "unclassified" bucket.
- **Violation.** The statements can disagree with the trial balance by construction, and the failure mode is invisible precisely when a user exercises the CoA flexibility the product advertises.
- **Fix (structural, both halves).**
  1. Validate at create: parent must exist, be `HEADER`, and share `account_class` — reusing the lookup pattern already present in `postInTransaction:68-79`.
  2. Make statement generation **fail loudly on incompleteness**: after building groups, assert that every DETAIL account with a non-zero aggregated balance was placed; anything left over goes into an explicit "Unclassified" group (rendered with a warning) rather than being dropped. This also protects against future header-code drift.

---

### F-7 · Manual journal entries default into a draft black hole — **High** · VERIFIED

- **Concept.** A journal entry someone saved is either in the books or visibly pending — never silently neither.
- **Principle.** Completeness; no silent non-recording.
- **Mechanics.** `CreateManualJournalEntryRequest` defaults `posting_status` to `'AUTO_DRAFT'` (`schemas/accounting.ts:114`). There is **no endpoint that promotes a draft to POSTED** — the journal-entries controller exposes only GET-list, GET-by-id, and POST (`accounting.controller.ts:100-170`); no PATCH exists. Every report — GL, trial balance, P&L, balance sheet — filters `postingStatus: 'POSTED'` (`gl.service.ts:29`, `financial-statements.service.ts:224`). So: an API client that omits `posting_status`, or a user who picks "Save as Draft" in the JE form, creates an entry that passes all validation, gets a real entry number, appears in the JE *list* screen — and **never reaches any financial statement, ever**, with no path to fix it short of re-keying.
- **Violation.** The user's mental model ("saved = recorded") is broken exactly where trust matters most. `AUTO_DRAFT` appears designed for a review workflow (spec §6 implies it) whose second half was never built.
- **Fix (structural).** Add `POST /v1/accounting/journal-entries/:id/post` (MANAGER+, re-running `assertOpen` and account checks at promotion time — the period may have locked and accounts may have deactivated since drafting). Until that exists, change the manual-entry default to `'POSTED'` and have the UI treat draft as an explicit, labeled choice (see UX-2). Also surface a "Drafts pending" count on the accounting landing page.

---

### F-8 · No segregation of duties; audit trail is the missing compensating control — **High** · VERIFIED

- **Concept.** The person who can create financial records shouldn't be the same person who approves, locks, and can rewrite them — or where that's unavoidable, everything they do must be indelibly recorded.
- **Principle.** Segregation of duties / four-eyes; compensating controls where SoD is impractical.
- **Mechanics.** Authorization is a single linear hierarchy (`ROLE_HIERARCHY`, `plugins/auth.ts:46-70`); every finance route uses `requireMinRole` ("this role **or higher**"). Consequently OWNER passes every guard by construction: edit CoA, post journal entries (including KATCHI), create credit notes, finalize invoices, record payments, lock **and unlock** periods, write off bad debts, and **manage users** (create accounts, reset passwords — i.e., mint identities). MANAGER can do everything except CoA edits, unlock, write-offs, and user management. There is no maker/checker anywhere: the MANAGER who creates a credit note approves it by creating it; the OWNER who unlocks a period is unconstrained in what they do inside it. The `requireRole` exact-match decorator exists (`auth.ts:29-40`) but is unused by any finance route.
- **Assessment — deliberately pragmatic.** For a single cold store with an owner, a munshi (accountant), and a manager, role-based SoD is *structurally impossible* — one person genuinely does hold all keys, and pretending otherwise with approval queues would just get bypassed. The textbook answer (dual approval on everything) is the wrong fix here. The *correct* compensating control for "one person can do everything" is "everything that person does is immutably recorded" — which is exactly Findings F-1/F-2. This finding is therefore mostly *resolved by fixing F-1/F-2*, plus two cheap targeted controls:
- **Fix.**
  1. Fix F-1/F-2 (the real control).
  2. Period **unlock** already demands a reason and OWNER — keep that, make it an append-only event (F-4), and consider an in-app notification to all MANAGER+ users when a period is unlocked or a KATCHI entry posts (visibility as deterrent, no workflow friction).
  3. Align the spec's role matrix with code or vice versa: spec §7.3 says OWNER *or ACCOUNTANT* can lock periods; code requires MANAGER+ (`accounting.controller.ts:245`) — locking is the *safe* direction, so loosening lock to ACCOUNTANT (while keeping unlock OWNER-only) actually matches both spec and good practice.

---

### F-9 · KATCHI gate is inconsistent across entry points, and KATCHI reports aren't gated at all — **High** · VERIFIED

- **Concept.** The KATCHI book is the owner's private/off-record ledger; the product's design intent (spec `09:622-627`) is OWNER-only writes and OWNER/MANAGER-only visibility, with PACCI as the default lens everywhere.
- **Principle.** Consistency of a control across every path to the same resource; confidentiality of the informal book.
- **Mechanics.**
  - The OWNER-only KATCHI write gate is copy-pasted into five controllers — manual JEs, fixed assets, expenses, peshgi, payroll (`grep 'KATCHI'` across controllers; e.g. `accounting.controller.ts:142-144`) — but **not** into: **payments** (`CreatePaymentRequest.book_type`, `payment.ts:31`, route requires only ACCOUNTANT), **lots** (`lot.ts:21` — inbound is OPERATOR-level; the lot's book type flows into its invoice and JE-01 — INFERRED for the propagation, schema fields VERIFIED), or **credit notes** (`accounting.ts:371`, MANAGER route, no gate in the handler — VERIFIED at `accounting.controller.ts:289-299`). An ACCOUNTANT recording a KATCHI payment posts KATCHI journal entries the design says only OWNER may create.
  - On the read side, GL, trial balance, P&L, and balance sheet accept `book_type=KATCHI` from any ACCOUNTANT with **no role check and no PACCI default** (`gl.service.ts:31`; all four routes `requireMinRole('ACCOUNTANT')`).
  - No DB-level segregation of the books exists (one `journal_entries` table, a `book_type` column) — acceptable, but it means the app-level gate is the *only* wall, making its inconsistency the whole story.
  - One spec deviation in the *safe* direction: spec'd KATCHI mutability ("OWNER can soft-delete or modify") is not implemented — no JE mutation endpoints exist for either book. Safer than spec; fine.
- **Violation.** A control that exists on five doors and not the other three is not a control; and the confidential book is readable two role-levels below its intended audience.
- **Fix (structural).** Move the KATCHI write gate into one place — `postInTransaction` (or a shared preHandler), taking the acting role in context and rejecting `bookType === 'KATCHI'` for non-OWNER — then delete the five copies. Default all report queries to `PACCI` when `book_type` is absent, and require MANAGER+ for `book_type=KATCHI` (per spec). Decide explicitly whether lots/payments should carry `book_type` at all at OPERATOR/ACCOUNTANT level — if yes, the gate belongs at posting time anyway.

---

### F-10 · Hardcoded GL wiring, silent fallbacks, and 79 unprotected accounts — **Medium** · VERIFIED

- **Concept.** Posting templates map business events to accounts. The mapping must be correct, loud on mismatch, and its target accounts must be protected from casual mutilation.
- **Principle.** Consistency of classification; fail-fast on configuration drift.
- **Mechanics.** Three interlocking facts:
  1. Templates reference accounts as **hardcoded string literals** — `PARTY_AR_ACCOUNT`, `PAYMENT_METHOD_ASSET_ACCOUNT`, `COMMODITY_REVENUE_ACCOUNT`, plus constants and inline codes (`templates/types.ts:22-60`, `je-01-invoice-finalized.ts`, `payment.service.ts:466,477` — `'1140'`, `?? '1010'`). Only rate-plan/service-charge revenue codes are data-driven.
  2. The lookup helpers have **silent fallbacks**: unknown party type → `'1150'`, unknown payment method → `'1010'`, unrecognized commodity → `'4050'` (`templates/types.ts:49-60`). Add a new commodity (a facility-configurable action) and its revenue silently books to "Other" with no signal; a future party type would silently merge its AR into Buyers'.
  3. Only **5 of the ~84 seeded accounts** are `is_system_account = true` (1110/1120/1130/2010/2020 — `chart-of-accounts.ts:30-54`, confirmed live: 5 of 83). Every other template-wired account — **`1010 Cash`**, 1020 Bank, 1140 Peshgi AR, 1150, all revenue accounts, 6080 Bad Debt, the payroll liability set — can be deactivated by OWNER with one PATCH. `CoaService.update` checks nothing about usage (`coa.service.ts:70-86`); the failure surfaces later, in an unrelated flow, as `ACCOUNT_INACTIVE` when someone tries to record a cash payment or finalize an invoice. The operation that caused it and the operation that fails are separated in time, screen, and user.
- **Violation.** Misclassification without signal (fallbacks) and a one-click availability/integrity landmine (deactivation) on accounts the engine cannot function without.
- **Fix.**
  - *Structural:* flag every template-referenced account as a system account in the seed (one-line change per account; the `SYSTEM_ACCOUNT_PROTECTED` guard already exists and will then do its job). Replace silent fallbacks with explicit failure (`ACCOUNT_MAPPING_MISSING`) — a posting that can't classify itself should stop, not guess; commodity→revenue mapping belongs in facility settings alongside the existing rate-plan pattern.
  - *UI (when CoA management ships):* see UX-3.

---

### F-11 · Cheque dishonour destroys subledger history — **Medium** · VERIFIED

- **Concept.** Unwinding a bounced cheque must leave both a correct GL *and* a reconstructable story: which invoices/loans were un-paid, by how much.
- **Principle.** No hard deletes on operational records (this repo's own stated architecture rule); auditability of corrections.
- **Mechanics.** The dishonour flow gets the *ledger* right (JE-06 + per-loan reversal JEs, originals marked REVERSED — `payment.service.ts:439-505`), but the *operational* rows are hard-deleted: `partyLoanRepayment.deleteMany` (`:425-427`) and `paymentAllocation.deleteMany` (`:431`). After dishonour, nothing records which invoices that cheque had been allocated to or what loan repayments it had funded — the JE descriptions carry fragments, but the structured rows are gone, and (F-1) their deletion is unaudited and (F-1 again) *unauditable* since `AuditAction` lacks DELETE.
- **Violation.** Contradicts the project's own audit-first/no-hard-delete rule; degrades dispute resolution for exactly the event type (bounced cheques) most likely to be disputed.
- **Fix (structural).** Keep the rows; add a status (`REVERSED`/`VOID`) and a `reversed_at/by` pair, and filter active allocations everywhere current code assumes existence-means-active. This mirrors the pattern already used correctly for journal entries.

---

### F-12 · Historical statements re-render from live CoA metadata — **Medium** · VERIFIED (exposure), current API surface limits blast radius

- **Concept.** A financial statement, once issued for a closed period, should reproduce identically if regenerated.
- **Principle.** Consistency and comparability of issued reports.
- **Mechanics.** Statement rendering joins posted lines to the *current* `chart_of_accounts` rows for name, class, type, and parent (`loadAccounts`, `financial-statements.service.ts:202-208`; grouping at `:252-278`). Nothing snapshots CoA metadata per period. Today the API confines edits to `account_name` + `is_active` (verified), so the *reachable* effect is limited to: renaming an account (including **system** accounts — the rename guard only covers deactivation) relabels every historical statement; deactivation doesn't affect statements at all (verified — good). But the *architecture* has no defense: the moment a type/parent/code edit path appears (an admin endpoint, a support script, direct SQL — note `ON UPDATE CASCADE`, F-3), every closed period re-renders differently with no record of why.
- **Violation.** Latent violation of consistency; currently held closed by API minimalism rather than by design.
- **Assessment.** Full CoA versioning/period snapshots would be **over-engineering at this scale** — the right-sized control is: (a) audit triggers on `chart_of_accounts` (F-1) so any rename is on the record; (b) the F-3 DB triggers extended to block class/type/parent/code changes on accounts with posted lines (allow while unused — the "locked once used" concept the codebase currently lacks); (c) statement PDFs already generated for a period are the immutable artifact of record (the PDF pipeline exists — treat archived PDFs, not re-renders, as the issued statement).

---

### F-13 · Period assignment uses server-local time — **Low** · VERIFIED

- **Mechanics.** `periodMonth: draft.entryDate.getMonth() + 1, periodYear: getFullYear()` (`journal-entry.service.ts:94-95`) on a `@db.Date` value. A date-only value parsed as UTC midnight, read through local-time getters on a server west of UTC, shifts to the previous day — so a `2026-07-01` entry books to period 6/2026. Pakistan (UTC+5) deployment happens to be safe; a UTC-hosted container is safe; a US-hosted server or a DST-affected host would misperiodize month-boundary entries. Note `assertOpen` derives its month the same way (`period-lock.service.ts:12-13`) — consistently wrong is at least consistent, but the lock and the label would both shift.
- **Fix.** Derive month/year from the `YYYY-MM-DD` string (or use UTC getters). One-line change; do it while it's cheap.

---

### F-14 · No RLS on financial tables — **Low** (today) · VERIFIED (live DB)

Facility isolation on every financial table is purely `where: { facilityId }` in application code; RLS exists only on `facilities`/`users`/`refresh_tokens`/`audit_log`, none forced. For the single-facility MVP this is acceptable and the finding is *forward-looking*: the codebase advertises multi-tenant readiness (`facility_id` everywhere), and the day a second facility shares the database, one missed `where` clause leaks one store's books to another. Fold RLS-on-financial-tables into the F-2(a) role work (RLS is only meaningful once the app stops connecting as the table owner). Until then, no action needed beyond noting the claim/reality gap.

---

## 5. Business Logic Gaps

Rules the system should enforce (or capabilities it should have) that are simply absent — distinct from defects in what exists:

1. **No opening-balance mechanism.** No template, no flow, no party carry-forward field. Go-live balances must be keyed as raw manual JEs against equity 3030 — undocumented, unguided, and subject to the F-7 draft black hole. A facility migrating from paper registers (the entire target market) hits this on day one. *Recommend:* a guided opening-balance entry (per-party AR/AP + cash/bank + equity plug) that posts one balanced JE, plus a "opening balances entered" facility flag.
2. **No generic reversal endpoint.** `markReversed` + `entryType: 'REVERSAL'` exist and work, but only the dishonour flow can invoke them. The spec's stated correction path for a wrong PACCI posting — reverse and re-post — is not executable by any user. Manual errors today can only be countered by hand-crafting an opposite manual JE, which produces no `reversed_by` linkage and leaves the original looking valid. *Recommend:* `POST /journal-entries/:id/reverse` (MANAGER+, reason required, auto-builds the mirror-image entry dated today, links both ways). This is the single most useful missing endpoint.
3. **No invoice void.** A `VOID` status exists in types and list filters but no code path reaches it. A finalized-in-error invoice can only be fully credit-noted — workable but unlabeled as such anywhere.
4. **Month-end revenue accrual is dead code.** `je-11-accrued-revenue.ts` / `je-11r-accrued-reversal.ts` exist and are unit-tested but wired to nothing (verified: imports only in tests). Consequence: storage revenue is recognized only at invoice finalization (typically withdrawal), so in-season months carrying thousands of stored bags can show near-zero revenue while the cost side (payroll, electricity) accrues monthly — P&L-by-month is systematically misleading during storage season. Under IFRS 15 / IFRS-for-SMEs §23, storage is an over-time service. Given the "cash-and-accrual hybrid" the spec declares, this may be an accepted simplification — but then monthly P&L should carry a caveat, or the JE-11 job should be finished. Decide deliberately; today it's accidental.
5. **`backdating_max_days` doesn't govern accounting documents.** Enforced for lot inbound/outbound only, exempting MANAGER+ (verified). Payments, expenses, invoice dates, and manual JEs answer only to the (unused, F-4) period lock. If the setting is meant as the facility's temporal policy, apply it (with the MANAGER+ exemption debate had explicitly); if not, the settings screen shouldn't imply it is.
6. **No bank reconciliation concept.** Payments carry `clearanceStatus`, but there is no statement-import/matching workflow. Fine for MVP scale; listed for completeness since AR aging and cash balances are only as good as cheque-clearance bookkeeping done by hand.
7. **No account merge/renumber tooling** — and that's the *correct* gap: recommend never building renumber (reclass via JE + deactivate the old account instead). Documenting this as policy would prevent a future "helpful" endpoint from creating the F-3/F-12 disaster case.
8. **Direct write-off, no allowance for doubtful debts.** Acknowledged in spec; acceptable on materiality at this scale. Flag only if receivables age badly at scale (the AR-aging report exists to watch exactly this).

---

## 6. UI/UX Recommendations

Only where the interface itself contributes to the risk; each tied to its finding.

- **UX-1 (→ F-4): Build the period-close screen.** A twelve-month grid per fiscal year: status (open / locked / re-opened), locked-by/when, reason; lock button (MANAGER+), unlock (OWNER, reason mandatory — backend already enforces); a visible "closed through <date>" banner once the watermark model lands. Without this screen the entire cut-off control is decorative. A month-end nudge ("June is still open") on the accounting landing page would drive actual use.
- **UX-2 (→ F-7, F-4): Make the JE form's two dangerous choices honest.** (a) The Draft/Post select must say what Draft *means* — today "Save as Draft" reads as the safe choice and is actually the lost-forever choice; until a promotion endpoint exists, either remove the option or label it "Draft — will NOT appear in any report". (b) The date field should bound itself to the closed-through watermark and show the target period ("will post to July 2026"), rather than accepting any date and failing (or worse, succeeding) at submit. A confirmation step for "Post immediately" showing totals + period is proportionate; a generic are-you-sure is not the ask — the *summary* is.
- **UX-3 (→ F-10, F-12): When CoA management ships, build "in-use" awareness in from the start.** The landing page already promises management ("View and manage the 81-account chart of accounts" — `accounting/page.tsx:29`) that doesn't exist; when it arrives: per-account posted-line count and a "wired to postings" badge (from the template registry); deactivate disabled-with-explanation for system/template accounts and confirm-with-consequences ("history remains on reports; future postings referencing it will fail") for the rest; rename confirm noting historical statements will display the new name. Until then, fix the copy — "View the chart of accounts."
- **UX-4 (→ F-11 pattern, consistency): Level up the two generic confirmations.** Loan write-off and cheque dishonour dialogs explain their accounting consequences (verified — they're good); invoice line-delete ("Remove this line item?") and expense-voucher cancel ("Cancel this voucher?") don't, despite the latter potentially reversing an accrued voucher. Reuse the consequence-sentence pattern from the good dialogs.
- **UX-5 (→ F-9): PACCI by default, KATCHI by choice, visibly.** Report screens should default to PACCI and render an unmistakable banner/watermark when a KATCHI or combined view is active (pending the backend gate; the UI shouldn't be the only wall, but it should be *a* wall).
- **UX-6 (→ Gap 2): Reversal affordance on the posted-JE page.** Once the reverse endpoint exists: a "Reverse entry" button (MANAGER+, reason dialog, consequence sentence), and the existing REVERSED badge/cross-links become the complete story. The page's current read-only design is right — keep edits impossible, make corrections first-class.

---

## 7. Open Questions & Assumptions

1. **Threat model assumption.** Findings F-1/F-2/F-3 treat direct-DB access and future code paths as in-scope threats. Justification: the product's core promise (pacci = trustworthy official record; katchi/pacci disputes are the domain's daily reality) and eventual FBR exposure both hinge on records that can *prove* they weren't altered. If the owner's position is "it's my database, I accept the risk," the criticals downgrade to Highs — but the broken attribution (F-2b) and missing coverage (F-1) stay critical for ordinary operational disputes.
2. **Standard.** Assumed IFRS for SMEs (simplified) per the spec's own declaration; not confirmed with the owner whether AFRS-for-SSEs (Pakistan's small-entity tier) applies instead. No finding in this report changes between the two.
3. **Dev-DB drift observed (worth a look during phase-13 provisioning work).** The live dev database has an `audit_invoice_surcharges` trigger that does **not** exist in the rebaselined baseline migration — i.e., a database provisioned fresh from the baseline will differ from the dev DB that validated the test suite. Likely a remnant of pre-rebaseline migration 0017. Recommend diffing dev schema vs. fresh-provisioned schema before production cutover.
4. **Account count discrepancies (cosmetic).** Live DB: 83 accounts; seed file: 84 entries; UI copy: "81-account chart." Not reconciled; harmless but worth tidying.
5. **Lot → invoice `book_type` propagation (F-9)** was inferred from schema fields and posting-flow structure, not traced line-by-line through billing. The payments and credit-note KATCHI holes are verified regardless.
6. **Payroll and fixed-asset arithmetic** (depreciation schedules, salary math) were reviewed only for posting-pattern integrity, not recomputed — out of scope for this audit's question.
7. **Test coverage claims** (e.g., `PERIOD_LOCKED` integration tests across flows) were observed in test files during exploration but the suite was not run as part of this audit.

---

## Appendix — Priority order if fixes are scheduled

1. **One migration:** audit triggers on financial tables + `DELETE` in `AuditAction` + append-only `audit_log` grants (F-1, F-2a) + JE immutability & balance triggers + line CHECKs (F-3) + `period_locks` append-only (F-4.3).
2. **One backend PR:** GUC-in-transaction attribution fix (F-2b), credit-note guard (F-5), CoA parent validation + statement completeness assertion (F-6), draft promotion or default flip (F-7), centralized KATCHI gate + PACCI report default (F-9), system-flag the template accounts + remove silent fallbacks (F-10), allocation soft-void (F-11), UTC period derivation (F-13).
3. **One frontend PR:** period-close screen (UX-1), JE form honesty (UX-2), copy + confirm-dialog consistency (UX-3/4/5).
4. **Deliberate decisions needed from the owner:** closed-through watermark model (F-4), reversal endpoint (Gap 2), opening-balance flow (Gap 1), month-end revenue accrual on/off (Gap 4).
