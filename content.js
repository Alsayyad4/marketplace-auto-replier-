/* =====================================================================
 * SubSell Marketplace Auto-Reply — content script (SIMPLE mode)
 * ---------------------------------------------------------------------
 * Takes over the Messenger Marketplace inbox and does ONE thing:
 *
 *   1. Go through every conversation in the list, one at a time.
 *   2. Open it and read the LAST message.
 *   3. If that last message is from the BUYER, ask Claude for a reply
 *      and type + send it.
 *   4. Move on. Repeat.
 *
 * One reading method: the message column is bounded by the composer box;
 * your messages sit on the right, the buyer's on the left. No vision, no
 * "unread" detection, no cadence, no learned rules — on purpose.
 * ===================================================================== */
(() => {
  "use strict";

  const THREAD_SELECTOR = 'a[href*="/t/"]'; // messenger.com & facebook.com thread links
  const SCAN_MS = 8000; // how often we look for the next chat to handle
  const COOLDOWN_MS = 90 * 1000; // wait before re-checking a chat we just acted on
  const IDLE_COOLDOWN_MS = 10 * 60 * 1000; // longer wait for chats where WE spoke last

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const log = (...a) => console.log("[SubSell]", ...a);
  const safe = (fn, fb) => {
    try {
      return fn();
    } catch (e) {
      return fb;
    }
  };
  const trunc = (s, n) => (s == null ? null : String(s).length > n ? String(s).slice(0, n) : String(s));

  let busy = false;
  const cooldowns = {}; // threadId -> timestamp we may re-check it
  const lastHandled = {}; // threadId -> the buyer message we last replied to (don't repeat)
  let tick = {}; // live status shown in the popup

  /* ---------------- popup status ---------------- */
  function setStatus(patch) {
    tick = Object.assign(
      {
        lastScanTime: null,
        url: location.href,
        marketplaceAnchorCount: 0,
        unreadCount: 0,
        currentThread: null,
        lastAction: null,
        lastReplySent: null,
        lastError: null,
      },
      tick,
      patch,
      { lastScanTime: new Date().toISOString(), url: location.href }
    );
    safe(() => chrome.storage.local.set({ debugTick: tick }));
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

  /* ---------------- find conversations in the list ---------------- */
  function threadId(anchor) {
    const href = safe(() => anchor.getAttribute("href"), "") || "";
    const m = href.match(/\/t\/([^/?#]+)/); // /marketplace/t/<id>, /t/<id>, …
    return m ? m[1] : href;
  }
  function anchorName(anchor) {
    const t = safe(() => anchor.innerText || anchor.textContent || "", "");
    return t.split("\n").map((s) => s.trim()).filter(Boolean)[0] || null;
  }
  function isConversation(anchor) {
    const id = safe(() => anchor.id, "") || "";
    if (/left-sidebar-button/i.test(id)) return false; // left-rail nav button
    const label = safe(() => anchor.getAttribute("aria-label"), "") || "";
    if (/^(Chats|Requests|Marketplace|Spam|Archived)\b/i.test(label)) return false; // folder buttons
    const href = safe(() => anchor.getAttribute("href"), "") || "";
    return /\/t\/[^/?#]+/.test(href);
  }
  function conversationAnchors() {
    return safe(() => Array.from(document.querySelectorAll(THREAD_SELECTOR)).filter(isConversation), []);
  }

  /* ---------------- read the OPEN conversation ---------------- */
  function getMain() {
    return document.querySelector('[role="main"]');
  }
  function findComposer() {
    const main = getMain() || document;
    return (
      main.querySelector('[contenteditable="true"][role="textbox"]') ||
      main.querySelector('div[aria-label][contenteditable="true"]') ||
      main.querySelector('[contenteditable="true"]')
    );
  }
  async function waitForComposer(ms) {
    const t = ms || 6000;
    const start = Date.now();
    while (Date.now() - start < t) {
      const c = findComposer();
      if (c) return c;
      await sleep(300);
    }
    return null;
  }

  // Things that are NOT chat messages (menus, the listing card, system notices).
  const NOISE = [
    "privacy & support", "privacy and support", "customize chat", "chat members",
    "media, files and links", "media files and links", "rate seller", "more options",
    "marketplace", "mute", "search", "block", "you sent", "enter", "sent", "delivered",
    "seen", "active now", "view profile", "view seller profile", "see listing", "report", "archive",
  ];
  function isNoise(text) {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return true;
    if (/^ca\$|^\$\d|^\d+\s*(go|gb|tb)\b/.test(t)) return true; // price / spec card
    if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(t)) return true; // bare time
    if (/^(mon|tue|wed|thu|fri|sat|sun)\b/i.test(t)) return true; // "Sat 7:11 PM" headers
    if (/^(yesterday|today|hier|aujourd)/i.test(t)) return true; // relative date headers
    if (/^to help identify/.test(t) || t.includes("meta may use technology")) return true; // Meta footer
    return NOISE.some((n) => t === n || t.startsWith(n));
  }

  // Returns the conversation as [{ role:"buyer"|"me", text }] oldest→newest, or [].
  function readConversation() {
    const main = getMain();
    const composer = findComposer();
    if (!main || !composer) return []; // not a loaded thread → read nothing
    const c = composer.getBoundingClientRect();
    const left = c.left;
    const right = c.right;
    const center = (c.left + c.right) / 2;
    const top = c.top; // messages live above the input box
    const out = [];
    const seen = new Set();
    let nodes = safe(() => Array.from(main.querySelectorAll('[role="row"] [dir="auto"]')), []);
    if (!nodes.length) nodes = safe(() => Array.from(main.querySelectorAll('[dir="auto"]')), []);
    for (const el of nodes) {
      if (safe(() => el.querySelector('[dir="auto"]'), null)) continue; // leaf text only
      if (safe(() => el.closest("a[href]"), null)) continue; // skip links (listing card, profile)
      const text = safe(() => (el.innerText || el.textContent || "").trim(), "");
      if (!text || isNoise(text)) continue;
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const cx = r.left + r.width / 2;
      if (cx < left - 40 || cx > right + 40) continue; // inside the message column only
      if (r.top >= top) continue; // above the composer only
      const key = text + "@" + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role: cx > center ? "me" : "buyer", text, top: r.top });
    }
    out.sort((a, b) => a.top - b.top);
    return out;
  }
  // The buyer message to answer: the last bubble, and only if it's the buyer's.
  function buyerSpokeLast() {
    const convo = readConversation();
    if (!convo.length) return null;
    const last = convo[convo.length - 1];
    if (last.role !== "buyer") return null;
    const transcript = convo
      .slice(-12)
      .map((m) => (m.role === "buyer" ? "Buyer: " : "You: ") + m.text)
      .join("\n");
    return { buyerMessage: last.text, transcript };
  }

  /* ---------------- type + send (and VERIFY it sent) ---------------- */
  function composerText(el) {
    return safe(() => (el.innerText || el.textContent || "").replace(/ /g, " ").trim(), "");
  }
  function insertText(el, str) {
    el.focus();
    if (!safe(() => document.execCommand("insertText", false, str), false)) {
      safe(() => {
        el.dispatchEvent(new InputEvent("beforeinput", { inputType: "insertText", data: str, bubbles: true, cancelable: true }));
        el.dispatchEvent(new InputEvent("input", { inputType: "insertText", data: str, bubbles: true }));
      });
    }
  }
  function pressEnter(el) {
    el.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    }
  }
  function clickSend() {
    const main = getMain() || document;
    const sels = [
      'div[aria-label="Press Enter to send"]',
      '[aria-label="Send"][role="button"]',
      '[aria-label*="Send" i][role="button"]',
      '[aria-label*="Envoyer" i][role="button"]',
    ];
    for (const s of sels) {
      const b = safe(() => main.querySelector(s), null);
      if (b) {
        safe(() => b.click());
        return true;
      }
    }
    return false;
  }
  async function composerEmptied(el, ms) {
    const t = ms || 2500;
    const start = Date.now();
    while (Date.now() - start < t) {
      await sleep(150);
      if (!composerText(el)) return true; // composer clears = message actually sent
    }
    return false;
  }
  async function typeAndSend(el, text) {
    const want = String(text).replace(/\s*\n\s*/g, " ").trim();
    if (!want) return false;
    el.focus();
    // Type word-by-word (reliable on Messenger's editor; reads a bit human).
    const words = want.split(" ");
    for (let i = 0; i < words.length; i++) {
      insertText(el, (i ? " " : "") + words[i]);
      await sleep(rand(40, 130));
    }
    await sleep(rand(200, 450));
    if (composerText(el) !== want) {
      // one corrective pass — clear + insert the whole thing at once
      el.focus();
      safe(() => document.execCommand("selectAll", false, null));
      safe(() => document.execCommand("insertText", false, want));
      await sleep(250);
    }
    if (!composerText(el)) return false;
    pressEnter(el);
    if (await composerEmptied(el)) return true; // 1) Enter
    clickSend();
    if (await composerEmptied(el)) return true; // 2) Send button
    el.focus();
    pressEnter(el);
    return await composerEmptied(el); // 3) Enter again
  }

  /* ---------------- demo video (optional, ONCE per chat) ---------------- */
  function getLocal(keys) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (r) => resolve(r || {}));
      } catch (e) {
        resolve({});
      }
    });
  }
  function setLocal(obj) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }
  function dataUrlToFile(dataUrl, name, type) {
    const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name || "demo.mp4", { type: type || "video/mp4" });
  }
  // Best-effort: drop the file into Messenger's attach uploader, wait for the
  // preview to actually appear, then send. Tries the hidden file input, then a
  // paste, then drag-drop. This is the one fragile part — depends on Messenger's
  // current uploader — but it's fully isolated from the (working) text reply.
  async function injectVideo(file) {
    const main = getMain() || document;
    const previewSel = 'img[src^="blob:"], [role="progressbar"], video';
    const before = safe(() => main.querySelectorAll(previewSel).length, 0);
    const composer = findComposer();
    if (composer) composer.focus();

    let injected = false;
    const input = safe(() => document.querySelector('input[type="file"]'), null);
    if (input) {
      injected = safe(() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }, false);
    }
    if (!injected && composer) {
      injected = safe(() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clipboardData", { value: dt });
        composer.dispatchEvent(ev);
        return true;
      }, false);
    }
    if (!injected && composer) {
      injected = safe(() => {
        const dt = new DataTransfer();
        dt.items.add(file);
        for (const t of ["dragenter", "dragover", "drop"]) {
          const ev = new DragEvent(t, { bubbles: true, cancelable: true });
          Object.defineProperty(ev, "dataTransfer", { value: dt });
          composer.dispatchEvent(ev);
        }
        return true;
      }, false);
    }
    if (!injected) return false;

    // Wait for the upload preview to attach (poll up to ~25s for a NEW preview).
    const start = Date.now();
    let attached = false;
    while (Date.now() - start < 25000) {
      await sleep(1000);
      const now = safe(() => main.querySelectorAll(previewSel).length, before);
      if (now > before) {
        attached = true;
        break;
      }
    }
    await sleep(attached ? 1500 : 1000);
    const composer2 = findComposer();
    if (composer2) {
      pressEnter(composer2);
      await sleep(800);
      clickSend();
    }
    return true;
  }
  // Send the stored demo video(s) to the current chat — ONCE per chat, a set delay
  // after the text reply (default 10s). Supports MULTIPLE videos, sent in order.
  async function maybeSendVideo(id, name, immediate) {
    try {
      const cfg = await getLocal(["videoEnabled", "demoVideos", "demoVideo", "videoSentThreads", "videoDelaySec"]);

      // LOCAL videos (uploaded per-machine, stored as base64 dataUrls).
      let local = Array.isArray(cfg.demoVideos) ? cfg.demoVideos : [];
      if (!local.length && cfg.demoVideo && cfg.demoVideo.dataUrl) local = [cfg.demoVideo]; // legacy single
      local = local.filter((v) => v && v.dataUrl);

      // CENTRAL videos (hosted in Supabase Storage, delivered via the config URL).
      // Adding videos in the web dashboard turns this on for every machine — no
      // per-machine toggle needed. They are still sent as NATIVE uploads.
      let central = [];
      let centralDelay = null;
      try {
        const s = (await ask({ type: "GET_SETTINGS" })).settings || {};
        if (Array.isArray(s.demoVideoUrls)) central = s.demoVideoUrls.filter((v) => v && v.url);
        if (s.demoVideoDelaySec != null) centralDelay = Number(s.demoVideoDelaySec);
      } catch (e) {
        /* background unavailable — just skip central videos this cycle */
      }

      // Send if locally enabled OR central videos exist (central = opt-in from the dashboard).
      if (!cfg.videoEnabled && !central.length) return;
      if (!local.length && !central.length) return;

      const sent = cfg.videoSentThreads || {};
      if (sent[id]) return; // already sent in this conversation

      const delaySec = centralDelay != null ? centralDelay : cfg.videoDelaySec != null ? cfg.videoDelaySec : 10;
      const delayMs = delaySec * 1000;
      if (!immediate) {
        // After a fresh text reply: wait N s so the video trails it naturally.
        // On a revisit (quiet chat) we send right away so the scan loop doesn't stall.
        setStatus({ lastAction: `video in ${Math.round(delayMs / 1000)}s…`, currentThread: name });
        await sleep(delayMs);
      }

      // Build the ordered File list: local base64 first, then central (downloaded via background).
      const files = [];
      for (const v of local) {
        try {
          files.push(dataUrlToFile(v.dataUrl, v.name, v.type));
        } catch (e) {
          /* skip a bad local video */
        }
      }
      for (const v of central) {
        try {
          const r = await ask({ type: "FETCH_VIDEO", url: v.url });
          if (r && r.ok && r.base64) {
            const mime = r.mime || "video/mp4";
            files.push(dataUrlToFile(`data:${mime};base64,${r.base64}`, v.name || "video.mp4", mime));
          }
        } catch (e) {
          /* skip a video that failed to download */
        }
      }
      if (!files.length) {
        setStatus({ lastError: "video: nothing to send (download failed?)" });
        return;
      }

      let anyOk = false;
      for (let i = 0; i < files.length; i++) {
        setStatus({ lastAction: `sending video ${i + 1}/${files.length}…`, currentThread: name });
        const ok = await injectVideo(files[i]);
        anyOk = anyOk || ok;
        if (i < files.length - 1) await sleep(rand(4000, 7000)); // gap between videos
      }
      if (anyOk) {
        sent[id] = true; // mark so we never send the video(s) twice in the same chat
        await setLocal({ videoSentThreads: sent });
        setStatus({ lastAction: "demo video(s) sent ✓", currentThread: name });
      } else {
        setStatus({ lastError: "couldn't attach video (no uploader found) — will retry" });
      }
    } catch (e) {
      setStatus({ lastError: "video error: " + e.message });
    }
  }

  /* ---------------- handle ONE conversation ---------------- */
  async function handleThread(anchor) {
    const id = threadId(anchor);
    const name = anchorName(anchor);
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    setStatus({ currentThread: name, lastAction: "opening", lastError: null });

    safe(() => anchor.click());
    await sleep(2000);
    if (id && !location.href.includes(id)) {
      setStatus({ lastError: "couldn't open thread " + id });
      return;
    }
    const composer = await waitForComposer();
    if (!composer) {
      setStatus({ lastError: "thread didn't load" });
      return;
    }
    await sleep(700); // let the last bubbles settle

    const turn = buyerSpokeLast();
    if (!turn) {
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      // You spoke last — nothing to reply to. But if this chat never received the
      // demo video, send it now (once per chat, no delay), so quiet/older chats
      // still get it instead of being skipped outright.
      await maybeSendVideo(id, name, true);
      setStatus({ lastAction: "skip — you spoke last (checked for missing video)", currentThread: name });
      return;
    }
    if (lastHandled[id] === turn.buyerMessage) {
      setStatus({ lastAction: "skip — already replied to this message", currentThread: name });
      return;
    }
    setStatus({ lastAction: "buyer said: " + trunc(turn.buyerMessage, 80), currentThread: name });

    const reply = await ask({ type: "GET_REPLY_SIMPLE", buyerMessage: turn.buyerMessage, context: turn.transcript, threadName: name });
    if (!reply || !reply.ok) {
      setStatus({ lastError: "Claude error: " + (reply && reply.error) });
      return;
    }
    if (reply.skip) {
      setStatus({ lastAction: "skip — " + reply.reason, currentThread: name });
      return;
    }
    if (reply.human) {
      lastHandled[id] = turn.buyerMessage;
      setStatus({ lastAction: "needs you: " + reply.reason, currentThread: name });
      return;
    }
    if (!reply.text || !reply.text.trim()) {
      setStatus({ lastAction: "skip — empty reply" });
      return;
    }

    // small, human-ish delay before replying
    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const delayMs = (settings.responseDelaySec || 15) * 1000 + rand(0, (settings.jitterSec || 15) * 1000);
    setStatus({ lastAction: "waiting " + Math.round(delayMs / 1000) + "s before replying", currentThread: name });
    await sleep(delayMs);

    const sent = await typeAndSend(composer, reply.text);
    if (!sent) {
      setStatus({ lastError: "typed the reply but couldn't send it" });
      return;
    }
    lastHandled[id] = turn.buyerMessage;
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    setStatus({ lastAction: "replied ✓", lastReplySent: trunc(reply.text, 200), currentThread: name });

    // Schedule a follow-up (background handles the timing). Re-armed on every
    // reply, so it only fires after the conversation has gone quiet. Fire-and-forget.
    ask({ type: "BOT_REPLIED", threadId: id });

    // After the text reply, send the demo video once per chat (optional, isolated).
    await maybeSendVideo(id, name);
  }

  /* ---------------- main loop ---------------- */
  function onMarketplace() {
    return /messenger\.com/.test(location.host) || /facebook\.com\/(messages|marketplace)/.test(location.href);
  }
  async function scan() {
    if (busy) return;
    const anchors = conversationAnchors();
    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    setStatus({ marketplaceAnchorCount: anchors.length, lastAction: settings.enabled ? "scanning" : "off" });
    if (!settings.enabled || !onMarketplace()) return;

    // the next conversation whose cooldown has passed (rotates through all of them)
    const target = anchors.find((a) => {
      const id = threadId(a);
      return !cooldowns[id] || Date.now() > cooldowns[id];
    });
    if (!target) return;

    if (busy) return;
    busy = true;
    try {
      await handleThread(target);
    } catch (e) {
      setStatus({ lastError: "error: " + e.message });
    } finally {
      busy = false;
    }
  }

  /* ---------------- popup / heartbeat messages ---------------- */
  chrome.runtime.onMessage.addListener((msg, _sender, send) => {
    if (msg && msg.type === "TICK_NOW") {
      scan(); // background heartbeat — keeps us going while the tab is in the background
      send({ ok: true });
      return true;
    }
    if (msg && msg.type === "PING") {
      send({ ok: true, url: location.href, anchorCount: conversationAnchors().length });
      return true;
    }
    if (msg && msg.type === "SEND_FOLLOWUP") {
      // Background's follow-up alarm fired. Open the thread and nudge — but ONLY if
      // we still spoke last (if the buyer already replied, the normal loop handles it).
      (async () => {
        if (busy) return send({ ok: false, error: "busy" });
        const anchor = conversationAnchors().find((a) => threadId(a) === msg.threadId);
        if (!anchor) return send({ ok: false, error: "thread not found" });
        busy = true;
        try {
          safe(() => anchor.click());
          await sleep(2200);
          const composer = await waitForComposer();
          if (!composer) return send({ ok: false, error: "no composer" });
          await sleep(600);
          if (buyerSpokeLast()) {
            setStatus({ lastAction: "follow-up skipped — buyer already active", currentThread: anchorName(anchor) });
            return send({ ok: true, skipped: true });
          }
          const ok = await typeAndSend(composer, msg.text);
          setStatus({ lastAction: ok ? "follow-up sent ✓" : "follow-up failed", currentThread: anchorName(anchor) });
          send({ ok });
        } catch (e) {
          send({ ok: false, error: e.message });
        } finally {
          busy = false;
        }
      })();
      return true;
    }
    if (msg && msg.type === "SCAN") {
      // popup "Scan now" — show what we currently see in the list
      const anchors = conversationAnchors();
      send({
        ok: true,
        dump: {
          anchorCount: anchors.length,
          capturedCount: anchors.length,
          fingerprints: anchors.map((a, i) => ({
            index: i,
            name: anchorName(a),
            unread: "",
            signal: "",
            ariaLabel: safe(() => a.getAttribute("aria-label"), ""),
          })),
        },
      });
      return true;
    }
    return false;
  });

  /* ---------------- boot ---------------- */
  log("loaded (simple mode) on", location.href);
  setStatus({ lastAction: "loaded" });
  setTimeout(scan, 2500);
  setInterval(scan, SCAN_MS);
})();
