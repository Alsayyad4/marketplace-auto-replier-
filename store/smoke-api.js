/* (v0.21.94) THE API LINE — Nov 3 2026: the owner sent two popup photos ("API key set ✓ ·
 * Replying yes ✓ · Last 24 h 0 / 500") while a dozen buyers had waited up to 4 h, and
 * called it "api connection failed". The popup's STATUS box had no line for the outcome of
 * the Anthropic call itself ("last error" sat below the slider), and after three refused
 * calls the content script stamped the buyer's message "handled" for good — so an outage
 * (a dead key, no credits, a blocked network) left its buyers unanswered even once the API
 * came back. Under test, against the real code sliced out of the files:
 *
 *   1. the pure record: apiFold (streaks keep `since`, count calls, remember the last
 *      answer), apiErrorHint (Anthropic's own words → what it means + what to do),
 *      apiStatusLine (the popup row), apiDiagLine (🩺 + the hidden Activity row),
 *      apiReportDue (first refusal, hourly, once on recovery, never when healthy);
 *   2. the content script's recovery: apiParkMessage keeps the owed turn with no try spent
 *      and parks the chat 10 min; oweOrGiveUp is unchanged for every other failure;
 *      freshLookAtStamp drops a stamp with no text of ours behind it exactly once per chat;
 *   3. the dashboard's fleet line: apiHealthLines names the computers refused right now
 *      (newest row per computer, 3-h window) with the fix on the first line;
 *   4. the wiring: postClaude reports success, HTTP refusal and both fetch failures through
 *      the typeof-guarded hook (the Try-it slice stays free of chrome.*); GET_STATUS carries
 *      the row; the 🩺 carries the line; the reply handler flags an API failure `api: true`
 *      and an empty model output does not; the popup/dashboard/manifest carry the version.
 *
 * Run:  node store/smoke-api.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bg = R("background.js"), cs = R("content.js"), app = R("docs/app.js");
const popupHtml = R("popup.html"), popupJs = R("popup.js"), indexHtml = R("docs/index.html"), manifest = R("manifest.json");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a); process.exit(1); }
  return src.slice(s, e);
}
const MIN = 60 * 1000;
const T0 = Date.parse("2026-11-03T20:00:00Z");

/* ---------- 1. the pure record ---------- */
const block = between(bg, "/* ===== (v0.21.93) THE API LINE (pure) =====", "/* ===== end api line (pure) ===== */");
ok(!/\bchrome\.[a-z]/.test(block), "the pure block uses no chrome.* API");
const P = new Function(block + "; return { apiFold, apiErrorHint, apiStatusLine, apiDiagLine, apiReportDue, API_REPORT_MS };")();
const AUTH = 'Anthropic 401: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}';
const CREDIT = 'Anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';

console.log("\n-- apiFold --");
let s = P.apiFold(null, true, "", "claude-haiku-4-5", T0);
ok(s.ok === true && s.n === 0 && s.since === 0 && s.okAt === T0 && s.model === "claude-haiku-4-5" && s.error === "", "first answered call: ok, no streak, okAt = now, the model kept");
let f1 = P.apiFold(s, false, AUTH, "claude-haiku-4-5", T0 + 5 * MIN);
ok(f1.ok === false && f1.since === T0 + 5 * MIN && f1.n === 1 && f1.okAt === T0 && f1.at === T0 + 5 * MIN, "first refusal after an answer: a streak starts now, n=1, the last answer remembered");
let f2 = P.apiFold(f1, false, AUTH, "claude-haiku-4-5", T0 + 15 * MIN);
ok(f2.since === T0 + 5 * MIN && f2.n === 2 && f2.okAt === T0 && f2.at === T0 + 15 * MIN, "second refusal: since kept, n=2, okAt kept");
let back = P.apiFold(f2, true, "", "claude-sonnet-4-6", T0 + 20 * MIN);
ok(back.ok === true && back.n === 0 && back.since === 0 && back.okAt === T0 + 20 * MIN && back.model === "claude-sonnet-4-6", "an answer ends the streak: ok, okAt = now, the new model");
let f0 = P.apiFold(null, false, "  Fetch failed:   Failed \n to fetch ", "m", T0);
ok(f0.since === T0 && f0.n === 1 && f0.okAt === 0 && f0.error === "Fetch failed: Failed to fetch", "a refusal with no history: since = now, okAt 0, whitespace collapsed and trimmed");
ok(P.apiFold(null, false, "x".repeat(600), "m", T0).error.length === 240, "the stored error is cut to 240 chars");
ok(P.apiFold(null, false, "", "m", T0).error === "no answer", "an empty error reads 'no answer'");
ok(P.apiFold({ junk: 1 }, false, AUTH, "m", T0).since === T0, "a malformed previous record is ignored");

console.log("\n-- apiErrorHint --");
const kindOf = (e) => P.apiErrorHint(e).kind;
ok(kindOf(AUTH) === "auth", "401 authentication_error → auth");
ok(kindOf("Anthropic 401: <html>") === "auth", "a bare 401 → auth");
ok(kindOf(CREDIT) === "billing", "400 'credit balance is too low' → billing (not a request error)");
ok(kindOf('Anthropic 402: {"error":{"type":"billing_error"}}') === "billing", "402 billing_error → billing");
ok(kindOf('Anthropic 400: {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}') === "billing", "the short 'credit balance is too low' form alone → billing");
ok(kindOf('Anthropic 403: {"error":{"type":"permission_error","message":"x"}}') === "forbidden", "403 permission_error → forbidden");
const mh = P.apiErrorHint('Anthropic 404: {"type":"error","error":{"type":"not_found_error","message":"model: claude-haiku-9"}}');
ok(mh.kind === "model" && /claude-haiku-9/.test(mh.what), "404 not_found_error → model, naming the model from the message — " + mh.what);
ok(kindOf('Anthropic 429: {"error":{"type":"rate_limit_error"}}') === "limit", "429 → limit");
ok(kindOf('Anthropic 529: {"error":{"type":"overloaded_error"}}') === "anthropic", "529 overloaded → anthropic");
ok(kindOf('Anthropic 500: {"error":{"type":"api_error"}}') === "anthropic", "500 api_error → anthropic");
ok(kindOf("Anthropic 503: <html>bad gateway</html>") === "anthropic", "any 5xx → anthropic");
ok(kindOf("Fetch failed: Failed to fetch") === "network", "'Failed to fetch' → network");
ok(kindOf("Fetch failed: NetworkError when attempting to fetch resource.") === "network", "NetworkError → network");
ok(kindOf("Fetch failed: net::ERR_NAME_NOT_RESOLVED") === "network", "ERR_* → network");
ok(kindOf('Anthropic 400: {"error":{"type":"invalid_request_error","message":"max_tokens: must be positive"}}') === "request", "a 400 about the request → request");
ok(kindOf("") === "unknown" && kindOf("something odd") === "unknown", "anything else → unknown");
for (const e of [AUTH, CREDIT, "Fetch failed: Failed to fetch", "Anthropic 404: not_found_error", "", "Anthropic 429: x"]) {
  const h = P.apiErrorHint(e);
  ok(h.what && h.fix && /[.!]$/.test(h.fix.trim()), "every hint has a 'what' and a 'fix' sentence (" + h.kind + ")");
}
ok(/dashboard/.test(P.apiErrorHint(AUTH).fix) && /console\.anthropic\.com/.test(P.apiErrorHint(AUTH).fix), "the auth fix sends him to the dashboard's key box and the Anthropic console");
ok(/Plans & Billing/.test(P.apiErrorHint(CREDIT).fix) && /Nothing to change/.test(P.apiErrorHint(CREDIT).fix), "the billing fix says where to pay and that SubSell needs no change");
ok(/Messenger and the Activity log still work/.test(P.apiErrorHint("Fetch failed: Failed to fetch").fix), "the network fix explains why only Anthropic is unreachable");

console.log("\n-- apiStatusLine --");
let L = P.apiStatusLine(null, T0);
ok(L.cls === "muted" && /no call yet/.test(L.text), "no record → 'no call yet' (muted) — " + L.text);
L = P.apiStatusLine(s, T0 + MIN);
ok(L.cls === "ok" && /^✓ answered at \d{1,2}:\d{2}/.test(L.text) && /\(claude-haiku-4-5\)$/.test(L.text), "answered → ✓ with the time and the model — " + L.text);
const f3 = P.apiFold(P.apiFold(f1, false, AUTH, "claude-haiku-4-5", T0 + 10 * MIN), false, AUTH, "claude-haiku-4-5", T0 + 15 * MIN);
L = P.apiStatusLine(f3, T0 + 15 * MIN);
ok(L.cls === "bad" && /^✗ not answering for 10 min \(3 calls refused since \d{1,2}:\d{2}/.test(L.text), "refused for 10 min, 3 calls → ✗ with duration, count and the start — " + L.text.slice(0, 80));
ok(/Anthropic refuses the API key/.test(L.text) && /Paste a working key/.test(L.text), "…and the what + the fix on the same line");
L = P.apiStatusLine(f1, T0 + 5 * MIN + 3 * 60 * MIN);
ok(/for 3 h \(1 call refused/.test(L.text), "hours past 2 h, '1 call' singular — " + L.text.slice(0, 60));

console.log("\n-- apiDiagLine --");
ok(P.apiDiagLine(null, T0) === "api: no call yet", "no record → 'api: no call yet'");
ok(P.apiDiagLine(s, T0 + 2 * MIN) === "api: ok 2m claude-haiku-4-5", "answered → 'api: ok 2m <model>'");
const d = P.apiDiagLine(f3, T0 + 15 * MIN);
ok(/^api: FAIL since 10m n=3 last=0m ok=15m claude-haiku-4-5 — auth: Anthropic 401/.test(d), "refused → since / n / last / ok / model / kind: error — " + d.slice(0, 90));
ok(/^api: FAIL since 0m n=1 last=0m ok=- m — network: Fetch failed/.test(P.apiDiagLine(f0, T0)), "never answered → ok=-");

console.log("\n-- apiReportDue --");
ok(P.apiReportDue(null, f0, 0, T0) === true, "the first refusal ever is reported");
ok(P.apiReportDue(s, f1, T0 - 5 * MIN, T0 + 5 * MIN) === true, "a streak starting after an answer is reported even if a row went out 10 min ago");
ok(P.apiReportDue(f1, f2, T0 + 5 * MIN, T0 + 15 * MIN) === false, "10 min into a streak, reported 10 min ago → not again");
ok(P.apiReportDue(f1, f2, T0 + 5 * MIN, T0 + 5 * MIN + P.API_REPORT_MS) === true, "an hour after the last row → reported again");
ok(P.apiReportDue(f1, f2, 0, T0 + 15 * MIN) === true, "a streak never reported (storage lost) → reported");
ok(P.apiReportDue(f2, back, T0 + 5 * MIN, T0 + 20 * MIN) === true, "answering again after a streak → one recovery row");
ok(P.apiReportDue(s, back, T0, T0 + 20 * MIN) === false && P.apiReportDue(null, s, 0, T0) === false, "a healthy computer never reports");
ok(P.apiReportDue(null, null, 0, T0) === false, "no record → nothing");

/* ---------- 2. the content script's recovery ---------- */
console.log("\n-- content: apiParkMessage / oweOrGiveUp / freshLookAtStamp --");
const csSrc = between(cs, "  function oweText(", "  // (v0.21.91) THE CLIP IS THE TEXT'S COMPANION");
function contentApi(opts) {
  const st = { textOwed: {}, lastHandled: {}, cooldowns: {}, replyCounts: {}, videoPending: {}, stampRepaired: {}, persisted: 0, status: [], own: 0, ownThrows: false };
  Object.assign(st, opts || {});
  const api = new Function("textOwed", "lastHandled", "cooldowns", "replyCounts", "videoPending", "stampRepaired", "persistDedup", "setStatus", "clearWaiting", "safe", "ownTextsNow",
    csSrc + "; return { oweText, oweOrGiveUp, apiParkMessage, freshLookAtStamp, API_PARK_MS };")(
    st.textOwed, st.lastHandled, st.cooldowns, st.replyCounts, st.videoPending, st.stampRepaired,
    () => { st.persisted++; }, (p) => { st.status.push(p); }, () => {},
    (fn, fb) => { try { return fn(); } catch (e) { return fb; } }, () => { if (st.ownThrows) throw new Error("no pane"); return st.own; });
  return { st, api };
}
{
  const { st, api } = contentApi();
  const turn = { dedupeKey: "k1", buyerMessage: "Hi, is this available?" };
  const t1 = Date.now();
  let o;
  for (let i = 0; i < 5; i++) o = api.apiParkMessage("id1", "sid1", turn, AUTH, { h: 1 });
  ok(o && o.tries === 0 && o.key === "k1", "five refused calls on one message: the owed turn is kept with tries still 0 (no try spent)");
  ok(/^api: Anthropic 401/.test(o.why) && o.hint && o.hint.h === 1, "the owed entry says why (api: …) and keeps the rescue hint");
  ok(o.at >= t1, "its life (45 min from `at`) restarts at every refused call");
  ok(st.cooldowns.id1 >= t1 + api.API_PARK_MS - 5 && st.cooldowns.sid1 === st.cooldowns.id1 && api.API_PARK_MS === 10 * MIN, "the chat (both ids) is parked 10 min, not 90 s");
  ok(st.lastHandled.id1 === undefined, "the message is NOT stamped handled");
  ok(st.persisted === 5 && st.status.length === 5 && /did not answer/.test(st.status[0].lastAction) && /message kept, next try in 10 min/.test(st.status[0].lastAction), "persisted and told in the trail — " + st.status[0].lastAction.slice(0, 70));
  ok(st.textOwed.sid1 === o, "the owed entry lives under the sidebar id like any owed text (lane 1.2 finds it)");
  // then ordinary failures on the same message: the API refusals counted nothing, so the
  // third ORDINARY failure is the one that lets the message go (as in .91)
  api.oweOrGiveUp("id1", "sid1", turn, "empty reply", null);
  ok(api.oweOrGiveUp("id1", "sid1", turn, "empty reply", null) === false && st.textOwed.sid1.tries === 2 && st.lastHandled.id1 === undefined, "two ordinary failures after five API refusals: tries=2, still kept");
  ok(api.oweOrGiveUp("id1", "sid1", turn, "empty reply", null) === true && st.lastHandled.id1 === "k1", "…the third ordinary failure lets it go — the API refusals never counted");
}
{
  const { st, api } = contentApi();
  const turn = { dedupeKey: "k2" };
  ok(api.oweOrGiveUp("id2", null, turn, "send failed", null) === false && api.oweOrGiveUp("id2", null, turn, "send failed", null) === false, "oweOrGiveUp unchanged: two failures keep the message");
  ok(api.oweOrGiveUp("id2", null, turn, "send failed", null) === true && st.lastHandled.id2 === "k2" && st.textOwed.id2 === undefined, "…the third stamps it handled and drops the owed entry (as in .91)");
  ok(api.apiParkMessage("", null, turn, AUTH, null) === null && api.apiParkMessage("id3", null, { dedupeKey: "" }, AUTH, null) === null, "no id / no key → nothing owed, no crash");
}
{
  const { st, api } = contentApi({ lastHandled: { id4: "k4" } });
  const turn = { dedupeKey: "k4" };
  ok(api.freshLookAtStamp("id4", "sid4", turn, "Nina · ipad") === true && st.lastHandled.id4 === undefined && st.stampRepaired.id4 > 0 && st.persisted === 1, "a stamp with no text of ours behind it (no count, no clip pending, 0 own bubbles) is dropped once");
  ok(/stamped handled, but the chat holds no text of ours/.test(st.status[0].lastAction) && st.status[0].currentThread === "Nina · ipad", "…and the trail says so with the chat's name");
  st.lastHandled.id4 = "k4";
  ok(api.freshLookAtStamp("id4", "sid4", turn, "Nina · ipad") === false && st.lastHandled.id4 === "k4", "never twice for the same chat");
}
{
  const mk = (o) => contentApi(Object.assign({ lastHandled: { id5: "k5" } }, o));
  const turn = { dedupeKey: "k5" };
  let c = mk({ replyCounts: { id5: 1 } });
  ok(c.api.freshLookAtStamp("id5", "sid5", turn, "x") === false && c.st.lastHandled.id5 === "k5", "a chat this computer replied in keeps its stamp");
  c = mk({ replyCounts: { sid5: 2 } });
  ok(c.api.freshLookAtStamp("id5", "sid5", turn, "x") === false, "…also when the count sits under the sidebar id");
  c = mk({ videoPending: { id5: 0 } });
  ok(c.api.freshLookAtStamp("id5", "sid5", turn, "x") === false, "a chat with a clip pending keeps its stamp");
  c = mk({ own: 2 });
  ok(c.api.freshLookAtStamp("id5", "sid5", turn, "x") === false, "a chat whose pane shows a text of ours keeps its stamp");
  c = mk({ ownThrows: true });
  ok(c.api.freshLookAtStamp("id5", "sid5", turn, "x") === false, "when the pane cannot be read the stamp stays (fail closed)");
  c = mk({});
  ok(c.api.freshLookAtStamp("", "sid5", turn, "x") === false && c.api.freshLookAtStamp("id5", "sid5", null, "x") === false, "no id / no turn → no look");
}

/* ---------- 3. the dashboard's fleet line ---------- */
console.log("\n-- dashboard: apiHealthLines --");
const appSrc = between(app, "  const API_FIX = {", "  async function loadApiHealth() {");
const H = new Function("machineKey", "machineShow", appSrc + "; return { apiHealthLines, API_FIX };")((m) => String(m || "").replace(/ · v[\d.]+/, "").trim(), (m) => String(m || "").replace(/ · v[\d.]+/, ""));
const iso = (t) => new Date(t).toISOString();
const NOW = T0;
const rows = [
  { created_at: iso(NOW - 2 * MIN), machine: "PC-b · v0.21.94", bot_text: "api: ok 0m claude-haiku-4-5".replace("api: ", "api ") },
  { created_at: iso(NOW - 10 * MIN), machine: "PC-a · v0.21.94", bot_text: "api FAIL since 50m n=7 last=0m ok=60m claude-haiku-4-5 — auth: " + AUTH },
  { created_at: iso(NOW - 40 * MIN), machine: "PC-b · v0.21.94", bot_text: "api FAIL since 1m n=1 last=0m ok=5m claude-haiku-4-5 — auth: " + AUTH },
  { created_at: iso(NOW - 5 * 60 * MIN), machine: "PC-c · v0.21.94", bot_text: "api FAIL since 1m n=1 last=0m ok=5m claude-haiku-4-5 — network: Fetch failed: Failed to fetch" },
];
let lines = H.apiHealthLines(rows, NOW);
ok(lines.length === 2 && /^⚠ Claude is NOT answering on 1 computer\(s\)/.test(lines[0]), "newest row per computer: PC-a refused, PC-b answering again, PC-c's row too old → 1 computer — " + lines[0].slice(0, 60));
ok(/Anthropic refuses the API key/.test(lines[0]) && /refused since about /.test(lines[0]), "the first line carries the fix for the commonest kind and since when");
ok(/^• PC-a: since 50m n=7/.test(lines[1]) && /\(reported /.test(lines[1]), "one bullet per refused computer with its own row — " + lines[1].slice(0, 50));
ok(H.apiHealthLines([], NOW).length === 0 && H.apiHealthLines(null, NOW).length === 0, "no rows → nothing to say");
ok(H.apiHealthLines([rows[0]], NOW).length === 0, "an 'api ok' row alone → nothing to say");
const two = [rows[1], { created_at: iso(NOW - 3 * MIN), machine: "PC-d", bot_text: "api FAIL since 2m n=2 last=0m ok=- m — network: Fetch failed: Failed to fetch" }, { created_at: iso(NOW - 4 * MIN), machine: "PC-e", bot_text: "api FAIL since 3m n=3 last=0m ok=- m — network: Fetch failed: Failed to fetch" }];
lines = H.apiHealthLines(two, NOW);
ok(/on 3 computer\(s\)/.test(lines[0]) && /cannot reach api\.anthropic\.com/.test(lines[0]), "the commonest kind (2× network vs 1× auth) picks the first line's fix");
ok(Object.keys(H.API_FIX).sort().join() === "anthropic,auth,billing,forbidden,limit,model,network,request,unknown", "the dashboard knows every kind the worker can report");
const workerKinds = (block.match(/kind: "([a-z]+)"/g) || []).map((x) => x.slice(7, -1)).sort();
ok(workerKinds.join() === Object.keys(H.API_FIX).sort().join(), "…the same list as background.js apiErrorHint — " + workerKinds.join(","));

/* ---------- 4. the wiring ---------- */
console.log("\n-- wiring --");
const slice = between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "/* ---------------- video fetch ---------------- */");
ok(!/\bchrome\.[a-z]/.test(slice), "the Try-it slice (owner prompt → video fetch) still uses no chrome.* API");
const post = between(bg, "async function postClaude(", "async function callClaude(");
ok(/if \(t !== null\) \{\s*const err = `Anthropic \$\{resp\.status\}: \$\{t\.slice\(0, errLen\)\}`;\s*if \(typeof apiNote === "function"\) apiNote\(false, err, body\.model\);/.test(post), "postClaude reports an HTTP refusal through the guarded hook, then returns the same error");
ok(/const data = await resp\.json\(\);\s*if \(typeof apiNote === "function"\) apiNote\(true, "", body\.model\);/.test(post), "postClaude reports an answer");
ok((bg.match(/const err = "Fetch failed: " \+ e\.message;\s*if \(typeof apiNote === "function"\) apiNote\(false, err, body\.model\);[^\n]*\n\s*return \{ error: err \};/g) || []).length === 2, "both fetch catches (reply + follow-up) report a failed request");
ok(/apiKeySet: !!settings\.apiKey,\s*api: apiLast, apiLine: apiStatusLine\(apiLast, Date\.now\(\)\),/.test(bg), "GET_STATUS carries the record and the ready-made popup row");
ok(/"apiLast", \/\/ \(v0\.21\.93\)/.test(bg) && /L\.push\(apiDiagLine\(st\.apiLast \|\| apiLast, now\)\);/.test(bg), "the 🩺 reads the record and prints the api: line");
ok(/sendResponse\(\{ ok: false, error: parsed\.error, api: true \}\);/.test(bg), "GET_REPLY_SIMPLE flags a failed model call api: true");
ok(/sendResponse\(\{ ok: false, error: "empty model output \(" \+ \(parsed\.kind \|\| "\?"\)[^}]*\}\);/.test(bg) && !/error: "empty model output[^\n]*api: true/.test(bg), "…and an empty model output is NOT flagged (it keeps the 3-try give-up)");
ok(/function apiNote\(ok, err, model\)/.test(bg) && /mirrorToCloud\(\{ action: "apierr"/.test(bg) && /chrome\.notifications\.create\(\{ type: "basic", iconUrl: "icon128\.png", title: "Marketplace Auto-Reply — Claude is not answering on this computer"/.test(bg), "apiNote writes the hidden row and the notification when a report is due");
ok(/chrome\.storage\.local\.get\(\["apiLast", "apiReportAt"\]/.test(bg) && /put\.apiReportAt = now;/.test(bg), "apiNote folds over the stored record and remembers the last report");
ok(/<div>Claude<\/div><div id="api">—<\/div>/.test(popupHtml), "popup.html has the Claude row under API key");
ok(/const ap = \$\("api"\);\s*if \(ap\) \{ const a = s\.apiLine \|\| \{ text: "—", cls: "muted" \}; ap\.textContent = a\.text; ap\.className = a\.cls; \}/.test(popupJs), "popup.js renders the row from GET_STATUS");
ok(/if \(reply && reply\.api\) \{ apiParkMessage\(id, sidebarId, turn, reply\.error, rescueHint\); return; \}[^\n]*\n\s*oweOrGiveUp\(id, sidebarId, turn, "claude error: "/.test(cs), "content: an API failure parks the message before the give-up path runs");
ok(/\) && !freshLookAtStamp\(id, sidebarId, turn, name\)\) \{/.test(cs), "content: the handled stamp is re-examined once per chat");
ok(/function oweText\(id, sid, turn, why, hint, opts\)/.test(cs) && /if \(!\(opts && opts\.noTry\)\) o\.tries = \(Number\(o\.tries\) \|\| 0\) \+ 1;/.test(cs) && /tries: opts && opts\.noTry \? 0 : 1 \}/.test(cs), "content: oweText takes noTry (no increment, and an entry it opens starts at 0)");
ok(/sidebarVideoSeen, stampRepaired \}\)\)/.test(cs) && /"replyCountsRepaired92", "replyCountsRepairedN", "stampRepaired"\]/.test(cs) && /stampRepaired = r\.stampRepaired;/.test(cs), "content: stampRepaired is persisted and hydrated (and the .92 repair count is finally fetched)");
ok(/const HIDDEN_KINDS = \["claim", "teach", "gap", "usage", "apierr"\]/.test(app) && /loadStuck\(\);[^\n]*\n\s*loadApiHealth\(\);/.test(app), "dashboard: apierr is hidden from the feed and the fleet line is loaded with the others");
ok(/id="fleetApi"/.test(indexHtml) && /app\.js\?v=20261113/.test(indexHtml) && /const CORE_VER = "20261113"/.test(app), "dashboard: the box exists and both cache-busters moved");
ok(/"version": "0.21.97"/.test(manifest), "manifest is 0.21.97");

console.log("\n" + (failed ? failed + " CHECK(S) FAILED" : "all checks passed"));
process.exit(failed ? 1 : 0);
