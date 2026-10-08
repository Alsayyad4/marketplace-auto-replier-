/* Tests the Chrome Web Store build (v0.21.81).
 *
 * Why this file exists: Oct 8 2026 the fleet's own STALE BUILD rows showed a dozen
 * computers that cannot self-update from the unpacked folder (Chrome's "Ask where to
 * save each file", folders the updater cannot find). A store install is updated by
 * Chrome itself — and must therefore never run the folder-based updater.
 *
 * Under test:
 *   1. the store manifest: no "key", the four hosts only, everything else identical;
 *   2. background.js: STORE_BUILD reads the manifest's update_url; cloudSelfUpdate and
 *      selfUpdateCheck return at once in a store build; the diagnostic says so;
 *   3. the popup's Update button says the Store updates it;
 *   4. the fleet manifest still carries the key and <all_urls> (the unpacked fleet keeps
 *      its ID and its updater).
 *
 * Run:  node store/smoke-store.js
 */
const fs = require("fs");
const path = require("path");
const { storeManifest, STORE_HOSTS } = require("./webstore-manifest.js");
const fleet = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const bg = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const popupSrc = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

/* 1 — the store manifest */
const m = storeManifest(fleet);
ok(!("key" in m) && typeof fleet.key === "string" && fleet.key.length > 100, "the store manifest has no key; the fleet manifest keeps its key");
ok(JSON.stringify(m.host_permissions) === JSON.stringify(STORE_HOSTS) && m.host_permissions.length === 4 && !m.host_permissions.includes("<all_urls>"), "the store manifest asks for the four hosts only — " + m.host_permissions.join(", "));
ok(fleet.host_permissions.includes("<all_urls>"), "the fleet manifest keeps <all_urls>");
const same = ["manifest_version", "name", "version", "description", "permissions", "storage", "background", "icons", "action", "content_scripts", "options_page", "options_ui", "web_accessible_resources", "minimum_chrome_version"];
ok(same.every((k) => JSON.stringify(m[k]) === JSON.stringify(fleet[k])), "everything else is byte for byte the fleet manifest");
ok(m.version === fleet.version && /^\d+\.\d+\.\d+$/.test(m.version), "same version as the fleet build — v" + m.version);
ok(!("update_url" in m), "no update_url is written by hand (Chrome adds it to a store install; that is how STORE_BUILD knows)");
ok(fleet.permissions.includes("debugger") && fleet.permissions.includes("downloads") && m.permissions.includes("debugger"), "the permissions the single purpose needs stay (debugger attaches the video file, downloads keeps the clips on disk)");

/* 2 — the runtime guard */
ok(/const STORE_BUILD = \(\(\) => \{ try \{ return !!chrome\.runtime\.getManifest\(\)\.update_url; \} catch \(e\) \{ return false; \} \}\)\(\);/.test(bg), "STORE_BUILD reads the manifest's update_url");
ok(/async function cloudSelfUpdate\(force\) \{\s*if \(STORE_BUILD\) \{[\s\S]{0,400}return \{ ok: true, upToDate: true, store: true, version: v, reason: "store build" \};/.test(bg), "cloudSelfUpdate returns at once in a store build (no Downloads probe, no junk folder)");
ok(/async function selfUpdateCheck\(\) \{\s*if \(STORE_BUILD\) return;/.test(bg), "selfUpdateCheck returns at once in a store build");
ok(/" \| sud: " \+ \(STORE_BUILD \? "STORE\(Chrome updates it\) " : ""\)/.test(bg), "the diagnostic's sud line says STORE");

/* 3 — the popup */
ok(/if \(r\.store\) \$\("updStatus"\)\.textContent = "v" \+ r\.version \+ " — the Chrome Web Store updates it by itself";/.test(popupSrc), "the popup's Update now says the Store updates it");

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
