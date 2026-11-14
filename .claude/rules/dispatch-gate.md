---
paths:
  - "apps/api/src/modules/{gate-pass,outbound,credit-approval,invoice,cash-handover,lot,ownership-transfer,service-charge}/**"
  - "apps/api/src/common/{blind-count,weight}.ts"
  - "apps/api/src/plugins/blind-redaction.ts"
  - "apps/api/src/test/helpers.ts"
  - "apps/web/src/app/(app)/{gate,dispatch,outbound-events,lots}/**"
  - "apps/web/src/components/{gate,dispatch,outbound}/**"
---

# Dispatch, withdrawals and the gate

Design and owner decisions: `docs/26_fast_dispatch.md`, `docs/27_weight_optional.md`, `docs/28_c3.md`.

## Withdrawals hold bags

- **A withdrawal holds its bags from booking until dispatch or cancel; a truck's withdrawals are stamped with `outbound_events.gate_pass_id` when it leaves.** Anything that takes bags off a lot (a new withdrawal, a partial ownership transfer) must subtract `openReservation()` (`apps/api/src/modules/outbound/reservation.ts`). Finalize locks the withdrawal, then the lot, and re-reads the lot under the lock. Lock order everywhere: gate_passes → outbound_events → lots → placements. Never lock a lot and then an existing withdrawal. `lots.current_balance_bags >= 0` is a DB CHECK (0038).

## A truck is its plate

- **A truck is its plate, and its load is read by `openLoads()`** (`apps/api/src/modules/gate-pass/open-load.ts`). The gate's "Ready to leave" preview, the desk's trucks, the truck checkout and the load slip all call it, so they agree on a truck's lines.
  - The gate release has its own locked plate query (`matchByPlate`). It reads the same lines through the shared `OPEN_LOAD_STAGE_SQL`, so the two cannot drift: write no third plate query. A truck carrying any line not yet dispatched is refused (`GATE_OUTWARD_NOT_DISPATCHED`, no override, before the count is compared), because the gate used to match only dispatched lines and let a loaded truck with a booked withdrawal out on a count of 0 (docs/28 D3).
  - A guard has `GATE_COUNT_TRIES` (3, in `@coldchain/shared`) wrong counts **per truck, not per pass**: `triesUsed()` counts `gate_count_attempts` rows for the normalized plate since that plate's last release, so logging the truck in again starts nothing over. A wrong count is saved by `refuseWrongCount`, and the refusal is a `KeptRefusal` that `withKeptRefusals` commits before it throws: a plain `throw` inside the release transaction would roll the saved count back with everything else. The plate's advisory lock is what stops two passes of an empty truck taking the last try together (a loaded truck is serialized by its withdrawal rows). Only a manager releases a locked truck, and a manager is never locked. `expected_quantity` is a blind key.
  - Nothing links a withdrawal to a pass at booking: a mistyped plate means a lot on no truck. The pass does not remember the withdrawal a manager named either (only the request names one), so a bare release always checks the whole truck by plate. A manager naming one dispatch note on a truck whose plate carries other lots is refused (409 `GATE_NAMED_LINE_ON_FULL_TRUCK`): only the plate release counts, checks the payment of and stamps every lot. There is no one-step log-and-release route (deleted, docs/28 O13): every release is `POST /gate-passes/:id/outward`.
  - A truck still inside lists (`count_attempts`, managers only) the plate's wrong counts since its last release, the same rows the lock counts (`attemptsByPlate`); a pass that has left lists its own, as the record.
  - The truck checkout (`DispatchCheckoutService.truckDispatchAndCollect`) locks the pass, then **every** withdrawal (sorted), then **every** lot (sorted) via `lockLoad`. Only then does it re-read and check the load, before it dispatches any line. A truck sent twice therefore answers `OUTBOUND_ALREADY_FINALIZED`, which the desk treats as done.
  - Locking a line's rows one at a time inside the loop deadlocks two trucks carrying partials of the same lots. A retry hides the deadlock, which is why the test counts the checkout runs. The checkout preview and the bill it builds price through one function, `invoiceTotals()` (`modules/invoice/invoice-totals.ts`). Re-deriving that arithmetic brings back the half-paisa "total changed" loop.
- Plates compare through `normalizePlate()` (letters and digits only), never `===`.

## Weight is optional

- **Weight is optional everywhere (owner decision, docs/27). Never make it required again.**
  - **Storage:** a lot with no weight stores `accepted_weight_kg = 0`. The column stays NOT NULL so an older image can still read every lot after a rollback. Read a lot's weight only through `recordedKg()` (`apps/api/src/common/weight.ts`), which turns 0 into null; never use `Number()`.
  - **The switch:** `hide_weights` is the screen's "We weigh produce", stored inverted. A facility that never saved it shows weights; `provision.ts` stores `true` for new client boxes. It hides every weight box and weight line. The web reads it through `useWeightsShown()`.
  - **One dispatch rule:** what may be dispatched is `isReadyToDispatch()` (PENDING or WEIGHED, `outbound/reservation.ts`). Every check uses it, the solo door's included, so a booked line meets the same rules a weighed one does. Only a legacy DISPUTED row waits.
  - **Per-ton charges:** a service charge priced per ton is the one thing that needs a weight. Both checkouts refuse an unweighed one after the manager's skips (`OUTBOUND_WEIGHT_REQUIRED`, never billed at zero). Hiding weights is refused while one is active, and none can be made active while weights are hidden.

## The guard counts blind

- **The gate guard (SECURITY) counts bags blind, and the API enforces it.** A global `preSerialization` hook (`apps/api/src/plugins/blind-redaction.ts`, registered in `app.ts` **and** in `test/helpers.ts`, which builds its own app) nulls every stock-quantity field in anything sent to the SECURITY role; the field list is `BLIND_KEYS` in `apps/api/src/common/blind-count.ts`. Since v0.8.0 it also holds the **weights** and the **money owed at the gate** (`outstanding_pkr`, `credit_authorized_amount_pkr`), because either turns back into the count (owner decision). **A new response field that carries bags on a lot, rack, room or withdrawal, a weight, or an amount owed on a truck must be added there**, or the guard can read it — and an error message the guard can trigger must not spell such a figure out either (a release refused for payment tells the guard only "Payment pending"; the gate page gives the next step). Test it by naming the fields, never by reading `BLIND_KEYS` (that check passes whatever the list says). Documents with the count inside text or a PDF (invoices, the placement slip) use `app.forbidBlindRole` instead (403 `BLIND_ROLE_FORBIDDEN`); a PDF built in a controller from service data never passes the hook, so blank the quantity there (see the gate receipt). Web code must render these as `formatCount(n)` / `formatKg(n)` (a dash for `null`), never `n.toLocaleString()`. This is a role check, not a permission key.

## Credit at the gate, solo dispatch, Allow

- **Credit approval at the gate has one helper, and solo dispatch is a narrow door, not a permission grant.** `standingCreditCover()` (`modules/credit-approval/credit-approval.service.ts`) decides whether a party's standing approval holds a bill — its ledger exposure on both books plus **every** cheque of the party's not yet cleared (the ledger already counts those paid), never just the ones on this truck; the gate preview, the gate release **and** the solo checkout all call it, so the guard is never shown READY for a truck the release then refuses.
- With `dispatch_solo_mode` on, `dispatch-and-collect` lets a caller holding only `outbound.record` finish a PACCI truck dated today, with no weight-priced default charge, on cash in full or approved credit (`DispatchCheckoutService.authorize`); everything else is 403 `DISPATCH_NEEDS_MANAGER`. Never "fix" a munshi refusal by granting `outbound.finalize` / `invoices.manage` / `payments.record`: those also unlock discounts, credit notes and dishonouring. Turn `cash_tracking_from` on before the solo switch, or nobody counts the cash.
- The solo rules are one function, `soloRefusal()` (`modules/outbound/solo-rule.ts`): the checkout, both previews and the managers' waiting list (`GET /v1/dispatch/waiting`, docs/28 part 3) all ask it, and every refusal carries its code (`details.reason_code`, codes in `@coldchain/shared`). A munshi who can't finish a truck calls a manager (`POST /v1/dispatch/ask-manager`); the checkout itself never stores a refusal.
- A manager can then Allow what was asked for (`POST /v1/dispatch/allow`, docs/28 part 4): only cheque-or-transfer, credit on this bill or leaving charges off, never a solo rule, live the Lahore business day (`liveAllows()`), and re-checked under the row locks by the same `soloAskRefusal()` the pre-check uses. Allowed credit has no ceiling and stamps `credit_allowed_by`, which the load slip names; read allowances by id, never through `openLoads()`.
