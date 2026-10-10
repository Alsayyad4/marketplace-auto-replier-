# Builds dist/subsell-webstore.zip — the Chrome Web Store package (v0.21.81).
# Only the extension's runtime files, flat at the zip root, with the STORE manifest
# (no dev key, narrowed hosts — see store/webstore-manifest.js). The fleet zips
# (dist/subsell-extension.zip, dist/subsell-installer.zip) are NOT touched: they keep
# the key so unpacked installs keep their ID.
# Run from anywhere:  powershell -ExecutionPolicy Bypass -File store\build-webstore-zip.ps1
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$stage = Join-Path $env:TEMP ("subsell-webstore-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stage | Out-Null
$files = @("content.js", "options.html", "options.js", "popup.html", "popup.js", "managed_schema.json", "icon16.png", "icon48.png", "icon128.png")
foreach ($f in $files) { Copy-Item (Join-Path $repo $f) (Join-Path $stage $f) }
# (v0.21.83) background.js without the folder self-updater (store/webstore-background.js)
& node (Join-Path $repo "store\webstore-background.js") (Join-Path $repo "background.js") (Join-Path $stage "background.js")
if ($LASTEXITCODE -ne 0) { throw "store background failed" }
& node (Join-Path $repo "store\webstore-manifest.js") (Join-Path $repo "manifest.json") (Join-Path $stage "manifest.json")
if ($LASTEXITCODE -ne 0) { throw "store manifest failed" }
$out = Join-Path $repo "dist\subsell-webstore.zip"
if (Test-Path $out) { Remove-Item $out -Force }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $out -CompressionLevel Optimal
Remove-Item $stage -Recurse -Force
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [IO.Compression.ZipFile]::OpenRead($out)
$names = ($z.Entries | ForEach-Object { $_.FullName }) -join ", "
$count = $z.Entries.Count
$mf = $z.GetEntry("manifest.json")
$r = New-Object IO.StreamReader($mf.Open()); $mtext = $r.ReadToEnd(); $r.Close()
$z.Dispose()
$hasKey = $mtext -match '"key"'
Write-Output ("zip: " + $out)
Write-Output ("entries (" + $count + "): " + $names)
Write-Output ("manifest has key: " + $hasKey + "   size: " + (Get-Item $out).Length + " bytes")
if ($hasKey) { throw "the store manifest still carries the key" }
