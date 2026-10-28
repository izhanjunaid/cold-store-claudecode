# 26 — Fast dispatch (v0.8.0)

Release notes and reference for the fast-dispatch redesign: the owner asked for a dispatch that takes
far fewer clicks without weakening the books. Built 2026-10-12 → 10-21 as stacked branches (Phase 0,
A, B, the guard's blind count, C1, and a release round), merged to `main` as one squash commit and
tagged **v0.8.0**. A one-lot truck went from about 18 clicks, 6 screens and 3–4 logins to **6 clicks
on one screen** at the desk, plus one Release and a blind count at the gate.

## Owner decisions (delegated to Claude, 2026-10-12, and confirmed since)

| | Decision |
|---|---|
| D1 | The munshi may finish a **clean** truck alone (cash in full, or credit a manager pre-approved), only once the owner switches it on. Anything that changes the money waits for a manager. |
| D2 | The invoice is always **finalized** at checkout (a draft posts nothing, so a credit truck with a draft bill would vanish from receivables). |
| D3 | One truck may carry several lots; the gate checks every withdrawal on the plate. |
| D4 | Outbound weight stays mandatory (the blind inline weigh-out with a tolerance band is still to build, see the end). |
| 2026-10-21 | The gate guard sees **no weights and no money owed**, only that a payment is pending. |
| 2026-10-21 | Tag v0.8.0 but **do not promote** to `:stable` until the owner says so. |

## What changed, by phase

**Phase 0 — integrity first** (migration `0038`). Withdrawals hold their bags from booking
(`openReservation`); finalize locks the withdrawal, then the lot, and re-reads under the lock;
`lots.current_balance_bags >= 0` is a DB CHECK; a withdrawal can be cancelled with a reason. The gate
matches plates however they were typed (`normalizePlate`), lets one withdrawal leave on one truck only,
counts uncleared cheques as owed, refuses a DRAFT bill, lets a voided bill leave only on a manager's
recorded credit, requires the guard's bag count, and stops anyone releasing a truck they booked or
dispatched (managers exempt). Audit triggers on lots, withdrawals, gate passes and parties. New key
`parties.credit_terms` (only a manager changes a credit limit). Server "today" became `businessDate()`.

**Phase A — withdraw from where the lot is.** A withdrawal drawer opens from the lots list, the
party's Active Lots tab and Ctrl+K.

**Phase B — the Dispatch Desk** (migration `0039`). `/dispatch`: find a lot, tap a truck that is
inside, book, weigh, then **Dispatch & Collect** — one transaction that dispatches, finalizes the bill
(JE-01) and records the receipt (JE-02), or does nothing; the total posted must equal the total
reviewed. Service charges marked `apply_at_dispatch` are pre-added (leaving one off is deliberate and a
manager's call). Optional rack picks. The gate gets **Ready to leave**: a release state per truck
(READY, PAYMENT_PENDING, BILL_DRAFT, NOT_DISPATCHED, NO_BOOKING) and a one-tap Release with the blind count.

**The guard counts blind.** A global `preSerialization` hook nulls every stock quantity sent to
SECURITY (`BLIND_KEYS` in `apps/api/src/common/blind-count.ts`); invoices and the placement slip
answer `403 BLIND_ROLE_FORBIDDEN`; the gate receipt the guard prints carries no quantity. Since v0.8.0
the hook also nulls **weights** (accepted, declared, outbound, prorated, variance, and the weight-dispute
note, which quotes the kilograms) and the **money owed at the gate** (`outstanding_pkr`,
`credit_authorized_amount_pkr`); a guard refused for payment reads only "Payment pending", and the gate
page tells them to escalate. Everyone else keeps every figure.

**Phase C1 — standing credit, cash handover, solo dispatch** (migrations `0040`–`0042`).
- *Standing credit:* a manager (`parties.credit_terms`) pre-approves a party up to a ceiling on its
  total exposure (both books, plus every cheque of the party's not yet cleared), optionally until a date. A truck whose every
  unpaid bill is covered is READY at the gate and the guard releases it alone; the pass records the
  approval and names the approving manager. One helper, `standingCreditCover()`, decides for the gate
  preview, the release and the solo checkout.
- *Cash handover:* with cash tracking on, each collector's cash receipts are "cash waiting"; a manager
  (`cash_handovers.confirm`, new) counts it on the desk. A difference needs a reason and posts JE-28 to
  **6105 Cash Short & Over**. Nobody counts, or voids the count of, their own cash; the owner's cash is
  not tracked. The desk's cash card also shows each collector's bank and wallet takings.
- *Solo dispatch:* with the owner's switch on, a munshi (`outbound.record` only) may finish a PACCI truck
  dated today, on cash in full or approved credit, with every charge kept and none priced by weight
  (the munshi types the weight; the blind weigh-out with a tolerance band is C3); anything else is
  `403 DISPATCH_NEEDS_MANAGER`. The munshi is never given the manager keys.

**Release round (v0.8.0).** "Today" is the facility's day everywhere: twelve web form defaults and ten
API defaults had used the UTC date (wrong between midnight and 05:00 in Lahore), and so had gate-pass
numbers, the lot page's days in storage, the digest's date line and four month/year form defaults; the
digest scheduler compared the owner's hour with the container's UTC hour. `scripts/check-business-date.mjs`
now fails CI on a new UTC "today". The party's credit-limit tile names a live gate pre-approval, and a
first approval starts from the party's credit limit. Party tabs, the invoices list and the nav follow
permissions (no tab that 403s into an empty list). From the pre-merge review: a party's other uncleared
cheques now count against its standing approval (they were counted only on the truck at the gate); the
solo checkout needs a truck dated today and no weight-priced charge; nobody voids the count of their own
cash; a count typed while another receipt arrives is cleared rather than booked as a shortage; and a
default charge priced at zero no longer blocks every checkout.

## C2 — a truck carrying several lots (after v0.8.0; not yet released)

Owner decisions (2026-10-23): **weighing stays lot by lot** (a whole-truck kanta weight split across
lots belongs to C3); **a truck may carry lots billed to different parties**, and its checkout takes one
payment per (billing party, book), each with its own receipt.

- *The truck is its plate.* A truck's load is every open withdrawal whose normalized plate matches an
  ARRIVED/WEIGHING gate pass, read by one helper (`gate-pass/open-load.ts` `openLoads`) that the gate's
  "Ready to leave" preview and the desk both call, so they always show the same lines. Nothing links a
  withdrawal to a pass at booking (still on the list below); a lot booked with a mistyped plate is on no
  truck and stays a single row. Two passes inside with the same plate are one truck (the newest pass).
- *The desk.* Each truck inside is a card with its lots (`GET /v1/dispatch/trucks`). "Add a lot" books
  onto that truck with the plate fixed. "Check out truck" (two or more lots still to check out, none left
  to weigh) opens one sheet: every lot's bill as the server priced it, and one payment row per party and
  book. A row on such a truck says "Check out with the truck" instead of its own button; a one-lot truck
  is checked out from its row as before.
  - Each lot on a card opens its withdrawal. The card names what holds the truck ("Weigh or cancel DN-… first"), so a lot left unweighed, even from days ago and no longer in the queue, can still be dealt with.
  - A truck of more than 20 open lots keeps its rows' own buttons, since one checkout takes at most 20.
- *One transaction, all or nothing* (`POST /v1/dispatch/trucks/:passId/dispatch-and-collect`, at most 20
  lots). It locks the pass, then every withdrawal (sorted), then every lot (sorted), and only then checks
  the load again. It then dispatches each line exactly as the single checkout does (one invoice and JE-01
  per lot), and records **one receipt (JE-02) per (party, book)** allocated across that group's bills.
  - These refuse the whole truck:
    - a changed bill (`DISPATCH_TOTAL_CHANGED`, naming its dispatch note);
    - a lot still to weigh (`TRUCK_NOT_READY`);
    - a lot added or removed since the review, or checked out on its own meanwhile (`TRUCK_LOAD_CHANGED`, naming dispatch notes);
    - payments that do not match the groups (`TRUCK_PAYMENTS_MISMATCH`).
  - A truck sent twice (a retry, or two clicks at once) is answered "This truck was already checked out" (`OUTBOUND_ALREADY_FINALIZED`). The desk treats that as done and offers the slip.
  - Accounting is unchanged: no combined invoice and no new posting or reversal path.
- *Solo on a truck:* every line must pass the single checkout's solo rules, nothing may be left off, and
  each group is cash in full or credit its standing approval covers **after all of that party's bills on
  the truck** are in the ledger.
- *Load slip* (`GET /v1/dispatch/trucks/:passId/load-slip`, A5). It prints:
  - every lot with its dispatch note, bags, bill and balance;
  - each receipt and who took it;
  - credit per party, with who authorized it;
  - totals, signature lines and Lahore times.
  - **Who authorized the credit:**
    - Once the truck has left, the gate's own record: the standing approval it went out on, else the manager who authorized it there.
    - While it is inside, the approval's approver only when that approval covers what the party owes; otherwise whoever dispatched the bill.
  - An uncleared cheque counts as still owed, as at the gate, and its receipt reads "CHEQUE (not cleared)".
  - Each bill stays with the party it was billed to, even if the lot changes hands later.
  - A full truck (20 lots) prints on two A5 pages.
  - The slip opens in its own tab at once. Chrome blocks a tab opened after a slow render, so the tab opens first and the PDF fills it.
  - It is refused to the gate guard (`BLIND_ROLE_FORBIDDEN`).
  - After the truck leaves it still reads its lines, from the withdrawals stamped with the pass.
- *At the gate:* the receipt lists every withdrawal on the truck (dispatch note, marka, owner), still with no counts. So does the guard's Ready-to-leave card, since a truck may carry several owners' lots, each with its own marka.
- Two v0.8.0 known limits are fixed: the preview and the bill now share one pricing function
  (`invoice/invoice-totals.ts`), and the gate preview reads only open loads in SQL.
- Left for later. The full list, with the reviewer's minors, is in PROGRESS.md.
  - **Every other PDF button opens its tab only after the PDF arrives:** invoices, the gate receipt's Print, the parchi, statements, payroll. Chrome blocks that when a render takes more than about five seconds, as it did for the guard's Print in the C2 browser check. The slip's fix (open the tab first: `components/dispatch/dispatch-pdf.ts`) applies to each.
  - **The truck routes are not blind to the guard,** like the single desk routes. That only matters if the owner ever grants the guard `outbound.record`.
  - **The slip shows receipts, payment modes and KATCHI bills to whoever can book (the munshi).** That's the owner's call.

## Switches (all **off** until the owner turns them on)

| Where | Setting | Effect |
|---|---|---|
| Settings → Dispatch Desk Cash | `cash_tracking_from` | Cash taken from that business day on waits for a manager's count. Turn this on **before** solo dispatch. |
| Settings → Dispatch | `dispatch_solo_mode` | The munshi may finish clean trucks without a manager. |
| Party page → Standing credit | per party | That party's credit trucks leave the gate without a manager while the approval holds. |

## Upgrading a box

- Migrations `0038`–`0042` are expand-only; `deploy.ts` applies them, inserts account 6105 through
  `syncChartOfAccounts()`, and warns (never fails) if any lot is already below zero.
- New permission keys get their default roles: `parties.credit_terms` (MANAGER), `cash_handovers.confirm`
  (MANAGER) — 51 keys in all.
- **Re-check Settings → Notifications → digest hour.** It was compared with the container's UTC clock, so
  "8" sent the digest at 13:00 in Lahore; it now means 08:00 in Lahore. An owner who set a smaller hour to
  compensate will get the email 5 hours earlier than before.
- Client boxes track `:stable`, which is still **v0.6.2**. Promoting v0.8.0 also ships the v0.7.0
  storage tariffs, whose setup screen the client found confusing; promote only when the owner says so.

## Known limits (left on purpose in v0.8.0)

From the pre-merge review, judged too small or too rare to hold the release; each is a follow-up:
- A manager's override reason waives every gate check it meets on that release (plate, unmatched
  load, count), not only the one shown. The mismatch flag and the reason are still stored on the pass.
- ~~The checkout preview rounds the subtotal before GST while the built bill sums it unrounded; on an
  exact half-paisa boundary the desk can keep answering "the total changed".~~ Fixed in C2: both use
  `invoiceTotals`.
- A standalone receipt that deadlocks with a desk checkout on the numbering locks gets a plain error
  (nothing is written); submitting again works.
- A standing approval revoked at the very moment a truck is released can still let that one truck out.
- ~~The gate's "Ready to leave" poll reads every withdrawal dispatched before v0.8.0 and skips them in
  code, so its cost grows with history.~~ Fixed in C2: `openLoads` filters them out in SQL.
- Until C3, solo dispatch refuses any truck while a default charge priced by weight is active, because
  the munshi types the weight.

## Still to build

C2 is built (above). C3: the blind inline weigh-out (and a whole-truck kanta weight split across lots) with a tolerance band that grows with storage time, and QR codes on the parchi and dispatch
note. Also: a manager approval queue with reason codes; persisted gate count attempts and linking the
gate pass at booking (Phase 0's residual gaps); a dispatch-note search replacing the gate's raw ID box.
