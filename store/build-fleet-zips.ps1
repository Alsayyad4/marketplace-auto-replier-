# Builds the FLEET zips — dist/subsell-extension.zip and its operator-facing copy
# dist/subsell-installer.zip (v0.21.91; before this the staging was done by hand, see the
# .71 commit). The repo manifest.json WITH its key (unpacked installs keep their id) +
# INSTALL.txt, every runtime file flat at the zip root. The Web Store zip is a different
# build: store/build-webstore-zip.ps1.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File store\build-fleet-zips.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP ("subsell-fleet-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
$files = @("background.js", "content.js", "options.html", "options.js", "popup.html", "popup.js", "managed_schema.json", "manifest.json", "icon16.png", "icon48.png", "icon128.png")
foreach ($f in $files) { Copy-Item (Join-Path $repo $f) (Join-Path $stage $f) }
[IO.File]::WriteAllText((Join-Path $stage "INSTALL.txt"), "SubSell - Load unpacked (chrome://extensions -> Developer mode -> Load unpacked).`n")
$out = Join-Path $repo "dist\subsell-extension.zip"
$copy = Join-Path $repo "dist\subsell-installer.zip"
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $out -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
Copy-Item $out $copy -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($out)
$names = ($z.Entries | ForEach-Object { $_.FullName }) -join ", "
$count = $z.Entries.Count
$mf = $z.GetEntry("manifest.json")
$r = New-Object IO.StreamReader($mf.Open()); $mtext = $r.ReadToEnd(); $r.Close()
$z.Dispose()
$hasKey = $mtext -match '"key"'
$ver = ([regex]::Match($mtext, '"version"\s*:\s*"([^"]+)"')).Groups[1].Value
Write-Output ("zip: " + $out + "  (+ copy " + $copy + ")")
Write-Output ("entries (" + $count + "): " + $names)
Write-Output ("manifest has key: " + $hasKey + "   version: " + $ver + "   size: " + (Get-Item $out).Length + " bytes")
if (-not $hasKey) { throw "the fleet manifest lost its key" }
if ($count -ne 12) { throw "expected 12 entries, got " + $count }
