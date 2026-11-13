// Drives the REAL page myads.html + myads.js (v0.21.97, "Videos for my ads") in a real headless
// browser. The worker is stood in for inside the page by the bots' OWN rules (the pure block sliced
// out of background.js: myAdsRows / myAdSetsPut / myAdWordsPut / myAdSetsDrop / myAdsWordsCheck's
// rule), and the video storage by this file's own HTTP server, so the upload request the page really
// sends is read: its path, its headers, its bytes. The videos are REAL ones, recorded in this same
// browser (a canvas through MediaRecorder): the page tries each file on the browser before it uploads.
// Needs Playwright (taken from the subsell-pos checkout, like store/page-advideo.cjs).
// Run:  node store/page-myads.cjs
const { chromium } = require("C:/Users/hovig/projects/subsell-pos/node_modules/playwright");
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os");
const root = path.resolve(__dirname, "..");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
let failed = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) failed++; };
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
function between(src, a, b) { const s = src.indexOf(a); const e = src.indexOf(b, s + a.length); if (s < 0 || e < 0) throw new Error("slice not found: " + a); return src.slice(s, e); }
const pure = between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "\nfunction buildOwnerPrompt(");
const mb = (n) => (n / 1048576).toFixed(1) + " MB";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const uploads = []; // every upload request the page really sent
const srv = { failNext: 0 };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(String(req.url).split("?")[0]);
  if (req.method === "POST" && u.indexOf("/storage/v1/object/") === 0) {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (srv.failNext > 0) { srv.failNext--; res.writeHead(413, { "content-type": "application/json" }); res.end(JSON.stringify({ statusCode: "413", error: "Payload too large", message: "The object exceeded the maximum allowed size" })); return; }
      uploads.push({ path: u, apikey: req.headers.apikey, auth: req.headers.authorization, type: req.headers["content-type"], upsert: req.headers["x-upsert"], bytes: body.length, first: body[0] });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ Key: u.replace("/storage/v1/object/", "") }));
    });
    return;
  }
  const f = path.resolve(root, "." + u);
  if (!f.startsWith(root) || !/^\/myads\.(html|js)$/.test(u)) { res.writeHead(404); res.end("not found"); return; }
  fs.readFile(f, (err, buf) => { if (err) { res.writeHead(404); res.end("not found"); return; } res.writeHead(200, { "content-type": MIME[path.extname(f)] }); res.end(buf); });
});

// The stand-in for the worker, run inside the page before myads.js: the same answers the real
// MYADS_* messages give, computed by the real rules on a config the test can read back.
function initScript(seed) {
  return "(() => {\n" +
    "const B = (function (DEFAULTS) {\n" + pure + "\nreturn { myAdsRows, myAdSetsPut, myAdWordsPut, myAdSetsDrop };\n})({});\n" +
    "const S = window.__fake = Object.assign({ msgs: [], n: 0, failSave: 0, slowPull: 0, tabs: [], options: 0, localClips: 0 }, " + JSON.stringify(seed) + ");\n" +
    "const ME = 'PC-abc12';\n" +
    "const state = () => Object.assign({ ok: true, version: '0.21.97', machine: ME, label: S.label, messengerTabs: S.messengerTabs, inboxRead: S.messengerTabs > 0, canSave: S.canSave, loggedIn: S.loggedIn, needLogin: S.needLogin, why: S.why, localClips: S.localClips }, B.myAdsRows(S.cfg, ME, S.seen, S.open, Date.now()));\n" +
    "const write = (res) => { if (!res.ok) return res; S.cfg.adVideoSets = res.list; const out = { ok: true, set: res.set ? res.set.id : '', pulled: true }; if (S.slowPull > 0) { S.slowPull--; out.pulled = false; } return out; };\n" +
    "const answer = (msg) => {\n" +
    "  if (msg.type === 'MYADS_LIST') return state();\n" +
    "  if (msg.type === 'MYADS_CHECK') { const r = B.myAdWordsPut([], ME, msg.words, { url: 'x' }, 'c'); return r.ok ? { ok: true } : { ok: false, error: r.error }; }\n" +
    "  if (msg.type === 'MYADS_TICKET') return S.canSave ? { ok: true, url: location.origin, key: 'anon', token: 'tok', userId: 'uid', bucket: 'subsell-videos' } : { ok: false, login: true, error: 'this Chrome is not logged in to the account' };\n" +
    "  if (S.failSave > 0 && msg.type !== 'MYADS_DROP') { S.failSave--; return { ok: false, error: 'the account did not answer (HTTP 503)' }; }\n" +
    "  const pre = location.origin + '/storage/v1/object/public/subsell-videos/';\n" +
    "  if (msg.clip && String(msg.clip.url).indexOf(pre) !== 0) return { ok: false, error: 'that video is not in the account\\'s video storage' };\n" +
    "  if (msg.type === 'MYADS_PUT') return write(B.myAdSetsPut(S.cfg.adVideoSets, ME, msg.item, msg.clip, 'm' + (++S.n)));\n" +
    "  if (msg.type === 'MYADS_WORDS') return write(B.myAdWordsPut(S.cfg.adVideoSets, ME, msg.words, msg.clip, 'w' + (++S.n)));\n" +
    "  if (msg.type === 'MYADS_DROP') return write(B.myAdSetsDrop(S.cfg.adVideoSets, ME, msg.setId));\n" +
    "  return null;\n" +
    "};\n" +
    "window.chrome = { runtime: { id: 'x', lastError: null, sendMessage: (msg, cb) => { S.msgs.push(JSON.parse(JSON.stringify(msg))); setTimeout(() => cb(answer(msg)), 15); }, openOptionsPage: () => { S.options++; }, getURL: (p) => p, onMessage: { addListener: (fn) => { window.__workerAsks = (msg) => { let got = null; fn(msg, {}, (r) => { got = r; }); return got; }; } } }, tabs: { create: (o) => { S.tabs.push(o); } }, storage: { local: { set: (o, cb) => { if (o && typeof o.machineLabel === 'string') S.label = o.machineLabel; if (cb) setTimeout(cb, 5); } } } };\n" +
    "})();";
}
const X = "https://x.supabase.co/storage/v1/object/public/subsell-videos/uid/";
const baseSeed = () => ({
  label: "Front desk", canSave: true, loggedIn: true, needLogin: false, why: "", messengerTabs: 1, open: "Paul · MacBook Air M2",
  cfg: { videoWhen: "asked", demoVideoUrls: [{ name: "general.mp4", url: X + "1-general.mp4", size: 4000000 }], adVideoSets: [{ id: "mac", ads: "macbook", pcs: [], clips: [{ name: "macbook.mp4", url: X + "2-macbook.mp4", size: 5000000 }] }] },
  seen: [
    { label: "Jimmy · iPhone 13 Pro 256 Go 650$", id: "t1", at: Date.now() - 3600e3, inbox: -1 },
    { label: "Amel · iPhone 13 Pro Max 256 Go", id: "t2", at: Date.now() - 7200e3, inbox: -1 },
    { label: "Paul · MacBook Air M2 · 2h", id: "t3", at: 0, inbox: 0 },
    { label: "Marie Tremblay", id: "t4", at: Date.now(), inbox: 1 },
  ],
});

(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const open = async (seed) => {
    const page = await browser.newPage({ viewport: { width: 900, height: 1300 } });
    page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/413|MEDIA_ELEMENT_ERROR|DEMUXER|Failed to load resource/i.test(m.text())) errors.push("console: " + m.text()); });
    page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("  Shop PC 2 ") : d.accept()));
    await page.addInitScript({ content: initScript(seed) });
    await page.goto(origin + "/myads.html");
    await page.waitForFunction(() => document.getElementById("sum") && !/Loading/.test(document.getElementById("sum").textContent));
    return page;
  };
  // real videos, recorded in this browser: the page tries a file on the browser before it uploads it
  const studio = await browser.newPage();
  await studio.goto("about:blank");
  const record = async (name, ms) => {
    const b64 = await studio.evaluate(async (dur) => {
      const c = document.createElement("canvas"); c.width = 320; c.height = 240;
      const g = c.getContext("2d");
      const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 2500000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      rec.start(100);
      const t0 = performance.now();
      await new Promise((res) => { const draw = () => { const id = g.createImageData(320, 240); for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); if (performance.now() - t0 < dur) setTimeout(draw, 33); else res(); }; draw(); });
      rec.stop(); await done;
      const buf = new Uint8Array(await new Blob(chunks).arrayBuffer());
      let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      return btoa(s);
    }, ms);
    const p = path.join(os.tmpdir(), name);
    fs.writeFileSync(p, Buffer.from(b64, "base64"));
    return { path: p, name, size: fs.statSync(p).size };
  };
  const f1 = await record("iphone-demo.mp4", 900), f2 = await record("iphone-demo-2.mp4", 1300), f3 = await record("promax.mp4", 1100), f4 = await record("ipad.mp4", 700), f5 = await record("refused.mp4", 700);
  await studio.close();
  ok([f1, f2, f3, f4, f5].every((f) => f.size > 60000) && f1.size !== f2.size, "five real videos were recorded for the test (" + [f1, f2, f3, f4, f5].map((f) => f.name + " " + mb(f.size)).join(", ") + ")");
  const tmpFile = (name, bytes, fill) => { const p = path.join(os.tmpdir(), name); fs.writeFileSync(p, Buffer.alloc(bytes, fill == null ? 7 : fill)); return p; };
  const fake = (page) => page.evaluate(() => JSON.parse(JSON.stringify({ sets: window.__fake.cfg.adVideoSets, msgs: window.__fake.msgs, tabs: window.__fake.tabs, options: window.__fake.options })));
  const card = (page, title) => page.locator(".card").filter({ has: page.locator(".title", { hasText: title }) });
  const pick = async (page, button, file) => { const [fc] = await Promise.all([page.waitForEvent("filechooser"), button.click()]); await fc.setFiles(file); };
  const settled = (page) => page.waitForFunction(() => !Array.from(document.querySelectorAll(".status")).some((n) => /Checking|Uploading|Saving|Removing/.test(n.textContent)), null, { timeout: 15000 });
  const order = (page) => page.locator(".card .title").evaluateAll((ns) => ns.map((n) => n.firstChild.textContent).join(" | "));

  /* ---- 1. the list: this Chrome's ads, what each gets ---- */
  const page = await open(baseSeed());
  ok((await page.locator(".card").count()) === 3 && /^3 ads on this Chrome · 0 have their own video$/.test(await page.textContent("#sum")), "the page lists this Chrome's three ads and nothing else: " + (await page.textContent("#sum")));
  ok(/Front desk \(PC-abc12\)/.test(await page.textContent("#who")), "it says which computer this is, by the name it was given");
  const titles = await page.locator(".card .title").allTextContents();
  ok(/^MacBook Air M2/.test(titles[0]) && /the chat open now/.test(titles[0]) && /^iPhone 13 Pro 256 Go$/.test(titles[1]) && /^iPhone 13 Pro Max 256 Go$/.test(titles[2]), "the ad of the chat open now comes first, then the newest: " + titles.join(" | "));
  ok(/Gets macbook\.mp4 \(4\.8 MB\), set on the web app for ads with the words “macbook”\./.test(await card(page, "MacBook Air M2").locator(".state").textContent()), "an ad a web-app set takes says so");
  ok(/No video of its own: it gets the general video \(general\.mp4 \(3\.8 MB\)\)\./.test(await card(page, "iPhone 13 Pro 256 Go").locator(".state").textContent()), "an ad with no choice says it gets the general video");
  ok((await card(page, "iPhone 13 Pro 256 Go").locator(".state a").getAttribute("href")) === X + "1-general.mp4" && (await card(page, "iPhone 13 Pro 256 Go").locator(".state a").getAttribute("target")) === "_blank", "a video's name is a link that plays it in a new tab (a file name does not say which phone is in it)");
  ok(/when the buyer asks to see the item/.test(await page.textContent("#notes")) && /does not send more videos/.test(await page.textContent("#notes")), "the page says when a video goes out, and that a choice only decides which one");
  ok(!/Marie/.test(await page.textContent("#ads")), "a chat that is not about an ad is not listed");

  /* ---- 2. pick an ad, upload its mp4 ---- */
  await pick(page, card(page, "iPhone 13 Pro 256 Go").locator("button", { hasText: "Upload a video for this ad" }), f1.path);
  await card(page, "iPhone 13 Pro 256 Go").locator(".status.ok").waitFor({ timeout: 15000 });
  let s = await fake(page);
  const up0 = uploads[0] || {};
  ok(uploads.length === 1 && /^\/storage\/v1\/object\/subsell-videos\/uid\/\d{13}-iphone-demo\.mp4$/.test(up0.path) && up0.apikey === "anon" && up0.auth === "Bearer tok" && up0.type === "video/mp4" && up0.bytes === f1.size && up0.first === 0x1a && up0.upsert === undefined, "the video goes from this computer into the account's own folder of the bucket, whole, with this computer's login: " + JSON.stringify(up0));
  const put0 = s.msgs.filter((m) => m.type === "MYADS_PUT")[0] || { clip: {} };
  ok(put0.item === "iPhone 13 Pro 256 Go" && put0.clip.name === "iphone-demo.mp4" && put0.clip.size === f1.size && put0.clip.url === origin + up0.path.replace("/storage/v1/object/", "/storage/v1/object/public/"), "then the choice is saved for that ad with the file's public address: " + JSON.stringify(put0));
  const mine = s.sets.filter((x) => x.exact === true);
  ok(s.sets.length === 2 && mine.length === 1 && mine[0].ads === "iPhone 13 Pro 256 Go" && JSON.stringify(mine[0].pcs) === '["pc-abc12"]' && s.sets[0].id === "mac", "the account's list holds the web app's set, untouched, and this computer's one choice");
  ok(new RegExp("✅ Its own video: iphone-demo\\.mp4 \\(" + esc(mb(f1.size)) + "\\)").test(await card(page, "iPhone 13 Pro 256 Go").locator(".state").textContent()) && /✓ Saved: iphone-demo\.mp4/.test(await card(page, "iPhone 13 Pro 256 Go").locator(".status").textContent()) && /A buyer who already got a video keeps it/.test(await card(page, "iPhone 13 Pro 256 Go").locator(".status").textContent()), "the card shows the ad's own video and says it is saved, and that a buyer who already got a video keeps it");
  ok(/No video of its own/.test(await card(page, "iPhone 13 Pro Max 256 Go").locator(".state").textContent()), "the 13 Pro MAX, whose title holds the same words, still gets the general video (this ad, and no other)");
  ok(/^3 ads on this Chrome · 1 has its own video$/.test(await page.textContent("#sum")), "the summary line counts it: " + (await page.textContent("#sum")));
  ok((await order(page)) === "MacBook Air M2 | iPhone 13 Pro 256 Go | iPhone 13 Pro Max 256 Go", "the cards stayed where they were");

  /* ---- 3. change the video: a new choice replaces the old one ---- */
  const idBefore = mine[0].id;
  await pick(page, card(page, "iPhone 13 Pro 256 Go").locator("button", { hasText: "Change the video" }), f2.path);
  await settled(page);
  s = await fake(page);
  const mine2 = s.sets.filter((x) => x.exact === true);
  ok(uploads.length === 2 && mine2.length === 1 && mine2[0].id !== idBefore && mine2[0].clips.length === 1 && mine2[0].clips[0].name === "iphone-demo-2.mp4", "changing the video uploads the new file and leaves ONE choice for that ad, under a new id (" + idBefore + " → " + (mine2[0] || {}).id + ")");

  /* ---- 4. a video already uploaded here is used again without a second upload ---- */
  await card(page, "iPhone 13 Pro Max 256 Go").locator("select").selectOption({ index: 1 });
  await card(page, "iPhone 13 Pro Max 256 Go").locator(".status.ok").waitFor({ timeout: 15000 });
  s = await fake(page);
  ok(uploads.length === 2 && s.sets.filter((x) => x.exact === true).length === 2 && /✅ Its own video: iphone-demo-2\.mp4/.test(await card(page, "iPhone 13 Pro Max 256 Go").locator(".state").textContent()), "“use a video already uploaded here” gives another ad the same file with no second upload");
  await pick(page, card(page, "MacBook Air M2").locator("button", { hasText: "Give this ad its own video" }), f2.path);
  await card(page, "MacBook Air M2").locator(".status.ok").waitFor({ timeout: 15000 });
  s = await fake(page);
  ok(uploads.length === 2 && /✅ Its own video: iphone-demo-2\.mp4/.test(await card(page, "MacBook Air M2").locator(".state").textContent()) && s.sets.some((x) => x.id === "mac"), "the same file chosen again from the disk is recognised (name + size) and not uploaded twice; the ad's own choice goes before the web app's words set, which stays");
  const idMac = s.sets.find((x) => x.exact === true && x.ads === "MacBook Air M2").id;
  await pick(page, card(page, "MacBook Air M2").locator("button", { hasText: "Change the video" }), f2.path);
  await card(page, "MacBook Air M2").locator(".status.ok").waitFor({ timeout: 15000 });
  s = await fake(page);
  ok(uploads.length === 2 && s.sets.find((x) => x.exact === true && x.ads === "MacBook Air M2").id === idMac, "the SAME video chosen again for the same ad changes nothing: no upload, the same choice under the same id");

  /* ---- 5. take a choice back ---- */
  await card(page, "iPhone 13 Pro Max 256 Go").locator("button", { hasText: "Remove" }).click();
  await settled(page);
  s = await fake(page);
  ok(s.msgs.some((m) => m.type === "MYADS_DROP") && s.sets.filter((x) => x.exact === true).length === 2 && /No video of its own/.test(await card(page, "iPhone 13 Pro Max 256 Go").locator(".state").textContent()), "Remove (after a confirm) takes this computer's choice back: the ad is on the general video again");

  /* ---- 6. what can go wrong says so ---- */
  const txt = path.join(os.tmpdir(), "notes.txt");
  fs.writeFileSync(txt, "hello");
  const cMax = card(page, "iPhone 13 Pro Max 256 Go");
  const upBtn = () => cMax.locator("button", { hasText: "Upload a video for this ad" });
  let upBefore = uploads.length, msgBefore = (await fake(page)).msgs.length;
  await pick(page, upBtn(), txt);
  await page.waitForTimeout(400);
  ok(/is not an mp4 video: choose an mp4/.test(await cMax.locator(".status").textContent()) && uploads.length === upBefore && (await fake(page)).msgs.length === msgBefore, "a file that is not a video is refused on the spot: nothing uploaded, nothing asked");
  await pick(page, upBtn(), tmpFile("clip.avi", 200000));
  await page.waitForTimeout(400);
  ok(/“clip\.avi” is not an mp4 video/.test(await cMax.locator(".status").textContent()) && uploads.length === upBefore, "…an .avi too (the buttons say mp4)");
  await pick(page, upBtn(), tmpFile("tiny.mp4", 9000));
  await page.waitForTimeout(400);
  ok(/“tiny\.mp4” is too small to be a video/.test(await cMax.locator(".status").textContent()) && uploads.length === upBefore, "a file under 50 KB is refused (the bots refuse such a clip)");
  await pick(page, upBtn(), tmpFile("broken.mp4", 200000));
  await cMax.locator(".status.err").filter({ hasText: "cannot play" }).waitFor({ timeout: 15000 });
  ok(/This Chrome cannot play “broken\.mp4”, so Messenger could not send it\. Export it as mp4 \(H\.264\)/.test(await cMax.locator(".status").textContent()) && uploads.length === upBefore && !(await fake(page)).msgs.slice(msgBefore).some((m) => m.type === "MYADS_TICKET" || m.type === "MYADS_PUT"), "a file this Chrome cannot play is refused BEFORE the upload, with what to do: it would have been saved as the ad's video and never sent");
  await pick(page, upBtn(), tmpFile("huge.mp4", 26 * 1024 * 1024));
  await page.waitForTimeout(500);
  ok(/“huge\.mp4” is 26\.0 MB: too big\. Messenger does not take a video over 25 MB\./.test(await cMax.locator(".status").textContent()) && uploads.length === upBefore, "a video over 25 MB is refused before anything is uploaded, with Messenger's own limit as the reason");
  srv.failNext = 1;
  await pick(page, upBtn(), f5.path);
  await cMax.locator(".status.err").filter({ hasText: "Not uploaded" }).waitFor({ timeout: 15000 });
  ok(/Not uploaded: The object exceeded the maximum allowed size \(the file is too big for the storage\)\./.test(await cMax.locator(".status").textContent()) && (await fake(page)).sets.filter((x) => x.exact === true).length === 2, "a refused upload shows the storage's own reason and saves nothing");
  await page.evaluate(() => { window.__fake.failSave = 1; });
  const upMid = uploads.length;
  await pick(page, upBtn(), f3.path);
  await cMax.locator(".status.err").filter({ hasText: "NOT saved" }).waitFor({ timeout: 15000 });
  ok(uploads.length === upMid + 1 && /uploaded but the choice was NOT saved: the account did not answer \(HTTP 503\)\./.test(await cMax.locator(".status").textContent()), "an upload that worked but a save that did not: said plainly, with the reason");
  await page.evaluate(() => { window.__fake.failSave = 1; });
  await pick(page, upBtn(), f3.path);
  await cMax.locator(".status.err").filter({ hasText: "NOT saved" }).waitFor({ timeout: 15000 });
  ok(uploads.length === upMid + 1, "choosing the same file again after that does not upload it a second time (it is already up)");
  await page.evaluate(() => { window.__fake.slowPull = 1; });
  await cMax.locator("button", { hasText: "Save again" }).click();
  await cMax.locator(".status.ok").waitFor({ timeout: 15000 });
  ok(uploads.length === upMid + 1 && /It is in the account; this Chrome takes it within a minute/.test(await cMax.locator(".status").textContent()), "“Save again” saves the file that is already up; when this Chrome has not read it back yet, the page says the choice is in the account");
  await page.click("#refresh");
  await page.waitForFunction(() => /✅ Its own video: promax\.mp4/.test(document.getElementById("ads").textContent), null, { timeout: 8000 });
  ok(/✅ Its own video: promax\.mp4/.test(await cMax.locator(".state").textContent()), "…and Refresh shows it");

  /* ---- 7. an ad that is not in the list yet ---- */
  await page.locator("#notListed summary").click();
  ok(/Every ad of this Chrome whose title has all these words gets this video/.test(await page.textContent("#notListed")), "the words box says what words do: every ad whose title has them all");
  await page.click("#wordsUp");
  await page.waitForTimeout(300);
  ok(/Type words from the ad's title first/.test(await page.textContent("#wordsStatus")), "words first: an empty box is answered, no chooser opens");
  await page.fill("#wordsIn", "liquidation 300$");
  let chooser = false;
  const onFc = () => { chooser = true; };
  page.on("filechooser", onFc);
  upBefore = uploads.length;
  await page.click("#wordsUp");
  await page.waitForTimeout(500);
  page.off("filechooser", onFc);
  ok(!chooser && uploads.length === upBefore && /These words cannot be used: these words hold nothing an ad's title is read by/.test(await page.textContent("#wordsStatus")), "words the bots cannot read (a price, an advert word) are refused BEFORE the chooser opens: no video is uploaded for nothing");
  await page.fill("#wordsIn", "ipad air, 64 Go");
  await pick(page, page.locator("#wordsUp"), f4.path);
  await page.locator("#wordsStatus.ok").waitFor({ timeout: 15000 });
  s = await fake(page);
  const wset = s.sets.find((x) => /ipad air/.test(x.ads)) || {};
  ok(wset.ads === "ipad air 64 Go" && wset.exact === undefined && JSON.stringify(wset.pcs) === '["pc-abc12"]' && /Ads with the words “ipad air 64 Go”: ipad\.mp4/.test(await page.textContent("#wordsList")) && (await page.inputValue("#wordsIn")) === "", "words + a video = a words set for this computer (a comma is not an “or”), listed under the box, the box emptied");
  await page.click("#openWeb");
  s = await fake(page);
  ok(s.tabs.length === 1 && /\/docs\/#videos$/.test(s.tabs[0].url), "the link to the web app opens its Videos tab");

  /* ---- 7b. the computer's name; the update gate's question; the cards do not move ---- */
  ok(/^rename$/.test(await page.textContent("#rename")), "a named computer offers “rename”");
  await page.click("#rename");
  await page.waitForFunction(() => /Shop PC 2 \(PC-abc12\)/.test(document.getElementById("who").textContent), null, { timeout: 5000 });
  ok(/— Shop PC 2 \(PC-abc12\)/.test(await page.textContent("#who")), "the computer's name is changed from the page (trimmed), the same name Settings and the web app use: " + (await page.textContent("#who")));
  await page.mouse.click(5, 5);
  const iu = JSON.parse(await page.evaluate(() => JSON.stringify({ shown: document.visibilityState, a: window.__workerAsks({ type: "MYADS_IN_USE" }), other: window.__workerAsks({ type: "SOMETHING_ELSE" }) })));
  ok((iu.shown === "visible" ? iu.a && iu.a.inUse === true : iu.a === null) && iu.other === null, "asked by the worker whether it is in use, the page says yes right after a click with the tab in front (" + iu.shown + "), and answers no other question");
  const hidden = await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); return window.__workerAsks({ type: "MYADS_IN_USE" }); });
  ok(hidden === null, "…and says nothing when the tab is not in front (a forgotten tab never holds an update back)");
  await page.evaluate(() => { delete document.visibilityState; });
  // the open chat changes all the time while the bot works: the cards must not move under the pointer
  const before = await order(page);
  await page.evaluate(() => { window.__fake.open = "Jimmy · iPhone 13 Pro 256 Go"; window.__fake.seen.push({ label: "Zed · Galaxy S24 Ultra", id: "t9", at: Date.now(), inbox: -1 }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForFunction(() => /Galaxy S24 Ultra/.test(document.getElementById("ads").textContent), null, { timeout: 8000 });
  const after = await order(page);
  ok(after === "Galaxy S24 Ultra | " + before, "the list read again by itself: a new ad comes on top, every card already on screen keeps its place (" + after + ")");
  await page.click("#refresh");
  await page.waitForFunction(() => /^iPhone 13 Pro 256 Go/.test(document.querySelector(".card .title").textContent), null, { timeout: 8000 });
  ok(/^iPhone 13 Pro 256 Go \| /.test(await order(page)), "Refresh takes the worker's order again (the chat open now first)");
  await page.screenshot({ path: path.join(os.tmpdir(), "myads-page.png"), fullPage: true });

  /* ---- 8. a Chrome that cannot save; an empty list; videos switched off ---- */
  const seedOut = baseSeed();
  Object.assign(seedOut, { canSave: false, loggedIn: false, needLogin: true, why: "This Chrome is not logged in to the account." });
  const out = await open(seedOut);
  const disabled = await out.locator(".card button").evaluateAll((bs) => bs.every((b) => b.disabled));
  ok((await out.locator(".card").count()) === 3 && disabled && /A choice cannot be saved from here yet\. This Chrome is not logged in to the account\./.test(await out.textContent("#notes")) && (await out.locator("#wordsUp").isDisabled()), "a Chrome that is not logged in still shows its ads; every button is off and the page says why");
  await out.locator("#notes button", { hasText: "Open Settings to log in" }).click();
  ok((await fake(out)).options === 1, "…with one button that opens Settings to log in");
  const seedPol = baseSeed();
  Object.assign(seedPol, { canSave: false, loggedIn: false, needLogin: false, why: "This computer's settings come from a company policy, not from the account. The video of an ad is then chosen on the web app." });
  const pol = await open(seedPol);
  ok(/company policy/.test(await pol.textContent("#notes")) && (await pol.locator("#notes button").count()) === 0, "where logging in would not help (a company policy), no login button is shown");
  await pol.close();
  const seedEmpty = baseSeed();
  Object.assign(seedEmpty, { seen: [], open: "", messengerTabs: 0 });
  seedEmpty.cfg.videoWhen = "never";
  const empty = await open(seedEmpty);
  ok((await empty.locator(".card").count()) === 0 && /^No ad yet on this Chrome$/.test(await empty.textContent("#sum")) && /fills by itself/.test(await empty.textContent("#ads")) && /no Messenger tab is open/.test(await empty.textContent("#ads")), "no chat yet: the page says the list fills by itself, and that no Messenger tab is open");
  ok(/switched OFF for the whole account/.test(await empty.textContent("#notes")), "videos switched off for the account is said at the top");
  await empty.screenshot({ path: path.join(os.tmpdir(), "myads-empty.png"), fullPage: true });
  const seedNoName = baseSeed();
  seedNoName.label = "";
  seedNoName.cfg.demoVideoUrls = [];
  seedNoName.localClips = 2;
  const nn = await open(seedNoName);
  ok(/— PC-abc12$/.test(await nn.textContent("#who")) && /^give this computer a name$/.test(await nn.textContent("#rename")), "a computer with no name shows its id and offers to give it one");
  ok(/it gets the videos uploaded in this Chrome's Settings/.test(await card(nn, "iPhone 13 Pro 256 Go").locator(".state").textContent()), "with no general video on the account, an ad without its own says it gets this Chrome's own Settings videos (not “no video”)");
  await nn.close();

  /* ---- 9. the same item under another title: its video in one click ---- */
  const seedLike = baseSeed();
  seedLike.cfg.adVideoSets.push({ id: "old1", ads: "iPhone 13 Pro 128 Go", pcs: ["pc-abc12"], clips: [{ name: "old-13pro.mp4", url: origin + "/storage/v1/object/public/subsell-videos/uid/9-old-13pro.mp4", size: 2500000 }], exact: true });
  const like = await open(seedLike);
  const likeCard = card(like, "iPhone 13 Pro 256 Go");
  ok(/Same item as “iPhone 13 Pro 128 Go”\?/.test(await likeCard.textContent()) && (await likeCard.locator("button", { hasText: "Use its video (old-13pro.mp4)" }).count()) === 1 && !/Same item/.test(await card(like, "iPhone 13 Pro Max 256 Go").textContent()) && !/Same item/.test(await card(like, "MacBook Air M2").textContent()), "an ad whose title reads as the same phone as an ad that has a video is offered that video; the 13 Pro Max and the MacBook are not");
  ok(/no chat on this ad lately/.test(await card(like, "iPhone 13 Pro 128 Go").textContent()), "the older title, with no chat lately, is still listed with its video");
  const upLike = uploads.length;
  await likeCard.locator("button", { hasText: "Use its video (old-13pro.mp4)" }).click();
  await likeCard.locator(".status.ok").waitFor({ timeout: 15000 });
  const sl = await fake(like);
  ok(uploads.length === upLike && sl.sets.some((x) => x.exact === true && x.ads === "iPhone 13 Pro 256 Go" && x.clips[0].name === "old-13pro.mp4") && sl.sets.some((x) => x.id === "old1") && /✅ Its own video: old-13pro\.mp4/.test(await likeCard.locator(".state").textContent()), "one click gives the new title the same video, with no upload; the older title keeps its own");
  await like.close();

  ok(errors.length === 0, "no page error, no console error" + (errors.length ? ": " + errors.slice(0, 4).join(" ; ") : ""));
  await browser.close();
  server.close();
  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed — the page “Videos for my ads”");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("driver threw:", e && e.stack || e); process.exit(1); });
