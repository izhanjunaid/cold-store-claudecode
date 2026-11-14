---
paths:
  - "packages/db/**"
  - ".github/**"
  - "scripts/**"
  - "*.ps1"
  - "*.bat"
  - "docker-compose.yml"
  - "Caddyfile"
  - "**/Dockerfile"
---

# Database migrations, client updates, CI and releases

## Migrations and `deploy.ts`

- **Everything a release needs done to a client's database goes in `packages/db/prisma/deploy.ts`** — never a new hand-run backfill script. That file is what the compose `migrate` one-shot runs (`db:deploy`), and it is the only thing standing between a client box and a permanently wedged migration history: it adopts the phase-13 baseline on pre-rebaseline boxes, clears failed migrations (a single failure otherwise blocks every future update with P3009, forever), runs `migrate deploy`, then calls `syncChartOfAccounts()` to insert accounts the release introduced. New account codes need only a `CHART_OF_ACCOUNTS` entry — the three `backfill-*.ts` scripts this replaced were never run by any updater, so boxes migrated cleanly and then failed at runtime on a missing account. `syncChartOfAccounts` is INSERT-only by design: owners rename and re-parent their own accounts, so it must never upsert.
- **Releases are expand-only.** The old image keeps running against the migrated database until the swap, and after any failed update.
  - New columns are nullable, defaulted, or filled by a trigger.
  - Each `ALTER TYPE … ADD VALUE` sits alone in its own migration file.
  - New constraints are added `NOT VALID`, then validated only where the existing data passes (otherwise a warning, never a failed deploy).
  - Drops wait one release. Migration 0035 (v0.6.1) is the one exception and not a precedent: no facility ever ran v0.6.0, because the client was reinstalled fresh on v0.6.1 (docs/25 §10).
  - `deploy.ts` records every run in `deploy_runs`, and Settings → Software shows a failed one. A failure after the migrations have applied leaves nothing pending, so the migration count cannot show it.
- **Two migration-looking directories exist under `packages/db`**: `prisma/migrations/` is the real, active Prisma migration history — use it. `migrations/` contains a single legacy `0001_foundation.sql` from before Prisma Migrate was adopted; don't add new migrations there.
- **Financial guard triggers** (migration `0002_financial_audit_and_integrity_guards`) make posted journal entries and financial tables immutable at the DB level; see `.claude/rules/accounting.md`.

## The client updater

- **The updater runs migrations BEFORE swapping app containers** (`compose run --rm migrate`, then `up -d`). There is exactly one: `update.ps1`, run nightly by a Scheduled Task — Windows is the client platform, and `install.ps1` delegates to it so first install and update share one code path. The parallel Linux scripts (`bootstrap.sh`, `update.sh`, `provision-client.sh`, `backup.sh`, `restore.sh`) were **deleted**: nothing ever invoked them, no Linux box exists, and keeping them meant writing every deployment fix twice with only one copy ever tested. Ad-hoc backup/restore is `backup.ps1` (or double-click `backup.bat`) and `restore.ps1`. A database that can't be updated leaves the previous version running instead of taking the store offline. `docker-compose.yml`, `Caddyfile`, `scripts/app-role.sql` and `update.ps1` ride inside the api image and are extracted with `docker cp` on each update, so changing them reaches clients — but they are a **matched pair with the image**, and every rollback path must revert both together (an old api image has no `db:deploy` script, so a new compose file plus an old image never starts). Client boxes track `:stable`, moved only by the manual `promote.yml` workflow; `:latest` moves on every CI release and must not be pointed at a live facility.

## Trunk, CI and releases

- **Trunk is `main`; releases are tag-then-promote.** Branch from `main` → PR → CI green → merge → `git tag vX.Y.Z main && git push origin vX.Y.Z` (that publishes `:vX.Y.Z` + `:latest` and smoke-tests the images) → run the **Promote to stable** workflow, which retags by digest. Client boxes track `:stable` only and pick it up that night; `:latest` moves on every release and must never point at a facility. `main` is protected — no direct pushes, `build-and-test` must pass. This exists because the default branch used to be `phase/00-foundation`, 164 commits behind: `workflow_dispatch` only fires from the default branch (so `promote.yml` was unrunnable) and `ci.yml`'s `main` triggers pointed at a branch that did not exist (so PR CI never ran).
- **CI gates the build and the integration suite, not just unit tests.** `pnpm test` is unit-only (`apps/api/vitest.config.ts` excludes `*.integration.test.ts`), so CI applies migrations via `db:deploy`, seeds, and runs `test:integration` separately — otherwise 530 accounting tests gate nothing. **`pnpm build` is not optional either: only `next build` enforces the App Router rule that a `page.tsx` may export nothing but `default` and its metadata members.** A helper exported for a colocated test kept CI red from phase/22 to phase/26 while typecheck and unit tests stayed green, and would have made a release publish nothing. `scripts/verify-migration-repair.sh` covers `deploy.ts`'s repair path, which no vitest suite can reach — it reproduces the wedged history first and fails if the failure stops reproducing.
- **CI guardrail scripts** (`scripts/`): `check-business-date.mjs`, `check-pdf-tabs.mjs`, `check-account-literals.mjs` (its allowlist only shrinks). CI also fails on `requireMinRole(` in `apps/api/src/modules` and on raw `pg_advisory_*` outside the helper.
- `scripts/package-client.ps1` builds the customer package; `CLAUDE.md`, `PROGRESS.md`, `TESTING.md` and `dist/SETUP-STEPS.md` are deliberately excluded from it.
