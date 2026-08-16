# Client rollout — v0.4.0 (clean slate)

The one-time hop that puts the facility box on the self-updating pipeline. After this,
updates install themselves nightly and this document is never needed again.

**This is a wipe-and-reinstall, decided deliberately.** The box is not upgraded in
place: the database volume is destroyed and a brand-new facility is provisioned. That
removes every migration and folder hazard, at the cost of re-entering the facility's
data by hand.

---

## 0. Understand what is lost — this is irreversible

Destroying the volume removes **everything the facility has entered**: parties, lots in
storage, invoices, payments, party ledgers, peshgi balances, chart-of-accounts
customisations, rate plans, chambers, racks and users.

Only run this if that data is pilot/test material, or the owner has accepted the
re-entry. **If anyone is unsure, stop** — the in-place upgrade path still exists and is
proven; it is described in `phases/phase-26-update-pipeline.md`.

If you want a copy of the old data first (recommended even when discarding — it costs
one command and makes a change of mind possible):

```
cd <their existing ColdChain folder>
powershell -ExecutionPolicy Bypass -File backup.ps1
```
(or just double-click `backup.bat`) - writes `backups\coldchain-<timestamp>.sql.gz`.
Copy that file somewhere off the box before continuing.

---

## 1. Uninstall

```
cd <their existing ColdChain folder>
docker compose --env-file .env.production down -v
```

`-v` is what destroys the data. Everything up to this command is recoverable; nothing
after it is.

Then delete or rename the old folder so nobody runs the old installer by accident.

---

## 2. Install fresh

Unpack the v0.4.0 folder somewhere sensible (`C:\ColdChain` is fine).

**Right-click `install.bat` → Run as administrator.** Not a double-click.

Administrator matters: registering the nightly update task needs elevation. Without it
the installer *warns and carries on* — the app works perfectly and never updates itself
again, and nothing makes that visible later.

It asks for the cold store name, the owner's name and email, and optionally other staff.
It then prints temporary passwords — write them down before closing the window; each
person is asked to set their own on first login.

---

## 3. Confirm

```
type logs\update.log
schtasks /query /tn "ColdChain Auto Update"
```

`logs\update.log` should end with `SUCCESS: now running 'stable'`, and the scheduled
task should be listed. Then open `http://localhost/` on the box, and
`http://<box-ip>/` from a phone on the same Wi-Fi.

**Ask them to send `logs\update.log` after the first automatic update runs.** No such
record has ever existed for this box, and its absence is why the original fault went
undiagnosed for months.

---

## 4. Re-entering their data

Roughly in this order, because each depends on the previous:

1. **Settings** — number format, backdating window, GST default, surcharge rule.
2. **Chambers → Racks** (shown as Rooms in the UI).
3. **Commodities** and **Rate Plans**, then **Service Charges**.
4. **Parties** — farmers, traders, arhtis, buyers, with credit limits.
5. **Opening balances** — use the guided opening-balance screen rather than inventing
   journal entries, so the equity plug lands on 3010 and the statements balance.
6. **Open lots** — anything physically in storage right now, entered as inbound with its
   real arrival date (the backdating window in Settings must allow it).

Closed history — old invoices, settled payments — is not worth re-entering. The opening
balances carry the money forward.

---

## 5. From here on

Nothing. It checks for a new version nightly at 3am, backs up first, updates the
database before switching versions, and rolls back if anything fails. If the PC is off
at 3am it catches up after the next logon.

Releases only reach them once someone runs the **Promote to stable** workflow, so an
untested build cannot land on the box overnight.

---

## What changed for the people using it

**Cheques.** A cheque received now sits in *Cheques in Hand (Under Collection)* and shows
as **PENDING**; it reaches the bank balance only when someone opens the payment and
clicks **Mark Cleared**. Previously a cheque hit the bank the moment it was recorded,
which overstated the bank by every uncleared cheque held.

Also new since their last version: rooms and racks with placement slips, an
owner-configurable permissions screen, two-factor login and password reset by email,
staff advances recovered automatically from payroll, month close ("books closed
through"), invoice void, a late-payment surcharge worklist under Reports, and complete
financial statements.
