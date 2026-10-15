/* (v0.21.77) The "btn" attach channel END TO END: content.js btnFn (the real source)
 * driving the real page functions of background.js (pageArmFileShim, pageShimStatus,
 * pageSpendFileShim, pageDisarmFileShim) in a fake page where "Messenger" answers a
 * click on its attach button by creating an <input type=file>, calling click() on it
 * and listening for change right after.
 *
 * The law under test: btn returns TRUE exactly when Messenger was handed the clip, and
 * when it returns FALSE nothing of that clip ever lands afterwards (the engine then
 * tries the next channel — a late copy would be a second clip in the chat). Plus the
 * bug of .76 and before seen through btnFn: clip 2 then clip 3 back to back must hand
 * over clip 2 then clip 3. No real click (= Windows file dialog) anywhere.
 *
 * btnFn's own sleeps run at 1/4 speed here (TIME), the page's timers at real speed.
 * Run:  node store/smoke-btnshim.js
 */
const fs = require("fs");
const path = require("path");

const bg = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const ct = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const pageFn = (name, isAsync) => {
  const head = (isAsync ? "async function " : "function ") + name + "(";
  const a = bg.indexOf("\n" + head);
  if (a < 0) { console.error(name + " not found in background.js"); process.exit(1); }
  const b = bg.indexOf("\n}\n", a + 1);
  return bg.slice(a + 1, b + 2);
};
const b0 = ct.indexOf("    const btnFn = async () => {");
const b1 = ct.indexOf("\n    btnFnRef = btnFn;", b0);
if (b0 < 0 || b1 < 0) { console.error("btnFn not found in content.js"); process.exit(1); }
const btnSrc = ct.slice(b0, b1);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const TIME = 0.25;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // ---- the fake page ----
  let realClickCalls = 0;
  class FakeInput {
    constructor(type) { this.type = type; this.files = null; this.listening = false; this.changes = 0; }
    dispatchEvent(e) { if (this.listening && e.type === "change") this.changes++; return true; }
    getAttribute() { return "video/*"; }
  }
  const HTMLInputElement = { prototype: { click() { realClickCalls++; return "REAL-CLICK"; } } };
  class Event { constructor(t) { this.type = t; } }
  class DataTransfer { constructor() { this.items = { _f: [], add: (f) => this.items._f.push(f) }; } get files() { return this.items._f; } }
  class File { constructor(parts, name, opts) { this.name = name; this.type = (opts || {}).type; this.size = (parts && parts[0] && parts[0].size) || 0; } }
  const sizeOf = {};
  const win = { __subsellShim: null, showOpenFilePicker: async () => "REAL-PICKER" };
  let throttle = 0; // > 0: the page's short timers (the 60-ms hand-over) run this late (a throttled tab)
  const pageSetTimeout = (fn, ms) => { const t = setTimeout(fn, ms < 100 && throttle ? throttle : ms); if (ms >= 5000 && t.unref) t.unref(); return t; };
  const pageFetch = async (u) => ({ blob: async () => ({ size: sizeOf[u] || 0 }) });
  const mkPage = (src, ret) => new Function("window", "HTMLInputElement", "Event", "DataTransfer", "File", "fetch", "setTimeout", "clearTimeout", "Date", src + "; return " + ret + ";")(win, HTMLInputElement, Event, DataTransfer, File, pageFetch, pageSetTimeout, clearTimeout, Date);
  const page = {
    arm: mkPage(pageFn("pageArmFileShim", true), "pageArmFileShim"),
    status: mkPage(pageFn("pageShimStatus"), "pageShimStatus"),
    spend: mkPage(pageFn("pageSpendFileShim"), "pageSpendFileShim"),
    disarm: mkPage(pageFn("pageDisarmFileShim"), "pageDisarmFileShim"),
  };
  const ask = async (msg) => {
    if (msg.type === "ARM_FILE_SHIM") return page.arm(msg.url, msg.name, msg.mime, msg.ms);
    if (msg.type === "SHIM_STATUS") {
      if (msg.disarm) { page.disarm(); return { ok: true, status: true }; }
      if (msg.spend) return { ok: true, status: page.spend() };
      return { ok: true, status: page.status() };
    }
    return { ok: false, error: "unexpected " + msg.type };
  };

  // ---- "Messenger": its attach button makes an input, clicks it, then listens ----
  let messengerClicks = true;
  const inputs = [];
  let attachClicks = 0;
  const attachEl = {
    click() {
      attachClicks++;
      if (!messengerClicks) return;
      const inp = new FakeInput("file");
      inputs.push(inp);
      HTMLInputElement.prototype.click.call(inp);
      inp.listening = true; // a dialog never answers synchronously
    },
  };
  const delivered = (inp) => (inp && inp.files && inp.files.length ? inp.files[0].name : null);

  // ---- btnFn, the real source, with its content-script surroundings stubbed ----
  const stats = {};
  const statuses = [];
  let onThread = true;
  let blobN = 0;
  const makeBtn = (clip) => new Function("env", `
    const { ensureFile, findAttachControl, setStatus, URL, ask, trunc, bumpChannelStats, safe, sleep, findAttachMenuItem, tid, stillOnThread, setTimeout } = env;
    let lastShimFired = 0, lastShimSeen = 0, lastShimInfo = null;
    ` + btnSrc + `
    return { btnFn, shim: () => ({ lastShimFired, lastShimSeen, lastShimInfo }) };
  `)({
    ensureFile: async () => clip,
    findAttachControl: () => ({ el: attachEl, more: false }),
    setStatus: (o) => statuses.push(o),
    URL: { createObjectURL: (f) => { const u = "blob:t-" + (++blobN); sizeOf[u] = f.served || f.size; return u; }, revokeObjectURL() {} },
    ask,
    trunc: (s, n) => String(s).slice(0, n),
    bumpChannelStats: (ch, mut) => { const e = stats[ch] || (stats[ch] = {}); mut(e); },
    safe: (fn, d) => { try { return fn(); } catch (e) { return d; } },
    sleep: (ms) => wait(ms * TIME),
    findAttachMenuItem: () => null,
    tid: "T1",
    stillOnThread: () => onThread,
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) t.unref(); return t; },
  });
  const clip = (name, size, served) => ({ name, type: "video/mp4", size, served });
  const reset = () => { try { if (win.__subsellShim) win.__subsellShim.restore(); } catch (e) { /* ignore */ } win.__subsellShimLegacyUntil = 0; throttle = 0; messengerClicks = true; onThread = true; inputs.length = 0; attachClicks = 0; };

  // A. the normal case
  reset();
  const A = makeBtn(clip("clip1.mp4", 3000000));
  const rA = await A.btnFn();
  ok(rA === true && delivered(inputs[0]) === "clip1.mp4" && A.shim().lastShimFired === 1, "A. Messenger clicks its input → btn returns true and Messenger holds clip 1");

  // B. THE BUG, through btnFn: clip 2 then clip 3, back to back (inside clip 2's 20-s shim life)
  reset();
  const rB2 = await makeBtn(clip("clip2.mp4", 15000000)).btnFn();
  const rB3 = await makeBtn(clip("clip3.mp4", 7000000)).btnFn();
  ok(rB2 === true && rB3 === true && delivered(inputs[0]) === "clip2.mp4" && delivered(inputs[1]) === "clip3.mp4", "B. clip 2 then clip 3 back to back → Messenger is handed clip 2, then CLIP 3 (not clip 2 again)");
  ok(stats.btn && stats.btn.rearm === 1, "B. the second arm is counted as a replaced live shim (🩺 [rearm=1])");
  ok(!stats.btn.wrongFile, "B. no wrong-file evidence on a correct hand-over");

  // C. Messenger never clicks → false, and a LATE click afterwards gets nothing
  reset();
  messengerClicks = false;
  const rC = await makeBtn(clip("clipC.mp4", 1000000)).btnFn();
  const late = new FakeInput("file");
  HTMLInputElement.prototype.click.call(late);
  late.listening = true;
  await wait(200);
  ok(rC === false && !delivered(late), "C. Messenger never clicked → btn returns false, and a late click is handed nothing (no copy behind the next channel)");
  ok(realClickCalls === 0, "C. …and no real click (no dialog)");

  // D. a throttled tab: the hand-over runs after btn's ten polls, inside the grace polls
  reset();
  throttle = 1200; // ten polls = 1.0 s here, the grace polls run to 1.4 s
  const rD = await makeBtn(clip("clipD.mp4", 1000000)).btnFn();
  ok(rD === true && delivered(inputs[0]) === "clipD.mp4", "D. a hand-over that lands late (throttled tab) is still btn's dispatch → true");

  // E. a very throttled tab: the hand-over would run after btn gave up → spend cancels it
  reset();
  throttle = 2500;
  const rE = await makeBtn(clip("clipE.mp4", 1000000)).btnFn();
  await wait(1600); // well past the scheduled hand-over
  ok(rE === false && inputs.length === 1 && !delivered(inputs[0]), "E. btn gave up before the scheduled hand-over → it returns false AND that hand-over never lands");
  ok(realClickCalls === 0, "E. …and no real click (no dialog)");

  // F. right after the update: a previous build's shim winding down → btn waits, then arms
  reset();
  win.__subsellShimLegacyUntil = Date.now() + 800;
  const t0 = Date.now();
  const rF = await makeBtn(clip("clipF.mp4", 1000000)).btnFn();
  ok(rF === true && Date.now() - t0 >= 800 && delivered(inputs[0]) === "clipF.mp4", "F. a winding-down older shim → btn waits it out, then hands the clip over (not lost to a channel that cannot stage it)");

  // G. …and when the operator leaves the chat during that wait, nothing is attached anywhere
  reset();
  win.__subsellShimLegacyUntil = Date.now() + 5000;
  setTimeout(() => { onThread = false; }, 300);
  const rG = await makeBtn(clip("clipG.mp4", 1000000)).btnFn();
  ok(rG === false && attachClicks === 0 && inputs.length === 0, "G. the chat changed during the wait → btn returns false without clicking anything");

  // H. exact evidence: the shim reports the size it handed over; a mismatch is named
  reset();
  const rH = await makeBtn(clip("clipH.mp4", 5000, 7777)).btnFn(); // the page fetched 7777 bytes for a 5000-byte clip
  ok(rH === true && stats.btn.wrongFile === 1 && statuses.some((s) => /7777 bytes for a 5000-byte clip/.test(s.videoLast || "")), "H. a hand-over of another size than the clip is recorded ([WRONGFILE=1] + a status line)");

  reset();
  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
