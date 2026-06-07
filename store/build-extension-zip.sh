#!/usr/bin/env bash
# Build a clean Chrome Web Store ZIP containing ONLY the extension runtime files.
# Excludes the web app (docs/), backend (supabase/), this store/ folder, deploy/,
# and docs/markdown. Strips the manifest "key" field so the Web Store assigns its
# own extension ID.
#
# Usage:  bash store/build-extension-zip.sh
# Output: dist/subsell-extension.zip
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
STAGE="$DIST/subsell-extension"
ZIP="$DIST/subsell-extension.zip"

# Files that make up the actual extension (must match manifest.json references).
FILES=(
  manifest.json
  background.js
  content.js
  popup.html
  popup.js
  options.html
  options.js
  managed_schema.json
  icon16.png
  icon48.png
  icon128.png
)

rm -rf "$STAGE" "$ZIP"
mkdir -p "$STAGE"

for f in "${FILES[@]}"; do
  if [ ! -f "$ROOT/$f" ]; then
    echo "ERROR: missing required file: $f" >&2
    exit 1
  fi
  cp "$ROOT/$f" "$STAGE/$f"
done

# Strip the "key" field from the store manifest (CWS issues its own ID).
node -e '
  const fs = require("fs");
  const p = process.argv[1];
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  delete m.key;
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
  console.log("manifest.json: removed \"key\" for store build (version " + m.version + ")");
' "$STAGE/manifest.json"

# Zip the staged folder's CONTENTS (manifest.json must be at the zip root).
( cd "$STAGE" && zip -r -X "$ZIP" . -x '.*' >/dev/null )

echo "Built: $ZIP"
echo "Contents:"
( cd "$STAGE" && ls -1 )
echo
echo "Next: upload dist/subsell-extension.zip in the Chrome Web Store dashboard."
echo "See store/STORE-SUBMISSION.md for the full walkthrough."
