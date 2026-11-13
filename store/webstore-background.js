// The Chrome Web Store build of background.js (v0.21.83): the folder self-updater —
// which downloads the extension's own files from GitHub into its unpacked folder and
// reloads — is removed. Chrome updates a store install, and the store forbids code that
// fetches executable code. Everything between the STORE-STRIP markers is replaced by
// three stubs with the same names, so the rest of background.js is byte for byte the
// fleet file. Used by store/build-webstore-zip.ps1 and store/smoke-store.js.
"use strict";

const BEGIN = "/* ===== STORE-STRIP:BEGIN";
const END = "/* ===== STORE-STRIP:END ===== */";
const STUB = [
  "/* ===== (Chrome Web Store build) the folder self-updater is not part of this package:",
  " * Chrome updates a store install by itself. ===== */",
  "const STORE_BUILD = true;",
  "async function cloudSelfUpdate() {",
  "  let v = \"?\";",
  "  try { v = chrome.runtime.getManifest().version; } catch (e) { /* keep ? */ }",
  "  try { chrome.storage.local.set({ sudStatus: \"Chrome Web Store build v\" + v + \" — Chrome updates it by itself\" }, () => void chrome.runtime.lastError); } catch (e) { /* ignore */ }",
  "  return { ok: true, upToDate: true, store: true, version: v, reason: \"store build\" };",
  "}",
  "async function selfUpdateCheck() { /* nothing lands on disk by hand in a store install */ }",
].join("\n");

function storeBackground(src) {
  const a = src.indexOf(BEGIN);
  const b = src.indexOf(END);
  if (a < 0 || b < 0 || b < a) throw new Error("STORE-STRIP markers not found in background.js");
  if (src.indexOf(BEGIN, a + 1) >= 0 || src.indexOf(END, b + 1) >= 0) throw new Error("STORE-STRIP markers are not unique");
  return src.slice(0, a) + STUB + src.slice(b + END.length);
}

module.exports = { storeBackground, BEGIN, END };

if (require.main === module) {
  // node store/webstore-background.js <fleet background.js> <out background.js>
  const fs = require("fs");
  const [, , inPath, outPath] = process.argv;
  if (!inPath || !outPath) { console.error("usage: node store/webstore-background.js <in> <out>"); process.exit(2); }
  const src = fs.readFileSync(inPath, "utf8");
  const out = storeBackground(src);
  fs.writeFileSync(outPath, out);
  console.log("store background.js written: " + src.length + " → " + out.length + " chars (self-updater removed)");
}
