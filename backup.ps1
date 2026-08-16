<#
  ColdChain - take a database backup, any time.

  You do NOT need this for updates: update.ps1 already dumps the database before
  every update. This is for the times you want a copy on demand - before entering
  a season's opening balances, before someone experiments, or just because it is
  Friday.

  HOW TO USE: right-click backup.bat -> Run, or from PowerShell in this folder:
    powershell -ExecutionPolicy Bypass -File backup.ps1

  The file lands in the `backups` folder next to this script.
#>
#Requires -Version 5
[CmdletBinding()]
param()

$ErrorActionPreference = "Continue"
Set-Location -Path $PSScriptRoot

$EnvFile = ".env.production"
if (-not (Test-Path $EnvFile)) { Write-Host "No $EnvFile - is ColdChain installed in this folder?" -ForegroundColor Red; exit 1 }
if (-not (Test-Path "backups")) { New-Item -ItemType Directory "backups" | Out-Null }

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

$ts  = Get-Date -Format "yyyyMMdd-HHmmss"
$out = "backups\coldchain-$ts.sql.gz"

Write-Host "Backing up the database..." -ForegroundColor Cyan

# Dump AND gzip inside the container, then copy the finished file out. PowerShell must
# never sit in the middle of the byte stream - piping pg_dump through it re-encodes the
# output and corrupts Urdu party names. `--clean --if-exists` so restore.ps1 can replay
# it into a database that already has tables.
docker compose --env-file $EnvFile exec -T -e PGPASSWORD=$pgPass postgres `
  sh -c "pg_dump -U '$pgUser' -d '$pgDb' --clean --if-exists | gzip -9 > /tmp/coldchain-backup.sql.gz"
if ($LASTEXITCODE -ne 0) {
  Write-Host "Backup FAILED. Is ColdChain running? Open Docker Desktop and check." -ForegroundColor Red
  exit 1
}
docker compose --env-file $EnvFile cp "postgres:/tmp/coldchain-backup.sql.gz" $out *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Could not copy the backup out of the container." -ForegroundColor Red; exit 1 }

# Rotate, so an unattended schedule cannot fill the disk with nobody watching.
$keep = Get-EnvValue 'BACKUP_RETENTION_DAYS'
if (-not $keep) { $keep = 30 }
Get-ChildItem "backups" -Filter "coldchain-*.sql.gz" -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-[int]$keep) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

$size = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ""
Write-Host "Backup saved: $out  ($size MB)" -ForegroundColor Green
Write-Host "Keep a copy somewhere other than this computer - a backup on the same PC does" -ForegroundColor Yellow
Write-Host "not survive the thing most likely to destroy the data." -ForegroundColor Yellow
exit 0
