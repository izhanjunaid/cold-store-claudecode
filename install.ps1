<#
  ColdChain - one-step installer for a facility computer (Windows).

  HOW TO USE: just double-click  install.bat  (it runs this script).
  You will be asked a few questions. You never have to create or edit any files.

  What this does:
    1. Checks that Docker Desktop is installed and running.
    2. Creates secure settings the first time (.env.production) - passwords are generated for you.
    3. Downloads ColdChain from GitHub Container Registry (public images).
    4. Starts ColdChain and prepares the database.
    5. Asks for your cold store + owner details and creates your account + chart of accounts.
    6. Opens ColdChain in your web browser.

  Running it again is SAFE: it will not wipe a facility that is already set up.

  Advanced (optional) - skip the questions by passing values:
    powershell -ExecutionPolicy Bypass -File install.ps1 -Company "Lahore Cold Store" -OwnerName "Ali Khan" -OwnerEmail "ali@store.pk"
#>
#Requires -Version 5
[CmdletBinding()]
param(
  [string]$Company,
  [string]$City = "Lahore",
  [string]$OwnerName,
  [string]$OwnerEmail,
  [string]$Tag = "stable",
  [string]$Registry = "ghcr.io/izhanjunaid",
  [switch]$SkipPull,
  [switch]$NonInteractive
)

# Continue (not Stop): `docker compose` prints normal progress to STDERR, which under "Stop"
# PowerShell can promote to a terminating error when output is redirected (piped / logged).
# We check $LASTEXITCODE after each docker call and wrap fallible cmdlets in try/catch instead.
$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot
$EnvFile = ".env.production"

function Say([string]$m, [string]$c = "Gray") { Write-Host $m -ForegroundColor $c }
function Step([string]$m) { Write-Host ""; Write-Host ">> $m" -ForegroundColor Cyan }
function Fail([string]$m) { Write-Host ""; Write-Host "X  $m" -ForegroundColor Red; exit 1 }

function New-Secret([int]$nbytes) {
  $bytes = New-Object 'System.Byte[]' $nbytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Compose { docker compose --env-file $EnvFile @args }

Write-Host ""
Say "==============================================" Cyan
Say "      ColdChain - Facility Installer" Cyan
Say "==============================================" Cyan

# ---------------------------------------------------------------- 1) Docker
Step "Checking Docker Desktop..."
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Fail "Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop/ , restart the computer, then run this again."
}
docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker Desktop is installed but not running. Open Docker Desktop, wait until the whale icon is steady / it says 'Engine running', then run this again."
}
Say "   OK - Docker is ready." Green

# ---------------------------------------------------------------- 2) Settings (one time)
if (-not (Test-Path $EnvFile)) {
  Step "Creating secure settings (one time only)..."
  $lines = @(
    "POSTGRES_USER=coldchain"
    "POSTGRES_PASSWORD=$(New-Secret 24)"
    "POSTGRES_DB=coldchain"
    "APP_DB_USER=coldchain_app"
    "APP_DB_PASSWORD=$(New-Secret 24)"
    "JWT_SECRET=$(New-Secret 48)"
    "JWT_REFRESH_SECRET=$(New-Secret 48)"
    "PUBLIC_ORIGIN=http://localhost"
    "LOG_LEVEL=info"
    "IMAGE_REGISTRY=$Registry"
    "COLDCHAIN_TAG=$Tag"
    "HEALTHCHECK_URL="
    "BACKUP_PASSPHRASE="
    "BACKUP_RCLONE_REMOTE="
    "BACKUP_RETENTION_DAYS=30"
  )
  [System.IO.File]::WriteAllText(
    (Join-Path (Get-Location) $EnvFile),
    (($lines -join "`n") + "`n"),
    (New-Object System.Text.ASCIIEncoding))
  Say "   OK - saved to $EnvFile  (keep this file - it holds your private passwords)." Green
} else {
  Say "   OK - using existing settings ($EnvFile)." Green
}

# NOTE: COLDCHAIN_TAG is deliberately NOT written here. update.ps1 reads the value
# still in the file as the version to fall back to, and writes the new one itself.
# Setting it here first would make prevTag == newTag and silently turn every rollback
# into a no-op. The since-deleted scripts/update.sh had exactly this bug: its rollback was
# dead code on any box left on the default tag, because PREV_TAG always equalled NEW_TAG.
$envText = Get-Content $EnvFile -Raw
# Boxes installed before the F-2a hardening lack the app-role credentials — add them.
if ($envText -notmatch '(?m)^APP_DB_PASSWORD=') {
  $envText = $envText.TrimEnd() + "`nAPP_DB_USER=coldchain_app`nAPP_DB_PASSWORD=$(New-Secret 24)`n"
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $EnvFile), $envText, (New-Object System.Text.ASCIIEncoding))
Say "   Version: $Tag" Green

# ------------------------------------------------- 3-5) Download, prepare DB, start
# Delegated to update.ps1 so a first install and a later update take exactly the same
# path: pull -> refresh deploy files -> back up -> update the database -> start the
# app -> health-check, rolling back if any step fails. Nothing about that sequence is
# specific to updating, and having one copy of it means the install path cannot rot.
Step "Downloading and starting ColdChain (the first time can take several minutes)..."
$updater = Join-Path $PSScriptRoot "update.ps1"
if (-not (Test-Path $updater)) { Fail "update.ps1 is missing from this folder - ask your ColdChain provider for a complete installer." }

$updateArgs = @('-Tag', $Tag)
if ($SkipPull) { $updateArgs += '-SkipPull' }
& powershell -ExecutionPolicy Bypass -File $updater @updateArgs
if ($LASTEXITCODE -ne 0) {
  Fail "ColdChain could not be started. Send logs\update.log to your ColdChain provider."
}
Say "   OK - ColdChain is running." Green

# ---------------------------------------------------------------- 6) Set up the facility (only if empty)
# Has this box already been set up? We call psql DIRECTLY (not via `sh -c "...$VAR..."`) because
# PowerShell mangles double-quotes nested inside a single-quoted arg, which silently produced an
# empty result. The installer always provisions the DB as user/db "coldchain" (see settings above).
$raw   = docker compose --env-file $EnvFile exec -T postgres psql -U coldchain -d coldchain -tAc "SELECT count(*) FROM facilities"
$count = "$raw".Trim()

if ($count -ne "0" -and $count -ne "") {
  Say ""
  Say "   This computer already has a ColdChain facility set up - keeping your existing data." Green
}
else {
  Step "Let's set up your facility. Please answer a few questions:"
  if (-not $Company)    { if ($NonInteractive) { Fail "Company name is required." };  $Company    = Read-Host "   Cold store / company name" }
  if (-not $OwnerName)  { if ($NonInteractive) { Fail "Owner name is required." };    $OwnerName  = Read-Host "   Owner full name" }
  if (-not $OwnerEmail) { if ($NonInteractive) { Fail "Owner email is required." };   $OwnerEmail = Read-Host "   Owner email (used to log in)" }
  if (-not $City)       { $City = "Lahore" }

  $users = @( @{ name = $OwnerName; email = $OwnerEmail; role = "OWNER" } )

  if (-not $NonInteractive) {
    while ($true) {
      $more = Read-Host "   Add another staff member? (y / N)"
      if ($more -notmatch '^(y|yes)$') { break }
      $n = Read-Host "     Full name"
      $e = Read-Host "     Email"
      $r = (Read-Host "     Role - type one: ACCOUNTANT / MANAGER / OPERATOR / SECURITY").ToUpper()
      if (@("ACCOUNTANT","MANAGER","OPERATOR","SECURITY") -notcontains $r) { $r = "OPERATOR" }
      $users += @{ name = $n; email = $e; role = $r }
    }
  }

  $cfg = @{ facility = @{ name = $Company; city = $City }; loadChartOfAccounts = $true; users = $users }
  $cfgPath  = Join-Path (Get-Location) ".client-setup.json"
  [System.IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
  $cfgMount = ($cfgPath -replace '\\','/')

  Step "Creating your facility, owner account, and chart of accounts..."
  Write-Host ""
  docker compose --env-file $EnvFile run --rm -T -v "${cfgMount}:/app/cfg.json:ro" -e CLIENT_CONFIG=/app/cfg.json migrate pnpm --filter @coldchain/db run db:provision
  $provExit = $LASTEXITCODE
  Remove-Item $cfgPath -Force -ErrorAction SilentlyContinue
  if ($provExit -ne 0) { Fail "Setup could not be completed. Please contact your ColdChain provider with a photo of this screen." }

  Write-Host ""
  Say "   ^^^^^  IMPORTANT  ^^^^^" Yellow
  Say "   Write down the temporary password(s) shown above and give each person theirs." Yellow
  Say "   Everyone is asked to set their own new password the first time they log in." Yellow
}

# ------------------------------------------------- 7) Automatic updates from now on
# Best-effort: registering a Scheduled Task needs elevation. If it fails the box still
# works perfectly, it just won't update itself — so warn, never Fail. Making the
# install fragile to buy auto-update would be a bad trade.
#
# Registered in THIS user's context, not SYSTEM: Docker Desktop runs in a user session,
# so a SYSTEM task at 3am with nobody logged in would find no Docker and quietly do
# nothing forever. -StartWhenAvailable catches boxes that were switched off overnight
# and runs the update shortly after the next logon instead.
Step "Setting up automatic updates..."
try {
  $taskName = "ColdChain Auto Update"
  $action   = New-ScheduledTaskAction -Execute "powershell.exe" `
                -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'update.ps1')`" -Tag stable" `
                -WorkingDirectory $PSScriptRoot
  $trigger  = New-ScheduledTaskTrigger -Daily -At 3am
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopIfGoingOnBatteries `
                -ExecutionTimeLimit (New-TimeSpan -Hours 2)
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description "Downloads and installs ColdChain updates, including database changes." `
    -User $env:USERNAME -RunLevel Highest -Force -ErrorAction Stop | Out-Null
  Say "   OK - ColdChain will update itself automatically (checked nightly)." Green
} catch {
  Say "   Could not schedule automatic updates (this needs 'Run as administrator')." Yellow
  Say "   ColdChain works fine without it. To enable later, right-click install.bat" Yellow
  Say "   and choose 'Run as administrator'." Yellow
}

# ---------------------------------------------------------------- 8) Done - show how to open it
# Real LAN IP = the adapter that has a default gateway (the Wi-Fi / Ethernet NIC).
# This deliberately skips Docker/WSL virtual adapters (e.g. 172.17.x on "vEthernet (WSL)")
# and link-local 169.254.x - none of which a phone on the facility Wi-Fi can reach.
$ip = $null
try {
  $ip = (Get-NetIPConfiguration -ErrorAction Stop |
         Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq 'Up' } |
         Select-Object -First 1).IPv4Address.IPAddress
} catch { }
if (-not $ip) {
  try {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
           Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and
                          $_.InterfaceAlias -notmatch "vEthernet|WSL|Docker|Loopback" } |
           Select-Object -First 1).IPAddress
  } catch { }
}

Write-Host ""
Say "==========================================================" Green
Say "   ColdChain is installed and running!" Green
Write-Host ""
Say "   On THIS computer:                 http://localhost/" Green
if ($ip) { Say "   On phones / tablets (same Wi-Fi):  http://$ip/" Green }
Say "==========================================================" Green
Write-Host ""
Say "   It starts automatically whenever this computer (and Docker Desktop) is on."
try { Start-Process "http://localhost/" } catch { }
