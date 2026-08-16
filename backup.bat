@echo off
REM ===================================================================
REM  ColdChain - take a backup of the database right now.
REM  Just DOUBLE-CLICK this file. The backup lands in the backups folder.
REM ===================================================================
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup.ps1" %*

echo.
echo ===================================================================
echo  You can close this window now.
echo ===================================================================
pause >nul
