# 31 — Module audit against the domain brief

Written 2026-11-16, on `main` at `649dd51` (v0.9.0). It checks every module against `docs/29_domain_brief.md`.

## How to read this

**Seriousness**
- **Critical** — wrong money or lost stock is possible today.
- **High** — a real store cannot work the way the trade works, or an owner is misled.
- **Medium** — works, but a different store needs a code change.
- **Low** — polish.

**How sure**
- **Checked** — I read the code at that place myself.
- **Survey** — found by a code survey and cross-read in its report, not re-read line by line by me. Every Critical and High finding is Checked.

Paths are relative to the repository root. `schema` means `packages/db/prisma/schema.prisma`. `api/` means `apps/api/src/modules/`.

## The ten findings that matter most

1. **A partial change of owner loses rent.** The storage of the transferred bags before the transfer is billed to nobody. (T-1, Critical)
2. **A full change of owner on seasonal rent bills the season twice.** (T-2, Critical)
3. **Peshgi is not tied to the goods.** An unpaid peshgi never holds a withdrawal, and peshgi is missing from the client's statement and from his credit exposure. (P-1, P-2, High)
4. **Everything is counted in "bags" and rent is only per bag.** Crates, bag sizes and rent by weight cannot be set up. (S-1, B-1, High)
5. **No rent agreed with one client, no advance rent at arrival, no rent taken from a sale.** These are the normal ways the trade differs. (B-2, B-3, X-1, High)
6. **Tax is one undated number per store.** It cannot follow the yearly changes, the provinces, or exemption by goods. (TX-1, High)
7. **Settings have no history and no start date.** A change applies at once and silently. (C-1, High)
8. **Printed papers cannot be changed per store.** No address, phone, logo, wording, language choice, numbering or copy count. (D-1, D-2, High)
9. **A new client's old records cannot be loaded.** There is no import of parties, stock in the rooms or unpaid bills. (O-1, High)
10. **The speed figures on file are not real.** The old benchmark mostly measured refusals from the rate limiter. Several reports load a store's whole history into memory. (F-1, F-2, High)

---

## M1 — Parties

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| PA-1 | Medium | The party type (farmer, trader, arhti, buyer) only picks the receivable account. Nothing else behaves differently. | Harmless, but the type list is fixed in code. A store that wants "company" or "exporter" needs a code change. | `schema:42-49`; `packages/shared/src/accounting-accounts.ts:118-125` | Survey |
| PA-2 | High | The arhti link (`parent_arhti_id`) is stored and never used. It sets no billing default and gives no combined statement. | At the owner's store arhtis pay for their farmers' goods. The munshi must pick the billing party by hand on every lot, and the arhti cannot be shown one account for all his farmers. | `api/party/party.service.ts:153-159` | Survey |
| PA-3 | Medium | Credit days (`credit_terms_days`, default 30) drive no rule. There is no due date anywhere. The credit limit only shows a warning. | "Who is overdue" cannot be answered by the client's own terms; aging runs from the bill date for everyone. | `schema:532`; `api/surcharge/surcharge-calc.ts:21-22` | Survey |
| PA-4 | Medium | NTN and active-taxpayer status exist in the database but no screen or API reads or writes them. There is no sales tax registration number for a party. | A tax-registered store cannot print a proper tax invoice for a registered client. | `schema:541-543` | Survey |
| PA-5 | Low | No payment terms on the party (pays at the gate, or runs a khata). The gate rule is the same for all unless a manager grants standing credit one party at a time. | Khata clients are the norm for regular traders. Standing credit covers it, but it is set up as an exception, not as the client's terms. | `api/credit-approval/credit-approval.service.ts:64-82` | Survey |

## M2 — Arrival and lots

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| S-1 | High | Quantity is whole "bags" everywhere: lot, room and rack capacity, withdrawals, transfers. A commodity has a free-text unit label used on one paper only. There is no bag size and no kind of packing. | The owner stores apples in crates. Screens and papers say bags. Room capacity cannot mix bags and crates (a study sizes one bag as about three crates). | `schema:672,761-762,839,1612`; label used only in `apps/api/src/modules/pdf/templates/gate-pass-receipt.html:182` | Checked (schema) |
| S-2 | Medium | Commodities and varieties are shared by the whole database, with a unique name. Revenue accounts are mapped by the names POTATO, APPLE, ONION, KINNOW; anything else goes to one "other" account. | Each client box has its own database, so clients do not see each other's goods. But a store whose main goods are, say, dates and garlic gets all its rent in "other storage revenue". | `schema:637-665`; `packages/shared/src/accounting-accounts.ts:183-193` | Checked (schema) |
| S-3 | High | One arrival is one lot: one owner, one commodity, one variety, one rate plan. A truck with three owners' goods, or one owner's two sizes, is three separate entries with nothing joining them. The gate pass can link to one lot only. | Arrivals are entered at the busiest time of the year. Re-typing the truck, date and room for each lot is slow, and the gate's count for the truck is compared with one lot only. | `schema:1532`; `api/gate-pass/gate-pass.service.ts:133-139` | Survey |
| S-4 | Medium | The receipt number is the lot number (`LOT-YYMMDD-NNNN`). The format is fixed. | Stores have their own parchi book numbering. The format cannot be changed, and a store cannot continue its existing series. | `api/lot/lot-number.ts:8-14` | Checked |
| S-5 | Medium | No season on a lot. Season dates live on the rate plan and are used only for accruals. | "This season's stock", "last season's unpaid rent" and season-end closing cannot be reported directly. | `schema:715-716`; `api/invoice/storage-charge.ts:52-60` | Checked |
| S-6 | Medium | No booking of space and no seed lots (goods the farmer will plant, not sell). | Booking is unconfirmed for Pakistan (open question). Seed potato is confirmed as a large share of storage; it needs nothing special except that no sale is assumed, which holds today. | not present | Checked (schema) |
| S-7 | Low | Required fields at arrival are fixed in code (owner, goods, rate plan, room, bags). Grades are fixed as A, B, C. | A store that wants vehicle number or marka to be compulsory, or has no grades, needs a code change. | `packages/shared/src/schemas/lot.ts:11-31` | Survey |

## M3 — Change of owner

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| T-1 | **Critical** | A partial transfer makes a new lot for the buyer, dated the transfer day, and creates no bill. The seller's later withdrawals bill only the bags he withdraws. So the transferred bags' rent from arrival to the transfer day is never billed to anyone on monthly, daily or custom tariff plans. | Direct loss of rent on every partial sale inside the store. | `api/ownership-transfer/ownership-transfer.service.ts:207-252` (no bill; `inboundDate: effectiveDate` at :242). Compare the full transfer at :127-157, which does bill. | Checked |
| T-2 | **Critical** | On a seasonal plan the charge is bags × rate whatever the dates. A full transfer bills the seller the whole season; the buyer's withdrawal then bills the whole season again. | The store collects double rent on goods sold inside the store, or the munshi must remember to cancel one bill by hand. | `api/invoice/storage-charge.ts:52-60`; `ownership-transfer.service.ts:140-157` | Checked |
| T-3 | High | The bill made at a full transfer is left as a draft. Nothing finalises it or asks for payment. | The seller's rent can sit unposted and uncollected after he has been paid by the buyer and gone. | `ownership-transfer.service.ts:140-157` | Checked |
| T-4 | Medium | Who pays the rent up to the transfer day is fixed: the seller (full transfer) or nobody (partial). The trade may instead leave it for the buyer to pay when he takes the goods. | Open question 9 in the brief. It must be a choice. | same | Checked |
| T-5 | Medium | A transfer resets the billing party to the new owner, dropping an arhti who was paying. The sale price is stored and printed but is not used for anything. | Minor, but the arhti arrangement is lost silently. | `ownership-transfer.service.ts:159-166,231-232` | Checked |

## M4 — Withdrawal and dispatch

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| W-1 | Medium | The person who actually collects is not recorded unless a "receiving party" is chosen, and that party must already exist as a party. A blank receiver passes with no check. | The receipt works almost like a bearer paper. A store needs a record of who took the goods and on whose word. | `api/outbound/outbound.service.ts:136-151` | Checked |
| W-2 | Medium | The dispatch rules are a set of owner switches added one at a time (one-person dispatch, cash tracking, book only trucks inside, Allow). Each is sound, but there is no single place that says "how this store dispatches". | Onboarding a client means knowing which five switches to flip in which order ("turn cash tracking on before solo"). | `packages/shared/src/schemas/facility.ts:70-142` | Survey |
| W-3 | Medium | Loading labour is a service charge that can be pre-added at dispatch, but the seeded charges have it off, and there is no charge at arrival (unloading). | Palledari is charged at both ends in the sources. Unloading cannot be billed at arrival because nothing is billed at arrival. | `api/outbound/dispatch-checkout.service.ts:965-989`; `packages/db/prisma/seed.ts:350-375` | Survey |
| W-4 | Low | Limits fixed in code: 3 wrong counts at the gate, 20 lots per truck. | Reasonable defaults; a store may want others. | `packages/shared/src/schemas/gate-pass.ts:101`; `outbound.ts:114` | Survey |

## M5 — Rent and bills

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| B-1 | High | Four rent types, all per bag. No rent per crate as such (a crate is typed as a "bag"), none by weight. A month is always 30 days on the monthly type and any part month is a full month. | The custom tariff type covers half-month and day rules, but clients found its setup form confusing (v0.7.0). The simple types are too rigid and the flexible one is too hard. | `schema:60-65`; `api/invoice/storage-charge.ts:42-108` (30 days at :63) | Checked |
| B-2 | High | A rate plan has no client. A lot has exactly one plan, fixed for life. A rate agreed with one client means making a separate plan and picking it by hand on each of his lots. | Regular clients having their own rate is likely normal (open question 3). The munshi will pick the wrong plan. | `schema:708-730,760`; `api/lot/lot.service.ts:262-275` | Checked (schema) |
| B-3 | High | A bill is made only when goods leave (and at a full transfer, and for late-payment surcharge). Nothing can be billed at arrival, monthly, or at season end. | Advance rent at arrival is reported as common. Khata clients are settled by period, not by truck. Goods that never leave are never billed (see X-2). | three call sites: `api/outbound/outbound.service.ts:324`; `ownership-transfer.service.ts:140`; `api/surcharge/surcharge.service.ts:137` | Survey, call sites Checked |
| B-4 | Medium | On a seasonal plan, goods taken out after the season end pay the same flat fee. There is no charge for overstaying. | Stores that close a season need an overstay rule. | `storage-charge.ts:52-60` | Checked |
| B-5 | Medium | Rounding differs by rent type: the custom tariff rounds per bag then multiplies; the others round the total. | Two stores with the "same" rate can get totals a few rupees apart. It must be one stated rule. | `packages/shared/src/tariff.ts:185-188` | Survey |
| B-6 | Low | The bill line type `ADVANCE_APPLIED` exists but cannot be used and would fail if it were. Per-ton charges compute tonnes to 3 decimals but the column keeps 2. | Dead code and a small rounding risk on per-ton charges. | `api/invoice/revenue-account.ts:39`; `dispatch-checkout.service.ts:61`; `schema:952` | Survey |
| B-7 | Medium | Late-payment surcharge ages from the bill date in 30-day blocks; it has no due date and loads every finalised bill, paid ones included, to suggest surcharges. | Slow on a big store, and unfair to a client with longer agreed terms. | `api/surcharge/surcharge-calc.ts:37-55`; `surcharge.service.ts:68-78` | Survey |

## Tax

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| TX-1 | High | Sales tax is one rate per store with no start date (default 18%), applied to the whole bill when the store is marked registered. No province, no regime (reduced rate without input adjustment versus standard), no rule by goods. | Punjab's cold storage rate is reported to have moved from 5% to 8% on 1 July 2026. Sindh exempts storage of fresh fruit and vegetables. None of this can be set. The default of 18% matches no provincial rate on this service. A store that turns tax on today gets a wrong rate unless it knows to change it. | `api/invoice/invoice.builder.ts:78`; `packages/shared/src/schemas/facility.ts:73-77,112,120` | Checked |
| TX-2 | Medium | Bills are tax-exclusive only. | A store that quotes rent including tax cannot bill that way. | `api/invoice/invoice-totals.ts:49-50` | Survey |
| TX-3 | Medium | Income tax a client withholds from his payment is typed as an amount and parked in an account that nothing reads or clears. | For stores with company clients the balance grows forever and the year-end claim has no report. | `api/accounting/templates/je-02-payment-received.ts:61` | Survey |
| TX-4 | Medium | Writing off a bad debt writes off the tax part too, with no adjustment to the tax owed. | Matters only for tax-registered stores; needs the adviser's rule. | `api/accounting/bad-debt.service.ts:19-61` | Survey |
| TX-5 | Low | The rough book (KATCHI) never carries tax. This is a deliberate, documented decision and is right. | Keep. | `invoice.builder.ts:76-78` | Checked |

## M7 — Payments, client accounts and the books

The accounting core is the strongest part of the product. One posting path, one reversal path, one ledger reader, account codes in one registry, database triggers that stop edits to posted entries. Keep it. The findings are at its edges.

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| A-1 | High | Party statements and aging read only the four receivable accounts. Peshgi sits in another account, so a client's statement and "who owes what" leave out his peshgi. | The owner's real question is "what does this man owe me in all". The answer on screen is too low. | `api/invoice/receivables.ts:17-37` reads `AR_CONTROL_ACCOUNTS` (`accounting-accounts.ts:134`) | Checked |
| A-2 | Medium | A receipt is never allocated by the server. The "oldest first" button runs in the browser. | Fine for a careful accountant; for a munshi on a khata client, "apply to oldest" should be the default the server offers. | `apps/web/src/app/(app)/payments/payment-form.tsx:144` | Survey |
| A-3 | Medium | A credit note cannot exceed what is still owed, so money already paid cannot be refunded or credited. | An over-charged client who has paid cannot be put right through the system. | `api/accounting/credit-note.service.ts:113-125` | Survey |
| A-4 | Low | Cheque clearing always posts to one bank account. Two different entries share the code JE-28. The accounting spec still says accrual is not built. | Tidy-ups. | `api/accounting/templates/je-24-cheque-cleared.ts:40`; `docs/09_accounting_spec.md:626-635` | Survey |
| A-5 | Medium | Spoilage and damage accounts exist in the chart but no entry uses them. | See Q-1. | `packages/db/src/chart-of-accounts.ts:130,184,216` | Survey |

## M11 — Peshgi

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| P-1 | High | A peshgi has no link to the goods that secure it. An unpaid peshgi never stops or warns on a withdrawal or at the gate. | At the owner's store peshgi is given against stock. Today a client can take out all his goods and leave the peshgi unpaid, and nothing on the desk or at the gate says so. | `schema:1460-1491` (no lot link); gate payment check `api/gate-pass/gate-pass.service.ts:422-474` reads bills only | Checked (schema), Survey (gate) |
| P-2 | High | Peshgi is left out of credit exposure. | Standing credit and the credit warning under-count what the client owes. | `api/invoice/receivables.ts:32-37` | Checked |
| P-3 | Medium | No limit per bag or per client, no due date, no markup or fee, issue by the owner only. | Each is an open question in the brief; they must be choices. "Owner only" is right as a default. | `api/peshgi/peshgi.service.ts:24-77` | Survey |
| P-4 | Low | Recovery through a receipt is labelled "deducted from produce" although no sale of produce exists in the system. | Misleading label. | `api/payment/payment.service.ts:568-604` | Survey |

## Things the trade does that the software does not have

| ID | Seriousness | Finding | Why it matters | Sure |
|---|---|---|---|---|
| X-1 | High | **Selling a client's goods for him.** No sale record, buyer, price, commission, deductions, or amount due to the client. | The owner's store does this. Today it must be faked as a withdrawal plus manual entries, and the client gets no sale statement. How the money is settled is still an open question, so the design waits on the questionnaire. | Checked (schema search) |
| X-2 | High | **Unclaimed goods.** No way to mark a lot abandoned, sell or dispose of it, and bill or write off its rent. A lot that never leaves is never billed. | Happened across Punjab in 2025–26. The rent on such lots is invisible until someone withdraws. | Survey |
| X-3 | Medium | **Bardana and other small sales.** | Unconfirmed for Pakistan. Wait for the questionnaire. | Checked (schema search) |
| X-4 | — | **The store's own trading stock.** Owner decision: leave it out. | Recorded so it is not re-opened. | Owner |

## M6 — Quality and spoilage

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| Q-1 | High | The module was never built. A lot's count changes only by dispatch and transfer. A rotten or short bag cannot be recorded, so the book count and the room count drift apart with no honest way to correct them. | Every store has shortage and rot. Today the only fix is a fake withdrawal, which makes a bill. | `schema:73-77` (`SUSPENDED` never set); e2e `wf-05` is a placeholder | Survey |

## M8 — Rooms and racks

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| R-1 | Medium | Capacity is in bags (see S-1). The screen word "Room" is fixed. | A store may say chamber, kamra or hall. | `schema:672` | Checked |
| R-2 | Low | Temperature is logged but nothing warns when it is out of range. | A real risk to goods; cheap to add. | `api/chamber/chamber.service.ts:277` | Survey |

## M10 — Gate

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| G-1 | Medium | The inward gate pass is not joined to the arrival screen. Linking exists in the API but no screen calls it. | The guard's declared count and the munshi's lot count are never compared in normal use. | `api/gate-pass/gate-pass.service.ts:133-139` | Survey |
| G-2 | Low | The outward checks (blind count, paid or credit, three tries) are thorough and tested. Keep. A local feature branch that makes the receipt and dispatch note the gate passes themselves (`feat/gate-pass-documents`) was never merged. | Decide in the redesign whether to bring it in. | memory note | — |

## Settings, roles and wording

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| C-1 | High | All settings are one JSON field on the store. No version, no start date. A change takes effect at once. The only record is the database's row-change log. Saving one nested value replaces its whole group. | The brief requires dated, versioned settings. Today an owner cannot say "new rate from 1 July". Past papers are safe only because bills and payslips happen to copy the numbers they used. | `schema:360`; `api/facility/facility.service.ts:27-46` | Checked (schema), Survey |
| C-2 | Medium | Some settings have no screen (fiscal year start, payroll figures). One is saved and never read (`storage_alert_thresholds`). | Confusing and partly dead. | `packages/shared/src/schemas/facility.ts`; survey table | Survey |
| C-3 | Medium | Roles are a fixed list of six with a fixed ranking. Permissions per role can be changed per store (good), but a store cannot add a role, and several rules bypass the matrix by rank (rough book, backdating, gate manager powers). | A store with one munshi who does everything, or with a separate cashier, cannot be modelled cleanly. | `packages/shared/src/permissions.ts:21-31,42-123` | Survey |
| C-4 | High | No translation layer. Every screen word is English text in the code. Urdu exists only in a party's Urdu name and in fixed headings on printed papers. | Munshis read Urdu. The brief requires Urdu or English screens and store-chosen words. | 95 pages under `apps/web/src/app`; no i18n library | Checked (search) |
| C-5 | Medium | A new store starts with a facility, users and a chart of accounts, and nothing else: no goods, rooms, rates or charges. Setup is by hand. | Onboarding takes days, not hours. There are no templates. | `packages/db/prisma/provision.ts:10-12,124-135` | Survey |
| C-6 | Low | Currency, time zone and the 30-day month are fixed. One store per installation, with a fixed store ID in the login page. | Right for Pakistan today. The fixed ID only matters if two stores ever share one installation. | `packages/shared/src/fiscal.ts:18,45`; `apps/web/src/app/(auth)/login/page.tsx:25` | Survey |

## Papers and printouts

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| D-1 | High | Twelve fixed layouts. A store can change only its name, city and number style. No address, phone, tax number, logo, footer, choice of fields, language or copy count. | Every owner wants his own parchi. Today that is a code change per client. | `api/pdf/templates/*.html`; `api/pdf/pdf.service.ts` | Survey |
| D-2 | High | Every document number format is fixed in code. A store cannot continue its paper series or choose a prefix. | Stores keep numbered books; the first thing a client asks is "can it start from my number". | `apps/api/src/common/document-number.ts:33-44`; `api/lot/lot-number.ts` | Checked |
| D-3 | Medium | Each PDF starts a fresh browser engine, renders, and closes it. A slip has taken 6.5 seconds. | The munshi waits at the counter for every paper. | `api/pdf/pdf.service.ts:155-173`; `TESTING.md:110` | Survey |

## Reports and speed

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| F-1 | High | The speed figures on file are not real. The benchmark fires about 900 requests a second at an API that allows 100 a minute per client, and it does not check for refusals. Its "p95" is the 97.5th percentile. | The project has no true record of how fast any screen is. | `scripts/perf-baseline.ts:78-102`; `apps/api/src/app.ts:70-75`; `phases/phase-11-baseline.json` (about 900 requests/s) | Checked |
| F-2 | High | Reports that load a store's whole history into memory: receivables aging, the party statement (then filters by date in memory), the dashboard (all active lots plus the full aging), the general ledger (no paging), the cash-flow statement, surcharge suggestions. | Fast on a test database, slow after two seasons. The party statement is opened all day. | `api/invoice/receivables.ts:67-79,157-229`; `api/reporting/reports/dashboard.ts:63-73,139`; `api/accounting/gl.service.ts:46-63`; `api/accounting/cash-flow.service.ts:95-105` | Survey |
| F-3 | Medium | The truck preview on the dispatch desk prices each line one after another, about five queries per line. Plate matching uses a text function that no index supports. The desk list filters on dates that have no index. Ledger lines have no combined index on party and account. | The desk is the busiest screen. | `api/outbound/dispatch-checkout.service.ts:110,438-485`; `api/gate-pass/open-load.ts:60-72`; `schema:1144-1147` | Survey |
| F-4 | Medium | Reports an owner would expect and that are missing: stock by client across rooms on a date, a season summary of rent billed, collected and owing, peshgi outstanding beside stock held, daily cash book by collector. The seasonal summary counts tax as revenue. | Question 28 of the questionnaire will confirm which matter. | `api/reporting/reports/seasonal-summary.ts:61` | Survey |
| F-5 | — | **Measured times.** See "Measurements" below. | | | |

## Bringing a client's old records in

| ID | Seriousness | Finding | Why it matters | Where | Sure |
|---|---|---|---|---|---|
| O-1 | High | No import of any kind. Parties are typed one by one. Stock already in the rooms is entered as back-dated lots, one by one. Unpaid bills become one opening figure per client with no detail, all aged from the opening date. | A store that starts mid-season has thousands of bags and hundreds of khatas. This is the "weeks" in onboarding. | `api/accounting/opening-balance.service.ts:110-227`; no CSV code in the API | Survey |

## Tests and tooling

| ID | Seriousness | Finding | Where | Sure |
|---|---|---|---|---|
| Z-1 | Medium | All tests run against one store with one setup. Different setups are tested by changing that store's settings inside single tests. Nothing runs a whole season under a different kind of store. | `apps/api/src/test/setup.ts` | Survey |
| Z-2 | Low | `scripts/final-verify.ps1`, named in `TESTING.md` and `PROGRESS.md` as the full check, is not in the repository. | `TESTING.md:87-89` | Survey |
| Z-3 | Low | The season walkthrough test has one farmer, one potato lot and three withdrawals. No peshgi, change of owner, labour charge or season end. | `apps/web/e2e/season-aslam.spec.ts` | Survey |

## What is right and should be kept

- The accounting core: one posting path, reversal instead of edit, database-level protection of posted entries, one ledger reader, the account registry.
- Bags held from booking to dispatch, and the fixed lock order.
- The gate: blind count enforced in the API, payment or credit before release, three tries.
- The rough and official books (KATCHI and PACCI) with owner-only access to the rough book.
- The custom tariff calculator as an engine (one function used by the bill, the accrual and the preview). Its setup form is the problem, not its arithmetic.
- Per-store changes to role permissions.
- Bills and payslips storing the rate and tax they were made with.
- The update pipeline: expand-only migrations, one deploy script, track `:stable` only.

## Where the older documents are wrong

- `docs/01` §8.2: "all billing, settlement and valuation is weight-based". Wrong for most stores; rent is per bag or crate.
- `docs/01` §5: "mandatory digital weigh-in/out". Reversed by the owner on 2026-10-29.
- `docs/01` §2.2: commission "officially 2–4%". No source; the sources found give 1.5–2.5% and "sometimes more than 10%".
- `docs/09` still says revenue accrual is not implemented. It is.
- `phases/phase-12-configurability.md` records a decision not to build custom roles or configurable numbering. The brief reverses that decision.
- `TESTING.md` lists seven e2e workflows; there are fifteen specs, and the quality workflow is a placeholder.

## Measurements

To be filled by the timing run (generated season-sized data on a local database). See `docs/32_redesign_plan.md` for the method.
