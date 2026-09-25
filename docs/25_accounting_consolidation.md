# 25 — Accounting Consolidation: final audit and fix program

**Audited:** 2026-09-24/25, against `feat/partner-model` @ `13eab9c` (PR #25, unmerged).
**Method:** three parallel read-only domain audits (ledger core / revenue & receivables / cost side),
the worst findings re-verified by hand in source, then a dependency and migration-safety review of
the fix plan. Prior audit documents (docs/15–22, docs/20 backlog) were **not** trusted — every
finding below was checked against current source.

**Why this document exists.** Eight audit rounds each fixed what they found by patching the existing
shape. The posting core is sound — one `postInTransaction`, DB immutability triggers, period locks —
but around it the system grew many sources of truth and structural workarounds: ~100 literal
account codes in 33 files, 7 hand-built reversals, 7 independent ledger aggregations, 4–5 different
"what does this party owe" figures, and rules the UI enforces but the server does not. Several of
these misstate the books today. This is the register those fixes work from, and the standard they
converge on.

Legend — **V**: verified by hand in source. **A**: agent-reported; must be proven by a test that
fails on current code before it is fixed.
Severity — P0 misstates financials / loses data · P1 wrong logic on a normal path · P2 duplication
or a latent defect · P3 cosmetic.

---

## 1. Decisions (owner, 2026-09-24)

| # | Question | Decision |
|---|---|---|
| Q1 | AR structure | **Per-party control account.** `parties.control_account_code`, stamped at creation from party type, locked once the party has postings. Every AR template reads the party row, never the type. History is untouched. |
| Q2 | Revenue recognition | **Monthly accrual is the fixed policy** (IFRS for SMEs s.23). The `revenue_accrual.enabled` toggle is removed; each existing box starts at a chosen open fiscal-year boundary, applied prospectively (s.10.12). |
| Q3 | Payables | **Full AP.** SUPPLIER party type, multi-line bills with input tax crediting Trade Payables, supplier payments with withholding, payables aging. JE-17A/17B/17C retired. |
| Q4 | Branch | Browser-pass and merge PR #25, then cut `accounting/consolidation` from `main`. |

Recorded, deliberately **not** built (owner/accountant decisions, not engineering):
- KATCHI dual book on one chart (L-14) — a product requirement; only consistency fixes are made.
- Reducing-balance convention: monthly compounding vs FY-opening NBV (C-35).
- Ownership-transfer billing intent — FULL double-bills a seasonal fee, PARTIAL never bills pre-transfer storage (R-14).
- Provincial sales tax on services — rate and tax codes (R-31). Do not hardcode 16%.
- Gratuity / leave provisions / SESSI-PESSI (C-20); annualised s.149 slabs.
- Bad-debt allowance (IFRS for SMEs s.11) and recovery of written-off debts (R-41).
- 1240 tax-withheld-by-customer certificate tracking, and whether a bounced cheque's certificate survives (R-32).
- Year-end profit appropriation to partners — not buildable until the owners give a ratio.

---

## 2. The standard (invariants the code converges on)

1. **One account registry.** `SYSTEM_ACCOUNTS` (role → code) in `packages/shared/src/accounting-accounts.ts` for every singleton system account. No other file holds an account-code literal (CI grep gate).
2. **Properties an owner-created account may need live on the chart row:** `is_cash_equivalent`, `allow_manual_posting`, `requires_party`. The chart guard trigger freezes `is_cash_equivalent`/`requires_party` once an account has postings.
3. **One posting path, one reversal path.** `postInTransaction` (no `reversedById` option) and `reverseInTransaction(tx, originalId, {date, reason})` — the only mirror builder. It inherits the original's source, bypasses manual-posting guards (history must stay reversible), and refuses a date before the original. User-reversible sources come from one registry shared with the web.
4. **One ledger read path.** `ledger.ts`: `liveEntriesWhere`, `accountBalances`, `partyBalances`, `classify(account, chart)` (statement section inherited from the header; cash-flow section derived; 1140/2120 via roles), sign by normal balance, one `money.round2`.
5. **Sub-ledger state is derived, not accumulated.** One `refreshInvoiceSettlement`; derived payment status; one AR and one AP read model on `partyBalances`.
6. **Documents carry their own book, date and cancellation.** Book always from the source document; `voided_at/voided_by/void_reason` columns rather than tags appended to `notes`; every state transition takes a row lock first.
7. **Fiscal discipline.** FY start immutable once any JE exists; 3030 unpostable; 3020 only via opening balances; partner shares respect period locks; month close = accrual posted + drafts finalised + lock.
8. **No UI-only rules.** The web reads flags and allowed actions from the API; class digits, labels and UTC fiscal/date math come from `@coldchain/shared`.
9. **Expand-only releases** (`update.ps1:256`). Anything that drops a column or enum value ships one release later.

### Manual-posting matrix
"Manual" means `sourceTable = 'manual'` only. Opening balances, cash transfer and owner equity keep their own validators.

| Account(s) | Manual posting | Party required |
|---|---|---|
| AR controls 1110/1120/1130/1150 | allowed — the correction path for any non-invoice receivable | yes |
| Trade Payables | allowed | yes |
| 1140 peshgi, 2010 customer advances | no — module documents only | yes |
| 1025, 1250, 1230, 2030 | no — owned by cheque clearing / accrual / advances / payroll | — |
| 5030, 5035, 6010, 6015 (payroll cost); 5040, 6120, 6130, 6140, 6170, 6180 (depreciation); 4230, 6110 (disposal); 6080 (bad debts); 6160 (impairment) | no — owned by their automated flow, each of which now has its own reversal | — |
| 3030 | never, from any source | — |
| 3020 | opening balances only | — |
| everything else, incl. 2020, 2060–2072, 6150, cash equivalents | allowed | no |

The automated-cost rows replace the web-only `AUTOMATED_COST_ACCOUNTS` list (C-05), which also
blocked 6150 — an account nothing posts to, so nobody could book spoilage at all.

Every AR/AP line carries a party, so aging = AR GL and payables aging = AP GL hold by construction:
the read models show invoices/bills as open items, plus any non-document party lines (opening,
manual, legacy surcharge) as "other".

---

### Decisions taken while building the kernel

- **Future-dated manual entries stay allowed** (L-12 not adopted). Post-dated journals are
  legitimate in every mainstream ledger; the period lock is the control that matters. Rejecting
  them also broke every suite that isolates itself in a future month.
- **A reversal inherits its original's source** (`source_table`/`source_id`). "The entries for
  this document" therefore includes their reversals, and every sub-ledger that reads a
  document's lines — opening-balance AR in aging and party statements (L-03) — nets to zero by
  construction. The one-opening-balance index excludes `entry_type = 'REVERSAL'` (0031).
- **A manual entry is its own source document** (`source_id` = its own id), not the acting
  user's id (L-10). Entries posted before carry the user id; the invariant-17 resolver accepts
  both.
- **Revenue routing:** a rate plan may override; otherwise the lot's commodity decides, through
  `commodities.revenue_account_code` stamped at creation — never the commodity's name (L-28).
  Commodities are global (no facility), so that column has no foreign key.
- **No foreign key on `parties.control_account_code` / `employees.cost_account_code`.** The dev
  seed and provisioning create parties before (or without) the chart, and both codes are always
  system accounts the engine validates at posting time anyway. Owner-chosen configuration columns
  (rate plans, service charges, payment/asset/loan/advance accounts) do get foreign keys (0030).
- **Payroll constants are not effective-dated.** A finalised payroll line stores the amounts it
  was finalised with, so revising the EOBI figure cannot restate it.
- **Lots, gate passes and dispatch notes keep their own number generators** — operations, out of
  this program's scope. Accounting documents move onto `common/document-number.ts`.

## 3. Root causes

| RC | Root cause | Findings |
|---|---|---|
| RC1 | Accounts identified by code literals; "cash" defined 7+ ways | L-20, L-27, L-28, L-33, R-33, C-06, C-07, C-34, C-47, C-48 |
| RC2 | No control-account / manual-posting rules server-side | L-02, L-06, L-26, C-05 |
| RC3 | Reversal hand-built 7×, inconsistent linking, whitelist too narrow | L-07, L-08, L-09, L-11, R-08, R-24, C-04, C-26, C-33, C-39, C-40 |
| RC4 | Every report aggregates the ledger itself | L-16, L-17, L-18, L-24, L-47 |
| RC5 | Sub-ledger state stored as mutable counters; 4–5 AR figures | R-10, R-11, R-12, R-13, R-19, R-20, R-21, R-22, R-39 |
| RC6 | Classification overlaps (class / section / cash-flow section / code digit) | L-01, L-18, L-19, L-31, L-34, L-38 |
| RC7 | No payables model | C-01, C-02, C-03, C-08, C-09, C-10, C-12 |
| RC8 | No year-end discipline | L-05, L-22, L-23, L-25, L-32, C-21 |
| RC9 | Duplicated domain rules | R-15, C-16, C-19, C-23, R-34, C-43, L-39, L-15 |
| RC10 | Concurrency and dating ad hoc | C-13, C-31, C-41, R-23, L-12, C-46, L-13, R-09 |
| RC11 | Dead code | L-42, L-43, L-44, R-25, R-26, R-27, C-17, C-38 |

---

## 4. Register — ledger core, CoA, equity, statements (L)

**L-01 · DEFECT · P0 · V — Cash-flow Investing section is always empty.**
`accounting/cash-flow.service.ts:60-76,109-118,166`; `coa.service.ts:46-48`; seed sets `section` on headers only.
`deriveCashFlowSection(a)` switches on the *counterpart* account's `statementSection`, but a posting counterpart is always a DETAIL row and `statement_section` is header-only (`validateStatementSection` throws otherwise) → null → `'OPERATING'`. Cash capex (1310) and bank-loan draws (2110) land in Operating; 2120 reaches Financing only because migration 0021 hard-set it. `cash-flow.integration.test.ts:53-77` passes by hand-setting a `statementSection` no real detail row has. The TB's `sectionFor` (`gl.service.ts:328-336`) already inherits the parent header's section correctly.
Fix: `classify(account, chart)` in the ledger kernel, used by TB/P&L/BS/CF.

**L-02 · DEFECT · P1 · V — 3030 (and 3020) postable; statements drop 3030 → BS unbalanced.**
`journal-entry.service.ts:359-372` (`validatePostableAccounts` checks exists/active/DETAIL only); `financial-statements.service.ts:71-85` (`equitySnapshot` excludes `DERIVED`, reads only posted 3020); `opening-balance.service.ts:142` (blocks only 3010); `accounting.controller.ts:464` (the only place the derived list is enforced, JE-30); web `opening-balances/page.tsx:126-136` offers 3020/3030; seed `chart-of-accounts.ts:136` (3020 not system).
Fix: engine rejects 3030 from every source; 3020 from opening balances only.

**L-03 · DEFECT · P1 · V — Reversed opening balances double-counted in aging and party statement.**
`reporting/reports/receivables-aging.ts:61-78`; `payment/payment.service.ts:~718-735`. Only `opening-balance.service.ts:45,105` filters `reversedById: null`. Since 0025 the reversed original stays POSTED and the mirror is sourced `'journal_entries'`, so after "reverse and re-enter" both readers see the old and the new opening AR. The GL nets correctly — sub-ledger ≠ GL.
Fix: `liveEntriesWhere` in the kernel; AR read model built from GL party lines.

**L-04 · DEFECT · P1 · V — JE-25 accrual reversal happens only on the next run.**
`accounting/revenue-accrual.service.ts:256-304`; `templates/je-25-revenue-accrual.ts:89-127`.
Prior accrual reversed only inside the next month's `run()`; "already reversed" is a heuristic (any ADJUSTMENT on `revenue_accrual` dated after it), never `reversedById`, never `markReversed`. A skipped month or toggling off leaves the accrual in 1250 and revenue alongside the invoice → revenue counted twice. Lot state read at run time (`status:'ACTIVE'`, `currentBalanceBags`), not as of period end. The je-25 comment (:93-98) still describes pre-0025 `reverse()` behaviour. The P&L note (`profit-loss/page.tsx:110-113`) reads today's setting for past periods.
Fix: accrual and its reversal posted together; as-of lot state; accrual posted by the month-close action.

**L-05 · NON-STANDARD · P1 — No year-end discipline; editable FY start restates history.**
`financial-statements.service.ts:576-590,637-644`; `equity-allocation.ts:4-17`; `shared/schemas/facility.ts:70`; `fiscal-year.ts:11-15`.
Retained earnings vs current-year result are computed at read time from `fiscal_year_start_month`, an ordinary setting — changing it silently re-splits every past balance sheet. Virtual closing itself is standard (Xero/QBO/Odoo); the missing pieces are FY-start immutability and a locked year.
Fix: FY start immutable once any posted JE exists; appropriation deferred (decision list).

**L-06 · NON-STANDARD · P1 — Control accounts open to manual entries.**
`journal-entry.service.ts:359-372`; `accounting.controller.ts:181-196`; `shared/schemas/accounting.ts:190-201` (party optional).
A manual JE can post to AR 1110-1150, 1140, 1230, 1250, 1025, 2010, 2020, 2030 without a party or document; GL drifts from the sub-ledgers.
Fix: `allow_manual_posting` / `requires_party` flags enforced in the engine (matrix in §2).

**L-07 · DEFECT · P2 · V — Dishonour links `reversedById` in both directions.**
`payment.service.ts:535-545,577-590`; `journal-entry.service.ts:38,86`. The JE-06 mirror is created with `reversedById: <original>` and then `markReversed(original, mirror)` also runs → the mirror reads as reversed, `reverse()` would refuse it, any live-entry filter drops both.
Fix: remove the `reversedById` post option; only `reverseInTransaction` links.

**L-08 · DUPLICATION · P2 · V — Mirror reversals built by hand in 7 places.**
`journal-entry.service.ts:178`; `invoice.service.ts:~312-334`; `payroll-run.service.ts:~549-573`; `fixed-asset.service.ts:~335-363`; `payment.service.ts:~525-545` (dishonour); `payment.service.ts:~553-590` (peshgi repayment dishonour); `revenue-accrual.service.ts:285-301` (JE-25, never links). Each picks its own entryType/sourceTable/date/linking.
Fix: `reverseInTransaction` as the only mirror builder.

**L-09 · DEFECT · P2 — Owner-equity and cash-transfer entries irreversible; petty cash reversible.**
`journal-entry.service.ts:172` (only `manual`/`opening_balances`); duplicated in web `journal-entries/[id]/page.tsx:94-98`; `expenses/templates/je-17c-petty-cash-replenish.ts:32-33` (system doc typed `'manual'` / EXPENSE).
Fix: source-type registry `{sourceTable, userReversible, label}` shared by api and web.

**L-10 · WORKAROUND · P2 — Fake source ids, free-text source_table, meaningless entry types.**
`schema.prisma:935-936` (`sourceId` non-null UUID); `accounting.controller.ts:185` (`sourceId = userId`); `je-30:59`, `je-27` (userId); `opening-balance.service.ts:210`, `je-25:82,114` (`sourceId = facilityId`); 0025 partial unique index keyed on literal `'opening_balances'`. `source_table` is VarChar(50), no enum, no idempotency constraint; `entryType` is `ADJUSTMENT` for manual, owner equity, opening balance and accrual reversal alike.
Fix: typed source registry; new EntryType values (opening balance, owner equity, cash transfer, bill, supplier payment, statutory remittance).

**L-11 · DEAD / INCONSISTENCY · P3 · V — REVERSED posting-status leftovers.**
`schema.prisma:234`; 0025 legacy trigger branch; `journal-entry.service.ts:14,154`; web `journal-entries/page.tsx:49` (claims older entries still carry REVERSED — 0025 repaired them), `:121` ("Reversed" filter always returns nothing). Detail badge (`[id]/page.tsx:148`) shows POSTED for a reversed entry while list (:50-56) and peek (`journal-entry-peek.tsx:106`) show REVERSED. Type filter lists 8 of 24 entry types (`page.tsx:118`).
Fix: drop the trigger branch + `CHECK (posting_status <> 'REVERSED')` now; enum value dropped in Release 2; `reversed` filter from `reversedById`; one `JournalStatusBadge`.

**L-12 · NON-STANDARD · P3 — No date guards in the engine.**
`journal-entry.service.ts:33-111`; `backdating_max_days` enforced only in `lot.service.ts:286`, `outbound.service.ts:137`. Manual entries, reversals, owner equity, transfers accept future dates and unlimited backdating.
Fix: future dates rejected for manual sources only (system month-end entries legitimately post ahead).

**L-13 · INCONSISTENCY · P3 — Drafts consume JE numbers.**
`journal-entry.service.ts:71`; `journal-entry-number.ts:30-37` (MAX+1); 0002 lets AUTO_DRAFT rows be deleted → gaps, or reuse of a posted number.
Fix: number at post time (`postDraft`).

**L-14 · NON-STANDARD · P2 — KATCHI and PACCI on one chart.**
`book-gate.ts:24-33` (always one book, no consolidated view); `revenue-accrual.service.ts:125`, `opening-balance.service.ts:208` (PACCI only); per-book cash in CF/TB/BS/GL. Physical cash (1010) split across two books; KATCHI has no opening-balance path.
Decision: kept (product requirement). Consistency fixes only (book from source document, KATCHI GST 0).

**L-15 · DUPLICATION · P3 — Period-lock watermark computed 3×.**
`period-lock.service.ts:17-41`; `period-locks/page.tsx:84`; `opening-balances/page.tsx:105-116`. "Accrue before you lock" is only UI caution (`revenue-accrual/page.tsx:116`).
Fix: API returns `closed_through`; month-close checklist.

**L-16 · DUPLICATION · P2 — Seven hand-built aggregation paths.**
`gl.service.ts:126-171` (TB maps), `:46-55` (GL `signedDelta`); `financial-statements.service.ts:699-732` (`fetchLines` loads every line into memory); `cash-flow.service.ts:81-99`; `coa.service.ts:311-314`; `opening-balance.service.ts:57-67`; `revenue-accrual.service.ts:183-194`. Four sign conventions; `round2` ×5+; "balanced" tolerance 0.005 (TB `gl.service.ts:259`) vs 0.01 (BS `financial-statements.service.ts:683`); one P&L request does ~7 full-ledger scans.
Fix: `accountBalances` (SQL groupBy) in the kernel.

**L-17 · DUPLICATION · P3 — Two net-profit definitions.**
`financial-statements.service.ts:195` (section-based, rounds per line) vs `:43-54` (`plNetOver`, class-based, raw). BS current-year, SoCE and partner allocation use one; P&L face the other; paisa drift.
Fix: one profit function, rounding at presentation.

**L-18 · DUPLICATION · P2 — Three "which section" lookups.**
`gl.service.ts:328-336`; `financial-statements.service.ts:748-782` + 157-179 + 611-628; `cash-flow.service.ts:60-76`. "Equity by class" exception hand-coded in `coa.service.ts:28-31`, `gl.service.ts:332`, `shared/schemas/accounting.ts:83`, web `chart-of-accounts/page.tsx:82-91`.
Fix: `classify()`.

**L-19 · DUPLICATION / DEAD · P2 — Overlapping classification systems.**
`schema.prisma:910,914-915`; migrations 0015/0017/0020/0021; `account_class`, header `statement_section`, detail `cash_flow_section`, and the code's leading digit all classify. `cash_flow_section` holds only 0021's 1140→OPERATING and 2120→FINANCING, which derivation already yields; no API/UI sets it; facilities created after 0021 never get it.
Fix: stop reading it now (roles cover 1140/2120); drop in Release 2.

**L-20 · DEFECT · P2 — "Cash" is a hardcoded list; 1025 sits under Cash & Bank.**
`cash-flow.service.ts:24,205,224`; `je-27:4`; `gst-settlement.service.ts:8`; `withholding-remittance.service.ts:8`; `opening-balance.service.ts:33-34`; web `use-reference-data.ts:164` (`isCashOrBank` = parent 1000, includes 1025); `owner-equity/page.tsx:61`; `cash-transfers/page.tsx:19-21`; `gst-settlement/page.tsx:25-27`; `cash-exceptions.ts:35`; seed `:41`. BS Cash & Bank includes 1025, CF excludes it; pickers offer 1025 and new bank accounts that the server then rejects; a 1020→new-1040 transfer shows as an operating outflow; CF `is_reconciled` (:225) compares the statement with itself, not with the BS.
Fix: `is_cash_equivalent` flag read everywhere; CF closing cash tied to BS.

**L-21 · DEFECT · P2 · A — EBITDA add-back includes all of 6100.**
`financial-statements.service.ts:40,202-211,562-569`; `fixed-assets/templates/types.ts:21`; `fixed-asset.service.ts:57-60,86`. Add-back = `SEEDED_DA_CODES` + every asset's depreciation-expense account; OTHER-category assets default to 6100 Miscellaneous → the whole Miscellaneous balance is added back. Impairment 6160 excluded.
Fix: depreciation accounts by registry role; OTHER gets its own depreciation account.

**L-22 · DUPLICATION · P2 — Partner table and normal-balance inference both decide account roles.**
`equity-accounts.ts:4-12,56-68` (comment "nothing records that an account belongs to a partner" is stale); `schema.prisma:1500-1523`; `financial-statements.service.ts:327-346,413-430`. `isCapitalAccount` also counts 3010 and any root credit equity; SoCE columns per account vs allocation per partner; P&L "capital introduced" counts OB movements to 3010.
Fix: statements read `Partner` for capital/drawings; plug and RE get explicit roles.

**L-23 · INCONSISTENCY · P2 — JE-30 owner equity ignores the Partner model.**
`accounting.controller.ts:444-507` (validation in the controller); `je-30-owner-equity.ts:46-77`; web `owner-equity/page.tsx:58-61,142-157`. Direction and account chosen independently: CAPITAL_IN can credit a drawings account, DRAWING can debit capital or the 3010 plug.
Fix: request takes `partner_id` + direction; server derives the account.

**L-24 · INCONSISTENCY · P2 — Two equity roll-forwards that disagree.**
P&L `equityRollforward` (`financial-statements.service.ts:296-364`, drawings positive) vs `getChangesInEquity` (`:380-477`, drawings negative). P&L block labelled IFRS 6.4/6.5 but rolls total equity; `combined_statement_permitted` checks only capital introduced; SoCE 3020 "Result" = closing − opening; a range across FY end gives offsetting 3020/3030 results.
Fix: one SoCE engine; P&L links to it.

**L-25 · INCONSISTENCY · P3 — Partners module gaps.**
`migrations/0026:32-43` (FKs only in SQL, no Prisma relation — a future `migrate diff` may drop them); `coa.service.ts:69-102` (`CONFIG_REFERENCES` has no partner entry → raw FK error); `partner.service.ts:207-265` (`setShares` delete-and-recreate for any date, no period-lock check); no audit trigger on `partners`/`partner_profit_shares`; `retiredOn` unused in allocation; no UI for retire/rename/adopt.

**L-26 · DUPLICATION · P2 · V — Web and server disagree on blocked lists.**
`opening-balances/page.tsx:66` (1010,1020,1030,1110-1150,3010) vs `opening-balance.service.ts:26` (1110-1150,1250). Server accepts 1010/1020 twice (fields + other lines); web allows 1250; neither blocks 1025, 1230, 2010, 3020, 3030. ~65 hand-written POSTED+book filters across 24 files.
Fix: blocked set derived from chart flags, served by the API.

**L-27 · DUPLICATION · P2 — Accounts identified by code literal; `is_system_account` only protects.**
Literals everywhere (§7); `coa.service.ts:249,300`; migration 0003 system list; `chart-of-accounts.ts:243-305` (sync never updates flags/sections on existing rows).
Fix: `SYSTEM_ACCOUNTS` registry.

**L-28 · INCONSISTENCY · P2 — Revenue and AR routing by name/enum.**
`templates/types.ts:22-28,40-45,67-70` (revenue account from upper-cased commodity *name* — renaming a commodity re-routes revenue); `receivables-aging.ts:33` (own AR list); `use-reference-data.ts:177-179` (web-only automated list).
Fix: revenue account stored on commodity/rate plan; AR from party control account.

**L-29 · INCONSISTENCY · P3 — Credit-note schema validates by code regex.**
`shared/schemas/accounting.ts:736` `^4[0-9]+$` accepts 4910 (contra) and 42xx, rejects REVENUE accounts in 0/7/8/9 ranges.
Fix: server validates against the invoice's own lines (R-03).

**L-30 · NON-STANDARD · P2 — Seeded chart missing accounts a Pakistani AOP needs.**
`chart-of-accounts.ts:37-192`: no finance cost/markup expense (despite 2110 bank loan; IFRS for SMEs 5.5(b)); no income-tax expense / provision (1240 has nothing to offset); no trade payables / accrued expenses (only 2040 "Utility Bills Payable"); no partners' current-account header; no suspense. 1140 peshgi sits under Trade Receivables.
Fix: add with registry roles (Trade Payables in the kernel; the rest per decision).

**L-31 · INCONSISTENCY · P3 — Codes and hierarchy disagree.**
Seed `:41,127-137,191`; `account-code.ts:32-58`; `coa.service.ts:12-26`. 6110 child of 6900 but coded in the 6000 block; 1025 between 1010 and 1020; 3010/3020/3030 details at root; digits 0/7/8/9 allowed (a route into "unclassified"); sync's 6110 re-parent wrapped in a try/catch swallowing every error (`:280-287`) — facilities differ on which side of operating profit 6110 sits.
Fix: class prefix required; 6110 migration explicit and reported.

**L-32 · WORKAROUND · P2 — 3010 renamed on deploy; sole proprietor's capital relabelled "unattributed".**
`chart-of-accounts.ts:289-302`; `equity-accounts.ts:31-47`; web `balance-sheet/page.tsx:232-243`, `opening-balances/page.tsx:345-355`; a banner tells the owner to post a manual reclass.
Fix: "Attribute opening equity" action on the Owners page (3010 → partner capital).

**L-33 · DUPLICATION · P3 — Chart rules copied into the web page.**
`chart-of-accounts/page.tsx:57-104` (`DEBIT_NORMAL`, `CLASS_LEAD_DIGIT`, `CLASS_SECTIONS`, `SECTION_LABEL`, `CLASS_LABEL`) vs `shared/schemas/accounting.ts:45-58`, `coa.service.ts:18-38`, `gl.service.ts:293-346`; labels already disagree ("Operating Expenses" vs "Expenses").
Fix: export from `@coldchain/shared`.

**L-34 · INCONSISTENCY · P3 — CoA guardrail gaps.**
`coa.service.ts:184-186,289-331`; web `chart-of-accounts/page.tsx:211-212,441`. Server allows root-level equity detail, web requires a parent; a header with active children can be deactivated (balance check sees the header's 0); deactivation skips `CONFIG_REFERENCES` (rate plan on an inactive account fails at invoice time); `CONFIG_REFERENCES` lacks partners and credit-note lines; API lets a system header's `statement_section` be edited, UI hides it.

**L-35 · WORKAROUND · P2 — Opening fixed assets get only a warning.**
`opening-balances/page.tsx:177-198,407-412`. GL balance without a register row → never depreciates; no way to enter opening accumulated depreciation.
Fix: existing-asset register import (C-30).

**L-36 · INCONSISTENCY · P3 — Opening-balance request lopsided.**
`shared/schemas/accounting.ts:216-240`; `opening-balances/page.tsx:85-89,139-152`; `opening-balance.service.ts:201-203`. Cash/bank dedicated fields, wallet via other lines; client recomputes the plug; plug line description says "owner capital"; opening AR has no document, settled FIFO by on-account payments.

**L-37 · INCONSISTENCY · P2 — Cash Flow and Changes-in-Equity pages outside the statement kit.**
`reports/cash-flow/page.tsx:38-112`; `reports/changes-in-equity/page.tsx:63-142`. No `StatementToolbar`/`useStatementPeriod`: no book selector, presets, comparison, print/CSV; default to 1 Jan UTC not the FY; `formatMoney` not `fmtAcct`.

**L-38 · UX-CONFUSION · P2 — "Unclassified" handled differently per statement.**
`financial-statements.service.ts:186-192` vs `profit-loss/page.tsx:217-226` (page lists amounts already folded into subtotals — looks double-counted); `balance-sheet/page.tsx:245-258` (excluded from current/non-current subtotals).
Fix: prevent unclassified accounts at creation; remove the bucket once none exist.

**L-39 · DUPLICATION · P3 — Three date/fiscal implementations.**
api `fiscal-year.ts`/`period.ts` (UTC) vs web `lib/fiscal-period.ts:28-107` (local getters, calendar quarters, `new Date('YYYY-MM-DD')` read with local getters) vs `lib/tax-period.ts` (UTC). `dayBefore` ×3 (`financial-statements.service.ts:313,398`, `equity-allocation.ts:40`, `cash-flow.service.ts:107`); month-name arrays ×3.
Fix: one UTC module in `@coldchain/shared`.

**L-40 · UX-CONFUSION · P3 — CoA shows PACCI balances only, nothing on headers.** `chart-of-accounts/page.tsx:144-163`.

**L-41 · UX-CONFUSION · P3 — Revenue-accrual page offers "Post accrual" when disabled.** `revenue-accrual/page.tsx:109-118,152-156`; its text says the invoice is unaffected, true only if the next accrual runs (L-04).

**L-42 · DEAD · P3 — Back-compat statement fields.**
`financial-statements.service.ts:227-228,269-274,685-687`; `gl.service.ts:252`; `shared/schemas/accounting.ts:450-454,502-504`. `revenue_lines`, `total_revenue_pkr`, `expense_lines`, `total_expense_pkr`, `asset_lines`, `liability_lines` have no web reader; `total_revenue_pkr` (net) contradicts `revenue_lines` (includes other income).

**L-43 · DEAD · P3 — Unreachable config and APIs.** `cash_flow_section` (L-19); REVERSED (L-11); `reversedById` post option (L-07); partner PATCH/adopt APIs without UI (L-25); `DEFAULT_BANK_ACCOUNT_CODE` bypassed by `'1020'` literals in `gst-settlement.service.ts:156`, `withholding-remittance.service.ts:82`.

**L-44 · DUPLICATION · P3 — Two cash-to-cash templates.** `je-17c-petty-cash-replenish.ts` vs `je-27-cash-transfer.ts`.

**L-45 · INCONSISTENCY · P3 — KATCHI permission check duplicated with different rules.** web `journal-entries/[id]/page.tsx:86-87` (role, MANAGER+ for PACCI) vs server `accounting.post_journal` + `book-gate.ts`.

**L-46 · INCONSISTENCY · P3 — Precision differs.** JE lines Decimal(14,2) (`schema.prisma:981-982`) vs credit notes Decimal(12,2) (`:1007,1033`).

**L-47 · WORKAROUND · P3 — `unattributedPlug` exists only to round consistently.** `equity-accounts.ts:86-88`. Disappears with one balance query.

---

## 5. Register — revenue, billing, receivables (R)

**R-01 · DEFECT · P0 · V — AR account follows a mutable party type.**
`templates/types.ts:22-28,57-61`; used by je-01:54, je-02:36, je-04:23, je-05:23, je-06:53, je-08:23, je-21:28, `opening-balance.service.ts:170`; `party/party.service.ts:161` lets `partyType` change freely. A FARMER retyped to TRADER: old invoice debited 1110, new payment credits 1120 → 1110 stays debit forever, 1120 goes negative. The aging tie-out sums all four (`receivables-aging.ts:33`), so the split is invisible there; each account is misstated on the BS.
Fix (Q1): `parties.control_account_code`, locked once posted.

**R-02 · DEFECT · P0 · V — Only the first application of an advance posts JE-04.**
`payment.service.ts:361` (`if (previousStatus === 'ADVANCE')`), `:391` (status → ALLOCATED unconditionally). Later allocations raise the invoice's `amountPaid` (`:343-346`) with no JE; 2010 and AR stay overstated. UI hides it: `apply-advance-form.tsx:31-33,89-90,109-110` ("can only be done once"), `payment-row-actions.tsx:31`, `payments/[id]/page.tsx:74` gate on `status==='ADVANCE'` → remainder stranded in 2010. Dishonour assumes every allocation went through JE-04 (`:517-524`).
Fix: JE-04 keyed on `isAdvance`, every allocation; status derived; "post missing advance application" correction sourced to the payment.

**R-03 · DEFECT · P0 · V — Credit notes never reverse output GST; revenue account is free choice.**
`accounting/credit-note.service.ts:62-69`; `templates/je-05-credit-note.ts:27-45`; `shared/schemas/accounting.ts:736`. Cap is balance due (incl. GST) but JE-05 debits only 4xxx → revenue over-reversed or 2020 overstated and remitted on a cancelled supply; 4910 never reversed; revenue account not tied to the invoice (4210 accepted).
Fix: credit note built from the invoice's lines, pro-rata net + GST: DR revenue, DR 2020, discount, CR AR.

**R-04 · DEFECT · P0 · V(credit note)/A(payment) — Book from the request, not the invoice.**
`payment.service.ts:140` (default PACCI); `shared/schemas/payment.ts:34`; `payments/payment-form.tsx:191-205` (never sends `book_type`); `validateInvoiceAllocation` `:937-960` (no book check); `credit-note.service.ts:95` (`body.book_type ?? 'PACCI'`). `bad-debt.service.ts:40` correctly uses the invoice's book. A KATCHI invoice paid from the UI credits PACCI AR.
Fix: book from the invoice(s); mixed-book allocations rejected.

**R-05 · DEFECT · P0 · V — A CLEARED cheque can be dishonoured; three fallback accounts.**
`payment.service.ts:396-420` (no `clearanceStatus` check); `je-06:54,95-101`; UI allows it (`payment-row-actions.tsx:30`, `payments/[id]/page.tsx:89`). JE-06 credits 1025 though JE-24 (`:629-645`) already moved it to 1020 → 1025 negative, 1020 overstated. Fallbacks: JE-06 internal `assetAccountForPaymentMethod('CHEQUE')`=1020; loan-reversal `:551-552`=1025; allocate `:331-332`=1025. JE-24 always deposits to 1020 (`je-24:40,47`).
Fix: dishonour = `reverseInTransaction` over the payment's chain (JE-24 reversed first when cleared).

**R-06 · DEFECT · P0 · A — KATCHI invoices accrue GST nothing settles.**
`invoice/invoice.builder.ts:53-55` (GST default regardless of book); `je-01:135-144`; `gst-settlement.service.ts:15,60` (PACCI only). KATCHI 2020 grows without limit; informal-book customers billed "GST".
Fix: GST 0 for KATCHI in builder and `updateDraft`.

**R-07 · DEFECT · P1 · V — Negative ADJUSTMENT line → JE-01 unbalanced.**
`je-01:69-76` (ADJUSTMENT → 4150), `:124` (`if (amount <= 0) continue`); the "contra (negative)" promised at `:72` was never built. AR debit is net of the adjustment → JOURNAL_UNBALANCED on finalize. `invoice.integration.test.ts:352-379` adds −100 but never finalizes.
Fix: negative adjustments → 4910, or remove ADJUSTMENT for the discount field.

**R-08 · WORKAROUND · P1 — Surcharges can't be reversed, paid, written off, or voided around.**
`je-21:22-25` vs `journal-entry.service.ts:172-174`; `invoice.service.ts:299-304`; `surcharge.service.ts:33-38`. JE-21 says "corrected with a manual REVERSAL", which `reverse()` refuses; the posted-surcharge count never drops (0025 keeps originals POSTED) so an invoice with a surcharge can never be voided; allocation capped at `total − paid` (`payment.service.ts:956-958`), write-off covers `total − paid` (`bad-debt.service.ts:26`) → surcharge AR cleared only by unallocated on-account cash and survives a write-off; manual DR 4210 / CR AR invisible to aging (`receivables-aging.ts:197-216`) and party ledger (debit lines only, `payment.service.ts:741-759`); JE-21 typed ACCRUAL like JE-25; computed on principal incl. GST (`surcharge-calc.ts:42`).
Fix: SURCHARGE document through normal allocation / credit / write-off / void.

**R-09 · DEFECT · P1 — Draft invoice dated at creation; stuck once its month locks.**
`invoice.builder.ts:64` (`invoiceDate: new Date()`; outbound date only as period end `:126`); `shared/schemas/invoice.ts:26-35` (no `invoice_date`); `invoice.service.ts:224`; `period-lock.service.ts:17-29`. Finalize → PERIOD_LOCKED with no way to redate; backdated dispatch books revenue in the wrong period.
Fix: invoice date = dispatch/transfer date, editable in draft; drafts must be finalised before month close.

**R-10 · DEFECT · P1 — Aging is not as-of and mixes books.**
`receivables-aging.ts`: no `invoiceDate <= asOf` (`:42-55`); current `amountPaid`/allocations (`:85-98`); invoices both books but tie-out (`:330`) and surcharges (`:206`) PACCI only → permanent variance for any KATCHI invoice; opening lines unfiltered by book; buckets from invoice date not due date; OB reversals ignored (L-03); in-memory pagination (`:342-345`); web footers sum the current page only (`receivables-aging/page.tsx:53-73`).
Fix: one open-item read model.

**R-11 · DEFECT · P1 — Party ledger built from documents, not the GL.**
`payment.service.ts:652-870`; `payment.controller.ts:151-161`; `parties/[id]/page.tsx:148,259`; `shared/schemas/payment.ts:108`. FINALIZED invoices only (`:669`) — WRITTEN_OFF invoices vanish while their payments remain; bad debt, void reversal, manual lines missing; payments at gross incl. the loan portion (credited 1140, `:809`); advances as AR credits; dishonoured payments dropped (`:686`); controller ignores query params → Outstanding tile mixes books; no SURCHARGE type in schema.
Fix: statement = AR GL lines for the party, book, date range.

**R-12 · DUPLICATION · P1 — Five "what a party owes" figures.**
`dashboard.ts:125-131` (total − paid, both books); `party.repository.ts:57-67` (credit limit); aging (R-10); ledger (R-11); web `parties/[id]/page.tsx:228-229` "% of limit used" from the ledger vs `over_credit_limit` (`party.service.ts:103-106`) from invoices → "112% used" without the flag. Credit limit never enforced at dispatch/finalize.
Fix: one function on `partyBalances`.

**R-13 · INCONSISTENCY · P1 — Two unapplied-cash models; normal unallocated payments can't be allocated from the UI.**
`payment.service.ts:192-219`; `payment-row-actions.tsx:31`; `payments/[id]/page.tsx:120-122`; `surcharge-calc.ts:42`; `payment.service.ts:116-136`. Advance → 2010, unallocated normal payment → AR; UI allocates advances only → invoices stay "unpaid" and get surcharged though paid on account; tax withheld rejected on advances but allowed on a fully unallocated payment.
Fix: keep the ERP-standard pair (party credit in AR / designated advance in 2010) with one allocate action for both.

**R-14 · DEFECT (intent) · P1 — Ownership-transfer billing inconsistent.** `ownership-transfer.service.ts:108-136` (FULL), `:186-231` (PARTIAL); `storage-charge.ts:30-37`. → Decision list.

**R-15 · DUPLICATION · P2 · V — Billing-period-start rule ×3.**
`invoice.builder.ts:108-125`; `ownership-transfer.service.ts:115-119`; `revenue-accrual.service.ts:67-74` (comment cites the builder's line numbers); accrual spreads seasonal fees its own way (`:79-105`).
Fix: `billingPeriodStart(lot)` beside `computeStorageCharge`.

**R-16 · NON-STANDARD · P1 — Revenue recognised under two policies chosen by a setting.**
`invoice.service.ts:198-259`; `shared/schemas/facility.ts:92`; `revenue-accrual.service.ts:125,211-216`; `storage-charge.ts:41`. Accrual off by default → a season's revenue lands in the withdrawal month (IFRS for SMEs s.23 requires stage of completion); bags on DRAFT invoices neither accrued nor billed at period end; monthly plans `ceil(days/30)` front-load.
Fix (Q2): accrual is the fixed policy.

**R-17 · DEFECT · P2 · V — Dishonour links reversals in a circle.** = L-07. `payment.service.ts:541,544,585,589`.

**R-18 · DUPLICATION · P2 — Peshgi reversal JE built inline; 1140 literal ×4.** `payment.service.ts:554-577`; `je-18:31`, `je-19:39`, `je-20:4`.

**R-19 · INCONSISTENCY · P2 — Peshgi repayment paths.**
`payment.service.ts:904,189-196,450-491,548-591,286-292,347-357`; `peshgi.service.ts:32-33,107`; `shared/schemas/peshgi.ts:34`; `loans/[id]/page.tsx:113`. Combined settlement records `DEDUCTED_FROM_PRODUCE` though cash/cheque was received; loan-allocation path has no UI but drives JE scaling, JE-24's full-amount rule and the dishonour loan branch; `allocate`'s LOAN branch unreachable (`:286-292` throws first); repayment/issue asset accounts client-supplied and never validated as cash.
Fix: server-derived accounts; build the combined-settlement UI or delete the path.

**R-20 · NON-STANDARD · P2 — 1140 never reconciled to loans.**
`peshgi.service.ts:144-151,198-206`; `payment.service.ts:459-468,888-897`; `opening-balance.service.ts:26`; `opening-balances/page.tsx:66`; `je-20:2`. `balanceOutstandingPkr` stored and mutated in 4 places; dishonour forces ACTIVE (`:466`); go-live loans can't be entered (OB blocks 1140; issue screen would credit cash that never moved); loan write-offs share 6080 with trade bad debts.
Fix: loan balance derived from 1140 party lines; opening-loan import against the plug; invariant 1140 GL = Σ loans.

**R-21 · DEFECT · P2 — `amountPaidPkr` overloaded, never recomputed.**
`payment.service.ts:172,343,446`; `credit-note.service.ts:137-143` ("Convention"); `bad-debt.service.ts:52`; web `invoices/columns.tsx:19-33`, `invoices/[id]/page.tsx:66,439`; `shared/schemas/invoice.ts:55,101`. WRITTEN_OFF and credit-noted invoices display as PAID; WRITTEN_OFF missing from the Zod enum and web types.
Fix: `refreshInvoiceSettlement` separating paid / credited / written-off.

**R-22 · INCONSISTENCY · P2 — Payment status stored and read two ways.** `payment.service.ts:100-102,391` (ALLOCATED even when partial); `:361` checks `status`, `:517` checks `isAdvance`.

**R-23 · DEFECT · P2 — Credit notes: race, dead statuses, no UI, confusing next to void.**
`credit-note.service.ts:55-58,94,133` (invoice not row-locked → concurrent credit note + payment can over-settle); `schema.prisma:237-241` (ISSUED never persists, CANCELLED never set); `accounting.controller.ts:631-684`; credit-note numbering lives in `journal-entry-number.ts:41-69`; no cancel path, no web page for credit notes or write-offs.

**R-24 · WORKAROUND · P2 · V — Void mechanics.** `invoice.service.ts:77,199,312,334,336-342,319`; `je-08:30`. Reason appended to notes; `journalEntry?` optional (finalize silently skips JE-01 with `if (this.journalEntry)`, void asserts `!`); void reversal, JE-01, JE-08 all `sourceTable 'invoices'`.

**R-25 · DEAD · P3 — JE-01 ADVANCE_APPLIED branch.** `je-01:41-64,100-109`; `shared/schemas/invoice.ts:17`; `invoices/[id]/page.tsx:394`. Schema blocks the line type; nothing creates it; literal `'2010'` (:102).

**R-26 · DEAD · P3 — Unused code/settings.** `InvoiceService.buildFromOutbound` (`invoice.service.ts:80-82`); `CreateInvoiceRequest` (`shared/schemas/invoice.ts:3-13`); `ApplySurchargeRequest.notes` ignored (`surcharge.controller.ts:41-46`); `creditTermsDays` display-only (no due date); `cheque_date` unused (post-dated cheque settles AR on receipt); `revenueAccountCode` on rate plans/service charges settable only by `seed.ts:411-445`.

**R-27 · DEFECT · P2 · V — `apps/api/src/scripts/backfill-journal-entries.ts` unsafe.** Omits discounts (unbalanced), uses the disbursement mapping (cheques → 1020), picks up loan-only payments (posts JE-02 crediting AR *and* 1140), ignores tax withheld, JE-04 not idempotent; no package script runs it. Delete.

**R-28 · UX / DEFECT · P2 — Service lines bypass the catalog.** `invoices/[id]/page.tsx:194-206`; `invoice.service.ts:115-123`; `je-01:70`. Free text + price, never `service_charge_id`; 4110-4140 unreachable, all to 4150.

**R-29 · NON-STANDARD · P2 — Rate-plan edits reprice past storage.** `rate-plan.service.ts:95-112`; `invoice.builder.ts:121,137-140`. Fix: rates frozen once used.

**R-30 · INCONSISTENCY · P2 — Storage line Qty × Unit Price ≠ Amount on monthly/daily plans.** `storage-charge.ts:40-58`. Fix: quantity in bag-months/bag-days.

**R-31 · NON-STANDARD · P2 — Sales tax on services.** `shared/schemas/facility.ts:89` (18% default — federal goods rate; cold storage is a provincial service); one output account; no NTN/STRN on facility/party; GST computed in two places (`invoice.builder.ts:55-56` vs `invoice.repository.ts:120-122`). → Decision list (tax codes); duplication fixed.

**R-32 · NON-STANDARD · P2 — Customer withholding (1240) untracked.** `reporting/reports/withholding-tax.ts`; `expenses/templates/withholding.ts:10-26`; `payment-form.tsx:330-338`. No section/certificate/rate; no 1240 report. → Decision list.

**R-33 · INCONSISTENCY · P3 — Tax settlement windows; hardcoded settlement accounts.** `gst-settlement.service.ts:8,107,156`; `withholding-remittance.service.ts:8,35-52,82`; `withholding-tax.ts:93-101`. "Outstanding" = credits to period end minus every debit ever → a later-dated void reduces an earlier period's settlement; cash lists hardcoded in services and pages.

**R-34 · DUPLICATION · P3 — Document-number generator ×6+.** `invoice-number.ts:21-40`, `receipt-number.ts:26-42`, `journal-entry-number.ts:20-39,48-69`, `peshgi-number.ts`, `dispatch-note-number.ts` (+ expense, payroll, advance, asset — C-43). Fix: `nextDocumentNumber` (UTC).

**R-35 · DUPLICATION · P3 — `round2` ×~12; money as floats.** `je-01:157`, `je-02:79`, `payment.service.ts:985`, `peshgi.service.ts:293`, `reporting/helpers/money.ts:1`, `surcharge-calc.ts:17`, `storage-charge.ts:61`, …

**R-36 · DUPLICATION · P3 — Web PDF fetch ×2; truncated linked payments; crash on loan allocations.** `invoices/[id]/page.tsx:287-302,147-175`; `invoice-row-actions.tsx:52-67`; `payments/[id]/page.tsx:171-175` (`alloc.invoice_id.slice` crashes for LOAN, links `/invoices/null`); linked payments rebuilt from the party's first 100 payments.

**R-37 · UX-CONFUSION · P3 — Buttons the server refuses; account codes in UI text.** Void shown when paid = 0 even with credit notes/surcharges (`[id]/page.tsx:330`, `invoice-row-actions.tsx:84`); surcharge button when the rule is off (`:484`); codes in `payment-form.tsx:325`, `payment-dialogs.tsx:68`, `apply-advance-form.tsx:109`, `loans/[id]/page.tsx:269`, `gst-settlement/page.tsx:114,211`.

**R-38 · WORKAROUND · P3 — Party id used as a user id.** `payment.service.ts:351,384` (`userId ?? party_id` as `createdBy`). Make `userId` required.

**R-39 · INCONSISTENCY · P3 — Dashboard financial figures.** `dashboard.ts:6-14,132-140`: "collected today" gross across both books incl. loan portions/advances/withheld tax; roles ranked by a hardcoded list; full aging run for the 90+ bucket.

**R-40 · NON-STANDARD · P3 — Source-table strings as a query API.** `je-25:81`, `je-26:73`, `je-29:40`; period entries sourced to the facility id.

**R-41 · NON-STANDARD · P2 — Direct write-off only.** `bad-debt.service.ts`; `je-08`. No allowance, no recovery, surcharge AR excluded, invoice not row-locked. → Decision list (allowance); row lock fixed.

---

## 6. Register — expenses, payroll, advances, fixed assets (C)

**C-01 · NON-STANDARD · P1 · V — No accounts-payable model.** `je-17b-expense-accrued.ts:35`, `je-17b-pay-accrued-payment.ts:40` (2040 only); `schema.prisma:1280-1315` (one expense line, free-text `vendorName`); `schema.prisma:42-48` (no SUPPLIER); no payables aging; JE-17A/17B lines carry no `partyId`; `1210 Advance Payments to Suppliers` never posted; no input-tax split to 1260. Fix (Q3): full AP.

**C-02 · DEFECT · P1 · A — Direct-paid expenses land in the payment month.** `expense.service.ts:202-212` (`entryDate: paymentDate`); accrual opt-in. Fix: recognise at bill date.

**C-03 · UX-CONFUSION / DEAD · P2 — Three expense paths; accrual flag advisory.** `expense.service.ts:49-51,155,168,224-225`; web `expense-voucher-row-actions.tsx:72`, `expenses/[id]/page.tsx:104,123`. `pay()` accepts an APPROVED `isAccrual` voucher (skips the accrual); `accrue()` forces `isAccrual`; create-time payment fields ignored then overwritten; detail shows "Accrual" for directly-paid vouchers.

**C-04 · DEFECT · P1 — Posted expense uncorrectable.** `expense.service.ts:108` (cancel refuses PAID/ACCRUED); `journal-entry.service.ts:172`. Fix: void bill/payment via reversal.

**C-05 · DEFECT · P2 · V — Expense-account guard browser-only.** `shared/schemas/expenses.ts:19,35` (`^[5-6][0-9]+$` accepts 6010, 6080, 6110, headers 5000/6000/6900 — a header fails only at pay, after approval); `use-reference-data.ts:177-184` (blocks 6150 which nothing posts; misses 6160, 6100). Fix: chart flags enforced server-side.

**C-06 · DEFECT · P2 — Paying account unchecked on most outflows.** Checked: `accounting.controller.ts:402-413,453-459`, `withholding-remittance.service.ts:83`. Unchecked: `expense.service.ts:173,238`, `payroll-run.service.ts:379,444`, `fixed-asset.service.ts:61,170`, `employee-advance.service.ts:57-58`. Web `isCashOrBank` includes 1025 → salaries "paid" from cheques in hand. Fix: `assertCashAccount` via `is_cash_equivalent`.

**C-07 · DUPLICATION + DEFECT · P2 — Cash defined in 6+ places; a second bank breaks CF.** = L-20.

**C-08 · DUPLICATION / DEAD · P3 — JE-17C duplicates JE-27, no screen.** `je-17c-petty-cash-replenish.ts:30-47`; `expense.controller.ts:51-62`. Delete.

**C-09 · DEFECT · P2 — WHT not stored on the voucher.** `schema.prisma:1280-1315`; `expense.service.ts:219-228,284-308`; `withholding-tax.ts:130-140,55-58` (s.165 counterparty rebuilt by joining JE `sourceId` to free-text `vendorName`); no rate, no filer status. Fix: on the supplier payment.

**C-10 · INCONSISTENCY · P2 — Two remittance models.** `withholding-remittance.service.ts:29-58,9,71-80` (2071/2072 by period from GL, JE-29 PACCI hardcoded); `payroll-run.service.ts:400-459` (2060/2061/2070 per run, once, browser-summed amounts); `payroll/runs/[id]/page.tsx:237-239`. `WITHHOLDING_ACCOUNTS` lives in expenses but is imported by accounting/reporting. Fix: one period-based statutory remittance.

**C-11 · DUPLICATION · P3 — Voucher action rules ×2 on the web.** `expenses/[id]/page.tsx:101-109` vs `expense-voucher-row-actions.tsx:63-77`. Fix: `allowed_actions` from the API.

**C-12 · INCONSISTENCY · P3 — Three payment-method enums; method/account unchecked.** `shared/schemas/expenses.ts:15`, `schema.prisma:298`, `shared/schemas/employee-advances.ts:9`, `accounting-accounts.ts:15-20`; `expense.service.ts:224-225`; `expense-number.ts:6-17` (edited date keeps old number); cheques written credit 1020 at once.

**C-13 · DEFECT · P1 · A — Payroll finalize/pay/updateLine unlocked.** `payroll-run.service.ts:232-241,366-372` vs `:402,478`; `:156-160` (status checked outside the tx); web buttons not disabled in flight → double JE-15/JE-16 (the `@unique` JE pointers don't stop it). Fix: `lockRow` first in every transition.

**C-14 · DEFECT · P1 · A — Advance over-recovery across two open drafts.** `payroll-run.service.ts:51-65,115-117,177-184,318-349`. Jan and Feb drafts pre-fill from the same balance; `finalize` neither re-checks nor locks; balance goes negative and is marked RECOVERED (:347); no CHECK constraint. Fix: `FOR UPDATE` + re-check in finalize; `CHECK (>= 0)` NOT VALID.

**C-15 · DEFECT · P1 · V — Reversing a paid run reverses cash that left.** `payroll-run.service.ts:538-574` mirrors JE-16 and JE-16B as well as JE-15; web `runs/[id]/page.tsx:374`. Fix: reverse = undo JE-15 while unpaid; "void payment" separate.

**C-16 · DUPLICATION + NON-STANDARD · P2 — JE-15/JE-15B copies; cost by pay type.** `je-15-monthly-payroll.ts` (113 lines) vs `je-15b-daily-wages.ts` (117); `payroll-run.service.ts:279-304`. Salaried → 6010 overhead, daily → 5030 direct regardless of role. Fix: one builder, cost account on Employee.

**C-17 · WORKAROUND / DEAD · P2 — `PAYROLL_OTHER_DEDUCTIONS_UNSUPPORTED` outlived its reason.** `payroll-run.service.ts:261-274`; `schema.prisma:1202`; `shared/schemas/payroll.ts:101`; `salary-slip.html:176`; web `runs/[id]/page.tsx:331,473`. Stop writing now; drop in Release 2.

**C-18 · DEFECT · P1 · V — Days worked doesn't drive daily-wage gross.** `payroll-run.service.ts:111,124,168,191`; web `runs/[id]/page.tsx:311-320`. Fix: server computes days × wage.

**C-19 · DUPLICATION · P2 — Magic numbers.** "26 days" ×4, EOBI 375/1875 ×3 (`payroll-run.service.ts:14-15,111,124`, `employee-advance.service.ts:47`, web `advances/new:80`, `employees/new:139`, `runs/new:75-76`); flat EOBI charged to daily staff regardless of days. Fix: facility payroll settings with effective date.

**C-20 · NON-STANDARD · P2 — Statutory payroll gaps.** s.149 typed by hand; no NTN; no SESSI/PESSI; no gratuity/leave; `terminate` ignores advances. → Decision list.

**C-21 · NON-STANDARD · P2 — "Owner pay is a drawing" enforced by UI text only.** web `employees/new/page.tsx:78-90`; `employee.service.ts:7-27`; `schema.prisma:1125-1153`.

**C-22 · DEAD / WEAK · P3 — Invariant 16 is circular.** `payroll-run.service.ts:684-706` vs `:247-290`. Fix: 2030 GL = Σ net pay of FINALIZED-unpaid runs.

**C-23 · DUPLICATION · P3 — Run totals ×4.** `payroll-run.service.ts:101-150,203-226,247-259,378`; web `runs/[id]/page.tsx:75-77,237-239,291-300`; JE-16 pays stored `totalNetPayablePkr`, JE-15 recomputes.

**C-24 · UX-CONFUSION · P3 — Slips for draft/reversed runs; negative net caught late.** `payroll-run.service.ts:630-666,186`.

**C-25 · NON-STANDARD · P3 — Salaries paid as one lump sum from one account.** `payroll-run.service.ts:374-381`; `je-16`.

**C-26 · NON-STANDARD · P2 — Advances: no cash repayment, void or settlement.** `employee-advance.service.ts` (issue, writeOff only) vs `peshgi.service.ts:74`.

**C-27 · INCONSISTENCY · P3 — Advance write-off to customer bad debt 6080.** `je-23:36`. Fix: staff-benefit account.

**C-28 · INCONSISTENCY · P3 — Local-time numbering.** `employee-advance-number.ts:9-11`, `fixed-asset-number.ts:23`, `peshgi-number.ts:9`, `depreciation-calc.ts:41-58`.

**C-29 · DEFECT · P1 · A — Depreciation run can deadlock.** `fixed-asset.service.ts:400-409` (period-wide "already posted") + `:417-453` (per-asset "prior posted"); `:149` (commission accepts any date); `:366-374`. Repro: run March; commission A in April with start 5 March; April fails (no A-March), March re-run fails (B-March exists). Fix: per-asset catch-up.

**C-30 · DEFECT · P0 · A — Opening-balance advice double-books assets.** web `opening-balances/page.tsx:407-410` ("Add each one under Fixed Assets as well"); `fixed-asset.service.ts:61,94,101-114` (create always posts JE-12, default 1020); funding picker offers cash/bank/2100 only (`fixed-assets/new/page.tsx:43-45`); `accumulatedDepreciationPkr: 0` hardcoded. Fix: register import (no JE) tied to the OB entry; "reverse purchase entry, keep register row" for boxes already hit.

**C-31 · DEFECT · P2 — Disposal unguarded.** `fixed-asset.service.ts:162-208` (no lock; no catch-up to disposal date; no date ≥ last depreciation check; allowed on PURCHASED); web `[id]/page.tsx:112-121`.

**C-32 · DEFECT · P2 — WRITTEN_OFF assets can never leave; impairment irreversible.** `fixed-asset.service.ts:285,166-168`.

**C-33 · DEFECT · P2 — No correction for purchase, depreciation or impairment.** Only `reverseDisposal` (`:312-380`).

**C-34 · NON-STANDARD · P2 — Category → account mapping wrong.** `fixed-assets/templates/types.ts:13-22`: OTHER → 1310/1311 Cold Plant + 6100 Misc; COMPUTER hardware depreciates to 6140 "Amortisation — Software"; 1350/1360/1361 unused; PLANNED/PENDING never set.

**C-35 · NON-STANDARD (policy) · P3 — WDV compounds monthly (~18.2% effective at 20%).** `depreciation-calc.ts:120-121,106-110`; impairment branch ignores the 15th-of-month rule. → Decision list.

**C-36 · INCONSISTENCY · P3 — KATCHI check placement differs.** `fixed-asset.controller.ts:133-147` vs `payroll.controller.ts:168-169,183-184`.

**C-37 · NON-STANDARD · P3 — Purchase/posting shape.** Cash/long-term-loan only; one JE-13 per asset per month; only the run has a 30 s timeout (`fixed-asset.service.ts:483-496,556`).

**C-38 · DEAD / DUPLICATION · P3 — Leftovers.** `fixed-asset.repository.ts:38-43` (`listInService` unused); SLM/WDV checks in Zod and service; `disposalProceedsPkr ? … : null` turns 0 into null; category labels hardcode codes.

**C-39 · DUPLICATION · P2 · V — Reversal hand-built; reasons in notes.** = L-08; tag-appends at `payroll-run.service.ts:576-582`, `fixed-asset.service.ts:365-374`, `expense.service.ts:116-121`, `fixed-asset.service.ts:286-289`, `invoice.service.ts:336-342`, `bad-debt.service.ts:53-55`.

**C-40 · INCONSISTENCY · P1 — Root cause behind C-04/C-26/C-33.** `journal-entry.service.ts:159-176` whitelist; no correction for cash_transfer, owner_equity, withholding_remittance, expense_vouchers, employee_advances, asset purchase/depreciation/impairment; petty cash ('manual') reversible.

**C-41 · INCONSISTENCY · P2 — Locking ad hoc.** See the posting table below. Fix: `lockRow` in every transition.

**C-42 · DUPLICATION · P3 — KATCHI check double-reads.** Controllers `getById` → `assertKatchiWriteAllowed` → service re-reads (check-then-act gap). Fix: check inside the service after the lock.

**C-43 · DUPLICATION · P3 — Numbering and rounding copied.** = R-34/R-35; `round2` also in web `runs/[id]/page.tsx:27`.

**C-44 · INCONSISTENCY · P3 — Cash transfer / owner equity in a controller.** `accounting.controller.ts:393-507`; `sourceId = userId` (`je-27:43`, `je-30:59`, `je-17c:33`); no transfer history.

**C-45 · INCONSISTENCY · P3 — Entry types misused.** Petty cash typed EXPENSE; JE-27/30/28 all ADJUSTMENT.

**C-46 · NON-STANDARD · P3 — Backdating limit not applied to cost documents.** `lot.service.ts:286-288`, `outbound.service.ts:137-143` only.

**C-47 · UX-CONFUSION · P3 — Stale role wording.** `fixed-assets/new/page.tsx:51`, `payroll/employees/new/page.tsx:41`, `payroll/runs/new/page.tsx:33`; `isOwner` holding permission checks (`fixed-assets/[id]/page.tsx:68`, `runs/[id]/page.tsx:127`); `owner-equity/page.tsx:29,53`.

**C-48 · UX-CONFUSION · P3 — Dialogs quote account codes.** `runs/[id]/page.tsx:490,513`, `fixed-assets/[id]/page.tsx:280,302`, `expense-voucher-dialogs.tsx:241-242`.

Also found: `shared/schemas/facility.ts:55` — `RevenueAccrualRule.start_date` regex `^d{4}-d{2}-d{2}$` has no backslashes, so no real date ever validates (**V**).

### How each cost flow posts and reverses today

| Flow | Posted from | Row lock | Numbering | KATCHI check | Reversal | Sub-ledger unwind | Status after |
|---|---|---|---|---|---|---|---|
| Expense JE-17A/17B | ExpenseService | accrue/pay only | EXP-YYYYMM, UTC | controller | none (cancel pre-posting only) | n/a | unchanged |
| Petty cash JE-17C | ExpenseService, no document | none | none | controller | generic `reverse` ('manual') | n/a | n/a |
| Payroll JE-15/15B/16/16B | PayrollRunService | create (advisory), remit/reverse | PAY-YYYYMM | controller | mirrors all three JEs | recoveries voided, advance restored | REVERSED + note tag |
| Advance JE-22/23 | EmployeeAdvanceService | issue (advisory), write-off | ADV-YYMMDD, local | controller | none | — | RECOVERED/WRITTEN_OFF |
| Asset JE-12/13/14/28 | FixedAssetService | impair/reverse-disposal only | FA-YYYY, local | controller except depreciation run | disposal only | status derived | + note tag |
| Cash transfer JE-27 | accounting.controller | none | none | controller | none | n/a | n/a |
| Owner equity JE-30 | accounting.controller | none | none | controller | none | n/a | n/a |
| WHT remittance JE-29 | WithholdingRemittanceService | advisory per section | none | PACCI hardcoded | none | n/a | n/a |

---

## 7. Hardcoded account-code literals (to be moved into `SYSTEM_ACCOUNTS`)

- `packages/shared/src/accounting-accounts.ts`: 1010, 1020, 1030, 1020 (default bank), 1025.
- `packages/shared/src/schemas/accounting.ts:736`: `^4[0-9]+$`; `schemas/expenses.ts:19,35`: `^[5-6][0-9]+$`.
- `apps/api/src/modules/accounting/templates/types.ts`: 1110/1120/1130/1150, 4010-4040, 4050, 2020, 1240, 2010, 6080, 4910.
- `accounting/templates/`: je-01 (4150, 2010), je-21 (4210), je-24 (1025), je-25 (1250), je-26 (1260), je-27 (1010/1020/1030).
- `accounting/equity-accounts.ts`: 3020, 3030, 3010, 3100, 3200.
- `accounting/financial-statements.service.ts`: 5040, 6120, 6130, 6140, 3020, 3030.
- `accounting/cash-flow.service.ts`: 1010, 1020, 1030, 1025.
- `accounting/opening-balance.service.ts`: 1110-1150, 1250, 1010, 1020.
- `accounting/gst-settlement.service.ts`, `withholding-remittance.service.ts`: 1010/1020/1030, `?? '1020'`.
- `accounting/coa.service.ts`: class digits 1-6.
- `expenses/templates/`: withholding.ts (2071, 2072, 2070), je-17b ×2 (2040), je-17c (1010).
- `payroll/templates/`: je-15 (6010, 6015, 2030, 2060, 2061, 2070, 1230), je-15b (5030, 5035, …), je-16 (2030), je-16b (2060, 2061, 2070); `payroll-run.service.ts:691` (2030).
- `employee-advances/templates/`: je-22/je-23 (1230; 6080 via `ACCOUNT_BAD_DEBT`).
- `fixed-assets/templates/types.ts`: 1310/1311/5040, 1320/1321/6120, 1330/1331/6130, 1340/1341/6140, 1310/1311/6100, 4230, 6110; je-28 (6160, 1370).
- `peshgi/templates/`: je-18/19/20 (1140); `payment.service.ts:563` (1140).
- `reporting/reports/receivables-aging.ts:33` (1110-1150); `cash-exceptions.ts:35` (1000).
- `packages/db/src/chart-of-accounts.ts` (the seed — the one legitimate home besides the registry); `prisma/seed.ts:413-439`; migrations 0003/0004/0015/0021.
- Web: `hooks/use-reference-data.ts:164` (1000), `:178` (automated list); `accounting/cash-transfers/page.tsx:19-21,27-28`; `gst-settlement/page.tsx:25-27,56`; `owner-equity/page.tsx:29,44,53,61`; `opening-balances/page.tsx:66,68,189`; `fixed-assets/new/page.tsx:44` (2100); `chart-of-accounts/page.tsx:77-79`; prose in `partners/page.tsx:269-270`, `balance-sheet/page.tsx:239-240`, and the dialogs in C-48 / R-37.

---

## 8. Pre-update checks

Run on a **restored copy of the client backup** before the box takes this release. Migration 0025
repaired the ledger and erased the evidence in the same step; these queries exist so that does not
happen again. Each detected case has a correction posted **through the app**, never a migration
(CI gate: only `postInTransaction` inserts journal rows).

The queries are in **`scripts/preupdate-checks-consolidation.sql`** (read-only; `psql -d <restored-db> -f …`).
All 20 were run against the development database on 2026-09-25: every one executes, and all
defect checks returned zero rows there (the dev facility has almost no ledger activity — this
proves the SQL, not the client's books).

| Check | Finding | Correction if non-empty |
|---|---|---|
| C01 AR split across AR accounts per party | R-01 | Manual reclass JE per party (`party_id` on every line), posted **before** the update on the current version |
| C02 AR / 1140 / 2010 lines with no party | L-06 | Manual JE moving the balance onto the right party |
| C03 credit notes on GST invoices | R-03 | Credit-note GST correction (Stream R action) |
| C04a/b 1025 negative; dishonoured cheques leaving 1025 non-zero | R-05 | Posted correction per payment (Stream R) |
| C05 advance allocations without JE-04 | R-02 | "Post missing advance application" (Stream R), sourced to the payment so dishonour can find it |
| C06 reversed opening-balance entries | L-03 | None needed once the AR read model is GL-based; confirm totals after the update |
| C07 reversed payroll runs that had been paid/remitted | C-15 | Re-post the payment/remittance legs that really happened |
| C08 assets double-booked at go-live | C-30 | "Reverse purchase entry, keep register row" (Stream C-a) |
| C09 KATCHI invoices with GST | R-06 | Credit-note the GST portion |
| C10a postings to 3030 / off-prefix accounts | L-02, L-31 | Reclass JE to the right account |
| C10b non-equity details with no sectioned header | L-38 | Re-parent (unposted) or reclass (posted) before the bucket is removed |
| C11 accruals never reversed | L-04 | The new first accrual reverses them (Stream R) |
| C12 negative advance balances | C-14 | Manual JE to 1230 with the employee's recovery corrected; validates the new CHECK |
| C13 payment / credit-note book ≠ invoice book | R-04 | Reclass between books |
| C14 rows still `posting_status = 'REVERSED'` | L-11 | Must be 0 for the CHECK to validate |
| C15 mirrors pointing back at their original | L-07 | Metadata only; recorded, left as is |
| C16 FY start changed after the first JE | L-05 | Owner confirms which start month is right before it is frozen |
| C17 earliest open period vs FY start | Q2 | Chooses `accrual_start_date` |
| C18 open 2040 accrued vouchers | C-03 | "Convert to bill" (Stream C-b) |
| C19 legacy JE-21 surcharges | R-08 | None; they stay visible and clearable on account |
| C20 owner-created accounts | kernel sync | Must not sit on a code the new seed claims — rename/renumber first |

## 8a. PR #25 browser pass (2026-09-25, before this branch was cut)

Driven in Chrome as OWNER on the dev server; everything created was deleted afterwards and the
database verified identical to a pre-pass ID snapshot (3 JEs, 1 partner, 3 share rows, 2 accounts
removed with guards re-enabled).

- **Passed:** adding an owner opened 3130/3230 and the record in one step; a dated ratio saved alongside the previous one (50/50 from 12 Sept, 40/40/20 from 24 Sept); capital introduced posted; a Rs 1,000 result on 20 Sept and Rs 500 on 24 Sept split exactly **700 / 700 / 100** on Changes in Equity, with correct slice text; the balance sheet balanced and its equity (11,500) tied to the SoCE closing balance.
- **Pre-existing defects seen live (already in this register):** L-20 — the "Received into" picker offers owner-created bank 1040 and 1025, and the server then refuses 1040; L-23 — withdrawal mode offers *capital* accounts as the "drawings account", the helper text says to add accounts under Chart of Accounts (the Owners page now does that), and capital-in mode shows the drawings explainer; L-37 — Changes in Equity defaults to 1 January, not the FY start; L-39 — date inputs default to the UTC date, so between midnight and 05:00 Pakistan time "today" is yesterday.

---

### Release blocker found while building the kernel

`syncChartOfAccounts` now fails the deploy when an owner account sits on a code this release
claims with a different class or type (rather than silently posting into it). But a failed
`db:deploy` makes `update.ps1` keep the previous image running, and `/v1/system/version` then
compares that OLD image's migrations with the database's — the expand-only migrations already
applied cover everything the old image knows, so it reports nothing pending. The box would stop
updating with the settings screen saying all is well: the same trap as the old `0011` duplicates.
Before v0.6.0 ships, `deploy.ts` must record its last outcome (success, or the error text) where
the version endpoint reads it, and the settings screen must show it. Pre-update check C20 is the
first line of defence; this is the second.

## 9. Fix program

See the approved plan: Kernel PR (all schema, registry, engine, ledger read path, shared
utilities) → four parallel streams (R revenue & receivables, C-a existing cost paths, C-b payables &
treasury, E equity/statements/chart) → integrate, remediate, release v0.6.0 → Release 2
contractions (REVERSED enum value, `cash_flow_section`, `other_deductions_pkr`, `is_accrual`,
`control_account_code` NOT NULL).
