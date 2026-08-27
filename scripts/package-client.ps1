<#
.SYNOPSIS
  Build the installer folder a customer receives, as dist/ColdChain-<version>.zip.

.DESCRIPTION
  This file is the ONLY declaration of what a customer gets. Before it existed the
  folder was assembled by hand, so the file list lived in somebody's memory — and
  install.ps1 checks for exactly one of its siblings (update.ps1), so a missing
  Caddyfile or app-role.sql would not surface until the customer ran it.

  Hence the one rule that matters here: a listed file that is absent is a FAILURE,
  never a warning. A zip that is quietly nine files is worse than no zip.

  The archive keeps a top-level "ColdChain" folder so what the customer unzips is a
  folder, not a scatter of loose files into their Downloads.

.EXAMPLE
  pwsh -File scripts/package-client.ps1 -Version v0.5.1
#>
[CmdletBinding()]
param(
  # Defaults to the newest tag reachable from HEAD.
  [string]$Version,
  [string]$OutDir = "dist"
)

$ErrorActionPreference = 'Stop'

# Everything the customer needs, and nothing else.
#
# Deliberately EXCLUDED, so nobody adds them back as a "fix":
#   .env.production.example — install.ps1 generates .env.production with real
#     secrets; a sample beside it invites editing the wrong file.
#   CLAUDE.md / PROGRESS.md / TESTING.md — internal.
#   dist/SETUP-STEPS.md — a re-provisioning runbook that destroys existing data.
#     It is for whoever runs the install, never for the customer.
$Payload = @(
  'install.bat'
  'install.ps1'
  'update.ps1'
  'docker-compose.yml'
  'Caddyfile'
  'INSTALL.md'
  'backup.bat'
  'backup.ps1'
  'restore.ps1'
  'scripts/app-role.sql'
)

$repo = Split-Path -Parent $PSScriptRoot
Push-Location $repo
try {
  if (-not $Version) {
    $Version = (& git describe --tags --abbrev=0 2>$null)
    if (-not $Version) { throw "No -Version given and no git tag found. Pass -Version v0.5.1." }
  }

  # Check every file BEFORE copying anything, so the failure names all of them at
  # once rather than one per re-run.
  $missing = $Payload | Where-Object { -not (Test-Path (Join-Path $repo $_)) }
  if ($missing) {
    throw "Cannot package: $($missing.Count) file(s) listed in `$Payload do not exist:`n  " +
          ($missing -join "`n  ")
  }

  $stage = Join-Path $repo "$OutDir/ColdChain"
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
  New-Item -ItemType Directory -Path $stage -Force | Out-Null

  foreach ($f in $Payload) {
    $dest = Join-Path $stage $f
    New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
    Copy-Item (Join-Path $repo $f) $dest -Force
  }

  $zip = Join-Path $repo "$OutDir/ColdChain-$Version.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }
  Compress-Archive -Path $stage -DestinationPath $zip -CompressionLevel Optimal

  $count = (Get-ChildItem $stage -Recurse -File).Count
  if ($count -ne $Payload.Count) {
    throw "Staged $count files, expected $($Payload.Count). Refusing to ship a partial folder."
  }

  Write-Host "OK - $zip ($count files)" -ForegroundColor Green
  Write-Output $zip
}
finally {
  Pop-Location
}
