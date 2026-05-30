/* =====================================================================
 * SubSell Marketplace Auto-Reply — content script (DOM side)
 * ---------------------------------------------------------------------
 * Runs on messenger.com / facebook.com/messages. Responsibilities:
 *   1. DIAGNOSTIC capture (kept permanently) — dump every signal that
 *      could distinguish UNREAD rows, so isUnread() can be tuned from
 *      real data. Never strip this.
 *   2. isUnread(anchor) — best-effort detection (bold weight / colored
 *      dot / aria). EASY TO SWAP once the confirmed signal is known.
 *   3. Scan loop (8s): find unread Marketplace threads, open one,
 *      read the buyer's last message, ask Claude (via background),
 *      type a human-like reply, send. One thread per cycle, 90s cooldown.
 *   4. [VIDEO:url] paste-to-upload + [HUMAN] handling.
 *   5. Follow-up typing on request from the background alarm.
 *   6. debugTick every cycle for the live popup panel.
 *
 * CONSTRAINTS: no ES modules, no npm, chrome.storage.local only.
 * ===================================================================== */

(() => {
  "use strict";

  const MP_SELECTOR = 'a[href*="/marketplace/t/"]';
  const STORAGE_KEY_DUMP = "diagnosticDump";
  const STORAGE_KEY_TICK = "debugTick";
  const SCAN_MS = 8000;
  const COOLDOWN_MS = 90 * 1000;
  const MAX_HTML = 1500;
  const SMALL_PX = 20;

  const log = (...a) => console.log("[SubSell]", ...a);

  /* in-memory state (per page session) */
  let busy = false;
  const cooldowns = {}; // threadId -> until-timestamp
  const repliedThreads = {}; // threadId -> timestamp (awaiting buyer reply)
  let lastTick = {};

  /* ---------------- tiny safe helpers (inlined) ---------------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }
  function trunc(s, n) {
    if (s == null) return null;
    s = String(s);
    return s.length > n ? s.slice(0, n) : s;
  }
  function rect(el) {
    return safe(() => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    }, null);
  }
  function classList(el) {
    return safe(() => {
      const c = el && el.getAttribute && el.getAttribute("class");
      return c ? c.trim().split(/\s+/).filter(Boolean) : [];
    }, []);
  }
  function ariaInfo(el) {
    if (!el) return null;
    return safe(
      () => ({
        ariaLabel: el.getAttribute("aria-label"),
        ariaCurrent: el.getAttribute("aria-current"),
        ariaSelected: el.getAttribute("aria-selected"),
        ariaLive: el.getAttribute("aria-live"),
        ariaHidden: el.getAttribute("aria-hidden"),
        role: el.getAttribute("role"),
        tabindex: el.getAttribute("tabindex"),
      }),
      null
    );
  }
  function dataAttrs(el) {
    if (!el) return {};
    return safe(() => {
      const out = {};
      for (const a of el.attributes) if (a.name.startsWith("data-")) out[a.name] = a.value;
      return out;
    }, {});
  }
  function pseudo(el, which) {
    return safe(() => {
      const cs = getComputedStyle(el, which);
      const content = cs.getPropertyValue("content");
      const bg = cs.getPropertyValue("background-color");
      const w = cs.getPropertyValue("width");
      const h = cs.getPropertyValue("height");
      const radius = cs.getPropertyValue("border-radius");
      const display = cs.getPropertyValue("display");
      const hasContent = content && content !== "none" && content !== "normal";
      const colored = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const hasBox = display !== "none" && (parseFloat(w) > 0 || parseFloat(h) > 0) && colored;
      if (!hasContent && !hasBox) return null;
      return { which, content, backgroundColor: bg, width: w, height: h, borderRadius: radius, display };
    }, null);
  }
  function pseudosFor(el) {
    const out = [];
    const b = pseudo(el, "::before");
    const a = pseudo(el, "::after");
    if (b) out.push(b);
    if (a) out.push(a);
    return out;
  }
  const isColored = (bg) => bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";

  /* ---------------- row / thread helpers ---------------- */
  function resolveRow(anchor) {
    const c =
      safe(() => anchor.closest('[role="row"]'), null) ||
      safe(() => anchor.closest('[role="gridcell"]'), null) ||
      safe(() => anchor.closest('[role="listitem"]'), null) ||
      safe(() => anchor.closest("li"), null);
    if (c && c !== anchor) {
      const r = c.getAttribute("role");
      return { el: c, via: r ? `role=${r}` : c.tagName.toLowerCase() };
    }
    let el = anchor;
    for (let i = 0; i < 4 && el.parentElement; i++) el = el.parentElement;
    return { el, via: "ancestor+4" };
  }
  function threadId(anchor) {
    const href = safe(() => anchor.getAttribute("href"), "") || "";
    const m = href.match(/\/marketplace\/t\/(\d+)/);
    return m ? m[1] : href;
  }
  function anchorName(anchor) {
    const t = safe(() => anchor.innerText || anchor.textContent || "", "");
    const first = t.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    return first || null;
  }

  /* =================================================================
   * isUnread() — BEST-EFFORT until the confirmed signal lands.
   * Combines three independent heuristics; records which matched so the
   * debug panel shows it. To finalise: replace the body with the single
   * confirmed signal from the diagnostic dump.
   * ================================================================= */
  function isUnread(anchor) {
    const row = resolveRow(anchor).el;
    // 1) bold text — unread convos render name/snippet heavier
    let boldSignal = false;
    const spans = safe(() => row.querySelectorAll("span"), []);
    for (const sp of spans) {
      const txt = safe(() => (sp.textContent || "").trim(), "");
      if (!txt) continue;
      const w = parseInt(safe(() => getComputedStyle(sp).fontWeight, "400"), 10);
      if (w >= 600) {
        boldSignal = true;
        break;
      }
    }
    // 2) small colored dot
    let dotSignal = false;
    const all = safe(() => row.querySelectorAll("*"), []);
    for (const d of all) {
      const r = rect(d);
      if (r && r.w > 0 && r.h > 0 && r.w < SMALL_PX && r.h < SMALL_PX) {
        if (isColored(safe(() => getComputedStyle(d).backgroundColor, null))) {
          dotSignal = true;
          break;
        }
      }
    }
    // 3) aria-label mentions unread
    const label = (safe(() => anchor.getAttribute("aria-label"), "") || "").toLowerCase();
    const ariaSignal = label.includes("unread") || label.includes("non lu");

    const matched = [];
    if (boldSignal) matched.push("bold");
    if (dotSignal) matched.push("dot");
    if (ariaSignal) matched.push("aria");
    anchor.__subsellSignal = matched.join("+") || null;
    return boldSignal || dotSignal || ariaSignal;
  }

  /* ---------------- diagnostic capture (kept) ---------------- */
  function captureAnchor(anchor, index) {
    const rowInfo = resolveRow(anchor);
    const row = rowInfo.el;
    const text = safe(() => anchor.innerText || anchor.textContent || "", "");

    const descendants = safe(() => Array.from(row.querySelectorAll("*")), []);
    const descClasses = [];
    for (const d of descendants) {
      const cl = classList(d);
      if (cl.length) descClasses.push(cl.join(" "));
    }
    const fontWeights = [];
    for (const sp of safe(() => row.querySelectorAll("span"), [])) {
      const txt = safe(() => (sp.textContent || "").trim(), "");
      if (!txt) continue;
      const cs = safe(() => getComputedStyle(sp), null);
      if (!cs) continue;
      fontWeights.push({ text: trunc(txt, 60), fontWeight: cs.fontWeight, color: cs.color });
      if (fontWeights.length >= 60) break;
    }
    const smallElements = [];
    for (const d of descendants) {
      const r = rect(d);
      if (r && r.w > 0 && r.h > 0 && r.w < SMALL_PX && r.h < SMALL_PX) {
        const cs = safe(() => getComputedStyle(d), null);
        smallElements.push({
          tag: d.tagName.toLowerCase(),
          classes: classList(d),
          w: r.w,
          h: r.h,
          backgroundColor: cs ? cs.backgroundColor : null,
          borderRadius: cs ? cs.borderRadius : null,
          ariaHidden: safe(() => d.getAttribute("aria-hidden"), null),
        });
      }
      if (smallElements.length >= 40) break;
    }
    const pseudos = [];
    for (const p of pseudosFor(anchor)) pseudos.push({ host: "anchor", ...p });
    for (const p of pseudosFor(row)) pseudos.push({ host: "row", ...p });
    for (const d of descendants) {
      for (const p of pseudosFor(d)) pseudos.push({ host: trunc(d.tagName.toLowerCase(), 40), ...p });
      if (pseudos.length >= 40) break;
    }
    const svgs = [];
    for (const s of safe(() => row.querySelectorAll("svg"), [])) {
      svgs.push({ classes: classList(s), ariaLabel: safe(() => s.getAttribute("aria-label"), null), rect: rect(s) });
      if (svgs.length >= 12) break;
    }
    return {
      index,
      name: anchorName(anchor),
      href: safe(() => anchor.getAttribute("href"), null),
      textPreview: trunc(text.replace(/\n/g, " | "), 300),
      detectedUnread: isUnread(anchor),
      matchedSignal: anchor.__subsellSignal,
      rowResolvedVia: rowInfo.via,
      anchorOuterHTML: trunc(safe(() => anchor.outerHTML, ""), MAX_HTML),
      rowOuterHTML: trunc(safe(() => row.outerHTML, ""), MAX_HTML),
      classes: { anchor: classList(anchor), row: classList(row), descendants: descClasses },
      ariaAnchor: ariaInfo(anchor),
      ariaRow: ariaInfo(row),
      fontWeights,
      smallElements,
      pseudos,
      svgs,
      dataAttrs: { anchor: dataAttrs(anchor), row: dataAttrs(row) },
    };
  }
  function fingerprint(cap) {
    const weights = cap.fontWeights.map((f) => parseInt(f.fontWeight, 10)).filter((n) => !isNaN(n));
    const coloredDot = cap.smallElements.find((s) => isColored(s.backgroundColor));
    const pseudoDot = cap.pseudos.find((p) => isColored(p.backgroundColor));
    return {
      index: cap.index,
      name: cap.name,
      unread: cap.detectedUnread,
      signal: cap.matchedSignal,
      maxFontWeight: weights.length ? Math.max(...weights) : null,
      smallElementCount: cap.smallElements.length,
      coloredDotBg: coloredDot ? coloredDot.backgroundColor : null,
      pseudoDotBg: pseudoDot ? pseudoDot.backgroundColor : null,
      svgCount: cap.svgs.length,
      ariaLabel: cap.ariaAnchor ? cap.ariaAnchor.ariaLabel : null,
    };
  }
  function writeDiagnostic(anchors, reason) {
    const captures = [];
    for (let i = 0; i < anchors.length; i++) {
      const c = safe(() => captureAnchor(anchors[i], i), null);
      if (c) captures.push(c);
    }
    const dump = {
      version: "0.2.0",
      capturedAt: new Date().toISOString(),
      url: location.href,
      reason: reason || "auto",
      anchorCount: anchors.length,
      capturedCount: captures.length,
      fingerprints: captures.map(fingerprint),
      anchors: captures,
    };
    safe(() => chrome.storage.local.set({ [STORAGE_KEY_DUMP]: dump }));
    return dump;
  }

  /* ---------------- debug tick ---------------- */
  function updateTick(patch) {
    lastTick = Object.assign(
      {
        lastScanTime: new Date().toISOString(),
        url: location.href,
        marketplaceAnchorCount: 0,
        unreadCount: 0,
        currentThread: null,
        signalMatched: null,
        lastAction: null,
        lastReplySent: null,
        lastError: null,
      },
      lastTick,
      patch,
      { lastScanTime: new Date().toISOString() }
    );
    safe(() => chrome.storage.local.set({ [STORAGE_KEY_TICK]: lastTick }));
  }

  /* ---------------- background bridge ---------------- */
  function ask(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
          else resolve(resp || { ok: false, error: "no response" });
        });
      } catch (e) {
        resolve({ ok: false, error: e.message });
      }
    });
  }

  /* ---------------- thread DOM helpers ---------------- */
  function getMain() {
    return document.querySelector('[role="main"]');
  }
  function getLastBuyerMessage() {
    const main = getMain();
    if (!main) return "";
    const rows = main.querySelectorAll('[role="row"]');
    for (let i = rows.length - 1; i >= 0; i--) {
      const t = safe(() => rows[i].innerText.trim(), "");
      if (t) return trunc(t, 1000);
    }
    // fallback: any dir=auto text
    const bubbles = main.querySelectorAll('[dir="auto"]');
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const t = safe(() => bubbles[i].innerText.trim(), "");
      if (t) return trunc(t, 1000);
    }
    return "";
  }
  function findComposer() {
    const main = getMain() || document;
    return (
      main.querySelector('[contenteditable="true"][role="textbox"]') ||
      main.querySelector('div[aria-label][contenteditable="true"]') ||
      main.querySelector('[contenteditable="true"]')
    );
  }

  /* ---------------- human-like typing ---------------- */
  function insertText(el, str) {
    el.focus();
    // execCommand insertText drives React's contenteditable reliably.
    const ok = safe(() => document.execCommand("insertText", false, str), false);
    if (!ok) {
      // fallback: dispatch a beforeinput/input pair
      safe(() => {
        el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: str, bubbles: true, cancelable: true }));
        el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: str, bubbles: true }));
      });
    }
  }
  async function typeHuman(el, text, settings) {
    const wpm = rand(settings.wpmMin || 38, settings.wpmMax || 78);
    const perChar = 60000 / (wpm * 5); // ~5 chars per word
    for (const ch of text) {
      insertText(el, ch);
      await sleep(perChar * rand(0.6, 1.4));
      if (Math.random() < 0.04) await sleep(rand(300, 900)); // occasional pause
    }
  }
  function pressEnter(el) {
    el.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
  }

  /* ---------------- video paste-to-upload ---------------- */
  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime || "video/mp4" });
  }
  async function sendVideo(url, caption, settings) {
    updateTick({ lastAction: "fetching video" });
    const res = await ask({ type: "FETCH_VIDEO", url });
    if (!res || !res.ok) {
      updateTick({ lastError: "video fetch failed: " + (res && res.error) });
      return false;
    }
    const blob = base64ToBlob(res.base64, res.mime);
    const file = new File([blob], "demo.mp4", { type: res.mime || "video/mp4" });
    const composer = findComposer();
    if (!composer) {
      updateTick({ lastError: "composer not found for video" });
      return false;
    }
    composer.focus();

    // Primary: ClipboardEvent paste carrying a DataTransfer file.
    let pasted = false;
    safe(() => {
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      // clipboardData is read-only via constructor in some builds; assign DT.
      Object.defineProperty(ev, "clipboardData", { value: dt });
      composer.dispatchEvent(ev);
      pasted = true;
    });

    // Fallback: drag-drop simulation.
    if (!pasted) {
      safe(() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        for (const t of ["dragenter", "dragover", "drop"]) {
          const ev = new DragEvent(t, { bubbles: true, cancelable: true });
          Object.defineProperty(ev, "dataTransfer", { value: dt });
          composer.dispatchEvent(ev);
        }
      });
    }

    // Fallback 2: a real file input if Messenger exposes one.
    safe(() => {
      const input = document.querySelector('input[type="file"]');
      if (input) {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    await sleep(4000); // let the upload preview attach
    if (caption) {
      await typeHuman(composer, caption, settings);
    }
    pressEnter(composer);
    return true;
  }

  /* ---------------- one thread ---------------- */
  async function handleThread(anchor, settings) {
    const id = threadId(anchor);
    const name = anchorName(anchor);
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    updateTick({ currentThread: name, signalMatched: anchor.__subsellSignal, lastAction: "opening thread" });

    safe(() => anchor.click());
    await sleep(2000);
    if (id && !location.href.includes(id)) {
      // URL didn't change to this thread; bail to avoid replying to the wrong one.
      updateTick({ lastError: "URL did not change to thread " + id, lastAction: "aborted" });
      return;
    }

    const buyerMessage = getLastBuyerMessage();
    updateTick({ lastAction: "got buyer message", currentThread: name });
    if (!buyerMessage) {
      updateTick({ lastError: "no buyer message found" });
      return;
    }

    const reply = await ask({ type: "GET_REPLY", buyerMessage, threadId: id, threadName: name });
    if (!reply || !reply.ok) {
      updateTick({ lastError: "reply error: " + (reply && reply.error), lastAction: "api error" });
      return;
    }
    if (reply.blocked) {
      updateTick({ lastAction: "blocked: " + reply.reason });
      return;
    }
    if (reply.action === "human") {
      updateTick({ lastAction: "HUMAN flagged: " + reply.reason });
      return; // background fired the notification
    }

    // human delay before typing
    const delayMs = (settings.responseDelaySec || 30) * 1000 + rand(0, (settings.jitterSec || 60) * 1000);
    updateTick({ lastAction: `waiting ${Math.round(delayMs / 1000)}s before reply` });
    await sleep(delayMs);

    if (reply.action === "video") {
      const ok = await sendVideo(reply.url, reply.caption, settings);
      updateTick({ lastAction: ok ? "video sent" : "video failed", lastReplySent: ok ? `[VIDEO] ${reply.url}` : null });
    } else {
      const composer = findComposer();
      if (!composer) {
        updateTick({ lastError: "composer not found" });
        return;
      }
      await typeHuman(composer, reply.text, settings);
      await sleep(rand(200, 600));
      pressEnter(composer);
      updateTick({ lastAction: "reply sent", lastReplySent: trunc(reply.text, 200) });
    }

    repliedThreads[id] = Date.now();
    await ask({ type: "BOT_REPLIED", threadId: id });
    await sleep(5000);
  }

  /* ---------------- scan loop ---------------- */
  function onMessagesPage() {
    return /messenger\.com/.test(location.host) || /facebook\.com\/messages/.test(location.href);
  }

  async function tick(reason) {
    if (busy) return;
    const anchors = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
    writeDiagnostic(anchors, reason);

    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const unread = anchors.filter(isUnread);

    // Detect buyer replies on threads we already answered -> cancel follow-ups
    for (const a of anchors) {
      const id = threadId(a);
      if (repliedThreads[id] && isUnread(a)) {
        delete repliedThreads[id];
        ask({ type: "BUYER_REPLIED", threadId: id });
      }
    }

    updateTick({
      marketplaceAnchorCount: anchors.length,
      unreadCount: unread.length,
      lastAction: settings.enabled ? "scanning" : "idle (disabled)",
      lastError: null,
    });

    if (!settings.enabled) return;
    if (!onMessagesPage()) {
      updateTick({ lastAction: "idle (not on messages page)" });
      return;
    }

    const target = unread.find((a) => {
      const id = threadId(a);
      return !cooldowns[id] || Date.now() > cooldowns[id];
    });
    if (!target) return;

    busy = true;
    try {
      await handleThread(target, settings);
    } catch (e) {
      updateTick({ lastError: "handleThread: " + e.message });
    } finally {
      busy = false;
    }
  }

  /* ---------------- follow-up + popup messaging ---------------- */
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === "SCAN") {
      const anchors = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
      sendResponse({ ok: true, dump: writeDiagnostic(anchors, "manual") });
      return true;
    }
    if (msg && msg.type === "PING") {
      sendResponse({ ok: true, url: location.href, anchorCount: document.querySelectorAll(MP_SELECTOR).length });
      return true;
    }
    if (msg && msg.type === "SEND_FOLLOWUP") {
      (async () => {
        const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
        const anchor = Array.from(document.querySelectorAll(MP_SELECTOR)).find((a) => threadId(a) === msg.threadId);
        if (!anchor) {
          updateTick({ lastError: "follow-up: thread not found " + msg.threadId });
          sendResponse({ ok: false, error: "thread not found" });
          return;
        }
        if (busy) {
          sendResponse({ ok: false, error: "busy" });
          return;
        }
        busy = true;
        try {
          safe(() => anchor.click());
          await sleep(2000);
          const composer = findComposer();
          if (composer) {
            await typeHuman(composer, msg.text, settings);
            await sleep(rand(200, 600));
            pressEnter(composer);
            updateTick({ lastAction: "follow-up sent", lastReplySent: trunc(msg.text, 200) });
            sendResponse({ ok: true });
          } else {
            sendResponse({ ok: false, error: "composer not found" });
          }
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        } finally {
          busy = false;
        }
      })();
      return true;
    }
    return false;
  });

  /* ---------------- boot ---------------- */
  log("content script loaded on", location.href);
  setTimeout(() => tick("boot"), 2500);
  setInterval(() => tick("auto"), SCAN_MS);
})();
