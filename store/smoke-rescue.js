/* Tests the config wipe guard and recovery (background.js, v0.21.60).
 *
 * Why this file exists: the operator's account row came back full of empty
 * strings. The options page then showed a blank API key and a blank Model box —
 * which looks exactly like a fresh, logged-out install, which is why it felt as
 * though the login had been lost. One press of Save on that blank form would have
 * published apiKey:"" and model:"" to every machine, permanently.
 *
 * Under test:
 *   1. configWeight rates a config of empty strings as worthless, and a real one high.
 *   2. guardOutgoingConfig lets a NORMAL edit through untouched (including clearing
 *      a single field) — it must not fight the operator.
 *   3. guardOutgoingConfig folds the good values back into a WIPE.
 *   4. scanConfigSources finds a surviving copy in Chrome sync, which is where it
 *      actually lives on a machine that saved before the wipe.
 *
 * Run:  node store/smoke-rescue.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const from = src.indexOf("const CFG_BACKUP_KEY");
const to = src.indexOf("\nfunction getSettings()");
if (from < 0 || to < 0) { console.error("rescue block not found in background.js"); process.exit(1); }
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
// What the blank form would have published.
const WIPED = { apiKey: "", model: "", businessInfo: "", instructions: "", closerGoals: "", listings: [], followUps: [], demoVideoUrls: [], coaching: [] };

function build(store) {
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.assign({}, store)),
      set: (v, cb) => { Object.assign(store, v); if (cb) cb(); },
    } },
    runtime: { lastError: null },
  };
  const syncedConfigRead = (cb) => cb(store.__sync || {}, !!store.__sync);
  return new Function("chrome", "LOG", "syncedConfigRead",
    block + "; return { configWeight, guardOutgoingConfig, scanConfigSources, bankConfig, getConfigBackups, bestKnownConfig };"
  )(chrome, () => {}, syncedConfigRead);
}

(async () => {
  const api = build({});
  const wReal = api.configWeight(REAL), wWiped = api.configWeight(WIPED);
  ok(wWiped === 0, "a config of empty strings is worth nothing — got " + wWiped);
  ok(wReal > 60, "a real config is worth a lot — got " + wReal);
  ok(api.configWeight(null) === 0 && api.configWeight("x") === 0, "junk input cannot crash the weighing");

  // A machine that saved before the wipe still has it in Chrome sync.
  let store = { __sync: REAL };
  let a = build(store);
  const found = await a.scanConfigSources();
  ok(found.length >= 1 && found[0].from.indexOf("Chrome sync") >= 0,
     "a surviving copy is found in Chrome sync — " + (found[0] && found[0].from));
  ok(JSON.stringify(found[0].config) === JSON.stringify(REAL), "and it is the real config, intact");

  // 3. the wipe is stopped
  store = { __sync: REAL };
  a = build(store);
  const guarded = await a.guardOutgoingConfig(WIPED);
  ok(guarded.repaired.length > 0, "a wipe is caught and repaired (" + guarded.repaired.length + " fields restored)");
  ok(guarded.config.apiKey === REAL.apiKey, "the API key is NOT erased");
  ok(guarded.config.businessInfo === REAL.businessInfo, "the business teaching is NOT erased");
  ok(guarded.config.listings.length === 2 && guarded.config.demoVideoUrls.length === 1, "listings and demo videos are NOT erased");
  ok(guarded.config.model === REAL.model, "the model is NOT blanked (an empty model stops every bot)");

  // 2. a normal edit must pass straight through — the guard must not fight the operator
  store = { __sync: REAL };
  a = build(store);
  const edited = Object.assign({}, REAL, { businessName: "SubSell Montreal", priceList: "" }); // renamed + cleared ONE field
  const g2 = await a.guardOutgoingConfig(edited);
  ok(g2.repaired.length === 0, "an ordinary edit passes through untouched — repaired=" + g2.repaired.length);
  ok(g2.config.priceList === "" && g2.config.businessName === "SubSell Montreal",
     "a deliberately cleared field STAYS cleared, and a rename sticks");

  // with nothing to compare against, nothing is invented
  a = build({});
  const g3 = await a.guardOutgoingConfig(WIPED);
  ok(g3.repaired.length === 0 && g3.config.apiKey === "", "with no surviving copy the guard stays out of the way");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
