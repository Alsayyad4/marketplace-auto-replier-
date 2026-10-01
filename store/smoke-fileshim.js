/* Tests the page-world file-picker shim (background.js pageArmFileShim) — the
 * mechanism v0.21.57 relies on to attach a clip on a Messenger build that creates
 * its <input type=file> only when its own attach button is clicked.
 *
 * The two properties that matter:
 *   1. When Messenger clicks its file input, the shim fills it and the ORIGINAL
 *      click is never called — that is what makes an OS file dialog impossible.
 *   2. When the shim is not armed (or has expired), the original click runs
 *      untouched, so we never permanently alter the page.
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
    constructor(parts, name, opts) { this.parts = parts; this.name = name; this.type = (opts || {}).type; }
  }
  const win = {
    __subsellShim: null,
    showOpenFilePicker: async () => "REAL-PICKER",
  };

  const sandbox = {
    window: win, HTMLInputElement, Event, DataTransfer, File,
    fetch: async () => ({ blob: async () => ({ fake: "blob" }) }),
    setTimeout, Date,
  };
  // expose window props as globals the way a page does
  const arm = new Function(
    "window", "HTMLInputElement", "Event", "DataTransfer", "File", "fetch", "setTimeout", "Date",
    fnSrc + "; return pageArmFileShim;"
  )(sandbox.window, sandbox.HTMLInputElement, sandbox.Event, sandbox.DataTransfer, sandbox.File, sandbox.fetch, sandbox.setTimeout, sandbox.Date);

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

  // 3. showOpenFilePicker returns our clip instead of a dialog
  const handles = await win.showOpenFilePicker();
  ok(Array.isArray(handles) && handles.length === 1, "showOpenFilePicker returns one handle instead of opening a dialog");
  const got = await handles[0].getFile();
  ok(got && got.name === "demo.mp4", "that handle yields our clip");

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
