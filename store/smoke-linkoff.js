/* The demo-link that would not die (v0.21.69).
 *
 * The link sender was deleted in v0.21.60, yet buyers kept receiving
 * "Voici la vidéo démo 🎥 (demo video) https://…supabase.co/storage/…mp4".
 * Source: machines stuck on v0.21.47-.51 (their self-updater never fires), whose
 * sender is gated on `videoLinkFallback !== false` read from the SHARED account
 * row — a row every build until now re-armed with `true` on each save. Nothing on
 * those machines can be changed from here. The row can.
 *
 * Under test (the real cloud block sliced out of background.js, plus the sources):
 *   1. every DEFAULTS (extension, Settings page, dashboard) now ships `false`;
 *   2. legacyLinkArmed() — a row is armed unless it carries the exact off values;
 *   3. a pull whose applied copy reads armed PATCHes the row: compare-and-set on
 *      updated_at, four keys changed, every other key (even `enabled`) intact;
 *   4. once the row is off, no further request is made (steady state costs 0);
 *   5. losing the race writes nothing and does not lie about it locally;
 *   6. a failed write is retried, but not more than once per 10 min per machine;
 *   7. a logged-out machine does nothing;
 *   8. every push (Save, heal, seed) clamps the four keys off;
 *   9. a REFUSED (wiped) pull never patches — the heal's push carries the clamp.
 *
 * Run:  node store/smoke-linkoff.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const src = fs.readFileSync(path.join(root, "background.js"), "utf8");
const optSrc = fs.readFileSync(path.join(root, "options.js"), "utf8");
const appSrc = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");

const from = src.indexOf("const CFG_BACKUP_KEY");
const to = src.indexOf("/* ---------------- counters / rate limits ---------------- */");
if (from < 0 || to < 0) { console.error("cloud-sync block not found in background.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

const OFF = { videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "" };
const REAL = {
  apiKey: "sk-ant-real", model: "claude-haiku-4-5",
  businessName: "SubSell", businessAddress: "757 Rue Beaubien E, Montréal",
  businessInfo: "Used iPhone sales in Montreal…",
  instructions: "Be friendly and concise…",
  closerGoals: "Get the buyer to visit the shop…",
  priceList: "S25 Ultra from 700$",
  listings: [{ title: "iPhone 13" }, { title: "iPhone 14" }],
  demoVideoUrls: [{ url: "https://x/v.mp4" }],
  coaching: [{ note: "always applies", text: "be warm" }],
  responseDelaySec: 12,
};
// What the row looks like today: a real config, re-armed by every save so far.
const ARMED = Object.assign({}, REAL, { videoLinkFallback: true, videoLinkUrl: "https://old/link.mp4", enabled: true });
const WIPED = { apiKey: "", model: "", businessInfo: "", instructions: "", closerGoals: "", listings: [], demoVideoUrls: [], coaching: [] };
const STAMP = "2026-09-22T14:03:11.123456+00:00"; // the shape PostgREST returns — ':' and '+' must survive the query string

function build(opts) {
  opts = opts || {};
  const row = { config: JSON.parse(JSON.stringify(opts.row || ARMED)), updated_at: opts.stamp || STAMP };
  const store = Object.assign(
    opts.loggedOut ? {} : { cloudAuth: { access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600000, user_id: "u1", email: "op@example.com" } },
    opts.store || {}
  );
  const calls = { push: 0, full: 0, live: 0, probe: 0, patch: 0, patches: [] };
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.assign({}, store)),
      set: (v, cb) => { Object.assign(store, v); if (cb) cb(); },
      remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); if (cb) cb(); },
    } },
    runtime: { lastError: null },
  };
  const json = (body, status) => ({ ok: !status || status < 400, status: status || 200, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });
  const bump = () => { const t = Date.parse(row.updated_at); row.updated_at = isNaN(t) ? row.updated_at + "+1" : new Date(t + 1000).toISOString(); };
  const fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    if (method === "POST") {
      calls.push++;
      const sent = JSON.parse(init.body)[0];
      row.config = sent.config; bump();
      return json([{ updated_at: row.updated_at }]);
    }
    if (method === "PATCH") {
      calls.patch++;
      calls.patches.push({ url, body: JSON.parse(init.body), headers: init.headers });
      if (opts.failPatches && calls.patch <= opts.failPatches) return json({ message: "unavailable" }, 503);
      const m = /updated_at=eq\.([^&]+)/.exec(url);
      const want = m ? decodeURIComponent(m[1]) : null;
      // PostgREST: a filter that matches nothing is 200 + [] — the precondition failed.
      const badScope = url.indexOf("user_id=") >= 0 && url.indexOf("user_id=eq.u1") < 0; // RLS would scope it anyway; a wrong id must match nothing
      if (opts.raceOnPatch || want !== row.updated_at || badScope) return json([]);
      row.config = JSON.parse(init.body).config; bump();
      return json([{ updated_at: row.updated_at }]);
    }
    // A real fetch hands back freshly parsed JSON: the reader's own `delete cfg.enabled`
    // must not reach the fake server row, so every read is a deep copy.
    const copy = () => JSON.parse(JSON.stringify(row.config));
    if (url.indexOf("select=updated_at") >= 0) { calls.probe++; return json([{ updated_at: row.updated_at }]); }
    if (url.indexOf("select=config,updated_at") >= 0) { calls.full++; return json([{ config: copy(), updated_at: row.updated_at }]); }
    if (url.indexOf("select=config") >= 0) { calls.live++; return json([{ config: copy() }]); }
    return json([]);
  };
  const syncedConfigRead = (cb) => cb(store.__sync || {}, !!store.__sync);
  const syncedConfigWrite = async (c) => { store.__sync = c; return true; };
  const readManagedConfig = async () => null;
  const DEFAULTS = { apiKey: "", model: "claude-haiku-4-5", businessInfo: "", instructions: "", enabled: false };
  const SEED_CONFIG = {};
  const api = new Function(
    "chrome", "LOG", "fetch", "syncedConfigRead", "syncedConfigWrite", "readManagedConfig", "DEFAULTS", "SEED_CONFIG",
    block + "; return { cloudPull, cloudPush, legacyLinkArmed, disarmLegacyLinkInCloud, LEGACY_LINK_OFF };"
  )(chrome, () => {}, fetch, syncedConfigRead, syncedConfigWrite, readManagedConfig, DEFAULTS, SEED_CONFIG);
  return { api, store, row, calls };
}
const sameExcept = (a, b, skip) => {
  const keys = new Set(Object.keys(a).concat(Object.keys(b)));
  for (const k of keys) { if (skip[k] !== undefined) continue; if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) return false; }
  return true;
};
const isOff = (c) => Object.keys(OFF).every((k) => c[k] === OFF[k]);

(async () => {
  /* 1 — the shipped defaults, all three copies */
  ok(/videoLinkFallback:\s*false/.test(src.slice(0, src.indexOf("const LOG ="))), "background.js DEFAULTS ships videoLinkFallback: false");
  ok(/videoLinkFallback:\s*false/.test(optSrc), "options.js DEFAULTS ships videoLinkFallback: false");
  ok(/videoLinkFallback:\s*false/.test(appSrc), "docs/app.js DEFAULTS ships videoLinkFallback: false");
  ok(!/^\s*videoLinkFallback:\s*true,/m.test(src + "\n" + optSrc + "\n" + appSrc), "no copy of DEFAULTS still says true (as a key, not in a comment)");
  ok(/Object\.assign\(clean, LEGACY_LINK_OFF, LEGACY_GATE_OFF\)/.test(appSrc), "the dashboard's saveConfig clamps the four keys on every write");
  ok(/Object\.assign\(clean, LEGACY_LINK_OFF\)/.test(src), "the extension's cloudPush clamps the four keys on every write");
  const ext = fs.readdirSync(root).filter((f) => /\.(js|html)$/.test(f)).map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  ok(!/function sendVideoLink|sendVideoLink\s*=|VIDEO_LINK_TEXT_DEFAULT\s*=|\{link\}/.test(ext), "no link sender is defined anywhere in the shipped extension files");

  /* 2 — what counts as armed */
  let m = build();
  const A = m.api.legacyLinkArmed;
  ok(A({}) === true, "a row without the key is ARMED (old builds default to true)");
  ok(A({ videoLinkFallback: true }) === true, "videoLinkFallback:true is armed");
  ok(A({ videoLinkFallback: false }) === false, "videoLinkFallback:false alone is off");
  ok(A({ videoLinkFallback: false, videoLinkUrl: "https://x" }) === true, "a leftover link URL counts as armed");
  ok(A({ videoLinkFallback: false, videoLinkText: "  " }) === false, "a blank link text does not");
  ok(A({ videoLinkFallback: false, videoLinkOptIn: true }) === true, "videoLinkOptIn:true (the .56/.57 gate) counts as armed");
  ok(A(undefined) === false && A(null) === false && A("x") === false, "nothing held ⇒ nothing to disarm (no throw)");
  ok(m.api.LEGACY_LINK_OFF.videoLinkFallback === false, "the value written is exactly false — what the .47-.55 gate `!== false` tests");
  ok(A(Object.assign({}, REAL, m.api.LEGACY_LINK_OFF)) === false, "a row carrying LEGACY_LINK_OFF is off");

  /* 3 — the pull that fixes the row */
  m = build();
  let r = await m.api.cloudPull(true);
  ok(r.ok && r.keys > 0, "the armed row is a healthy row: applied normally — keys=" + r.keys);
  ok(m.calls.patch === 1, "exactly one PATCH went out — patch=" + m.calls.patch);
  const p = m.calls.patches[0] || { url: "", body: {} };
  ok(p.url.indexOf("user_id=eq.u1") >= 0, "the PATCH is scoped to this account's row");
  ok(p.url.indexOf("updated_at=eq." + encodeURIComponent(STAMP)) >= 0, "the PATCH carries the stamp it read as a precondition, URL-encoded (':' and '+' survive)");
  ok(p.headers && /return=representation/.test(p.headers.prefer || ""), "the PATCH asks for the row back, so a lost race is visible as []");
  ok(isOff(p.body.config), "the body carries all four keys off");
  ok(sameExcept(p.body.config, ARMED, OFF), "…and NOTHING else changed — every other key of the row, byte for byte");
  ok(p.body.config.enabled === true, "`enabled` in the row is left exactly as it was (not dropped, not flipped)");
  ok(Object.keys(p.body).length === 1, "the body touches only `config` (updated_at is the trigger's job)");
  ok(isOff(m.row.config) && m.row.config.apiKey === REAL.apiKey, "the fake row now reads off and still holds the API key");
  ok(m.store.lastPull && m.store.lastPull.linkDisarm === "patched", "the Settings page can show it happened — linkDisarm=" + (m.store.lastPull && m.store.lastPull.linkDisarm));
  // Nothing is adopted locally by the disarm itself: the fixed row comes in on
  // the next pull through cloudPullRaw's own wipe guard, like any other change.
  ok(m.store.cloudConfig && m.store.cloudConfig.videoLinkFallback === true, "the disarm stores nothing locally (the held copy is still the applied one)");
  ok(m.store.cloudUpdatedAt === STAMP, "…and the stamp it holds is still the one it read, so the next probe sees the change");
  ok(m.store.linkDisarmAt === undefined, "the rate limit is cleared on success (a later re-arm is fixed on the very next pull)");
  r = await m.api.cloudPull(false);
  ok(r.ok && r.keys > 0 && !r.unchanged, "next minute: the probe sees the new stamp and the fixed row is applied through the guarded path");
  ok(m.store.cloudConfig && isOff(m.store.cloudConfig), "this machine's own copy reads off now");
  ok(m.store.cloudConfig.enabled === undefined, "…without `enabled` (on/off stays per machine)");
  ok(m.store.cloudUpdatedAt === m.row.updated_at, "…and the new stamp is remembered");
  ok(m.calls.patch === 1, "no second PATCH — the row already read off");

  /* 4 — steady state: nothing more, ever */
  const before = { probe: m.calls.probe, full: m.calls.full, live: m.calls.live, patch: m.calls.patch };
  r = await m.api.cloudPull(false);
  ok(r.ok && r.unchanged === true, "the minute after: the probe says unchanged");
  ok(m.calls.patch === before.patch && m.calls.full === before.full && m.calls.live === before.live && m.calls.probe === before.probe + 1,
     "…and the only request was the probe (no PATCH, no re-read) — patch=" + m.calls.patch + " full=" + m.calls.full + " live=" + m.calls.live);
  ok(r.linkDisarm === undefined, "no disarm breadcrumb when there was nothing to disarm");
  // another machine on .69 with the same (fixed) copy
  const m2 = build({ row: m.row.config, stamp: m.row.updated_at });
  await m2.api.cloudPull(true);
  ok(m2.calls.patch === 0, "a second machine reading the fixed row writes nothing");
  // a stale machine's old Settings page re-arms the row later (its checkbox still exists there)
  m.row.config = Object.assign({}, m.row.config, { videoLinkFallback: true }); m.row.updated_at = "2026-09-29T10:00:00+00:00";
  r = await m.api.cloudPull(false);
  ok(m.calls.patch === 2 && r.linkDisarm === "patched" && isOff(m.row.config), "a re-armed row is disarmed on the very next pull, no 10-min wait — patch=" + m.calls.patch);

  /* 3b — a row this machine would refuse as a wipe is not ours to touch */
  m = build({ row: { apiKey: "", model: "", businessInfo: "", instructions: "", videoLinkFallback: true } });
  r = await m.api.disarmLegacyLinkInCloud(REAL);
  ok(r.ok === false && /emptied/.test(r.skipped || "") && m.calls.patch === 0, "an emptied row is left to the heal, never patched — " + r.skipped);
  // held = ARMED weighs 100 (8 texts + 3 lists); a row down to the four key texts weighs 40 — the .61 "under half" rule
  m = build({ row: { apiKey: REAL.apiKey, model: REAL.model, businessInfo: REAL.businessInfo, instructions: REAL.instructions, videoLinkFallback: true } });
  r = await m.api.disarmLegacyLinkInCloud(ARMED);
  ok(r.ok === false && /emptied/.test(r.skipped || "") && m.calls.patch === 0, "a row that collapsed to under half the held weight is left alone too — " + r.skipped);

  /* 3c — a session stored by an older build carries no user id yet */
  m = build({ store: { cloudAuth: { access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600000, email: "op@example.com" } } });
  r = await m.api.cloudPull(true);
  ok(m.calls.patch === 1 && r.linkDisarm === "patched" && isOff(m.row.config), "without a user id the PATCH still goes out on the stamp precondition alone (RLS scopes it)");
  ok(m.calls.patches[0].url.indexOf("user_id=") < 0 && m.calls.patches[0].url.indexOf("updated_at=eq.") >= 0, "…and never as user_id=eq.undefined");

  /* 5 — losing the race */
  m = build({ raceOnPatch: true });
  r = await m.api.cloudPull(true);
  ok(m.calls.patch === 1 && r.linkDisarm === "lost the race", "a write that lands on a moved row is reported as lost — " + r.linkDisarm);
  ok(m.row.config.videoLinkFallback === true, "…and the fake row was NOT touched (the precondition did its job)");
  ok(m.store.cloudUpdatedAt === STAMP, "…and this machine does not pretend it won (stamp still the one it read)");
  // the other machine fixed it in the meantime
  m.row.config = Object.assign({}, m.row.config, OFF); m.row.updated_at = "2026-09-22T14:04:00+00:00";
  m.store.linkDisarmAt = 0;
  r = await m.api.cloudPull(false);
  ok(r.ok && r.keys > 0 && m.calls.patch === 1, "next pull sees the new stamp, re-reads, finds it off, writes nothing more — patch=" + m.calls.patch);
  ok(m.store.cloudConfig && isOff(m.store.cloudConfig), "and this machine's copy is now off");

  /* 6 — a dropped write is retried, but not every minute */
  m = build({ failPatches: 1 });
  r = await m.api.cloudPull(true);
  ok(m.calls.patch === 1 && /unavailable|HTTP 503/.test(r.linkDisarm || ""), "a 503 on the PATCH is reported (the server's message), not hidden — " + r.linkDisarm);
  ok(m.row.config.videoLinkFallback === true, "…and the row is still armed (nothing pretended)");
  r = await m.api.cloudPull(false);
  ok(m.calls.patch === 1 && r.linkDisarm === "tried recently", "one minute later: no second PATCH (10-min rate limit) — " + r.linkDisarm);
  m.store.linkDisarmAt = Date.now() - 11 * 60 * 1000;
  r = await m.api.cloudPull(false);
  ok(m.calls.patch === 2 && r.linkDisarm === "patched" && isOff(m.row.config), "11 minutes later: retried and the row is off");
  ok(m.store.linkDisarmAt === undefined, "…and the rate limit is cleared again");

  /* 7 — logged out: nothing */
  m = build({ loggedOut: true, store: { cloudConfig: Object.assign({}, ARMED) } });
  r = await m.api.cloudPull(true);
  ok(r.ok === false && m.calls.patch === 0, "a logged-out machine cannot and does not write");
  r = await m.api.disarmLegacyLinkInCloud(ARMED);
  ok(r.ok === false && r.skipped === "not logged in" && m.calls.patch === 0, "…and the disarm itself refuses without a session — " + r.skipped);

  /* 8 — every push clamps */
  m = build({ row: REAL, stamp: STAMP });
  await m.api.cloudPush(Object.assign({}, REAL, { videoLinkFallback: true, videoLinkOptIn: true, videoLinkUrl: "u", videoLinkText: "t" }));
  ok(m.calls.push === 1 && isOff(m.row.config), "a Save that still carried the old values lands with all four off");
  ok(sameExcept(m.row.config, REAL, OFF), "…and the rest of the saved config is untouched");

  /* 9 — a refused (wiped) pull never patches; the heal's push carries the clamp */
  m = build({ row: Object.assign({}, WIPED, { videoLinkFallback: true }), store: { __sync: REAL } });
  r = await m.api.cloudPull(true);
  ok(r.ok && r.wiped === true && m.calls.patch === 0, "an emptied row is refused, not patched — wiped=" + r.wiped + " patch=" + m.calls.patch);
  ok(r.healed && m.row.config.apiKey === REAL.apiKey && isOff(m.row.config), "the heal put the settings back — with the link off");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
