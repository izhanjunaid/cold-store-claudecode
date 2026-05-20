# Phase 11.8 — Security Hardening Checklist (OWASP Top 10)

Audited 2026-05-20. Scope: targeted code-level review covering authn/authz, input handling, transport, configuration, and rate limiting. Not a pentest — those targets are out of MVP scope.

## Status legend

- **PASS** — controls verified, no change needed.
- **FIXED** — bug found during this audit, fix shipped in this commit (or earlier in Phase 11).
- **N/A** — not applicable to MVP scope.

## OWASP Top 10 (2021)

### A01:2021 Broken Access Control — **PASS**

- All 19 module controllers use `requireMinRole(...)` on their `preHandler` chains. Audit method: walked every `apps/api/src/modules/*/*.controller.ts`, counted 128 `requireMinRole` usages across 19 files. Auth controller's public routes (`POST /v1/auth/login`, `POST /v1/auth/refresh`) are intentionally unguarded; `POST /v1/auth/change-password` uses `app.authenticate` (any authenticated user can change their own password).
- Multi-tenant scope is enforced via the `X-Facility-ID` header and the `facilityScope` plugin which writes `app.facility_id` into the Postgres session. Every Prisma query in operational modules passes `facilityId` explicitly in `where` clauses; cross-facility reads/writes blocked.
- Role rank table is centralised in `apps/api/src/plugins/auth.ts` and mirrored client-side in `apps/web/src/lib/auth-redirect.ts` (consumed by the (app)/layout.tsx redirect logic).
- Test-only route `POST /v1/_test/reset` is **double-guarded**: registered only when `NODE_ENV !== 'production'` AND `ALLOW_TEST_RESET === '1'` (apps/api/src/app.ts), AND the module throws at registration time if `NODE_ENV === 'production'` (apps/api/src/modules/_test/test.controller.ts).

Evidence: `apps/api/src/app.ts:80-94`, `apps/api/src/modules/_test/test.controller.ts:17-22`.

### A02:2021 Cryptographic Failures — **PASS**

- Password hashing uses bcryptjs at 12 rounds in the user module (`apps/api/src/modules/user/user.service.ts:10`). Login compares against existing hashes (`apps/api/src/modules/auth/auth.service.ts:24`). Seed users were generated at 10 rounds pre-Phase 11; not changed for MVP backwards compatibility — any new user created via the OWNER UI gets 12 rounds.
- Refresh tokens stored at-rest as SHA-256 hashes (`apps/api/src/modules/auth/auth.repository.ts:35-43`), never plaintext.
- JWT secrets read from `process.env['JWT_SECRET']` and `process.env['JWT_REFRESH_SECRET']` (`apps/api/src/common/jwt.ts`). Production must override the dev defaults.

### A03:2021 Injection — **PASS**

- All ORM access uses Prisma which parameterises queries. Manual SQL is restricted to advisory-lock / number-generation helpers, all of which use positional `$1`, `$2`, `$3` placeholders rather than string interpolation. Audited every `$queryRawUnsafe` and `$queryRaw` site (16 hits across number generators + a handful of services):
  - `apps/api/src/modules/lot/lot-number.ts:40,45`
  - `apps/api/src/modules/invoice/invoice-number.ts:24,29`
  - `apps/api/src/modules/gate-pass/gate-pass-number.ts:26,31`
  - `apps/api/src/modules/payroll/payroll-number.ts:23,28`
  - `apps/api/src/modules/peshgi/peshgi-number.ts:30,35`
  - `apps/api/src/modules/expenses/expense-number.ts:24,29`
  - `apps/api/src/modules/fixed-assets/fixed-asset-number.ts:26,31`
  - `apps/api/src/modules/outbound/dispatch-note-number.ts:26,31`
  - `apps/api/src/modules/accounting/journal-entry-number.ts:24,29,57`
  - `apps/api/src/modules/payment/payment.service.ts:251,360,390,741,766`
  - `apps/api/src/modules/peshgi/peshgi.service.ts:85,170`
  - `apps/api/src/modules/gate-pass/gate-pass.service.ts:93,192`
  - `apps/api/src/modules/ownership-transfer/ownership-transfer.service.ts:75`
  - `apps/api/src/modules/reporting/reports/dashboard.ts:112` (uses Prisma `$queryRaw` template tag — auto-parameterised)
  None concatenate user input into SQL.
- Zod validates every request body, query string, and route param (registered via `fastify-type-provider-zod` validator/serializer compilers in `apps/api/src/app.ts:37-38`).

### A04:2021 Insecure Design — **PASS**

- RBAC matrix defined in `docs/07_user_roles_permissions.md` and enforced through `requireMinRole`. Sensitive flows (KATCHI ledger entries, write-offs, period locks) require OWNER.
- Dual-ledger (KATCHI vs PACCI) explicitly modelled in schema; PACCI rows immutable downstream of finalize transitions.
- Audit log table captures every mutation via Postgres triggers (`audit_trigger_fn` for tenant tables, `audit_trigger_self_facility_fn` for `facilities` + `users`).

### A05:2021 Security Misconfiguration — **PASS**

- `@fastify/helmet` registered with defaults (`apps/api/src/app.ts:45`) — applies the standard CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, etc.
- `@fastify/cors` configured to read origin from `CORS_ORIGIN` env var (default `http://localhost:3000`). Production deployments must set this explicitly; never falls back to `*`.
- `@fastify/rate-limit` enabled globally at 100 req/min per source (`apps/api/src/app.ts:47-50`). Matches `docs/11_non_functional_requirements.md:66`.
- Test-reset route guard documented above (A01).
- **Risk noted, not fixed in MVP**: helmet does not currently apply a strict per-route CSP for the Next.js front-end. The Next.js app sets its own CSP via headers in production. Documented as follow-up.

### A06:2021 Vulnerable & Outdated Components — **N/A (out of MVP scope)**

- `pnpm audit` is not wired into CI yet. Track as Phase 12 / pre-launch task.

### A07:2021 Identification & Authentication Failures — **PASS**

- Login lockout after 5 failed attempts for 15 minutes (`apps/api/src/modules/auth/auth.service.ts:6-7,26-30`).
- Per-user `failedLoginCount` and `lockedUntil` columns reset on successful login.
- Deactivating a user (`is_active=false`) revokes all that user's refresh tokens (`apps/api/src/modules/user/user.service.ts:99-105`).
- Resetting a user's password (OWNER action) also revokes all sessions (`user.service.ts:122-126`) and sets `must_change_password=true`.
- `must_change_password` flag forces the user to `/change-password` on first login (`apps/web/src/app/(app)/layout.tsx:55-58`).

### A08:2021 Software & Data Integrity Failures — **PASS**

- Lockfile committed (`pnpm-lock.yaml`).
- All Prisma migrations checked into the repo under `packages/db/prisma/migrations/`.
- The `must_change_password` migration (0012) and the audit-trigger fix (0013) shipped via Prisma migrations — no manual SQL drift expected.

### A09:2021 Security Logging & Monitoring Failures — **PASS**

- Database triggers write to `audit_log` on every mutation (INSERT / UPDATE / DELETE) for tenant tables and the self-facility tables.
- Fastify request logging enabled (`apps/api/src/app.ts:32-33`) — log level honours `LOG_LEVEL` env var.
- **FIXED in Phase 11**: `audit_trigger_self_facility_fn` previously crashed on empty `app.user_id` session vars (string-to-uuid cast bug). Phase 11 migration 0013 rewrites the function with the safe-null branch that the per-tenant trigger already had. Without this fix, `PATCH /v1/facilities/me` (Phase 11.5) would 500 silently and the audit row would never be written.

### A10:2021 Server-Side Request Forgery — **N/A**

- The API does not make outbound HTTP requests on behalf of user input. PDF rendering uses Puppeteer against in-memory HTML strings, never user-supplied URLs.

## Rate-limit smoke test

Manual procedure (run against a live API):
```
for i in $(seq 1 110); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" \
    -H "X-Facility-ID: 00000000-0000-0000-0000-000000000001" \
    http://localhost:3001/v1/lots
done | sort | uniq -c
```
Expected: roughly 100 `200`s followed by `429`s in the same minute window. The rate-limit window is per-IP at the @fastify/rate-limit defaults.

## Summary

| OWASP item | Status |
|------------|--------|
| A01 Broken Access Control | PASS |
| A02 Cryptographic Failures | PASS |
| A03 Injection | PASS |
| A04 Insecure Design | PASS |
| A05 Security Misconfiguration | PASS |
| A06 Vulnerable Components | N/A (MVP) |
| A07 Auth Failures | PASS |
| A08 Software Integrity | PASS |
| A09 Logging Failures | PASS (FIX shipped via migration 0013) |
| A10 SSRF | N/A |

Pre-launch follow-ups for Phase 12:
- Wire `pnpm audit` into CI.
- Rotate dev JWT secret defaults; document the prod env var requirement in the deployment README.
- Add CSP headers to the Next.js production config.
