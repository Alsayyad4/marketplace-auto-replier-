/* (v0.21.75) Buyers are answered at any hour; the demo-video evidence; the memory flag.
 * Operator, Oct 6 2026: "remove business hours, need the machine run all times, don't
 * break other functions" and "double sending videos and not sending 1 of each".
 *
 *   1. background: replies are 24/7 unless `replyWindowOnly` (NEW key) is on; the OLD
 *      key `businessHoursEnabled` (stored true on every account) is never read; the
 *      hours still window the messages the bot STARTS, and an alarm due at night is
 *      parked until the window opens instead of being dropped;
 *   2. the teaching receipt says whether the computer can read the Activity log (mem=);
 *   3. dashboard: the row's old gate is written false on every save and once on open;
 *      a computer reporting mem=off is named as blind; the Videos tab reads what the
 *      computers logged and names double-served and short chats; "Copy report"
 *      gathers it all without the key.
 * Run:  node store/smoke-hours.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bg = R("background.js"), app = R("docs/app.js"), html = R("docs/index.html"), opt = R("options.js"), optHtml = R("options.html");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
function between(src, a, b, keepEnd) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " → " + b); process.exit(1); }
  return src.slice(s, keepEnd ? e + b.length : e);
}
const line = (src, re) => { const m = src.match(re); if (!m) { console.error("line not found: " + re); process.exit(1); } return m[0]; };

console.log("— 1. background: replies at any hour, nudges in the window —");
const H = new Function(between(bg, "// (v0.21.75) Replies to buyers: any hour", "/* ---------------- system prompt") + "\nreturn { withinBusinessHours, withinNudgeHours, nextNudgeWindowStart };")();
const S = { replyWindowOnly: false, businessHoursEnabled: true, businessHoursStart: 9, businessHoursEnd: 22 };
const at = (h, m) => new Date(2026, 9, 6, h, m || 0, 0, 0);
ok(H.withinBusinessHours(S) === true, "replies: 24/7 with the shipped defaults, whatever the clock says");
ok(H.withinBusinessHours({ businessHoursEnabled: true, businessHoursStart: 9, businessHoursEnd: 9 }) === true, "…and the OLD key alone (true on every live account) gates nothing");
ok(H.withinBusinessHours(Object.assign({}, S, { replyWindowOnly: true, businessHoursStart: 0, businessHoursEnd: 0 })) === true, "replyWindowOnly ON + start=end = always open");
ok(H.withinNudgeHours(S, at(3)) === false && H.withinNudgeHours(S, at(8, 59)) === false, "a nudge at 03:00 or 08:59 waits (9–22)");
ok(H.withinNudgeHours(S, at(9)) === true && H.withinNudgeHours(S, at(21, 59)) === true, "…09:00 and 21:59 are inside");
ok(H.withinNudgeHours(S, at(22)) === false, "…22:00 is outside (the end hour is exclusive, as before)");
const night = Object.assign({}, S, { businessHoursStart: 20, businessHoursEnd: 2 });
ok(H.withinNudgeHours(night, at(23)) === true && H.withinNudgeHours(night, at(1)) === true && H.withinNudgeHours(night, at(3)) === false, "an overnight window (20–2) still wraps midnight");
ok(H.withinNudgeHours({ businessHoursStart: "x", businessHoursEnd: 22 }, at(3)) === true && H.withinNudgeHours({ businessHoursStart: 9, businessHoursEnd: 9 }, at(3)) === true, "garbage or equal hours = no window (never a silent stop)");
const n1 = H.nextNudgeWindowStart(S, at(3).getTime());
ok(n1 >= at(9).getTime() && n1 < at(9, 10).getTime(), "due at 03:00 → parked for 09:00–09:10 the same day (jitter ≤ 10 min)");
const n2 = H.nextNudgeWindowStart(S, at(23).getTime());
ok(n2 >= at(9).getTime() + 86400000 && n2 < at(9, 10).getTime() + 86400000, "due at 23:00 → tomorrow 09:00–09:10");
const n3 = H.nextNudgeWindowStart(S, at(9).getTime());
ok(n3 >= at(9).getTime() + 86400000, "exactly at the opening hour counts as today's window already open → tomorrow");
const n4 = H.nextNudgeWindowStart({ businessHoursStart: "x" }, at(3).getTime());
ok(n4 >= at(9).getTime() && n4 < at(9, 10).getTime(), "a garbage start hour falls back to 9");

console.log("\n— 1b. background wiring —");
const alarmH = between(bg, "chrome.alarms.onAlarm.addListener(async (alarm) => {", "\n});", true);
ok(/if \(!withinNudgeHours\(settings\)\) \{\s*\n\s*const when = nextNudgeWindowStart\(settings\);\s*\n\s*chrome\.alarms\.create\(alarm\.name, \{ when \}\);/.test(alarmH), "a follow-up or visit alarm due outside the window is re-armed for the opening, not dropped");
ok(!/LOG\("alarm skipped: outside business hours"/.test(bg), "the old 'alarm skipped: outside business hours' drop is gone");
ok(/if \(!alarm\.name\.startsWith\(ALARM_PREFIX\) && !alarm\.name\.startsWith\(VISIT_PREFIX\)\) return;/.test(alarmH), "…and only the follow-up / visit alarms are parked (the periodic alarms have their own listeners)");
ok(/if \(!withinNudgeHours\(settings\)\) \{ \/\/ \(v0\.21\.75\)[^\n]*\n\s*sendResponse\(\{ ok: true, skip: true, reason: "outside the follow-up window" \}\);/.test(bg), "the smart follow-up (a message the bot starts) keeps to the window");
ok(/noteTeaching\(settings\);[^\n]*\n\s*if \(!withinBusinessHours\(settings\)\) \{\s*\n\s*sendResponse\(\{ ok: true, skip: true, reason: "outside business hours" \}\);/.test(bg), "a REPLY still passes withinBusinessHours — which only gates when the owner opted into a window");
const reads = (bg.match(/settings\.businessHoursEnabled|\.businessHoursEnabled\b/g) || []).length;
ok(reads === 0, "nothing in background.js READS businessHoursEnabled any more (occurrences outside DEFAULTS: " + reads + ")");
ok(/^  replyWindowOnly: false,/m.test(bg) && /^    replyWindowOnly: false,/m.test(opt) && /^    replyWindowOnly: false,/m.test(app), "replyWindowOnly defaults OFF in all three DEFAULTS");
ok(/^  businessHoursEnabled: true, \/\/ legacy/m.test(bg), "the legacy key stays in DEFAULTS as documentation for the builds that still read it");
ok(/id="replyWindowOnly"/.test(html) && /id="replyWindowOnly"/.test(optHtml) && !/id="businessHoursEnabled"/.test(html) && !/id="businessHoursEnabled"/.test(optHtml), "both forms bind the NEW key's checkbox and no longer show the old one");
ok(/\["replyWindowOnly", "checked"\]/.test(app) && /\["replyWindowOnly", "checked"\]/.test(opt) && !/\["businessHoursEnabled", "checked"\]/.test(app) && !/\["businessHoursEnabled", "checked"\]/.test(opt), "…and in FIELDS");
ok(/" replies=" \+ \(settings\.replyWindowOnly \? [^\n]*: "24\/7"\) \+ " nudges=" \+ settings\.businessHoursStart/.test(bg), "the 🩺 line reads replies=24/7 nudges=9-22");
ok(/Buyers are answered at any hour\./.test(html), "the dashboard says so where the hours are");

console.log("\n— 2. the teaching receipt carries the memory flag —");
ok(/const auth = await getCloudAuth\(\);\s*\n\s*const mem = settings\.threadMemory !== false && !!\(auth && auth\.refresh_token\) \? "on" : "off";/.test(bg), "mem=on needs the thread memory switch AND a cloud login on that computer");
ok(/if \(seen && seen\.fp === fp && seen\.mem === mem\) return;/.test(bg) && /"teaching " \+ fp \+ " mem=" \+ mem/.test(bg) && /teachSeen: \{ fp, mem, at: Date\.now\(\) \}/.test(bg), "a login change re-reports even with the same teaching code; the row reads 'teaching <fp> mem=on|off'");
const fpWord = /teaching ([0-9a-f]{8})/;
ok(fpWord.test("teaching abcd1234 mem=off"), "the dashboard's fingerprint word still matches a row that carries the flag");

console.log("\n— 3a. dashboard: the old gate is written false —");
const G = new Function(line(app, /^  const LEGACY_GATE_OFF = .*$/m) + "\n" + line(app, /^  const legacyGateArmed = .*$/m) + "\nreturn { LEGACY_GATE_OFF, legacyGateArmed };")();
ok(G.LEGACY_GATE_OFF.businessHoursEnabled === false && Object.keys(G.LEGACY_GATE_OFF).length === 1, "LEGACY_GATE_OFF writes exactly businessHoursEnabled:false and nothing else");
ok(G.legacyGateArmed({}) === true && G.legacyGateArmed({ businessHoursEnabled: true }) === true && G.legacyGateArmed({ businessHoursEnabled: false }) === false && G.legacyGateArmed(null) === false, "a row without the key, or with true, is armed (old builds read `!settings.businessHoursEnabled` → gate on); false is disarmed");
ok(/Object\.assign\(clean, LEGACY_LINK_OFF, LEGACY_GATE_OFF\)/.test(app) && /return Object\.assign\(c, LEGACY_LINK_OFF, LEGACY_GATE_OFF\);/.test(app), "saveConfig AND normalizeForSave (the merge path) clamp it on every write");
ok(/if \(legacyLinkArmed\(data\.config \|\| \{\}\) \|\| legacyGateArmed\(data\.config \|\| \{\}\)\) \{\s*\n\s*const saved = await saveConfig\(true, SYSTEM_SAVE\);/.test(app), "…and the page disarms an armed row the moment it opens, as a SYSTEM save");

console.log("\n— 3b. dashboard: a computer without a login is named —");
const mk = line(app, /^  const machineKey = .*$/m), ms = line(app, /^  const machineShow = .*$/m);
const F = new Function(mk + "\n" + ms + "\n" + between(app, "  function fleetStatus(", "  function renderFleet(") + "\nreturn { fleetStatus };")();
const T0 = Date.parse("2026-10-06T12:00:00Z");
const iso = (min) => new Date(T0 + min * 60000).toISOString();
const teach = (m, txt, min) => ({ machine: m, bot_text: txt, created_at: iso(min) });
let st = F.fleetStatus([teach("Shop PC · v0.21.75 #PC-aaaaa", "teaching abcd1234 mem=off", 0), teach("Caisse · v0.21.75 #PC-bbbbb", "teaching abcd1234 mem=on", 0), teach("Vieux · v0.21.74 #PC-ccccc", "teaching abcd1234", 0)], [], "abcd1234", T0 + 60000, T0 - 3600000);
ok(st.blind.length === 1 && st.blind[0].key === "pc-aaaaa", "mem=off → that computer is listed as blind");
ok(st.ok.length === 3, "…while it still counts as answering with the saved teaching (the two facts are independent)");
st = F.fleetStatus([teach("Shop PC · v0.21.75 #PC-aaaaa", "teaching abcd1234 mem=off", 0), teach("Shop PC · v0.21.75 #PC-aaaaa", "teaching abcd1234 mem=on", 5)], [], "abcd1234", T0 + 600000, T0 - 3600000);
ok(st.blind.length === 0, "the owner signs in on it → its next receipt (mem=on) clears the warning");
st = F.fleetStatus([teach("Shop PC · v0.21.75 #PC-aaaaa", "teaching abcd1234 mem=off", -10 * 24 * 60)], [], "abcd1234", T0, T0 - 3600000);
ok(st.blind.length === 0, "a computer silent for a week is retired, not blind");
ok(/for \(const e of st\.blind\) lines\.push\("⚠ " \+ machineShow\(e\.machine\) \+ " has NO cloud login/.test(app) && /st\.behind\.length \|\| st\.blind\.length \? "err" : "hint"/.test(app), "the fleet line names it in red with the cure (sign in on that computer)");

console.log("\n— 3c. dashboard: where the videos went —");
const V = new Function(mk + "\n" + ms + "\n" + between(app, "  const VIDEO_SENT_RE = ", "  let videoReportText") + "\nreturn { videoReport, VIDEO_SENT_RE };")();
const vrow = (m, thread, txt, min) => ({ kind: "video", machine: m, thread_id: thread, thread_name: "Buyer " + thread, bot_text: txt, created_at: iso(min) });
const A = "Shop PC · v0.21.75 #PC-aaaaa", B = "Caisse · v0.21.75 #PC-bbbbb";
const NOW = T0 + 3 * 3600000;
let rep = V.videoReport([vrow(A, "t1", "1/2 demo videos sent — finishing the rest later", 0), vrow(A, "t1", "2/2 demo video(s) sent: a.mp4 + b.mp4", 4)], NOW);
ok(rep.chats === 1 && rep.sends === 2 && rep.doubles.length === 0 && rep.missing.length === 0, "a set finished in two steps by one computer is ONE clean delivery (counts are cumulative)");
rep = V.videoReport([vrow(A, "t2", "2/2 demo video(s) sent", 0), vrow(A, "t2", "2/2 demo video(s) sent", 30)], NOW);
ok(rep.doubles.length === 1 && /logged 2 times by the same computer/.test(rep.doubles[0].why), "the full set logged twice by the same computer → double");
rep = V.videoReport([vrow(A, "t3", "2/2 demo video(s) sent", 0), vrow(B, "t3", "2/2 demo video(s) sent", 2)], NOW);
ok(rep.doubles.length === 1 && /two computers/.test(rep.doubles[0].why) && rep.doubles[0].machines.size === 2, "two computers into one chat → double, both named");
rep = V.videoReport([vrow(A, "t4", "3/2 demo video(s) sent", 0)], NOW);
ok(rep.doubles.length === 1 && /more clips counted than the list holds \(3 of 2\)/.test(rep.doubles[0].why), "more clips than the list holds (a re-upload counted as a new clip) → double");
rep = V.videoReport([vrow(A, "t5", "1/2 demo videos sent — finishing the rest later", 0)], NOW);
ok(rep.missing.length === 1 && !rep.missing[0].why, "1 of 2 and an hour later still nothing → short of a clip");
rep = V.videoReport([vrow(A, "t5", "1/2 demo videos sent — finishing the rest later", 0)], T0 + 20 * 60000);
ok(rep.missing.length === 0 && rep.doubles.length === 0, "…but not after 20 minutes (the computer may still be finishing)");
rep = V.videoReport([vrow(A, "t6", "1/2 demo videos sent — finishing the rest later", 0)], NOW, [{ thread_id: "t6", machine: B, created_at: iso(30) }]);
ok(rep.missing.length === 1 && /since then Caisse · v0\.21\.75 has been answering this buyer/.test(rep.missing[0].why), "a short chat whose buyer ANOTHER computer answered since is named — the structural case (content.js stops at the partial row)");
rep = V.videoReport([vrow(A, "t6", "1/2 demo videos sent — finishing the rest later", 0)], NOW, [{ thread_id: "t6", machine: A, created_at: iso(30) }]);
ok(rep.missing.length === 1 && !rep.missing[0].why, "…not when the same computer kept answering (its own retry still owns the chat)");
rep = V.videoReport([vrow(A, "t7", "0/2 demo videos — native attach failed 3× (no link is ever sent)", 0), vrow(A, "t8", "1 staged demo clip(s) sent by the watcher (upload had finished, nobody had pressed send)", 0), { kind: "text", machine: A, thread_id: "t9", bot_text: "2/2 demo video(s) sent", created_at: iso(0) }], NOW);
ok(rep.chats === 1 && rep.sends === 1 && rep.doubles.length === 0 && rep.missing.length === 0, "a failed send is not a send; the watcher's row counts as one; a TEXT row with the words does not (the query is kind=video, the parser is the second wall)");
ok(V.videoReport([], NOW).chats === 0 && V.videoReport(null, NOW).chats === 0, "no rows → an empty report, never a throw");
ok(/\.eq\("kind", "video"\)\.gte\("created_at", since\)/.test(app) && /\.in\("thread_id", ids\)\.neq\("kind", "video"\)/.test(app), "loadVideoReport reads the video rows of the last 7 days, then who answered the short chats");
ok((app.match(/loadVideoReport\(\);/g) || []).length >= 2, "the report loads on the Videos tab and the Activity tab");
ok(/id="videoReport"/.test(html) && /Where the videos went, last 7 days/.test(html), "the Videos tab has the box");

console.log("\n— 3d. Copy report —");
const BR = between(app, "  async function buildReport()", '  if ($("copyReport"))');
ok(!/apiKey|supabaseAnonKey|password|access_token|refresh_token/.test(BR), "the report body never touches the key, a password or a token");
ok(/teachPreviewText\(\)/.test(BR) && /videoReportText/.test(BR) && /\$\("teachFleet"\)/.test(BR) && /\$\("costLine"\)/.test(BR) && /gapList\(gapRows, settings\.coaching, gapDismissed\(\)\)/.test(BR), "it gathers the fleet line, the cost lines, the video report, the gap list and the teaching text");
ok(/messagesOnly\(client\.from\("subsell_messages"\)/.test(BR) && /\.limit\(20\)/.test(BR), "…and the last 20 real messages (hidden kinds excluded)");
ok(/function renderTeachPreview\(\) \{[\s\S]{0,200}el\.textContent = teachPreviewText\(\);/.test(app) && /function teachPreviewText\(\) \{/.test(app), "the teaching panel and the report share one text function");
ok(/navigator\.clipboard\.writeText\(text\)/.test(app) && /box\.classList\.toggle\("hidden", copied\)/.test(app), "copied to the clipboard; when the browser refuses, the text is shown to select by hand");
ok(/id="copyReport"/.test(html) && /id="reportBox"/.test(html) && /id="reportText"/.test(html) && /id="reportClose"/.test(html), "the button and the fallback box are in the markup");

console.log("\n— 4. RUNTIME: a live row still carrying the old gate gets ONE system save on open —");
function makeDom() {
  const cache = {};
  function mkEl(id) {
    const cls = new Set();
    const el = {
      id, textContent: "", checked: false, disabled: false, readOnly: false, title: "", style: {}, dataset: {}, files: null, children: [], _h: {},
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      async fire(ev) { for (const fn of el._h[ev] || []) await fn({ preventDefault() {}, target: el, key: "" }); },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {}, after() {}, setAttribute() {}, getAttribute() { return ""; },
      querySelector() { return mkEl("q"); }, querySelectorAll() { return []; }, focus() {}, click() {}, select() {},
    };
    let h = "";
    Object.defineProperty(el, "innerHTML", { get: () => h, set: (v) => { h = v; if (v === "") el.children = []; } });
    let val = "";
    Object.defineProperty(el, "value", { get: () => val, set: (v) => { val = v == null ? "" : String(v); } });
    return el;
  }
  const document = {
    getElementById(id) { return (cache[id] = cache[id] || mkEl(id)); },
    querySelector() { return mkEl("qs"); }, querySelectorAll() { return []; },
    createElement(t) { return mkEl("new-" + t); }, addEventListener() {}, body: mkEl("body"),
  };
  for (const id of ["fixBanner", "draftBanner", "loginView", "teachPreview"]) document.getElementById(id).classList.add("hidden");
  return { document, cache };
}
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const state = { row: null, updates: [], flashes: [] };
function makeClient() {
  function table(name) {
    const q = {
      _payload: null, _filters: {},
      select() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; }, in() { return q; },
      eq(col, val) { q._filters[col] = val; return q; },
      maybeSingle: async () => (name === "subsell_configs" ? { data: clone(state.row), error: null } : { data: null, error: null }),
      update(p) { q._payload = p; return q; }, insert(p) { q._payload = p; return q; },
      then(res, rej) {
        let out = { data: [], error: null };
        if (q._payload && name === "subsell_configs") {
          state.updates.push(clone(q._payload.config));
          state.row.config = clone(q._payload.config);
          state.row.updated_at = "2026-10-06T12:00:0" + state.updates.length + "+00:00";
          out = { data: [{ updated_at: state.row.updated_at }], error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  }
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1", email: "owner@example" } } } }), onAuthStateChange() {}, signInWithPassword: async () => ({}), signOut: async () => ({}) },
    from: table,
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
}
async function loadPage(rowConfig) {
  state.row = { config: rowConfig, config_key: "ck", updated_at: "2026-10-06T11:00:00+00:00" };
  state.updates = [];
  const dom = makeDom();
  global.document = dom.document;
  global.window = { addEventListener() {}, open() {}, SUBSELL_SUPABASE_URL: "https://example.supabase.co", SUBSELL_SUPABASE_ANON_KEY: "anon", location: { href: "https://example.test/", hash: "", origin: "https://example.test" }, localStorage };
  global.localStorage = localStorage;
  global.location = global.window.location;
  global.navigator = { userAgent: "node" };
  global.fetch = async () => ({ ok: true, text: async () => "", json: async () => ({}) });
  global.supabase = { createClient: makeClient };
  global.alert = () => {}; global.confirm = () => true;
  try { new Function(app)(); } catch (e) { console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message)); console.error((e && e.stack || "").split("\n").slice(0, 8).join("\n")); process.exit(1); }
  await sleep(150);
  return dom;
}
(async () => {
  const live = { apiKey: "sk-real", model: "claude-haiku-4-5", businessInfo: "INFO", instructions: "TONE", examples: "", priceList: "",
    videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "", businessHoursEnabled: true, businessHoursStart: 9, businessHoursEnd: 22 };
  let dom = await loadPage(live);
  ok(state.updates.length === 1, "a row as every live account has it (businessHoursEnabled:true) → exactly one write on open (writes=" + state.updates.length + ")");
  const w = state.updates[0] || {};
  ok(w.businessHoursEnabled === false, "…which writes businessHoursEnabled:false — the builds before .75 stop gating replies on their next pull");
  ok(!w.replyWindowOnly, "…and does NOT switch the new window on (replyWindowOnly stays off)");
  ok(w.apiKey === "sk-real" && w.businessInfo === "INFO" && w.instructions === "TONE" && w.businessHoursStart === 9 && w.businessHoursEnd === 22, "…and keeps every other field, the hours included (they still window the follow-ups)");
  ok(/answered at any hour/.test(dom.cache.savedMsg.textContent), "the page says what it did: " + JSON.stringify(dom.cache.savedMsg.textContent).slice(0, 90));
  ok(dom.cache.replyWindowOnly.checked === false && dom.cache.businessHoursStart.value === "9", "the form shows the window OFF and the hours as saved");
  dom = await loadPage(Object.assign({}, live, { businessHoursEnabled: false }));
  ok(state.updates.length === 0, "a row already disarmed → the page writes nothing on open");
  dom = await loadPage(Object.assign({}, live, { businessHoursEnabled: false, replyWindowOnly: true }));
  ok(state.updates.length === 0 && dom.cache.replyWindowOnly.checked === true, "an owner who opted back into a reply window keeps it (shown ticked, nothing written)");
  console.log("\n" + (failed ? failed + " check(s) FAILED" : "all checks passed"));
  process.exit(failed ? 1 : 0);
})();
