/* (v0.21.73) RUNTIME test of the dashboard's conflicting-save path — the real
 * docs/app.js, driven through what happens when the owner teaches on one device
 * while the row changes underneath it (another tab, the phone, a computer's own
 * save). Before this release that save was thrown away: the page reloaded the
 * other version, parked the lesson in a browser draft behind a banner, and the
 * Activity tab still showed ✓ / "Rule taught ✓".
 *
 *   1. a rule taught on a stale page lands TOGETHER with the other device's edit,
 *      the page says so truthfully, and nothing goes to a draft;
 *   2. text typed here while the other device changed another field: both survive,
 *      and the other device's edit appears on this page without a reload;
 *   3. the next save uses the fresh stamp and lands directly (no second merge);
 *   4. when the merged write is refused, the page says NOT saved and keeps the text;
 *   5. when the row cannot even be re-read, the old reload + draft path still runs;
 *   6. a stamp that goes stale twice in a row is merged again, not dropped.
 * Run:  node store/smoke-merge.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---- a DOM that remembers children and classes (same shape as smoke-draft.js) ---- */
function makeDom() {
  const cache = {};
  function mkEl(id) {
    const cls = new Set();
    const el = {
      id, textContent: "", checked: false, disabled: false, readOnly: false, title: "",
      style: {}, dataset: {}, files: null, children: [], _h: {},
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      async fire(ev) { for (const fn of el._h[ev] || []) await fn({ preventDefault() {}, target: el, key: "" }); },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {}, after() {}, setAttribute() {}, getAttribute() { return ""; },
      querySelector() { return mkEl("q"); }, querySelectorAll() { return []; }, focus() {}, click() {}, select() {},
    };
    let html = "";
    Object.defineProperty(el, "innerHTML", { get: () => html, set: (v) => { html = v; if (v === "") el.children = []; } });
    let val = ""; // a real <input>.value is always a string, whatever was assigned
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

/* ---- browser-side storage ---- */
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
const draft = () => { const k = [...store.keys()].find((x) => x.startsWith("subsell_unsaved_teaching")); return k ? JSON.parse(store.get(k)) : null; };

/* ---- Supabase: ONE row, and an update only lands when its stamp condition holds ---- */
let stampN = 0;
const nextStamp = () => "2026-10-05T12:00:" + String(++stampN).padStart(2, "0") + "+00:00";
const state = {
  row: {
    config: { apiKey: "sk-real", model: "claude-haiku-4-5", businessInfo: "INFO v1", instructions: "TONE v1", priceList: "", examples: "",
      videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "", businessHoursEnabled: false, /* (v0.21.75) a row still carrying the old gate gets one system save on open */
      coaching: [{ kind: "good", buyer: "dispo?", reply: "ouais", at: 1 }] },
    config_key: "ck", updated_at: nextStamp(),
  },
  updates: [],     // every write that LANDED
  attempts: 0,     // every write that was tried
  writeError: null, failRead: false,
  nthWrite: 0, onWrite: null, // a hook: another device writes just before our Nth write attempt
};
function otherDevice(change) { // somebody else writes the row
  state.row.config = Object.assign(clone(state.row.config), change);
  state.row.updated_at = nextStamp();
}
function makeClient() {
  function table(name) {
    const q = {
      _payload: null, _filters: {},
      select() { return q; }, neq() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; },
      eq(col, val) { q._filters[col] = val; return q; },
      maybeSingle: async () => {
        if (name !== "subsell_configs") return { data: null, error: null };
        if (state.failRead) return { data: null, error: { message: "network down" } };
        return { data: { config: clone(state.row.config), config_key: state.row.config_key, updated_at: state.row.updated_at }, error: null };
      },
      update(p) { q._payload = p; return q; }, insert(p) { q._payload = p; return q; },
      then(res, rej) {
        let out = { data: [], error: null };
        if (q._payload && name === "subsell_configs") {
          state.attempts++;
          state.nthWrite = (state.nthWrite || 0) + 1;
          if (state.onWrite && state.onWrite.n === state.nthWrite) { const f = state.onWrite.fn; state.onWrite = null; f(); } // another device writes just before this one
          if (state.writeError) out = { data: null, error: { message: state.writeError, code: "XX000" } };
          else if ("updated_at" in q._filters && q._filters.updated_at !== state.row.updated_at) out = { data: [], error: null }; // stale stamp: zero rows
          else {
            state.updates.push(clone(q._payload.config));
            state.row.config = clone(q._payload.config);
            state.row.updated_at = nextStamp(); // the database stamps the row itself
            out = { data: [{ updated_at: state.row.updated_at }], error: null };
          }
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

async function loadPage() {
  const dom = makeDom();
  global.document = dom.document;
  global.window = {
    addEventListener() {}, open() {},
    SUBSELL_SUPABASE_URL: "https://example.supabase.co", SUBSELL_SUPABASE_ANON_KEY: "anon",
    location: { href: "https://example.test/", hash: "", origin: "https://example.test" },
    localStorage,
  };
  global.localStorage = localStorage;
  global.location = global.window.location;
  global.navigator = { userAgent: "node" };
  global.fetch = async () => ({ ok: true, text: async () => "", json: async () => ({}) });
  global.supabase = { createClient: makeClient };
  global.alert = () => {};
  global.confirm = () => true;
  try { new Function(src)(); } catch (e) { console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message)); console.error((e && e.stack || "").split("\n").slice(0, 8).join("\n")); process.exit(1); }
  await sleep(120); // getSession → showApp → loadConfig
  return dom;
}
const rulesIn = (cfg) => (cfg.coaching || []).filter((c) => c.note === "always applies").map((c) => c.better);

(async () => {
  /* 1. a rule taught on a stale page */
  let dom = await loadPage();
  ok(state.attempts === 0 && dom.cache.instructions.value === "TONE v1", "the page loads the row and writes nothing");
  otherDevice({ instructions: "TONE edited on the phone" });
  dom.cache.ruleText.value = "never offer shipping";
  await dom.cache.addRule.fire("click");
  ok(state.updates.length === 1 && state.attempts === 2, "1. the stale write is refused once, then ONE merged write lands (attempts=" + state.attempts + ")");
  ok(rulesIn(state.row.config).join() === "never offer shipping" && state.row.config.instructions === "TONE edited on the phone", "1. the row holds the rule taught here AND the text edited on the phone");
  ok(state.row.config.coaching.length === 2 && state.row.config.apiKey === "sk-real", "1. the existing lesson and the API key are untouched");
  ok(/Rule taught/.test(dom.cache.savedMsg.textContent) && dom.cache.ruleText.value === "", "1. the page reports the rule as taught, truthfully, and clears the box");
  ok(/another device/.test(dom.cache.autoSaveMsg.textContent) && dom.cache.autoSaveMsg.className === "saved", "1. the footer says it was saved together with another device's change");
  ok(dom.cache.instructions.value === "TONE edited on the phone", "1. the phone's edit appears on this page without a reload");
  ok(draft() === null && dom.cache.draftBanner.classList.contains("hidden"), "1. nothing was parked in a draft; no banner to notice");

  /* 2. typing here while another field changes there */
  otherDevice({ priceList: "iPhone 13: $400" });
  dom.cache.businessInfo.value = "INFO v2 typed here";
  await dom.cache.businessInfo.fire("input");
  await sleep(1500); // auto-save debounce is 1200 ms
  ok(state.row.config.businessInfo === "INFO v2 typed here" && state.row.config.priceList === "iPhone 13: $400", "2. text typed here and the price list edited there are both in the row");
  ok(dom.cache.businessInfo.value === "INFO v2 typed here" && dom.cache.priceList.value === "iPhone 13: $400", "2. this page keeps its own text and shows their price list");
  ok(rulesIn(state.row.config).length === 1 && state.row.config.instructions === "TONE edited on the phone", "2. earlier teaching is still there");

  /* 3. the next save goes straight in */
  const before = state.attempts;
  dom.cache.examples.value = "Buyer: allo";
  await dom.cache.examples.fire("input");
  await sleep(1500);
  ok(state.attempts === before + 1 && state.row.config.examples === "Buyer: allo", "3. the following save uses the fresh stamp: one attempt, landed");

  /* 6. the row changes AGAIN between the merge's re-read and its write */
  otherDevice({ instructions: "TONE edit A" });
  const landed6 = state.updates.length;
  state.nthWrite = 0;
  state.onWrite = { n: 2, fn: () => otherDevice({ examples: "Buyer: allo (edited there)" }) }; // the 1st merged write finds the row changed again
  dom.cache.ruleText.value = "always say à partir de";
  await dom.cache.addRule.fire("click");
  ok(state.nthWrite === 3 && state.updates.length === landed6 + 1, "6. stale → merged write stale again → merged again: three attempts, ONE landed (attempts=" + state.nthWrite + ")");
  ok(rulesIn(state.row.config).includes("always say à partir de") && state.row.config.instructions === "TONE edit A" && state.row.config.examples === "Buyer: allo (edited there)", "6. the rule lands on top of BOTH of the other device's edits");
  ok(/Rule taught/.test(dom.cache.savedMsg.textContent) && dom.cache.examples.value === "Buyer: allo (edited there)", "6. the page reports success and shows their latest text");

  /* 4. the merged write is refused by the database */
  otherDevice({ instructions: "TONE edit B" });
  state.writeError = "permission denied for table subsell_configs";
  dom.cache.ruleText.value = "RULE THAT CANNOT BE SAVED";
  const landed = state.updates.length;
  await dom.cache.addRule.fire("click");
  ok(state.updates.length === landed, "4. a refused write lands nothing");
  ok(/NOT saved/.test(dom.cache.savedMsg.textContent) && dom.cache.ruleText.value === "RULE THAT CANNOT BE SAVED", "4. the page says the rule was NOT saved and keeps the text in the box");
  ok(dom.cache.autoSaveMsg.className === "err" && /Not saved/.test(dom.cache.autoSaveMsg.textContent), "4. the footer names the failure");
  ok(draft() && (draft().coaching || []).some((c) => c.better === "RULE THAT CANNOT BE SAVED"), "4. the lesson is kept in the browser draft as well");
  state.writeError = null;
  await dom.cache.addRule.fire("click"); // the operator presses Teach it again
  ok(rulesIn(state.row.config).filter((r) => r === "RULE THAT CANNOT BE SAVED").length === 1 && state.row.config.instructions === "TONE edit B", "4. pressing it again saves it — once, not twice — on top of the other device's edit");

  /* 5. the row cannot be re-read: the old path */
  otherDevice({ instructions: "TONE edit C" });
  state.failRead = true;
  dom.cache.ruleText.value = "RULE DURING AN OUTAGE";
  const landed5 = state.updates.length;
  await dom.cache.addRule.fire("click");
  ok(state.updates.length === landed5 && /NOT saved/.test(dom.cache.savedMsg.textContent), "5. no re-read → nothing written, and the page says NOT saved");
  ok(draft() && (draft().coaching || []).some((c) => c.better === "RULE DURING AN OUTAGE"), "5. …and the lesson is kept as a draft (the pre-v0.21.73 safety net still works)");
  state.failRead = false;

  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
