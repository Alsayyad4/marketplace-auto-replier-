/* Tests the dead account key and the second door (background.js, v0.21.79).
 *
 * Why this file exists: Oct 7 2026, three photos of three computers on one account —
 *   - "Activity log ✗ HTTP 404 {"error":"not found"}": the subsell-log function says
 *     the config key this computer sends matches no account row. The key was cached
 *     once (from a login or a pasted URL) and never looked at again: after the
 *     dashboard's "Regenerate key", or a change of account, every row that computer
 *     sent was refused for ever, and the other computers' chat memory never saw them;
 *   - "cloud sync frozen — log in again" / "API key NOT set": a login that cannot
 *     refresh (Supabase's per-address /token limit, or a login that ended) left the
 *     computer on a frozen copy, and a Log out took the API key with it — while the
 *     computer still held the account key, which already returns the whole config
 *     through subsell-config and writes every Activity row through subsell-log.
 *
 * Under test:
 *   1. a row sent with a dead key: the key is dropped, looked up again (the row, when
 *      the login works) and the row is sent once more — it is not lost;
 *   2. with the login out there is nothing to look it up with: the key is dropped and
 *      the breadcrumb says so, without a single /token request;
 *   3. a full pull carries the row's key: a regenerated key reaches the computer on
 *      its next pull; a key that was never tied to this login is re-read at once;
 *   4. a pasted URL whose key the cloud refused is not cached again — until a fetch
 *      of that URL (a fresh paste) proves its key alive;
 *   5. THE SECOND DOOR: logged in but waiting out a refusal, the settings come through
 *      the account key (one GET to subsell-config, no /token, no REST) and the new API
 *      key is in force; the stamp is untouched; the popup's breadcrumbs are written;
 *   6. the door opens at most every 5 min, says "unchanged" for the same settings and
 *      writes nothing then; a click (Pull now) goes through at once;
 *   7. an emptied account through the key is refused like any other, and the heal
 *      (a write) waits for the login;
 *   8. a key that matches no account: dropped, said so, and the next pull is the plain
 *      hold line with no request;
 *   9. after a Log out (no cloudAuth) the door stays shut; Log out removes the door's
 *      marks and keeps the Activity-log key; a working login clears the marks;
 *  10. THE MEMORY through the key: the chat's rows come from subsell-log `read` with
 *      the chat, the kinds and the limit; an older function (no `read`) is remembered
 *      for an hour; a 404 on a read drops the key; a working login still reads REST;
 *  11. canonJson: same settings in another key order compare equal, arrays keep order;
 *  12. THE STORM with the door open: 30 minutes of pulls under a rate-limit wait —
 *      six GETs through the key, and only the login's own sparse retries on /token;
 *  13. the popup, the Settings page and the dashboard carry the new sentences (source);
 *  14. PROVENANCE (review): the doors open only for THIS login's key — never a key
 *      cached for another account or pasted for one; a key with no provenance is
 *      re-read from the row at once; a login into another account drops the old key;
 *      a computer with only the config link reads the memory with the URL's key;
 *  15. HONESTY (review): a failure after a success clears the "still arrive" marks —
 *      the popup never claims what no longer happens;
 *  16. only the functions' own 404 ({"error":"not found"}) is a dead key: the
 *      gateway's 404 for a missing function keeps the key;
 *  17. a door answer that arrives after a working login took over is dropped;
 *  18. the memory door backs off for two minutes after a timeout / 5xx.
 *
 * Run:  node store/smoke-keydoor.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const popupSrc = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");
const optionsSrc = fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8");
const appSrc = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");
const indexSrc = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");

const from = src.indexOf("const CFG_BACKUP_KEY");
const to = src.indexOf("/* ---------------- counters / rate limits ---------------- */");
if (from < 0 || to < 0) { console.error("cloud block not found in background.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
let finished = false;
process.on("exit", () => { if (!finished) { console.log("  FAIL  the test never reached its end (a promise never settled)"); process.exitCode = 1; } });

const MIN = 60 * 1000, HOUR = 60 * MIN;
const T0 = Date.parse("2026-10-07T15:00:00Z");
const clock = { t: T0 };
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock.t); }
  static now() { return clock.t; }
}
const FakeMath = Object.create(Math);
FakeMath.random = () => 0;

const copy = (v) => JSON.parse(JSON.stringify(v));
const json = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  headers: { get: (h) => (String(h).toLowerCase() === "date" ? new Date(clock.t).toUTCString() : null) },
  json: async () => copy(body), text: async () => JSON.stringify(body), clone() { return this; },
});
const LIMITED = () => json(429, { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" });
const FRESH = (n) => json(200, { access_token: "at-" + n, refresh_token: "rt-" + n, expires_in: 3600, user: { id: "u1", email: "op@example.com" } });
const GATEWAY_404 = () => json(404, { code: "NOT_FOUND", message: "Requested function was not found" });

const LINK_OFF = { videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "" };
const OLD = Object.assign({
  apiKey: "sk-old", model: "claude-haiku-4-5", businessInfo: "Used iPhones in Montréal", instructions: "Be warm",
  listings: [{ title: "iPhone 13" }], demoVideoUrls: [{ url: "https://x/v.mp4" }],
}, LINK_OFF);
const NEW = Object.assign({}, OLD, { apiKey: "sk-new", instructions: "Be warm and short", demoVideoUrls: [{ url: "https://x/v.mp4" }, { url: "https://x/w.mp4" }] });
const OTHER = Object.assign({}, OLD, { apiKey: "sk-ACCOUNT-OTHER", businessInfo: "Somebody else's shop" });
const WIPED = Object.assign({ apiKey: "", model: "", businessInfo: "", instructions: "", listings: [], demoVideoUrls: [] }, LINK_OFF);

const authLeft = (ms) => ({ access_token: "at-0", refresh_token: "rt-0", expires_at: clock.t + ms, ttl_ms: HOUR, user_id: "u1", email: "op@example.com" });
const HOLD_LIMITED = (until) => ({ kind: "limited", n: 2, at: clock.t, until, status: 429, msg: "Request rate limit reached" });
const HOLD_ENDED = (until) => ({ kind: "ended", n: 1, at: clock.t, until, status: 400, msg: "Invalid Refresh Token: Refresh Token Not Found" });
// a logged-in computer whose login is out, with its own key (the second door's population)
const DOOR_STORE = (cfg, extra) => Object.assign({ cloudAuth: authLeft(-5 * MIN), cloudAuthHold: HOLD_LIMITED(clock.t + 10 * MIN), configKey: "k1", configKeyUser: "u1", cloudConfig: copy(cfg) }, extra || {});
function gate() { let open; const p = new Promise((r) => { open = r; }); return { p, open }; }

// The cloud: one account row (REST), the two functions keyed by config_key, the Activity rows.
function cloud(opts) {
  opts = opts || {};
  const c = {
    row: opts.row || { config: OLD, updated_at: "s1", config_key: "k1" },
    keys: opts.keys || { k1: "u1" },        // config_key -> user, what the functions resolve
    fnConfigs: opts.fnConfigs || null,       // per key, what subsell-config serves (default: the row's config)
    fnConfig: opts.fnConfig || null,
    msgRows: opts.msgRows || [],             // subsell_messages
    oldFunction: !!opts.oldFunction,         // a subsell-log without `read`
    gateway404: false,                       // the functions gateway's own 404 (missing / renamed function)
    readDown: false,                         // the read answers 503
    fullDown: false,                         // the REST full fetch answers 503
    cfgGate: null,                           // the config GET waits for this before answering
    refresh: opts.refresh || (() => LIMITED()),
    calls: { token: 0, password: 0, probe: 0, full: 0, keyRead: 0, live: 0, cfgFn: 0, logPost: 0, logRead: 0, rest: 0, push: 0, other: 0 },
    posted: [], reads: [],
  };
  c.fetch = async (url, init) => {
    const u = String(url);
    const method = (init && init.method) || "GET";
    if (u.indexOf("/auth/v1/token?grant_type=refresh_token") >= 0) { c.calls.token++; return c.refresh(JSON.parse(init.body)); }
    if (u.indexOf("/auth/v1/token?grant_type=password") >= 0) { c.calls.password++; return FRESH(9); }
    if (u.indexOf("/functions/v1/subsell-config?key=") >= 0) {
      c.calls.cfgFn++;
      if (c.cfgGate) await c.cfgGate.p;
      if (c.gateway404) return GATEWAY_404();
      const k = decodeURIComponent(u.split("key=")[1]);
      if (!c.keys[k]) return json(404, { error: "not found" });
      return json(200, (c.fnConfigs && c.fnConfigs[k]) || c.fnConfig || c.row.config);
    }
    if (u.indexOf("/functions/v1/subsell-log") >= 0 && method === "POST") {
      const body = JSON.parse(init.body);
      if (c.gateway404) return GATEWAY_404();
      if (body.read) {
        c.calls.logRead++;
        if (!c.keys[body.key]) return json(404, { error: "not found" });
        if (c.readDown) return json(503, { error: "db 503 down" });
        if (c.oldFunction) return json(200, { ok: true, inserted: 0 }); // before .79: no `read`
        c.reads.push(body);
        let rows = c.msgRows.filter((r) => c.keys[body.key] === "u1" && (!body.read.thread_id || r.thread_id === body.read.thread_id) && (!body.read.kinds || body.read.kinds.indexOf(r.kind) >= 0));
        rows = rows.slice(0, body.read.limit || 30);
        return json(200, { ok: true, rows });
      }
      c.calls.logPost++;
      if (!c.keys[body.key]) return json(404, { error: "not found" });
      c.posted.push(body);
      return json(200, { ok: true, inserted: (body.events || []).length });
    }
    if (u.indexOf("/rest/v1/subsell_configs") >= 0 && method === "POST") { c.calls.push++; return json(200, [{ updated_at: "pushed" }]); }
    if (u.indexOf("select=updated_at") >= 0) { c.calls.probe++; return json(200, [{ updated_at: c.row.updated_at }]); }
    if (u.indexOf("select=config,updated_at,config_key") >= 0) { c.calls.full++; if (c.fullDown) return json(503, { message: "down" }); return json(200, [{ config: c.row.config, updated_at: c.row.updated_at, config_key: c.row.config_key }]); }
    if (u.indexOf("select=config_key") >= 0) { c.calls.keyRead++; return json(200, [{ config_key: c.row.config_key }]); }
    if (u.indexOf("select=config") >= 0) { c.calls.live++; return json(200, [{ config: c.row.config }]); }
    if (u.indexOf("/rest/v1/subsell_messages?") >= 0) { c.calls.rest++; return json(200, c.msgRows); }
    c.calls.other++;
    return json(200, []);
  };
  return c;
}

// One Chrome profile: its own storage and its own copy of the module.
function build(store, c) {
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.assign({}, store)),
      set: (v, cb) => { Object.assign(store, v); if (cb) cb(); },
      remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); if (cb) cb(); },
    } },
    runtime: { lastError: null },
  };
  const api = new Function(
    "chrome", "LOG", "fetch", "syncedConfigRead", "syncedConfigWrite", "readManagedConfig", "DEFAULTS", "SEED_CONFIG", "Date", "Math", "setTimeout",
    block + "; return { cloudValidAuth, cloudLogin, cloudPull, cloudPullRaw, cloudPullViaKey, applyPulledConfig, canonJson, cloudLogout, cloudStatus, mirrorToCloud, getConfigKey, dropConfigKey, adoptRowKey, deadKeyAnswer, memThreadRows, memVideoRows, memRecentRows, memFetch, memKeyDoor, fetchRemoteConfig, getSettings, KEY_PULL_MIN_MS };"
  )(chrome, () => {}, c.fetch, (cb) => cb({}, false), async () => true, async () => null,
    { apiKey: "", model: "claude-haiku-4-5", enabled: false }, {}, FakeDate, FakeMath, setTimeout);
  return { api, store, c };
}
const settle = () => new Promise((r) => setTimeout(r, 8));
const entry = () => ({ action: "text", thread: "Buyer", threadId: "t1", buyer: "allo", reply: "salut" });
const rowAt = (m) => new Date(clock.t - m * MIN).toISOString();
const ROWS = () => [
  { created_at: rowAt(1), machine: "Shop PC · v0.21.79 #PC-aaaaa", kind: "text", thread_id: "t1", buyer_text: "allo", bot_text: "salut!" },
  { created_at: rowAt(2), machine: "Shop PC · v0.21.79 #PC-aaaaa", kind: "video", thread_id: "t1", buyer_text: null, bot_text: "1/2 demo video sent" },
  { created_at: rowAt(3), machine: "Laval · v0.21.79 #PC-bbbbb", kind: "text", thread_id: "t2", buyer_text: "prix?", bot_text: "450$" },
  { created_at: rowAt(4), machine: "Shop PC · v0.21.79 #PC-aaaaa", kind: "teach", thread_id: null, buyer_text: null, bot_text: "teaching deadbeef mem=on" },
];

(async () => {
  /* 1 — a dead key on the mirror, the login healthy: look it up, send again */
  clock.t = T0;
  let c = cloud({ row: { config: OLD, updated_at: "s1", config_key: "k-new" }, keys: { "k-new": "u1" } });
  let st = { cloudAuth: authLeft(45 * MIN), configKey: "k-old", configKeyUser: "u1", cloudConfig: copy(OLD), cloudUpdatedAt: "s1" };
  let m = build(st, c);
  let sent = await m.api.mirrorToCloud(entry());
  ok(sent === true, "a row sent with a dead key lands anyway");
  ok(st.configKey === "k-new" && st.configKeyUser === "u1", "the computer looked the current key up (the row) and remembers whose it is — key=" + st.configKey + " user=" + st.configKeyUser);
  ok(c.calls.logPost === 2 && c.posted.length === 1 && c.posted[0].key === "k-new" && c.calls.keyRead === 1,
     "two POSTs (the refused one, the retry with the current key) and one key lookup — posts=" + c.calls.logPost + " lookups=" + c.calls.keyRead);
  ok(st.lastMirror && st.lastMirror.ok === true && st.lastMirror.rekeyed === true, "the breadcrumb says the row landed, re-keyed");
  ok(!st.configKeyDead, "the dead mark is gone once a live key is found");
  sent = await m.api.mirrorToCloud(entry());
  ok(sent === true && c.calls.logPost === 3 && c.calls.keyRead === 1, "the next row: one POST, no lookup");

  /* 2 — a dead key while the login is out: nothing to look it up with, no /token */
  c = cloud({ row: { config: OLD, updated_at: "s1", config_key: "k-new" }, keys: { "k-new": "u1" } });
  st = DOOR_STORE(OLD, { configKey: "k-old" });
  m = build(st, c);
  sent = await m.api.mirrorToCloud(entry());
  ok(sent === false && !st.configKey && !st.configKeyUser && st.configKeyDead === "k-old", "with the login out the dead key is dropped and remembered — dead=" + st.configKeyDead);
  ok(c.calls.token === 0 && c.calls.keyRead === 0, "no /token request, no REST lookup during the wait");
  ok(/no longer valid/.test(st.lastMirror.error) && /log in/.test(st.lastMirror.error), "the breadcrumb names the dead key and the cure: " + st.lastMirror.error);
  sent = await m.api.mirrorToCloud(entry());
  ok(sent === false && c.calls.logPost === 1 && /no longer valid/.test(st.lastMirror.error), "the next row: no key, no POST, the same honest line");

  /* 3 — a full pull carries the row's key; an untied key is re-read at once */
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k-new" }, keys: { "k-new": "u1" } });
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k-old", configKeyDead: "k-older", cloudConfig: copy(OLD), cloudUpdatedAt: "s1" }; // no configKeyUser: a build before .79
  m = build(st, c);
  let r = await m.api.cloudPullRaw(false);
  ok(r.ok && r.keys > 0 && st.cloudConfig.apiKey === "sk-new", "a changed row is applied — keys=" + r.keys);
  ok(st.configKey === "k-new" && st.configKeyUser === "u1" && !st.configKeyDead, "the row's key replaces the cached one, with its owner, and clears the dead mark — key=" + st.configKey);
  ok(c.calls.probe === 0 && c.calls.full === 1, "a key never tied to this login skips the stamp probe once: the full fetch adopts it — probe=" + c.calls.probe + " full=" + c.calls.full);
  r = await m.api.cloudPullRaw(false);
  ok(r.unchanged === true && c.calls.full === 1 && c.calls.probe === 1, "from then on an unchanged stamp costs the probe only");
  c.row.config_key = "k-newer"; c.row.updated_at = "s3"; // the regen itself: the dashboard bumps the stamp when it writes the new key
  r = await m.api.cloudPullRaw(false);
  ok(r.unchanged !== true && st.configKey === "k-newer" && c.calls.full === 2, "a regenerated key reaches the computer on the next minute — key=" + st.configKey);

  /* 4 — a pasted URL whose key died is not cached again; a fetch of a URL proves its key */
  c = cloud({ keys: { "k-url": "u1" }, fnConfig: NEW });
  st = { remoteConfigUrl: "https://x.supabase.co/functions/v1/subsell-config?key=k-dead", configKeyDead: "k-dead" };
  m = build(st, c);
  let k = await m.api.getConfigKey();
  ok(k === "" && !st.configKey, "a pasted URL whose key the cloud refused is not cached again");
  let f = await m.api.fetchRemoteConfig(true);
  ok(f.ok === false && /404/.test(f.error) && !st.configKey, "the automatic fetch of that URL is refused (404) and stores nothing");
  st.remoteConfigUrl = "https://x.supabase.co/functions/v1/subsell-config?key=k-url"; // the owner pastes the new URL
  f = await m.api.fetchRemoteConfig();
  ok(f.ok && st.configKey === "k-url" && st.configKeyUser === "" && !st.configKeyDead && st.remoteConfig && st.remoteConfig.apiKey === "sk-new", "a URL that serves settings sets its key (nobody's login) and clears the dead mark");

  /* 5 — THE SECOND DOOR: the settings arrive while the login waits out a rate limit */
  clock.t = T0;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1", cloudConfigAt: T0 - HOUR });
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === true && r.viaKey === true && r.keys > 0, "with the login out, the settings come through the account key — " + JSON.stringify({ ok: r.ok, viaKey: r.viaKey, keys: r.keys }));
  ok(c.calls.token === 0 && c.calls.cfgFn === 1 && c.calls.full === 0 && c.calls.probe === 0, "no /token, no REST: one GET to subsell-config");
  ok(st.cloudConfig.apiKey === "sk-new" && (await m.api.getSettings()).apiKey === "sk-new", "the new API key is in force on this computer");
  ok(st.cloudConfig.demoVideoUrls.length === 2, "...and the new demo video with it");
  ok(st.cloudUpdatedAt === "s1", "the stamp is not touched (the key door has none)");
  ok(st.cloudStale && st.cloudKeyDoor && st.cloudKeyDoor.okAt === clock.t && st.cloudKeyDoor.error === "" && /^applied/.test(st.cloudKeyDoor.last), "the popup's breadcrumbs: frozen login, settings arriving — " + JSON.stringify(st.cloudKeyDoor));
  ok(/limiting logins/.test(r.login), "the result still says what the login is doing: " + r.login);
  let s = await m.api.cloudStatus();
  ok(s.keyDoor && s.keyDoor.okAt === clock.t && /limiting logins/.test(s.holdLine), "the Settings page sees the door and the wait");

  /* 6 — at most every 5 min; unchanged = nothing written; a click goes through */
  clock.t += MIN;
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && c.calls.cfgFn === 1 && /limiting logins/.test(r.error), "a minute later: not due — the hold line, no request");
  clock.t += 5 * MIN;
  const atBefore = st.cloudConfigAt;
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === true && r.unchanged === true && r.viaKey === true && c.calls.cfgFn === 2, "five minutes on: fetched again, the same settings → unchanged");
  ok(st.cloudConfigAt === atBefore && st.cloudKeyDoor.last === "unchanged", "...and nothing was written");
  clock.t += MIN;
  r = await m.api.cloudPullRaw(true);
  ok(r.ok === true && r.viaKey === true && c.calls.cfgFn === 3, "Pull now goes through the 5-min wait");
  ok(c.calls.token === 1, "the click may try the login once too, as .78 allows — /token requests=" + c.calls.token);
  c.row.config = Object.assign({}, NEW, { instructions: "Be warm, short, and name the shop" }); // a dashboard edit
  clock.t += 5 * MIN;
  r = await m.api.cloudPullRaw(false);
  ok(r.ok && r.keys > 0 && st.cloudConfig.instructions === "Be warm, short, and name the shop", "an edit saved in the dashboard reaches the frozen computer");

  /* 7 — an emptied account through the key is refused; the heal waits for the login */
  clock.t = T0 + HOUR;
  c = cloud({ row: { config: WIPED, updated_at: "s3", config_key: "k1" } });
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok && r.wiped === true && r.viaKey === true && r.healed === false && /waits for the login/.test(r.healError), "an emptied account through the key is refused, the heal waits for the login — " + r.healError);
  ok(st.cloudConfig.apiKey === "sk-old" && st.cloudWipe && st.cloudUpdatedAt === "s1", "this computer keeps its settings; the wipe is recorded; the stamp untouched");
  ok(c.calls.push === 0 && c.calls.token === 0 && c.calls.live === 0, "nothing was written or even re-read");

  /* 8 — the key matches no account */
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k-new" }, keys: { "k-new": "u1" } });
  st = DOOR_STORE(OLD, { cloudAuthHold: HOLD_ENDED(clock.t + 30 * MIN), configKey: "k-old" });
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && r.keyDead === true && /no longer valid/.test(r.error) && /log in again/.test(r.error), "a key that matches no account: dropped, and said so — " + r.error);
  ok(!st.configKey && st.configKeyDead === "k-old" && st.cloudKeyDoor && /404/.test(st.cloudKeyDoor.error) && !st.cloudKeyDoor.okAt, "the dead mark and the door's error are recorded, no okAt");
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && !r.viaKey && c.calls.cfgFn === 1 && /login ended/.test(r.error), "with no key left, the next pull is the plain hold line and no request");

  /* 9 — Log out shuts the door; it removes the marks and keeps the Activity-log key; a login clears the marks */
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  st = { configKey: "k1", configKeyUser: "u1" }; // no cloudAuth: logged out (or never logged in)
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && r.error === "not logged in" && c.calls.cfgFn === 0, "after a Log out the key door stays shut (the dialog's promise holds)");
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k1", configKeyUser: "u1", cloudConfig: copy(OLD), cloudKeyDoor: { okAt: 1, triedAt: 1 }, cloudStale: { since: 1 } };
  m = build(st, c);
  await m.api.cloudLogout();
  ok(!st.cloudAuth && !st.cloudConfig && !st.cloudKeyDoor && !st.cloudStale && st.configKey === "k1", "Log out removes the login, the settings and the door's marks; the Activity-log key stays");
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k1", configKeyUser: "u1", cloudConfig: copy(OLD), cloudUpdatedAt: "s0", cloudKeyDoor: { okAt: 1, triedAt: 1 }, cloudStale: { since: 1 } };
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  await settle();
  ok(r.ok && !st.cloudStale && !st.cloudKeyDoor, "the login works again: the frozen mark and the door's marks are gone");

  /* 10 — THE MEMORY through the key */
  clock.t = T0 + 2 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  st = DOOR_STORE(NEW);
  m = build(st, c);
  let rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(Array.isArray(rows) && rows.length === 2 && rows.every((x) => x.thread_id === "t1"), "with the login out, the chat memory reads through the account key — rows=" + (rows && rows.length));
  ok(c.calls.logRead === 1 && c.calls.rest === 0 && c.calls.token === 0, "one POST to subsell-log (read), no REST, no /token");
  ok(c.reads[0].key === "k1" && c.reads[0].read.thread_id === "t1" && JSON.stringify(c.reads[0].read.kinds) === JSON.stringify(["text", "followup", "video", "claim"]) && c.reads[0].read.limit === 60,
     "the read names the chat, the kinds and the limit — " + JSON.stringify(c.reads[0].read));
  ok(st.memStats && st.memStats.reads === 1 && st.memStats.keyAt === clock.t && !st.memStats.keyUnsupportedAt, "memStats: one read, through the key — " + JSON.stringify(st.memStats));
  rows = await m.api.memVideoRows("t1");
  ok(rows && rows.length === 1 && rows[0].kind === "video" && c.reads[1].read.kinds[0] === "video" && c.reads[1].read.limit === 5, "the video rows alone, through the key");
  rows = await m.api.memRecentRows();
  ok(rows && rows.length === 2 && !c.reads[2].read.thread_id && c.reads[2].read.limit === 30, "the account-wide recent list, through the key (no chat, limit 30)");
  c.oldFunction = true; // an older function: no `read` — remembered for an hour
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && st.memStats.keyUnsupportedAt === clock.t && st.memStats.keyAt === 0 && /deploy the \.79/.test(st.memStats.lastErr), "an older subsell-log (no read) → no memory, remembered, and the memory mark is cleared: " + st.memStats.lastErr);
  let before = c.calls.logRead;
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && c.calls.logRead === before, "...it is not asked again within the hour");
  clock.t += 61 * MIN;
  st.cloudAuthHold = HOLD_LIMITED(clock.t + 10 * MIN); // the login still out
  c.oldFunction = false;
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows && rows.length === 2 && c.calls.logRead === before + 1 && !st.memStats.keyUnsupportedAt && st.memStats.keyAt === clock.t, "an hour later it asks again, and a .79 function answers");
  c.keys = { "k-new": "u1" }; // the key died
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && !st.configKey && st.configKeyDead === "k1" && /404/.test(st.memStats.lastErr) && st.memStats.keyAt === 0, "a 404 on the read drops the key and the memory mark — " + st.memStats.lastErr);
  st = { cloudAuth: authLeft(-5 * MIN), cloudAuthHold: HOLD_LIMITED(clock.t + 10 * MIN) }; // no key, no login
  m = build(st, c);
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && /no account key/.test(st.memStats.lastErr), "no key and no login: no memory, said plainly — " + st.memStats.lastErr);
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: [{ created_at: rowAt(1), machine: "x", kind: "text", thread_id: "t1", buyer_text: "a", bot_text: "b" }] });
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k1", configKeyUser: "u1", cloudConfig: copy(NEW) }; // a working login: REST, as before
  m = build(st, c);
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows && rows.length === 1 && c.calls.rest === 1 && c.calls.logRead === 0 && !st.memStats.keyAt, "with a working login the read is the REST one, untouched");

  /* 11 — canonJson */
  const cj = m.api.canonJson;
  ok(cj({ b: 1, a: [{ d: 1, c: 2 }] }) === cj({ a: [{ c: 2, d: 1 }], b: 1 }), "the same settings in another key order compare equal");
  ok(cj([1, 2]) !== cj([2, 1]) && cj({ a: 1 }) !== cj({ a: "1" }), "arrays keep their order; a number is not its string");

  /* 12 — THE STORM with the door open: 30 min of pulls under a rate-limit wait */
  clock.t = T0 + 4 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  for (let i = 0; i < 30; i++) { await m.api.cloudPullRaw(false); await settle(); clock.t += MIN; }
  ok(c.calls.cfgFn === 6, "thirty minutes of pulls: six GETs through the key (every 5 min) — got " + c.calls.cfgFn);
  ok(c.calls.token <= 3, "and only the login's own sparse retries on /token — got " + c.calls.token);
  ok(st.cloudConfig.apiKey === "sk-new", "the computer ran on the current settings the whole time");

  /* 13 — the sentences (source) */
  ok(/settings and chat memory still arrive through the account key; log in again when convenient \(Options\)/.test(popupSrc) &&
     /settings still arrive through the account key, but this computer cannot see what the others answered: log in again \(Options\)/.test(popupSrc) &&
     /"⚠ " \+ what \+ " — log in again \(Options\)"/.test(popupSrc), "the popup says what still works and what does not");
  ok(/const doorOk = !!\(kd && kd\.okAt && !kd\.error/.test(popupSrc) && /const memOk = !!\(s\.memKeyAt && s\.memKeyAt > 0\)/.test(popupSrc), "the popup's claims rest on marks that any later failure clears (no 20-min window for the memory)");
  ok(/through the account key/.test(optionsSrc) && /kd\.okAt && !kd\.error/.test(optionsSrc) && /lp\.ok === false && !lp\.viaKey/.test(optionsSrc), "the Settings page names the door and shows a dead key's own line, not the bare wait");
  ok(/Computers running v0\.21\.79 or newer whose cloud login is working/.test(appSrc) && /switches when it logs in again/.test(appSrc) && !/re-paste the new URL into each extension/.test(appSrc) && /v0\.21\.79 or newer with a working cloud login/.test(indexSrc),
     "the dashboard's Regenerate key promises only what .79 keeps: a working login, up to date");
  ok(/select=config,updated_at,config_key/.test(src) && /adoptRowKey\(rows\[0\], auth\.user_id\)/.test(src), "the full pull carries the key, with its owner");
  ok(/select=updated_at`/.test(src.slice(src.indexOf("async function cloudPullRaw"))), "the stamp probe is unchanged (no key on the cheap request)");
  ok(/"key\(FAIL " \+ cut\(st\.cloudKeyDoor\.error, 30\) \+ "\)" \/\/ the latest attempt first/.test(src) && /"key\(trying\)"/.test(src), "the diagnostic's door= shows the latest attempt first");

  /* 14 — PROVENANCE: the doors open only for THIS login's key */
  clock.t = T0 + 6 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, keys: { k1: "u1", "k-other": "u2" }, fnConfigs: { "k-other": OTHER }, msgRows: ROWS() });
  st = DOOR_STORE(OLD, { configKey: "k-other", configKeyUser: "u2" }); // another account's key, cached
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && !r.viaKey && c.calls.cfgFn === 0 && !st.cloudKeyDoor && st.cloudConfig.apiKey === "sk-old", "another account's key never opens the settings door: the hold line, no GET, this computer's settings untouched");
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && c.calls.logRead === 0 && /not this login's/.test(st.memStats.lastErr), "…nor the memory door — " + st.memStats.lastErr);
  st = DOOR_STORE(OLD, { configKey: "k1" }); delete st.configKeyUser; // a key cached by a build before .79: no owner known
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && !r.viaKey && c.calls.cfgFn === 0, "a key with no known owner (a build before .79) keeps the door shut until the login re-reads it");
  // …and a working login re-reads it at once, whatever the stamp
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k1", cloudConfig: copy(NEW), cloudUpdatedAt: "s2" }; // stamp unchanged; no owner
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.unchanged === true && c.calls.probe === 0 && c.calls.full === 1 && st.configKeyUser === "u1", "a working login ties the key to itself on the next minute even with an unchanged stamp — full=" + c.calls.full + " probe=" + c.calls.probe);
  r = await m.api.cloudPullRaw(false);
  ok(r.unchanged === true && c.calls.probe === 1 && c.calls.full === 1, "…and goes back to the cheap probe");
  // a login into another account drops the old key; the login's pull adopts the new one
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  st = { configKey: "kA", configKeyUser: "uA" };
  m = build(st, c);
  let login = await m.api.cloudLogin("op@example.com", "pw");
  ok(login.ok && st.configKey === "k1" && st.configKeyUser === "u1", "a login into another account: its pull adopts that account's key — " + st.configKey + "/" + st.configKeyUser);
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  c.fullDown = true;
  st = { configKey: "kA", configKeyUser: "uA" };
  m = build(st, c);
  login = await m.api.cloudLogin("op@example.com", "pw");
  ok(login.ok && login.pull && login.pull.ok === false && !st.configKey && !st.configKeyUser, "…and when that pull fails, the old account's key is gone rather than kept (nothing is attributed to it)");
  // a computer with only the config link (never logged in) reads the memory with the URL's key
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  st = { remoteConfigUrl: "https://x.supabase.co/functions/v1/subsell-config?key=k1", remoteConfig: copy(NEW) };
  m = build(st, c);
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows && rows.length === 2 && c.calls.logRead === 1 && st.configKey === "k1" && st.configKeyUser === "", "a config-link computer (no login) reads the chat memory with the URL's key — it is that account's own machine");

  /* 15 — HONESTY: a failure after a success clears the marks the popup claims from */
  clock.t = T0 + 7 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(st.cloudKeyDoor.okAt === clock.t && st.memStats.keyAt === clock.t, "a working door: both marks set");
  c.keys = {}; // the dashboard made a new key
  clock.t += 5 * MIN;
  r = await m.api.cloudPullRaw(false);
  ok(r.keyDead === true && st.cloudKeyDoor.okAt === 0 && /404/.test(st.cloudKeyDoor.error), "the key dies → okAt is 0: the popup stops saying the settings still arrive — " + JSON.stringify(st.cloudKeyDoor));
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  await m.api.cloudPullRaw(false);
  c.fnConfig = null; c.keys = { k1: "u1" };
  c.fetch = ((orig) => async (u, i) => (String(u).indexOf("subsell-config?key=") >= 0 ? json(503, { error: "db 503" }) : orig(u, i)))(c.fetch);
  m = build(st, c);
  clock.t += 5 * MIN;
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && !r.keyDead && st.configKey === "k1" && st.cloudKeyDoor.okAt === 0 && st.cloudKeyDoor.error === "HTTP 503", "a 5xx from the door keeps the key but clears okAt too — " + JSON.stringify(st.cloudKeyDoor));

  /* 16 — only the functions' own 404 is a dead key */
  clock.t = T0 + 8 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  c.gateway404 = true;
  st = { cloudAuth: authLeft(45 * MIN), configKey: "k1", configKeyUser: "u1", cloudConfig: copy(NEW) };
  m = build(st, c);
  sent = await m.api.mirrorToCloud(entry());
  ok(sent === false && st.configKey === "k1" && !st.configKeyDead && /^HTTP 404/.test(st.lastMirror.error) && !/no longer valid/.test(st.lastMirror.error) && c.calls.keyRead === 0,
     "the gateway's 404 (missing function) on the mirror: the key is kept, no lookup, a plain 'HTTP 404' — " + st.lastMirror.error);
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && !r.keyDead && st.configKey === "k1" && st.cloudKeyDoor.error === "HTTP 404", "…on the settings door: key kept, error 'HTTP 404'");
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && st.configKey === "k1" && st.memStats.lastErr === "HTTP 404" && st.memStats.keyDownAt === clock.t, "…on the memory door: key kept, 'HTTP 404', and the door backs off");
  ok((await m.api.deadKeyAnswer(json(404, { error: "not found" }))) === true && (await m.api.deadKeyAnswer(GATEWAY_404())) === false && (await m.api.deadKeyAnswer(json(200, { ok: true }))) === false, "deadKeyAnswer: the function's body only");

  /* 17 — a door answer that lands after a working login took over is dropped */
  clock.t = T0 + 9 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" } });
  c.cfgGate = gate();
  st = DOOR_STORE(OLD, { cloudUpdatedAt: "s1" });
  m = build(st, c);
  const pending = m.api.cloudPullRaw(false); // the door's GET is out
  await settle();
  ok(st.cloudKeyDoor && st.cloudKeyDoor.triedAt === clock.t, "the door wrote its ticket and waits for the cloud");
  const NEWER = Object.assign({}, NEW, { instructions: "newer than the door's copy" });
  delete st.cloudKeyDoor; delete st.cloudStale; st.cloudConfig = copy(NEWER); st.cloudUpdatedAt = "s3"; // the login path took over meanwhile (a click refreshed it)
  c.cfgGate.open();
  r = await pending;
  ok(r.ok === false && r.superseded === true && st.cloudConfig.instructions === "newer than the door's copy" && !st.cloudKeyDoor && !st.cloudStale,
     "the late answer is dropped: the login's copy stands, no breadcrumb is written back — " + r.error);

  /* 18 — the memory door backs off after a timeout / 5xx */
  clock.t = T0 + 10 * HOUR;
  c = cloud({ row: { config: NEW, updated_at: "s2", config_key: "k1" }, msgRows: ROWS() });
  c.readDown = true;
  st = DOOR_STORE(NEW);
  m = build(st, c);
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && st.memStats.lastErr === "HTTP 503" && st.memStats.keyDownAt === clock.t && st.memStats.keyAt === 0, "a 503 through the key: no memory, the moment is kept — " + JSON.stringify(st.memStats));
  c.readDown = false;
  before = c.calls.logRead;
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows === null && c.calls.logRead === before && /not answering/.test(st.memStats.lastErr), "the next buyer message does not ask the sick function again — " + st.memStats.lastErr);
  clock.t += 2 * MIN + 1000;
  rows = await m.api.memThreadRows("t1", true);
  await settle();
  ok(rows && rows.length === 2 && c.calls.logRead === before + 1 && st.memStats.keyDownAt === 0 && st.memStats.keyAt === clock.t, "two minutes later it asks again and the marks come back");

  finished = true;
  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
