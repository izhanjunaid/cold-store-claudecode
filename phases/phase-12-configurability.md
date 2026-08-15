# Phase 12: Owner/Accountant Configurability

**Objective**: Give the owner and accountant more dynamic control — close spec'd-but-unimplemented flexibility gaps and replace a few hardcoded business values with configurable settings.
**Branch**: `phase/12-configurability`
**Prerequisites**: Phases 0-11
**Started**: 2026-06-12
**Completed**: 2026-06-13
**Design**: `C:\Users\izhan\.claude\plans\so-so-far-what-recursive-thacker.md`

## Scope decision

Exploration found the system already configurable where it matters (rate plans, service charges, chart of accounts, manual JEs, credit notes, commodities, chambers). Four high-value gaps were chosen for this phase; the owner explicitly deferred peshgi markup/interest ("not now"). Deliberately **not** built (would hurt the product at single-facility scale or weaken audit integrity): custom roles/permissions, editable JE templates, configurable numbering formats.

## Buckets (one commit per bucket)

- [x] 12.1 — Configurable facility settings + enforcement (commit `4617291`)
- [x] 12.2 — Draft-stage invoice discount, percent or fixed (commit `e5adc34`)
- [x] 12.3 — Default GST rate prefill (commit `8285e49`)
- [x] 12.4 — Late payment surcharge — suggested, one-click apply (commit `4e0bbed`)
- [x] 12.5 — E2E specs + docs

## Definition of Done
Owner can configure the new settings from `/settings`; managers can discount a draft invoice (posting to contra-revenue 4910 on finalize); invoices prefill GST when the facility is registered; accountants see and one-click-apply late-payment surcharges on overdue invoices; the GL stays balanced and reconciled throughout. Suite green.

## 12.1 — Configurable facility settings + enforcement

**Settings** (`packages/shared/src/schemas/facility.ts`, merged over stored JSON by `mergeSettings` — no migration):
- `chamber_capacity_warning_pct` (int 1–100, default 90)
- `backdating_max_days` (int ≥0 nullable, default null = unlimited)
- `gst_default_rate` (0–100, default 18)
- `late_payment_surcharge { enabled, pct_per_month, grace_days }` (default `{false, 2, 30}`)

**Bug fixed**: `lot.service` read `weight_dispute_threshold_pct` (never present → silently always used a hardcoded 2% variance check) while the schema/seed/`/settings` UI used `weight_dispute_threshold_kg`. Now honors the kg threshold as an absolute comparison. Existing lot tests that asserted the 2% behavior were updated deliberately — the inbound dispute default shifts from "2% variance" to "5 kg absolute".

**Enforcement**:
- Chamber capacity warning threshold read from settings (was `* 0.9` hardcoded in `lot.service`); warning text interpolates the configured pct.
- Backdating guard: `lot.service` (inbound) and `outbound.service` (outbound) reject dates older than `backdating_max_days` for sub-MANAGER roles; MANAGER+ exempt. New `Errors.BACKDATING_LIMIT_EXCEEDED` (422). `userRole` threaded through `lot.controller`.
- `roleAtLeast()` exported from `plugins/auth.ts` (outbound's ad-hoc `ROLE_RANK` replaced); `resolveFacilitySettings()` exported from `facility.service.ts`.

**Frontend**: `/settings` extended with chamber-warning %, max-backdating-days (empty = unlimited), default GST rate (when registered), and a late-payment-surcharge section.

## 12.2 — Draft-stage invoice discount

**Data model** (migration `0016_invoice_discount`): columns on `invoices` — `discount_type` (`DiscountType` enum PERCENT/FIXED), `discount_value`, `discount_amount_pkr`. Not a line item — a negative line would net into a revenue account via JE-01's line→account mapping, violating gross-revenue posting. CoA backfill **4900 Contra Revenue** (header) + **4910 Discounts Allowed** (detail, normal DEBIT) for all facilities (`ON CONFLICT DO NOTHING`); `seed.ts` mirrors for fresh DBs. CoA count 81 → 83.

**Totals** (`invoice.repository.recomputeTotals`): `discount = PERCENT ? round2(sub × v/100) : v` (error if > subtotal); `gst = round2((sub − discount) × rate/100)`; `total = sub − discount + gst`. Re-validated every recompute — removing a line that shrinks subtotal below a FIXED discount fails loudly (`INVOICE_DISCOUNT_EXCEEDS_SUBTOTAL` 422), never silently clamps.

**API**: `PATCH /v1/invoices/:id` (MANAGER+, DRAFT-only, 409 otherwise) — sets/clears the discount (null clears) and edits `gst_rate`. `UpdateDraftInvoiceRequest` in shared.

**JE-01**: when discount > 0, emits `DR 4910` for the discount amount; AR debited net, revenue credited gross (same balance algebra as the existing advance-applied handling). `ACCOUNT_DISCOUNTS_ALLOWED = '4910'` in `templates/types.ts`.

**PDF / UI**: discount row on the invoice PDF (between subtotal and GST); a Discount & GST editor modal on the invoice detail page for DRAFT + MANAGER+, with a Subtotal → Discount → GST → Total breakdown. Post-finalization remains credit-note-only (unchanged).

## 12.3 — Default GST rate prefill

`invoice.builder` loads facility settings in-tx via `resolveFacilitySettings`; when `gst_registered`, `gstRate` defaults to `gst_default_rate` and gst/total are computed at invoice creation (was hardcoded 0). Per-invoice override is the 12.2 PATCH.

## 12.4 — Late payment surcharge (suggested, one-click apply)

Decided **suggested + one-click**, not automatic — surcharges are a negotiation lever in mandi relationships; automatic posting would force credit-note walk-backs.

**Data model** (migration `0017_invoice_surcharges`): `EntryType += SURCHARGE`; `invoice_surcharges` table (id, facility, invoice FK, surcharge_date, months_charged, base_outstanding_pkr, rate_pct_per_month, amount_pkr, journal_entry_id UNIQUE, notes, created_by; audit trigger attached); `invoices.surcharge_total_pkr` running total.

**Computation** (`surcharge-calc.ts`, pure/unit-tested): ages from `invoice_date` (no due-date concept; consistent with receivables-aging); `eligible_months = max(0, floor((days_overdue − grace) / 30))` (whole 30-day blocks, no pro-rating); `chargeable = eligible − months_already_charged` (idempotent — re-apply in the same block → 0 → 409); `principal = max(0, total − paid)` (excludes prior surcharges → non-compounding; payments deemed to settle principal first); `suggested = round2(principal × pct/100 × chargeable)`.

**JE-21** (`je-21-late-payment-surcharge.ts`): `DR party AR / CR 4210`, entryType SURCHARGE, posted via the existing `postInTransaction` (inherits period-lock + account validation). Posted entries are never edited — an erroneous surcharge is corrected with a manual reversal JE (pacci immutability preserved).

**Module** `apps/api/src/modules/surcharge/`:
- `GET /v1/surcharges/suggestions` (ACCOUNTANT+) — overdue invoices with computed months/principal/amount
- `POST /v1/invoices/:id/surcharges` (ACCOUNTANT+) — one-click apply; `SELECT … FOR UPDATE` serializes; recomputes server-side; inserts record; increments `surcharge_total_pkr`; posts JE-21; links it
- `GET /v1/invoices/:id/surcharges` — applied records

**Outstanding-balance integration** — `balance_due = total + surcharge_total − amount_paid` wired into: invoice `formatInvoice`/`getPdf`, payment `validateInvoiceAllocation` (raw SQL — payments now settle the surcharge with zero allocation-mechanics change), `receivables-aging`, and the party ledger (new SURCHARGE debit entry, sorted between invoice and payment; flows to party-statement via the ledger).

**Errors**: `SURCHARGE_RULE_DISABLED` 422, `SURCHARGE_ALREADY_APPLIED` 409, `SURCHARGE_NOT_ELIGIBLE` 422.

**Frontend**: `/reports/surcharges` suggestions screen with a one-click Apply per row (confirm → invalidate) and a disabled-rule state linking the owner to `/settings`; the receivables-aging page links to it; invoice detail shows the surcharge in totals and an applied-surcharges list.

## 12.5 — E2E specs + docs

- `wf-04-full-withdrawal-settlement.spec.ts` extended: applies a 10% draft-stage discount before finalizing and asserts the discounted total settles to 0. (Also corrected the payment allocation field to `allocated_amount_pkr`.)
- New `wf-08-late-payment-surcharge.spec.ts`: owner enables the rule → finalized invoice backdated overdue → accountant applies the suggestion → invoice balance includes the surcharge → payment for total+surcharge settles to 0.
- New E2E admin helper `POST /v1/_test/backdate-invoice`; `_test/reset` now clears `invoice_surcharges`.
- Both specs typecheck-clean. They run in CI against a dedicated stack (`ALLOW_TEST_RESET=1`) and were not executed in the dev session to avoid colliding with the running servers; the asserted API behavior is fully covered by the 12.1–12.4 integration suite.

## Migrations
- `0016_invoice_discount` — DiscountType enum, invoice discount columns, CoA 4900/4910 backfill
- `0017_invoice_surcharges` — SURCHARGE EntryType, invoice_surcharges table + audit trigger, invoices.surcharge_total_pkr

Both applied to the dev DB via `prisma db execute` (the project's convention — the dev DB history is not Prisma-baselined). `schema.prisma` and `seed.ts` updated to match.

## Tests
11 unit + 31 integration new (suite: **135 unit + 283 integration green**). See TESTING.md → "Phase 12 Tests". E2E: +1 spec, +1 extended (CI-run).
