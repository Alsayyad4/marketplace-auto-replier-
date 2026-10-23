/* (v0.21.89) WHERE THE TEACHING LIVES — the extension leads to the account's page, and the
 * extension's own Settings page can no longer overwrite it.
 *
 * Why this file exists: Oct 21 2026 the owner asked why the teaching (rules, corrections,
 * graded replies, the gap list, the preview, Try it) and every computer's Activity exist only
 * on the dashboard (alsayyad4.github.io/marketplace-auto-replier-/docs/) and not in the Web
 * Store extension's Settings. The answer: the dashboard is the ACCOUNT's page — one editor,
 * always the newest code, deployed in minutes with no store review — while the extension's
 * Settings page is ONE computer's page whose Save pushed the whole settings object it had
 * read when it opened, with no precondition (the dashboard has saved with a stamp since
 * v0.21.56 and merged since .73). Now the popup and Settings open the dashboard at the right
 * tab, and a Settings save writes only this page's changes over the account's CURRENT row.
 *
 * Under test:
 *   1. the pure merge, sliced from options.js: a box typed here wins, a box untouched here
 *      keeps the account's newer value, the dashboard-only list (coaching) is never pushed
 *      back from a stale snapshot, lists merge item by item, a removal here holds;
 *   2. the wiring in options.js: Save and "Get Claude's reply" both go through the merge,
 *      load() snapshots the row, the account is pulled first only with a login and the wait
 *      is bounded, a save before the load is refused, the merged copy is adopted on screen;
 *   3. the markup: Settings → Business box + button, the Activity button, the empty-log link,
 *      the popup's two links and their handler, the dashboard's hash routing and cache-buster,
 *      the manifest version, the store zip's file list (nothing new to add);
 *   4. the dashboard really run against a stubbed DOM + Supabase: #business lands on the
 *      Business pane after the login, #activity lands on Activity and loads it, a hash change
 *      while open switches the tab, a click writes the hash back, no hash = General as before.
 *
 * Run:  node store/smoke-where.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const opt = R("options.js"), optHtml = R("options.html"), pop = R("popup.js"), popHtml = R("popup.html");
const app = R("docs/app.js"), html = R("docs/index.html"), ps1 = R("store/build-webstore-zip.ps1");
const manifest = JSON.parse(R("manifest.json"));

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));
const DASH = "https://alsayyad4.github.io/marketplace-auto-replier-/docs/";

/* 1 — the pure merge, sliced from options.js */
const from = opt.indexOf("/* ===== (v0.21.89) SAVE OVER THE CURRENT ROW");
const to = opt.indexOf("/* ===== end save-over-current (pure) ===== */");
if (from < 0 || to < 0 || to < from) { console.error("the pure block was not found in options.js"); process.exit(1); }
// (the source evaluated here is the repo's own options.js — the same pattern as every smoke test in this folder)
const lib = new Function(opt.slice(from, to) + "; return { canon, mergeList, mergeOverCurrent, LIST_KEYS };")();
ok(!/chrome\.[a-zA-Z]/.test(opt.slice(from, to)), "the pure block touches no chrome API");

const L1 = { title: "iPhone 13 128", model: "iPhone 13", storage: "128", condition: "A", price: 400, videoUrl: "", available: true };
const L2 = { title: "iPhone 14 256", model: "iPhone 14", storage: "256", condition: "A", price: 600, videoUrl: "", available: true };
const L3 = { title: "iPhone 12 64", model: "iPhone 12", storage: "64", condition: "B", price: 250, videoUrl: "", available: true };
const C1 = { kind: "good", buyer: "dispo?", reply: "oui", at: 1 };
const C2 = { kind: "rule", note: "always applies", better: "never offer shipping", at: 2 };
const base = { businessInfo: "info A", instructions: "instr A", coaching: [C1], listings: [L1], hourlyCap: 30, priceList: "p", enabled: true };
const current = { businessInfo: "info A", instructions: "instr B (dashboard)", coaching: [C1, C2], listings: [L1, L2], hourlyCap: 30, priceList: "p", enabled: true, newKey: "x" };
let mine = Object.assign(clone(base), { businessInfo: "info C (this computer)", listings: [L3] });
let m = lib.mergeOverCurrent(base, mine, current);
ok(m.config.businessInfo === "info C (this computer)", "a box typed here wins");
ok(m.config.instructions === "instr B (dashboard)", "a box untouched here keeps the account's NEWER value (the old page wrote 'instr A' over it)");
ok(JSON.stringify(m.config.coaching) === JSON.stringify([C1, C2]), "coaching (dashboard-only) is never pushed back from this page's stale snapshot");
ok(JSON.stringify(m.config.listings) === JSON.stringify([L2, L3]), "lists merge item by item: L1 removed here is gone, L2 added there is kept, L3 added here is added");
ok(m.config.newKey === "x" && m.config.hourlyCap === 30 && m.config.priceList === "p", "keys this page never knew survive");
ok(m.changed.join() === "businessInfo,listings", "changed = what this page touched: " + m.changed.join());
ok(m.kept.join() === "instructions,coaching,newKey", "kept = what the account changed meanwhile: " + m.kept.join());
m = lib.mergeOverCurrent(base, clone(base), current);
ok(lib.canon(m.config) === lib.canon(current) && m.changed.length === 0, "no edit here = the account's current settings, untouched");
m = lib.mergeOverCurrent({ listings: [{ a: 1, b: 2 }] }, { listings: [{ b: 2, a: 1 }] }, { listings: [{ a: 1, b: 2 }, { c: 3 }] });
ok(m.changed.length === 0 && m.config.listings.length === 2, "key order does not count as an edit");
m = lib.mergeOverCurrent({ priceList: "p", x: 1 }, { x: 1 }, { priceList: "p (edited there)", x: 1 });
ok(!("priceList" in m.config) && m.changed.join() === "priceList", "a box removed here is removed, even if the account edited it meanwhile");
m = lib.mergeOverCurrent({ hourlyCap: 30 }, { hourlyCap: 40 }, { hourlyCap: 35 });
ok(m.config.hourlyCap === 40 && m.kept.length === 0, "a number typed here wins (last writer for that box)");
m = lib.mergeOverCurrent({ a: 1, b: 2 }, { a: 1, b: 2 }, { a: 1 });
ok(!("b" in m.config) && m.kept.join() === "b", "a key the account removed stays removed when untouched here");
m = lib.mergeOverCurrent({ followUps: [] }, { followUps: [{ name: "f1" }] }, {});
ok(JSON.stringify(m.config.followUps) === JSON.stringify([{ name: "f1" }]), "a follow-up added here lands even when the account holds no list");
m = lib.mergeOverCurrent({ enabled: true, apiKey: "k" }, { enabled: true, apiKey: "k" }, { enabled: false, apiKey: "k2" });
ok(m.config.enabled === false && m.config.apiKey === "k2", "untouched boxes (enabled, the API key) take the current values");
ok(lib.LIST_KEYS.join() === "listings,followUps,videos,demoVideoUrls,coaching", "the list keys are the dashboard's five");

/* 2 — the wiring in options.js */
ok(/saveMergedSettings\(\)\.then\(\(\) => \{\s*\$\("testStatus"\)\.textContent = "Calling Claude…";/.test(opt), "'Get Claude's reply' saves through the merge first");
ok(/function save\(\) \{[\s\S]{0,160}saveMergedSettings\(\)\.then\(/.test(opt), "Save goes through the merge");
ok(!/sendMessage\(\{ type: "SAVE_SETTINGS"/.test(opt), "no raw SAVE_SETTINGS sender is left in options.js");
ok((opt.match(/loadedBase = clone\(settings\);/g) || []).length === 2, "load() snapshots the row, and a landed save re-snapshots it");
ok(/if \(!loadedBase\) return \{ r: null, err: null, notLoaded: true/.test(opt) && /Not saved — this page is still loading your settings/.test(opt), "a save before the row is read is refused, and says so");
ok(/if \(st\.res && st\.res\.loggedIn\) await Promise\.race\(\[ask\("CLOUD_PULL"\), new Promise\(\(r\) => setTimeout\(r, PULL_WAIT_MS\)\)\]\);/.test(opt) && /const PULL_WAIT_MS = 10 \* 1000;/.test(opt),
   "with a login the account is pulled first, bounded to 10 s; without one nothing is asked of the cloud");
ok(/mergeOverCurrent\(loadedBase, settings, current\)/.test(opt), "the merge runs on the page's snapshot, the form and the current read");
ok(/if \(r && !\(r\.cloud && r\.cloud\.ok === false\)\) \{[\s\S]{0,400}fieldsToForm\(\);\s*renderListings\(\);\s*renderFollowUps\(\);\s*renderVideos\(\);\s*renderCentralVideos\(\);/.test(opt),
   "a landed save puts the merged copy on screen; a refused one leaves the typed text alone");
ok(/kept " \+ keptN \+ " newer change\(s\) from the account/.test(opt), "the Saved line names what was kept");
ok(/a\.href = DASHBOARD_URL \+ "#activity";/.test(opt), "the empty-log link lands on the dashboard's Activity tab");
ok(/function openDashboardTab\(tab\) \{ chrome\.tabs\.create\(\{ url: DASHBOARD_URL \+ "#" \+ tab, active: true \}\); \}/.test(opt)
   && /\$\("openTeaching"\)\.addEventListener\("click", \(\) => openDashboardTab\("business"\)\)/.test(opt)
   && /\$\("openActivityAll"\)\.addEventListener\("click", \(\) => openDashboardTab\("activity"\)\)/.test(opt),
   "Settings' two buttons open the dashboard at #business / #activity");

/* 3 — the markup */
ok(/id="whereBox"/.test(optHtml) && /taught on the account's page, not here/.test(optHtml) && /id="openTeaching"/.test(optHtml), "Settings → Business: the where-box and its button");
ok(/id="openActivityAll"/.test(optHtml) && optHtml.indexOf('id="openActivityAll"') > optHtml.indexOf('<section id="log">'), "Settings → Activity log: the every-computer button sits in that tab");
ok(/id="teachLink"/.test(popHtml) && /id="activityLink"/.test(popHtml), "the popup carries the two links");
ok(/function openDashboard\(tab\) \{ chrome\.tabs\.create\(\{ url: DASHBOARD_URL \+ "#" \+ tab, active: true \}\); \}/.test(pop) && /openDashboard\("business"\)/.test(pop) && /openDashboard\("activity"\)/.test(pop) && pop.includes(DASH),
   "the popup's links open the dashboard at the tab");
ok(/function showTab\(name\)/.test(app) && /function applyHashTab\(\)/.test(app) && /addEventListener\("hashchange", applyHashTab\)/.test(app), "the dashboard routes by hash");
ok(/loadConfig\(\)\.then\(applyHashTab, applyHashTab\);/.test(app), "the hash tab is applied once the row is read after the login");
ok(/if \(name === "activity"\) loadActivity\(\);/.test(app), "#activity loads the log");
ok(/history\.replaceState\(null, "", "#" \+ t\.dataset\.tab\);/.test(app), "a click writes the hash back");
ok(/app\.js\?v=20261021/.test(html), "the dashboard cache-buster is bumped");
ok(/^0\.21\.(89|9[0-9])$/.test(manifest.version), "manifest v0.21.89 or later — " + manifest.version); // (v0.21.90) the release after carries this page unchanged
ok(/"options\.html", "options\.js", "popup\.html", "popup\.js"/.test(ps1), "the store zip carries the four page files (nothing new to add)");

/* 4 — the dashboard, really run: a hash lands on its tab after the login */
const TABS = ["general", "business", "listings", "followups", "videos", "activity"];
function makeDom() {
  const cache = {};
  function mkEl(id) {
    const cls = new Set();
    const el = {
      id, textContent: "", innerHTML: "", value: "", checked: false, disabled: false, title: "", style: {}, dataset: {}, files: null, children: [], _h: {},
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      async fire(ev) { for (const fn of el._h[ev] || []) await fn({ preventDefault() {}, target: el, key: "" }); },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() {}, after() {}, setAttribute() {}, getAttribute() { return ""; },
      querySelector() { return mkEl("q"); }, querySelectorAll() { return []; }, focus() {}, click() {}, select() {},
    };
    return el;
  }
  const tabs = TABS.map((n) => { const t = mkEl("tab-" + n); t.dataset.tab = n; return t; });
  const document = {
    getElementById(id) { return (cache[id] = cache[id] || mkEl(id)); },
    querySelector(sel) { const mm = /\.tab\[data-tab="([a-z]+)"\]/.exec(sel); return mm ? (tabs.find((t) => t.dataset.tab === mm[1]) || null) : mkEl("qs"); },
    querySelectorAll(sel) { if (sel === ".tab") return tabs; if (sel === "section.pane") return TABS.map((n) => document.getElementById(n)); return []; },
    createElement(t) { return mkEl("new-" + t); }, addEventListener() {}, body: mkEl("body"),
  };
  for (const id of ["fixBanner", "draftBanner", "loginView", "teachPreview"]) document.getElementById(id).classList.add("hidden");
  document.getElementById("general").classList.add("active");
  tabs[0].classList.add("active");
  return { document, cache, tabs };
}
function makeClient(state) {
  function table(name) {
    state.tables.push(name);
    const q = new Proxy({}, {
      get(_, prop) {
        if (typeof prop === "symbol" || prop === "toJSON") return undefined;
        if (prop === "then") return (res, rej) => Promise.resolve(name === "subsell_configs" ? { data: [{ updated_at: state.stamp }], error: null } : { data: [], error: null, count: 0 }).then(res, rej);
        if (prop === "maybeSingle") return async () => (name === "subsell_configs" ? { data: { config: clone(state.config), config_key: "ck", updated_at: state.stamp }, error: null } : { data: null, error: null });
        return () => q;
      },
    });
    return q;
  }
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1", email: "owner@example" } } } }), onAuthStateChange() {}, signInWithPassword: async () => ({}), signInWithOAuth: async () => ({}), signUp: async () => ({}), signOut: async () => ({}) },
    from: table,
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), upload: async () => ({ data: null, error: null }), remove: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
}
async function loadDash(hash) {
  const dom = makeDom();
  const state = { tables: [], replaced: null, stamp: "2026-10-21T12:00:00+00:00",
    config: { apiKey: "sk-real", model: "claude-haiku-4-5", businessInfo: "INFO", instructions: "TONE", examples: "", priceList: "",
      videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "", businessHoursEnabled: false, coaching: [] } };
  const listeners = {};
  const store = new Map();
  const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  global.document = dom.document;
  global.window = { addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }, open() {},
    SUBSELL_SUPABASE_URL: "https://example.supabase.co", SUBSELL_SUPABASE_ANON_KEY: "anon",
    location: { href: "https://example.test/docs/" + hash, hash, origin: "https://example.test" }, localStorage };
  global.localStorage = localStorage;
  global.location = global.window.location;
  global.history = { replaceState(a, b, url) { state.replaced = url; } };
  global.navigator = { userAgent: "node" };
  global.fetch = async () => ({ ok: true, text: async () => "", json: async () => ({}) });
  global.supabase = { createClient: () => makeClient(state) };
  global.alert = () => {};
  global.confirm = () => true;
  try { new Function(app)(); } catch (e) { console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message)); console.error((e && e.stack || "").split("\n").slice(0, 8).join("\n")); process.exit(1); }
  await sleep(250); // getSession → showApp → loadConfig → applyHashTab
  return { dom, state, listeners };
}
const totals = (d) => ((d.dom.cache.activityTotals || {}).textContent || ""); // "" until loadActivity ran (it writes "Loading…" first)
(async () => {
  let d = await loadDash("#business");
  ok(d.dom.cache.business.classList.contains("active") && !d.dom.cache.general.classList.contains("active"), "#business after the login shows the Business pane (the teaching page) and hides General");
  ok(d.dom.tabs[1].classList.contains("active") && !d.dom.tabs[0].classList.contains("active"), "…and the tab strip follows");
  ok(totals(d) === "", "#business does not load the Activity log");
  d = await loadDash("#activity");
  ok(d.dom.cache.activity.classList.contains("active") && totals(d) !== "", "#activity after the login shows the Activity pane and loads the log (totals: " + JSON.stringify(totals(d)) + ")");
  global.location.hash = "#videos";
  for (const fn of d.listeners.hashchange || []) fn();
  ok(d.dom.cache.videos.classList.contains("active") && !d.dom.cache.activity.classList.contains("active"), "a hash change while the page is open switches the tab");
  await d.dom.tabs[2].fire("click");
  ok(d.dom.cache.listings.classList.contains("active") && !d.dom.cache.videos.classList.contains("active") && d.state.replaced === "#listings", "a click on a tab writes the hash back (" + d.state.replaced + ")");
  d = await loadDash("");
  ok(d.dom.cache.general.classList.contains("active") && totals(d) === "", "no hash: General as before, nothing loaded for Activity");
  d = await loadDash("#nonsense");
  ok(d.dom.cache.general.classList.contains("active") && !d.dom.cache.nonsense, "an unknown hash is ignored");
  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
