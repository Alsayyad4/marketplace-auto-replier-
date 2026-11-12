// Headless boot of the v0.21.96 STORE build (same staging as store/build-webstore-zip.ps1): the real
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
for (const f of ["content.js", "options.html", "options.js", "popup.html", "popup.js", "managed_schema.json", "icon16.png", "icon48.png", "icon128.png"]) fs.copyFileSync(path.join(root, f), path.join(stage, f));
execFileSync("node", [path.join(root, "store/webstore-background.js"), path.join(root, "background.js"), path.join(stage, "background.js")], { stdio: "inherit" });
execFileSync("node", [path.join(root, "store/webstore-manifest.js"), path.join(root, "manifest.json"), path.join(stage, "manifest.json")], { stdio: "inherit" });
const mf = JSON.parse(fs.readFileSync(path.join(stage, "manifest.json"), "utf8"));
ok(mf.version === "0.21.96" && !mf.key && mf.name === "Liquidation Téléphone Montréal Auto-Reply", "store manifest: v" + mf.version + ", no key, name '" + mf.name + "'");

const get = (p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }).on("error", rej));
const put = (p) => new Promise((res, rej) => { const q = http.request({ host: "127.0.0.1", port: PORT, path: p, method: "PUT" }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }); q.on("error", rej); q.end(); });
const WS = globalThis.WebSocket;
async function cdp(wsUrl) {
  const ws = new WS(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws error")); });
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method) events.push(m); };
  return { events, send: (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }), close: () => { try { ws.close(); } catch (e) { /* ignore */ } } };
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
    await Promise.race([b.send("Browser.close"), sleep(3000)]);
    b.close();
    for (let i = 0; i < 20; i++) { await sleep(300); try { await get("/json/version"); } catch (e) { return true; } }
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
      const c = await cdp(t.webSocketDebuggerUrl);
      let name = "";
      try { name = await evalIn(c, 'chrome.runtime.getManifest().name'); } catch (e) { /* not ours or not ready */ }
      if (name === mf.name) { worker = t; w = c; break; }
      c.close();
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
  ok(/clip=asked/.test(diag) && !theatreField && /Marketplace Auto-Reply v0.21.96/.test(diag), "the 🩺 reads clip=asked, no timing-theatre fields, header renamed" + (theatreField ? " — found: " + theatreField : ""));
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
  ok(/Ads with: macbook air, macbook pro — m\.mp4 — every computer/.test(adList) && /Ads with: s24 ultra — s\.mp4 — other computers, not this one/.test(adList), "Settings lists the sets read-only and says which apply on this computer: " + adList);
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
