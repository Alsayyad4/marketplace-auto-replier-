/* Tests the STICKY USER ACTIVATION ladder (background.js cdpEnsureActivation, v0.21.67).
 *
 * Why this file exists: the ladder is an OPT-IN experiment (local
 * videoActivationPulse:true) — activation is not a term of Chrome's media
 * deferral, the media gate in content.js is the fix. When it does run it must grant
 * the activation with the least possible touch and read it back after every step:
 *   already active → nothing is sent;
 *   F16 keydown (a key no page and no browser shortcut is bound to) → done;
 *   Shift → done;
 *   the composer click ONLY where the caller allows it (the PiP path);
 *   and it must say "none" honestly when nothing takes.
 *
 * Run:  node store/smoke-activation.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const start = src.indexOf("function pageUserActivation()");
const end = src.indexOf("\n// Telemetry for the 🩺 fileapi line", start);
if (start < 0 || end < 0) { console.error("activation block not found in background.js"); process.exit(1); }
const block = src.slice(start, end);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

function world(opts) {
  // opts.grants: which step flips the page's activation ("f16" | "shift" | "click" | null)
  // opts.readback: false ⇒ pageEval returns null (no navigator.userActivation)
  const st = { been: !!opts.already, keys: [], clicks: 0 };
  const cdpCmd = async (target, method, params) => {
    if (method === "Input.dispatchKeyEvent") {
      st.keys.push(params);
      if (params.type === "keyDown" && ((opts.grants === "f16" && params.key === "F16") || (opts.grants === "shift" && params.key === "Shift"))) st.been = true;
    }
    return {};
  };
  const pageEval = async (target, fn) => (opts.readback === false ? null : fn());
  const cdpActivationPulse = async () => { st.clicks++; if (opts.grants === "click") st.been = true; return true; };
  const navigator = { get userActivation() { return { hasBeenActive: st.been, isActive: false }; } };
  const chrome = { storage: { local: { get: (k, cb) => cb({}) } }, runtime: {} };
  const fn = new Function("cdpCmd", "pageEval", "cdpActivationPulse", "navigator", "chrome", block + "; return cdpEnsureActivation;")(cdpCmd, pageEval, cdpActivationPulse, navigator, chrome);
  return { st, run: (allowClick) => fn({ tabId: 1 }, !!allowClick) };
}

(async () => {
  // 1. already active: nothing is sent
  let w = world({ already: true });
  let r = await w.run(false);
  ok(r.ok && r.how === "already" && r.before === true, "an already-activated page gets no input at all");
  ok(w.st.keys.length === 0 && w.st.clicks === 0, "…no key, no click");

  // 2. F16 grants: one keydown/keyup pair, no Shift, no click
  w = world({ grants: "f16" });
  r = await w.run(false);
  ok(r.ok && r.how === "f16", "F16 keydown grants the activation (how=" + r.how + ")");
  ok(w.st.keys.length === 2 && w.st.keys[0].type === "keyDown" && w.st.keys[0].key === "F16" && w.st.keys[0].windowsVirtualKeyCode === 127 && w.st.keys[1].type === "keyUp", "exactly one F16 keyDown/keyUp pair, VK 127");
  ok(w.st.clicks === 0, "the composer is never clicked when a key took");

  // 3. Shift grants after F16 did not
  w = world({ grants: "shift" });
  r = await w.run(false);
  ok(r.ok && r.how === "shift", "Shift is the second rung (how=" + r.how + ")");
  ok(w.st.keys.length === 4 && w.st.keys[2].key === "Shift" && w.st.keys[2].modifiers === 8, "F16 pair then a Shift pair with the shift modifier bit");
  ok(w.st.clicks === 0, "still no click");

  // 4. keys do not grant, click NOT allowed (the default for every attach channel): honest "none", no click
  w = world({ grants: "click" });
  r = await w.run(false);
  ok(r.ok === false && r.how === "none" && r.keysFailed === true, "without allowClick the ladder ends after the keys (how=" + r.how + ")");
  ok(w.st.keys.length === 4 && w.st.clicks === 0, "…both keys tried, the composer never clicked");

  // 5. click allowed (the PiP path): the click is the last rung
  w = world({ grants: "click" });
  r = await w.run(true);
  ok(r.ok && r.how === "click" && r.keysFailed === true, "with allowClick the composer click is the last rung and it is marked keysFailed");
  ok(w.st.keys.length === 4 && w.st.clicks === 1, "both keys tried first, then exactly one click");

  // 6. nothing grants even with the click: honest failure
  w = world({ grants: null });
  r = await w.run(true);
  ok(r.ok === false && r.how === "none" && /no trusted input/.test(r.error || ""), "when nothing takes the result is ok:false / how:none");
  ok(w.st.keys.length === 4 && w.st.clicks === 1, "…after every rung was tried once");

  // 7. no read-back available (old Chrome): the click is reported as delivered, unverified
  w = world({ grants: null, readback: false });
  r = await w.run(true);
  ok(r.ok && r.how === "click?", "without navigator.userActivation the click is reported as 'click?'");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
