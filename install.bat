@echo off
REM ===================================================================
REM  ColdChain installer - just DOUBLE-CLICK this file.
REM  It runs the installer and keeps this window open at the end.
REM ===================================================================
setlocal
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*

echo.
echo ===================================================================
echo  You can close this window now.
echo ===================================================================
pause >nul
