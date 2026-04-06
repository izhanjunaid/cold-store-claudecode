# Phase 0: Project Foundation

**Objective**: Scaffold monorepo, configure tooling, create PostgreSQL foundation, implement custom JWT auth, build app shell.
**Branch**: `phase/00-foundation`

## Tasks

- [ ] 0.1 — Monorepo Scaffold (Turborepo): apps/web, apps/api, packages/shared, packages/db, packages/ui
- [ ] 0.2 — TypeScript & Tooling: TS strict, ESLint, Prettier, .editorconfig, .gitignore, .nvmrc
- [ ] 0.3 — CI Pipeline: GitHub Actions (lint, type-check, test, build)
- [ ] 0.4 — Prisma Setup + PostgreSQL Connection
- [ ] 0.5 — Foundation Migration `0001_foundation`: facilities, users, audit_log, refresh_tokens, RLS, audit trigger
- [ ] 0.6 — Seed: Default Facility + Owner User
- [ ] 0.7 — Fastify Server Bootstrap: plugins, X-Facility-ID, error envelope, /health
- [ ] 0.8 — Zod Validation Infrastructure: fastify-type-provider-zod, shared schemas
- [ ] 0.9 — Custom JWT Auth: login/refresh/logout/me, bcrypt, lockout, role guards
- [ ] 0.10 — Next.js App Shell: S-01 Login, S-02 Layout (sidebar, topbar, book_type toggle)
- [ ] 0.11 — Testing Infrastructure: Vitest, Supertest, RTL, test DB, helpers

## Definition of Done
- Monorepo builds (`turbo build`)
- CI green
- PostgreSQL has foundation tables with RLS
- Auth endpoints work (login returns JWT, /me returns user, expired→401, wrong role→403)
- Login screen renders and authenticates
- App shell displays sidebar/topbar
- 5+ auth tests pass
- Seed data loads
