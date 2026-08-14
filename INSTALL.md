# Installing ColdChain on your facility computer

This guide sets up **ColdChain** on one Windows PC at your cold store. Staff then use it from
that PC and from phones/tablets/laptops on the **same Wi‑Fi** — no internet needed for day‑to‑day work.

> **You will not have to create or edit any files.** You double‑click one installer and answer a
> few simple questions. That's it.

**Time needed:** about 10–15 minutes (most of it is a one‑time download).

---

## What you need

- A **Windows 10 or 11** computer that stays on during working hours (it acts as the “server”).
- **Internet** — only for the **first** install (to download ColdChain). After that it works offline.
- The **ColdChain installer folder** from your provider (a small folder containing `install.bat`).
- Recommended: plug the PC into a **UPS** (battery backup) so it survives power cuts.

---

## Step 1 — Install Docker Desktop (one time)

ColdChain runs inside **Docker**, a free program that keeps everything self‑contained.

1. Open this link in your browser: **https://www.docker.com/products/docker-desktop/**
2. Click **Download for Windows**, then run the downloaded file (`Docker Desktop Installer.exe`).
3. Click **OK / Next** through the installer (keep the default options), then **restart the PC** when asked.
4. After restart, open **Docker Desktop** from the Start menu.
   - The first time, accept the terms. You do **not** need to create a Docker account — you can skip sign‑in.
   - Wait until the little **whale icon** (bottom‑left) stops animating and it says **“Engine running.”**

✅ Docker is ready. You only ever do Step 1 **once** per computer.

---

## Step 2 — Install ColdChain

1. Put the **ColdChain installer folder** (from your provider) somewhere easy, e.g. your **Desktop**.
2. Open the folder and **double‑click `install.bat`**.
   - If Windows shows a blue “Windows protected your PC” box, click **More info → Run anyway**
     (this just means the file came from the internet; it is safe).
3. A black window opens and does everything for you:
   - checks Docker, downloads ColdChain, starts it, prepares the database.
4. When asked, **type your details** and press **Enter** after each:
   - **Cold store / company name** — e.g. `Lahore Cold Store`
   - **Owner full name** — e.g. `Ali Khan`
   - **Owner email** — the email the owner will use to log in, e.g. `ali@store.pk`
   - It then asks **“Add another staff member?”** — type `y` to add an accountant/manager/operator,
     or just press **Enter** to skip. You can always add more people later inside the app.
5. The installer prints **temporary passwords**. 📝 **Write them down** (or take a photo) and give each
   person theirs. Everyone sets their **own** new password the first time they log in.
6. Your web browser opens automatically at **http://localhost/** — the ColdChain login page. 🎉

That's the whole installation. **No files were created or edited by you.**

---

## Step 3 — Log in and start using it

- On the **server PC**: open **http://localhost/**
- Log in with the **owner email** and the **temporary password** from the installer.
- You'll be asked to choose a **new password** — do that, and you're in.

### Use it from other devices (phones, tablets, other PCs)

Any device on the **same Wi‑Fi / network** can use ColdChain:

1. The installer showed a line like **`On phones / tablets (same Wi‑Fi): http://192.168.x.x/`**.
2. On the phone/tablet, open a browser and type that address (e.g. `http://192.168.1.50/`).
3. Log in. Done — no app to install.

> Tip: write that `http://192.168.x.x/` address on a sticky note for staff. (If you can't find it,
> on the server PC press **Start**, type `cmd`, press Enter, type `ipconfig`, and look for
> **IPv4 Address**.)

---

## Everyday use

- **It starts by itself.** Whenever the PC is on and Docker Desktop is running, ColdChain is available.
  (In Docker Desktop → **Settings → General**, make sure **“Start Docker Desktop when you log in”** is ticked.)
- **To stop it temporarily:** open Docker Desktop, find the **coldchain** stack, click **Stop**.
- **To start it again:** click **Start** on the **coldchain** stack (or just re‑run `install.bat`).
- **Your data stays on this PC**, inside Docker. It is **not** sent anywhere.

---

## Troubleshooting

| What you see | What to do |
|---|---|
| “Docker Desktop is not installed” | Do **Step 1** first. |
| “Docker Desktop is installed but not running” | Open **Docker Desktop**, wait for **“Engine running”**, then run `install.bat` again. |
| “Windows protected your PC” popup | Click **More info → Run anyway**. The file is safe. |
| “ColdChain has not been downloaded yet” | Connect the PC to the **internet** and run `install.bat` again (only the first install needs internet). |
| The page won't open on a phone | Make sure the phone is on the **same Wi‑Fi** as the PC, and you typed the `http://192.168.x.x/` address exactly. |
| Forgot a password | The **owner** can reset any staff member's password from inside ColdChain (Users screen). |
| Anything else | Re‑run `install.bat` — it's safe and won't erase your data. If it still fails, send your provider a photo of the black window. |

---

## Updating to a new version

**You don't have to do anything.** ColdChain checks for a new version every night at 3am and
installs it by itself — app changes, database changes, all of it. Leave the PC and Docker Desktop
on and it stays current. If the PC was switched off at 3am, it catches up shortly after you next
log in.

Your data is never touched by an update. Before anything changes, ColdChain takes a full database
backup into the `backups` folder, then updates the database *before* switching to the new version.
If any part of that fails, it puts the previous version straight back and carries on running — the
cold store keeps working and you'll usually never know it happened. Every attempt is written to
`logs\update.log`; that's the file to send your provider if you think something is wrong.

To check what you're running, or to move to a specific version by hand:

```
install.bat                 (re-runs setup safely; also switches on automatic updates)
powershell -ExecutionPolicy Bypass -File update.ps1 -Tag v0.3.0
```

Two things worth knowing:

- **Automatic updates need administrator rights to switch on.** If you didn't right-click
  `install.bat` → **Run as administrator** the first time, updates won't be automatic. Re-run it as
  administrator once and they will be.
- Boxes running Linux instead of Windows use `./scripts/update.sh v0.3.0`, which does exactly the
  same thing from cron.

**What's new in v0.3.0**:
- **Rooms & Racks** — chambers are now shown as Rooms containing Racks. Place a lot's bags across
  racks, move stock between racks or rooms with a permanent movement log, print placement slips and
  rack labels, and see pick locations at withdrawal and on the gate console. Existing lots simply
  start as "Unplaced" — nothing changes until you start placing.
- **Accounting hardening** (v0.2.0, included): month close ("books closed through"), guided opening
  balances for go‑live, one‑click journal‑entry reversal, owner‑managed chart of accounts, a
  tamper‑evident audit trail on every financial record, and complete financial statements (nothing
  can silently drop off the P&L or balance sheet anymore).

---

<details>
<summary><b>For the ColdChain provider (setup notes — clients can ignore this)</b></summary>

### What to give the client
Zip and send these **six files** (they're self‑contained — they pull the app images from the public
GHCR registry, so the client never needs the source repo):

```
docker-compose.yml
Caddyfile
install.ps1
install.bat
INSTALL.md   (this file)
scripts/app-role.sql   (keep the scripts/ folder — install.ps1 loads it from there)
```

The client unzips the folder and double‑clicks `install.bat`. Nothing else is required on their side.

### How the installer works
- Generates `.env.production` with strong random secrets on first run (never overwrites an existing one).
- `docker compose pull` of `ghcr.io/izhanjunaid/coldchain-{api,web}:<tag>` (default `latest` = newest release; public). The installer syncs `COLDCHAIN_TAG` in `.env.production` to the requested `-Tag` on every run, so `install.bat -Tag vX.Y.Z` updates an existing box too.
- Starts Postgres alone first and runs `scripts/app-role.sql` to create/sync `coldchain_app` — the
  least‑privilege role the API connects as (see "Database hardening" below).
- `docker compose up -d` → the one‑shot `migrate` service applies the Prisma baseline, then `api`/`web`/`caddy` start.
- Provisions a **clean** facility at the fixed id the web login expects, the owner (+ any staff you add),
  and the 83‑account standard chart of accounts — **no demo/sample data**. The clean‑DB guard refuses
  to provision over an existing facility, so re‑running is safe.
- Temporary passwords are shown once; `must_change_password` is on for every user.

### Database hardening (F‑2a)
The API runs as `coldchain_app`, a least‑privilege Postgres role that can read/write rows but
cannot run DDL or call `financial_guards_set()` — the function that would disable the financial
audit/immutability triggers (docs/16, finding F‑2a). Only the database owner (used solely by the
one‑shot `migrate` service) keeps that ability. `scripts/app-role.sql` creates and re‑syncs the
role; the installer and `scripts/update.sh` run it automatically at the right points, so:

- **Always update a box via `install.bat -Tag vX.Y.Z` or `scripts/update.sh`** — a bare
  `docker compose up -d` on a box whose `.env.production` predates this hardening will start the
  API with empty app‑role credentials and it will crash‑loop until either script is run once.
- **Restoring a backup onto a brand‑new box:** run the installer first, then `scripts/restore.sh`.
  Dumps contain `GRANT … TO coldchain_app` statements, and the restore aborts if the role doesn't
  exist yet (the installer creates it).
- To verify the hardening on a box:
  `docker compose --env-file .env.production exec postgres psql -U coldchain_app -d coldchain -c "SELECT financial_guards_set(false)"`
  must fail with *permission denied*.

### Non‑interactive install (e.g. you set it up remotely)
```powershell
powershell -ExecutionPolicy Bypass -File install.ps1 `
  -Company "Lahore Cold Store" -City "Lahore" `
  -OwnerName "Ali Khan" -OwnerEmail "ali@store.pk" -NonInteractive
```
Useful flags: `-Tag v0.1.1` (version), `-SkipPull` (use already‑downloaded images), `-Registry <host>`.

### Rolling out updates centrally
Tag a release (`git tag v0.1.1 && git push origin v0.1.1`) → CI publishes new images to GHCR →
each box runs `install.bat -Tag v0.1.1` (or `scripts/update.sh v0.1.1`, which also health‑checks and
auto‑rolls‑back). See `phases/phase-13-production-deploy.md` for the full pipeline.

</details>
