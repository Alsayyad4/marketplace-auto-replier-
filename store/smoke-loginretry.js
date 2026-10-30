/* Tests the Settings page's login that tries again by itself (options.js, v0.21.78).
 *
 * Why this file exists: a login refused by Supabase's per-address limit retries by
 * itself while the page stays open. The first draft started a countdown per answer
 * and replaced the handle: a double click left an orphan countdown that, once it
 * reached zero, logged in EVERY SECOND for ever (a review harness counted 273 logins
 * in 4 minutes) — the very storm v0.21.78 exists to stop, driven by the owner's tab.
 *
 * Under test (the real options.js block, fake clock and timers):
 *   1. one click while limited: 1 + 6 tries over ~16.5 min, then it stops and says so;
 *   2. a double click: still one countdown at a time, at most one extra login;
 *   3. Log in pressed while a retry's answer is on its way: still one countdown;
 *   4. once a try gets in, nothing more is sent;
 *   5. typing in the boxes stops the countdown and replaces its text;
 *   6. Log out: "Cancel" keeps the countdown, OK stops it;
 *   7. a wrong password, or an empty password box, never starts a countdown.
 *
 * Run:  node store/smoke-loginretry.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8");
const from = src.indexOf("  // (v0.21.78) A login refused by Supabase's per-address limit");
const to = src.indexOf("  if ($(\"cloudPull\")) {");
if (from < 0 || to < 0 || to < from) { console.error("login block not found in options.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
let finished = false;
process.on("exit", () => { if (!finished) { console.log("  FAIL  the test never reached its end"); process.exitCode = 1; } });

function page(opts) {
  opts = opts || {};
  let now = 0, timers = [], nextId = 1;
  const add = (fn, ms, every) => { const id = nextId++; timers.push({ id, fn, ms, at: now + ms, every }); return id; };
  const clear = (id) => { timers = timers.filter((t) => t.id !== id); };
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at || a.id - b.id);
      const t = timers.find((x) => x.at <= end);
      if (!t) break;
      now = t.at;
      if (t.every) t.at += t.ms; else timers = timers.filter((x) => x !== t);
      t.fn();
    }
    now = end;
  }
  const els = {};
  const $ = (id) => (els[id] = els[id] || { id, value: "", textContent: "", listeners: {}, addEventListener(ev, f) { (this.listeners[ev] = this.listeners[ev] || []).push(f); } });
  $("cloudEmail").value = "op@example.com";
  $("cloudPassword").value = opts.password == null ? "pw" : opts.password;
  ["cloudMsg", "cloudLogin", "cloudLogout"].forEach($);
  const st = { logins: 0, logouts: 0, okAt: Infinity, answer: opts.answer || null, confirm: true };
  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(msg, cb) {
        if (msg.type === "CLOUD_LOGIN") {
          st.logins++;
          const at = now;
          // the background answers ~300 ms later
          add(() => cb(st.answer ? st.answer(msg) : at >= st.okAt ? { ok: true, pull: { unchanged: true } } : { ok: false, error: "Request rate limit reached", limited: true }), 300, false);
        } else if (msg.type === "CLOUD_LOGOUT") { st.logouts++; add(() => cb({ ok: true }), 50, false); }
      },
    },
  };
  const window = { confirm: () => st.confirm };
  new Function("$", "chrome", "persistCloudCreds", "refreshCloudStatus", "load", "setInterval", "clearInterval", "setTimeout", "window", block)(
    $, chrome, (cb) => cb(), () => {}, () => {}, (fn, ms) => add(fn, ms, true), clear, (fn, ms) => add(fn, ms, false), window
  );
  const fire = (id, ev) => (els[id].listeners[ev] || []).forEach((f) => f());
  return {
    st, els, advance, live: () => timers.filter((t) => t.every).length, now: () => now,
    click: () => fire("cloudLogin", "click"), logout: () => fire("cloudLogout", "click"),
    type: (id) => fire(id, "input"), msg: () => els.cloudMsg.textContent,
  };
}

/* 1 — one click while the address is limited */
let p = page();
p.click();
p.advance(1000);
ok(/^Not in yet — Supabase is limiting logins .* your password is fine\. Trying again by itself in 1:00 — keep this page open\./.test(p.msg()), "a limited answer says so, with the countdown — " + p.msg().slice(0, 80) + "…");
let maxLive = 0;
for (let t = 0; t < 20 * 60; t += 1) { p.advance(1000); maxLive = Math.max(maxLive, p.live()); }
ok(p.st.logins === 7, "one click: 1 + 6 tries in 20 min, no more — " + p.st.logins);
ok(maxLive <= 1 && p.live() === 0, "never more than one countdown, none left at the end — max " + maxLive);
ok(/^Login failed: Request rate limit reached — Supabase is still limiting logins/.test(p.msg()), "after the last try it stops and says so");

/* 2 — a double click */
p = page();
p.click(); p.click();
maxLive = 0;
for (let t = 0; t < 20 * 60; t += 1) { p.advance(1000); maxLive = Math.max(maxLive, p.live()); }
ok(maxLive <= 1, "a double click still runs ONE countdown — max live " + maxLive);
ok(p.st.logins <= 8, "a double click costs at most one extra login over the whole run — " + p.st.logins + " (the first draft: hundreds)");

/* 3 — Log in pressed while a retry's answer is on its way */
p = page();
p.click();
p.advance(60 * 1000 + 100); // the first retry has just been sent, its answer is 300 ms out
p.click();
maxLive = 0;
for (let t = 0; t < 20 * 60; t += 1) { p.advance(1000); maxLive = Math.max(maxLive, p.live()); }
ok(maxLive <= 1 && p.st.logins <= 9, "Log in during a retry: one countdown, a bounded number of tries — " + p.st.logins);

/* 4 — once a try gets in, nothing more is sent */
p = page();
p.click(); p.click();
p.advance(2 * 60 * 1000);
p.st.okAt = p.now();
p.advance(4 * 60 * 1000);
const afterOk = p.st.logins;
p.advance(10 * 60 * 1000);
ok(/^Logged in ✓/.test(p.msg()) && p.st.logins === afterOk && p.live() === 0, "logged in: no more tries, no countdown — " + p.msg());

/* 5 — typing in the boxes stops the countdown and says so */
p = page();
p.click();
p.advance(5000);
p.type("cloudPassword");
const typed = p.st.logins;
p.advance(10 * 60 * 1000);
ok(p.st.logins === typed && p.live() === 0 && /^Stopped trying by itself/.test(p.msg()), "typing stops the countdown and replaces its text — " + p.msg());

/* 6 — Log out: Cancel keeps the countdown, OK stops it */
p = page();
p.click();
p.advance(5000);
p.st.confirm = false;
p.logout();
p.advance(60 * 1000);
ok(p.st.logouts === 0 && p.st.logins === 2, "Cancel on Log out's question: no log out, and the countdown still tries — logins " + p.st.logins);
p.st.confirm = true;
p.logout();
const atLogout = p.st.logins;
p.advance(10 * 60 * 1000);
ok(p.st.logouts === 1 && p.st.logins === atLogout && p.live() === 0, "OK on it: logged out, the countdown is gone");

/* 7 — a wrong password, or an empty box, never starts a countdown */
p = page({ answer: () => ({ ok: false, error: "Invalid login credentials" }) });
p.click();
p.advance(10 * 60 * 1000);
ok(p.st.logins === 1 && p.live() === 0 && p.msg() === "Login failed: Invalid login credentials", "a wrong password: one try, the plain error — " + p.msg());
p = page({ password: "" });
p.click();
p.advance(10 * 60 * 1000);
ok(p.st.logins === 1 && p.live() === 0, "an empty password box never retries by itself");

finished = true;
console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
