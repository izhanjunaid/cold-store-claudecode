---
paths:
  - "apps/api/src/modules/{accounting,payment,payroll,fixed-assets,payables,peshgi,employee-advances,partners,surcharge,invoice,cash-handover,reporting}/**"
  - "packages/shared/src/accounting-accounts.ts"
  - "scripts/check-account-literals.mjs"
  - "apps/web/src/app/(app)/{accounting,payments,invoices,loans,credit-notes,billing,reports}/**"
---

# Accounting

Reference: `docs/25_accounting_consolidation.md` (the invariants, §2; what was deliberately left, §10), `docs/09_accounting_spec.md`.

- **Financial guard triggers** (Prisma migration `0002_financial_audit_and_integrity_guards`) enforce ledger/JE immutability at the DB level. Integration test cleanup that deletes or updates posted financial rows must wrap with `withGuardsDisabled` or the trigger will reject it. `withGuardsDisabled` is global `ALTER TABLE` DDL, not session state: call it in `afterAll` only, never mid-test.
- **Accounting has one of everything (docs/25 §2) — use it, never re-derive it.**
  - **Accounts.** Code literals live only in `SYSTEM_ACCOUNTS` (`packages/shared/src/accounting-accounts.ts`) and the seed. `scripts/check-account-literals.mjs` fails CI on a literal anywhere else; its allowlist only shrinks.
  - **Chart flags.** What an owner-created account may need is a flag on its chart row, and those flags are the rule:
    - `is_cash_equivalent`: every "paid from" picker, `assertCashAccount`, and the cash-flow statement.
    - `allow_manual_posting` and `requires_party`: enforced by the posting engine.
  - **Posting and reversing.** Post only through `JournalEntryService.postInTransaction`. Reverse only through `reverseInTransaction`: the mirror inherits the original's source and is never dated before it. A cancelled document gets `voided_at`/`voided_by`/`void_reason`, never a tag in `notes`.
  - **Reading the ledger.** Statements, aging and sub-ledger tie-outs read `apps/api/src/modules/accounting/ledger.ts` (`accountBalances`, `partyBalances`, `classify`), not their own journal-line queries.
  - **AR control accounts.** Receivables post to the party's stamped `control_account_code`, never to an account derived from its type. The type locks once the party has postings.
- **New account codes** need only a `CHART_OF_ACCOUNTS` entry; `syncChartOfAccounts()` in `packages/db/prisma/deploy.ts` inserts them on each client box. It is INSERT-only by design: owners rename and re-parent their own accounts, so it must never upsert.
