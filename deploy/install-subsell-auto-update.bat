@echo off
REM ============================================================
REM  SubSell auto-update installer - DOUBLE-CLICK ONCE PER COMPUTER
REM  No admin needed. No folders to move. No Chrome steps.
REM  It finds SubSell wherever it is installed, updates it now,
REM  and sets an hourly task so this computer updates itself forever.
REM ============================================================

set DIR=%LOCALAPPDATA%\SubSellUpdater
mkdir "%DIR%" 2>nul

echo Downloading the updater...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/deploy/update-subsell.ps1' -OutFile '%DIR%\update-subsell.ps1'"
if not exist "%DIR%\update-subsell.ps1" (
  echo Could not download the updater. Check the internet connection and run me again.
  pause
  exit /b 1
)

echo Setting up the hourly auto-update task...
schtasks /Create /F /SC HOURLY /TN "SubSell Update" /TR "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%\update-subsell.ps1\"" >nul 2>&1
if errorlevel 1 (
  REM Fallback when task creation is blocked: update at every Windows login instead.
  reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v SubSellUpdate /t REG_SZ /d "powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%DIR%\update-subsell.ps1\"" /f >nul
  echo Hourly task blocked - will update at every Windows login instead.
)

echo Running the first update now...
powershell -NoProfile -ExecutionPolicy Bypass -File "%DIR%\update-subsell.ps1"

echo.
echo ============================================================
echo  DONE. This computer now updates SubSell by itself.
echo  FIRST TIME ONLY: if SubSell was older than 0.18.2, restart
echo  Chrome once (or press the reload arrow on chrome://extensions).
echo  After that, updates apply automatically - zero clicks.
echo ============================================================
pause
