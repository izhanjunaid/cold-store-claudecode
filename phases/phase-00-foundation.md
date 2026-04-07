# Phase 0: Project Foundation

**Objective**: Scaffold monorepo, configure tooling, create PostgreSQL foundation, implement custom JWT auth, build app shell.
**Status**: COMPLETED
**Completed**: 2026-04-07

## Tasks

- [x] 0.1 — Monorepo Scaffold (Turborepo): apps/web, apps/api, packages/shared, packages/db, packages/ui
- [x] 0.2 — TypeScript & Tooling: TS strict, ESLint, Prettier, .editorconfig, .gitignore, .nvmrc
- [x] 0.3 — CI Pipeline: GitHub Actions (lint, type-check, test, build)
- [x] 0.4 — Prisma Setup + PostgreSQL Connection
- [x] 0.5 — Foundation Migration `0001_foundation`: facilities, users, audit_log, refresh_tokens, RLS, audit trigger
- [x] 0.6 — Seed: Default Facility + Owner User
- [x] 0.7 — Fastify Server Bootstrap: plugins, X-Facility-ID, error envelope, /health
- [x] 0.8 — Zod Validation Infrastructure: fastify-type-provider-zod, shared schemas
- [x] 0.9 — Custom JWT Auth: login/refresh/logout/me, bcrypt, lockout, role guards
- [x] 0.10 — Next.js App Shell: S-01 Login, S-02 Layout (sidebar, topbar)
- [x] 0.11 — Testing Infrastructure: Vitest, RTL, test helpers, integration tests

## Definition of Done — Verified
- [x] Monorepo builds (`turbo build`)
- [x] CI green
- [x] PostgreSQL has foundation tables with RLS
- [x] Auth endpoints work (login returns JWT, /me returns user, expired→401, wrong role→403)
- [x] Login screen renders and authenticates
- [x] App shell displays sidebar/topbar
- [x] 27 tests pass (9 unit API + 5 unit web + 13 integration)
- [x] Seed data loads

## Notes
- Fixed audit trigger bug: empty `app.user_id`/`app.facility_id` session vars now safely default to zeroed UUID instead of crashing on `''::uuid` cast
- Prisma schema uses `db push` (not managed migrations); SQL migration file in `packages/db/migrations/` is documentation + manual triggers/RLS
