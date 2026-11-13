// Headless boot of the v0.21.97 STORE build (same staging as store/build-webstore-zip.ps1): the real
// worker in a real browser, Anthropic stubbed by overriding self.fetch inside it. Proves the worker's
// top level runs with the .94 code, the name rule, the brand wall, the bursts, the [CLIP] parse, the
// three-way clip sentence, writeReply's wall, the 🩺 lines and the renamed popup. Pattern: e2e-api.mjs.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn, execFileSync } from "node:child_process";

const root = "C:/Users/hovig/projects/marketplace-auto-replier";
// Edge 157 / branded Chrome 137+ ignore --load-extension (the worker listed at /background.js was Edge's own
// Gemini component extension, Nov 10 2026): use Playwright's unbranded Chromium, which still loads it.
import { createRequire } from "node:module";
const pwPath = (() => { try { return createRequire("C:/Users/hovig/projects/subsell-pos/package.json")("playwright").chromium.executablePath(); } catch (e) { return ""; } })();
const EDGE = [pwPath, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe"].find((p) => p && fs.existsSync(p));
console.log("browser:", EDGE);
const PORT = 9334;
let failed = 0;
const ok = (c, m) => { console.log((c ? "  PASS  " : "  FAIL  ") + m); if (!c) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stage = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-boot94-"));
for (const f of ["content.js", "options.html", "options.js", "popup.html", "popup.js", "myads.html", "myads.js", "managed_schema.json", "icon16.png", "icon48.png", "icon128.png"]) fs.copyFileSync(path.join(root, f), path.join(stage, f));
execFileSync("node", [path.join(root, "store/webstore-background.js"), path.join(root, "background.js"), path.join(stage, "background.js")], { stdio: "inherit" });
execFileSync("node", [path.join(root, "store/webstore-manifest.js"), path.join(root, "manifest.json"), path.join(stage, "manifest.json")], { stdio: "inherit" });
const mf = JSON.parse(fs.readFileSync(path.join(stage, "manifest.json"), "utf8"));
ok(mf.version === "0.21.97" && !mf.key && mf.name === "Liquidation Téléphone Montréal Auto-Reply", "store manifest: v" + mf.version + ", no key, name '" + mf.name + "'");

// (Nov 13 2026) EVERY CALL TO THE BROWSER HAS A TIME LIMIT. One run in five hung for ever right after the
// manifest check: a browser of the run before was still closing on this port, the loop below attached to
// one of ITS workers, the browser went away, and the question was never answered (no limit, no close
// handler). Now a connection that closes fails what was asked on it, a question unanswered after 60 s
// fails, and the debug port's own pages answer in 8 s or fail: a bad start is a visible "boot threw" or
// one more turn of the loop, never a run that sits there.
const get = (p) => new Promise((res, rej) => { const q = http.get({ host: "127.0.0.1", port: PORT, path: p, timeout: 8000 }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }); q.on("error", rej); q.on("timeout", () => q.destroy(new Error("no answer from the debug port in 8 s"))); });
const put = (p) => new Promise((res, rej) => { const q = http.request({ host: "127.0.0.1", port: PORT, path: p, method: "PUT", timeout: 8000 }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }); q.on("error", rej); q.on("timeout", () => q.destroy(new Error("no answer from the debug port in 8 s"))); q.end(); });
const WS = globalThis.WebSocket;
async function cdp(wsUrl) {
  const ws = new WS(wsUrl);
  await new Promise((r, j) => { const t = setTimeout(() => j(new Error("ws: no connection in 10 s")), 10000); ws.onopen = () => { clearTimeout(t); r(); }; ws.onerror = () => { clearTimeout(t); j(new Error("ws error")); }; });
  let id = 0; const pend = new Map(); const events = [];
  const failAll = (why) => { for (const [i, p] of Array.from(pend)) { pend.delete(i); clearTimeout(p.t); p.rej(new Error(why)); } };
  ws.onclose = () => failAll("the browser closed the connection");
  ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); clearTimeout(p.t); p.res(m); } else if (m.method) events.push(m); };
  return {
    events,
    send: (method, params) => new Promise((res, rej) => {
      const i = ++id;
      const t = setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error("no answer to " + method + " in 60 s")); } }, 60000);
      pend.set(i, { res, rej, t });
      try { ws.send(JSON.stringify({ id: i, method, params: params || {} })); } catch (e) { pend.delete(i); clearTimeout(t); rej(e); }
    }),
    close: () => { try { ws.close(); } catch (e) { /* ignore */ } },
  };
}
async function evalIn(c, expression) {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails).slice(0, 400));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
async function closeBrowserOnPort() {
  try {
    const v = JSON.parse(await get("/json/version"));
    if (!v || !v.webSocketDebuggerUrl) return false;
    const b = await cdp(v.webSocketDebuggerUrl);
    await Promise.race([b.send("Browser.close").catch(() => { /* it closed: that is the answer */ }), sleep(3000)]);
    b.close();
    // the port must be FREE before a new browser is started on it (a closing browser can take several seconds)
    for (let i = 0; i < 50; i++) { await sleep(300); try { await get("/json/version"); } catch (e) { return true; } }
    return true;
  } catch (e) { return false; }
}
if (await closeBrowserOnPort()) console.log("  (a browser was still on port " + PORT + " — closed it first)");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ltm-prof94-"));
const edge = spawn(EDGE, ["--headless=new", "--remote-debugging-port=" + PORT, "--user-data-dir=" + profile, "--disable-extensions-except=" + stage, "--load-extension=" + stage, "--no-first-run", "--no-default-browser-check", "--disable-gpu", "about:blank"], { stdio: "ignore" });
try {
  // OUR worker: a service worker at /background.js whose manifest is ours (a browser's own component
  // extension can live at the same path — Edge's Gemini helper does)
  let worker = null, w = null;
  for (let i = 0; i < 60 && !worker; i++) {
    await sleep(500);
    let list = [];
    try { list = JSON.parse(await get("/json/list")).filter((t) => t.type === "service_worker" && /\/background\.js$/.test(t.url)); } catch (e) { /* not up yet */ }
    for (const t of list) {
      // a worker that cannot be attached to, or does not answer its first question in 5 s (it is still
      // starting, or it belongs to a browser that is going away), is asked again on the next turn
      let c = null, name = "", why = "";
      try { c = await cdp(t.webSocketDebuggerUrl); } catch (e) { why = "attach: " + e.message; }
      if (c) {
        // (an answer that is an error = not our worker: the browser's own helper has no such manifest; said only when nothing answered)
        try { name = await Promise.race([evalIn(c, 'chrome.runtime.getManifest().name'), sleep(5000).then(() => { throw new Error("no answer in 5 s"); })]); } catch (e) { if (/no answer|closed the connection/.test(String(e && e.message))) why = "first question: " + e.message; }
      }
      if (c && name === mf.name) { worker = t; w = c; break; }
      if (why) console.log("  (turn " + i + ": the worker at " + t.url + " — " + why + ")");
      if (c) c.close();
    }
  }
  ok(!!worker, "the store build's worker is listed and is ours: " + (worker && worker.url));
  const extId = worker.url.match(/^chrome-extension:\/\/([a-p]+)\//)[1];
  await w.send("Runtime.enable");
  let ready = false;
  for (let i = 0; i < 40 && !ready; i++) { try { ready = await evalIn(w, 'typeof shopNameFor === "function" && typeof brandWall === "function" && typeof buildDiagnostic === "function"'); } catch (e) { /* top level not done */ } if (!ready) await sleep(500); }
  ok(ready, "the worker's top level is done (shopNameFor, brandWall, buildDiagnostic defined)");
  if (!ready) {
    try { console.log("  debug:", await evalIn(w, 'typeof apiNote + " " + typeof callClaude + " " + typeof shopNameFor + " " + typeof brandWall + " " + typeof cadenceDecision + " " + typeof buildDiagnostic + " | " + self.location.href + " | keys=" + Object.getOwnPropertyNames(self).filter((n) => /shop|brand|cadence|apiNote|DEFAULTS|getSettings/.test(n)).join(",")')); } catch (e) { console.log("  debug eval threw:", e.message); }
    console.log("  events:", JSON.stringify(w.events.map((e) => e.method + (e.params && e.params.exceptionDetails ? ":" + JSON.stringify(e.params.exceptionDetails).slice(0, 200) : "")).slice(0, 8)));
    try { console.log("  chrome:", await evalIn(w, 'typeof chrome + " keys=" + (typeof chrome === "object" ? Object.keys(chrome).join(",") : "-") + " id=" + (typeof chrome === "object" && chrome.runtime ? chrome.runtime.id : "-") + " manifest=" + (typeof chrome === "object" && chrome.runtime && chrome.runtime.getManifest ? JSON.stringify(chrome.runtime.getManifest()).slice(0, 200) : "-")')); } catch (e) { console.log("  chrome probe threw:", e.message); }
    try { console.log("  self:", await evalIn(w, 'Object.getOwnPropertyNames(self).filter((n) => !/^(on|webkit)/.test(n)).slice(0, 60).join(",")')); } catch (e) { console.log("  self probe threw:", e.message); }
    // the browser's own parse verdict on the worker file (node accepted it; a syntax Edge rejects leaves the worker empty)
    const dbg = JSON.parse(await put("/json/new?chrome-extension://" + extId + "/popup.html"));
    const d = await cdp(dbg.webSocketDebuggerUrl);
    await d.send("Runtime.enable");
    await sleep(800);
    try { console.log("  parse verdict:", await evalIn(d, 'fetch(chrome.runtime.getURL("background.js")).then((r) => r.text()).then((t) => { try { new Function(t); return "compiles (" + t.length + " chars)"; } catch (e) { return "SyntaxError: " + e.message; } })')); } catch (e) { console.log("  parse probe threw:", e.message); }
    d.close();
  }
  await sleep(2500);
  const exceptions = w.events.filter((e) => e.method === "Runtime.exceptionThrown");
  ok(exceptions.length === 0, "no uncaught exception in the worker during boot" + (exceptions.length ? " — " + JSON.stringify(exceptions[0].params.exceptionDetails).slice(0, 300) : ""));

  ok(await evalIn(w, 'DEFAULTS.videoWhen === "asked" && DEFAULTS.businessName === "" && DEFAULTS.humanTime === undefined && DEFAULTS.humanRhythm === undefined && DEFAULTS.typingLive === undefined && DEFAULTS.responseDelaySec === 30'), "DEFAULTS: videoWhen asked, no name, no human-time keys, the .93 delay");
  ok(await evalIn(w, 'shopNameFor({ businessName: "SubSell" }) === "" && shopNameFor({ businessName: "Liquidation Téléphone Montréal" }) === "Liquidation Téléphone Montréal"'), "shopNameFor in the real worker");
  ok((await evalIn(w, 'brandWall("Allô, le 13 est là. Les prix sont sur subselltrade.ca. Tu passes à soir?")')) === "Allô, le 13 est là. Tu passes à soir?", "brandWall drops the website sentence in the real worker");
  ok((await evalIn(w, 'JSON.stringify(parseReply("[CLIP] Oui, je t\'envoie une vidéo là."))')).includes('"clip":true') && (await evalIn(w, 'parseReply("[CLIP] Oui, je t\'envoie une vidéo là.").text')) === "Oui, je t'envoie une vidéo là.", "parseReply strips [CLIP] and records it");
  const prompt = await evalIn(w, 'buildOwnerPrompt(Object.assign({}, DEFAULTS, { businessName: "SubSell", businessInfo: "Shop: Liquidation Téléphone Montréal.", instructions: "Short.", closerGoals: "Come.", demoVideoUrls: [{ name: "a.mp4", url: "https://x/a.mp4" }] }))');
  ok(/for the shop described below/.test(prompt) && !/SubSell/.test(prompt) && /- \[CLIP\] at the very start/.test(prompt), "the owner prompt: no SubSell, the [CLIP] token taught when a clip exists");
  const promptNoClip = await evalIn(w, 'buildOwnerPrompt(Object.assign({}, DEFAULTS, { businessName: "Liquidation Téléphone Montréal", businessInfo: "x", instructions: "y", closerGoals: "z" }))');
  ok(/for "Liquidation Téléphone Montréal", writing as the seller/.test(promptNoClip) && /never promise one/.test(promptNoClip) && !/\[CLIP\]/.test(promptNoClip), "…the owner's name used; no clip → never promise one");
  await evalIn(w, 'self.fetch = async (url) => new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "Le 13 est là, pis on en a plusieurs. Les prix de rachat sont sur subselltrade.ca. Tu passes à soir?" }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }); true');
  const wr = await evalIn(w, 'writeReply(Object.assign({}, DEFAULTS, { apiKey: "sk-test", ownerTeachingOnly: true, businessName: "Liquidation Téléphone Montréal", businessInfo: "x", instructions: "y", closerGoals: "z" }), "c\'est dispo?", "", "", { threadId: "t1", threadName: "Buyer · iPhone 13" })');
  ok(wr && wr.kind === "text" && wr.walled === true && !/subsell/i.test(wr.text) && /Le 13 est là/.test(wr.text) && /Tu passes à soir/.test(wr.text), "writeReply through the real worker: the website sentence walled, the rest sent — " + (wr && wr.text));
  await evalIn(w, 'self.fetch = async (url) => new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-haiku-4-5", content: [{ type: "text", text: "SubSell te répond. Voir subselltrade.ca." }], usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } }); true');
  const wr2 = await evalIn(w, 'writeReply(Object.assign({}, DEFAULTS, { apiKey: "sk-test", ownerTeachingOnly: true, businessName: "Liquidation Téléphone Montréal", businessInfo: "x", instructions: "y", closerGoals: "z" }), "c\'est dispo?", "", "", { threadId: "t2", threadName: "Buyer · iPhone 13" })');
  ok(wr2 && wr2.kind === "held" && /brand wall/.test(wr2.reason), "…a brand-only answer is held: " + (wr2 && wr2.reason));
  const diag = await evalIn(w, "buildDiagnostic()");
  const theatreField = (diag.match(/typingLive=on|typingLive=off|burst=\d|human=on|human=off|rhythm=/) || [])[0] || "";
  ok(/clip=asked/.test(diag) && !theatreField && /Marketplace Auto-Reply v0.21.97/.test(diag), "the 🩺 reads clip=asked, no timing-theatre fields, header renamed" + (theatreField ? " — found: " + theatreField : ""));
  ok(!/SubSell/.test(diag.split("\n").slice(0, 3).join("\n")), "…and its header has no SubSell");
  const pop = JSON.parse(await put("/json/new?chrome-extension://" + extId + "/popup.html"));
  const p = await cdp(pop.webSocketDebuggerUrl);
  await p.send("Runtime.enable");
  await sleep(1200);
  const h1 = await evalIn(p, 'document.querySelector("h1").textContent');
  ok(/Marketplace Auto-Reply/.test(h1) && !/SubSell/.test(h1), "the popup opens with the renamed title: " + h1.trim().slice(0, 60));
  const sliderLabel = await evalIn(p, 'document.querySelector("#delay") ? (document.querySelector("#delay").closest(".panel").querySelector("h2") || {}).textContent : "(no slider)"');
  ok(/Response delay/.test(sliderLabel), "the popup's slider is the Response delay, as before: " + String(sliderLabel).trim());
  // (v0.21.96) A VIDEO PER AD, through the real worker and the real message path: the popup asks
  // CHAT_CLIPS exactly as content.js does. No set = the general list and nothing stored; a set =
  // the chat's own list, remembered; a served chat and another computer's set stay general.
  const askP = (m) => evalIn(p, "new Promise((r) => chrome.runtime.sendMessage(" + JSON.stringify(m) + ", (x) => { void chrome.runtime.lastError; r(JSON.stringify(x || null)); }))").then((s) => JSON.parse(s));
  const setOfW = () => evalIn(w, 'new Promise((r) => chrome.storage.local.get(["videoSetOf"], (x) => r(JSON.stringify((x && x.videoSetOf) || null))))');
  ok(await evalIn(w, 'typeof adVideoPick === "function" && typeof chatClipChoice === "function" && Array.isArray(DEFAULTS.adVideoSets) && DEFAULTS.adVideoSets.length === 0'), "the worker carries the video-per-ad rule; DEFAULTS.adVideoSets is empty");
  const c0 = await askP({ type: "CHAT_CLIPS", threadId: "t0", threadName: "Buyer · MacBook Air M2", served: false });
  ok(!!c0 && c0.ok === true && c0.set === "" && c0.clips === null && (await setOfW()) === "null", "CHAT_CLIPS with no set configured: the general list, nothing stored");
  const adCfg = { apiKey: "sk-test", demoVideoUrls: [{ name: "g.mp4", url: "https://x/g.mp4" }], adVideoSets: [{ id: "mac", ads: "macbook air, macbook pro", pcs: [], clips: [{ name: "m.mp4", url: "https://x/m.mp4" }] }, { id: "s24", ads: "s24 ultra", pcs: ["PC-other"], clips: [{ name: "s.mp4", url: "https://x/s.mp4" }] }] };
  await evalIn(w, "new Promise((r) => chrome.storage.local.set({ cloudConfig: " + JSON.stringify(adCfg) + ", machineId: 'PC-test1' }, r))");
  ok(await evalIn(w, 'getSettings().then((s) => s.machineId === "PC-test1" && !Object.keys(s).includes("machineId") && !/PC-test1/.test(JSON.stringify(s)) && adVideoSets(s).length === 2)'), "getSettings carries this computer's id, non-enumerable (never saved); both sets are read from the account's row");
  const c1 = await askP({ type: "CHAT_CLIPS", threadId: "t1", threadName: "Buyer · MacBook Air M2 13 pouces 900$", served: false });
  ok(!!c1 && c1.set === "mac" && c1.clips.length === 1 && c1.clips[0].url === "https://x/m.mp4" && !c1.gone, "a new chat on the MacBook ad gets the MacBook set");
  const c2 = await askP({ type: "CHAT_CLIPS", threadId: "t1", threadName: "Buyer · iPhone 12", served: true });
  ok(!!c2 && c2.set === "mac", "…and keeps it on a later visit, whatever the title reads");
  const c3 = await askP({ type: "CHAT_CLIPS", threadId: "t2", threadName: "Buyer · MacBook Pro 14", served: true });
  ok(!!c3 && c3.set === "" && c3.clips === null, "a chat that was served before the set existed stays on the general list");
  const c4 = await askP({ type: "CHAT_CLIPS", threadId: "t3", threadName: "Buyer · Galaxy S24 Ultra", served: false });
  ok(!!c4 && c4.set === "" && c4.clips === null, "a set written for another computer does not apply on this one");
  const storedW = JSON.parse(await setOfW()) || {};
  ok(Object.keys(storedW).length === 1 && !!storedW.t1 && storedW.t1.set === "mac", "only the chat that was given a set is remembered: " + JSON.stringify(storedW));
  ok(/videos: central=1 adSets=2/.test(await evalIn(w, "buildDiagnostic()")), "the diagnostic names the sets");
  const optT = JSON.parse(await put("/json/new?chrome-extension://" + extId + "/options.html"));
  const o = await cdp(optT.webSocketDebuggerUrl);
  await o.send("Runtime.enable");
  let adList = "";
  for (let i = 0; i < 12 && !/Ads with/.test(adList); i++) { await sleep(500); try { adList = await evalIn(o, 'document.getElementById("adVideoList").textContent'); } catch (e) { /* the page is still loading */ } }
  for (let i = 0; i < 8 && !/for other computers/.test(adList); i++) { await sleep(400); try { adList = await evalIn(o, 'document.getElementById("adVideoList").textContent'); } catch (e) { /* the page is still loading */ } }
  ok(/Ads with: macbook air, macbook pro — m\.mp4 — every computer/.test(adList) && !/s24 ultra/.test(adList) && /\+ 1 for other computers \(not sent from this one\)/.test(adList) && /this computer is: PC-test1/.test(adList), "Settings lists the sets that apply on this computer, read-only, and only counts the other computers': " + adList);
  ok(await evalIn(o, '!!document.getElementById("openMyAds")'), "…with the door to this Chrome's own “Videos for my ads” page");
  o.close();
  // two tabs asking at once must not lose a choice (the worker answers one question at a time)
  const many = await evalIn(p, 'Promise.all(["u1","u2","u3","u4","u5","u6"].map((id) => new Promise((r) => chrome.runtime.sendMessage({ type: "CHAT_CLIPS", threadId: id, threadName: "Buyer · MacBook Pro 14", served: false }, (x) => { void chrome.runtime.lastError; r(x && x.set); })))).then((a) => a.join(","))');
  const afterMany = JSON.parse(await setOfW()) || {};
  ok(many === "mac,mac,mac,mac,mac,mac" && ["u1", "u2", "u3", "u4", "u5", "u6", "t1"].every((k) => afterMany[k] && afterMany[k].set === "mac"), "six chats asking at the same moment are all remembered (" + Object.keys(afterMany).length + " entries)");
  // EVERY set removed (the owner deletes them): a chat that was served on a set keeps what it has, a chat that
  // never got its clip goes back to the general list for good, a chat that never had a set is general
  await evalIn(w, "new Promise((r) => chrome.storage.local.set({ cloudConfig: " + JSON.stringify(Object.assign({}, adCfg, { adVideoSets: [] })) + " }, r))");
  const c5 = await askP({ type: "CHAT_CLIPS", threadId: "t1", threadName: "Buyer · MacBook Air M2", served: true });
  ok(!!c5 && c5.ok === true && c5.set === "mac" && c5.gone === true && Array.isArray(c5.clips) && c5.clips.length === 0, "every set removed: the chat that was SERVED on a set keeps what it has (gone) — never the general video on top");
  const c6 = await askP({ type: "CHAT_CLIPS", threadId: "u1", threadName: "Buyer · MacBook Pro 14", served: false });
  const afterGone = JSON.parse(await setOfW()) || {};
  ok(!!c6 && c6.set === "" && c6.clips === null && !c6.gone && !afterGone.u1 && !!afterGone.t1 && !!afterGone.u2, "…a chat that was never served goes back to the general list and its stale choice is forgotten; the others are untouched");
  const c7 = await askP({ type: "CHAT_CLIPS", threadId: "t2", threadName: "Buyer · MacBook Pro 14", served: true });
  ok(!!c7 && c7.set === "" && c7.clips === null && !c7.gone, "…a chat that never had a set is on the general list, as before");

  // (v0.21.97) MY ADS, MY VIDEOS in the real extension: the real page (myads.html) asks the real worker over the
  // real message path, uploads with a real request, and the choice lands in the account's row. The account is
  // stood in for twice: its settings row by self.fetch inside the worker (a row with a stamp), its video storage
  // by a local server run here (the page's upload is a real cross-origin request from the extension's own page).
  const ups = [];
  const stor = http.createServer((req, res) => {
    const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "apikey, authorization, content-type, cache-control", "access-control-allow-methods": "POST, OPTIONS" };
    if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { ups.push({ path: decodeURIComponent(String(req.url)), origin: req.headers.origin || "", auth: req.headers.authorization || "", apikey: req.headers.apikey || "", type: req.headers["content-type"] || "", bytes: Buffer.concat(chunks).length }); res.writeHead(200, Object.assign({ "content-type": "application/json" }, cors)); res.end("{}"); });
  });
  await new Promise((r) => stor.listen(0, "127.0.0.1", r));
  const SB = "http://127.0.0.1:" + stor.address().port;
  const rowCfg = { apiKey: "sk-test", model: "claude-haiku-4-5", businessInfo: "Shop.", instructions: "Short.", demoVideoUrls: [{ name: "g.mp4", url: "https://x/g.mp4" }], adVideoSets: [{ id: "mac", ads: "macbook air, macbook pro", pcs: [], clips: [{ name: "m.mp4", url: "https://x/m.mp4" }] }] };
  const logSeed = [{ at: new Date().toISOString(), thread: "Jimmy · iPhone 13 Pro 256 Go 650$", threadId: "t1", action: "text", buyer: "dispo?", reply: "oui" }, { at: new Date().toISOString(), thread: "Paul · MacBook Air M2", threadId: "t2", action: "text", buyer: "allo", reply: "allo" }, { at: new Date().toISOString(), thread: "Messenger", threadId: "t9", action: "video" }];
  await evalIn(w, "new Promise((r) => chrome.storage.local.set(" + JSON.stringify({ cloudConfig: rowCfg, replyLog: logSeed, machineId: "PC-test1", machineLabel: "Front desk", videoSetOf: {}, supabaseUrl: SB, supabaseAnonKey: "anon-test", cloudAuth: { access_token: "tok-1", refresh_token: "ref-1", expires_at: Date.now() + 3600000, ttl_ms: 3600000, user_id: "uid-1", email: "owner@example.com" } }) + ", r))");
  await evalIn(w, "(() => { const row = self.__row = { config: " + JSON.stringify(rowCfg) + ", updated_at: 's1' }; const calls = self.__calls = []; self.fetch = async (url, init) => { const u = String(url), m = (init && init.method) || 'GET'; calls.push(m + ' ' + u.slice(u.indexOf('/', 8))); if (u.indexOf('/rest/v1/subsell_configs') < 0) return new Response('{}', { status: 200 }); if (m === 'GET') return new Response(JSON.stringify([{ config: row.config, updated_at: row.updated_at, config_key: 'k1' }]), { status: 200 }); const st = decodeURIComponent((u.split('updated_at=eq.')[1] || '').split('&')[0]); if (st !== row.updated_at) return new Response('[]', { status: 200 }); row.config = JSON.parse(init.body).config; row.updated_at = 's' + (Number(row.updated_at.slice(1)) + 1); return new Response(JSON.stringify([{ config: row.config, updated_at: row.updated_at }]), { status: 200 }); }; return true; })()");
  ok(await evalIn(w, 'typeof myAdsState === "function" && typeof myAdsWrite === "function" && typeof myAdSetsPut === "function" && typeof myAdsRows === "function"'), "the worker carries the My ads rules");
  ok(await evalIn(p, '!!document.getElementById("myAds") && /Videos for my ads/.test(document.getElementById("myAds").textContent)'), "the popup has the “Videos for my ads” button");
  const myT = JSON.parse(await put("/json/new?chrome-extension://" + extId + "/myads.html"));
  const my = await cdp(myT.webSocketDebuggerUrl);
  await my.send("Runtime.enable");
  const inMy = (expr) => evalIn(my, expr);
  let sumMy = "";
  for (let i = 0; i < 20 && !/on this Chrome/.test(sumMy); i++) { await sleep(400); try { sumMy = await inMy('document.getElementById("sum").textContent'); } catch (e) { /* the page is still loading */ } }
  const cardsMy = () => inMy('Array.from(document.querySelectorAll(".card")).map((c) => c.querySelector(".title").textContent + " => " + c.querySelector(".state").textContent).join(" || ")');
  ok(/^2 ads on this Chrome · 0 have their own video$/.test(sumMy) && /Front desk \(PC-test1\)/.test(await inMy('document.getElementById("who").textContent')), "the real page, asked of the real worker, lists this computer's two ads (its own log; the row with no listing is not one): " + sumMy);
  const c0My = await cardsMy();
  ok(/iPhone 13 Pro 256 Go => No video of its own: it gets the general video \(g\.mp4\)\./.test(c0My) && /MacBook Air M2 => Gets m\.mp4, set on the web app for ads with the words “macbook air, macbook pro”\./.test(c0My), "…each with the video the bots would send: " + c0My);
  const askMy = (m) => inMy("new Promise((r) => chrome.runtime.sendMessage(" + JSON.stringify(m) + ", (x) => { void chrome.runtime.lastError; r(JSON.stringify(x || null)); }))").then((s) => JSON.parse(s));
  const tk = await askMy({ type: "MYADS_TICKET" });
  ok(!!tk && tk.ok === true && tk.url === SB && tk.key === "anon-test" && tk.token === "tok-1" && tk.userId === "uid-1" && tk.bucket === "subsell-videos", "the extension's own page gets the upload ticket (this computer's login, the account's folder)");
  // the button's click appends the hidden file input (the chooser itself needs a person's click); the file is handed
  // to it here. It is a REAL video, recorded in this page (a canvas through MediaRecorder): the page tries a file on
  // the browser before it uploads it, and bytes that are not a video are refused.
  const bootBytes = await inMy('(async () => { const c = document.createElement("canvas"); c.width = 320; c.height = 240; const g = c.getContext("2d"); const rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 2500000 }); const chunks = []; rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); }; const done = new Promise((r) => { rec.onstop = r; }); rec.start(100); const t0 = performance.now(); await new Promise((res) => { const draw = () => { const id = g.createImageData(320, 240); for (let i = 0; i < id.data.length; i += 4) { id.data[i] = Math.random() * 255; id.data[i + 1] = Math.random() * 255; id.data[i + 2] = Math.random() * 255; id.data[i + 3] = 255; } g.putImageData(id, 0, 0); if (performance.now() - t0 < 900) setTimeout(draw, 33); else res(); }; draw(); }); rec.stop(); await done; const blob = new Blob(chunks); const card = Array.from(document.querySelectorAll(".card")).find((x) => /iPhone 13 Pro 256 Go/.test(x.querySelector(".title").textContent)); card.querySelector("button").click(); const inp = document.querySelector(\'input[type="file"]\'); const dt = new DataTransfer(); dt.items.add(new File([blob], "boot-demo.mp4", { type: "video/mp4" })); inp.files = dt.files; inp.dispatchEvent(new Event("change")); return blob.size; })()');
  let c1My = "";
  for (let i = 0; i < 30 && !/Its own video: boot-demo\.mp4/.test(c1My); i++) { await sleep(400); try { c1My = await cardsMy(); } catch (e) { /* drawing */ } }
  const up = ups[0] || {};
  ok(ups.length === 1 && /^\/storage\/v1\/object\/subsell-videos\/uid-1\/\d{13}-boot-demo\.mp4$/.test(up.path) && up.origin === "chrome-extension://" + extId && up.auth === "Bearer tok-1" && up.apikey === "anon-test" && up.type === "video/mp4" && up.bytes === bootBytes && bootBytes > 60000, "the page's own upload: one request from the extension's page into the account's folder, whole: " + JSON.stringify(up));
  const rowNow = JSON.parse(await evalIn(w, "JSON.stringify(self.__row)"));
  const callsNow = JSON.parse(await evalIn(w, "JSON.stringify(self.__calls)"));
  const mineSet = (rowNow.config.adVideoSets || []).find((x) => x.exact === true) || { clips: [{}], pcs: [] };
  ok(rowNow.config.adVideoSets.length === 2 && rowNow.config.adVideoSets[0].id === "mac" && mineSet.ads === "iPhone 13 Pro 256 Go" && JSON.stringify(mineSet.pcs) === '["pc-test1"]' && mineSet.clips[0].url === SB + up.path.replace("/storage/v1/object/", "/storage/v1/object/public/") && mineSet.clips[0].size === bootBytes, "the choice is in the account's row: this computer alone, this ad, this file — " + JSON.stringify(mineSet));
  ok(rowNow.config.apiKey === "sk-test" && rowNow.config.businessInfo === "Shop." && rowNow.config.instructions === "Short." && rowNow.config.demoVideoUrls.length === 1 && rowNow.config.videoLinkFallback === false, "…and nothing else in the row moved (the key, the teaching, the general video)");
  const iGet = callsNow.findIndex((c) => /^GET \/rest\/v1\/subsell_configs\?select=config,updated_at$/.test(c));
  const iPatch = callsNow.findIndex((c) => /^PATCH \/rest\/v1\/subsell_configs\?user_id=eq\.uid-1&updated_at=eq\.s1$/.test(c));
  const iPull = callsNow.findIndex((c, i) => i > iPatch && /^GET \/rest\/v1\/subsell_configs\?select=config,updated_at,config_key$/.test(c));
  ok(iGet >= 0 && iPatch > iGet && iPull > iPatch && callsNow.filter((c) => /^PATCH /.test(c)).length === 1 && !callsNow.some((c) => /^POST \/rest\/v1\/subsell_configs/.test(c)), "the worker read the row, wrote on its stamp once, then pulled its own choice; never the whole-row save");
  ok(await evalIn(w, 'getSettings().then((s) => { const a = adVideoPick(s, "iPhone 13 Pro 256 Go", s.machineId), b = adVideoPick(s, "iPhone 13 Pro Max 256 Go", s.machineId), c = adVideoPick(s, "iPhone 13 Pro 256 Go", "PC-other"); return !!a && a.exact === true && !b && !c; })'), "this computer's settings now give that ad its video, and neither the 13 Pro Max nor another computer");
  const c8 = await askP({ type: "CHAT_CLIPS", threadId: "n1", threadName: "Buyer · iPhone 13 Pro 256 Go 650$", served: false });
  const c9 = await askP({ type: "CHAT_CLIPS", threadId: "n2", threadName: "Buyer · iPhone 13 Pro Max 256 Go", served: false });
  ok(!!c8 && c8.set === mineSet.id && c8.clips.length === 1 && /boot-demo\.mp4$/.test(c8.clips[0].url) && !!c9 && c9.set === "" && c9.clips === null, "CHAT_CLIPS, as content.js asks it: a new chat on that ad gets the choice, a chat on the 13 Pro Max gets the general list");
  ok(/^2 ads on this Chrome · 1 has its own video$/.test(await inMy('document.getElementById("sum").textContent')) && /✓ Saved: boot-demo\.mp4/.test(await inMy('document.querySelector(".status.ok").textContent')), "the page shows the ad's own video and says it is saved");
  ok(/videos: central=1 adSets=2 mine=1/.test(await evalIn(w, "buildDiagnostic()")), "the diagnostic counts this computer's own choice (mine=1)");
  const dropped = await askMy({ type: "MYADS_DROP", setId: mineSet.id });
  const refusedWeb = await askMy({ type: "MYADS_DROP", setId: "mac" });
  const rowEnd = JSON.parse(await evalIn(w, "JSON.stringify(self.__row)"));
  ok(!!dropped && dropped.ok === true && !!refusedWeb && refusedWeb.ok === false && rowEnd.config.adVideoSets.length === 1 && rowEnd.config.adVideoSets[0].id === "mac", "taking the choice back removes it from the row; the web app's set cannot be removed from a computer's page");
  const c10 = await askP({ type: "CHAT_CLIPS", threadId: "n1", threadName: "Buyer · iPhone 13 Pro 256 Go 650$", served: true });
  ok(!!c10 && c10.gone === true && c10.clips.length === 0, "…and the chat that was served on it keeps what it has: nothing more is sent");
  // the popup's delay slider: ONE key into the row through the same narrow writer (never the whole row)
  const patchN = async () => JSON.parse(await evalIn(w, "JSON.stringify(self.__calls)")).filter((c) => /^PATCH /.test(c)).length;
  const pBefore = await patchN();
  const sd = await askP({ type: "SET_DELAY", sec: 45 });
  const rowSd = JSON.parse(await evalIn(w, "JSON.stringify(self.__row)"));
  ok(!!sd && sd.ok === true && rowSd.config.responseDelaySec === 45 && rowSd.config.apiKey === "sk-test" && rowSd.config.businessInfo === "Shop." && rowSd.config.adVideoSets.length === 1 && (await patchN()) === pBefore + 1, "SET_DELAY from the popup writes the one key into the row on its stamp; the key, the teaching and the video sets stand");
  const sd2 = await askP({ type: "SET_DELAY", sec: 45 });
  ok(!!sd2 && sd2.ok === true && sd2.same === true && (await patchN()) === pBefore + 1 && (await evalIn(w, "getSettings().then((s) => s.responseDelaySec === 45)")), "…the same delay again writes nothing, and this computer reads the new delay at once");
  // the update gate: Settings / the popup open hold a store update as before; "Videos for my ads" holds it only in use
  ok((await evalIn(w, "storeUpdUiOpen()")) === true, "with Settings and the popup open, an update waits (as before)");
  await get("/json/close/" + pop.id);
  await get("/json/close/" + optT.id);
  await sleep(700);
  const ctxNow = await evalIn(w, 'chrome.runtime.getContexts({ contextTypes: ["TAB", "POPUP"] }).then((c) => c.map((x) => x.contextType + " " + String(x.documentUrl).split("/").pop()).join(","))');
  await inMy('Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); true');
  const gateIdle = await evalIn(w, "storeUpdUiOpen()");
  await inMy('Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("pointerdown")); true');
  const gateUsed = await evalIn(w, "storeUpdUiOpen()");
  ok(ctxNow === "TAB myads.html" && gateIdle === false && gateUsed === true, "with only “Videos for my ads” open (" + ctxNow + "): left alone it holds nothing (" + gateIdle + "), in use it holds the update (" + gateUsed + ")");
  const myErr = my.events.filter((e) => e.method === "Runtime.exceptionThrown");
  ok(myErr.length === 0, "no uncaught exception in the page" + (myErr.length ? " — " + JSON.stringify(myErr[0].params.exceptionDetails).slice(0, 300) : ""));
  my.close();
  stor.close();
  p.close(); w.close();
} catch (e) {
  ok(false, "boot threw: " + (e && e.message));
} finally {
  await closeBrowserOnPort();
  try { edge.kill(); } catch (e) { /* ignore */ }
  await sleep(500);
  try { fs.rmSync(stage, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true }); } catch (e) { /* profile may be locked a moment */ }
}
console.log("\n" + (failed ? failed + " CHECK(S) FAILED" : "all checks passed"));
process.exit(failed ? 1 : 0);
