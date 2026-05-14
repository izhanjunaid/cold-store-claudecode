# Phase 9: Gate Pass (M10) + Peshgi (M11) UI + Spec Realignment

**Objective**: Build the missing Gate Pass module from scratch, ship the Peshgi UI, realign 8B's API-only Peshgi to spec ground truth, and wire WF-07 combined settlement.
**Branch**: `phase/09-gate-peshgi`
**Prerequisites**: Phase 8B
**Started**: 2026-05-09
**Completed**: 2026-05-10

## Tasks

- [x] 9.1 — Migration `0010_gate_peshgi` (GatePass model + enums; PartyLoanStatus rename `FULLY_RECOVERED → RECOVERED`; new `RepaymentMethod` enum; `EntryType += PESHGI_WRITE_OFF`; PaymentAllocation nullable invoice_id + loan_id + CHECK XOR; PartyLoan write-off columns; loan-number realign for shipped 8B rows)
- [x] 9.2 — Gate Pass Backend (`gate-pass-number.ts` GP-YYMMDD-NNNN, repository, service with row-locking + outward invoice validation + credit_authorization MANAGER+ override, controller with 6 routes; shared schemas; error codes)
- [x] 9.3 — Peshgi spec realignment (`/v1/peshgi → /v1/loans`; `L-YYMMDD-NNN` numbering; required `payment_method` on issuance; write-off endpoint + JE-20 template DR 6080 / CR 1140; JSON acknowledgment endpoint)
- [x] 9.4 — Combined settlement in `payment.service` (discriminated allocation union, loan-allocation row-lock + decrement + `RECOVERED` transition + JE-19 in same tx; cheque dishonour reverses both invoice and loan allocations)
- [x] 9.5 — S-32 Gate Pass Console at `/gate` (touch-optimized split layout, 15s polling, Log Arrival form, Vehicles Currently Inside, Clear Outward modal with credit_authorization toggle for MANAGER+)
- [x] 9.6 — S-33 `/loans/issue` (OWNER, debounced party search, PKR formatter, segmented payment-method); S-34 `/loans` dashboard with summary card and `/loans/[id]` detail (repayment timeline, Record Repayment, Write Off); Party Detail Peshgi tab populated with live data
- [x] 9.7 — SECURITY post-login redirect via `apps/web/src/lib/auth-redirect.ts:defaultRouteForRole`
- [x] 9.8 — Tests: 6 net-new unit (gate-pass-number x3, JE-20 template x2, peshgi-number L- format) + 21 net-new integration; existing peshgi integration rewritten to spec
- [x] 9.9 — Tracking docs (PROGRESS.md, TESTING.md, this file) + project memory updated

## Definition of Done

- ✅ Gate pass flow: inward log → optional link-lot → outward clearance with invoice validation
- ✅ Outward validates invoice paid OR credit_authorization granted by MANAGER+
- ✅ Peshgi spec realigned: status `RECOVERED` (not `FULLY_RECOVERED`), `L-YYMMDD-NNN`, decoupled `RepaymentMethod` enum
- ✅ JE-18 / JE-19 / JE-20 (write-off) all post correctly
- ✅ WF-01 gate steps (1, 14) implemented; WF-07 combined settlement (step 10) lands JE-02 + JE-19 in one tx
- ✅ ≥8 tests (delivered 27 net-new across unit + integration)

## Test Counts

| Layer | Count |
|-------|------:|
| Unit | 6 (gate-pass-number 3, JE-20 template 2, peshgi-number L- 1) |
| Integration | 21 (gate-pass 7, peshgi rewritten 12 net delta vs Phase 8B's 8, combined settlement 4) |
| **Total Phase 9 net-new** | **27** |

Suite-wide after Phase 9: **82 unit + 196 integration tests pass.**

## Notable divergences resolved during Phase 9

- 8B shipped peshgi with `FULLY_RECOVERED` enum, `PSH-YYYYMM-NNNN` numbering, and the `ExpensePaymentMethod` enum (CASH/CHEQUE/BANK_TRANSFER). User decision was "spec is ground truth": migration 0010 renames the enum value via `ALTER TYPE … RENAME VALUE` (loss-free), backfills loan numbers from `PSH-%` to `L-YYMMDD-NNN`, and pivots `payment_method` to a dedicated `RepaymentMethod` enum (CASH / BANK_TRANSFER / DEDUCTED_FROM_PRODUCE). Existing `ExpensePaymentMethod` is left intact for `expense_vouchers`.
- Spec functional matrix (`docs/07:96`) lists Gate Pass as OWNER/MANAGER/OPERATOR — but `docs/10:517-520` and `docs/13:249` say SECURITY+. We follow API + screen specs (SECURITY+ primary) since this matches the touch-optimized intent of the screen.
- `docs/10` calls the loans path `/loans`; 8B used `/v1/peshgi`. Endpoint moved to `/v1/loans` per spec — no frontend caller existed (8B was API-only) so no UI cascade.

## Deferred to Phase 11 polish

- Loan acknowledgment PDF (currently JSON via `GET /v1/loans/:id/acknowledgment`)
- Gate pass receipt PDF (status displayed in JSON detail)
- Manual UI smoke against `pnpm dev` (per Phase 8B convention)
- Audit-trigger backfill (pre-existing gap; only `facilities` and `users` have triggers in dev DB)
