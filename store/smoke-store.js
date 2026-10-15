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
const same = ["manifest_version", "name", "version", "storage", "background", "icons", "action", "content_scripts", "options_page", "options_ui", "web_accessible_resources", "minimum_chrome_version"];
ok(same.every((k) => JSON.stringify(m[k]) === JSON.stringify(fleet[k])), "everything else is byte for byte the fleet manifest");
ok(typeof m.description === "string" && m.description.length > 40 && m.description.length <= 132, "the store description fits the Web Store limit (132) — " + m.description.length + " chars");
ok(m.version === fleet.version && /^\d+\.\d+\.\d+$/.test(m.version), "same version as the fleet build — v" + m.version);
ok(!("update_url" in m), "no update_url is written by hand (Chrome adds it to a store install; that is how STORE_BUILD knows)");
ok(fleet.permissions.includes("debugger") && fleet.permissions.includes("activeTab"), "the fleet manifest keeps debugger (file-API channels) and activeTab");
ok(!m.permissions.includes("debugger") && !m.permissions.includes("activeTab"), "the store manifest drops debugger and activeTab — " + m.permissions.join(", "));
ok(["storage", "unlimitedStorage", "alarms", "notifications", "tabs", "scripting", "downloads"].every((p) => m.permissions.includes(p)) && m.permissions.length === 7, "…and keeps exactly the seven the single purpose needs");
const ct = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
ok(/const HAS_DEBUGGER = safe\(\(\) => \(chrome\.runtime\.getManifest\(\)\.permissions \|\| \[\]\)\.indexOf\("debugger"\) >= 0, true\);\s*\n\s*if \(!HAS_DEBUGGER\) cdpDisabledUntil = Number\.MAX_SAFE_INTEGER;/.test(ct), "content.js parks the file-API channels for good when the permission is absent (btn / dom / paste carry the videos)");
ok(/if \(!canCdp\) order = order\.filter\(\(c\) => c === "paste" \|\| c === "dom" \|\| c === "btn"\);/.test(ct), "…which is the existing no-debugger order: btn, dom, paste");
ok(/async function cdpSetFiles\(tabId, paths, channel\) \{\s*if \(!chrome\.debugger\)/.test(bg) && /async function cdpSend\(tabId, mode\) \{\s*if \(!chrome\.debugger\)/.test(bg) && /async function cdpActivate\(tabId, opts\) \{\s*if \(!chrome\.debugger\)/.test(bg) && /async function cdpDoctor\(tabId\) \{\s*if \(!chrome\.debugger\)/.test(bg), "every debugger entry point in the worker answers 'unavailable' instead of throwing");

/* 2 — the runtime guard */
ok(/const STORE_BUILD = \(\(\) => \{ try \{ return !!chrome\.runtime\.getManifest\(\)\.update_url; \} catch \(e\) \{ return false; \} \}\)\(\);/.test(bg), "STORE_BUILD reads the manifest's update_url");
ok(/async function cloudSelfUpdate\(force\) \{\s*if \(STORE_BUILD\) \{[\s\S]{0,400}return \{ ok: true, upToDate: true, store: true, version: v, reason: "store build" \};/.test(bg), "cloudSelfUpdate returns at once in a store build (no Downloads probe, no junk folder)");
ok(/async function selfUpdateCheck\(\) \{\s*if \(STORE_BUILD\) return;/.test(bg), "selfUpdateCheck returns at once in a store build");
ok(/" \| sud: " \+ \(STORE_BUILD \? "STORE\(Chrome updates it\) " : ""\)/.test(bg), "the diagnostic's sud line says STORE");

/* 3 — the popup */
ok(/if \(r\.store\) \$\("updStatus"\)\.textContent = "v" \+ r\.version \+ " — the Chrome Web Store updates it by itself";/.test(popupSrc), "the popup's Update now says the Store updates it");

/* 4 — (v0.21.83) the store background.js carries no self-updater */
const { storeBackground } = require("./webstore-background.js");
const sb = storeBackground(bg);
ok(!/raw\.githubusercontent|SUD_RAW|SUD_FILES|sudDownload|chrome\.runtime\.reload\(/.test(sb), "the store background.js has no remote-file download and no self-reload");
ok(/const STORE_BUILD = true;/.test(sb) && /async function cloudSelfUpdate\(\) \{/.test(sb) && /async function selfUpdateCheck\(\) \{/.test(sb), "…and keeps the three stubs the rest of the file calls");
let parses = true;
try { new Function(sb); } catch (e) { parses = String(e.message); } // a syntax check only: the function is never called
ok(parses === true, "the store background.js parses — " + parses);
ok(/raw\.githubusercontent/.test(bg) && /chrome\.runtime\.reload\(/.test(bg), "the fleet background.js keeps its updater");
ok(sb.length < bg.length && sb.slice(0, 2000) === bg.slice(0, 2000) && sb.slice(-2000) === bg.slice(-2000), "everything outside the markers is the fleet file byte for byte");
const ps1 = fs.readFileSync(path.join(__dirname, "build-webstore-zip.ps1"), "utf8");
ok(/webstore-background\.js/.test(ps1) && !/\$files = @\("background\.js"/.test(ps1), "the store zip builder writes the stripped background.js, never the fleet one");

/* 5 — (v0.21.83) prominent disclosure and consent before the first Turn ON */
const popupHtml = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
ok(/id="consent"/.test(popupHtml) && /sends replies for you automatically/.test(popupHtml) && /sent to Anthropic/.test(popupHtml) && /id="consentYes"/.test(popupHtml), "the popup has the consent panel saying what is sent and where");
ok(/if \(!settings\.enabled && !\(await askConsent\(\)\)\) return;/.test(popupSrc) && /sendConsent: \{ at: Date\.now\(\) \}/.test(popupSrc), "turning ON waits for the consent, once per computer");

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
