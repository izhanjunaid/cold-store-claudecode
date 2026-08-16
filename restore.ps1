<#
  ColdChain - restore a database backup.

  DESTRUCTIVE. This replaces the current database with the contents of the backup
  file. Everything entered since that backup was taken is lost. It is a last
  resort, not a first response - if an update failed, the previous version is
  already running with the data untouched and you probably need nothing at all.

  HOW TO USE, from PowerShell in this folder:
    powershell -ExecutionPolicy Bypass -File restore.ps1 -File backups\coldchain-20260815-140000.sql.gz

  It asks you to type RESTORE before doing anything.
#>
#Requires -Version 5
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$File,
  [switch]$Yes
)

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$EnvFile = ".env.production"
if (-not (Test-Path $EnvFile)) { Write-Host "No $EnvFile - is ColdChain installed in this folder?" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $File))    { Write-Host "Backup file not found: $File" -ForegroundColor Red; exit 1 }

function Get-EnvValue([string]$key) {
  $m = [regex]::Match((Get-Content $EnvFile -Raw), "(?m)^$key=(.*)$")
  if ($m.Success) { return $m.Groups[1].Value.Trim() }
  return ""
}

$pgUser = Get-EnvValue 'POSTGRES_USER'
$pgDb   = Get-EnvValue 'POSTGRES_DB'
$pgPass = Get-EnvValue 'POSTGRES_PASSWORD'

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Docker Desktop is not running. Start it, wait for 'Engine running', then try again." -ForegroundColor Red
  exit 1
}

$taken = (Get-Item $File).LastWriteTime
Write-Host ""
Write-Host "About to REPLACE the live database with:" -ForegroundColor Yellow
Write-Host "  $File" -ForegroundColor Yellow
Write-Host "  taken $taken" -ForegroundColor Yellow
Write-Host ""
Write-Host "Everything entered since then will be lost permanently." -ForegroundColor Red

if (-not $Yes) {
  $answer = Read-Host "Type RESTORE to continue, anything else to abort"
  if ($answer -cne 'RESTORE') { Write-Host "Aborted - nothing was changed." -ForegroundColor Green; exit 0 }
}

# Safety net: dump what is about to be overwritten. Restoring the wrong file is a
# recoverable mistake only if the current state was captured first.
Write-Host "Taking a safety backup of the CURRENT database first..." -ForegroundColor Cyan
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1')
if ($LASTEXITCODE -ne 0) {
  Write-Host "The safety backup failed, so the restore is being abandoned." -ForegroundColor Red
  Write-Host "Nothing was changed." -ForegroundColor Red
  exit 1
}

Write-Host "Restoring..." -ForegroundColor Cyan

# Copy the archive in and unpack it inside the container: same reason backup.ps1 dumps
# there, PowerShell must not touch the byte stream. The dump carries --clean
# --if-exists, so it drops and recreates each object as it goes.
docker compose --env-file $EnvFile cp $File "postgres:/tmp/coldchain-restore.sql.gz" *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Could not copy the backup into the container." -ForegroundColor Red; exit 1 }

docker compose --env-file $EnvFile exec -T -e PGPASSWORD=$pgPass postgres `
  sh -c "gunzip -c /tmp/coldchain-restore.sql.gz | psql -v ON_ERROR_STOP=1 -U '$pgUser' -d '$pgDb'"
$restoreExit = $LASTEXITCODE
docker compose --env-file $EnvFile exec -T postgres rm -f /tmp/coldchain-restore.sql.gz *> $null

if ($restoreExit -ne 0) {
  Write-Host ""
  Write-Host "RESTORE FAILED. The database may be half-written - do not use ColdChain until this is sorted." -ForegroundColor Red
  Write-Host "The safety backup taken a moment ago is the newest file in the backups folder." -ForegroundColor Red
  Write-Host "Send that file and this screen to your ColdChain provider." -ForegroundColor Red
  exit 1
}

# The app caches nothing across a restart, but the API holds pooled connections to a
# database whose contents just changed underneath it.
Write-Host "Restarting ColdChain..." -ForegroundColor Cyan
docker compose --env-file $EnvFile restart api web *> $null

Write-Host ""
Write-Host "Restore complete. Open http://localhost/ and check the data looks right." -ForegroundColor Green
exit 0
