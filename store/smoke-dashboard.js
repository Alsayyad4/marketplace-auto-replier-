/* Minimal DOM stub: runs docs/app.js's synchronous IIFE body to catch
 * ReferenceError / TDZ / null-element crashes before the operator's phone does. */
const fs = require("fs");
const path = "C:\\Users\\hovig\\projects\\marketplace-auto-replier\\docs\\app.js";
const src = fs.readFileSync(path, "utf8");

const listeners = {};
function mkEl(id) {
  const el = {
    id, value: "", textContent: "", innerHTML: "", checked: false, disabled: false,
    style: {}, dataset: {}, files: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return true; } },
    addEventListener(ev) { listeners[id + ":" + ev] = 1; },
    appendChild() {}, removeChild() {}, remove() {}, setAttribute() {}, getAttribute() { return ""; },
    querySelector() { return mkEl("q"); }, querySelectorAll() { return []; },
    focus() {}, click() {},
  };
  return el;
}
const cache = {};
const doc = {
  getElementById(id) { return (cache[id] = cache[id] || mkEl(id)); },
  querySelector() { return mkEl("qs"); },
  querySelectorAll() { return []; },
  createElement(t) { return mkEl("new-" + t); },
  addEventListener() {},
  body: mkEl("body"),
};
global.document = doc;
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
global.supabase = { createClient: () => ({ auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange() {}, signInWithPassword: async () => ({}), signOut: async () => ({}) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) };
global.alert = () => {};
global.confirm = () => true;
global.setTimeout = setTimeout;
global.clearTimeout = clearTimeout;

try {
  new Function(src)();
  const wired = Object.keys(listeners).length;
  console.log("docs/app.js IIFE ran clean — " + wired + " listeners wired");
  const want = ["save:click", "reload:click", "addRule:click", "teachPreviewBtn:click"];
  const missing = want.filter((k) => !listeners[k]);
  if (missing.length) { console.error("MISSING listeners: " + missing.join(", ")); process.exit(1); }
  console.log("all expected controls wired: " + want.join(", "));
} catch (e) {
  console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message));
  console.error((e && e.stack || "").split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}
