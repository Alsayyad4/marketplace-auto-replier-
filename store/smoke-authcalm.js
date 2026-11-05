/* Tests the calm token refresh (background.js cloudValidAuth, v0.21.78).
 *
 * Why this file exists: Oct 7 2026 the popup said "cloud sync frozen — log in again"
 * and the login itself said "Request rate limit reached". Supabase Auth gives one
 * internet address 150 /token requests per 5 minutes, and a password login draws from
 * the same budget as a token refresh. cloudValidAuth retried a failed refresh on EVERY
 * call — the minute pull, every worker wake, every chat-memory read — on every Chrome
 * of the shop, so logins that had ended (the dashboard's Log out signed out every
 * device) kept the budget empty for everyone, the owner's typed login included.
 *
 * Under test:
 *   1. a token with more than 10 min left is used as is — no request;
 *   2. inside the last 10 min (a third of the token's life if shorter) it is refreshed
 *      ONCE in the background, however many callers ask at once — they keep the
 *      still-valid token and never wait, even for a slow refresh; an EXPIRED token's
 *      callers wait for that one refresh;
 *   3. a refused refresh holds the computer back: no /token request until the wait
 *      ends, across a worker restart too (the wait is kept in storage);
 *   4. while the wait runs, a token that is still valid keeps being handed out;
 *   5. the waits: rate limit 2 -> 15 min, no connection 30 s, other refusals 1 min,
 *      an ended login 30 min (both answer shapes); a bad API key, a 409 "too many
 *      concurrent refreshes" or a 4xx that merely says "session" is NOT an ended login;
 *   6. a success clears the wait; a login clears it; Log out clears it;
 *   7. a login refused by the rate limit says so (`limited`), a wrong password does not;
 *   8. a pull that cannot authenticate says why, instead of "not logged in";
 *   9. THE STORM: 16 Chromes behind one address (8 whose login ended, 8 healthy but
 *      expired), a token bucket like Supabase's that starts EMPTY — the healthy ones
 *      recover by themselves, the ended ones go quiet, and the owner's typed login
 *      five minutes later gets through;
 *  10. a refresh with no answer releases its callers at the timeout (and when it does
 *      answer later, it is stored and clears that wait); a slow refresh never logs a
 *      computer back in after Log out, and never hands a new login the old session's wait;
 *  11. a click (Save, Pull now, Restore) may try through a wait, once per 15 s, and
 *      says why it failed; heal / seed pushes never do.
 *
 * Run:  node store/smoke-authcalm.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const from = src.indexOf("const CFG_BACKUP_KEY");
const to = src.indexOf("/* ---------------- counters / rate limits ---------------- */");
if (from < 0 || to < 0) { console.error("cloud block not found in background.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
// A promise that never settles empties the event loop and node exits 0 mid-test:
// that must read as a failure (it is what a refresh with no timeout looks like).
let finished = false;
process.on("exit", () => { if (!finished) { console.log("  FAIL  the test never reached its end (a promise never settled)"); process.exitCode = 1; } });

const MIN = 60 * 1000;
const T0 = Date.parse("2026-10-07T12:00:00Z");
const clock = { t: T0 };
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(clock.t); }
  static now() { return clock.t; }
}
const FakeMath = Object.create(Math);
FakeMath.random = () => 0; // waits at their floor: the tests read exact numbers

const json = (status, body) => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, text: async () => JSON.stringify(body), clone() { return this; },
});
const LIMITED = () => json(429, { code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" });
const ENDED = () => json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
const ENDED_OLD = () => json(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" });
const BAD_KEY = () => json(401, { message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." });
const DOWN = () => json(503, { message: "upstream unavailable" });
const FRESH = (n) => json(200, { access_token: "at-" + n, refresh_token: "rt-" + n, expires_in: 3600, user: { id: "u1", email: "op@example.com" } });

// One Chrome profile: its own storage and its own copy of the module (a worker restart
// = build() again on the same store). `answer(kind, body)` plays the auth server;
// `fastTimers` squeezes every timer of the module to a few ms.
function build(store, answer, fastTimers) {
  const calls = { token: 0, password: 0, other: 0 };
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.assign({}, store)),
      set: (v, cb) => { Object.assign(store, v); if (cb) cb(); },
      remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); if (cb) cb(); },
    } },
    runtime: { lastError: null },
  };
  const fetch = async (url, init) => {
    if (url.indexOf("/auth/v1/token?grant_type=refresh_token") >= 0) { calls.token++; return answer("refresh", JSON.parse(init.body)); }
    if (url.indexOf("/auth/v1/token?grant_type=password") >= 0) { calls.password++; return answer("password", JSON.parse(init.body)); }
    calls.other++;
    return json(200, []);
  };
  const st = fastTimers ? (fn, ms) => setTimeout(fn, Math.min(ms, 15)) : setTimeout;
  const api = new Function(
    "chrome", "LOG", "fetch", "syncedConfigRead", "syncedConfigWrite", "readManagedConfig", "DEFAULTS", "SEED_CONFIG", "Date", "Math", "setTimeout",
    block + "; return { cloudValidAuth, cloudLogin, cloudLogout, cloudPullRaw, cloudPush, cloudStatus, authRefusalKind, authHoldNext, authHoldLine, AUTH_HOLD_KEY };"
  )(chrome, () => {}, fetch, (cb) => cb({}, false), async () => true, async () => null,
    { apiKey: "", model: "claude-haiku-4-5", enabled: false }, {}, FakeDate, FakeMath, st);
  return { api, calls, store };
}
// A request held open until the test lets it answer.
function gate() { let open; const p = new Promise((r) => { open = r; }); return { p, open }; }
// Lets a refresh that runs in the background finish.
const settle = () => new Promise((r) => setTimeout(r, 5));
const authLeft = (ms) => ({ access_token: "at-0", refresh_token: "rt-0", expires_at: clock.t + ms, user_id: "u1", email: "op@example.com" });

(async () => {
  /* 1 — plenty of time left: no request at all */
  clock.t = T0;
  let st = { cloudAuth: authLeft(45 * MIN) };
  let m = build(st, () => FRESH(1));
  let a = await m.api.cloudValidAuth();
  ok(a && a.access_token === "at-0" && m.calls.token === 0, "a token with 45 min left is used as is — requests=" + m.calls.token);

  /* 2 — inside the last 10 min: refreshed ONCE in the background, however many callers
   *     ask at once; they keep the still-valid token meanwhile and never wait for it */
  st = { cloudAuth: authLeft(5 * MIN) };
  let n = 0;
  m = build(st, () => FRESH(++n));
  let many = await Promise.all(Array.from({ length: 10 }, () => m.api.cloudValidAuth()));
  ok(m.calls.token === 1, "ten callers at once share ONE refresh — requests=" + m.calls.token);
  ok(many.every((x) => x && x.access_token === "at-0"), "each gets the still-valid token at once");
  await settle();
  ok(st.cloudAuth.access_token === "at-1" && (await m.api.cloudValidAuth()).access_token === "at-1" && m.calls.token === 1,
     "the refresh lands in the background, and the next caller gets the new token");
  ok(!st.cloudAuthHold, "no wait is recorded after a success");
  // an EXPIRED token: callers have nothing to use, so they wait for the one refresh
  st = { cloudAuth: authLeft(-1 * MIN) };
  n = 0;
  m = build(st, () => FRESH(++n));
  many = await Promise.all(Array.from({ length: 10 }, () => m.api.cloudValidAuth()));
  ok(m.calls.token === 1 && many.every((x) => x && x.access_token === "at-1"), "an expired token: ten callers wait for ONE refresh and all get it");
  // a SLOW refresh never holds a caller that has a valid token (memFetch has 5 s, the video check 3 s)
  st = { cloudAuth: authLeft(8 * MIN) };
  m = build(st, () => new Promise((res) => setTimeout(() => res(FRESH(5)), 400)));
  const t0 = Date.now();
  a = await m.api.cloudValidAuth();
  ok(a && a.access_token === "at-0" && Date.now() - t0 < 100, "a slow refresh: the caller with 8 min left is answered at once (" + (Date.now() - t0) + " ms)");
  await new Promise((res) => setTimeout(res, 450));
  ok(st.cloudAuth.access_token === "at-5", "and the slow refresh still lands");
  // the window is a third of the token's life when that is shorter than 10 min
  st = { cloudAuth: Object.assign(authLeft(3 * MIN), { ttl_ms: 6 * MIN }) };
  m = build(st, () => FRESH(6));
  await m.api.cloudValidAuth();
  ok(m.calls.token === 0, "a 6-min token with 3 min left is not refreshed yet (window = 2 min) — requests=" + m.calls.token);

  /* 3 + 5a — expired token, the address is rate-limited: one try, then quiet */
  clock.t = T0;
  st = { cloudAuth: authLeft(-5 * MIN) };
  m = build(st, () => LIMITED());
  a = await m.api.cloudValidAuth();
  ok(a === null && m.calls.token === 1, "an expired token refused by the rate limit -> null, one request");
  let h = st.cloudAuthHold;
  ok(h && h.kind === "limited" && h.n === 1 && h.until - clock.t === 2 * MIN && h.status === 429,
     "the wait is recorded: limited #1, 2 min — got " + JSON.stringify(h && { kind: h.kind, n: h.n, wait: (h.until - clock.t) / MIN, status: h.status }));
  for (let i = 0; i < 50; i++) { clock.t += 2000; await m.api.cloudValidAuth(); } // 50 pulls / wakes / memory reads in 100 s
  ok(m.calls.token === 1, "50 more calls during the wait send NOTHING to /token — requests=" + m.calls.token);
  const restarted = build(st, () => LIMITED()); // the service worker died and woke up
  await restarted.api.cloudValidAuth();
  ok(restarted.calls.token === 0, "a worker restart keeps the wait (it lives in storage) — requests=" + restarted.calls.token);

  /* 5b — the waits double up to 15 min and stay there */
  const waits = [];
  for (let i = 0; i < 6; i++) {
    clock.t = st.cloudAuthHold.until + 1;
    await m.api.cloudValidAuth();
    waits.push(Math.round((st.cloudAuthHold.until - clock.t) / MIN));
  }
  ok(JSON.stringify(waits) === JSON.stringify([4, 8, 15, 15, 15, 15]), "rate-limit waits double and cap at 15 min — " + waits.join(","));
  ok(m.calls.token === 7, "one request per wait, no more — requests=" + m.calls.token);

  /* 6a — the next success clears the wait */
  clock.t = st.cloudAuthHold.until + 1;
  const healer = build(st, () => FRESH(7));
  a = await healer.api.cloudValidAuth();
  ok(a && a.access_token === "at-7" && !st.cloudAuthHold, "the first success clears the wait and hands out the new token");

  /* 4 — a refused refresh while the token is still good: callers keep the good token */
  clock.t = T0;
  st = { cloudAuth: authLeft(6 * MIN) };
  m = build(st, () => LIMITED());
  a = await m.api.cloudValidAuth();
  await settle();
  ok(a && a.access_token === "at-0" && st.cloudAuthHold && st.cloudAuthHold.kind === "limited",
     "refused 6 min before expiry: the still-valid token keeps working, the wait is recorded");
  for (let i = 0; i < 20; i++) { clock.t += 3000; await m.api.cloudValidAuth(); }
  ok(m.calls.token === 1, "and nothing more is sent during that wait — requests=" + m.calls.token);
  clock.t += 5 * MIN + 45 * 1000; // 15 s left: no longer handed out
  ok((await m.api.cloudValidAuth()) === null, "a token with 15 s left is not handed out");

  /* 5c — the other kinds */
  const kindOf = (resp) => m.api.authRefusalKind(resp.status, null);
  ok(m.api.authRefusalKind(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" }) === "ended", "400 refresh_token_not_found = an ended login");
  ok(m.api.authRefusalKind(400, { error: "invalid_grant", error_description: "Invalid Refresh Token: Already Used" }) === "ended", "the older invalid_grant shape = an ended login");
  ok(m.api.authRefusalKind(403, { code: 403, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" }) === "ended", "403 session_not_found = an ended login");
  ok(m.api.authRefusalKind(401, { message: "Invalid API key" }) === "error", "401 Invalid API key is NOT an ended login (the creds fallback owns it)");
  ok(m.api.authRefusalKind(409, { code: 409, error_code: "conflict", msg: "Too many concurrent token refresh requests on the same session or refresh token" }) === "error",
     "409 'too many concurrent refresh requests on the same session' is a moment, NOT an ended login");
  ok(m.api.authRefusalKind(400, { code: 400, error_code: "bad_json", msg: "Could not parse request body as JSON: session" }) === "error",
     "a 4xx that merely mentions 'session' is not an ended login");
  ok(m.api.authRefusalKind(503, { message: "upstream unavailable" }) === "error" && kindOf(DOWN()) === "error", "a 5xx is a short wait, not an ended login");
  ok(m.api.authRefusalKind(0, null) === "offline", "no answer at all = offline");
  ok(m.api.authRefusalKind(429, {}) === "limited" && m.api.authRefusalKind(400, { error_code: "over_request_rate_limit" }) === "limited", "429, or the over_request_rate_limit code, = limited");

  for (const [label, resp, kind, wait] of [
    ["an ended login", ENDED, "ended", 30], ["an ended login (old shape)", ENDED_OLD, "ended", 30],
    ["a bad API key", BAD_KEY, "error", 1], ["a 503", DOWN, "error", 1],
  ]) {
    clock.t = T0;
    st = { cloudAuth: authLeft(-1 * MIN) };
    m = build(st, () => resp());
    await m.api.cloudValidAuth();
    h = st.cloudAuthHold;
    ok(h && h.kind === kind && Math.round((h.until - clock.t) / MIN) === wait, label + " -> " + kind + ", first wait " + wait + " min");
  }
  clock.t = T0;
  st = { cloudAuth: authLeft(-1 * MIN) };
  m = build(st, () => { throw new TypeError("Failed to fetch"); });
  await m.api.cloudValidAuth();
  ok(st.cloudAuthHold && st.cloudAuthHold.kind === "offline" && st.cloudAuthHold.until - clock.t === 30 * 1000, "no connection -> offline, first wait 30 s");
  ok(m.api.authHoldNext({ kind: "ended", n: 3 }, "ended", 0, 0).until === 2 * 60 * MIN, "an ended login's wait caps at 2 h — it is never permanent");
  ok(m.api.authHoldNext({ kind: "limited", n: 4 }, "ended", 0, 0).n === 1, "a new kind of refusal starts its own count");

  /* 7 + 6b — the login: says when it is the rate limit, and a success clears the wait */
  clock.t = T0;
  st = { cloudAuth: authLeft(-1 * MIN), cloudAuthHold: { kind: "ended", n: 1, at: T0, until: T0 + 30 * MIN } };
  m = build(st, () => LIMITED());
  let r = await m.api.cloudLogin("op@example.com", "pw");
  ok(r && r.ok === false && r.limited === true && /rate limit/i.test(r.error), "a login refused by the rate limit says limited=true — " + JSON.stringify(r));
  m = build(st, () => json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }));
  r = await m.api.cloudLogin("op@example.com", "wrong");
  ok(r && r.ok === false && !r.limited, "a wrong password is not called a rate limit");
  m = build(st, (kind) => (kind === "password" ? FRESH(9) : LIMITED()));
  r = await m.api.cloudLogin("op@example.com", "pw");
  ok(r && r.ok === true && !st.cloudAuthHold && st.cloudAuth.refresh_token === "rt-9", "a successful login clears the old session's wait");

  /* 6c — Log out clears it too */
  st.cloudAuthHold = { kind: "limited", n: 1, at: T0, until: T0 + 2 * MIN };
  await m.api.cloudLogout();
  ok(!st.cloudAuthHold && !st.cloudAuth, "Log out removes the wait with the session");

  /* 8 — a pull that cannot authenticate says why */
  clock.t = T0;
  st = { cloudAuth: authLeft(-1 * MIN), cloudConfig: { apiKey: "sk-ant-x", businessInfo: "x" } };
  m = build(st, () => LIMITED());
  r = await m.api.cloudPullRaw(false);
  ok(r.ok === false && /limiting logins/.test(r.error) && /by itself/.test(r.error), "the pull's error names the rate-limit wait — " + r.error);
  const s = await m.api.cloudStatus();
  ok(s.hold && s.hold.kind === "limited" && /limiting logins/.test(s.holdLine), "the Settings status carries the wait and its sentence");
  st = { cloudAuth: authLeft(-1 * MIN) };
  m = build(st, () => ENDED());
  r = await m.api.cloudPullRaw(false);
  ok(/login ended/.test(r.error) && /log in again/.test(r.error), "an ended login is the one case that asks for a login — " + r.error);
  r = await build({}, () => FRESH(1)).api.cloudPullRaw(false);
  ok(r.error === "not logged in", "a computer with no login at all still says 'not logged in'");

  /* 10 — the request that never answers, and the two races around a slow one */
  clock.t = T0;
  st = { cloudAuth: authLeft(-1 * MIN) };
  m = build(st, () => new Promise(() => {}), true); // the auth server never answers
  const hung = await Promise.all([m.api.cloudValidAuth(), m.api.cloudValidAuth(), m.api.cloudValidAuth()]);
  ok(hung.every((x) => x === null) && m.calls.token === 1 && st.cloudAuthHold && st.cloudAuthHold.kind === "offline",
     "a refresh with no answer releases every caller at the timeout, as an 'offline' wait — " + JSON.stringify(st.cloudAuthHold && st.cloudAuthHold.msg));
  await m.api.cloudValidAuth();
  ok(m.calls.token === 1, "and nothing more is sent while that wait runs");

  st = { cloudAuth: authLeft(-1 * MIN) };
  let g = gate();
  m = build(st, async () => { await g.p; return FRESH(11); });
  let pending = m.api.cloudValidAuth();
  await new Promise((res) => setTimeout(res, 5));
  await m.api.cloudLogout();
  g.open();
  await pending;
  ok(!st.cloudAuth, "a refresh that answers after Log out does not log the computer back in");

  st = { cloudAuth: authLeft(-1 * MIN) };
  g = gate();
  m = build(st, async (kind) => { if (kind === "password") return FRESH(12); await g.p; return ENDED(); });
  pending = m.api.cloudValidAuth();
  await new Promise((res) => setTimeout(res, 5));
  r = await m.api.cloudLogin("op@example.com", "pw");
  g.open();
  await pending;
  ok(r.ok && st.cloudAuth.refresh_token === "rt-12" && !st.cloudAuthHold,
     "the old session's refusal arriving after a new login leaves the new login without a wait");

  // the timeout gave up on a refresh that then answers: the new session is stored and
  // the "offline" wait goes with it (no stale auth=offline in the diagnostic)
  st = { cloudAuth: authLeft(-1 * MIN) };
  g = gate();
  m = build(st, async () => { await g.p; return FRESH(13); }, true);
  a = await m.api.cloudValidAuth();
  ok(a === null && st.cloudAuthHold && st.cloudAuthHold.kind === "offline", "the timeout records an offline wait");
  g.open();
  await settle();
  ok(st.cloudAuth.refresh_token === "rt-13" && !st.cloudAuthHold, "the late answer is stored and clears that wait");

  /* 11 — a click (Save, Pull now, Restore) may try through a wait — once per 15 s */
  clock.t = T0;
  st = { cloudAuth: authLeft(-1 * MIN), cloudAuthHold: { kind: "limited", n: 3, at: T0, until: T0 + 15 * MIN, status: 429 } };
  m = build(st, () => FRESH(14));
  ok((await m.api.cloudValidAuth()) === null && m.calls.token === 0, "an automatic call honours the wait");
  a = await m.api.cloudValidAuth({ user: true });
  ok(a && a.access_token === "at-14" && m.calls.token === 1 && !st.cloudAuthHold, "a click tries through it once, and a success clears it");
  st = { cloudAuth: authLeft(-1 * MIN), cloudAuthHold: { kind: "limited", n: 3, at: T0, until: T0 + 15 * MIN, status: 429 } };
  m = build(st, () => LIMITED());
  r = await m.api.cloudPullRaw(true); // Pull now
  ok(m.calls.token === 1 && /limiting logins/.test(r.error), "Pull now tries once through the wait, and says why it failed");
  clock.t += 5000;
  r = await m.api.cloudPush({ apiKey: "sk-ant-x", businessInfo: "x" }, { user: true }); // Save, 5 s later
  ok(m.calls.token === 1 && r.ok === false && /limiting logins/.test(r.error), "a second click within 15 s sends nothing; Save names the wait instead of 'not logged in'");
  clock.t += 16000;
  await m.api.cloudPush({ apiKey: "sk-ant-x", businessInfo: "x" }, { user: true });
  ok(m.calls.token === 2, "after 15 s a click may try again — requests=" + m.calls.token);
  clock.t += 16000; // past the click throttle, so only the wait itself can hold it back
  await m.api.cloudPush({ apiKey: "sk-ant-x", businessInfo: "x" }); // heal / seed: automatic
  ok(m.calls.token === 2, "an automatic push (heal, seed) never tries through a wait");

  /* 9 — THE STORM. One token bucket for the whole address, like Supabase's limiter:
   *     150 per 5 min (0.5/s), starting EMPTY. 8 Chromes whose login ended (the
   *     dashboard's global Log out), 8 healthy ones whose token expired while the
   *     address was refused. Each asks for auth every 10 s (memory reads) + every
   *     minute (the pull) — what .77 turned into one /token request each time. */
  clock.t = T0;
  const bucket = { tokens: 0, at: T0 };
  const take = () => {
    bucket.tokens = Math.min(150, bucket.tokens + ((clock.t - bucket.at) / 1000) * 0.5);
    bucket.at = clock.t;
    if (bucket.tokens >= 1) { bucket.tokens -= 1; return true; }
    return false;
  };
  const fleet = [];
  for (let i = 0; i < 16; i++) {
    const dead = i < 8;
    const store = { cloudAuth: Object.assign(authLeft(-2 * MIN), { refresh_token: "rt-start-" + i }) };
    let issued = 0;
    const mach = build(store, (kind) => {
      if (!take()) return LIMITED();
      if (dead) return ENDED();
      issued++;
      return FRESH(i + "-" + issued);
    });
    fleet.push({ dead, store, mach });
  }
  let ownerLogin = null;
  for (let t = 0; t <= 30 * 60; t += 10) {
    clock.t = T0 + t * 1000;
    for (const f of fleet) {
      await f.mach.api.cloudValidAuth();
      if (t % 60 === 0) await f.mach.api.cloudValidAuth();
    }
    if (t === 5 * 60) ownerLogin = take(); // the owner presses Log in five minutes in
  }
  const healthy = fleet.filter((f) => !f.dead);
  const ended = fleet.filter((f) => f.dead);
  const reqHealthy = healthy.reduce((s2, f) => s2 + f.mach.calls.token, 0);
  const reqEnded = ended.reduce((s2, f) => s2 + f.mach.calls.token, 0);
  ok(healthy.every((f) => f.store.cloudAuth.expires_at - clock.t > 20 * MIN && !f.store.cloudAuthHold),
     "every healthy Chrome got a fresh token by itself and has no wait left");
  ok(ended.every((f) => f.store.cloudAuthHold && f.store.cloudAuthHold.kind === "ended"),
     "every ended login is recognised as ended (and is the only one that asks for a login)");
  ok(reqHealthy <= 16 * 1 + 8 * 2 && reqEnded <= 8 * 4,
     "30 minutes, 16 Chromes, ~3,400 auth calls -> " + (reqHealthy + reqEnded) + " /token requests (healthy " + reqHealthy + ", ended " + reqEnded + ")");
  ok(ownerLogin === true, "the owner's typed login five minutes in finds room in the budget");

  finished = true;
  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
