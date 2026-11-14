# CLAUDE.md

Guidance for Claude Code in this repository. This file is the short core that every session loads. Area detail (the why, the history, the exact helpers) lives in `.claude/rules/*.md` and loads by itself when a matching file is read or edited.

## Project Overview

**ColdChain** is an operational management platform for agricultural cold storage facilities in Pakistan's mandi (wholesale market) supply chain. One facility in Lahore runs it in production. The system is fully built and in production-hardening.

- **`PROGRESS.md` is the live source of truth** for the current phase, active task and blockers. Read only its `## Current Status` section (the first ~245 lines; the file is 150 KB). **`TESTING.md`** has the test strategy and live pass counts.
- `docs/01-15` are the original design spec and remain the reference for intent. Later docs record audits and features as built (see the map below).

## Architecture (as built)

- **Monorepo**: `apps/api` (Fastify, port 3001), `apps/web` (Next.js, port 3000), `packages/db` (Prisma schema + migrations), `packages/shared` (Zod schemas/types shared by api + web). The shadcn components live in `apps/web/src/components/ui`; `packages/ui` is an empty stub.
- **Layered backend**: Controllers → Services → Repositories → Prisma, by domain under `apps/api/src/modules/<domain>/`.
- **Multi-tenant**: every table namespaced by `facility_id`; requests scoped via the `X-Facility-ID` header.
- **Audit-first**: append-only `audit_log`; DB triggers also make posted journal entries and financial tables immutable.
- **Dual ledger**: `book_type` enum. KATCHI is mutable informal records (write: OWNER only, read: MANAGER+). PACCI is immutable official records and the default everywhere.
- **REST API**: all endpoints under `/v1/`.
- **RBAC roles**: OWNER, MANAGER, ACCOUNTANT, OPERATOR, SECURITY (`docs/07_user_roles_permissions.md`).

## Rules that apply everywhere

Each line is the rule; the named rule file has the reasons and the detail. Read the rule file before working in its area if it has not loaded.

**Naming**
- **"Room" in the UI = `chamber` in code, DB and API.** Only labels changed: routes stay `/v1/chambers`, the model stays `Chamber`, settings keys stay `chamber_*`. Racks live in `racks` / `lot_rack_placements` / `lot_movements`. A lot's bags may span several racks of its room, unallocated bags are "Unplaced", rack capacity only warns (hard capacity is at room level), and inter-room moves are whole-lot only (`Lot.chamberId` is authoritative).

**API** (`.claude/rules/api.md`)
- Guard routes with `app.requirePermission('<key>')` (registry: `packages/shared/src/permissions.ts`), never `requireMinRole(` (fails CI). A few fixed seniority rules stay outside the matrix and use `roleAtLeast`: KATCHI, backdating, and the gate's manager controls. Web gates with `can(user, key)`.
- Advisory locks only through `advisoryXactLock()` (`apps/api/src/common/advisory-lock.ts`); a raw `pg_advisory_*` fails CI. In a concurrency test, assert the loser.
- Raw SQL never touches a row-level-secured table (`users`, `facilities`, `refresh_tokens`, `audit_log`, `otp_codes`); read those through model queries. The integration suite runs as the table owner and cannot show the failure.
- Server "today" is `businessDate()` (Asia/Karachi, `packages/shared/src/fiscal.ts`), never `setHours(0,0,0,0)` or `toISOString().slice(0,10)`. Web form defaults use `localIsoDate()`. Plates compare through `normalizePlate()`.

**Dispatch and the gate** (`.claude/rules/dispatch-gate.md`)
- **The gate guard (SECURITY) counts blind.** Any new response field carrying bags, a weight or an amount owed on a truck must be added to `BLIND_KEYS` (`apps/api/src/common/blind-count.ts`), and no error the guard can trigger may spell such a figure out. Web renders these with `formatCount()` / `formatKg()`.
- Anything that takes bags off a lot subtracts `openReservation()`. Lock order everywhere: gate_passes → outbound_events → lots → placements.
- A truck is its plate and its load is `openLoads()`; write no other plate query. Bills price through `invoiceTotals()`.
- **Weight is optional everywhere; never make it required again.** Read a lot's weight only through `recordedKg()`; what may be dispatched is `isReadyToDispatch()`.
- Credit at the gate is `standingCreditCover()`; solo dispatch rules are `soloRefusal()`. Never fix a munshi refusal by granting `outbound.finalize` / `invoices.manage` / `payments.record`.

**Accounting** (`.claude/rules/accounting.md`)
- One of everything, never re-derived: account codes only in `SYSTEM_ACCOUNTS`; post only through `JournalEntryService.postInTransaction`, reverse only through `reverseInTransaction`; statements read `modules/accounting/ledger.ts`; receivables post to the party's `control_account_code`.
- Test cleanup that touches posted financial rows wraps with `withGuardsDisabled`, in `afterAll` only.

**Database, updates and releases** (`.claude/rules/database-release.md`)
- Real migrations are in `packages/db/prisma/migrations/`. `packages/db/migrations/` is a legacy leftover; add nothing there.
- **Releases are expand-only**: new columns nullable or defaulted, each `ALTER TYPE … ADD VALUE` alone in its file, constraints `NOT VALID` first, drops wait one release.
- Anything a release must do to a client database goes in `packages/db/prisma/deploy.ts`, never a hand-run script. `syncChartOfAccounts()` is INSERT-only.
- `docker-compose.yml`, `Caddyfile`, `scripts/app-role.sql` and `update.ps1` ship inside the api image and are a matched pair with it; a rollback reverts both.
- **Trunk is `main` (protected).** Branch → PR → CI green → squash merge → tag `vX.Y.Z` → **Promote to stable** workflow. Client boxes track `:stable` only; `:latest` must never point at a facility.
- **CI gates `pnpm build` and the integration suite, not just unit tests.** Run `pnpm build` before calling work done: only `next build` catches a `page.tsx` that exports more than `default` and metadata.

**Web** (`.claude/rules/web.md`)
- Never run `next build` while `next dev` is up for the same app: they share `apps/web/.next/` and the build blanks the dev server. Recover with `rm -rf apps/web/.next` and restart.
- Every PDF opens through `openPdf()` (`apps/web/src/lib/open-pdf.ts`), with the tab opened before any `await`. `NEXT_PUBLIC_API_URL` is read with `??`, never `||`.
- If `node_modules` is hollow after a build on Windows (`Cannot find module 'next/dist/...'`), repair with `pnpm install --frozen-lockfile --force`.

**Branches and worktrees**
- Confirm the branch first (`git branch --show-current`). Squash-merged branches are deleted, so `git branch -r` shows only what is live.
- `ui-revamp/04-operations` is the one unmerged UI-revamp module (one commit ahead of `main`, no open PR). Module `05` (admin/settings/auth) has no commits: start it from `main`.
- Create worktrees **outside** the repo (`git worktree add C:\wt\cold-store-<name> <branch>`), never under `.claude/worktrees/`. Remove them with `cmd /c rmdir /s /q`, not PowerShell `Remove-Item -Recurse` (it follows pnpm junctions).

## Modules

| # | Module | What it does |
|---|--------|-------------|
| M1 | Party Management | Farmers, traders, arhtis, buyers — profiles, credit limits, ledgers |
| M2 | Inbound & Lot | Produce intake, lot creation, weigh-in, room assignment, storage receipt |
| M3 | Ownership Transfer | Mid-storage ownership changes (full/partial) with chain history |
| M4 | Outbound & Dispatch | Withdrawals, weigh-out, invoices, dispatch notes |
| M5 | Billing Engine | Configurable rates and tariffs, service charges, invoices |
| M6 | Quality & Spoilage | Inspections, damage records, lot quantity adjustments |
| M7 | Financial Ledger | AR/AP, payments, receivables aging, credit limits, full accounting |
| M8 | Chamber Management | Rooms and racks, capacity, occupancy |
| M9 | Reporting | Dashboards, aging, inventory, financial statements |
| M10 | Gate Pass | Vehicle inward/outward logging linked to operations |
| M11 | Peshgi (Loans) | Cash advances to farmers/arhtis and automated recovery |

## Documentation Map (`docs/`)

| File | Contents |
|------|---------|
| `01`–`05` | Domain exploration, scope, PRD, BRD, functional specs |
| `06_system_architecture.md` | Tech stack, logical/deployment architecture |
| `07_user_roles_permissions.md` | RBAC roles and permission matrix |
| `08_data_model.md` | Schema — entities, relationships, indexes, constraints |
| `09_accounting_spec.md` | Chart of accounts, journal entry patterns, dual ledger rules |
| `10_api_design.md` | REST API spec, error codes, examples |
| `11`–`14` | Non-functional requirements, E2E workflows, screen inventory, state machines |
| `15`–`19` | Accounting audit rules, then the audits and remediations of phases 13–21 (employee advances in `19`) |
| `20_audit_backlog.md` | Audit backlog; the Phase 29 pre-update queries |
| `21`, `22` | Chart-of-accounts hardening (phase 23); extensible statements (phase 24) |
| `23_client_rollout_v0.4.0.md` | Client rollout and the update pipeline |
| `24_ui_density_spec.md` | UI density spec for the UI revamp |
| `25_accounting_consolidation.md` | Final accounting audit and fix program: 136 findings, owner decisions, the invariants the code follows (§2), what was deliberately left (§10) |
| `26_fast_dispatch.md` | Fast dispatch (v0.8.0): owner decisions D1–D4, the owner switches, upgrade notes |
| `27_weight_optional.md` | Weight optional everywhere |
| `28_c3.md` | Gate safety, papers (PDF tabs), the managers' waiting list, Allow; owner decisions, known limits |

## Domain Terminology

| Term | Meaning |
|------|---------|
| **Mandi** | Agricultural wholesale market |
| **Arhti** | Commission agent / middleman in mandi trade |
| **Munshi** | The desk clerk who books withdrawals and dispatches trucks |
| **Peshgi** | Informal cash advance/loan given to farmers or arhtis |
| **Katchi** | Informal/rough ledger (mutable records) |
| **Pacci** | Official/final ledger (immutable records) |
| **Parchi** | Storage receipt given at inbound |
| **Chamber** | Refrigerated storage room ("Room" on screen) |
| **Lot** | A discrete batch of produce from one party, tracked through its lifecycle |
| **Marka** | Identification mark painted or stamped on a lot's sacks or crates. Not unique; does not change on ownership transfer |

## graphify

A knowledge graph of this codebase is at `graphify-out/` (generated, not in git).

- For codebase questions, when `graphify-out/graph.json` exists, first run `graphify query "<question>"`. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for one concept.
- Read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review, or when the commands above do not surface enough.
- After modifying code, run `graphify update .` (AST-only, no API cost; about 2.5 minutes, run it detached).
