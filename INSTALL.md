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

When your provider releases a new version, they will either send you a new installer folder or a new
**version tag**. To update without losing data, run the installer pointing at the new version — for
example:

```
install.bat -Tag v0.3.0
```

(Double‑clicking always uses the version it shipped with; the line above is only needed to jump to a
newer one. Your data and settings are kept.)

Boxes with Git Bash/WSL can instead run `./scripts/update.sh v0.3.0` — it takes a database backup
first, health‑checks the new version, and automatically rolls back to the previous one if anything
fails. Either way, the first start after an update can take a minute longer than usual — that's the
database upgrading itself; don't close Docker while it runs.

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
Zip and send these **five files** (they're self‑contained — they pull the app images from the public
GHCR registry, so the client never needs the source repo):

```
docker-compose.yml
Caddyfile
install.ps1
install.bat
INSTALL.md   (this file)
```

The client unzips the folder and double‑clicks `install.bat`. Nothing else is required on their side.

### How the installer works
- Generates `.env.production` with strong random secrets on first run (never overwrites an existing one).
- `docker compose pull` of `ghcr.io/izhanjunaid/coldchain-{api,web}:<tag>` (default `latest` = newest release; public). The installer syncs `COLDCHAIN_TAG` in `.env.production` to the requested `-Tag` on every run, so `install.bat -Tag vX.Y.Z` updates an existing box too.
- `docker compose up -d` → the one‑shot `migrate` service applies the Prisma baseline, then `api`/`web`/`caddy` start.
- Provisions a **clean** facility at the fixed id the web login expects, the owner (+ any staff you add),
  and the 83‑account standard chart of accounts — **no demo/sample data**. The clean‑DB guard refuses
  to provision over an existing facility, so re‑running is safe.
- Temporary passwords are shown once; `must_change_password` is on for every user.

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
