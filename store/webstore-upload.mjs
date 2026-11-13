// node store/webstore-upload.mjs [zip] — the Chrome Web Store upload over raw CDP against the signed-in 9223 Chrome
// (v0.21.95, from the cws93 driver): raises the console window first (an occluded window = a hidden tab = the
// upload dialog never paints), then "Upload new package" → waits up to 25 s for "Select file" → the intercepted
// chooser → DOM.setFileInputFiles → waits for the Package page to show the new version. The post-upload page
// read may throw a TypeError while the page reloads: harmless, verify on the Package page. Submit = the owner.
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
const PORT = 9223;
const ITEM = "ipompokpmlhgaioihnlbnmnhendcnejo", PUB = "629bdbe9-443c-4d1b-b4a0-7c7bf5020fc1";
const BASE = "https://chrome.google.com/webstore/devconsole/" + PUB + "/" + ITEM + "/edit";
const get = (p) => new Promise((res, rej) => http.get({ host: "127.0.0.1", port: PORT, path: p }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(d)); }).on("error", rej));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function cdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error("ws error")); });
  let id = 0; const pend = new Map(); const handlers = {};
  ws.onmessage = (ev) => { const m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } else if (m.method && handlers[m.method]) handlers[m.method](m.params); };
  return { send: (method, params) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); }), on: (m, h) => { handlers[m] = h; }, close: () => ws.close() };
}
async function evalIn(c, expression) {
  const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result && r.result.exceptionDetails) throw new Error("eval: " + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result && r.result.result ? r.result.result.value : undefined;
}
const FIND = (txt) => `(() => {
  const want = ${JSON.stringify(txt)}.trim().toLowerCase();
  const all = Array.from(document.querySelectorAll('button, [role="button"], a, [role="menuitem"], [role="tab"], label, span, div'));
  const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none"; };
  const txtOf = (el) => (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().toLowerCase();
  let cands = all.filter((el) => vis(el) && txtOf(el) === want);
  cands.sort((a, b) => { const ca = /^(BUTTON|A)$/.test(a.tagName) || a.getAttribute("role") === "button" ? 0 : 1; const cb = /^(BUTTON|A)$/.test(b.tagName) || b.getAttribute("role") === "button" ? 0 : 1; if (ca !== cb) return ca - cb; return a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height; });
  const el = cands[0];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName, text: txtOf(el).slice(0, 60), n: cands.length };
})()`;
const BUTTONS = `Array.from(document.querySelectorAll("button, [role=button], label, input[type=file]")).filter((e) => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2; }).map((e) => e.tagName + ":" + ((e.innerText || e.textContent || e.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 50))).join(" | ")`;
async function click(c, txt) {
  const hit = await evalIn(c, FIND(txt));
  if (!hit) return null;
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hit.x, y: hit.y });
  await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: hit.x, y: hit.y, button: "left", clickCount: 1 });
  return hit;
}
const pageText = (c) => evalIn(c, '(document.body.innerText || "").replace(/\\n{2,}/g, "\\n").slice(0, 3000)');
const zip = path.resolve(process.argv[2] || "C:/Users/hovig/projects/marketplace-auto-replier/dist/subsell-webstore.zip");
const list = JSON.parse(await get("/json/list"));
const tab = list.find((t) => t.type === "page" && /webstore\/devconsole/.test(t.url));
if (!tab) { console.log("no devconsole tab"); process.exit(1); }
// the window must be a normal, visible window for Chrome to run a file chooser (a minimized window freezes the tab)
try {
  const ver = JSON.parse(await get("/json/version"));
  const b = await cdp(ver.webSocketDebuggerUrl);
  const w = await b.send("Browser.getWindowForTarget", { targetId: tab.id });
  console.log("window before:", JSON.stringify(w.result && w.result.bounds));
  if (w.result && w.result.bounds && w.result.bounds.windowState !== "normal" && w.result.bounds.windowState !== "maximized") {
    await b.send("Browser.setWindowBounds", { windowId: w.result.windowId, bounds: { windowState: "normal" } });
    await sleep(1000);
  }
  const w2 = await b.send("Browser.getWindowForTarget", { targetId: tab.id });
  console.log("window after:", JSON.stringify(w2.result && w2.result.bounds));
  b.close();
} catch (e) { console.log("window check failed: " + e.message); }
const c = await cdp(tab.webSocketDebuggerUrl);
await c.send("Runtime.enable"); await c.send("Page.enable");
await c.send("Page.bringToFront");
await sleep(1500);
const visState = () => evalIn(c, "document.visibilityState + \" focus=\" + document.hasFocus() + \" \" + innerWidth + \"x\" + innerHeight + \" dpr=\" + devicePixelRatio");
console.log("visibility:", await visState());
// an occluded (covered) window counts as hidden and Chrome stops its rendering, so the console's dialog never
// paints: minimize → restore → maximize raises the window above the others
if (/^hidden/.test(await visState())) {
  try {
    const ver = JSON.parse(await get("/json/version"));
    const b = await cdp(ver.webSocketDebuggerUrl);
    const w = await b.send("Browser.getWindowForTarget", { targetId: tab.id });
    const wid = w.result.windowId;
    await b.send("Browser.setWindowBounds", { windowId: wid, bounds: { windowState: "minimized" } }); await sleep(700);
    await b.send("Browser.setWindowBounds", { windowId: wid, bounds: { windowState: "normal" } }); await sleep(700);
    await b.send("Browser.setWindowBounds", { windowId: wid, bounds: { windowState: "maximized" } }); await sleep(1200);
    b.close();
  } catch (e) { console.log("raise failed: " + e.message); }
  await c.send("Page.bringToFront");
  await sleep(1500);
  console.log("visibility after raise:", await visState());
}
if (/^hidden/.test(await visState())) { console.log("the tab is still hidden (the window is covered or minimized): bring the 9223 Chrome window to the front and run again"); process.exit(3); }
if (!/\/edit\/package/.test(tab.url)) { await c.send("Page.navigate", { url: BASE + "/package" }); await sleep(6000); }
await c.send("Page.setInterceptFileChooserDialog", { enabled: true });
let chooser = null;
c.on("Page.fileChooserOpened", (p) => { chooser = p; });
const b1 = await click(c, "Upload new package");
console.log("clicked:", JSON.stringify(b1));
let b2 = null;
for (let i = 0; i < 50 && !chooser && !b2; i++) { await sleep(500); b2 = await click(c, "Select file"); }
console.log("select file:", JSON.stringify(b2));
for (let i = 0; i < 40 && !chooser; i++) await sleep(250);
if (!chooser) { console.log("the file chooser never opened; visible controls now: " + (await evalIn(c, BUTTONS))); process.exit(2); }
await c.send("DOM.enable");
const set = await c.send("DOM.setFileInputFiles", { files: [zip], backendNodeId: chooser.backendNodeId });
console.log("file set:", JSON.stringify(set).slice(0, 200));
let shown = false;
// (v0.21.96) the version being uploaded = the repo's manifest; the Package page must show it (the Draft's version)
const VER = JSON.parse(fs.readFileSync(new URL("../manifest.json", import.meta.url), "utf8")).version;
for (let i = 0; i < 75; i++) { await sleep(2000); const t = await pageText(c); if (t.indexOf(VER) >= 0) { console.log("page shows " + VER + " after " + (i + 1) * 2 + " s"); shown = true; break; } }
const t = await pageText(c);
const i = t.indexOf("Status");
console.log((shown ? "OK" : "NOT SEEN") + "\n" + t.slice(Math.max(0, i), i + 600));
c.close();
process.exit(0);
