# Client rollout — v0.4.0

The one-time hop that gets the facility box onto the self-updating pipeline. After this,
updates install themselves nightly and this document is never needed again.

Their box is on **v0.3.0 or earlier**, and its updates have been failing on every
attempt (see `phases/phase-26-update-pipeline.md` for why). This release carries **74
commits and 12 migrations** (0006–0017). That exact 0006→0017 run was proven end to end
on a scratch `postgres:16`, so the schema path is not the risk — the risks are the two
pre-flight checks below and the folder handling.

---

## 1. Pre-flight — run these ON THEIR BOX before sending anything

### 1a. Duplicate invoice numbers (**blocking**)

Migration `0011` adds a unique constraint on `(facility_id, invoice_number)` and **fails
deliberately** if duplicates exist — renumbering a historical invoice is a data-repair
decision, not something a migration may guess at. Two invoices finalized in the same
moment could previously take the same number, because the advisory lock protecting
invoice numbering silently acquired nothing (phase/20).

```
docker compose --env-file .env.production exec -T postgres \
  psql -U coldchain -d coldchain -c \
  "SELECT facility_id, invoice_number, count(*) FROM invoices
    WHERE invoice_number IS NOT NULL GROUP BY 1,2 HAVING count(*) > 1;"
```

**Zero rows → proceed.** Any rows → decide with the owner which document gets
renumbered, fix it, re-run, and only then continue.

If this is skipped, nothing breaks: the update aborts, the tag and deploy files are
reverted, and the old version keeps running. But the box will then quietly fail to
update every night, which is precisely the failure mode this work exists to end. The
evidence will be in `logs\update.log`.

### 1b. Capture what the box is actually running

Worth ten seconds and it is the baseline for everything after:

```
type .env.production | findstr COLDCHAIN_TAG
docker compose --env-file .env.production exec -T postgres psql -U coldchain -d coldchain -tAc ^
  "select migration_name, finished_at is null as failed from _prisma_migrations order by started_at;"
```

Keep the output. If anything goes sideways, this is the before-picture.

---

## 2. What to send

Copy these into their **existing** folder:

```
install.bat   install.ps1   update.ps1
docker-compose.yml   Caddyfile   INSTALL.md
scripts\app-role.sql
```

### The one that will hurt if you get it wrong

> **Copy the files INTO the existing folder. Do NOT replace the folder.**
>
> `.env.production` must survive. It holds `POSTGRES_PASSWORD`, and their data lives in
> the `pgdata` Docker volume which was initialised with that exact password. A freshly
> generated one will not match, Postgres will reject every connection, and the box is
> down — data intact but unreachable. `install.ps1` only writes that file when it is
> absent, so keeping it is all that is required.

Never ship a `.env.production`. It is gitignored for this reason.

---

## 3. How they run it

**Right-click `install.bat` → Run as administrator.** Once.

Administrator matters: registering the nightly Scheduled Task needs elevation. Without
it the installer *warns and carries on* — the app works perfectly and nothing is ever
automatic again. That failure is invisible unless someone looks.

The installer keeps existing settings and existing data, updates the database before
switching versions, health-checks, and rolls back if anything fails.

---

## 4. Confirm it worked

```
type logs\update.log
dir backups\coldchain-preupdate-*.sql.gz
schtasks /query /tn "ColdChain Auto Update"
```

`logs\update.log` should read: `deploy files refreshed` → `pre-update backup written` →
`updating the database...` → `SUCCESS: now running 'stable'`.

**Ask them to send `logs\update.log`.** No such record has ever existed for this box;
it is why the original fault went undiagnosed for so long.

---

## 5. Tell them this before it surprises them

**Cheques have changed.** A cheque received now lands in a new *Cheques in Hand (Under
Collection)* account and starts as **PENDING**; it reaches the bank balance only when
someone opens the payment and clicks **Mark Cleared**. Previously a cheque hit the bank
balance the moment it was recorded, which overstated the bank by every uncleared cheque
they held.

Existing cheque records are untouched — only new ones behave this way.

Also worth a sentence each: room/rack placement, the owner-configurable permission
screen, employee advances with automatic payroll recovery, and month-close ("books
closed through"). None of these change existing data; they are new capability.

---

## 6. If it goes wrong

The update is designed to fail safe: the database is updated **before** the app is
swapped, so a failure leaves the previous version running with data untouched, and the
version tag and deploy files are reverted together.

- `logs\update.log` says what happened, always.
- `backups\coldchain-preupdate-*.sql.gz` is a full dump from immediately before the
  attempt; restore with `scripts/restore.sh` only if genuinely needed — it discards
  anything entered since the dump, so it is a last resort, not a first response.
- Rolling back the app does **not** roll back the database. Migrations are
  roll-forward only, which is safe because releases are expand-only: the previous image
  keeps working against the newer schema.
