// The Chrome Web Store manifest, derived from the fleet manifest (v0.21.81).
//   - no "key": the Store issues its own extension ID (the unpacked fleet keeps
//     jdbjbonhdnfkkfihbodmhpmccoiajflm through the key);
//   - host permissions narrowed to the four hosts the single purpose needs — the
//     broad <all_urls> of the fleet build forces an in-depth review;
//   - everything else byte for byte (name, version, permissions, worker, icons).
// Used by store/build-webstore-zip.ps1 and store/smoke-store.js.
"use strict";

const STORE_HOSTS = [
  "https://*.messenger.com/*",
  "https://*.facebook.com/*",
  "https://api.anthropic.com/*",
  "https://*.supabase.co/*",
];

function storeManifest(fleet) {
  const m = JSON.parse(JSON.stringify(fleet));
  delete m.key;
  m.host_permissions = STORE_HOSTS.slice();
  return m;
}

module.exports = { storeManifest, STORE_HOSTS };

if (require.main === module) {
  // node store/webstore-manifest.js <fleet manifest.json> <out manifest.json>
  const fs = require("fs");
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error("usage: node store/webstore-manifest.js <in> <out>"); process.exit(2); }
  const out = storeManifest(JSON.parse(fs.readFileSync(inPath, "utf8")));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log("store manifest written: v" + out.version + ", no key, hosts = " + out.host_permissions.join(", "));
}
