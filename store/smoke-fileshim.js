/* Tests the page-world file-picker shim (background.js pageArmFileShim) — the
 * mechanism v0.21.57 relies on to attach a clip on a Messenger build that creates
 * its <input type=file> only when its own attach button is clicked.
 *
 * The properties that matter:
 *   1. When Messenger clicks its file input, the shim fills it and the ORIGINAL
 *      click is never called — that is what makes an OS file dialog impossible.
 *   2. When the shim is not armed (or has expired), the original click runs
 *      untouched, so we never permanently alter the page.
 *   3. (v0.21.77) EACH ARM HANDS OVER ITS OWN CLIP, ONCE. Before .77 a second arm
 *      inside the first one's life only renewed the timer and kept the FIRST clip
 *      in its closure — clip 3 of a set went out as a second copy of clip 2 and
 *      clip 3 never reached Messenger (the owner's double / missing videos). A
 *      second click on one arm gets nothing; an old shim's timer can never unhook
 *      a newer one; a spent shim hands nothing over; nothing is ever delivered
 *      after the shim was taken down.
 *
 * Run:  node store/smoke-fileshim.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const start = src.indexOf("async function pageArmFileShim(");
if (start < 0) { console.error("pageArmFileShim not found in background.js"); process.exit(1); }
const end = src.indexOf("\nfunction pageShimStatus(", start);
if (end < 0) { console.error("end of pageArmFileShim not found"); process.exit(1); }
const fnSrc = src.slice(start, end);
const sp0 = src.indexOf("\nfunction pageSpendFileShim(");
const spendSrc = sp0 >= 0 ? src.slice(sp0, src.indexOf("\n}\n", sp0 + 1) + 3) : "";

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

(async () => {
  // --- minimal page stubs ---
  let realClickCalls = 0;
  class FakeInput {
    constructor(type) { this.type = type; this.files = null; this._events = []; this.listening = true; }
    dispatchEvent(e) { if (this.listening) this._events.push(e.type); return true; }
  }
  const HTMLInputElement = { prototype: { click() { realClickCalls++; return "REAL-CLICK"; } } };
  const events = [];
  class Event { constructor(t) { this.type = t; } }
  class DataTransfer {
    constructor() { this.items = { _f: [], add: (f) => this.items._f.push(f) }; }
    get files() { return this.items._f; }
  }
  class File {
    constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = (opts || {}).type; this.size = (parts && parts[0] && parts[0].size) || 0; }
  }
  const sizeOf = {}; // blob URL -> byte size served by the fake fetch
  const win = {
    __subsellShim: null,
    showOpenFilePicker: async () => "REAL-PICKER",
  };

  const sandbox = {
    window: win, HTMLInputElement, Event, DataTransfer, File,
    fetch: async (u) => ({ blob: async () => ({ fake: "blob", size: sizeOf[u] || 1000 }) }),
    setTimeout, Date,
  };
  // expose window props as globals the way a page does
  const arm = new Function(
    "window", "HTMLInputElement", "Event", "DataTransfer", "File", "fetch", "setTimeout", "Date",
    fnSrc + "; return pageArmFileShim;"
  )(sandbox.window, sandbox.HTMLInputElement, sandbox.Event, sandbox.DataTransfer, sandbox.File, sandbox.fetch, sandbox.setTimeout, sandbox.Date);

  const spendPage = spendSrc ? new Function("window", spendSrc + "; return pageSpendFileShim;")(win) : null;
  const before = HTMLInputElement.prototype.click;
  const res = await arm("blob:fake", "demo.mp4", "video/mp4", 5000);
  ok(res && res.ok === true, "shim arms cleanly");
  ok(HTMLInputElement.prototype.click !== before, "HTMLInputElement.prototype.click is overridden while armed");

  // 1. Messenger clicks ITS file input -> we fill it, and never open a dialog
  const inp = new FakeInput("file");
  inp.listening = false; // Messenger attaches its change listener AFTER calling click() — a real dialog never answers synchronously
  const r1 = HTMLInputElement.prototype.click.call(inp);
  ok(realClickCalls === 0, "the ORIGINAL click is NEVER called for a file input (no OS dialog is possible)");
  ok(r1 === undefined, "the shimmed click returns without a value, like a real one");
  ok(!inp.files && (win.__subsellShimFired || 0) === 0, "(v0.21.67) nothing is delivered synchronously inside click() — like a real dialog");
  inp.listening = true; // the listener Messenger adds right after click() returns
  await new Promise((r) => setTimeout(r, 150));
  ok(inp.files && inp.files.length === 1 && inp.files[0].name === "demo.mp4", "our clip was placed on the input Messenger clicked");
  ok(inp._events.includes("change"), "a change event reaches a listener attached AFTER click() returned");
  ok((win.__subsellShimFired || 0) === 1, "the fire is counted, so the machine can report whether Messenger ever asked for a file");
  ok(win.__subsellShimInfo && win.__subsellShimInfo.connected === false && win.__subsellShimInfo.react === false, "(v0.21.67) the input Messenger clicked is described for the doctor (here: detached, native)");

  // 2. A NON-file input must be untouched
  const txt = new FakeInput("text");
  const r2 = HTMLInputElement.prototype.click.call(txt);
  ok(realClickCalls === 1 && r2 === "REAL-CLICK", "a non-file input still gets the real click");

  // 1b. (v0.21.77) ONE FILE PER ARM: Messenger clicking its input again gets nothing — no copy, no dialog
  const rc0 = realClickCalls; // section 2 above made one deliberate real click (a text input)
  const inpAgain = new FakeInput("file");
  const rAgain = HTMLInputElement.prototype.click.call(inpAgain);
  await new Promise((r) => setTimeout(r, 150));
  ok(rAgain === undefined && !inpAgain.files, "(v0.21.77) a second file-input click on the same arm receives NO file (one hand-over per clip)");
  ok(realClickCalls === rc0, "(v0.21.77) …and still no real click (no dialog)");
  ok((win.__subsellShimFired || 0) === 1 && (win.__subsellShimSwallowed || 0) === 1, "(v0.21.77) the swallowed click is counted, the hand-over count stays 1");

  // 3. showOpenFilePicker: after the arm's one hand-over it answers like a cancelled dialog
  let pickErr = null;
  try { await win.showOpenFilePicker(); } catch (e) { pickErr = e; }
  ok(pickErr && pickErr.name === "AbortError", "(v0.21.77) showOpenFilePicker after the hand-over rejects like a cancelled dialog (no second copy)");
  // …and on a fresh arm it returns our clip instead of a dialog
  const resPick = await arm("blob:pick", "pick.mp4", "video/mp4", 5000);
  ok(resPick && resPick.ok && resPick.replaced === true, "(v0.21.77) arming while a shim is alive REPLACES it and says so (replaced:true)");
  const handles = await win.showOpenFilePicker();
  ok(Array.isArray(handles) && handles.length === 1, "showOpenFilePicker returns one handle instead of opening a dialog");
  const got = await handles[0].getFile();
  ok(got && got.name === "pick.mp4", "that handle yields the clip of THIS arm");

  // 5. (v0.21.77) THE BUG: clip 2 armed, then clip 3 armed inside clip 2's life.
  //    Messenger must be handed clip 3 — before .77 it got clip 2 again.
  const resC2 = await arm("blob:c2", "clip2.mp4", "video/mp4", 20000);
  const in2 = new FakeInput("file");
  HTMLInputElement.prototype.click.call(in2);
  await new Promise((r) => setTimeout(r, 150));
  ok(resC2.ok && in2.files && in2.files[0].name === "clip2.mp4", "clip 2's arm hands over clip 2");
  const resC3 = await arm("blob:c3", "clip3.mp4", "video/mp4", 20000);
  ok(resC3.ok && resC3.replaced === true && !resC3.already, "(v0.21.77) clip 3's arm inside clip 2's life rebuilds the shim (no 'already' renewal)");
  const in3 = new FakeInput("file");
  HTMLInputElement.prototype.click.call(in3);
  await new Promise((r) => setTimeout(r, 150));
  ok(in3.files && in3.files.length === 1 && in3.files[0].name === "clip3.mp4", "(v0.21.77) Messenger is handed CLIP 3, not a second copy of clip 2");
  ok(realClickCalls === rc0, "(v0.21.77) no real click anywhere in the sequence");
  ok((win.__subsellShimFired || 0) === 1, "(v0.21.77) the counters belong to the new arm (fired=1 for clip 3, not clip 2's leftover)");

  // 6. (v0.21.77) an OLD shim's timer can never unhook a NEWER one
  const resA = await arm("blob:old", "old.mp4", "video/mp4", 300); // its own timer: max(300, 1000) + 500 = 1500 ms
  const restoreA = win.__subsellShim.restore;
  const resB = await arm("blob:new", "new.mp4", "video/mp4", 5000);
  await new Promise((r) => setTimeout(r, 1700)); // past the old shim's timer
  restoreA(); // and the old shim's restore called late, by hand, on top
  ok(win.__subsellShim && HTMLInputElement.prototype.click !== before, "(v0.21.77) the old shim's timer AND a late call of its restore leave the new shim installed");
  const inB = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inB);
  await new Promise((r) => setTimeout(r, 150));
  ok(resA.ok && resB.ok && inB.files && inB.files[0].name === "new.mp4", "(v0.21.77) after the old shim's timer ran, the new shim still intercepts and hands over the new clip");
  ok(realClickCalls === rc0, "(v0.21.77) …so no dialog can open while the new shim is meant to be armed");

  // 7. (v0.21.77) spend(): the engine moved on — a late click gets nothing, and no dialog
  await arm("blob:spent", "spent.mp4", "video/mp4", 5000);
  win.__subsellShim.spend();
  const inS = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inS);
  await new Promise((r) => setTimeout(r, 150));
  ok(!inS.files && realClickCalls === rc0, "(v0.21.77) a spent shim hands nothing over and still opens no dialog");

  // 8. (v0.21.77) a delivery pending when the shim is taken down never lands (no stale file)
  await arm("blob:pend", "pending.mp4", "video/mp4", 5000);
  const inP = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inP); // delivery is scheduled 60 ms out
  win.__subsellShim.restore();                // taken down inside that window
  await new Promise((r) => setTimeout(r, 150));
  ok(!inP.files, "(v0.21.77) nothing is delivered after the shim was taken down");
  ok(HTMLInputElement.prototype.click === before, "(v0.21.77) restore leaves the native click in place");
  // 10. (v0.21.77) an exception inside the shimmed click never falls through to the real click
  await arm("blob:throw", "t.mp4", "video/mp4", 5000);
  const rcT = realClickCalls;
  const inT = new FakeInput("file");
  inT.getAttribute = () => { throw new Error("boom"); };
  const rT = HTMLInputElement.prototype.click.call(inT);
  ok(rT === undefined && realClickCalls === rcT && /boom/.test(win.__subsellShimErr || ""), "(v0.21.77) a throw inside the shimmed click records the error and still opens no dialog");
  win.__subsellShim.restore();

  // 11. (v0.21.77) spend() also cancels a hand-over that is already scheduled (the late-click race)
  await arm("blob:race", "race.mp4", "video/mp4", 5000);
  const inR = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inR); // Messenger's click: the hand-over is scheduled 60 ms out
  const spR = spendPage ? spendPage() : null; // the engine gives up on btn inside that window
  await new Promise((r) => setTimeout(r, 150));
  ok(spR && spR.fired === 0 && spR.seen === 1, "(v0.21.77) spend answers with the counters as of the spend (seen=1, not handed over yet)");
  ok(!inR.files, "(v0.21.77) …and the scheduled hand-over never lands — no copy behind the next channel's");
  win.__subsellShim.restore();

  // 12. (v0.21.77) a hand-over that completed just BEFORE the spend is reported by it (fired=1)
  sizeOf["blob:done"] = 123456;
  await arm("blob:done", "done.mp4", "video/mp4", 5000);
  const inD = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inD);
  await new Promise((r) => setTimeout(r, 150));
  const spD = spendPage ? spendPage() : null;
  ok(spD && spD.fired === 1 && inD.files && inD.files[0].name === "done.mp4", "(v0.21.77) a completed hand-over shows in spend's answer (the engine counts it as btn's dispatch)");
  ok(spD && spD.info && spD.info.size === 123456, "(v0.21.77) the shim records the exact size of the file it handed over");
  win.__subsellShim.restore();

  // 9. (v0.21.77) a shim left by a build before .77 (no spend(), its restore timer
  //    still running and uncancellable) is taken down, and btn sits its window out
  let legacyRestored = 0;
  win.__subsellShim = { renew() {}, restore() { legacyRestored++; win.__subsellShim = null; } };
  const resL1 = await arm("blob:l1", "l1.mp4", "video/mp4", 5000);
  ok(resL1 && resL1.ok === false && legacyRestored === 1 && resL1.legacyWaitMs > 19000 && resL1.legacyWaitMs <= 21000, "(v0.21.77) an older build's live shim is restored and the arm asks the engine to wait it out (legacyWaitMs ~21 s)");
  ok(HTMLInputElement.prototype.click === before, "(v0.21.77) …and nothing of ours is installed over it");
  const resL2 = await arm("blob:l2", "l2.mp4", "video/mp4", 5000);
  ok(resL2 && resL2.ok === false && resL2.legacyWaitMs > 0, "(v0.21.77) the next arm inside that 21-s window waits too (its old timer may still fire)");
  win.__subsellShimLegacyUntil = Date.now() - 1; // the window has passed
  const resL3 = await arm("blob:l3", "l3.mp4", "video/mp4", 5000);
  ok(resL3 && resL3.ok === true && resL3.replaced === false, "(v0.21.77) after it, arming works normally again");
  win.__subsellShim.restore();

  await arm("blob:last", "demo.mp4", "video/mp4", 5000);

  // 4. Disarming restores the page exactly
  win.__subsellShim.restore();
  ok(HTMLInputElement.prototype.click === before, "prototype click is restored on disarm");
  const inp2 = new FakeInput("file");
  HTMLInputElement.prototype.click.call(inp2);
  ok(realClickCalls === 2, "after disarm a file input gets the real click again (page left as we found it)");
  ok((await win.showOpenFilePicker()) === "REAL-PICKER", "showOpenFilePicker is restored on disarm");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
