/* (v0.21.86) THE LIMITS — every setting box that caps the bot is enforced, and honestly.
 * Operator, Oct 14 2026: "the newest Chrome store extension is not respecting the limit
 * of messages … respect the limit and every setting box … the learning phase (warm-up)".
 *
 * Under test (pure functions sliced out of background.js between the LEDGER markers):
 *   1. the ledger: one entry per delivered message, video rows by `n`, failures count 0;
 *   2. sliding windows: never more than hourlyCap in ANY 60 min, dailyCap in ANY 24 h;
 *      0 = unlimited on every path; clips count only with capsCountVideos;
 *   3. the warm-up ramp: day 0 = the start cap, a straight line to the full cap, off /
 *      done / past the ramp = the full cap; the ramp ends on evidence of an account that
 *      was answered BEFORE this install (the Web Store build throttles nobody);
 *   4. the per-chat cap: stop / notify = the cap, close = the last slot is the closing
 *      line; the cloud count (text rows, any computer) is the floor;
 *   5. the cadence roll: a break only with the switch on, inside [min, max] minutes;
 *   6. the wiring: counted on delivery (LOG_EVENT), the old generation-time counters are
 *      gone, every gate asks budgetState, the courtesy close past the cap is gone, the
 *      content script sends its count, the popup and both UIs carry the new boxes.
 * Run:  node store/smoke-limits.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bg = R("background.js"), ct = R("content.js"), popup = R("popup.js"), opt = R("options.js"), optHtml = R("options.html");
const app = R("docs/app.js"), html = R("docs/index.html"), ref = R("SETTINGS-REFERENCE.md");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " → " + b); process.exit(1); }
  return src.slice(s, e);
}

const slice = between(bg, "/* ===== (v0.21.86) THE MESSAGE LEDGER", "/* ===== LEDGER END ===== */");
ok(!/chrome\./.test(slice.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "the LEDGER slice is free of chrome.* (pure, testable)");
const L = new Function(slice + "\nreturn { ledgerUnits, ledgerPrune, ledgerCounts, warmDayOf, effectiveDailyCap, warmEvidence, convoCapLimit, memTextCount, youLineCount, youLinesOf, cadenceBreakMs, budgetVerdict, LEDGER_MAX };")();

const H = 3600 * 1000, D = 86400 * 1000;
const NOW = Date.parse("2026-10-14T15:00:00Z");
const S = { hourlyCap: 30, dailyCap: 200, capsCountVideos: false, warmupEnabled: true, warmupDays: 7, warmupStartCap: 10, maxRepliesPerConvo: 5, convoCapBehavior: "stop", humanCadence: true, breakChance: 0.05, breakMinMin: 3, breakMaxMin: 18 };
const items = (spec) => spec.map(([agoMs, k]) => ({ t: NOW - agoMs, k }));

console.log("— 1. the ledger: what an Activity event is worth —");
ok(L.ledgerUnits({ action: "text" }) === 1 && L.ledgerUnits({ action: "followup" }) === 1, "a text or follow-up row = one message");
ok(L.ledgerUnits({ action: "video", n: 3 }) === 3 && L.ledgerUnits({ action: "video", n: 0 }) === 0, "a video row counts its `n` clips");
ok(L.ledgerUnits({ action: "video", reply: "0/2 demo videos — native attach failed 2×" }) === 0, "a video row WITHOUT n (a failure row) counts nothing — never parsed from the text");
ok(L.ledgerUnits({ action: "video-status" }) === 0 && L.ledgerUnits({ action: "human" }) === 0 && L.ledgerUnits({ action: "gap" }) === 0 && L.ledgerUnits({ action: "teach" }) === 0 && L.ledgerUnits({ action: "claim" }) === 0, "video-status / human / gap / teach / claim rows are not messages");
ok(L.ledgerUnits(null) === 0 && L.ledgerUnits({}) === 0 && L.ledgerUnits({ action: "video", n: "x" }) === 0 && L.ledgerUnits({ action: "text", n: 2.7 }) === 2, "garbage is zero; a fractional n is floored");
{
  const pr = L.ledgerPrune(items([[D + 2 * H, "text"], [D - 60 * 1000, "text"], [10 * 1000, "video"], [-60 * 60 * 1000, "text"], [-2 * D, "text"]]).concat([null, { k: "text" }, { t: "x", k: "text" }]), NOW);
  ok(pr.length === 3 && pr.every((it) => typeof it.t === "number"), "prune keeps the last 24 h (+1 min) and a stamp up to 24 h in the future (a clock that jumped back); drops garbage and a stamp 2 days ahead — kept " + pr.length);
  const fut = L.ledgerCounts(items([[-30 * 60 * 1000, "text"], [-5 * H, "text"]]), NOW, false);
  ok(fut.hour === 2 && fut.day === 2, "future stamps count as 'now' in both windows (the hour never empties after a backward clock jump)");
  const many = []; for (let i = 0; i < L.LEDGER_MAX + 50; i++) many.push({ t: NOW - i * 1000, k: "text" });
  ok(L.ledgerPrune(many, NOW).length === L.LEDGER_MAX, "prune caps the ledger at " + L.LEDGER_MAX + " entries");
}

console.log("\n— 2. sliding windows —");
{
  const it = items([[5 * 60 * 1000, "text"], [30 * 60 * 1000, "text"], [59 * 60 * 1000, "followup"], [61 * 60 * 1000, "text"], [23 * H, "text"], [25 * H, "text"], [20 * 60 * 1000, "video"], [2 * H, "video"]]);
  const c = L.ledgerCounts(it, NOW, false);
  ok(c.hour === 3 && c.day === 5, "texts: 3 in the last 60 min (the one at 61 min is out), 5 in the last 24 h (the one at 25 h is out) — " + c.hour + "/" + c.day);
  ok(c.kinds.hour.video === 1 && c.kinds.day.video === 2, "the clips are counted beside the texts (1 in the hour, 2 in the day)…");
  const cv = L.ledgerCounts(it, NOW, true);
  ok(cv.hour === 4 && cv.day === 7, "…and join the totals only with capsCountVideos on — " + cv.hour + "/" + cv.day);
  // the classic fixed-window leak: 30 sent at 10:59, 30 more at 11:01 was "fine" before
  const burst = []; for (let i = 0; i < 30; i++) burst.push({ t: NOW - 31 * 60 * 1000 - i * 1000, k: "text" });
  const v = L.budgetVerdict(S, burst, NOW, { installTs: NOW - 30 * D, done: null }, null);
  ok(v.ok === false && /hourly cap reached \(30\/30/.test(v.reason), "30 texts 31 minutes ago still fill the hour: a sliding window, not a clock hour — " + v.reason);
  const v2 = L.budgetVerdict(S, burst, NOW + 30 * 60 * 1000, { installTs: NOW - 30 * D, done: null }, null);
  ok(v2.ok === true && v2.hour === 0, "…and 61 minutes after the burst the hour is free again");
  const dayFull = []; for (let i = 0; i < 200; i++) dayFull.push({ t: NOW - 20 * H - i * 1000, k: "text" });
  const v3 = L.budgetVerdict(S, dayFull, NOW, { installTs: NOW - 30 * D, done: null }, null);
  ok(v3.ok === false && /daily cap reached \(200\/200 in the last 24 h\)/.test(v3.reason), "200 texts 20 hours ago fill the day — " + v3.reason);
  ok(L.budgetVerdict(Object.assign({}, S, { hourlyCap: 0, dailyCap: 0 }), dayFull.concat(burst), NOW, { installTs: NOW - 30 * D, done: null }, null).ok === true, "0 = unlimited for both caps (one rule, every path)");
  ok(L.budgetVerdict(Object.assign({}, S, { hourlyCap: "30", dailyCap: "200" }), burst, NOW, { installTs: NOW - 30 * D, done: null }, null).ok === false, "caps saved as strings still count");
  ok(L.budgetVerdict(Object.assign({}, S, { hourlyCap: "", dailyCap: NaN }), burst, NOW, { installTs: NOW - 30 * D, done: null }, null).ok === true, "a blank or broken cap is unlimited, never a silent stop");
}

console.log("\n— 3. the warm-up ramp (the learning phase) —");
{
  const warm = (ageDays, done) => ({ installTs: NOW - ageDays * D, done: done || null });
  ok(L.effectiveDailyCap(S, warm(0), NOW) === 10, "day 0 = the start cap (10)");
  ok(L.effectiveDailyCap(S, warm(3.5), NOW) === 91, "day 3 of 7 = 10 + 190 × 3/7 = 91");
  ok(L.effectiveDailyCap(S, warm(6.9), NOW) === 173, "day 6 of 7 = 173");
  ok(L.effectiveDailyCap(S, warm(7), NOW) === 200 && L.warmDayOf(S, warm(7), NOW) === -1, "day 7 = the ramp is over, the full cap");
  ok(L.effectiveDailyCap(Object.assign({}, S, { warmupEnabled: false }), warm(0), NOW) === 200, "warm-up off = the full cap on day 0");
  ok(L.effectiveDailyCap(S, warm(0, { at: NOW }), NOW) === 200, "warm-up DONE (an established account) = the full cap on day 0");
  ok(L.effectiveDailyCap(Object.assign({}, S, { warmupDays: 0 }), warm(0), NOW) === 200, "0 warm-up days = no ramp");
  ok(L.effectiveDailyCap(Object.assign({}, S, { dailyCap: 0 }), warm(2), NOW) === 10 && L.effectiveDailyCap(Object.assign({}, S, { dailyCap: 0 }), warm(8), NOW) === 0, "an unlimited daily cap still holds the start cap during the ramp, then opens");
  ok(L.effectiveDailyCap(Object.assign({}, S, { warmupStartCap: 300 }), warm(2), NOW) === 200, "a start cap above the full cap never exceeds the owner's daily cap (300 → 200)");
  ok(L.effectiveDailyCap(Object.assign({}, S, { dailyCap: 5 }), warm(0), NOW) === 5 && L.effectiveDailyCap(Object.assign({}, S, { dailyCap: 5 }), warm(3), NOW) === 5, "dailyCap 5 with the default start cap 10 = 5 on every day of the ramp (the owner's cap is the ceiling)");
  ok(L.effectiveDailyCap(S, { installTs: 0, done: null }, NOW) === 200, "no install stamp yet = the full cap (never a silent stop)");
  const v = L.budgetVerdict(S, [], NOW, warm(2), null);
  ok(v.warming === true && v.warmDay === 2 && v.warmDays === 7 && v.dayCap === 64 && v.fullDayCap === 200, "the verdict names the warm-up day and the cap in force (day 3 of 7 → 64)");
  const full = []; for (let i = 0; i < 64; i++) full.push({ t: NOW - 2 * H - i * 1000, k: "text" });
  const v2 = L.budgetVerdict(S, full, NOW, warm(2), null);
  ok(v2.ok === false && /warm-up daily cap reached \(64\/64, day 3 of 7\)/.test(v2.reason), "…and refuses the 65th text of that day — " + v2.reason);
  // evidence of an account answered before this install
  const inst = NOW - 2 * D;
  const rows = (spec) => spec.map(([agoMs, kind, machine]) => ({ created_at: new Date(NOW - agoMs).toISOString(), kind, machine: machine || "PC-old" }));
  ok(L.warmEvidence(rows([[1 * D, "text"], [2 * D - 30 * 60 * 1000, "text"]]), inst, NOW) === null, "rows written AFTER the install (this install's own work) prove nothing — including one 30 min before it (the clock margin)");
  const ev = L.warmEvidence(rows([[1 * D, "text"], [3 * D, "video", "PC-abc · v0.21.82 #PC-abc"]]), inst, NOW);
  ok(ev && ev.kind === "video" && /PC-abc/.test(ev.machine), "one bot row (any computer, text/followup/video) older than the install = an established account — " + JSON.stringify(ev));
  ok(L.warmEvidence(rows([[3 * D, "claim"], [3 * D, "human"], [3 * D, "video-status"], [3 * D, "teach"]]), inst, NOW) === null, "claims, [HUMAN] rows, status rows and receipts are not evidence");
  ok(L.warmEvidence(rows([[3 * D, "text"]]), 0, NOW) === null && L.warmEvidence(null, inst, NOW) === null, "no install stamp or no rows = no evidence");
}

console.log("\n— 4. the per-chat cap —");
{
  ok(JSON.stringify(L.convoCapLimit(S)) === JSON.stringify({ cap: 5, mode: "stop", limit: 5 }), "stop: 5 replies, then silence");
  ok(JSON.stringify(L.convoCapLimit(Object.assign({}, S, { convoCapBehavior: "notify" }))) === JSON.stringify({ cap: 5, mode: "notify", limit: 5 }), "notify: 5 replies, then silence + one notification");
  ok(JSON.stringify(L.convoCapLimit(Object.assign({}, S, { convoCapBehavior: "close" }))) === JSON.stringify({ cap: 5, mode: "close", limit: 4 }), "close: 4 replies, the 5th message is the closing line — never a 6th");
  ok(L.convoCapLimit(Object.assign({}, S, { maxRepliesPerConvo: 0 })).cap === 0 && L.convoCapLimit(Object.assign({}, S, { maxRepliesPerConvo: "" })).cap === 0, "0 or blank = unlimited");
  ok(L.convoCapLimit(Object.assign({}, S, { maxRepliesPerConvo: "3" })).limit === 3, "a cap saved as a string counts");
  ok(L.convoCapLimit(Object.assign({}, S, { maxRepliesPerConvo: 1, convoCapBehavior: "close" })).limit === 1, "cap 1 + close = one reply and no line (never a canned line as the only answer)");
  const rows = [{ kind: "text" }, { kind: "text", machine: "PC-other" }, { kind: "followup" }, { kind: "video" }, { kind: "claim" }, { kind: "text" }];
  ok(L.memTextCount(rows) === 3, "the cloud count is the chat's text rows — replies and closing lines from any computer, not follow-ups, clips or claims");
  ok(L.memTextCount(null) === 0 && L.memTextCount([]) === 0, "no rows = 0 (the other counts decide)");
  const tx = "Buyer: salut\nYou: allô! oui dispo\nYou: [attachment]\nYou: [attachment]\nBuyer: prix?\nYou: on en parle au shop\n  you: ok à+  \nBuyer: You: not ours\nYou:\n";
  ok(L.youLineCount(tx) === 3, "the chat itself: 'You:' lines are seller texts (3), clips and an empty line are not, a buyer line quoting 'You:' is the buyer's");
  ok(L.youLineCount("") === 0 && L.youLineCount(null) === 0 && L.youLineCount("Buyer: hi") === 0, "no transcript or no seller line = 0");
  // (v0.21.91) the content script's own count of confirmed seller bubbles wins over the line count
  ok(L.youLinesOf({ youTexts: 1 }, tx) === 1 && L.youLinesOf({ youTexts: 0 }, tx) === 0, "youTexts from the content script (confirmed own bubbles) replaces the 'You:' line count — a misread buyer bubble no longer fills the cap");
  ok(L.youLinesOf({}, tx) === 3 && L.youLinesOf({ youTexts: null }, tx) === 3 && L.youLinesOf({ youTexts: NaN }, tx) === 3 && L.youLinesOf({ youTexts: -2 }, tx) === 3 && L.youLinesOf({ youTexts: "2" }, tx) === 3, "an older content script (no count, or a bad one) keeps the line count");
  ok(L.youLinesOf({ youTexts: 2.7 }, tx) === 2, "a fractional count is floored");
}

console.log("\n— 5. the cadence roll —");
{
  ok(L.cadenceBreakMs(Object.assign({}, S, { humanCadence: false }), 0, 0.5) === 0, "switch off = never a break");
  ok(L.cadenceBreakMs(S, 0.9, 0.5) === 0, "the roll misses (0.9 ≥ 0.05) = no break");
  const ms = L.cadenceBreakMs(S, 0.01, 0.5);
  ok(ms === Math.round(10.5 * 60 * 1000), "the roll hits = a break of min + (max − min) × r2 = 10.5 min — " + ms);
  ok(L.cadenceBreakMs(S, 0.01, 0) === 3 * 60 * 1000 && L.cadenceBreakMs(S, 0.01, 1) === 18 * 60 * 1000, "…inside [3, 18] minutes");
  ok(L.cadenceBreakMs(Object.assign({}, S, { breakChance: 0 }), 0, 0.5) === 0 && L.cadenceBreakMs(Object.assign({}, S, { breakChance: "x" }), 0, 0.5) === 0, "chance 0 or garbage = no break");
  ok(L.cadenceBreakMs(Object.assign({}, S, { breakMinMin: 20, breakMaxMin: 5 }), 0.01, 1) === 20 * 60 * 1000, "max below min = min");
  const v = L.budgetVerdict(S, [], NOW, { installTs: NOW - 30 * D, done: null }, { until: NOW + 5 * 60 * 1000, at: NOW });
  ok(v.ok === true && v.breakUntil === NOW + 5 * 60 * 1000, "a break is reported beside the caps, not as a cap (a chat already open is still answered)");
  ok(L.budgetVerdict(S, [], NOW, { installTs: NOW - 30 * D, done: null }, { until: NOW - 1000 }).breakUntil === 0, "an expired break is gone");
}

console.log("\n— 6. the wiring —");
ok(!/incrementCounters\(|checkRateLimit\(|rollWindows\(|getCounters\(/.test(bg), "the generation-time counters are gone from background.js");
ok(/case "LOG_EVENT": \{[\s\S]{0,600}await ledgerNote\(entry\);[\s\S]{0,200}if \(entry\.action === "text"\) await cadenceAfterReply\(await getSettings\(\)\);/.test(bg), "LOG_EVENT feeds the ledger and rolls the break after a delivered reply");
ok((bg.match(/const (?:budget|fbudget) = await budgetState\(settings\);/g) || []).length >= 4, "GET_STATUS, GET_REPLY_SIMPLE, GET_FOLLOWUP and the alarm handler all ask budgetState — " + (bg.match(/await budgetState\(settings\)/g) || []).length + " call sites");
ok(/case "GET_REPLY_SIMPLE": \{[\s\S]{0,3000}const budget = await budgetState\(settings\);\s*\n\s*if \(!budget\.ok\) \{\s*\n\s*if \(budget\.warming\) noteWarmHold\(budget\);[^\n]*\n\s*sendResponse\(\{ ok: true, skip: true, held: true, reason: budget\.reason \}\);/.test(bg), "the reply path refuses on the ledger's verdict, before anything is billed — and a warm-up hold is named in the Activity feed once a day");
ok(/const cc = convoCapLimit\(settings\);\s*\n\s*let soFar = cc\.cap \? Math\.max\(Math\.floor\(num0\(msg\.localReplies, 0\)\), youLinesOf\(msg, dropTitleLines\(msg\.memContext, msg\.threadName\) \|\| ctx\)\) : 0;[\s\S]{0,600}if \(cc\.cap && soFar >= cc\.limit\) \{ capAnswer\(\); break; \}/.test(bg), "the reply path caps from this computer's count and the chat's own seller texts (youTexts, else 'You:' lines) BEFORE the memory read (no login needed)"); // (v0.21.91) youLinesOf
ok(/noteWarmEvidence\(settings, memRows\);\s*\n\s*if \(cc\.cap\) \{\s*\n\s*soFar = Math\.max\(soFar, memTextCount\(memRows\)\);\s*\n\s*if \(soFar >= cc\.limit\) \{ memNote\(\{ capCloud: 1 \}\); capAnswer\(\); break; \}/.test(bg), "…then raises the count with the chat's cloud rows and reads the account's age from the same rows");
ok(/case "MEMORY_PRESEND": \{[\s\S]{0,2500}youLinesOf\(msg, dropTitleLines\(msg\.transcript, msg\.threadName\)\), memTextCount\(rows\)\);[\s\S]{0,400}cap: true/.test(bg), "the pre-send recheck applies the cap too, from the fresh rows and the chat's own seller texts"); // (v0.21.91) youLinesOf
ok(/warmEvidence\(rows, installTs \+ memSkewMs, memNow\(\)\)/.test(bg), "the cloud evidence compares the install stamp on SERVER time (memSkewMs)");
ok(/if \(!budget\.ok \|\| budget\.breakUntil\) \{[\s\S]{0,500}chrome\.alarms\.create\(alarm\.name, \{ when \}\);/.test(bg) && !/LOG\("alarm skipped:", rl\.reason\)/.test(bg), "a follow-up / visit alarm due during a cap or a break is parked, not dropped");
ok(/case "CAP_NOTIFY": \{[\s\S]{0,900}notifyHuman\(why, msg\.threadName\);[\s\S]{0,300}action: "human"/.test(bg), "CAP_NOTIFY tells the owner once per chat (notification + [HUMAN] row)");
ok(/case "WARM_EVIDENCE_LOCAL": \{[\s\S]{0,900}if \(n >= 1 && settings\.warmupEnabled\) marked = await markWarmDone\(/.test(bg), "WARM_EVIDENCE_LOCAL ends the ramp on ONE inbox row answered before the install (a new account has none)");
ok(/function sidebarOurRow\(a\)/.test(ct) && /function sidebarAgeMsLoose\(a\)/.test(ct) && /if \(st && st\.ok && st\.budget && st\.budget\.warming && st\.budget\.installTs && Date\.now\(\) - warmLocalAt > 60 \* 1000\) \{[\s\S]{0,700}if \(olderOurs >= 1\) ask\(\{ type: "WARM_EVIDENCE_LOCAL", n: olderOurs \}\);/.test(ct), "the scan judges the inbox's age tags (weeks and years too) once a minute while the ramp runs — before the pause, so the cap cannot hold the evidence back");
ok(/function noteWarmHold\(budget\)/.test(bg) && /warmHoldNotedAt/.test(bg) && /action: "video-status", reply: "warm-up holds this computer at "/.test(bg), "a computer held by the warm-up writes one visible Activity row a day naming the cure");
ok(/"caps: hour=" \+ b\.hour \+ "\/" \+ \(b\.hourCap \|\| "inf"\)/.test(bg), "the diagnostic has a caps: line");
ok(/budget, \/\/ \(v0\.21\.86\)/.test(bg) && /hourCount: budget\.hour,/.test(bg), "GET_STATUS carries the verdict and the older field names");
ok(/capsCountVideos: false,/.test(bg) && /capsCountVideos: false,/.test(opt) && /capsCountVideos: false,/.test(app), "capsCountVideos defaults to false in all three DEFAULTS");
// content.js
ok(!/replyCap \+ 1/.test(ct) && !/courtesy close/i.test(ct.replace(/the old courtesy close was a cap\+1 message/, "")), "the courtesy close past the cap is gone from content.js");
ok(/function convoCapOf\(settings\)/.test(ct) && /async function atConvoCap\(id, name, sidebarId, turn, settings, cc, so, why, noVideo\)/.test(ct), "one cap handler for every path (convoCapOf + atConvoCap)");
ok(/if \(replyCap > 0 && repliesSoFar >= cc\.limit\) \{\s*\n\s*await atConvoCap\(id, name, sidebarId, turn, settings, cc, repliesSoFar, "", false\);\s*\n\s*return;/.test(ct), "the local check runs before the model is asked");
ok(/type: "GET_REPLY_SIMPLE"[^\n]*localReplies: repliesSoFar/.test(ct) && /type: "MEMORY_PRESEND"[^\n]*localReplies: replyCounts\[id\] \|\| 0/.test(ct), "the content script sends its own count with both asks");
ok(/if \(reply\.cap\) \{[\s\S]{0,700}await atConvoCap\(id, name, sidebarId, turn, settings, convoCapOf\(settings\), Math\.max\(repliesSoFar, Number\(reply\.replies\) \|\| 0\), "counted across computers", false\);/.test(ct), "a cloud-counted cap is handled like the local one — (v0.21.91) the verdict comes before the clip engine, so atConvoCap takes the one clip pass itself");
ok(/if \(pre\.cap\) \{[\s\S]{0,400}await atConvoCap\(/.test(ct), "…and so is a cap reached during the wait");
ok(/if \(cc\.mode === "close" && so < cc\.cap && stillOnThread\(id\)\)[\s\S]{0,2500}replyCounts\[id\] = cc\.cap;/.test(ct), "close mode: the closing line is the cap's last message and fills the count");
ok(/const stC = await ask\(\{ type: "GET_STATUS" \}\);\s*\n\s*if \(stC && stC\.ok && stC\.budget && !stC\.budget\.ok\) \{[\s\S]{0,200}return;/.test(ct), "…it keeps to the hour / day caps (held to the next message otherwise)");
ok(/const fresh = await ask\(\{ type: "MEMORY_PRESEND", threadId: id, threadName: name, buyerMessage: turn\.buyerMessage, transcript: [^\n]*localReplies: so, youTexts: ownTextsNow\(turn\) \}\);\s*\n\s*if \(fresh && fresh\.ok && fresh\.skip && \(!fresh\.cap \|\| \(Number\(fresh\.replies\) \|\| 0\) >= cc\.cap\)\) \{/.test(ct), "…takes the reply path's fresh look at the chat's memory first (another computer may have closed it), with the chat's own seller count"); // (v0.21.91) youTexts
ok(/const paceC = typingPaceMs\(closeLine, settings\);\s*\n\s*if \(paceC > 0\) await sleep\(paceC\);/.test(ct), "…and waits its typing pace like a reply");
ok(/if \(cc\.mode === "notify"\) \{\s*\n\s*ask\(\{ type: "CAP_NOTIFY"/.test(ct), "notify mode asks the background to tell the owner once");
ok(/const b = st\.budget;\s*\n\s*if \(b && !b\.ok\) \{\s*\n\s*setStatus\(\{ lastAction: "paused — " \+ b\.reason \+ " \(chats stay unread\)" \}\);\s*\n\s*return;/.test(ct), "the scan gate pauses on the ledger's verdict (chats stay unread, as before)");
ok(/if \(b && b\.breakUntil && b\.breakUntil > Date\.now\(\)\) cadenceBreakUntil = b\.breakUntil;/.test(ct) && /const owedClips = videoPending\[tid\] != null \|\| \(adoptedAlias\[tid\] != null && videoPending\[adoptedAlias\[tid\]\] != null\);\s*\n\s*if \(!owedClips && cadenceBreakUntil\) \{[\s\S]{0,500}return;/.test(ct), "a cadence break holds the pick — except a chat owed clips (videos instantly)");
ok(/if \(!owedClips && settings\.humanCadence && Math\.random\(\) < Math\.min\(1, Math\.max\(0, Number\(settings\.skipChance\) \|\| 0\)\)\) \{[\s\S]{0,300}return;/.test(ct), "skipChance is rolled on a real pick only, never on a chat owed clips (nothing opened, nothing marked read)");
const pickAt = ct.indexOf("const tid = threadId(target);"), lockAt = ct.indexOf("if (!(await acquireThreadLock(tid)))"), brkAt = ct.indexOf("if (!owedClips && cadenceBreakUntil)");
ok(pickAt > 0 && brkAt > pickAt && lockAt > brkAt, "…and both sit after the pick and before the lock (the lease is never burned by a pause)");
ok(!/st\.hourlyCap && st\.hourCount >= st\.hourlyCap/.test(ct), "the old fixed-window gate is gone from the scan");
ok((ct.match(/action: "video", n(?::|,)/g) || []).length === 9, "every video Activity event carries n (clips delivered by that event) — " + (ct.match(/action: "video", n(?::|,)/g) || []).length + " of 9");
ok(/if \(r\.skip && r\.held\) \{[\s\S]{0,200}return;/.test(ct) && (bg.match(/skip: true, held: true/g) || []).length >= 3, "a held follow-up (cap / window / switch) keeps its clock and skip count");
// popup + UIs + docs
ok(/const b = s\.budget \|\| null;/.test(popup) && /warm-up day \$\{b\.warmDay \+ 1\} of \$\{b\.warmDays\}/.test(popup) && /not counted/.test(popup), "the popup shows the live windows, the warm-up day and the clips");
ok(/on a break until/.test(popup), "the popup's Computer row names a cadence break");
ok(/id="capsCountVideos"/.test(html) && /id="capsCountVideos"/.test(optHtml) && /\["capsCountVideos", "checked"\]/.test(app) && /\["capsCountVideos", "checked"\]/.test(opt), "the 'Count demo clips toward the caps' box exists in both UIs and both field lists");
ok(/<option value="close">/.test(html) && /<option value="close">/.test(optHtml), "the 'Close politely' option exists in both UIs");
ok(/Break chance \/ reply/.test(html) && /Break chance \/ reply/.test(optHtml), "the cadence boxes say what they do now (per reply, pauses only)");
ok(/`capsCountVideos`/.test(ref) && /sliding window/.test(ref) && /`close` \(v0\.21\.86\)/.test(ref) && /WARM_EVIDENCE_LOCAL/.test(ref) && /youLineCount/.test(ref), "SETTINGS-REFERENCE documents the ledger, the switch, close mode, the three per-chat counts and the warm-up evidence");

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
