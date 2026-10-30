/* Tests THE CALM COMPUTER (background.js, v0.21.80).
 *
 * Why this file exists: Oct 8 2026, operator: "the system crashing opening tabs to
 * upload the videos and keep doing that, we can't even use the computer, we can't even
 * close the tabs that is opening". The heartbeat un-minimized every Chrome window that
 * holds Messenger within a minute of a person minimizing it (.44, default on), and
 * reopened a Messenger tab ten minutes after a person closed it (.18). Both now respect
 * the person, and nothing on-screen happens while a person is using the computer.
 *
 * Under test (the pure decisions, sliced from background.js, plus the call sites):
 *   1. a Messenger tab a person closed is not reopened for 3 hours; a second close the
 *      same day keeps it closed until the next morning (07:00); the day boundary resets;
 *   2. the bot never opens a tab while a person was seen in the last 15 minutes, and
 *      keeps the old 10-minute cooldown;
 *   3. un-minimizing is OFF unless this computer opted in (keepWindowsRestored:true),
 *      and even then never while a person is here;
 *   4. the call sites: ensureMarketplaceTab decides with calmReopenDecision, the
 *      heartbeat with calmRestoreDecision, videoForeground refuses for a person, the
 *      tab-switch and cascade helpers stop for a person, a removed Messenger tab is
 *      recorded, the bot's own window/tab changes never count as a person
 *      (botActing before every chrome.windows.update / tabs.update / tabs.create);
 *   5. the content script reports trusted input only, never while the engine is busy,
 *      at most once a minute; the popup has the Computer row; the Options page has the
 *      opt-in switch; the dashboard says the log keeps 5 days.
 *
 * Run:  node store/smoke-calm.js
 */
const fs = require("fs");
const path = require("path");
const bg = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const ct = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const popupSrc = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
const optionsHtml = fs.readFileSync(path.join(__dirname, "..", "options.html"), "utf8");
const optionsSrc = fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");

const from = bg.indexOf("/* ===== (v0.21.80) THE CALM COMPUTER (pure) =====");
const to = bg.indexOf("/* ===== end calm (pure) ===== */");
if (from < 0 || to < 0) { console.error("calm block not found in background.js"); process.exit(1); }
const block = bg.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

const api = new Function(block + "; return { untilNextMorning, noteTabClosed, calmReopenDecision, calmRestoreDecision, HUMAN_ACTIVE_MS, CLOSE_RESPECT_MS, AUTO_OPEN_COOLDOWN_MS };")();
const MIN = 60 * 1000, HOUR = 60 * MIN;
const T = (h, m) => { const d = new Date(2026, 9, 8, h, m || 0, 0, 0); return d.getTime(); }; // Oct 8 2026, local time

/* 1 — a person's close */
let rec = api.noteTabClosed(null, T(10, 12));
ok(rec.n === 1 && rec.until === T(10, 12) + 3 * HOUR, "first close of the day: closed for 3 hours — until " + new Date(rec.until).toLocaleTimeString());
let d = api.calmReopenDecision(rec, 0, 0, T(11, 0));
ok(d.open === false && d.why === "closed by a person" && d.reopenAt === rec.until, "an hour later the bot does not reopen it");
d = api.calmReopenDecision(rec, 0, 0, T(13, 13));
ok(d.open === true, "after 3 hours it may reopen (in the background)");
const rec2 = api.noteTabClosed(rec, T(13, 20)); // the person closes it again right after the reopen
ok(rec2.n === 2 && rec2.until === T(7, 0) + 24 * HOUR, "a second close the same day: closed until 07:00 tomorrow — " + new Date(rec2.until).toLocaleString());
ok(api.calmReopenDecision(rec2, 0, 0, T(23, 59)).open === false && api.calmReopenDecision(rec2, 0, 0, T(7, 1) + 24 * HOUR).open === true, "…not at midnight, yes at 07:01 the next day");
const rec3 = api.noteTabClosed(rec2, T(9, 0) + 24 * HOUR); // a new day: a close counts as the first again
ok(rec3.n === 1 && rec3.until === T(9, 0) + 24 * HOUR + 3 * HOUR, "a close on the next day starts over: 3 hours");
ok(api.untilNextMorning(T(6, 30)) === T(7, 0) && api.untilNextMorning(T(7, 0)) === T(7, 0) + 24 * HOUR, "untilNextMorning: 06:30 → 07:00 today; 07:00 → 07:00 tomorrow");
ok(api.calmReopenDecision({ at: T(8, 0), n: 1, until: T(11, 0) }, 0, 0, T(11, 0)).open === true, "the respect ends exactly at `until`");
ok(api.calmReopenDecision(null, 0, 0, T(12, 0)).open === true, "no record at all: the old keep-forced-open behaviour");

/* 2 — a person at the computer, and the cooldown */
d = api.calmReopenDecision(null, T(12, 0), 0, T(12, 10));
ok(d.open === false && d.why === "a person is using the computer" && d.reopenAt === T(12, 0) + api.HUMAN_ACTIVE_MS, "a person seen 10 min ago: no tab opens");
ok(api.calmReopenDecision(null, T(12, 0), 0, T(12, 16)).open === true, "…16 min after the last sign of a person it may");
d = api.calmReopenDecision(null, 0, T(12, 0), T(12, 5));
ok(d.open === false && d.why === "cooldown", "the 10-minute cooldown between auto-opens still holds");
ok(api.calmReopenDecision(null, 0, T(12, 0), T(12, 11)).open === true, "…and ends after 10 min");
ok(api.calmReopenDecision({ at: T(8, 0), n: 1, until: T(11, 0) }, T(12, 0), 0, T(12, 5)).why === "a person is using the computer", "an expired close record does not hide a person at the keyboard");

/* 3 — un-minimizing is opt-in and polite */
ok(api.calmRestoreDecision({}, 0, T(12, 0)) === false, "no local switch: a minimized window is left alone (the .44 default is gone)");
ok(api.calmRestoreDecision({ keepWindowsRestored: false }, 0, T(12, 0)) === false, "keepWindowsRestored:false: left alone");
ok(api.calmRestoreDecision({ keepWindowsRestored: "true" }, 0, T(12, 0)) === false, "only a real boolean true opts in");
ok(api.calmRestoreDecision({ keepWindowsRestored: true }, 0, T(12, 0)) === true, "keepWindowsRestored:true on this computer: restored");
ok(api.calmRestoreDecision({ keepWindowsRestored: true }, T(11, 50), T(12, 0)) === false, "…but not while a person was seen 10 min ago");
ok(api.calmRestoreDecision({ keepWindowsRestored: true }, T(11, 40), T(12, 0)) === true, "…20 min of quiet: restored again");

/* 4 — the call sites (source) */
const ensure = bg.slice(bg.indexOf("async function ensureMarketplaceTab()"), bg.indexOf("const PING_MISSES_TO_RELOAD"));
ok(/calmReopenDecision\(st\.tabClosed \|\| null, humanAt, st\.lastAutoOpenAt \|\| 0, Date\.now\(\)\)/.test(ensure) && /if \(!d\.open\) return;/.test(ensure), "ensureMarketplaceTab decides with calmReopenDecision");
ok(/botActing\(5000\);[\s\S]{0,200}chrome\.tabs\.create\(/.test(ensure) && /active: false, pinned: true/.test(ensure), "the tab it opens is marked as the bot's own, in the background, pinned");
const hb = bg.slice(bg.indexOf("async function heartbeat()"), bg.indexOf("// Fold the heartbeat into the existing alarm listener path."));
ok(/if \(calmRestoreDecision\(kw, humanAt, Date\.now\(\)\)\) for \(const wid of wids\)/.test(hb), "the heartbeat un-minimizes only on calmRestoreDecision");
ok(!/kw\.keepWindowsRestored !== false/.test(hb), "the old default-on test is gone");
ok(/for \(const t of tabs\) botTabs\.add\(t\.id\);/.test(hb), "the heartbeat remembers which tabs are Messenger tabs (so a close can be read)");
ok(/if \(kw\.videoActivateTab !== true \|\| humanActive\(\)\) break;/.test(hb), "the tab-switch helper stops for a person");
ok(/if \(kw\.keepWindowsCascaded === true && !humanActive\(\)\)/.test(hb), "the window cascade stops for a person");
const upd = hb.match(/chrome\.(windows|tabs)\.update\(/g) || [];
const guarded = hb.match(/botActing\(3000\);[\s\S]{0,120}chrome\.(windows|tabs)\.update\(/g) || [];
ok(upd.length === 3 && guarded.length === 3, "every window/tab change in the heartbeat is marked as the bot's own first — " + guarded.length + "/" + upd.length);
const fg = bg.slice(bg.indexOf("async function videoForeground("), bg.indexOf("// ---- (v0.21.49) PAGE VISIBILITY SHIM ----"));
ok(/if \(humanActive\(\)\) \{\s*fgRefused\+\+;\s*return \{ ok: false, error: "a person is using this computer/.test(fg), "window-to-front is refused while a person is using the computer");
ok(/botActing\(5000\);[\s\S]{0,200}getLastFocused/.test(fg) && /botActing\(3000\);\s*if \(prev != null/.test(fg), "its own focus changes (front and hand-back) never count as a person");
ok(/chrome\.tabs\.onRemoved\.addListener\(\(tabId, info\) => \{\s*if \(!botTabs\.has\(tabId\)\) return;/.test(bg) && /const rec = noteTabClosed\(\(x && x\.tabClosed\) \|\| null, Date\.now\(\)\);/.test(bg), "a removed Messenger tab is recorded as a person's close");
ok(/chrome\.windows\.onFocusChanged\.addListener\(\(\) => noteHuman\("window focus"\)\)/.test(bg) && /chrome\.tabs\.onActivated\.addListener\(\(\) => noteHuman\("tab switch"\)\)/.test(bg), "focus and tab changes are read as a person (unless the bot made them)");
ok(/function noteHuman\(why\) \{\s*const now = Date\.now\(\);\s*if \(now < botActUntil\) return;/.test(bg), "noteHuman ignores events inside the bot's own window");
ok(/case "HUMAN_SEEN": \{[\s\S]{0,200}noteHuman\(msg\.what \|\| "input"\);/.test(bg), "the content script's report is taken");
ok(/calm: \{ humanAt, humanActive: humanActive\(\), tabClosed: door\.tabClosed \|\| null, restore: door\.keepWindowsRestored === true, fgRefused \}/.test(bg), "GET_STATUS carries the calm state for the popup");
ok(/"calm: human=" \+/.test(bg), "the diagnostic has a calm line");

/* 5 — content / popup / options / dashboard */
ok(/function humanSeen\(ev\) \{\s*if \(!ev \|\| !ev\.isTrusted \|\| busy\) return;/.test(ct) && /if \(now - humanSeenAt < 60000\) return;/.test(ct), "the content script reports trusted input only, never while busy, once a minute");
ok(/for \(const t of \["pointerdown", "keydown", "wheel", "mousemove"\]\) document\.addEventListener\(t, humanSeen, \{ capture: true, passive: true \}\);/.test(ct), "…for pointer, keys, wheel and mouse moves");
ok(/<div>Computer<\/div><div id="calm">/.test(popupHtml) && /Messenger tab closed by hand at/.test(popupSrc) && /someone is using it/.test(popupSrc) && /free — the bot works in the background/.test(popupSrc), "the popup has the Computer row with its three states");
ok(/id="keepWindowsRestored"/.test(optionsHtml) && /"keepWindowsRestored"\]/.test(optionsSrc), "the Options page has the opt-in switch, stored locally");
ok(/messages in the last 5 days/.test(appSrc) && /older messages are deleted automatically/.test(appSrc), "the dashboard says the log keeps 5 days");

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
