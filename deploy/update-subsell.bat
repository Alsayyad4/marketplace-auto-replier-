@echo off
REM SubSell auto-updater — downloads the latest extension build and mirrors it into
REM the fixed unpacked folder. The extension notices the new files on disk and
REM reloads itself (see background.js self-update watcher). Safe to run any time;
REM if the download fails, the existing installation is left untouched.

set DEST=C:\subsell-extension
set URL=https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/dist/subsell-extension.zip

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "try {" ^
  "  $tmpZip = Join-Path $env:TEMP 'subsell-update.zip';" ^
  "  $tmpDir = Join-Path $env:TEMP 'subsell-update-x';" ^
  "  Invoke-WebRequest -Uri '%URL%' -OutFile $tmpZip -UseBasicParsing;" ^
  "  if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force };" ^
  "  Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force;" ^
  "  robocopy (Join-Path $tmpDir 'subsell-extension') '%DEST%' /MIR /NJH /NJS | Out-Null;" ^
  "  Write-Host 'SubSell updated in %DEST%';" ^
  "} catch { Write-Host ('Update skipped: ' + $_.Exception.Message) }"
