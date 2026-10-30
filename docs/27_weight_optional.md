# 27 — Weight optional (C3, part 1)

Most of the owner's clients never weigh produce, but the software forced a weight twice. Inward, the
lot form required an accepted weight. Outward, every withdrawal had to be weighed before checkout. A
client who doesn't weigh had to invent numbers, and every lot that went out cost an extra step.

This change makes weight optional everywhere, and lets a facility hide it completely. It replaces
C3's planned blind weigh-out with a tolerance band (docs/26 D4), which is dropped. The rest of C3 is
planned after this ships: QR codes on the parchi and the dispatch note, the manager's approval queue,
and the gate gaps.

> The owner, 2026-10-29: "there was always this idea in my mind that the weight thing should not be
> mandatory, as per our majority of clients they don't keep track of weight so i want you to make this
> optional. optional in everything from inwards to outwards etc everything. so ultimately no check for
> weight needed in c3"

## Owner decisions (2026-10-29)

| | Decision |
|---|---|
| W1 | **Both.** Weight is optional for every client, and a per-facility setting, **"We weigh produce"**, hides every weight box, the Weigh step and the weight lines on papers for a client who never weighs. |
| W2 | **The live client keeps weights showing after the update.** The owner can switch them off in Settings. |
| W3 | **This ships first,** on its own. The rest of C3 comes after. |

These were played back to the owner and not challenged:
- New installs start with weights hidden.
- The declared-vs-accepted note is asked for only when both weights are typed.
- A booked lot checks out straight away, with no Weigh step.
- Papers print a weight only when there is one.
- "Per ton" can't be used while weights are hidden.
- Old weights are kept.
- The gate guard's view is unchanged.

## What a client sees

**Weights hidden** ("We weigh produce" off):
- No weight box anywhere: the inward form, the Dispatch Desk, the trucks panel, the checkout sheets, and the lot and withdrawal pages.
- No weight on the parchi or the dispatch note.
- No Weight Variance report in the Reports list.
- A booked withdrawal shows **Check out** straight away.

**Weights shown** ("We weigh produce" on):
- The boxes are where they were, all optional.
- The kanta weight can still be typed on the desk row or the withdrawal page, but nothing waits for it.

**The one exception** is a service charge priced **per ton**, which can't be billed without a weight. The checkout stops, names the lot and the charge, and says to record the weight first. A manager may instead leave the charge off the bill. A per-ton charge is therefore never billed at zero.

## Behaviour

### The setting
- **Settings → Operational Settings → "We weigh produce"** (a checkbox). Stored as `hide_weights` (default `false`) in the facility settings, its inverse. The web reads it through `useWeightsShown()`.
- A facility that never saved the key shows weights, so an existing box changes nothing on update.
- New client boxes are created by `packages/db/prisma/provision.ts`, which stores `hide_weights: true`.
- **Hiding weights is refused while an active per-ton service charge exists.** The check runs only when the switch goes from shown to hidden, because the Settings page re-sends every key on every save.
- **While weights are hidden, no service charge can end up active and per ton,** whether by create, by switching its unit, or by reactivating it.
- Switching never touches a stored weight.

### Inward
- The accepted weight is optional, like the declared weight.
- A lot with no weight stores **0**, which means "not weighed". Every reader turns 0 into "no weight" (`recordedKg()` in `apps/api/src/common/weight.ts`), so the API answers `accepted_weight_kg: null` and papers and pages print nothing.
  - **Why 0 and not null:** the column stays NOT NULL. An older image's database client refuses to read a null in a column it believes is required, so after a rollback every lot page would break. A 0 rolls back safely, shown as "0 kg".
  - Partial ownership transfers already stored 0 for their new lot.
- The declared-vs-accepted dispute check runs only when both weights are present.

### Outward
- A withdrawal is ready to dispatch when it is **PENDING or WEIGHED**. One rule decides it everywhere (`isReadyToDispatch()`):
  - plain finalize;
  - both checkout previews and both checkouts;
  - the trucks panel's "ready";
  - the solo checks, so a munshi checking out booked lines meets the same rules as for weighed ones.
- A legacy **DISPUTED** withdrawal is never set by the API. It still holds its truck (`TRUCK_NOT_READY`, "cancel it first"), is refused on its own (`OUTBOUND_DISPUTED`), and is never offered a checkout.
- **Per-ton charges:**
  - Each preview's service line carries `needs_weight`.
  - Both checkouts refuse an unweighed per-ton line after the manager's skips are applied (`OUTBOUND_WEIGHT_REQUIRED`, naming the dispatch note and the charge).
  - Solo dispatch still refuses while any per-ton dispatch charge is active. v0.8.0 listed this as a known limit "until C3"; C3's weigh-out is dropped, so **the limit stays**.

### Papers and reports
- **The parchi** prints its weights, the dispute banner and the "& Weight" heading only when there is a weight and weights are shown.
- **The dispatch note** prints the outbound weight only when there is one and weights are shown.
- **The weight-variance report** counts only lots and withdrawals that have a weight. Otherwise unweighed bags would read as shrinkage.

## Upgrading a box
- **No migration** and no schema change. The release still has 42 migrations.
- **On the live client:** weights stay on screen, but are no longer required, and the Weigh step is optional. To hide weights, the owner switches off "We weigh produce" in Settings, after deactivating any per-ton service charge.
- Tagging and Promote to stable stay the owner's.

## Calls made while building (for the owner to check)
- "Not weighed" is stored as 0, to keep a rollback safe.
- The setting is stored inverted, as `hide_weights`, so existing clients need no data change.
- A per-ton charge with no weight stops the checkout and points to the lot's desk row or withdrawal page, rather than adding a weight box inside the checkout sheet.
