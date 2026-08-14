# Phase 26 — Hands-off update pipeline

**Problem.** The client box (one facility, Windows, installed long ago and upgraded
across several versions) failed with a database migration error on *every* update
attempt. Three independent defects compounded:

1. **A pre-rebaseline box can never migrate again.** Phase 13 replaced migrations
   0001–0016 with `20260101000000_baseline`; `phase-13-production-deploy.md`
   ("Rebaseline impact") says existing databases must be baselined by hand with
   `prisma migrate resolve --applied`. Nothing ever did that on a client box. So
   `migrate deploy` runs the baseline's `CREATE TABLE`s against tables that already
   exist → `42P07` → the baseline is recorded **failed** → every later run aborts with
   **P3009** before touching anything. Permanently, and only a human with a Prisma CLI
   on the client's PC could clear it.
2. **New accounts shipped as hand-run scripts.** `backfill-1230/1025/6900.ts` were
   never invoked by any updater, so a box that migrated cleanly still broke at runtime
   on a missing account code.
3. **All the safety lived in the path clients don't use.** `scripts/update.sh` had the
   backup, health gate and rollback; `INSTALL.md` offered it as the *alternative* for
   "boxes with Git Bash/WSL". The real path — `install.bat` → `install.ps1` → a bare
   `compose up -d` — had none of it. And because `api` has
   `depends_on: migrate: service_completed_successfully`, a failed migration took the
   **whole app down** instead of leaving the working version running.
   (`update.sh` was broken too: its `compose up -d` was unguarded under `set -e`, so a
   migration failure exited *before* the rollback; and its rollback was dead code on a
   default install, where `COLDCHAIN_TAG=latest` made `PREV_TAG == NEW_TAG`.)

## What shipped

**`packages/db/prisma/deploy.ts` (new) — `pnpm --filter @coldchain/db run db:deploy`.**
The one thing a box runs against its database, idempotent, under a session advisory
lock (`::text`-cast pattern from `apps/api/src/common/advisory-lock.ts`):

1. *Repair history.* Schema present but no `_prisma_migrations` → adopt the baseline
   (the P3005 shape). Schema present, baseline recorded **failed**, and history carries
   migration names this image doesn't have → mark the baseline applied with one `UPDATE`
   (the row already holds the correct checksum). Rows with names *not* in the local
   migrations directory are the precise signal of a pre-rebaseline box — a fresh box
   whose baseline merely failed part-way has only the baseline row, and is correctly
   sent down the retry path instead. Any other unfinished migration →
   `resolve --rolled-back`, safe because PostgreSQL applies each Prisma migration in one
   transaction and none of ours contain a statement that can't run in one (no
   `CREATE INDEX CONCURRENTLY`; every `ALTER TYPE … ADD VALUE` sits alone in its own
   file — migrations 0012/0014/0016/0017 say so themselves).
2. `prisma migrate deploy`.
3. `syncChartOfAccounts()` per facility — replaces all three backfill scripts and every
   future one.

**`syncChartOfAccounts()`** (moved with `chart-of-accounts.ts` into `packages/db/src/`
so it's part of the built package and importable as `@coldchain/db`). **INSERT-only**:
owners rename and re-parent their own accounts, so upserting the whole array — what
`seedChartOfAccounts` does — would wipe their edits on every update. It inserts *every*
missing seeded code, not only `system: true` ones: account 1230, the one
`backfill-1230.ts` existed for, is `system: false`. The single non-insert is the narrow
6110→6900 re-parent, scoped to accounts still at the old parent `6000` and blocked by
`guard_chart_of_accounts` wherever 6110 carries postings.

**`update.ps1` (new) — the real updater.** Windows is the client platform, so this is
the product. Order is the fix:

```
docker up? → pull → refresh deploy files → app-role → backup → DB UPDATE → app-role → swap app → health gate
```

The database is updated by a one-shot container **before** api/web are replaced, so a
failed update costs a log line rather than the cold store's availability. Any failure
reverts the tag *and* the deploy files together. Deploy files
(`docker-compose.yml`, `Caddyfile`, `scripts/app-role.sql`, `update.ps1`) ride inside the
api image and are extracted with `docker cp` — not a PowerShell pipe — so a release can
change them without anyone shipping a new folder; a second `compose pull` follows in case
the refreshed file names different images. Backup dumps *and* gzips inside the container
and is copied out as a file, so PowerShell never touches the byte stream (it would mangle
Urdu party names); dumps are `--clean --if-exists` so `restore.sh` accepts them, and are
pruned on `BACKUP_RETENTION_DAYS`. Everything appends to `logs\update.log` — an
unattended run has no console, and a box that has quietly not updated for a month must be
distinguishable from a current one.

**`install.ps1`** now delegates download/DB/start/health to `update.ps1` (one update code
path), and registers a **Scheduled Task** running it nightly at 3am with
`-StartWhenAvailable`, in the installing user's context — Docker Desktop runs in a user
session, so a SYSTEM task at 3am with nobody logged in would find no Docker and do
nothing forever. Registration needs elevation; on failure it **warns and continues**
rather than failing the install.

**`:stable` + `.github/workflows/promote.yml` (new).** `release.yml` moves `:latest` on
every `v*` tag, so pointing boxes at it would push every CI build into a live cold store
the same night. Boxes track `:stable`, moved only by a manual `workflow_dispatch` that
retags published images by digest (`docker buildx imagetools create`, no rebuild).

**`scripts/update.sh`** mirrors the same sequence for Linux boxes: bundle refresh,
`compose run --rm migrate` before `up -d`, and a `revert_all()` that puts the tag and the
deploy files back **together** — reverting one without the other is worse than reverting
neither, since an old api image has no `db:deploy` script and the migrate one-shot would
never complete, leaving `service_completed_successfully` permanently unsatisfied.

**Deleted:** `packages/db/prisma/backfill-{1230,1025,6900}.ts`.

**Also:** `StatementSectionSeed` was missing `'OTHER_EXPENSE'` although line 135 already
used it — invisible because `packages/db/tsconfig.json` has `rootDir: ./src` and never
typechecked `prisma/`. Fixed by the move.

## Tests

`apps/api/src/modules/accounting/__tests__/chart-of-accounts-sync.integration.test.ts` —
on a scratch facility it creates and removes (the shared `TEST_FACILITY_ID` must not gain
or lose accounts): rename a non-system account, delete 1230, sync → returns 1, 1230 is
back, **the rename survives**; sync again → 0. The rename assertion is the one that
catches the likely regression: someone "simplifying" the sync into an upsert. Cleanup
runs inside `withGuardsDisabled()` and clears `audit_log` before the facility
(`ON DELETE RESTRICT`).

## Verification (done, 2026-08-13, scratch `postgres:16-alpine`)

The client's box was rebuilt exactly: baseline SQL applied by hand, then a
`_prisma_migrations` table holding only legacy pre-rebaseline names
(`0001_foundation`, `0002_parties_chambers`, `0003_lots_billing_config`) and no
baseline row.

1. **Old path, attempt 1** → `P3018`, `42710: type "UserRole" already exists`,
   baseline recorded `finished_at = NULL`. (The collision is an enum, not a table —
   the baseline creates types first — so it is 42710, not the 42P07 predicted from
   reading the file.)
2. **Old path, attempt 2** → `P3009 … The 20260101000000_baseline migration started
   at … failed`. Permanently stuck, exactly as reported.
3. **`db:deploy`** → adopted the baseline, applied all 16 real migrations
   (0002–0017), exit 0. History: 20 rows, **0 unfinished**; the three legacy rows
   left untouched.
4. **`db:deploy` again** → `No pending migrations to apply` / `already up to date`.
   Clean no-op.
5. **Account sync against a facility one release behind** (full chart seeded, then
   1025/1230/6900 removed and 6110 re-parented to 6000, plus an owner rename of 6020
   to "Godown Kiraya"): `3 account(s) added`, 83 → 86; 6110 moved to 6900; **the
   rename survived untouched.**
6. **Compose**: `config --services` returns `postgres api web caddy` — `migrate` is
   absent from the default set, so `up -d` can never start it; `--profile deploy`
   brings it back for `run`. `api depends_on` is `["postgres"]` only.

Not exercised: a full image build, so `update.ps1` end-to-end (pull → `docker cp`
bundle → backup → swap → health gate) is still only reasoned-through. The database
half — the part that was actually broken — is proven.

## Known limits

- The first hop still needs one manual step: the client's current `docker-compose.yml`
  runs the old `prisma migrate deploy`, so this fix cannot deliver itself. Send the new
  folder (or run the new `install.bat`) once; every update after that is self-carrying.
- The advisory lock in `deploy.ts` serialises two `db:deploy` runs, not a `db:deploy`
  against a raw `prisma migrate deploy` run by hand. Fine for a single box.
