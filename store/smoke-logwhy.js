/* Tests the Options page's self-explaining EMPTY Activity log (v0.21.87).
 *
 * Why this file exists: Oct 19 2026 the owner opened Settings → Activity log on a
 * Web Store install and saw "0 entries. No activity logged yet." — and asked what was
 * broken. Nothing was: that list is this computer's own log (chrome.storage.local
 * `replyLog`, written on delivery), the store copy is a new extension id with a new
 * empty copy of it, and that computer had sent nothing. The page now says so, with
 * this computer's state (ON/OFF, cloud login, API key, Messenger tab, today's count)
 * and where every computer's activity is (the dashboard's Activity tab).
 *
 * Under test:
 *   1. the pure line builder, state by state (OFF, no login, no key, no tab, counted
 *      but not listed, a healthy computer, a login being waited out, no install date);
 *   2. the wiring: an empty log shows the box, a non-empty log hides it; GET_STATUS
 *      carries installTs + messengerTabs; the markup carries the box and the hint
 *      says THIS computer (the old "this account sent" is gone).
 *
 * Run:  node store/smoke-logwhy.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const opt = R("options.js"), optHtml = R("options.html"), bg = R("background.js");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

/* 1 — the pure builder, sliced from options.js */
const from = opt.indexOf("  function emptyLogLines(");
const to = opt.indexOf("  function explainEmptyLog(");
if (from < 0 || to < 0 || to < from) { console.error("emptyLogLines not found in options.js"); process.exit(1); }
const emptyLogLines = new Function(opt.slice(from, to) + "; return emptyLogLines;")();
const T0 = Date.parse("2026-10-19T08:36:00Z");
const base = { ok: true, installTs: T0 - 86400000, enabled: true, apiKeySet: true, messengerTabs: 1, budget: { day: 0 } };
const cloudOn = { ok: true, loggedIn: true, email: "op@example.com", holdLine: "" };
const text = (s, c) => emptyLogLines(Object.assign({}, base, s || {}), c === undefined ? cloudOn : c, T0).join("\n");

let t = text({});
ok(/^Nothing has been sent from this computer yet — this copy of SubSell was installed here on /.test(t), "healthy: opens with 'nothing sent yet' and the install date — " + t.split("\n")[0]);
ok(/Bot: ON ✓/.test(t) && /Cloud login: op@example\.com ✓/.test(t) && /API key: set ✓/.test(t) && /Messenger: 1 tab\(s\) open ✓/.test(t) && /Sent today from this computer: 0\./.test(t),
   "healthy: every line is a ✓ and today reads 0");
t = text({ enabled: false });
ok(/Bot: OFF — this computer answers nobody until you press "Turn ON" in the SubSell popup/.test(t), "OFF: names the popup's Turn ON");
t = text({}, { ok: true, loggedIn: false });
ok(/Cloud login: none — log in on the General tab/.test(t), "no login: points at the General tab");
t = text({}, { ok: true, loggedIn: true, email: "op@example.com", holdLine: "Supabase is limiting logins from this internet connection for a few minutes — next try 09:00, by itself" });
ok(/Cloud login: op@example\.com ✓ \(Supabase is limiting logins/.test(t), "a login being waited out shows the wait beside the ✓");
t = text({}, null);
ok(!/Cloud login/.test(t), "no answer from CLOUD_STATUS: the login line is left out, nothing else breaks");
t = text({ apiKeySet: false });
ok(/API key: missing — nothing can be answered without it/.test(t), "no key: says nothing can be answered");
t = text({ messengerTabs: 0 });
ok(/Messenger: no tab open — press "Open Marketplace" in the popup/.test(t), "no Messenger tab: names Open Marketplace");
t = text({ messengerTabs: -1 });
ok(!/Messenger:/.test(t), "tabs could not be counted: the line is left out");
t = text({ budget: { day: 3 } });
ok(/Counted today from this computer: 3 — but none listed here: the log was cleared, or press Refresh\./.test(t), "counted but not listed: the one case that is odd, said so");
t = text({ budget: null, dayCount: 2 });
ok(/Counted today from this computer: 2/.test(t), "an older popup field (dayCount) still gives the count");
t = text({ installTs: 0 });
ok(/^Nothing has been sent from this computer yet\.$/m.test(t), "no install date: the sentence closes without it");
ok(text({ enabled: false, apiKeySet: false, messengerTabs: 0 }, { ok: true, loggedIn: false }).split("\n").length === 6, "worst case: six lines, one per fact");

/* 2 — the wiring */
ok(/explainEmptyLog\(resp\.log\.length === 0\);/.test(opt), "loadLog explains an empty log and hides the box otherwise");
ok(/if \(!show\) \{ el\.style\.display = "none"; return; \}/.test(opt), "a non-empty log hides the box");
ok(/type: "GET_STATUS"/.test(opt.slice(from)) && /type: "CLOUD_STATUS"/.test(opt.slice(from)), "the box is built from GET_STATUS + CLOUD_STATUS");
ok(/a\.href = DASHBOARD_URL;/.test(opt) && /alsayyad4\.github\.io\/marketplace-auto-replier-\/docs\//.test(opt), "the box links to the dashboard");
ok(/id="logWhy"/.test(optHtml), "options.html carries the box");
ok(/sent from THIS computer by this copy of SubSell/.test(optHtml) && !/this account sent/.test(optHtml), "the hint says THIS computer; 'this account sent' is gone");
const gs = bg.slice(bg.indexOf('case "GET_STATUS"'), bg.indexOf('case "GET_DIAGNOSTIC"'));
ok(/const installTs = await getInstallTs\(\);/.test(gs) && /installTs,\n/.test(gs), "GET_STATUS answers with installTs");
ok(/chrome\.tabs\.query\(\{ url: \["https:\/\/\*\.messenger\.com\/\*", "https:\/\/www\.facebook\.com\/messages\/\*", "https:\/\/www\.facebook\.com\/marketplace\/\*"\] \}/.test(gs) && /messengerTabs,/.test(gs) && /lastError \? -1 :/.test(gs),
   "GET_STATUS counts the Messenger tabs (-1 when it cannot)");
const stripBegin = bg.indexOf("/* ===== STORE-STRIP:BEGIN");
ok(stripBegin > 0 && bg.indexOf('case "GET_STATUS"') < stripBegin, "GET_STATUS sits outside the store-strip block (the store build keeps it)");

console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
