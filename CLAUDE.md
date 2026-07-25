# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**ColdChain** is an operational management platform for agricultural cold storage facilities integrated into Pakistan's mandi (wholesale market) supply chain. MVP targets a single facility in Lahore. The system is **fully implemented and in production-hardening**: 13 development phases have shipped (party/chamber, inbound/lots, ownership transfer, outbound/dispatch, billing, financial ledger, full accounting, gate pass/peshgi, reporting, admin/polish, configurability, production deployment + accounting audit remediation). `docs/01-15` are the original design spec and remain the reference for intent; `docs/16` is a post-implementation audit. **`PROGRESS.md` is the live source of truth for current phase, active task, and blockers — read it before assuming what is or isn't built. `TESTING.md` has test strategy and live pass counts.**

## Tech Stack (as built)

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router) + React + shadcn/ui + Tailwind CSS, Zustand + TanStack Query |
| Backend | Node.js 20 + Fastify 5 + TypeScript, Zod validation on all request/response boundaries (`fastify-type-provider-zod`) |
| Database | PostgreSQL 15 + Prisma ORM, versioned migrations, DB-level audit/integrity triggers |
| PDF | Puppeteer + Handlebars templates |
| Auth | Custom JWT (access + refresh) + bcrypt, role-based guards |
| Monorepo | Turborepo + pnpm workspaces |
| Testing | Vitest (unit/integration), Playwright (E2E), React Testing Library |
| Deployment | Docker Compose (postgres, migrate, api, web) behind Caddy — see `docker-compose.yml`, `Caddyfile`, `INSTALL.md` |

## Commands

```bash
pnpm install                 # install all workspace deps
pnpm dev                     # turbo dev — api on :3001, web on :3000
pnpm build                   # turbo build
pnpm typecheck               # turbo typecheck
pnpm lint                    # turbo lint

pnpm test                    # turbo test (unit + integration, all packages)
pnpm test:unit
pnpm test:integration
pnpm e2e                     # Playwright; auto-spawns both dev servers with ALLOW_TEST_RESET=1
pnpm e2e:ui                  # Playwright inspector

pnpm --filter @coldchain/db db:migrate   # prisma migrate dev
pnpm --filter @coldchain/db db:seed
pnpm --filter @coldchain/db db:studio
```

## Architecture (as built)

- **Monorepo layout**: `apps/api` (Fastify, port 3001), `apps/web` (Next.js, port 3000), `packages/db` (Prisma schema + migrations), `packages/shared` (Zod schemas/types shared by api+web), `packages/ui` (shared shadcn component library, ~126 components)
- **Layered backend**: Controllers → Services → Repositories → Prisma, organized by domain under `apps/api/src/modules/<domain>/`
- **Multi-tenant**: every table namespaced by `facility_id`; requests scoped via `X-Facility-ID` header
- **Audit-first**: append-only `audit_log`; DB-level triggers additionally enforce immutability on posted journal entries and financial tables (see Gotchas)
- **Dual ledger**: `book_type` enum (`KATCHI` vs `PACCI`) — KATCHI is mutable informal records (write: OWNER only, read: MANAGER+), PACCI is immutable official records and the default everywhere
- **REST API versioned**: all endpoints under `/v1/`
- **RBAC roles**: OWNER, MANAGER, ACCOUNTANT, OPERATOR, SECURITY (see `docs/07_user_roles_permissions.md`)

## Gotchas

- **"Room" in the UI = `chamber` in code/DB/API.** Phase 14 restructured chambers as Rooms containing Racks, but only user-facing labels changed — routes stay `/v1/chambers`, the Prisma model stays `Chamber`, and settings keys stay `chamber_capacity_warning_pct`. Racks live in `racks` / `lot_rack_placements` / `lot_movements` (migration 0005): a lot's bags may span several racks of its room, unallocated bags are "Unplaced", rack capacity only warns (hard capacity stays at room level), and inter-room moves are whole-lot only (single `Lot.chamberId` FK is authoritative).

- **Route authorization is the permission matrix, not `requireMinRole`.** Phase 15 replaced the numeric role hierarchy with an owner-configurable 42-key registry (`packages/shared/src/permissions.ts`); guard routes with `app.requirePermission('<key>')` (CI fails on any `requireMinRole(` in `apps/api/src/modules`). Each key's `defaultMinRole` mirrors the old threshold, so defaults are behaviour-identical. A few controls stay fixed seniority rules **outside** the matrix and still use `roleAtLeast` (`apps/api/src/plugins/auth.ts`): KATCHI read/write, backdating/third-party release, gate-pass credit auth. Owner overrides live in the hidden `settings.permissions` key (with `notifications_state`) — both stripped from facility responses. Web gates with `can(user, key)` (`apps/web/src/lib/permissions.ts`); `hasMinRole` survives only for the KATCHI toggles.

- **Advisory locks must go through `advisoryXactLock()`** (`apps/api/src/common/advisory-lock.ts`). Prisma's `$queryRaw` cannot deserialise `void`, so `SELECT pg_advisory_xact_lock(...)` throws — and the workaround that was used everywhere, `SELECT 1 AS _lock WHERE pg_advisory_xact_lock(...) IS NOT NULL OR TRUE`, **acquires no lock at all**: PostgreSQL folds the `OR TRUE` and never evaluates the call. Every document-number generator used it, so numbering was protected only by its unique constraints (phase/20 fixed all ten). CI fails on any raw `pg_advisory_*` outside the helper. When writing a concurrency test, **assert the loser** — the lot-number test asserting "all 5 concurrent creates succeed" stayed green throughout the years the lock did nothing.

- **Financial guard triggers** (Prisma migration `0002_financial_audit_and_integrity_guards`) enforce ledger/JE immutability at the DB level. Integration test cleanup that deletes or updates posted financial rows must wrap with `withGuardsDisabled` or the trigger will reject it.
- **Two migration-looking directories exist under `packages/db`**: `prisma/migrations/` is the real, active Prisma migration history — use it. `migrations/` contains a single legacy `0001_foundation.sql` from before Prisma Migrate was adopted; don't add new migrations there.
- **E2E requires test-mode flags**: the API must run with `ALLOW_TEST_RESET=1` and non-production `NODE_ENV` for `POST /v1/_test/reset` to work. `pnpm e2e` sets this up automatically — no manual server launch needed.
- **Branch model**: development proceeds on sequential `phase/NN-*` branches (see `PROGRESS.md` for the active one), plus longer-lived parallel lines for the UI re-platform (`redesign/ui-replatform`) and accounting rework (`feat/world-class-financials`) — both checked out as git worktrees under `.claude/worktrees/`. Confirm the current branch (`git branch --show-current`) before starting work; several lines of development coexist.

## Modules (11)

| # | Module | What it does |
|---|--------|-------------|
| M1 | Party Management | Farmers, traders, arhtis, buyers — profiles, credit limits, ledgers |
| M2 | Inbound & Lot | Produce intake, lot creation, weigh-in, chamber assignment, storage receipt |
| M3 | Ownership Transfer | Mid-storage ownership changes (full/partial) with complete chain history |
| M4 | Outbound & Dispatch | Withdrawals, weigh-out, invoice generation, dispatch notes |
| M5 | Billing Engine | Configurable rates (seasonal/monthly/daily per bag), service charges, invoices |
| M6 | Quality & Spoilage | Inspections, damage records, lot quantity adjustments |
| M7 | Financial Ledger | AR/AP, payment recording, receivables aging, credit limit enforcement |
| M8 | Chamber Management | Physical chamber tracking, capacity, occupancy |
| M9 | Reporting | Dashboards, aging reports, commodity inventory, financial summaries |
| M10 | Gate Pass | Security — vehicle inward/outward logging linked to operations |
| M11 | Peshgi (Loans) | Informal cash advances to farmers/arhtis and automated recovery |

## Documentation Map (`docs/`)

| File | Contents |
|------|---------|
| `01_domain_exploration.md` | Mandi ecosystem actors, produce lifecycle, pain points |
| `02_scope_definition.md` | MVP boundaries, in/out of scope, module list |
| `03_PRD.md` | Product requirements, personas, 80+ feature specs, success metrics |
| `04_BRD.md` | Business requirements and stakeholder needs |
| `05_functional_specs.md` | Feature-by-feature functional breakdown |
| `06_system_architecture.md` | Tech stack, logical/deployment architecture, component design |
| `07_user_roles_permissions.md` | RBAC roles and permission matrix |
| `08_data_model.md` | Database schema — entities, relationships, indexes, constraints |
| `09_accounting_spec.md` | Chart of accounts, journal entry patterns, dual ledger rules |
| `10_api_design.md` | RESTful API spec — 19 endpoint groups, error codes, examples |
| `11_non_functional_requirements.md` | Performance (<500ms API), security (OWASP), availability (99.5%) |
| `12_e2e_workflows.md` | End-to-end user workflows across modules |
| `13_screen_inventory.md` | UI/UX screens to build |
| `14_state_machines.md` | Status transitions for lots, invoices, transfers |
| `15_accounting_audit.md` | Audit trail and reconciliation rules |
| `16_accounting_module_audit.md` | Post-implementation accounting audit (2026-07-06/07) — findings + remediation status |
| `17_accounting_audit_phase19.md` | Second accounting audit (2026-07-24/25, phase/19) — CoA, opening balances, statements, payments/invoices/peshgi; 17 findings + fixes |
| `18_accounting_remediation_phase20.md` | Third audit + remediation (2026-07-25, phase/20) — payroll, fixed assets, cash/cheque, tax, expenses, concurrency; the advisory-lock defect; cost-side reversal |

## Domain Terminology

| Term | Meaning |
|------|---------|
| **Mandi** | Agricultural wholesale market |
| **Arhti** | Commission agent / middleman in mandi trade |
| **Peshgi** | Informal cash advance/loan given to farmers or arhtis |
| **Katchi** | Informal/rough ledger (mutable records) |
| **Pacci** | Official/final ledger (immutable records) |
| **Parchi** | Storage receipt given at inbound |
| **Chamber** | Refrigerated storage room within the cold store |
| **Lot** | A discrete batch of produce from one party, tracked through its lifecycle |
| **Marka** | Identification mark (name/initials/symbol) painted or stamped on a lot's bardana (gunny sacks) or crates so operators and security can tell whose stack is whose. Not unique; does not change on ownership transfer |

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
