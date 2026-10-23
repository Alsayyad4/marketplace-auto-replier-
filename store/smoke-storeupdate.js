/* (v0.21.90) A STORE UPDATE INSTALLS ITSELF.
 * Owner, Oct 23 2026: "should be only from the link, I don't want to play with developer
 * modes". Chrome installs a downloaded update only when the extension is idle; SubSell never
 * is, so v0.21.89 sat downloaded 22 h on the owner's PC and computers showed old versions.
 *
 * Under test:
 *   1. storeUpdateDecision (pure, sliced from background.js between its markers): nothing to
 *      do / wait while Settings or the popup is open / pause new chats, settle 10 s, apply /
 *      a busy tab holds the pause at most 20 min, then resume and rest an hour / give up after
 *      3 tries / the popup's force skips the UI wait, the rest and the tries but never a send;
 *   2. the wiring: onUpdateAvailable → storeUpdateNoted, the 2-hourly requestUpdateCheck, the
 *      30-s tick, PAUSE/RESUME_SCANS, the popup's Update now, GET_STATUS, the diagnostic;
 *   3. nothing of it runs in an unpacked install.
 * Run:  node store/smoke-storeupdate.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bg = R("background.js"), popup = R("popup.js"), ct = R("content.js");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a); if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s); if (e < 0) { console.error("end not found: " + b); process.exit(1); }
  return src.slice(s, e);
}
const slice = between(bg, "const STORE_UPD_KEY = ", "/* ===== STORE UPDATE END ===== */");
ok(!/chrome\./.test(slice.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "the decision slice is free of chrome.* (pure)");
const U = new Function(slice + "\nreturn { storeUpdateDecision, verCmp, STORE_UPD_SETTLE_MS, STORE_UPD_PAUSE_MAX_MS, STORE_UPD_MAX_TRIES };")();
const D = U.storeUpdateDecision;
const NOW = 1792000000000;
const base = { now: NOW, loaded: "0.21.90", busy: false, uiOpen: false, force: false };
const o = (p) => Object.assign({}, base, p);

console.log("— 1. the decision —");
ok(U.verCmp("0.21.91", "0.21.90") === 1 && U.verCmp("0.21.9", "0.21.10") === -1 && U.verCmp("0.21.90", "0.21.90") === 0 && U.verCmp("1.0", "0.99.99") === 1, "versions compare as numbers (0.21.9 < 0.21.10)");
ok(D({}, base).act === "none" && D(null, base).act === "none" && D({ version: "" }, base).act === "none", "no ready version = nothing to do");
ok(D({ version: "0.21.90" }, base).act === "none" && D({ version: "0.21.89" }, base).act === "none", "a version already running (or older) = nothing to do — never a reload loop");
ok(D({ version: "0.21.91" }, o({ uiOpen: true })).act === "wait", "Settings or the popup open = wait (a reload would close it and what was typed)");
ok(D({ version: "0.21.91" }, base).act === "pause", "ready + quiet + no hold yet = hold new chats first (never reload in the same instant as a scan)");
ok(D({ version: "0.21.91", pauseAt: NOW - 3000 }, base).act === "pause", "…held 3 s = keep holding (the settle is 10 s)");
ok(D({ version: "0.21.91", pauseAt: NOW - 11000 }, base).act === "apply", "…held 11 s and no tab mid-send = install now");
ok(D({ version: "0.21.91", pauseAt: NOW - 11000 }, o({ busy: true })).act === "pause", "a tab mid-send = keep holding, never cut a reply");
ok(D({ version: "0.21.91", pauseAt: NOW - 21 * 60000 }, o({ busy: true })).act === "resume", "a tab busy for 20 min = the bot resumes (buyers are never held longer)");
ok(D({ version: "0.21.91", backoffUntil: NOW + 60000 }, base).act === "rest", "…and rests an hour before trying again");
ok(D({ version: "0.21.91", backoffUntil: NOW - 1 }, base).act === "pause", "…then tries again");
ok(D({ version: "0.21.91", tries: 3 }, base).act === "giveup", "a version that did not install after 3 reloads is left to Chrome (its next restart)");
ok(D({ version: "0.21.91", pauseAt: NOW - 11000, tries: 3, backoffUntil: NOW + 60000 }, o({ uiOpen: true, force: true })).act === "apply", "the popup's Update now skips the UI wait, the rest and the tries…");
ok(D({ version: "0.21.91", pauseAt: NOW - 11000 }, o({ busy: true, force: true })).act === "pause" && D({ version: "0.21.91" }, o({ force: true })).act === "pause", "…but never a reply in flight, nor the settle");

console.log("\n— 2. the wiring —");
const code = bg.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
ok(/if \(chrome\.runtime\.onUpdateAvailable\) chrome\.runtime\.onUpdateAvailable\.addListener\(\(d\) => \{ storeUpdateNoted\(d && d\.version\); \}\);/.test(code), "onUpdateAvailable (registered at the top level) notes the ready version");
ok(/async function storeUpdateNoted\(version\) \{\s*\n\s*if \(!STORE_BUILD \|\| !version\) return;[\s\S]{0,400}chrome\.alarms\.create\(STORE_UPD_TICK, \{ periodInMinutes: 0\.5 \}\);[\s\S]{0,200}storeUpdateTick\(false\);/.test(code), "…arms the 30-s tick and ticks at once");
ok(/ensureAlarm\(STORE_UPD_ALARM, \{ periodInMinutes: 120 \}\);/.test(code) && /if \(alarm\.name === STORE_UPD_ALARM\) storeUpdateCheck\("every 2 h"\);/.test(code), "Chrome is asked for an update every 2 h");
ok(/chrome\.runtime\.onStartup\.addListener\(\(\) => \{ storeUpdateCheck\("start-up"\); storeUpdateTick\(false\); \}\);/.test(code), "…and at start-up");
ok(/async function storeUpdateCheck\(why\) \{\s*\n\s*if \(!STORE_BUILD \|\| !chrome\.runtime\.requestUpdateCheck\) return \{ status: "unsupported" \};/.test(code), "the check only runs in a store install");
ok(/async function storeUpdateTick\(force\) \{\s*\n\s*if \(!STORE_BUILD \|\| storeUpdTicking\) return/.test(code), "the tick only runs in a store install, one at a time");
ok(/const d = storeUpdateDecision\(s, \{ now, loaded, busy: await storeUpdTabsBusy\(\), uiOpen: force \? false : await storeUpdUiOpen\(\), force: !!force \}\);/.test(code), "the tick feeds the decision: tabs mid-send (PING busy), Settings/popup open (getContexts)");
ok(/\} else if \(d\.act === "pause"\) \{\s*\n\s*storeUpdBroadcast\("PAUSE_SCANS"\);/.test(code) && /\} else if \(d\.act === "resume"\) \{\s*\n\s*storeUpdBroadcast\("RESUME_SCANS"\);/.test(code), "pause / resume go to every bot tab");
ok(/if \(d\.act === "wait" \|\| d\.act === "rest"\) \{\s*\n\s*if \(s\.pauseAt\) \{ storeUpdBroadcast\("RESUME_SCANS"\);/.test(code), "while it waits or rests, the bot keeps working (any hold is lifted)");
ok(/if \(s\.version && verCmp\(s\.version, loaded\) <= 0\) \{[\s\S]{0,500}appliedVersion: loaded[\s\S]{0,300}if \(s\.pauseAt\) storeUpdBroadcast\("RESUME_SCANS"\);/.test(code), "once installed: the state records it and lifts any hold");
ok(/chrome\.runtime\.onInstalled\.addListener\(\(\) => \{ storeUpdateTick\(false\); \}\);/.test(code) && /chrome\.runtime\.onInstalled\.addListener\(\(\) => reinjectAllTabs\(\)\);/.test(code), "after the reload: the open Messenger tabs get the new content.js and the state is closed");
ok(/sendResponse\(STORE_BUILD \? await storeUpdateNow\(\) : await cloudSelfUpdate\(true\)\);/.test(code), "the popup's Update now: store = install now / ask Chrome; folder install = the old updater, untouched");
ok(/storeUpdate: STORE_BUILD \? await storeUpdRead\(\) : null,/.test(bg), "GET_STATUS carries the ready version for the popup"); // bg, not code: a "https://*.x/*" string reads as a comment to the stripper
ok(/"storeUpdate", \/\/ \(v0\.21\.90\)/.test(bg) && /STORE\(installs itself\) upd=/.test(bg), "the diagnostic names it (sud: STORE(installs itself) upd=…)");
ok(/function storeUpdText\(r\)/.test(popup) && /installs itself at the next quiet moment/.test(popup) && !/developer/i.test(popup.slice(popup.indexOf("function storeUpdText"), popup.indexOf("function storeUpdText") + 1500)), "the popup's words never send anyone to developer mode");
ok(/if \(msg && msg\.type === "PAUSE_SCANS"\) \{[\s\S]{0,300}pausedForUpdate = Date\.now\(\);/.test(ct) && /if \(msg && msg\.type === "RESUME_SCANS"\) \{\s*\n\s*pausedForUpdate = 0;/.test(ct) && /if \(Date\.now\(\) - pausedForUpdate < 10 \* 60 \* 1000\) \{/.test(ct), "content.js already honours PAUSE/RESUME_SCANS (its own hold lapses after 10 min)");
const stripA = bg.indexOf("/* ===== STORE-STRIP:BEGIN"), stripB = bg.indexOf("/* ===== STORE-STRIP:END ===== */"), blockAt = bg.indexOf("/* ===== (v0.21.90) A STORE UPDATE INSTALLS ITSELF");
ok(blockAt > stripB && stripB > stripA, "the block sits AFTER the store strip: it ships in the store build");
const { storeBackground } = require("./webstore-background.js");
const sb = storeBackground(bg);
ok(/storeUpdateDecision/.test(sb) && /onUpdateAvailable/.test(sb), "…and is in the store background.js");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
