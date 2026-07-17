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
  [string]$Tag = "latest",
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

# Make the requested version the one the stack actually runs, even on an EXISTING box — so
# `install.bat -Tag vX.Y.Z` truly updates it (the .env above is only written on first install).
$envText = Get-Content $EnvFile -Raw
if ($envText -match '(?m)^COLDCHAIN_TAG=') {
  $envText = [regex]::Replace($envText, '(?m)^COLDCHAIN_TAG=.*$', "COLDCHAIN_TAG=$Tag")
} else {
  $envText = $envText.TrimEnd() + "`nCOLDCHAIN_TAG=$Tag`n"
}
# Boxes installed before the F-2a hardening lack the app-role credentials — add them.
if ($envText -notmatch '(?m)^APP_DB_PASSWORD=') {
  $envText = $envText.TrimEnd() + "`nAPP_DB_USER=coldchain_app`nAPP_DB_PASSWORD=$(New-Secret 24)`n"
}
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $EnvFile), $envText, (New-Object System.Text.ASCIIEncoding))
Say "   Version: $Tag" Green

# ---------------------------------------------------------------- 3) Download images
if (-not $SkipPull) {
  Step "Downloading ColdChain (the first time can take several minutes)..."
  Compose pull
  if ($LASTEXITCODE -ne 0) { Say "   Could not download (no internet?). Will try local copies..." Yellow }
}

docker image inspect "$Registry/coldchain-api:$Tag" *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "ColdChain has not been downloaded yet. Connect this computer to the internet and run the installer again (only the first install needs internet)."
}

# ---------------------------------------------------------------- 4) Start
# Postgres first: the least-privilege role the api connects as (F-2a) must exist
# before the api container starts, and its default-privilege setup must run
# before migrations create the tables.
Step "Preparing the database..."
Compose up -d postgres
if ($LASTEXITCODE -ne 0) { Fail "Database failed to start. Open Docker Desktop to see the error, then try again." }
$pgReady = $false
for ($i = 0; $i -lt 30; $i++) {
  docker compose --env-file $EnvFile exec -T postgres pg_isready -U coldchain -d coldchain *> $null
  if ($LASTEXITCODE -eq 0) { $pgReady = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $pgReady) { Fail "Database did not become ready. Open Docker Desktop to check the postgres container, then try again." }

$appPw = ([regex]::Match((Get-Content $EnvFile -Raw), '(?m)^APP_DB_PASSWORD=(.*)$')).Groups[1].Value.Trim()
if (-not $appPw) { Fail "APP_DB_PASSWORD missing from $EnvFile - delete the file and run the installer again." }
Get-Content (Join-Path $PSScriptRoot "scripts\app-role.sql") -Raw |
  docker compose --env-file $EnvFile exec -T postgres psql -U coldchain -d coldchain -v ON_ERROR_STOP=1 -v app_password=$appPw -f -
if ($LASTEXITCODE -ne 0) { Fail "Could not set up the database role. Please contact your ColdChain provider with a photo of this screen." }
Say "   OK - database role ready." Green

Step "Starting ColdChain..."
Compose up -d
if ($LASTEXITCODE -ne 0) { Fail "ColdChain failed to start. Open Docker Desktop to see the error, then try again." }

# ---------------------------------------------------------------- 5) Wait until ready
Step "Waiting for ColdChain to be ready..."
$ready = $false
for ($i = 0; $i -lt 60; $i++) {
  try {
    if ((Invoke-WebRequest -UseBasicParsing -TimeoutSec 4 "http://localhost/health").StatusCode -eq 200) { $ready = $true; break }
  } catch { }
  Write-Host -NoNewline "."
  Start-Sleep -Seconds 3
}
Write-Host ""
if (-not $ready) { Fail "ColdChain did not come up in time. Open Docker Desktop to check the containers, then run the installer again." }
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

# ---------------------------------------------------------------- 7) Done - show how to open it
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
