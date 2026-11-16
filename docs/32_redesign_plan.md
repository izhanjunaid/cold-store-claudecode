# 32 — Redesign plan and progress

Written 2026-11-16. This is both the plan and the progress file. A later session continues from the "Progress" table at the end.

Read with `docs/29_domain_brief.md` (how the trade works), `docs/30_questionnaire.md` (what is still to be confirmed) and `docs/31_module_audit.md` (what is wrong; finding IDs such as T-1 refer to it).

**Status: waiting for the owner's approval. Nothing in this plan has been built.**

## 1. The aim

Three things, in this order.

1. **Correct.** Fix the places where the software loses or doubles money, or fails.
2. **Mouldable.** Every rule that differs between stores becomes a dated setting. A new store starts from a template.
3. **Proven.** Three different stores, set up by settings alone, each run through a whole season by automated tests. Old data moves across with nothing lost. Speeds measured before and after.

## 2. Design decisions

Each decision is stated once here and used by every stage.

### 2.1 Keep the core
The accounting core, the stock-holding rules, the gate, and the update pipeline are right (audit, "What is right"). They are not rewritten. The redesign changes what feeds them.

### 2.2 One dated settings store
- A new table holds setting **versions**: store, setting name, value, the date it takes effect, who saved it, when, and a note.
- Code reads a setting **for a date**: the business date for a live rule, the document's date for a bill or receipt.
- Saving a setting never changes an old version. It adds a new one. "From 1 July the rate is X" is one new version dated 1 July.
- Every save also goes to the audit log, as today.
- The Settings screen shows, for each setting, what is in force, what is coming, and its history.
- Secrets and internal state (mail password, notification state) stay where they are. They are not business rules.

### 2.3 Papers keep what they used
A bill, receipt, slip or journal entry stores the rate, tax, wording choices and numbers it was made with. This is already true for bills and payslips. It becomes the rule for every paper. A settings change cannot alter a past paper or a posted entry, because nothing re-reads settings for the past.

### 2.4 Units belong to the goods
- Each kind of goods gets a unit name in English and Urdu (bag, crate, carton), an optional weight per unit, and a space factor (how much room one unit takes, so a room can hold a mix).
- Screens and papers show the unit of the goods, never the fixed word "bags".
- The database columns named `…_bags` keep their names and now mean "units". Renaming about sixty columns on a live product adds risk and changes nothing a user sees.
- The goods list and its revenue accounts are chosen per store. The fixed link from the names POTATO, APPLE, ONION, KINNOW to accounts is removed for new goods.

### 2.5 One rent engine, simple setup
- The existing tariff calculator becomes the only rent calculator. The three older rent types are expressed as tariff rules inside it. Existing plans keep producing exactly the same amounts; a test proves it bill by bill on the generated season.
- Setup is one question, "How do you charge?", answered by picking a card: per season; per month; half month then months; per day. Each card asks only for prices and shows example bills at once. The full rule builder stays behind "Custom rule". This is the redesign the client asked for after v0.7.0.
- A client can have his own rate: a rate plan chosen for that client (and goods). The arrival screen picks it without the munshi choosing.
- A new rate from a date is a new version of the plan. A lot keeps the version it arrived under.
- One rounding rule for every rent type.

### 2.6 Rent is tracked per lot, so it is billed once
This is the one change at the root of billing, and it is what fixes the two Critical rent errors properly.

- Each lot records **how far its rent has been billed** (a date), and whether a season fee has been billed.
- Every bill for rent moves that date forward. The next bill starts from it.
- At a change of owner, the store's setting decides: **the seller is billed up to that day**, or **the buyer takes the lot with its unbilled rent**. Either way the new lot carries the right starting point, so nothing is lost and nothing is billed twice.
- This also makes new billing moments possible without double counting: a bill at season end, a monthly bill for khata clients, and a close-out bill for goods nobody collects.

### 2.7 When money is asked for is a client term
- Each client has payment terms: **pays before goods leave**, or **khata** (with a limit and a settling period). Khata uses the existing standing-credit check; it is no longer an exception a manager grants by hand.
- **Advance at arrival** is a receipt tied to the lot, suggested as a percentage the store sets, and applied automatically to that lot's bills. It is not a bill.
- **Arhti pays**: a store setting makes a farmer's lots bill to his arhti by default, and the arhti gets one statement for all his farmers.
- **Peshgi** can name the lots that secure it. It is counted in what the client owes and shown on his statement. A setting decides what happens when secured goods leave unpaid: allow, warn, or need a manager. An optional limit per unit.

### 2.8 Tax as dated rules
- A store has zero or more tax rules. Each has: a name, the authority (for example PRA), a rate, a start date, whether it applies to all goods or named goods, which charges it applies to, and whether prices include it.
- No rules means no tax. This is the normal case.
- A bill line stores the rule and rate it used.
- The fixed default of 18% is removed. A store that has tax turned on today keeps its present rate as its first rule, so nothing changes for it.
- Templates carry the provincial rates found in the research, each marked "confirm with your tax adviser before use".

### 2.9 Papers, numbers, words, language
- **Store header** on every paper: name, address, phone, logo, tax numbers.
- **Per paper**: which optional fields print, how many copies and what each copy is called, language (English, Urdu, both), footer text. These are choices from fixed blocks. There is no template language.
- **Numbers**: each paper has a pattern (prefix, date part, width) and a next number, so a store can continue its own series.
- **Words**: screens read their words from a word list in English and Urdu. A store can override a word ("Room" to "Chamber").
- The PDF engine is kept running between prints instead of starting for each one.

### 2.10 Fields, approvals, roles
- **Fields**: for a fixed list of optional fields on the arrival, withdrawal and party forms, a store sets each to hidden, optional or required. Weight is one of them; its default stays optional.
- **Approvals**: the dispatch switches are gathered on one "How this store dispatches" page with plain choices.
- **Roles**: the rules that are fixed by rank today (rough book access, backdating, gate overrides) become permissions in the existing matrix. Their defaults stay as they are.

### 2.11 One extension point
For the rare rule that settings cannot express, a rent or charge calculation can be a **named calculator** in the one codebase, chosen by a setting, with its own tests. No client-specific copies and no "if this client" branches.

### 2.12 Templates and import
- A **template** is a data file: settings, goods and units, rooms, rent cards, charges, paper choices, roles. Setting up a new store applies one, then the owner adjusts.
- **Import** from spreadsheet files: clients, stock already in the rooms, unpaid bills or khata balances with their dates, peshgi outstanding.

### 2.13 What will not be built
- The store's own trading stock (owner decision).
- More than one store in one installation, other currencies, other time zones.
- Rent by weight, booking of space, bardana sales, markup on peshgi, selling for a client: each waits for the questionnaire. If confirmed, it joins the stage named in section 3.
- Creating new named roles. The permission matrix already lets a store reshape the six roles.

## 3. Stages

Each stage is one or more pull requests, leaves every test passing and `pnpm build` green, and ships expand-only. After each stage the app works. Work can stop between any two stages.

For every stage: **what a client will notice** is listed, because existing clients must not be surprised.

### Stage 0 — Stop the losses (fixes only, no redesign)
Fixes: F-0 (dashboard and aging fail on a big store), T-1 and T-2 (rent on change of owner, as a contained fix ahead of 2.6), A-1 and P-2 (peshgi shown on the statement and counted in what a client owes), F-1 (replace the false benchmark with the timing script), lot search speed, paging for the general ledger.

Tests: a failing test first for each. The aging test runs on more than 33,000 bills.

Clients will notice:
- A partial change of owner now makes a bill to the seller for the rent up to that day.
- A full change of owner on seasonal rent no longer charges the season to both seller and buyer.
- A client's statement and "amount owed" now include his peshgi. A truck of a client with unpaid peshgi may need a manager at the gate where it did not before.
- The dashboard keeps working as the store grows.

**Stage 0 as built (2026-11-16, branch `redesign/stage-0-stop-losses`).** The owner said "go ahead" without answering section 5, so the recommended defaults were used: the seller is billed at a change of owner.

| Fix | What was done | Test |
|---|---|---|
| F-0 dashboard and aging fail on a big store | The aging read is one database statement that returns only what is still open. | `receivables-scale.integration.test.ts` (33,000 bills) |
| T-1 partial change of owner loses rent | The seller gets a draft bill for the rent on the bags sold, from the start of his billing period to the transfer date. | `ownership-transfer.integration.test.ts` |
| T-2 season rent charged twice | New lot field `season_fee_billed` (migration 0047). It is set when the seller is billed a season fee at a transfer. A withdrawal and the monthly revenue accrual charge no season rent on such a lot. The migration marks lots already transferred in full on a seasonal plan. | same file, full and partial |
| A-1, P-2 peshgi left out | A client's credit exposure adds his unpaid peshgi. The statement keeps its rows and closing balance (they still tie to the ledger) and adds "Peshgi unpaid" and "Total owed". | `receivables-read-model.integration.test.ts` |
| Lot search speed | Text-search indexes (migration 0048) and owners resolved to ids first. | existing lot search tests |
| F-1 false benchmark | `scripts/perf-baseline.ts` removed. `pnpm perf:time` runs `scripts/perf-time.mjs`. | |

Measured on the same generated season (median, this 8 GB machine): lot search 315 ms → 37 ms; dashboard: server error → about 2 s; receivables aging: server error → about 3 s. The database statement behind both takes 1.3 s; the rest is the report code around it.

Checked on 2026-11-16: API integration tests (1,031 passed, 4 skipped, run in four parts because the machine ran short of memory on a single run), API unit tests 306, web tests 524, `pnpm build` green.

Left for later, with the reason:
- **Paging the general ledger.** The screen exports its rows to a spreadsheet file, so paging needs the export reworked too. One month of the farmers' account is 1.5 s; a full year is 8 s and 16 MB. Moved to Stage 10's speed work.
- **The dashboard at about 2 s and aging at about 3 s.** They still add up the whole season to find what is open. Stage 3 (rent tracked per lot, bills that know what is still open) removes the cause.
- **Monthly rent at a change of owner.** Seller and buyer are each billed their own period rounded up to whole months, so a lot sold mid-month pays one month more in total than a lot that was not sold. This is how a full transfer already worked. Stage 3 settles it with the "billed up to" date.
- **T-3** (the seller's bill stays a draft until someone finalises it) is unchanged. It now applies to partial transfers too. The dashboard lists these drafts.
- If a seller's draft season bill is later deleted, the lot stays marked as season-billed. Stage 3 replaces the mark with the bill itself.

### Stage 1 — Dated settings (2.2, 2.3)
Build the settings store and the dated read. Move each existing business setting into it as a first version dated before any data. The Settings screen gains "from date" and history.

Migration: copy, do not move. The old field stays filled for one release so a rollback still works.

Tests: a setting changed from a future date does not affect a bill dated before it; history is kept; audit log written.

Clients will notice: a "takes effect from" date and a history on the Settings screen. No rule changes.

### Stage 2 — Goods and units (2.4)
Unit name, weight per unit and space factor on goods; the goods list and revenue accounts per store; every screen and paper shows the goods' unit; room capacity counts mixed goods.

Migration: every existing kind of goods gets unit "Bag" or its present label and factor 1, so capacity and counts read exactly as before.

Clients will notice: "Crates" where goods are in crates. Nothing else.

### Stage 3 — Rent (2.5, 2.6)
One engine; the "How do you charge?" cards; a client's own rate; dated plan versions; rent tracked per lot; the change-of-owner choice; bills at season end and by period.

Migration: each lot's "rent billed up to" date is worked out from its existing bills. A check compares, for every lot in the generated season, the rent already billed with what the new engine says was billable; they must agree.

Tests: the same season billed by old and new code gives the same total per client. Partial withdrawals, transfers and period bills never bill a unit-day twice or miss one (checked by adding up unit-days).

Clients will notice: a new rent setup screen. Existing plans work unchanged. New options appear but are off.

### Stage 4 — Client terms, arhti, peshgi (2.7)
Payment terms on the client; advance at arrival; arhti default and combined statement; peshgi tied to lots, with the leave rule and the limit.

Migration: every existing client becomes "pays before goods leave"; a live standing approval becomes khata terms with the same limit. Peshgi leave rule starts at "warn".

Clients will notice: a warning on the desk when goods secured by unpaid peshgi are withdrawn.

### Stage 5 — Tax (2.8)
Dated tax rules; per-line tax; client tax numbers on screens and on the bill; price-including-tax option.

Migration: a store with tax on gets one rule at its present rate from the beginning. A store with tax off gets none.

Clients will notice: nothing, unless they open the new tax settings.

### Stage 6 — Papers, numbers, words, language (2.9)
Store header; per-paper choices; number patterns; the word list in English and Urdu with store overrides; the PDF engine kept running.

Order inside the stage: papers and numbers first; then Urdu and word overrides on the munshi's screens (arrival, withdrawal, dispatch desk, gate, client page); then the remaining screens.

Migration: number patterns are set to today's formats and continue from the last number used.

Clients will notice: their address and phone on papers once entered. Faster printing. A language choice.

### Stage 7 — Fields, approvals, roles (2.10)
Field rules; the single dispatch page; rank rules become permissions.

Clients will notice: nothing by default.

### Stage 8 — What the trade does and the software lacks
- Shortage and rot: correct a lot's count with a reason, with or without a claim against the store (Q-1).
- Goods nobody collects: mark, close out, bill or write off the rent (X-2).
- Who collected: name and note on every withdrawal (W-1).
- One truck, several lots: one arrival entry with shared truck details and one gate count (S-3, G-1).
- Selling for a client (X-1): built only after the questionnaire answers how it is settled.

Clients will notice: new actions on the lot page and a faster arrival screen for mixed trucks.

### Stage 9 — Templates and import (2.12)
Three templates and the importers.

The three stores, taken from the research:
1. **Potato season store** (Okara/Sahiwal style). Potatoes in bags. One rent per bag for the season with an overstay rule. Farmers pay before goods leave. Peshgi against stock. Seed lots. Urdu papers. No tax. One munshi does the desk.
2. **Lahore fruit and mixed store** (the owner's kind). Apples in crates on half-month-then-months rent; potatoes in bags per month. Arhtis pay for their farmers; regular traders on khata, others pay at the gate. No weights. No tax. Separate desk, manager and gate.
3. **Tax-registered store in Sindh**. Cartons and bags of mixed goods, some processed. Rent per month with weights recorded. Company clients on khata with tax invoices: fresh produce exempt, other goods taxed at the provincial rate. English papers with the store's tax number. Continues its own invoice series.

### Stage 10 — Proof
- **Season tests**: for each template, an automated test sets the store up from the template alone and runs a full season through the API: arrivals, a change of owner, a shortage, withdrawals, bills, receipts, peshgi and its recovery, a settings change mid-season, statements, reports, and the data for every paper. Each ends by checking that debits equal credits, that client balances equal the ledger, and that stock on the books equals arrivals less withdrawals and corrections.
- **Migration proof**: the generated season database, as v0.9.0 leaves it, is updated through every stage. Stock per lot, balance per client and the trial balance are compared before and after and must be identical, apart from the corrections listed under Stage 0.
- **Speed**: `scripts/perf-time.mjs` is run again and set beside the figures in the audit.

## 4. Moving existing clients safely

- Client boxes run v0.6.2. Versions 0.7.0 to 0.9.0 are tagged and not promoted.
- Every stage is expand-only and goes through `deploy.ts`. New columns are optional or have defaults. Nothing is dropped until a later release.
- Every stage's migration sets the new settings to values that reproduce what the store does today. A client sees a change only where this plan lists one.
- Before any promote: take a backup, run the update on a copy first, and compare the three totals (stock, client balances, trial balance).
- No migration or script is run on a real client database without the owner's word. Promoting and merging to `main` stay the owner's decisions.
- The migration is tested on generated data only (owner decision). This is weaker than a real copy: generated data has no odd cases such as a client's hand-made corrections. The first real update should therefore be run on a restored backup before the live box.

## 5. Decisions needed from the owner

1. **Change of owner, default rule.** Seller is billed up to that day, or buyer takes over the unbilled rent? (Recommended default: seller is billed; the store can change it.)
2. **Unpaid peshgi when goods leave, default rule.** Allow, warn, or need a manager? (Recommended: warn.)
3. **Stage 0 as its own release.** Ship the fixes as v0.9.1 ahead of the redesign, so they can be promoted with the rest of v0.9.0? (Recommended: yes.)
4. **Urdu.** Munshi's screens first, the accountant's screens later? (Recommended: yes.)
5. **The third template.** Is a tax-registered Sindh store the right third example, or is there a kind of client you expect sooner?
6. **The questionnaire.** Which stores can it go to, and by when? Stage 8's "selling for a client" and several defaults wait on it.

## 6. Progress

| Stage | State | Branch / PR | Notes |
|---|---|---|---|
| Research: domain brief, glossary, questionnaire | Done 2026-11-16 | `redesign/domain-and-audit` | `docs/29`, `docs/30` |
| Audit | Done 2026-11-16 | same | `docs/31`; timings on generated data |
| Redesign plan | Approved 2026-11-16 ("go ahead"); section 5 not answered, recommended defaults in use | same | this file |
| 0 Stop the losses | Built 2026-11-16, **not merged** | `redesign/stage-0-stop-losses` | see "Stage 0 as built"; general-ledger paging moved to Stage 10 |
| 1 Dated settings | Not started | | |
| 2 Goods and units | Not started | | |
| 3 Rent | Not started | | |
| 4 Client terms, arhti, peshgi | Not started | | |
| 5 Tax | Not started | | |
| 6 Papers, numbers, words, language | Not started | | |
| 7 Fields, approvals, roles | Not started | | |
| 8 Missing trade features | Not started | | waits partly on the questionnaire |
| 9 Templates and import | Not started | | |
| 10 Proof | Not started | | |

**To continue in a later session:** read this file's sections 2 and 3, then the first stage whose state is not "Done". Local tools: `scripts/perf-seed.sql` fills a throwaway database (`coldchain_perf`) with a season; `scripts/perf-time.mjs` times the screens.
