/* Dashboard guard tests — docs/app.js has no build step and no framework, so a
 * mistake in it surfaces on the operator's phone, mid-edit, with their business
 * teaching on the line. This runs the real file against a stubbed DOM and asserts:
 *   1. the IIFE evaluates cleanly and every control is wired;
 *   2. SAVING IS IMPOSSIBLE BEFORE THE CONFIG ROW HAS BEEN READ. `settings` starts
 *      as pristine DEFAULTS, so a save in that window would overwrite the whole
 *      fleet's configuration with empty values — live on every machine within a
 *      minute, no confirmation, no undo. This is the test that matters.
 * Run:  node store/smoke-dashboard.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");

const handlers = {};
function mkEl(id) {
  return {
    id, value: "", textContent: "", innerHTML: "", checked: false, disabled: false,
    style: {}, dataset: {}, files: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    addEventListener(ev, fn) { (handlers[id + ":" + ev] = handlers[id + ":" + ev] || []).push(fn); },
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return ""; },
    querySelector() { return mkEl("q"); }, querySelectorAll() { return []; },
    focus() {}, click() {},
  };
}
const cache = {};
global.document = {
  getElementById(id) { return (cache[id] = cache[id] || mkEl(id)); },
  querySelector() { return mkEl("qs"); },
  querySelectorAll() { return []; },
  createElement(t) { return mkEl("new-" + t); },
  addEventListener() {},
  body: mkEl("body"),
};

// Supabase stub that RECORDS every write, so we can prove none happened.
const writes = [];
function table() {
  const q = {
    select() { return q; }, eq() { return q; }, order() { return q; }, limit() { return q; },
    gte() { return q; }, maybeSingle: async () => ({ data: null }),
    update(payload) { writes.push(payload); return q; },
    insert(payload) { writes.push(payload); return q; },
    then(res) { return Promise.resolve({ data: [], error: null }).then(res); },
  };
  return q;
}
global.window = {
  addEventListener() {},
  SUBSELL_SUPABASE_URL: "https://example.supabase.co",
  SUBSELL_SUPABASE_ANON_KEY: "anon",
  location: { href: "https://example.test/", hash: "", origin: "https://example.test" },
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
};
global.localStorage = global.window.localStorage;
global.location = global.window.location;
global.navigator = { userAgent: "node" };
global.fetch = async () => ({ ok: true, json: async () => ({}) });
global.supabase = {
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null } }),
      onAuthStateChange() {}, signInWithPassword: async () => ({}), signOut: async () => ({}),
    },
    from: table,
  }),
};
global.alert = () => {};
global.confirm = () => true;

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

(async () => {
  try {
    new Function(src)();
  } catch (e) {
    console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message));
    console.error((e && e.stack || "").split("\n").slice(0, 6).join("\n"));
    process.exit(1);
  }
  console.log("docs/app.js evaluated cleanly");

  const want = ["save:click", "reload:click", "addRule:click", "teachPreviewBtn:click"];
  ok(want.every((k) => handlers[k] && handlers[k].length), "every control is wired (" + want.join(", ") + ")");

  // Read the markup itself — the stub does not parse HTML attributes.
  const html = fs.readFileSync(path.join(__dirname, "..", "docs", "index.html"), "utf8");
  ok(/id="save"[^>]*\sdisabled/.test(html),
     "Save starts DISABLED in the markup until the config row is read");
  ok(src.includes("rowLoaded = true") && src.includes('$("save").disabled = false'),
     "loadConfig is what re-enables Save");

  // The one that protects the operator's data: fire Save before any load.
  for (const fn of handlers["save:click"]) { try { await fn(); } catch (e) { /* guard may bail early */ } }
  await new Promise((r) => setTimeout(r, 30));
  ok(writes.length === 0,
     "saving BEFORE the row is loaded writes nothing (would otherwise wipe the fleet's config) — writes=" + writes.length);

  // And an auto-save queued in that same window must not fire either.
  const fieldFns = handlers["businessInfo:input"] || [];
  for (const fn of fieldFns) { try { await fn(); } catch (e) { /* ignore */ } }
  await new Promise((r) => setTimeout(r, 1500));
  ok(writes.length === 0, "auto-save before load writes nothing either — writes=" + writes.length);

  // The blank-textarea guard must be present in source (it protects the prompt text).
  ok(/EXT_DEFAULT_TEXT\[id\] && !el\.value\.trim\(\)/.test(src),
     "a blank businessInfo/instructions/closerGoals deletes the key instead of persisting \"\"");
  ok(/model: "claude-haiku-4-5"/.test(src),
     "dashboard model default matches the extension (no silent re-pin to a pricier model)");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
