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

### Phase 0 Tests
- `apps/api/src/common/jwt.test.ts` — 4 tests (sign/verify access & refresh tokens)
- `apps/api/src/common/errors.test.ts` — 5 tests (AppError, error factories)
- `apps/web/src/stores/auth.store.test.ts` — 5 tests (Zustand auth store)
- `apps/api/src/modules/auth/auth.integration.test.ts` — 13 tests (health, login, me, refresh, logout)

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
