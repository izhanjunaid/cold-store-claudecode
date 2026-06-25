# Phase 13 — Production Deployment

Make ColdChain deployable to real clients. Target model: **offline-capable, $0-hosting local box** per
facility (Docker on a PC on the facility LAN), built/released centrally. Same codebase can later run as
cloud SaaS (it is already multi-tenant via `facility_id` + RLS).

## Shipped & verified end-to-end (on real containers)

- **Containerization**: `apps/api/Dockerfile` (multi-stage; system Chromium + `fonts-nafees` + fontconfig
  for offline Urdu PDFs; Prisma engine via `binaryTargets`), `apps/web/Dockerfile` (Next standalone),
  root `docker-compose.yml` (postgres + one-shot `migrate` + api + web + caddy), `Caddyfile`
  (single-origin reverse proxy → one image portable to any facility), `.dockerignore`.
- **Offline PDFs**: removed the Google-Fonts `@import` from all 8 templates; bundled Nafees Urdu font +
  fontconfig alias. Templates copied into `dist` during the API build. Verified: party-statement PDF
  renders Urdu cleanly with **no** network access.
- **Clean client provisioning** (`packages/db/prisma/provision.ts`, `scripts/provision-client.sh`,
  `scripts/client-config.example.json`): fresh facility + real users (unique temp passwords,
  `must_change_password`, bcrypt-12) + standard 83-account Chart of Accounts. **No demo/test data.**
  Refuses to run on a non-empty DB. Demo `seed.ts` is now hard-blocked when `NODE_ENV=production`.
- **Migration rebaseline**: migrations 0004–0009 were missing (built via `db push`), so `migrate deploy`
  failed on a fresh DB. Replaced the 10 fragmented migrations with one
  `20260101000000_baseline` = tables from `schema.prisma` + the exact custom SQL (audit functions,
  3 audit triggers, RLS + 4 policies on foundation tables). Verified: fresh `migrate deploy` reproduces
  the dev schema exactly (35 tables, 2 fns, 3 triggers, 4 RLS tables/policies); login works with **RLS
  active**; audit triggers fire on writes.
- **Ops scaffolding**: `scripts/bootstrap.sh` (build + up + migrate deploy, no demo seed),
  `scripts/backup.sh` / `restore.sh`, `.env.production.example` (random secrets), `trustProxy` for
  rate-limiting/logs behind Caddy.

## Production bugs found & fixed via live deploy
font package name · corepack/flaky-net build (npm-install pnpm + apt cache mounts + retries) ·
Postgres host-port clash · Prisma `binaryTargets` (API couldn't start on Debian) · PDF templates
missing from `dist` · offline Urdu fonts · `trustProxy` · incomplete migration history.

## Deploy flow (per client)
```
./scripts/bootstrap.sh
cp scripts/client-config.example.json client-config.json   # fill in real org + users
./scripts/provision-client.sh client-config.json
```

## ⚠️ Rebaseline impact
- Migration history was rewritten. Branches `redesign/ui-replatform` and `feat/world-class-financials`
  still carry the old migrations → **merges will conflict**; rebaseline them off this.
- Existing dev DB (Postgres **16**): baseline once with
  `prisma migrate resolve --applied 20260101000000_baseline`. Fresh/prod DBs are unaffected.
- Dev is PG16 but compose pins PG15 — pin both to 16 for parity.

## Phase B — CI/CD safe rollout (built + locally validated)
- `.github/workflows/release.yml`: on a `v*` tag, run tests, then buildx + push `coldchain-api`
  and `coldchain-web` images to GHCR (`:<tag>` and `:latest`).
- Compose now carries `image:` refs (box pulls pre-built images; `migrate` reuses the API image, so
  only two app images are pulled). Postgres pinned to 16 (dev/CI/prod parity).
- `scripts/update.sh`: pull a release tag → migrate deploy → health-check → **roll back to the
  previous tag on failure** → optional heartbeat. Roll-forward migrations only (use expand-contract).
- Verified locally: fresh bootstrap on the new compose → migrate deploy runs from the API image →
  stack healthy on PG 16.

## Resilience drills (passed)
- Backup→restore round-trips data exactly; a real app crash auto-recovers (`unless-stopped`).

## Remaining
- **First release**: push a `v*` tag to run `release.yml` once (publishes images to GHCR), then the
  box pulls via `update.sh`. Make the GHCR packages reachable from the box (public, or a read token).
- **Phase C — hardening**: LAN TLS (Caddy internal CA), error monitoring (Sentry), and extend audit
  triggers + RLS to operational tables (currently foundation-only).
