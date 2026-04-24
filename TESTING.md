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
