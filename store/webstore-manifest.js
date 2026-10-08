// The Chrome Web Store manifest, derived from the fleet manifest (v0.21.81).
//   - no "key": the Store issues its own extension ID (the unpacked fleet keeps
//     jdbjbonhdnfkkfihbodmhpmccoiajflm through the key);
//   - host permissions narrowed to the four hosts the single purpose needs — the
//     broad <all_urls> of the fleet build forces an in-depth review;
//   - (v0.21.82) no "debugger" — the permission reviewers refuse most; its video
//     channels (input / chooser / drop, trusted presses) are fallbacks or opt-in power
//     features, the production channel ("btn") needs no debugger, and content.js parks
//     the file-API channels for good when the permission is absent; no "activeTab" —
//     nothing has used it since the .49 tab-capture button was removed in .51;
//   - everything else byte for byte (name, version, worker, icons, content scripts).
// Used by store/build-webstore-zip.ps1 and store/smoke-store.js.
"use strict";

const STORE_HOSTS = [
  "https://*.messenger.com/*",
  "https://*.facebook.com/*",
  "https://api.anthropic.com/*",
  "https://*.supabase.co/*",
];
const STORE_DROP_PERMISSIONS = ["debugger", "activeTab"];

function storeManifest(fleet) {
  const m = JSON.parse(JSON.stringify(fleet));
  delete m.key;
  m.host_permissions = STORE_HOSTS.slice();
  m.permissions = (m.permissions || []).filter((p) => STORE_DROP_PERMISSIONS.indexOf(p) < 0);
  return m;
}

module.exports = { storeManifest, STORE_HOSTS, STORE_DROP_PERMISSIONS };

if (require.main === module) {
  // node store/webstore-manifest.js <fleet manifest.json> <out manifest.json>
  const fs = require("fs");
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error("usage: node store/webstore-manifest.js <in> <out>"); process.exit(2); }
  const out = storeManifest(JSON.parse(fs.readFileSync(inPath, "utf8")));
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
  console.log("store manifest written: v" + out.version + ", no key, hosts = " + out.host_permissions.join(", ") + ", permissions = " + out.permissions.join(", "));
}
