/* Tests the composer-anchored attachment detector (content.js, v0.21.58).
 *
 * Why this file exists: an operator photo showed SEVEN clips staged in a live
 * composer while every counter said 0. The old selectors required an aria-label
 * containing BOTH "remove" AND "attach", and Messenger labels its × simply
 * "Remove" — so the bot was blind, "retried", stacked another copy each time, and
 * never sent any of them. Being blind stacks clips; being too eager sends a clip
 * early. Both are tested here.
 *
 * Run:  node store/smoke-tray.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");

const from = src.indexOf("  const TRAY_BAND_UP");
const to = src.indexOf("  const trayEls = () =>");
if (from < 0 || to < 0) { console.error("detector block not found in content.js"); process.exit(1); }
const block = src.slice(from, to);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

// --- a fake page laid out like Messenger ---
const COMPOSER = { left: 400, right: 1000, top: 700, bottom: 740 };
function el(o) {
  return {
    tag: o.tag || "div", _rect: o.rect, _attrs: o.attrs || {}, _row: o.row || null,
    getBoundingClientRect() { return Object.assign({ width: this._rect.right - this._rect.left, height: this._rect.bottom - this._rect.top }, this._rect); },
    getAttribute(k) { return this._attrs[k] != null ? this._attrs[k] : null; },
    closest(sel) { return sel === '[role="row"]' ? this._row : null; },
    contains(x) { return x === this; },
  };
}
const composer = el({ rect: COMPOSER });

// seven staged clips just above the textbox, each with a plain "Remove" ×
const thumbs = [], removes = [];
for (let i = 0; i < 7; i++) {
  const L = 420 + i * 60;
  thumbs.push(el({ tag: "img", rect: { left: L, right: L + 48, top: 620, bottom: 668 }, attrs: { role: null } }));
  removes.push(el({ tag: "div", rect: { left: L + 34, right: L + 50, top: 618, bottom: 634 }, attrs: { role: "button", "aria-label": "Remove" } }));
}
// a video the buyer was already SENT, inside a message row well above
const sentRow = {};
const sentVideo = el({ tag: "video", rect: { left: 500, right: 800, top: 300, bottom: 500 }, row: sentRow });
// a sidebar avatar, far to the left of the composer column
const sidebarImg = el({ tag: "img", rect: { left: 20, right: 68, top: 640, bottom: 688 } });
// a big toolbar button that happens to say "Delete"
const bigDelete = el({ tag: "div", rect: { left: 420, right: 560, top: 640, bottom: 700 }, attrs: { role: "button", "aria-label": "Delete conversation" } });
// a "Remove" button far ABOVE the band (an old message's menu)
const farRemove = el({ tag: "div", rect: { left: 430, right: 446, top: 120, bottom: 136 }, attrs: { role: "button", "aria-label": "Remove" } });

const ALL = thumbs.concat(removes, [sentVideo, sidebarImg, bigDelete, farRemove]);
const doc = {
  querySelectorAll(sel) {
    if (/button/.test(sel)) return ALL.filter((e) => e._attrs.role === "button");
    if (/img/.test(sel)) return ALL.filter((e) => e.tag === "img" || e.tag === "video" || e._attrs.role === "progressbar");
    return [];
  },
};

const mk = new Function("document", "findComposer", "safe", block + "; return { trayBand, inBand, trayWide };");
const api = mk(doc, () => composer, (fn, fb) => { try { return fn(); } catch (e) { return fb; } });

const wideRemove = api.trayWide("remove");
const widePreview = api.trayWide("preview");

ok(!!api.trayBand(), "the band is derived from the composer rect");
ok(wideRemove.length === 7, "finds all SEVEN staged clips by their plain 'Remove' × (old selectors found 0) — got " + wideRemove.length);
ok(widePreview.length === 7, "finds the seven thumbnails — got " + widePreview.length);
ok(wideRemove.indexOf(farRemove) === -1, "a 'Remove' button far above the composer is ignored");
ok(wideRemove.indexOf(bigDelete) === -1, "a large 'Delete conversation' button is ignored (not a thumbnail ×)");
ok(widePreview.indexOf(sentVideo) === -1, "a video already SENT in a message row is never counted as staged");
ok(widePreview.indexOf(sidebarImg) === -1, "a sidebar image outside the composer column is ignored");

// An empty composer must read empty — this is what stops a phantom send.
const emptyDoc = { querySelectorAll() { return []; } };
const api2 = mk(emptyDoc, () => composer, (fn, fb) => { try { return fn(); } catch (e) { return fb; } });
ok(api2.trayWide("remove").length === 0 && api2.trayWide("preview").length === 0,
   "an empty composer reads as empty (no phantom staged clip)");

// No composer at all => no band, no detections, no crash.
const api3 = mk(doc, () => null, (fn, fb) => { try { return fn(); } catch (e) { return fb; } });
ok(api3.trayBand() === null && api3.trayWide("remove").length === 0, "no composer => no detections, no crash");

console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
