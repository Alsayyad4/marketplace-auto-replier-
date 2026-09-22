/* Tests the MEDIA GATE (content.js mediaGateOpen / primeMedia / ensureMediaGate, v0.21.67).
 *
 * Why this file exists: Chrome parks every media load of a page that is hidden and
 * has never played media (prerender::DeferMediaLoad); Messenger decodes a clip
 * before it stages it, so on such a page every hand-over is accepted and parked —
 * the PC-qwafy "five channels, 261 hand-overs, nothing staged" diagnostic. The gate
 * is probed with a tiny WAV load and, when parked, the frame is made to play a
 * silent MediaStream. Nothing here may be assumed: only a re-probed OPEN gate
 * counts as primed.
 *
 * Under test:
 *   1. The probe WAV is a valid RIFF/WAVE resource.
 *   2. Hidden + loads run ⇒ open, proven, nothing primed.
 *   3. Hidden + parked ⇒ the audio stream primes it (verified by re-probe).
 *   4. Audio refused, canvas stream primes it.
 *   5. Nothing primes it ⇒ closed, "-", and a retry is not attempted for 10 min.
 *   6. Visible page ⇒ primed unverified, and the first HIDDEN call probes for real.
 *
 * Run:  node store/smoke-mediagate.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
const start = src.indexOf("  const TINY_WAV_URL = (() => {");
const end = src.indexOf("\n  function findAttachControl() {", start);
if (start < 0 || end < 0) { console.error("media gate block not found in content.js"); process.exit(1); }
const block = src.slice(start, end);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

// Build one sandboxed copy of the block per scenario.
function world(o) {
  // o.vis: "hidden" | "visible"; o.loadsRun: does a WAV <audio> load complete?;
  // o.audioPlays / o.canvasPlays: does play() resolve for the stream elements?;
  // o.primeOpens: once a stream has played, do loads run?
  const w = { vis: o.vis, loadsRun: !!o.loadsRun, audioPlays: !!o.audioPlays, canvasPlays: !!o.canvasPlays, primeOpens: !!o.primeOpens, played: 0, probes: 0, status: [] };
  const fire = (el, t) => setTimeout(() => { for (const f of el._ls[t] || []) f(); }, 2);
  class El {
    constructor(tag) { this.tagName = tag.toUpperCase(); this._ls = {}; this.paused = true; this.style = {}; this._attrs = {}; }
    addEventListener(t, fn) { (this._ls[t] = this._ls[t] || []).push(fn); }
    setAttribute(k, v) { this._attrs[k] = v; }
    removeAttribute(k) { delete this._attrs[k]; if (k === "src") this._src = ""; } // the cleanup load() must not count as a probe
    load() { if (this.tagName === "AUDIO" && this._src) { w.probes++; if (w.loadsRun || (w.primeOpens && w.played > 0)) fire(this, "loadedmetadata"); } }
    set src(v) { this._src = v; }
    get src() { return this._src; }
    play() {
      const plays = this.tagName === "AUDIO" ? w.audioPlays : w.canvasPlays;
      if (!this.srcObject) return Promise.reject(new Error("no source"));
      if (!plays) return new Promise(() => { /* never resolves: autoplay refused/stalled */ });
      this.paused = false; w.played++;
      return Promise.resolve();
    }
  }
  const canvasEl = () => ({ tagName: "CANVAS", width: 0, height: 0, getContext: () => ({ fillStyle: "", fillRect() { w.rects = (w.rects || 0) + 1; } }), captureStream: () => ({ getVideoTracks: () => [{ requestFrame() { w.frames = (w.frames || 0) + 1; } }] }) });
  const body = { appendChild() { w.appended = (w.appended || 0) + 1; } };
  const document = { get visibilityState() { return w.vis; }, body, documentElement: body, createElement: (t) => (t === "canvas" ? canvasEl() : new El(t)), hasFocus: () => false };
  const window = { AudioContext: function () { this.createMediaStreamDestination = () => ({ stream: { kind: "audio-stream" } }); } };
  const chrome = { storage: { local: { set: (o2, cb) => { w.saved = o2; cb && cb(); } } }, runtime: {} };
  const safe = (fn, d) => { try { return fn(); } catch (e) { return d; } };
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 25))); // scaled: real events fire in 2 ms
  const setStatus = (p) => w.status.push(p);
  const navigator = {};
  const api = new Function("document", "window", "chrome", "safe", "sleep", "setStatus", "navigator", "Uint8Array", "btoa", "Date", "setTimeout",
    block + "; return { TINY_WAV_URL, mediaGate, mediaGateOpen, primeMedia, ensureMediaGate };")(document, window, chrome, safe, sleep, setStatus, navigator, Uint8Array, (s) => Buffer.from(s, "binary").toString("base64"), Date, setTimeout);
  return { w, api, setVis: (v) => { w.vis = v; } };
}

(async () => {
  // 1. the WAV
  let W = world({ vis: "hidden", loadsRun: true });
  const url = W.api.TINY_WAV_URL;
  ok(/^data:audio\/wav;base64,/.test(url), "the probe is a data:audio/wav URL");
  const bytes = Buffer.from(url.split(",")[1], "base64");
  ok(bytes.length === 52 && bytes.toString("binary", 0, 4) === "RIFF" && bytes.toString("binary", 8, 12) === "WAVE" && bytes.toString("binary", 12, 16) === "fmt " && bytes.toString("binary", 36, 40) === "data", "…a valid 52-byte RIFF/WAVE/fmt/data resource");
  ok(bytes.readUInt32LE(4) === 44 && bytes.readUInt32LE(40) === 8 && bytes.readUInt16LE(22) === 1 && bytes.readUInt32LE(24) === 8000, "…with consistent chunk sizes (mono, 8 kHz, 8 samples)");

  // 2. hidden, loads run
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "open" && W.api.mediaGate.provenHidden === true && W.api.mediaGate.primed === "-", "hidden page whose loads run: gate open, proven, nothing primed");
  ok(W.w.played === 0 && W.w.probes === 1, "…one probe, no stream played");
  ok(W.w.saved && W.w.saved.videoMediaGate && W.w.saved.videoMediaGate.state === "open" && W.w.saved.videoMediaGate.hidden === true, "…persisted for the 🩺");
  const p1 = W.w.probes; await W.api.ensureMediaGate();
  ok(W.w.probes === p1, "a proven-open gate is not probed again");

  // 3. hidden, parked, the audio stream primes it
  W = world({ vis: "hidden", loadsRun: false, audioPlays: true, canvasPlays: true, primeOpens: true });
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "open" && W.api.mediaGate.primed === "stream-audio" && W.api.mediaGate.provenHidden === true, "parked page: the audio stream primes it and the re-probe proves it (primed=" + W.api.mediaGate.primed + ")");
  ok(W.w.played === 1 && W.w.probes === 2, "…one stream played, the gate probed before and after");
  ok(W.w.status.some((s) => /media gate opened/.test(s.videoLast || "")), "…and the status says so");

  // 4. audio refused, the canvas stream primes it
  W = world({ vis: "hidden", loadsRun: false, audioPlays: false, canvasPlays: true, primeOpens: true });
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "open" && W.api.mediaGate.primed === "stream-canvas", "when the audio stream will not play the canvas stream is tried and proven (primed=" + W.api.mediaGate.primed + ")");
  ok((W.w.frames || 0) >= 1, "…with a frame requested by hand (no rendering needed on a hidden tab)");

  // 5. nothing primes it
  W = world({ vis: "hidden", loadsRun: false, audioPlays: true, canvasPlays: true, primeOpens: false });
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "closed" && W.api.mediaGate.primed === "-", "when no stream opens the gate it stays 'closed' with primed=- (never assumed)");
  ok(W.w.status.some((s) => /still closed/.test(s.videoLast || "")), "…the status says the window must be shown once");
  const p5 = W.w.probes; await W.api.ensureMediaGate();
  ok(W.w.probes === p5, "a closed gate is not re-probed within 10 min");
  W.api.mediaGate.at -= 11 * 60 * 1000; await W.api.ensureMediaGate();
  ok(W.w.probes > p5, "…but is re-probed after 10 min");

  // 6. visible page: primed unverified, first hidden call probes for real
  W = world({ vis: "visible", loadsRun: true, audioPlays: true, canvasPlays: true, primeOpens: true });
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "open" && W.api.mediaGate.primed === "stream-audio" && W.api.mediaGate.provenHidden === false && W.w.probes === 0, "visible page: primed without a probe, not yet proven for a hidden page");
  W.setVis("hidden"); W.w.loadsRun = false; // now hidden; loads would park unless the priming took (primeOpens=true and played>0)
  await W.api.ensureMediaGate();
  ok(W.api.mediaGate.state === "open" && W.api.mediaGate.provenHidden === true && W.w.probes === 1 && W.w.played === 1, "…the first hidden call probes once and proves the earlier priming without playing again");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
