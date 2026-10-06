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
  // (v0.21.69) machines stuck on .47-.51 read videoLinkFallback from this row and
  // send the demo as a raw LINK unless it is exactly false — a save here must never re-arm them.
  ok(/^\s*videoLinkFallback:\s*false,/m.test(src) && !/^\s*videoLinkFallback:\s*true,/m.test(src),
     "dashboard DEFAULTS ship videoLinkFallback: false (the stale builds' link gate)");
  ok(/delete clean\.enabled;[^\n]*\n\s*Object\.assign\(clean, LEGACY_LINK_OFF, LEGACY_GATE_OFF\)/.test(src),
     "saveConfig clamps the four legacy link keys off on every write (and, since v0.21.75, the old reply-hours gate)");
  ok(/if \(legacyLinkArmed\(data\.config \|\| \{\}\) \|\| legacyGateArmed\(data\.config \|\| \{\}\)\) \{\s*\n\s*const saved = await saveConfig\(true, SYSTEM_SAVE\)/.test(src) &&
     /function legacyLinkArmed\(cfg\)/.test(src) && /videoLinkFallback !== false \|\| cfg\.videoLinkOptIn === true/.test(src),
     "loadConfig disarms an armed row the moment the page opens (quiet save), with the same test as background.js");

  // (v0.21.70) A refused save must never dead-end. The safety-net trigger's RLS error
  // ("new row violates row-level security policy for table subsell_config_history")
  // gets a human sentence plus the one-paste cure, and the typed teaching is kept.
  ok(/function isHistoryRlsError\(error\)/.test(src) && /subsell_config_history/.test(src) && /row-level security/.test(src),
     "the history-table RLS error is recognised by name");
  ok(/if \(!system\) keepTypedDraft\(\);[^\n]*\n\s*const why = explainSaveError\(error\);/.test(src),
     "a refused save keeps the typed teaching (draft) BEFORE reporting — unless it is a load-time SYSTEM save");
  ok(/if \(isHistoryRlsError\(error\)\) showFixBanner\(error\);/.test(src),
     "the safety-net error shows the fix banner (copy the SQL, open the SQL editor)");
  ok(/if \(!system && !draftOffered\) clearDraft\(\);[^\n]*\n\s*hideFixBanner\(\);/.test(src),
     "a landed save clears the draft and the fix banner — never a SYSTEM save, never while an offer is on screen");
  ok(/const DRAFT_FIELDS = \[[^\]]*\]/.test(src) && !/const DRAFT_FIELDS = \[[^\]]*apiKey/.test(src),
     "the draft never holds the API key");
  ok(/\} finally \{\s*\n\s*offerDraft\(\);/.test(src) && src.indexOf("offerDraft();") > src.indexOf("legacyLinkArmed(data.config || {})) {"),
     "loadConfig offers the draft back LAST (finally), after the seed / legacy-link load-time saves");
  ok(/accountIsDead\(data\.config \|\| \{\}\) && window\.SUBSELL_SEED\) \{[\s\S]{0,200}saveConfig\(true, SYSTEM_SAVE\)/.test(src) &&
     /legacyGateArmed\(data\.config \|\| \{\}\)\) \{\s*\n\s*const saved = await saveConfig\(true, SYSTEM_SAVE\)/.test(src) &&
     /autoPending = false; await saveConfig\(true\);/.test(src),
     "the seed and legacy-link load-time saves are SYSTEM saves; the keystroke auto-save stays a normal quiet save (runtime proof: store/smoke-draft.js)");
  ok(/id="draftBanner"[^>]*class="hint hidden"/.test(html), "the draft offer has its own element, so the fix banner cannot replace it");
  ok(/if \(!sql\) \{[\s\S]{0,400}return;\s*\}/.test(src) && !/window\.open\(SQL_FIX_URLS/.test(src),
     "'Copy the fix' never opens or hands over a file that failed the security-definer check");
  ok(/app\.js\?v=20261006/.test(html), "app.js cache-buster bumped for this release");
  // (v0.21.72) the video list saves itself; the clip-ledger switch is bound; sizes are shown
  ok(/await saveVideoList\("Uploaded", url\);/.test(src) && /await saveVideoList\("Removed"\);/.test(src), "uploading or removing a video saves the list at once");
  ok(/id="videoCompleteSet"/.test(html) && /\["videoCompleteSet", "checked"\]/.test(src) && /videoCompleteSet: true,/.test(src), "the 'every video, exactly once' switch is in the markup, bound, and defaults ON");
  ok(/HEAVY_CLIP_BYTES = 8 \* 1024 \* 1024/.test(src) && /function sameClip|const sameClip/.test(src), "each clip shows its size, heavy clips and repeated files are flagged");
  // (v0.21.71) the two new General-tab fields exist in both the markup and the bindings, and claim rows never reach the feed
  ok(/id="typingPaceMaxSec"/.test(html) && /id="threadMemory"/.test(html), "typing pace + chat memory controls are in the dashboard markup");
  ok(/\["typingPaceMaxSec", "number"\], \["threadMemory", "checked"\]/.test(src) && /typingPaceMaxSec: 20,/.test(src) && /threadMemory: true,/.test(src), "…and bound in FIELDS with the extension's defaults");
  ok(/const HIDDEN_KINDS = \["claim", "teach", "gap", "usage"\];/.test(src) && (src.match(/messagesOnly\(client/g) || []).length >= 4, "Activity feed, both counts and the fleet line skip the computers' bookkeeping rows (claim, teach, gap, usage)");
  ok(/config-safety\.sql/.test(src) && /\/sql\/new/.test(src), "the banner points at config-safety.sql and the project's SQL editor");
  ok(/d\.user !== session\.user\.id\) return;/.test(src), "a draft from another account is never offered");
  ok(/id="fixBanner"[^>]*class="hint hidden"/.test(html), "the fix banner starts hidden in the markup");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
