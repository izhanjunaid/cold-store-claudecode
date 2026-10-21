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
the hook also nulls **weights** (accepted, declared, outbound, prorated, variance) and the **money
owed at the gate** (`outstanding_pkr`, `credit_authorized_amount_pkr`); a guard refused for payment
reads "Payment pending — send the driver to the desk". Everyone else keeps every figure.

**Phase C1 — standing credit, cash handover, solo dispatch** (migrations `0040`–`0042`).
- *Standing credit:* a manager (`parties.credit_terms`) pre-approves a party up to a ceiling on its
  total exposure (both books, uncleared cheques counted), optionally until a date. A truck whose every
  unpaid bill is covered is READY at the gate and the guard releases it alone; the pass records the
  approval and names the approving manager. One helper, `standingCreditCover()`, decides for the gate
  preview, the release and the solo checkout.
- *Cash handover:* with cash tracking on, each collector's cash receipts are "cash waiting"; a manager
  (`cash_handovers.confirm`, new) counts it on the desk. A difference needs a reason and posts JE-28 to
  **6105 Cash Short & Over**. Nobody counts their own cash; the owner's cash is not tracked.
- *Solo dispatch:* with the owner's switch on, a munshi (`outbound.record` only) may finish a PACCI truck
  on cash in full or approved credit, with every charge kept; anything else is
  `403 DISPATCH_NEEDS_MANAGER`. The munshi is never given the manager keys.

**Release round (v0.8.0).** "Today" is the facility's day everywhere: twelve web form defaults and ten
API defaults had used the UTC date (wrong between midnight and 05:00 in Lahore), and the digest
scheduler compared the owner's hour with the container's UTC hour; `scripts/check-business-date.mjs`
now fails CI on a new UTC "today". The party's credit-limit tile names a live gate pre-approval, and a
first approval starts from the party's credit limit. Party tabs, the invoices list and the nav follow
permissions (no tab that 403s into an empty list). The desk's cash card shows bank and wallet takings.

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
- Client boxes track `:stable`, which is still **v0.6.2**. Promoting v0.8.0 also ships the v0.7.0
  storage tariffs, whose setup screen the client found confusing; promote only when the owner says so.

## Still to build

C2: a multi-lot truck basket and load slip (one checkout for several bills). C3: the blind inline
weigh-out with a tolerance band that grows with storage time, and QR codes on the parchi and dispatch
note. Also: a manager approval queue with reason codes; persisted gate count attempts and linking the
gate pass at booking (Phase 0's residual gaps); a dispatch-note search replacing the gate's raw ID box.
