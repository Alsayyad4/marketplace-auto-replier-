/* (v0.21.70) RUNTIME test of the dashboard's refused-save path — the real docs/app.js
 * driven through the states the operator actually met:
 *   1. the database refuses every write (the v0.21.61 trigger) and the row still
 *      carries the .69 legacy-link gate armed, so loadConfig's own quiet "disarm"
 *      save fails on open → the fix banner shows, and NO draft is written (a
 *      load-time SYSTEM save carries no typed text);
 *   2. the operator types teaching → auto-save is refused → the text is kept as a
 *      draft (never the API key), and "Copy the fix" refuses to hand over a file
 *      that is not the corrected one;
 *   3. reload while still broken → the load-time save fails again, and the draft
 *      SURVIVES it (the first draft of this code lost it right here) and is offered;
 *   4. the SQL is pasted (writes succeed) but the row is still armed → the quiet
 *      disarm save lands WITHOUT clearing the draft, the offer is still there, and
 *      "Put my text back and save" writes the typed text to the row;
 *   5. "Discard it" needs a confirm.
 * Run:  node store/smoke-draft.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");
const RLS = 'new row violates row-level security policy for table "subsell_config_history"';

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- a DOM that remembers children and classes ---- */
function makeDom() {
  const cache = {};
  function mkEl(id) {
    const cls = new Set();
    const el = {
      id, value: "", textContent: "", checked: false, disabled: false, readOnly: false,
      style: {}, dataset: {}, files: null, children: [], _h: {},
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c) => (cls.has(c) ? cls.delete(c) : cls.add(c)), contains: (c) => cls.has(c) },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      async fire(ev) { for (const fn of el._h[ev] || []) await fn({ preventDefault() {}, target: el }); },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return ""; },
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
const buttonIn = (el, startsWith) => el.children.find((c) => String(c.textContent || "").startsWith(startsWith));

/* ---- browser-side storage that persists across page loads ---- */
const store = new Map();
const localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const draft = () => { const k = [...store.keys()].find((x) => x.startsWith("subsell_unsaved_teaching")); return k ? JSON.parse(store.get(k)) : null; };

/* ---- Supabase: one row, a switchable trigger ---- */
const state = {
  dbBroken: true,
  row: { config: { apiKey: "sk-real", model: "claude-haiku-4-5", businessInfo: "BI", instructions: "OLD TEACHING", examples: "", videoLinkFallback: true }, config_key: "ck", updated_at: "2026-09-22T10:00:00+00:00" },
  updates: [],
};
function makeClient() {
  function table(name) {
    const q = {
      _payload: null,
      select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; },
      maybeSingle: async () => ({ data: name === "subsell_configs" ? { config: JSON.parse(JSON.stringify(state.row.config)), config_key: state.row.config_key, updated_at: state.row.updated_at } : null, error: null }),
      update(p) { q._payload = p; return q; }, insert(p) { q._payload = p; return q; },
      then(res, rej) {
        let out = { data: [], error: null };
        if (q._payload && name === "subsell_configs") {
          if (state.dbBroken) out = { data: null, error: { message: RLS, code: "42501" } };
          else {
            state.updates.push(q._payload);
            state.row.config = q._payload.config;
            state.row.updated_at = q._payload.updated_at || "2026-09-29T12:00:00+00:00";
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

const opened = [];
async function loadPage() {
  const dom = makeDom();
  global.document = dom.document;
  global.window = {
    addEventListener() {}, open: (u) => opened.push(u),
    SUBSELL_SUPABASE_URL: "https://example.supabase.co", SUBSELL_SUPABASE_ANON_KEY: "anon",
    location: { href: "https://example.test/", hash: "", origin: "https://example.test" },
    localStorage,
  };
  global.localStorage = localStorage;
  global.location = global.window.location;
  global.navigator = { userAgent: "node" }; // no clipboard
  // The published file is still the OLD one (no "security definer"): the button must refuse it.
  global.fetch = async () => ({ ok: true, text: async () => "create or replace function public.subsell_guard_config() returns trigger language plpgsql as $$ old $$;", json: async () => ({}) });
  global.supabase = { createClient: makeClient };
  global.alert = () => {};
  global.confirm = () => true;
  try { new Function(src)(); } catch (e) { console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message)); console.error((e && e.stack || "").split("\n").slice(0, 8).join("\n")); process.exit(1); }
  await sleep(120); // getSession → showApp → loadConfig → (quiet system save) → offerDraft
  return dom;
}

(async () => {
  /* 1. broken DB, armed row: the load-time disarm save fails on open */
  let dom = await loadPage();
  let fix = dom.cache.fixBanner, offer = dom.cache.draftBanner;
  ok(!fix.classList.contains("hidden") && fix.children.length >= 3, "1. on open, the refused load-time save shows the fix banner (copy / SQL editor / steps)");
  ok(draft() === null, "1. a load-time SYSTEM save writes NO draft (it carries no typed text)");
  ok(offer.classList.contains("hidden"), "1. no draft offer yet");
  ok(/safety net/.test(dom.cache.autoSaveMsg.textContent) && /Not saved/.test(dom.cache.autoSaveMsg.textContent), "1. the footer explains the error in words: " + JSON.stringify(dom.cache.autoSaveMsg.textContent.slice(0, 80)));

  /* 2. the operator types; the auto-save is refused; the text is kept */
  dom.cache.instructions.value = "NEW TEACHING typed for days";
  await dom.cache.instructions.fire("input");
  await sleep(1500); // auto-save debounce is 1200 ms
  let d = draft();
  ok(d && d.fields && d.fields.instructions === "NEW TEACHING typed for days", "2. the refused auto-save kept the typed text as a draft");
  ok(d && d.user === "u1" && !("apiKey" in (d.fields || {})) && !JSON.stringify(d).includes("sk-real"), "2. the draft is scoped to the account and never holds the API key");
  ok(state.updates.length === 0, "2. nothing reached the row while the DB refuses writes");
  const copyBtn = buttonIn(fix, "1.");
  ok(!!copyBtn, "2. the fix banner has the copy button");
  if (copyBtn) { await copyBtn.fire("click"); await sleep(20); }
  ok(opened.length === 0 && copyBtn && /not published yet/.test(copyBtn.textContent), "2. 'Copy the fix' refuses the OLD published file: opens nothing, says not published yet — " + JSON.stringify(copyBtn && copyBtn.textContent));

  /* 3. reload while still broken: the draft must survive the load-time save */
  dom = await loadPage();
  fix = dom.cache.fixBanner; offer = dom.cache.draftBanner;
  d = draft();
  ok(d && d.fields.instructions === "NEW TEACHING typed for days", "3. after a reload (DB still broken) the draft SURVIVED the refused load-time save");
  ok(!offer.classList.contains("hidden") && /instructions/.test(offer.children[0] && offer.children[0].textContent), "3. the draft is offered back, naming the field");
  ok(!fix.classList.contains("hidden"), "3. the fix banner is shown as well (separate element)");

  /* 4. SQL pasted: writes succeed; the row is still armed → quiet disarm save lands, draft intact */
  state.dbBroken = false;
  dom = await loadPage();
  fix = dom.cache.fixBanner; offer = dom.cache.draftBanner;
  ok(state.updates.length === 1 && state.updates[0].config.videoLinkFallback === false, "4. the load-time disarm save landed once the DB accepts writes");
  ok(state.updates[0].config.instructions === "OLD TEACHING", "4. …and it wrote the ROW's text, not the draft (no silent overwrite)");
  ok(draft() && draft().fields.instructions === "NEW TEACHING typed for days", "4. the landed SYSTEM save did NOT clear the draft");
  ok(!offer.classList.contains("hidden"), "4. the offer is still on screen");
  ok(fix.classList.contains("hidden"), "4. the fix banner is gone (the database accepted a write)");
  const putBtn = buttonIn(offer, "Put my text back");
  ok(!!putBtn, "4. the offer has 'Put my text back and save'");
  if (putBtn) { await putBtn.fire("click"); await sleep(50); }
  const last = state.updates[state.updates.length - 1];
  ok(state.updates.length === 2 && last.config.instructions === "NEW TEACHING typed for days", "4. 'Put my text back and save' wrote the typed teaching to the row");
  ok(last.config.apiKey === "sk-real" && last.config.videoLinkFallback === false, "4. …keeping the key and the legacy-link clamp");
  ok(draft() === null, "4. the draft is cleared once it landed");
  ok(offer.classList.contains("hidden"), "4. the offer is gone");

  /* 5. Discard needs a confirm */
  store.set("subsell_unsaved_teaching:u1", JSON.stringify({ at: 1, user: "u1", fields: { instructions: "X" }, coaching: [] }));
  dom = await loadPage();
  offer = dom.cache.draftBanner;
  const dropBtn = buttonIn(offer, "Discard");
  ok(!!dropBtn && !offer.classList.contains("hidden"), "5. a stored draft is offered again");
  global.confirm = () => false;
  if (dropBtn) await dropBtn.fire("click");
  ok(draft() !== null && !offer.classList.contains("hidden"), "5. 'Discard it' does nothing when the confirm is refused");
  global.confirm = () => true;
  if (dropBtn) await dropBtn.fire("click");
  ok(draft() === null && offer.classList.contains("hidden"), "5. 'Discard it' clears the draft after a confirm");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
