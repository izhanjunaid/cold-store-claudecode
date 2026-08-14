<#
  ColdChain - unattended updater for a facility computer (Windows).

  Nothing here needs a person. install.ps1 registers a Scheduled Task that runs
  this daily; it is also what install.ps1 itself uses to move a box to a version,
  so there is exactly one update code path.

  The order below is the whole point:

      pull -> refresh deploy files -> back up -> UPDATE THE DATABASE -> swap the app

  The database is updated by a one-shot container BEFORE api/web are replaced. If
  that step fails, the previous version is still running and untouched, and this
  script puts the version tag back. A broken release cannot take the cold store
  offline; it just doesn't get installed.

  Usage (you normally never type this):
    powershell -ExecutionPolicy Bypass -File update.ps1            # move to :stable
    powershell -ExecutionPolicy Bypass -File update.ps1 -Tag v1.2.3
#>
#Requires -Version 5
[CmdletBinding()]
param(
  [string]$Tag = "stable",
  [switch]$SkipBackup,
  [switch]$SkipPull
)

# Continue, not Stop: `docker compose` writes normal progress to STDERR, which under
# "Stop" PowerShell can promote to a terminating error. Exit codes are checked instead.
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$EnvFile = ".env.production"
$LogFile = "logs\update.log"

if (-not (Test-Path "logs"))    { New-Item -ItemType Directory "logs"    | Out-Null }
if (-not (Test-Path "backups")) { New-Item -ItemType Directory "backups" | Out-Null }

# Unattended runs have no console. Everything goes to logs\update.log as well, so a
# box that has quietly not updated for a month is distinguishable from a current one.
function Log([string]$m) {
  $line = "[{0}] {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $m
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding utf8
}

function Compose { docker compose --env-file $EnvFile @args }

function Get-EnvValue([string]$key) {
  $m = [regex]::Match((Get-Content $EnvFile -Raw), "(?m)^$key=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

function Set-EnvValue([string]$key, [string]$val) {
  $text = Get-Content $EnvFile -Raw
  if ($text -match "(?m)^$key=") {
    $text = [regex]::Replace($text, "(?m)^$key=.*$", "$key=$val")
  } else {
    $text = $text.TrimEnd() + "`n$key=$val`n"
  }
  [System.IO.File]::WriteAllText((Join-Path (Get-Location) $EnvFile), $text, (New-Object System.Text.ASCIIEncoding))
}

if (-not (Test-Path $EnvFile)) { Log "No $EnvFile - run install.bat first."; exit 1 }

$prevTag  = Get-EnvValue 'COLDCHAIN_TAG'
$registry = Get-EnvValue 'IMAGE_REGISTRY'
$pgUser   = Get-EnvValue 'POSTGRES_USER'
$pgDb     = Get-EnvValue 'POSTGRES_DB'
$pgPass   = Get-EnvValue 'POSTGRES_PASSWORD'
if (-not $registry) { $registry = "ghcr.io/izhanjunaid" }
if (-not $prevTag)  { $prevTag  = "stable" }

# The deploy files and the images are a matched pair - this release's compose file
# calls `db:deploy`, which does not exist in an older api image. Reverting the tag
# without also reverting these files would leave the box unable to start at all.
$DeployFiles = @('docker-compose.yml', 'Caddyfile', 'scripts\app-role.sql')

function Save-DeployFiles {
  foreach ($f in $DeployFiles) {
    if (Test-Path $f) { Copy-Item -Force $f "$f.prev" }
  }
}

function Restore-DeployFiles {
  foreach ($f in $DeployFiles) {
    if (Test-Path "$f.prev") { Move-Item -Force "$f.prev" $f }
  }
  Remove-Item 'update.ps1.new' -Force -ErrorAction SilentlyContinue
}

function Revert-To([string]$tag) {
  Log "reverting to '$tag'."
  Set-EnvValue 'COLDCHAIN_TAG' $tag
  Restore-DeployFiles
  Compose up -d
}

# Least-privilege runtime role the api connects as (F-2a). Idempotent. Run before
# migrations so ALTER DEFAULT PRIVILEGES covers the tables they create, and again
# after, to cover grants made under an older version of app-role.sql.
function Sync-AppRole {
  $appPw = Get-EnvValue 'APP_DB_PASSWORD'
  if (-not $appPw) { Log "WARNING: APP_DB_PASSWORD missing from $EnvFile - skipping role sync."; return }
  # Piped straight into `docker`, not through the Compose helper: PowerShell does not
  # reliably forward pipeline input to a native command wrapped inside a function.
  Get-Content (Join-Path $PSScriptRoot "scripts\app-role.sql") -Raw |
    docker compose --env-file $EnvFile exec -T postgres psql -U $pgUser -d $pgDb -v ON_ERROR_STOP=1 -v app_password=$appPw -f -
  if ($LASTEXITCODE -ne 0) { Log "WARNING: app-role sync failed (is the database up?)." }
}

function Test-Healthy {
  for ($i = 0; $i -lt 40; $i++) {
    try {
      if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://localhost/health").StatusCode -eq 200) { return $true }
    } catch { }
    Start-Sleep -Seconds 3
  }
  return $false
}

Log "=== update requested: '$prevTag' -> '$Tag' ==="

# ---------------------------------------------------------------- 1) Docker up?
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Log "Docker Desktop is not running - nothing done. Will try again on the next scheduled run."
  exit 0
}

# ---------------------------------------------------------------- 2) Pull
Set-EnvValue 'COLDCHAIN_TAG' $Tag
if (-not $SkipPull) {
  Compose pull
  if ($LASTEXITCODE -ne 0) {
    Log "could not download '$Tag' (offline?) - staying on '$prevTag'. Nothing was changed."
    Set-EnvValue 'COLDCHAIN_TAG' $prevTag
    exit 0
  }
}
docker image inspect "$registry/coldchain-api:$Tag" *> $null
if ($LASTEXITCODE -ne 0) {
  Log "'$Tag' is not on this computer and could not be downloaded - staying on '$prevTag'."
  Set-EnvValue 'COLDCHAIN_TAG' $prevTag
  exit 0
}

# ---------------------------------------------------------------- 3) Refresh deploy files
# docker-compose.yml / Caddyfile ride along inside the api image, so a release that
# changes them reaches the box without anyone sending a new folder. Extracted with
# `docker cp` rather than a PowerShell pipe so nothing re-encodes the file.
Save-DeployFiles
docker rm -f coldchain-bundle *> $null   # a previous run may have died before cleaning up
docker create --name coldchain-bundle "$registry/coldchain-api:$Tag" *> $null
if ($LASTEXITCODE -eq 0) {
  docker cp "coldchain-bundle:/app/docker-compose.yml"    "docker-compose.yml"   *> $null
  docker cp "coldchain-bundle:/app/Caddyfile"             "Caddyfile"            *> $null
  docker cp "coldchain-bundle:/app/scripts/app-role.sql"  "scripts\app-role.sql" *> $null
  docker cp "coldchain-bundle:/app/update.ps1"            "update.ps1.new"       *> $null
  docker rm -f coldchain-bundle *> $null
  Log "deploy files refreshed from the '$Tag' image."
  # The refreshed file may name a different image or registry, so pull again. Cheap
  # when nothing changed (every layer is already local), load-bearing when it did.
  if (-not $SkipPull) {
    Compose pull
    if ($LASTEXITCODE -ne 0) {
      Log "ERROR: the refreshed compose file references images that could not be pulled - reverting."
      Revert-To $prevTag
      exit 1
    }
  }
} else {
  Log "WARNING: could not read deploy files from the image - keeping the current ones."
}

# ---------------------------------------------------------------- 4) Pre-update backup
# Migrations are transactional and run before the app is swapped, so this is a
# belt-and-braces measure - but an unattended update has removed the human who would
# otherwise have noticed something was wrong, so it is not optional.
Compose up -d postgres *> $null
for ($i = 0; $i -lt 30; $i++) {
  Compose exec -T postgres pg_isready -U $pgUser -d $pgDb *> $null
  if ($LASTEXITCODE -eq 0) { break }
  Start-Sleep -Seconds 2
}
Sync-AppRole

if (-not $SkipBackup) {
  $raw = Compose exec -T postgres psql -U $pgUser -d $pgDb -tAc "SELECT count(*) FROM facilities"
  $facilities = "$raw".Trim()
  if ($LASTEXITCODE -eq 0 -and $facilities -ne "" -and $facilities -ne "0") {
    $ts  = Get-Date -Format "yyyyMMdd-HHmmss"
    $out = "backups\coldchain-preupdate-$ts.sql.gz"
    # Dump AND gzip inside the container, then copy the finished file out: PowerShell
    # must never touch the byte stream or it will mangle Urdu party names.
    Compose exec -T -e PGPASSWORD=$pgPass postgres sh -c "pg_dump -U '$pgUser' -d '$pgDb' --clean --if-exists | gzip -9 > /tmp/coldchain-preupdate.sql.gz"
    if ($LASTEXITCODE -eq 0) {
      Compose cp "postgres:/tmp/coldchain-preupdate.sql.gz" $out *> $null
      Log "pre-update backup written: $out"
    } else {
      Log "WARNING: pre-update backup failed. Continuing - the database update is transactional and runs before the app is swapped."
    }
    # Daily unattended dumps would otherwise fill the disk with nobody watching.
    $keep = Get-EnvValue 'BACKUP_RETENTION_DAYS'
    if (-not $keep) { $keep = 30 }
    Get-ChildItem "backups" -Filter "coldchain-preupdate-*" -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-[int]$keep) } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  } else {
    Log "no facility data yet - skipping backup."
  }
}

# ---------------------------------------------------------------- 5) Database FIRST
# Run explicitly rather than relying on `up -d` to notice the one-shot needs re-running.
# api/web are still on the OLD images at this point, so a failure here costs nothing.
Log "updating the database..."
Compose run --rm migrate
if ($LASTEXITCODE -ne 0) {
  Log "ERROR: the database could not be updated. Version '$prevTag' is still running and your data is untouched."
  Log "       Send logs\update.log to your ColdChain provider."
  Revert-To $prevTag
  exit 1
}
# Re-apply grants now that this release's migrations have run.
Sync-AppRole

# ---------------------------------------------------------------- 6) Swap the app
Log "starting version '$Tag'..."
Compose up -d
if ($LASTEXITCODE -ne 0) {
  Log "ERROR: '$Tag' failed to start - rolling back to '$prevTag'."
  Revert-To $prevTag
  exit 1
}

# ---------------------------------------------------------------- 7) Health gate
if (-not (Test-Healthy)) {
  # Note what rollback does NOT undo: the database has already moved forward, and
  # migrations are roll-forward only. That is safe as long as releases stay
  # expand-only (add columns/tables, never drop or rename in the same release the
  # code starts using them), which is the standing rule for this repo - the previous
  # image keeps working against the newer schema. A release that breaks that rule
  # cannot be rolled back by this script; restore backups\coldchain-preupdate-*.sql.gz
  # with scripts/restore.sh instead. Not automated deliberately: an automatic restore
  # would silently discard everything entered since the dump.
  Log "ERROR: '$Tag' did not become healthy - rolling back to '$prevTag'."
  Log "       The database was already updated; it stays updated (expand-only migrations)."
  Revert-To $prevTag
  if (Test-Healthy) { Log "rolled back to '$prevTag' (healthy)." }
  else { Log "CRITICAL: '$prevTag' is not healthy either - manual help needed." }
  exit 1
}

# Success: drop the saved copies and adopt the new updater for the next run.
foreach ($f in $DeployFiles) { Remove-Item "$f.prev" -Force -ErrorAction SilentlyContinue }
if (Test-Path 'update.ps1.new') { Move-Item -Force 'update.ps1.new' 'update.ps1' }

Log "SUCCESS: now running '$Tag'."
exit 0
