/* Tests the INCOMING wipe guard and the self-heal (background.js, v0.21.61).
 *
 * Why this file exists: the operator logged in, the page said "pulled your cloud
 * settings", and every box was empty. The account row held empty strings — one
 * machine had saved a blank form over it — and every other machine then PULLED
 * that blank and overwrote its own good copy with it, within about a minute.
 * That is what made the wipe unsurvivable: by the time anyone noticed, the last
 * copies had been destroyed by the sync itself.
 *
 * Under test:
 *   1. a pull that brings back a wipe is REFUSED, and the machine keeps its config;
 *   2. the machine that still holds the settings puts them back in the account;
 *   3. it heals once per wipe, and not at all if somebody fixed it first;
 *   4. a healthy row is still applied, and clears the alarm;
 *   5. a deliberate shrink (fewer listings, key and teaching intact) is NOT refused;
 *   6. a login that brought nothing back does not report that it did;
 *   7. (v0.21.62) a fresh install logging into an EMPTY account fills it from the
 *      build's starter setup — once, after re-reading the row, never over real
 *      settings, never with a secret — and a re-blanked row converges in one heal.
 *
 * Run:  node store/smoke-cloudsync.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const from = src.indexOf("const CFG_BACKUP_KEY");
const to = src.indexOf("/* ---------------- counters / rate limits ---------------- */");
if (from < 0 || to < 0) { console.error("cloud-sync block not found in background.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

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
};
const WIPED = { apiKey: "", model: "", businessInfo: "", instructions: "", closerGoals: "", listings: [], demoVideoUrls: [], coaching: [] };

// One fake account row + one fake machine.
function build(opts) {
  opts = opts || {};
  const row = { config: JSON.parse(JSON.stringify(opts.row || WIPED)), updated_at: opts.stamp || "2026-09-21T09:36:48Z" };
  const store = Object.assign({
    cloudAuth: { access_token: "at", refresh_token: "rt", expires_at: Date.now() + 3600000, user_id: "u1", email: "op@example.com" },
  }, opts.store || {});
  const calls = { push: 0, full: 0, live: 0 };

  const chrome = {
    storage: {
      local: {
        get: (keys, cb) => cb(Object.assign({}, store)),
        set: (v, cb) => { Object.assign(store, v); if (cb) cb(); },
        remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach((k) => delete store[k]); if (cb) cb(); },
      },
    },
    runtime: { lastError: null },
  };
  const json = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), clone() { return this; } });
  const fetch = async (url, init) => {
    if (init && init.method === "POST") {
      calls.push++;
      // `failPushes` = how many writes drop on the floor first (offline, a 5xx)
      if (opts.failPushes && calls.push <= opts.failPushes) return { ok: false, status: 503, json: async () => ({ message: "unavailable" }), text: async () => "unavailable", clone() { return this; } };
      const sent = JSON.parse(init.body)[0];
      row.config = sent.config;
      // tests use both real ISO stamps and opaque ones like "stamp-B" — bump either
      const t = Date.parse(row.updated_at);
      row.updated_at = isNaN(t) ? row.updated_at + "+1" : new Date(t + 1000).toISOString();
      return json([{ updated_at: row.updated_at }]);
    }
    if (url.indexOf("select=updated_at") >= 0) return json([{ updated_at: row.updated_at }]);
    if (url.indexOf("select=config,updated_at") >= 0) { calls.full++; return json([{ config: row.config, updated_at: row.updated_at }]); }
    // `liveRow` lets a test answer the heal's re-read differently from the pull —
    // that is the race the re-read exists for: another machine fixing the account
    // in between.
    if (url.indexOf("select=config") >= 0) { calls.live++; return json([{ config: opts.liveRow || row.config }]); }
    return json([]);
  };

  const syncedConfigRead = (cb) => cb(store.__sync || {}, !!store.__sync);
  const syncedConfigWrite = async (c) => { store.__sync = c; return true; };
  const readManagedConfig = async () => null;
  const DEFAULTS = { apiKey: "", model: "claude-haiku-4-5", businessInfo: "", instructions: "", enabled: false };

  // (v0.21.62) SEED_CONFIG lives next to DEFAULTS, outside the sliced block, so the
  // harness injects it: `seed` = what this build ships (default: nothing).
  const SEED_CONFIG = opts.seed || {};
  const api = new Function(
    "chrome", "LOG", "fetch", "syncedConfigRead", "syncedConfigWrite", "readManagedConfig", "DEFAULTS", "SEED_CONFIG",
    block +
    "; return { cloudPull, cloudPullRaw, cloudPush, cloudLiveConfig, healWipedAccount, seedEmptyAccount, accountIsDead, looksLikeWipe, configWeight, getSettings, bestKnownConfig };"
  )(chrome, () => {}, fetch, syncedConfigRead, syncedConfigWrite, readManagedConfig, DEFAULTS, SEED_CONFIG);
  return { api, store, row, calls };
}

(async () => {
  /* 1 + 2 — a machine that still holds the settings refuses the wipe and puts them back */
  let m = build({ row: WIPED, store: { __sync: REAL } });
  let r = await m.api.cloudPull(true);
  ok(r.ok && r.wiped === true, "a pull that brings back a wipe is REFUSED — wiped=" + r.wiped);
  ok(!m.store.cloudConfig || m.store.cloudConfig.apiKey === REAL.apiKey,
     "the machine did NOT overwrite its own copy with the blank");
  ok(!!m.store.cloudWipe && m.store.cloudWipe.held > m.store.cloudWipe.incoming,
     "the event is recorded for the Settings page");
  ok(m.row.config.apiKey === REAL.apiKey && m.row.config.businessInfo === REAL.businessInfo,
     "the account itself is put back from this machine");
  ok(r.healed === true, "and the pull reports that it healed it");

  /* 3a — the SAME wipe is never written twice (that is what would loop the fleet) */
  const seenStamp = m.store.cloudHealedStamp;
  const pushesAfterFirst = m.calls.push;
  m.row.config = JSON.parse(JSON.stringify(WIPED));
  m.row.updated_at = seenStamp;            // the same wipe, seen again
  m.store.cloudUpdatedAt = "force-a-refetch";
  await m.api.cloudPull(true);
  ok(m.calls.push === pushesAfterFirst,
     "the same wipe is not written to the account twice — pushes=" + m.calls.push);

  /* 3b — and nothing is written at all if another machine got there first */
  m = build({ row: WIPED, liveRow: REAL, store: { __sync: REAL } });
  r = await m.api.cloudPull(true);
  ok(r.wiped === true, "the wipe is still refused locally when another machine is fixing it");
  ok(m.calls.push === 0 && m.calls.live === 1,
     "the heal re-read the row, saw it healthy and wrote nothing — pushes=" + m.calls.push);

  /* 4 — a healthy row is still applied, and clears the alarm */
  m = build({ row: REAL, store: { __sync: REAL, cloudWipe: { at: 1, stamp: "old" } } });
  r = await m.api.cloudPull(true);
  ok(r.ok && r.keys > 0 && !r.wiped, "a healthy row is applied normally — keys=" + r.keys);
  ok(m.store.cloudConfig && m.store.cloudConfig.apiKey === REAL.apiKey, "and becomes this machine's config");
  ok(!m.store.cloudWipe, "the alarm is cleared once the account is healthy again");

  /* 5 — a deliberate shrink must NOT be mistaken for a wipe */
  const TRIMMED = Object.assign({}, REAL, { listings: [], demoVideoUrls: [], coaching: [], priceList: "" });
  m = build({ row: TRIMMED, store: { __sync: REAL } });
  r = await m.api.cloudPull(true);
  ok(r.ok && !r.wiped, "deleting every listing on purpose is allowed through — wiped=" + !!r.wiped);
  ok(m.store.cloudConfig && m.store.cloudConfig.listings.length === 0, "and the deletion actually applies");
  ok(m.api.looksLikeWipe(TRIMMED, REAL) === false, "looksLikeWipe: key + teaching intact is not a wipe");
  ok(m.api.looksLikeWipe(WIPED, REAL) === true, "looksLikeWipe: key and teaching gone IS a wipe");

  /* 6 — an account with nothing in it reports emptiness, not a sync */
  m = build({ row: {}, store: {} });
  r = await m.api.cloudPull(true);
  ok(r.ok && r.empty === true, "a row with nothing in it comes back as empty, not as a successful sync");
  ok(!m.store.cloudConfig, "and nothing is written over this machine's settings");

  /* 6b — the symptom the operator saw: blank strings in the account, no local copy,
   *      and a build that ships NO starter setup. The blank must not be applied
   *      either: the machine stays on DEFAULTS (a real model in the box) instead
   *      of reproducing the empty form. */
  m = build({ row: WIPED, store: {} });
  r = await m.api.cloudPull(true);
  let s = await m.api.getSettings();
  ok(r.ok && r.empty === true && !r.seeded, "a blank account with nothing to seed from is reported empty — seeded=" + !!r.seeded);
  ok(s.model === "claude-haiku-4-5" && !m.store.cloudConfig,
     "the blank is NOT applied: the machine keeps its defaults instead of showing an empty form");

  /* 7 — (v0.21.62) THE FIX THE OPERATOR ASKED FOR: email + password on a fresh
   *      install fills the account from the build, and every machine follows. */
  // What a build can ship — the same SHAPE as the real SEED_CONFIG: identity,
  // hours, teaching, videos. No secret, and no price list / follow-ups, so the
  // merge test below can prove those survive from the row.
  const SEED = {
    model: REAL.model, businessName: REAL.businessName, businessAddress: REAL.businessAddress,
    businessHoursText: "9AM–9PM, 7 days", businessInfo: REAL.businessInfo, instructions: REAL.instructions,
    demoVideoUrls: REAL.demoVideoUrls,
  };
  m = build({ row: WIPED, store: {}, seed: SEED });
  r = await m.api.cloudPull(true);
  ok(r.ok && r.seeded === true && r.keys > 0, "a fresh install logging into an EMPTY account seeds it from the build — seeded=" + r.seeded);
  ok(m.calls.push === 1 && m.row.config.businessInfo === REAL.businessInfo,
     "the account itself now holds the starter setup (one write)");
  ok(m.store.cloudConfig && m.store.cloudConfig.businessInfo === REAL.businessInfo,
     "and this machine runs on it immediately");
  ok(m.row.config.apiKey === "" && !("enabled" in m.row.config),
     "the seed never invents a secret and never carries a per-machine key");
  s = await m.api.getSettings();
  ok(s.businessInfo === REAL.businessInfo && s.model === REAL.model, "getSettings serves the seeded teaching");

  /* 7b — an untouched row ({}) seeds too */
  m = build({ row: {}, store: {}, seed: SEED });
  r = await m.api.cloudPull(true);
  ok(r.seeded === true && m.calls.push === 1, "an account that was never set up seeds as well");

  /* 7b' — (v0.21.63) THE ROW THE OPERATOR ACTUALLY HAD: the wipe blanked the key
   *       and the teaching but left the shop name, address and hours — enough
   *       weight (30) to look alive to v0.21.62, so it logged in to a name, an
   *       address, and a bot that could not reply. Dead = no key AND no teaching.
   *       And the seed MERGES: a price list still in the row must survive. */
  const HALF_WIPED = Object.assign({}, WIPED, {
    businessName: "SubSell", businessAddress: "757 Rue Beaubien E, Montréal", businessHoursText: "9AM–10PM, 7 days",
    priceList: "iPhone 13 à partir de 195$", followUps: [{ name: "nudge", afterMinutes: 60, message: "still there?", enabled: true }],
  });
  m = build({ row: HALF_WIPED, store: {}, seed: SEED });
  r = await m.api.cloudPull(true);
  ok(r.seeded === true && m.calls.push === 1, "a row with a name and address but no key and no teaching is DEAD and gets seeded — seeded=" + r.seeded);
  ok(m.row.config.businessInfo === REAL.businessInfo && m.row.config.businessHoursText === "9AM–9PM, 7 days",
     "the seed supplies the teaching and corrects the hours (10PM → 9PM)");
  ok(m.row.config.priceList === "iPhone 13 à partir de 195$" && m.row.config.followUps.length === 1,
     "…and MERGES: the price list and follow-ups still in the row survive");
  ok(m.api.accountIsDead(HALF_WIPED) === true && m.api.accountIsDead(REAL) === false && m.api.accountIsDead(Object.assign({}, REAL, { apiKey: "" })) === false,
     "accountIsDead: no key + no teaching only; a keyless row that still teaches is NOT dead (it is a key problem, not a wipe)");

  /* 7c — the seed must NEVER overwrite real settings */
  m = build({ row: REAL, store: {}, seed: Object.assign({}, SEED, { businessInfo: "seed text" }) });
  r = await m.api.cloudPull(true);
  ok(!r.seeded && m.calls.push === 0 && m.row.config.businessInfo === REAL.businessInfo,
     "a healthy account is left exactly as it is — the seed does not fire");

  /* 7d — a machine that holds a real copy heals with ITS copy, not the seed */
  m = build({ row: WIPED, store: { __sync: REAL }, seed: Object.assign({}, SEED, { businessInfo: "seed text" }) });
  r = await m.api.cloudPull(true);
  ok(r.wiped === true && r.healed === true && m.row.config.businessInfo === REAL.businessInfo,
     "a machine with the real settings puts THOSE back, and the seed stays out of the way");

  /* 7e — machines starting together: the second sees a filled row and writes nothing */
  m = build({ row: WIPED, liveRow: REAL, store: {}, seed: SEED });
  r = await m.api.cloudPull(true);
  ok(!r.seeded && m.calls.push === 0 && /another machine/.test(r.seedError || ""),
     "the seed re-reads the row first and steps aside when another machine already filled it — " + (r.seedError || ""));

  /* 7f — once per row stamp, and the whole thing converges (no write loop) */
  m = build({ row: WIPED, store: {}, seed: SEED });
  const first = await m.api.seedEmptyAccount("stamp-A");
  const again = await m.api.seedEmptyAccount("stamp-A");
  ok(first.ok === true && again.ok === false && m.calls.push === 1,
     "seedEmptyAccount writes once per stamp — second call: " + (again.skipped || again.error));
  // After seeding, this machine HOLDS the seed, so a later blanking of the row is a
  // wipe against a held copy: the heal (its own once-per-stamp) restores it, and
  // after that nothing else writes. Two mechanisms, one write each, then silence.
  m.row.config = JSON.parse(JSON.stringify(WIPED));
  m.row.updated_at = "stamp-B";
  m.store.cloudUpdatedAt = "force-a-refetch";
  await m.api.cloudPull(true);
  const afterHeal = m.calls.push;
  m.row.config = JSON.parse(JSON.stringify(WIPED));
  m.row.updated_at = "stamp-B";
  m.store.cloudUpdatedAt = "force-a-refetch";
  await m.api.cloudPull(true);
  await m.api.cloudPull(true);
  ok(afterHeal === 2 && m.calls.push === 2,
     "a re-blanked row is healed once and then left alone — pushes=" + m.calls.push + " (no loop)");

  /* 8 — (v0.21.64) a dropped write is RETRIED, not remembered as done. The stamp
   *     used to be recorded before the push; one 503 then left a dead account dead
   *     for ever, because nothing else ever changes a dead row's stamp. */
  m = build({ row: WIPED, store: {}, seed: SEED, failPushes: 1 });
  r = await m.api.cloudPull(true);
  ok(!r.seeded && !m.store.cloudSeededStamp, "a seed whose write failed is not marked done — seeded=" + !!r.seeded);
  m.store.cloudUpdatedAt = "force-a-refetch";
  r = await m.api.cloudPull(true);
  // cloudPush banks the outgoing config BEFORE the request, so after the failed
  // write this machine already HOLDS the seed — the next pull may fix the account
  // through either door (seed, or the wipe guard healing with the banked seed).
  // What matters is that it is fixed, with exactly one more write.
  ok((r.seeded === true || r.healed === true) && m.calls.push === 2 && m.row.config.businessInfo === REAL.businessInfo,
     "…and the next pull fixes the account — via " + (r.seeded ? "seed" : "heal") + ", pushes=" + m.calls.push);
  m = build({ row: WIPED, store: { __sync: REAL }, failPushes: 1 });
  r = await m.api.cloudPull(true);
  ok(r.wiped === true && !r.healed && !m.store.cloudHealedStamp, "a heal whose write failed is not marked done either");
  m.store.cloudUpdatedAt = "force-a-refetch";
  r = await m.api.cloudPull(true);
  ok(r.healed === true && m.row.config.apiKey === REAL.apiKey, "…and the next pull heals it — pushes=" + m.calls.push);

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
