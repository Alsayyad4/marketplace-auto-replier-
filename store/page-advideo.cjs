// Drives the REAL dashboard page (docs/index.html + docs/app.js + ../background.js) in a real headless
// browser, with supabase-js replaced by page-advideo-stub.js: the video-per-ad section, end to end (v0.21.96).
// Needs Playwright (taken from the subsell-pos checkout, like store/boot-store.mjs). Run:  node store/page-advideo.cjs
const { chromium } = require("C:/Users/hovig/projects/subsell-pos/node_modules/playwright");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const root = path.resolve(__dirname, "..");
const A = __dirname;
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".png": "image/png", ".json": "application/json" };
let failed = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) failed++; };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(String(req.url).split("?")[0]);
  const f = path.resolve(root, "." + u);
  if (!f.startsWith(root)) { res.writeHead(403); res.end(); return; }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); res.end("not found"); return; } res.writeHead(200, { "content-type": MIME[path.extname(f)] || "application/octet-stream" }); res.end(buf); });
});
(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1500 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("dialog", (d) => d.accept());
  const stub = fs.readFileSync(path.join(A, "page-advideo-stub.js"), "utf8");
  const seedConfig = { apiKey: "sk-test", model: "claude-haiku-4-5", businessInfo: "Shop.", demoVideoUrls: [{ name: "iphones.mp4", url: "https://example.supabase.co/storage/v1/object/public/subsell-videos/u1/1-iphones.mp4", size: 4200000 }], videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "", businessHoursEnabled: false };
  const feed = [
    { created_at: "2026-11-12T10:00:00Z", machine: "Front desk · v0.21.96 #PC-abc12", kind: "text", thread_id: "1", thread_name: "Jimmy · MacBook Air M2 13 pouces 900$", buyer_text: "dispo?", bot_text: "oui" },
    { created_at: "2026-11-12T09:00:00Z", machine: "PC-zzz99 · v0.21.95", kind: "text", thread_id: "2", thread_name: "Amel · iPhone 13 Pro Max 256 Go · 2h", buyer_text: "prix?", bot_text: "à partir de" },
    { created_at: "2026-11-11T09:00:00Z", machine: "Front desk · v0.21.96 #PC-abc12", kind: "text", thread_id: "3", thread_name: "Paul · MacBook Pro 14 M3", buyer_text: "allo", bot_text: "allo" },
    { created_at: "2026-11-10T09:00:00Z", machine: "PC-zzz99 · v0.21.95", kind: "text", thread_id: "4", thread_name: "Zed · iPhone 13 Pro, 128 Go, débloqué 650$", buyer_text: "dispo?", bot_text: "oui" },
  ];
  await page.route("**/supabase-js@2*", (route) => route.fulfill({ contentType: "text/javascript", body: "window.__seedConfig = " + JSON.stringify(seedConfig) + "; window.__seedFeed = " + JSON.stringify(feed) + ";\n" + stub }));
  await page.goto("http://127.0.0.1:" + port + "/docs/index.html#videos");
  await page.waitForSelector("#adSets", { state: "attached" });
  await page.waitForTimeout(1800);
  const st = () => page.evaluate(() => JSON.parse(JSON.stringify({ cfg: window.__state.row.config, writes: window.__state.writes, uploads: window.__state.uploads })));
  const box = () => page.textContent("#adSets");
  const card = () => page.locator("#adSets > div").first();
  let s = await st();
  ok(await page.isVisible("#addAdSet") && /No video for a specific ad yet/.test(await box()), "the Videos tab shows the section, empty: every ad gets the general video");
  ok(/1\. iphones\.mp4/.test(await page.textContent("#demoVideoList")), "the general list is drawn as before");
  const w0 = s.writes;
  await page.click("#addAdSet");
  await page.waitForTimeout(600);
  const opts = await card().locator("select option").allTextContents();
  ok(opts.length === 5 && /MacBook Air M2 13 pouces \(1 · Front desk\)/.test(opts.join("|")) && /iPhone 13 Pro Max 256 Go \(1 · PC-zzz99\)/.test(opts.join("|")), "a new set lists the ads the bots answered, each with its computer: " + opts.slice(1).join(" | "));
  ok(/Not active yet: type the words/.test(await box()), "…and says it is not active yet");
  await card().locator("select").selectOption("MacBook Air M2 13 pouces");
  await page.waitForTimeout(700);
  s = await st();
  ok(s.writes > w0 && Array.isArray(s.cfg.adVideoSets) && s.cfg.adVideoSets.length === 1 && s.cfg.adVideoSets[0].ads === "MacBook Air M2 13 pouces" && /^s[a-z0-9]+$/.test(s.cfg.adVideoSets[0].id), "picking an ad fills the words and saves the set by itself: " + JSON.stringify(s.cfg.adVideoSets));
  ok(/Not active yet: add a video/.test(await box()) && (await card().locator('input[type="text"]').inputValue()) === "MacBook Air M2 13 pouces", "the card shows the words and asks for a video");
  const tmp = path.join(os.tmpdir(), "macbook-demo.mp4");
  fs.writeFileSync(tmp, Buffer.alloc(300000, 1));
  await card().locator('input[type="file"]').setInputFiles(tmp);
  await page.waitForTimeout(900);
  s = await st();
  const c0 = (s.cfg.adVideoSets[0].clips || [])[0] || {};
  ok(s.uploads.length === 1 && /^u1\/\d+-macbook-demo\.mp4$/.test(s.uploads[0].path) && c0.name === "macbook-demo.mp4" && c0.size === 300000 && /subsell-videos\/u1\/\d+-macbook-demo\.mp4$/.test(c0.url), "a video uploaded into the set lands in the owner's own folder and saves: " + JSON.stringify(c0));
  ok(/Active\. Of the ads answered in the last 5 days it gets: MacBook Air M2 13 pouces\./.test(await box()), "the card says it is active and which answered ad it gets (the bots' own rule): " + ((await box()).match(/Active\.[^.]*\./) || [""])[0]);
  ok(/Uploaded ✓ — saved/.test(await page.textContent("#adSetStatus")), "the set's own status line reports the save: " + (await page.textContent("#adSetStatus")));
  const words = card().locator('input[type="text"]');
  await words.fill("macbook air, macbook pro");
  await words.blur();
  await page.waitForTimeout(700);
  s = await st();
  ok(s.cfg.adVideoSets[0].ads === "macbook air, macbook pro" && /it gets: MacBook Air M2 13 pouces \| MacBook Pro 14 M3\./.test(await box()), "words typed by hand, a comma = or: both MacBook ads now get it");
  ok(/PC-zzz99 \(v0\.21\.95: updates itself first\)/.test(await box()) && /Still on a version older than 0\.21\.96[^:]*: PC-zzz99 v0\.21\.95\./.test(await box()), "a computer on an older version is named");
  await card().locator("label.check", { hasText: "Front desk" }).locator("input").check();
  await page.waitForTimeout(700);
  s = await st();
  ok(JSON.stringify(s.cfg.adVideoSets[0].pcs) === '["pc-abc12"]', "ticking a computer keeps the set to it: " + JSON.stringify(s.cfg.adVideoSets[0].pcs));
  ok(s.cfg.demoVideoUrls.length === 1 && s.cfg.demoVideoUrls[0].name === "iphones.mp4" && s.cfg.apiKey === "sk-test" && s.cfg.businessInfo === "Shop.", "nothing else in the account's row moved");
  await page.locator("#videos").screenshot({ path: path.join(os.tmpdir(), "videos-tab-advideo.png") });
  await card().locator("label.check", { hasText: "Front desk" }).locator("input").uncheck();
  await page.waitForTimeout(700);
  s = await st();
  ok(Array.isArray(s.cfg.adVideoSets[0].pcs) && s.cfg.adVideoSets[0].pcs.length === 0, "none ticked = every computer again");
  // a second set: an ad whose title holds commas is picked as ONE alternative; words no title is read by are reported
  await page.click("#addAdSet");
  await page.waitForTimeout(500);
  const card2 = () => page.locator("#adSets > div").nth(1);
  await card2().locator("select").selectOption("iPhone 13 Pro, 128 Go, débloqué");
  await page.waitForTimeout(700);
  s = await st();
  ok(s.cfg.adVideoSets.length === 2 && s.cfg.adVideoSets[1].ads === "iPhone 13 Pro 128 Go débloqué", "an ad whose title holds commas is picked as ONE alternative: " + JSON.stringify((s.cfg.adVideoSets[1] || {}).ads));
  await card2().locator('input[type="file"]').setInputFiles(tmp);
  await page.waitForTimeout(900);
  ok(/Active\. Of the ads answered in the last 5 days it gets: iPhone 13 Pro, 128 Go, débloqué\./.test(await card2().textContent()), "…and it gets that ad only: " + (((await card2().textContent()).match(/Active\.[^|]*\./) || [""])[0]).slice(0, 110));
  const w2 = card2().locator('input[type="text"]');
  await w2.fill("liquidation 300$");
  await w2.blur();
  await page.waitForTimeout(700);
  ok(/Not active: these words hold nothing an ad's title is read by/.test(await card2().textContent()), "words that no title is read by (a price, an advert word) are reported on the card, not silently dead");
  await card2().locator("button", { hasText: "Remove this set" }).click();
  await page.waitForTimeout(700);
  // "not every listing I will put a video": with the general video removed, only the ads that have a set get one
  await page.locator("#demoVideoList button", { hasText: "Remove" }).click();
  await page.waitForTimeout(700);
  s = await st();
  ok(s.cfg.demoVideoUrls.length === 0 && s.cfg.adVideoSets.length === 1 && /No general video: only the ads that have their own video below get one/.test(await page.textContent("#demoVideoList")), "the general video removed, a set kept: the page says only the ads with their own video get one");
  await card().locator("button", { hasText: "Remove this set" }).click();
  await page.waitForTimeout(700);
  s = await st();
  ok(Array.isArray(s.cfg.adVideoSets) && s.cfg.adVideoSets.length === 0 && /No video for a specific ad yet/.test(await box()), "removing the set (after a confirm) saves, and every ad is back on the general video");
  ok(errors.length === 0, "no page error, no console error" + (errors.length ? ": " + errors.slice(0, 4).join(" ; ") : ""));
  await browser.close();
  server.close();
  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed — the dashboard's video-per-ad section");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("driver threw:", e && e.message); process.exit(1); });
