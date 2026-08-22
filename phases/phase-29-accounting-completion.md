# Phase 29 — Accounting Completion

**Branch:** `accounting/F-completion` (worktree `.claude/worktrees/accounting-a-guardrails`, cut from `main` at `d98b1f3`)
**Date:** 2026-08-19 → 2026-08-22
**Migrations:** `0019` opening-balance unique index, `0020`/`0021` cash-flow section, `0022` receipt numbers, `0023` accumulated impairment, `0024` tax withheld on receipts
**Suite:** 219 api unit + 614 api integration + 132 web unit, green

---

## Why this phase existed

The owner reported that the accounting module "mixes various accounting
standards," confusing their accountants around the Chart of Accounts and the
financial statements. Reading the engine first changed the shape of the work:
it is **not architecturally broken**. One function writes journal rows and CI
enforces that; Postgres re-checks double entry at COMMIT; posted entries are
immutable by trigger; statement structure has been data-driven since phase/24;
and `account_class` ↔ `statement_section` was already cross-validated. So the
honest scope was targeted surgery, not a rewrite.

**Framework question, closed.** `docs/16:333` left open whether IFRS for SMEs
or AFRS for SSEs applies. The owner confirmed the entity is a sole
proprietorship / AOP, so **no SECP framework binds it** — the Companies Act
2017 Third Schedule reaches *companies*. IFRS for SMEs is therefore adopted
voluntarily, presented at SSE-level simplicity. IFRS 18 was rejected on three
grounds that do not depend on any threshold: it changes presentation only and
the real defect was *recognition*; MPM machinery exists to discipline
non-IFRS measures shown to capital markets, which a private cold store does
not have (and adopting it would turn the existing `ebitda_pkr` into an MPM
requiring a reconciliation note — a disclosure obligation created, not
removed); and it targets public-interest and large entities.

## What shipped

| # | Change | Closes |
|---|---|---|
| A | `statement_section` required on new non-EQUITY headers; `normal_balance` derived unless `is_contra`; hard delete for never-posted accounts; partial unique index behind the opening-balance advisory lock | — |
| B | `3015` drawings, `1240`, `1250`, `1260`, `2071`, `2072`; opening-balance onboarding banner + statement warning bands | — |
| C | **Storage revenue accrual (JE-25)** | F-16 |
| D | **Statement of Cash Flows**, direct method | specified in `docs/01`/`04`/`10`, never built |
| E | Statement of income and retained earnings on the P&L; EBITDA add-back derived from the asset register | — |
| F1 | Trial balance grouped by statement section as well as class | the literal complaint |
| F2 | GST settlement (JE-26) | P1-4 |
| F5 | Cash ↔ bank transfer (JE-27) | P1-10 |
| F6 | Receipt numbers on payments | P2-14 |
| F8 | 2030 ↔ payroll register reconciliation on the run | invariant 16, P2-5 |
| F7 | Asset impairment (JE-28) | P2-7 (narrow), P2-6 |
| F4 | Withholding on payments out + s.165 report + remittance (JE-29) | — |
| F3 | Withholding on receipts into `1240` | P3-6 |

## The three decisions worth re-reading

**1. The accrual is cumulative with a full prior reversal, not periodic.**
A periodic accrual — earn this month, reverse it next month — nets to zero in
every intermediate period and reproduces the exact defect it was built to fix,
wearing a costume. A lot stored October→March, invoiced in March, must read
one month's revenue in each of six months. `SEASONAL_PER_BAG` needed its own
proration: `computeStorageCharge` returns a **flat** amount independent of
elapsed days, so naive reuse would recognise the whole season's fee at the
first period end — the same misstatement, front-loaded. A seasonal plan with
no `seasonEndDate` is **excluded and listed**, because inventing a season
length puts a fabricated number on the face of the P&L. And the reversal is a
**fresh POSTED entry**, never `reverse()`: marking the original REVERSED would
drop it out of every statement query and erase the revenue from the period it
was recognising.

**2. Gross semantics on withheld receipts kept the blast radius small.**
`amount_pkr` stays what settles the invoice. Allocation validation is
untouched, and AR aging — the one report not derived from the GL, which has
drifted twice — reads `amount_pkr` as "how much AR was reduced", which stays
true. Not one line of it changed. The cost is that one stored number now
carries two meanings, so `tax_withheld_pkr` is **stored on the row**: cheque
clearing and dishonour both fire weeks later and both need to know the cash
leg was net while AR settled gross.

**3. Impairment could not stop at the journal entry.** Two paths read carrying
amount as cost less accumulated depreciation. Depreciation would have kept
charging the original cost-based amount against a written-down asset, taking
it past residual and eventually past zero; it now spreads the revised carrying
amount over the remaining life per s.27.10, **only for impaired assets**,
because the two formulas are algebraically identical for an unimpaired one but
not identical to the paisa once rounding compounds — and this runs on a live
register. Disposal would have stranded `1370` against an asset that no longer
exists and booked the write-down a second time as a disposal loss.

## The finding this phase did not fix

**Every reversal in the ledger is applied twice.** Full write-up, measurements
and both candidate fixes: `docs/20_audit_backlog.md` §Phase 29. Found by
measurement while building P3-6; reproduces with no withholding involved.
Equal and opposite on the two sides, so the trial balance still balances —
which is why three accounting audits missed it. It needs its own phase: it
changes what `posting_status` means, which migration `0002` enforces with a
trigger, and it reaches six services plus the API and UI.

## Open, and deliberately so

- **P2-9 gratuity** — a question for the facility's accountant, not an
  engineering decision. The exact question is recorded in `docs/20`.
- **`1240` has no relief path** — it is an advance of the facility's own
  income tax, relieved when that tax is assessed, which this system does not
  model. Expect a manual JE at assessment.
- **P2-7 revaluation, partial disposal, CWIP** and **P2-5's GL restructuring**
  — closed as "won't build", with reasons, in `docs/20`.
