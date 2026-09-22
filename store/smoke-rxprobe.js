/* Tests the page-world REACTION PROBE (background.js pageArmReactionProbe, v0.21.67).
 *
 * Why this file exists: every attach verdict used to be read off the composer's
 * rendering or its send control — both silent while Messenger holds a clip it has
 * accepted but not yet staged (its decode parked on a hidden tab). The probe watches
 * the page's own hands instead: object URLs, blob reads, <video> sources, upload
 * bodies — and recognises OUR clip by its exact byte size. A clip Messenger read
 * must never be followed by a second copy; an unrelated video playing in the thread
 * must never make ours look "held".
 *
 * Under test:
 *   1. Every wrapped API still returns what the original returned (pass-through).
 *   2. Only a blob of OUR size counts; other blobs land in `other`; with no size
 *      known NOTHING counts (never a guess).
 *   3. A <video> counts (v/m/e) only when it is fed one of OUR object URLs — via the
 *      src property or the src attribute (React) — never for a foreign blob: source.
 *   4. Re-arming resets the counters; the status reports navigator.userActivation.
 *   5. Disarm (and the expiry timer) restore every prototype exactly.
 *
 * Run:  node store/smoke-rxprobe.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const start = src.indexOf("function pageArmReactionProbe(");
const end = src.indexOf("\nasync function armReactionProbe(", start);
if (start < 0 || end < 0) { console.error("pageArmReactionProbe block not found in background.js"); process.exit(1); }
const block = src.slice(start, end);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

(async () => {
  // --- a fake page ---
  const OUR = 3 * 1024 * 1024;
  class Blob { constructor(size) { this.size = size; } slice() { return "SLICED"; } arrayBuffer() { return "AB"; } stream() { return "STREAM"; } }
  class FileReader { readAsArrayBuffer(b) { return "FR:" + b.size; } readAsDataURL() { return "FRD"; } }
  class XMLHttpRequest { send() { return "SENT"; } }
  class FormData { append() { return "APPENDED"; } }
  let urlN = 0;
  const URL = { createObjectURL() { return "blob:made-" + (++urlN); } };
  class Element {
    constructor(tag) { this.tagName = tag; this._attrs = {}; }
    setAttribute(n, v) { this._attrs[n] = v; return "SET"; }
  }
  class HTMLMediaElement extends Element {
    constructor(tag) { super(tag); this._src = ""; this._ls = {}; }
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
    fire(t) { for (const f of this._ls[t] || []) f(); }
  }
  Object.defineProperty(HTMLMediaElement.prototype, "src", { configurable: true, enumerable: true, get() { return this._src; }, set(v) { this._src = v; } });
  const Document = { prototype: { createElement(tag) { return tag === "video" ? new HTMLMediaElement("VIDEO") : new Element(String(tag).toUpperCase()); } } };
  const document = Object.create(Document.prototype);
  const navigator = { userActivation: { hasBeenActive: false, isActive: false } };
  const realFetch = async () => "FETCHED";
  const win = { fetch: realFetch, FormData };

  const orig = {
    create: URL.createObjectURL, slice: Blob.prototype.slice, ab: Blob.prototype.arrayBuffer, stream: Blob.prototype.stream,
    fr: FileReader.prototype.readAsArrayBuffer, frd: FileReader.prototype.readAsDataURL, send: XMLHttpRequest.prototype.send,
    fd: FormData.prototype.append, sa: Element.prototype.setAttribute,
    src: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src"), ce: Document.prototype.createElement,
  };

  const api = new Function(
    "window", "URL", "Blob", "FileReader", "XMLHttpRequest", "HTMLMediaElement", "Element", "Document", "document", "navigator", "setTimeout", "clearTimeout", "Date",
    block + "; return { arm: pageArmReactionProbe, status: pageReactionStatus, disarm: pageDisarmReactionProbe };"
  )(win, URL, Blob, FileReader, XMLHttpRequest, HTMLMediaElement, Element, Document, document, navigator, setTimeout, clearTimeout, Date);

  // 1. arm
  const a = api.arm(OUR, 5000);
  ok(a && a.ok === true, "probe arms cleanly");
  ok(URL.createObjectURL !== orig.create && Document.prototype.createElement !== orig.ce && Element.prototype.setAttribute !== orig.sa, "the page APIs are wrapped while armed");
  let s = api.status();
  ok(s.armed === true && s.objUrl === 0 && s.read === 0 && s.up === 0, "fresh counters");

  // 2. object URLs — ours vs. other, and pass-through
  const ourUrl = URL.createObjectURL(new Blob(OUR));
  ok(/^blob:made-\d+$/.test(ourUrl), "createObjectURL still returns the original's value");
  const otherUrl = URL.createObjectURL(new Blob(10 * 1024));
  URL.createObjectURL(new Blob(OUR + 100)); // within the 4 KB tolerance (a re-wrapped File)
  s = api.status();
  ok(s.objUrl === 2 && s.other === 1, "only blobs of OUR size count as ours (" + s.objUrl + " ours / " + s.other + " other)");

  // 3. reads and uploads
  ok(new Blob(OUR).slice() === "SLICED" && new Blob(OUR).arrayBuffer() === "AB" && new Blob(OUR).stream() === "STREAM", "Blob reads pass through");
  ok(new FileReader().readAsArrayBuffer(new Blob(OUR)) === "FR:" + OUR && new FileReader().readAsDataURL(new Blob(OUR)) === "FRD", "FileReader reads pass through");
  new Blob(500).slice(); // not ours
  ok(new XMLHttpRequest().send(new Blob(OUR)) === "SENT", "XHR send passes through");
  ok((await win.fetch("https://x", { body: new Blob(OUR) })) === "FETCHED" && (await win.fetch("https://x")) === "FETCHED", "fetch passes through with and without a body");
  ok(new win.FormData().append("file", new Blob(OUR)) === "APPENDED" && new win.FormData().append("name", "x") === "APPENDED", "FormData.append passes through");
  s = api.status();
  ok(s.read === 5, "five reads of OUR clip counted, the small blob ignored (read=" + s.read + ")");
  ok(s.up === 3, "XHR body + fetch body + multipart part of OUR clip counted as uploads (up=" + s.up + ")");

  // 4. videos: only one fed OUR object URL counts, whether by property or attribute
  const v = document.createElement("video");
  ok(v instanceof HTMLMediaElement, "createElement still builds the real element");
  const img = document.createElement("img");
  ok(img.tagName === "IMG", "other elements untouched");
  v.src = otherUrl;                                   // a foreign blob: source (Facebook's own player, a buyer's clip)
  v.fire("loadedmetadata");
  s = api.status();
  ok(s.vidNew === 1 && s.vidSrc === 0 && s.meta === 0, "a <video> on a FOREIGN blob: URL is not ours (vidSrc=" + s.vidSrc + " meta=" + s.meta + ")");
  v.src = ourUrl;
  ok(v.src === ourUrl, "the src setter/getter still work");
  v.fire("loadedmetadata");
  const v2 = document.createElement("video");
  ok(v2.setAttribute("src", ourUrl) === "SET", "setAttribute passes through");
  v2.fire("error");
  const v3 = document.createElement("video");
  v3.setAttribute("src", "https://cdn.example/x.mp4"); // not a blob — not counted
  v3.fire("loadedmetadata");
  s = api.status();
  ok(s.vidNew === 3 && s.vidSrc === 2, "two videos fed OUR URL — one by property, one by attribute (vidNew=" + s.vidNew + " vidSrc=" + s.vidSrc + ")");
  ok(s.meta === 1 && s.err === 1, "one decoded (loadedmetadata), one failed (error) — the foreign/CDN videos never counted");

  // 5. user activation is reported alongside
  ok(s.userAct && s.userAct.been === false, "status reports no sticky activation yet");
  navigator.userActivation.hasBeenActive = true;
  ok(api.status().userAct.been === true, "…and sees it once the page has one");

  // 6. re-arm resets (and forgets the earlier URLs)
  const a2 = api.arm(OUR, 5000);
  s = api.status();
  ok(a2.ok && a2.already === true && s.objUrl === 0 && s.read === 0 && s.vidSrc === 0, "re-arming resets the counters without double-wrapping");
  const v4 = document.createElement("video"); v4.src = ourUrl; v4.fire("loadedmetadata");
  ok(api.status().vidSrc === 0 && api.status().meta === 0, "an object URL from BEFORE the re-arm is no longer ours");
  ok(/^blob:/.test(URL.createObjectURL(new Blob(OUR))) && api.status().objUrl === 1, "counting works after a re-arm");

  // 7. no size known ⇒ nothing is ever ours
  api.arm(0, 5000);
  URL.createObjectURL(new Blob(OUR)); new Blob(OUR).slice(); new XMLHttpRequest().send(new Blob(OUR));
  s = api.status();
  ok(s.objUrl === 0 && s.read === 0 && s.up === 0 && s.other === 1, "with no expected size the probe never guesses (a 3 MB blob is 'other')");

  // 8. disarm restores everything
  api.disarm();
  ok(URL.createObjectURL === orig.create, "createObjectURL restored");
  ok(Blob.prototype.slice === orig.slice && Blob.prototype.arrayBuffer === orig.ab && Blob.prototype.stream === orig.stream, "Blob reads restored");
  ok(FileReader.prototype.readAsArrayBuffer === orig.fr && FileReader.prototype.readAsDataURL === orig.frd, "FileReader restored");
  ok(XMLHttpRequest.prototype.send === orig.send && win.fetch === realFetch && FormData.prototype.append === orig.fd, "XHR send, fetch and FormData restored");
  const d = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "src");
  ok(d.get === orig.src.get && d.set === orig.src.set, "HTMLMediaElement.src descriptor restored");
  ok(Element.prototype.setAttribute === orig.sa && Document.prototype.createElement === orig.ce, "setAttribute and createElement restored");
  ok(api.status().armed === false && win.__subsellRx == null, "status reads disarmed, page global cleared");

  // 9. the expiry timer restores on its own
  api.arm(OUR, 1000);
  ok(URL.createObjectURL !== orig.create, "armed again with a 1 s life");
  await new Promise((r) => setTimeout(r, 1700));
  ok(URL.createObjectURL === orig.create && api.status().armed === false, "expired on its own and restored the page");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
