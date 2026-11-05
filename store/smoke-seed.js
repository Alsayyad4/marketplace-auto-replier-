/* The starter setup exists in two places — SEED_CONFIG in background.js (the
 * extension seeds an empty account on login) and window.SUBSELL_SEED in
 * docs/seed.js (the dashboard does the same on load). Two copies drift; this
 * fails when they do, and checks the things that must never be in a seed.
 *
 * Run:  node store/smoke-seed.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const a = bg.indexOf("const SEED_CONFIG = {"), b = bg.indexOf("\n};", a) + 3;
ok(a > 0 && b > a, "SEED_CONFIG found in background.js");
const ext = new Function(bg.slice(a, b) + "; return SEED_CONFIG;")();

const seedSrc = fs.readFileSync(path.join(root, "docs", "seed.js"), "utf8");
const win = {};
new Function("window", seedSrc)(win);
const dash = win.SUBSELL_SEED;
ok(dash && typeof dash === "object", "window.SUBSELL_SEED found in docs/seed.js");

const canon = (o) => JSON.stringify(o, Object.keys(o).sort());
ok(JSON.stringify(ext) === JSON.stringify(dash) && canon(ext) === canon(dash),
   "docs/seed.js is byte-identical to background.js SEED_CONFIG (" + Object.keys(ext).length + " keys)");

for (const bad of ["apiKey", "enabled", "priceList", "listings", "coaching", "businessHoursStart", "businessHoursEnd"])
  ok(!(bad in ext), "the seed never carries " + bad);
ok(!/258-7895|4382587895|438-258/.test(JSON.stringify(ext)), "no phone number in the seed (the platform guard forbids writing one)");
ok(!/\b(repairs?|technicians?|diagnostics?|r[ée]paration)\b/i.test(JSON.stringify(ext)), "no banned ad wording in the seed");
ok(/9AM–9PM/.test(ext.businessHoursText) && /9 AM to 9 PM/.test(ext.businessInfo), "hours say 9 PM everywhere, never 10 PM / 22h");
ok(Array.isArray(ext.demoVideoUrls) && ext.demoVideoUrls.length === 2 && ext.demoVideoUrls.every((v) => /^https:\/\/tcqunihripihroseswgy\.supabase\.co\/storage\/v1\/object\/public\/subsell-videos\//.test(v.url)),
   "two demo clips, both from the public bucket");

// the dashboard actually wires the seed in
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
ok(/function accountIsDead\(/.test(app) && /window\.SUBSELL_SEED/.test(app) && /accountIsDead\(data\.config/.test(app),
   "docs/app.js seeds a dead account on load");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
ok(/<script src="seed\.js/.test(html) && html.indexOf('src="seed.js') < html.indexOf('src="app.js'), "index.html loads seed.js before app.js");

console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
