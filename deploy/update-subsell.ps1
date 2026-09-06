# SubSell fleet updater — finds every unpacked SubSell install on this computer
# (whatever folder it was loaded from, any Chrome profile), downloads the latest
# build once, and updates each install IN PLACE. The extension (v0.18.2+) notices
# the new files and reloads itself. Safe: does nothing when already up to date;
# never touches settings/logins (those live in Chrome profile storage).

$ErrorActionPreference = "SilentlyContinue"
$zipUrl = "https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/dist/subsell-extension.zip"

# --- 1. Discover unpacked SubSell installs from Chrome's profile preferences ---
$targets = @()
foreach ($userData in Get-ChildItem -Path "$env:LOCALAPPDATA\Google\Chrome*\User Data" -Directory -ErrorAction SilentlyContinue) {
  $prefFiles = Get-ChildItem -Path $userData.FullName -Depth 2 -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq "Preferences" -or $_.Name -eq "Secure Preferences" }
  foreach ($pf in $prefFiles) {
    try { $j = Get-Content $pf.FullName -Raw | ConvertFrom-Json } catch { continue }
    $settings = $j.extensions.settings
    if (-not $settings) { continue }
    foreach ($p in $settings.PSObject.Properties) {
      $path = $p.Value.path
      if ($path -and ($path -match "^[A-Za-z]:\\")) {
        $mf = Join-Path $path "manifest.json"
        if (Test-Path $mf) {
          try { $m = Get-Content $mf -Raw | ConvertFrom-Json } catch { continue }
          if ($m.name -like "*SubSell*") { $targets += $path }
        }
      }
    }
  }
}
$targets = $targets | Sort-Object -Unique
if (-not $targets) { Write-Host "No SubSell install found on this computer."; exit 0 }

# --- 2. Download the latest build (once) ---
$tmpZip = Join-Path $env:TEMP "subsell-update.zip"
$tmpDir = Join-Path $env:TEMP "subsell-update-x"
try {
  Invoke-WebRequest -Uri $zipUrl -OutFile $tmpZip -UseBasicParsing -ErrorAction Stop
} catch { Write-Host "Download failed — keeping current version."; exit 0 }
if (Test-Path $tmpDir) { Remove-Item $tmpDir -Recurse -Force }
Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force
$src = Join-Path $tmpDir "subsell-extension"
$newManifest = Join-Path $src "manifest.json"
if (-not (Test-Path $newManifest)) { Write-Host "Bad download — keeping current version."; exit 0 }
$newV = (Get-Content $newManifest -Raw | ConvertFrom-Json).version

# --- 3. Update each install in place, only when the version differs ---
foreach ($t in $targets) {
  $curV = ""
  try { $curV = (Get-Content (Join-Path $t "manifest.json") -Raw | ConvertFrom-Json).version } catch {}
  if ($curV -eq $newV) { Write-Host "Already up to date ($curV): $t"; continue }
  robocopy $src $t /MIR /NJH /NJS | Out-Null
  Write-Host "Updated $curV -> $newV : $t"
}

# --- 4. Keep THIS updater itself fresh for the next run (self-updating pipeline) ---
try {
  $self = $MyInvocation.MyCommand.Path
  $tmpSelf = "$self.new"
  Invoke-WebRequest -Uri "https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/deploy/update-subsell.ps1" -OutFile $tmpSelf -UseBasicParsing -ErrorAction Stop
  if ((Get-Item $tmpSelf).Length -gt 500) { Move-Item -Force $tmpSelf $self } else { Remove-Item $tmpSelf -Force }
} catch {}
Write-Host "Done."
