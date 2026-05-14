# ColdChain — Testing Strategy

## Test Pyramid

### Unit Tests (Vitest)
- **Target**: >80% coverage on business logic (services layer)
- **Location**: `apps/api/src/**/*.test.ts`, `packages/shared/src/**/*.test.ts`
- **Run**: `turbo test:unit`

### Integration Tests (Vitest + Supertest)
- **Target**: 100% coverage on API endpoints
- **Location**: `apps/api/src/**/*.integration.test.ts`
- **Run**: `turbo test:integration`
- **Setup**: Test database with auto-migration, transaction rollback per test

### Component Tests (React Testing Library)
- **Location**: `apps/web/src/**/*.test.tsx`
- **Run**: `turbo test:web`

### E2E Tests (Playwright)
- **Target**: All 7 critical workflows from docs/12_e2e_workflows.md
- **Location**: `apps/web/e2e/`
- **Run**: `npx playwright test`

## Critical E2E Workflows (from PRD Section 6)

1. **WF-01**: Produce Inbound (farmer deposits) — gate → party → lot → receipt → exit
2. **WF-02**: Mid-Storage Ownership Transfer (partial) — lot → transfer → child lot → billing split
3. **WF-03**: Partial Withdrawal with Service Charges — lot → withdraw → weight → invoice → dispatch
4. **WF-04**: Full Withdrawal and Season Settlement — lot → full withdraw → invoice → payment → close
5. **WF-05**: Quality Inspection and Confirmed Spoilage — inspect → spoilage → confirm → lot adjust
6. **WF-06**: Month-End Financial Reconciliation — aging → interim invoices → cash summary
7. **WF-07**: Peshgi Loan Issue & Recovery — issue → store → settle → recover

## Test Results by Phase

| Phase | Unit | Integration | E2E | Total | Status |
|-------|------|-------------|-----|-------|--------|
| 0 | 14 | 13 | — | 27 | ALL PASS |
| 1 | — | 25 | — | 25 | ALL PASS |
| 2 | 9 | 24 | — | 33 | ALL PASS |
| 3 | — | 9 | — | 9 | ALL PASS |
| 4 | — | 13 | — | 13 | ALL PASS |
| 5 | 8 | 12 | — | 20 | ALL PASS |
| 7 | — | 12 | 1 | 13 | ALL PASS |
| 8A | 16 | 24 | — | 40 | ALL PASS |
| 8B | 34 | 46 | — | 80 | ALL PASS |
| 9 | 6 | 21 | — | 27 | ALL PASS |

### Phase 0 Tests
- `apps/api/src/common/jwt.test.ts` — 4 tests (sign/verify access & refresh tokens)
- `apps/api/src/common/errors.test.ts` — 5 tests (AppError, error factories)
- `apps/web/src/stores/auth.store.test.ts` — 5 tests (Zustand auth store)
- `apps/api/src/modules/auth/auth.integration.test.ts` — 13 tests (health, login, me, refresh, logout)

### Phase 1 Tests
- `apps/api/src/modules/party/party.integration.test.ts` — 12 tests (CRUD, search, filter, role guards, deactivate)
- `apps/api/src/modules/chamber/chamber.integration.test.ts` — 7 tests (CRUD, temperature logging, detail with logs)
- `apps/api/src/modules/commodity/commodity.integration.test.ts` — 6 tests (list, create, update, varieties CRUD)

### Phase 2 Tests
- `apps/api/src/modules/lot/lot-number.test.ts` — 3 tests (format, zero-padding, concurrency sequence)
- `apps/api/src/modules/pdf/templates/storage-receipt.test.ts` — 6 tests (Handlebars template snapshot, bilingual, dispute flag)
- `apps/api/src/modules/lot/lot.integration.test.ts` — 14 tests (create WF-01, 5-concurrent unique numbers, weight dispute, capacity overflow, commodity restriction, role guards, list/filter, detail, update, receipt PDF)
- `apps/api/src/modules/rate-plan/rate-plan.integration.test.ts` — 6 tests (create SEASONAL with dates, missing dates → 400, OPERATOR blocked, list filter, PATCH, soft delete)
- `apps/api/src/modules/service-charge/service-charge.integration.test.ts` — 4 tests (create, duplicate name → 400, list, OPERATOR blocked)

### Phase 3 Tests
- `apps/api/src/modules/ownership-transfer/ownership-transfer.integration.test.ts` — 9 tests (FULL, PARTIAL with -T1 child, sequential -T2, qty >= balance reject, same-party reject, CLOSED lot reject, OPERATOR 403 / MANAGER 201, acknowledgment PDF, ownership history reflects TRANSFER_OUT)

### Phase 4 Tests
- `apps/api/src/modules/outbound/outbound.integration.test.ts` — 13 tests (PARTIAL/FULL create, balance checks, CLOSED lot reject, GET by ID, weight→WEIGHED, variance, finalize→DISPATCHED with invoice_id, FULL finalize closes lot, no-weight reject, OPERATOR 403, dispatch note PDF, lot events endpoint)

### Phase 5 Tests
- `apps/api/src/modules/invoice/storage-charge.test.ts` — 8 unit tests (SEASONAL day-independent, MONTHLY ceil-to-month boundaries, DAILY days×rate×qty, min-billing-days floor, same-day inbound/outbound, rounding, zero-bag throw, SEASONAL description)
- `apps/api/src/modules/invoice/invoice.integration.test.ts` — 12 tests (SEASONAL charge math, MONTHLY 45-day=2months, DAILY 15-day, min-days same-day floor, add SERVICE line totals recomputed, add ADJUSTMENT negative, delete SERVICE ok/STORAGE immutable 422, finalize assigns INV-YYYYMM-NNNN, post-finalize add/delete/finalize 409, list filters by status+party_id+lot, role gating OPERATOR/SECURITY 403, PDF endpoint + idempotent builder)

### Phase 7 Tests
- `apps/api/src/modules/payment/payment.integration.test.ts` — 12 tests (full CASH allocation → balance_due=0 + status=ALLOCATED, partial allocation, advance payment → ADVANCE, cheque → clearance CLEARED, over-allocation 422, DRAFT invoice allocation 422, party mismatch 422, balance exceeded 422, dishonour cheque → allocations reversed, dishonour non-cheque 409, role gating OPERATOR 403, WF-04 ledger e2e)
- E2E (playwright-cli): login, lot create, outbound finalize, invoice finalize, record payment via UI, balance_due=0, party ledger DR/CR

### Phase 8A Tests
- `apps/api/src/modules/accounting/__tests__/journal-entry-templates.unit.test.ts` — 16 tests covering all 11 JE template builders (JE-01 storage+service+GST balance, JE-01 commodity routing 4010/4020/4030/4040, JE-01 advance-applied, JE-02 cash receipt, JE-03 advance to liability, JE-04 advance applied to invoice, JE-05 multi-line credit note, JE-06 cheque bounce REVERSAL, JE-07 overpayment split, JE-08 bad debt, JE-10 ownership reassignment, JE-11 monthly accrual, JE-11R reversal swap) plus account-mapping helper tests
- `apps/api/src/modules/accounting/__tests__/accounting.integration.test.ts` — 24 tests across 8 groups: CoA list/filter/RBAC create (4); JE forward path JE-01/02/03 + cheque dishonour reversal (4); manual JE validation — unbalanced 422, header account 422, unknown account 404, OPERATOR 403, KATCHI OWNER-only (5); period locks — OPERATOR 403, locked period rejects backdated JE 409 PERIOD_LOCKED, OWNER unlock vs ACCOUNTANT 403 (3); financial statements — trial balance balanced, balance sheet balanced, P&L shape (3); bad debt — OWNER write-off success + ACCOUNTANT 403 (2); credit notes — JE-05 posts and reduces invoice balance, OPERATOR 403 (2); GL running-balance arithmetic (1) — count updated to **81 CoA accounts** post-8B

### Phase 8B Tests
- `apps/api/src/modules/fixed-assets/__tests__/depreciation-calc.unit.test.ts` — 11 tests (isPeriodActive boundary cases, SLM monthly calc, SLM throws without life, WDV monthly calc, WDV year-2 reduces, WDV throws without rate, residual floor cap, period-before-start zero)
- `apps/api/src/modules/fixed-assets/__tests__/fixed-asset-templates.unit.test.ts` — 7 tests (JE-12 balance, JE-13 routing COLD_PLANT→5040, BUILDING→6120, JE-14 case A break-even, case B gain→4230, case C loss→6110, scrap zero-proceeds full loss)
- `apps/api/src/modules/fixed-assets/__tests__/fixed-asset.integration.test.ts` — 13 tests (purchase + JE-12 posted, SLM rejects without life, OPERATOR 403, ACCOUNTANT lists, commission PURCHASED→IN_SERVICE, double-commission 409, monthly run posts JE-13 batch, re-run same period DEPRECIATION_ALREADY_POSTED 409, dispose-gain posts 4230, dispose-loss posts 6110, period-lock rejects run 409, runs aggregation list, FA-YYYY-NNNN sequence increments)
- `apps/api/src/modules/payroll/__tests__/payroll-templates.unit.test.ts` — 6 tests (JE-15 zero-tax line omission, JE-15 with tax includes 2070, JE-15B 5030/5035 not 6010, JE-16 balance, JE-16B remit, JE-16B partial remit no tax)
- `apps/api/src/modules/payroll/__tests__/payroll-number.unit.test.ts` — 2 tests (PAY-YYYYMM-NNN format, prefix)
- `apps/api/src/modules/payroll/__tests__/payroll.integration.test.ts` — 14 tests (employee CRUD, OPERATOR 403, SALARIED requires basic_salary, snapshot DRAFT for active employees with EOBI 375/1875 totals, duplicate period 409, finalize SALARIED→JE-15 routes 6010, double-finalize 409, pay→JE-16 DR 2030/CR 1020, remit→JE-16B, finalize DAILY_WAGES→JE-15B routes 5030/5035, period lock rejects finalize, KATCHI MANAGER 403, line-item update recomputes totals, slip data endpoint)
- `apps/api/src/modules/expenses/__tests__/expense-templates.unit.test.ts` — 5 tests (JE-17A balance, JE-17B accrual to 2040, JE-17B-PAY no expense recognition, JE-17C single replenishment JE, petty-cash voucher routing 1010)
- `apps/api/src/modules/expenses/__tests__/expense.integration.test.ts` — 11 tests (DRAFT create EXP-YYYYMM-NNNN, OPERATOR 403, full DRAFT→APPROVED→PAID JE-17A, accrual path JE-17B then JE-17B-PAY, pay-without-approve 409, edit-after-approve 409, cancel DRAFT, petty-cash-replenish single JE, period lock rejects pay, KATCHI ACCOUNTANT 403, list filter + sequence increment)
- `apps/api/src/modules/peshgi/__tests__/peshgi-templates.unit.test.ts` — 3 tests (JE-18 balance with party tagging, JE-19 balance, JE-19 partial). **Phase 9 update: loan numbers now `L-YYMMDD-NNN`.**
- `apps/api/src/modules/peshgi/__tests__/peshgi.integration.test.ts` — **Rewritten in Phase 9** — 12 tests (issue with `L-YYMMDD-NNN` + JE-18, BANK_TRANSFER routes to 1020, OPERATOR 403, MANAGER repayment, ACCOUNTANT 403 on repayment, full repayment→`RECOVERED`, over-repayment 422, repayment on inactive 409, write-off JE-20 happy path, write-off non-OWNER 403, write-off already-closed 409, period lock 409, list filtering, JSON acknowledgment).

### Phase 9 Tests
- `apps/api/src/modules/peshgi/__tests__/peshgi-write-off-template.unit.test.ts` — 3 tests (JE-20 DR 6080 / CR 1140 balance with party tagging, fractional rounding, `L-YYMMDD-NNN` format / prefix sanity).
- `apps/api/src/modules/gate-pass/__tests__/gate-pass-number.unit.test.ts` — 3 tests (`GP-YYMMDD-NNNN` format with 4-digit pad, prefix excludes sequence, day rollover changes prefix).
- `apps/api/src/modules/gate-pass/__tests__/gate-pass.integration.test.ts` — 7 tests (SECURITY logs inward with GP-YYMMDD-NNNN + uppercase vehicle + ARRIVED, OPERATOR link-lot transitions to WEIGHING, SECURITY cannot link-lot 403, paid invoice → CLEARED with `turnaround_seconds > 0`, finalized-unpaid → 422 GATE_OUTWARD_BLOCKED, MANAGER credit_authorization clears, SECURITY credit_authorization 403 GATE_CREDIT_AUTH_REQUIRES_MANAGER, list active passes).
- `apps/api/src/modules/payment/payment.integration.test.ts` (combined-settlement section) — 4 tests (one payment splits 50k invoice + 100k loan, posts JE-19 once, loan→RECOVERED, balance_due=0; loan over-allocation 422 PESHGI_OVER_REPAYMENT; loan party mismatch 422 PAYMENT_PARTY_MISMATCH; allocating to WRITTEN_OFF loan 409 PESHGI_INACTIVE).

## Commands

```bash
# All tests
turbo test

# Unit tests only
turbo test:unit

# Integration tests only  
turbo test:integration

# Frontend tests
turbo test:web

# E2E tests
npx playwright test

# Coverage report
turbo test:coverage
```

## Coverage Targets

| Layer | Target | Tool |
|-------|--------|------|
| Service (business logic) | >80% | Vitest |
| API endpoints | 100% | Supertest + Vitest |
| Zod schemas | 100% | Vitest |
| UI components | >60% | React Testing Library |
| E2E workflows | 7/7 | Playwright |
| DB migrations | Up + down | Prisma CLI |
