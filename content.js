/* =====================================================================
 * SubSell Marketplace Auto-Reply — content script (SIMPLE mode)
 * ---------------------------------------------------------------------
 * Takes over the Messenger Marketplace inbox and does ONE thing:
 *
 *   1. Go through every conversation in the list (unread chats first).
 *   2. Open it and read the LAST message (text OR photo/video attachment).
 *   3. If that last message is from the BUYER:
 *        a. send the demo video(s) INSTANTLY (once per chat, if enabled),
 *        b. ask Claude for a text reply,
 *        c. wait the configured response delay, then type + send the text.
 *   4. Move on. Repeat.
 *
 * One reading method: the message column is bounded by the composer box;
 * your messages sit on the right, the buyer's on the left. Unread priority
 * is a best-effort bold-text heuristic — when it fails we simply fall back
 * to the old rotation, never worse.
 * ===================================================================== */
(() => {
  "use strict";

  const THREAD_SELECTOR = 'a[href*="/t/"]'; // messenger.com & facebook.com thread links
  const SCAN_MS = 8000; // how often we look for the next chat to handle
  const COOLDOWN_MS = 90 * 1000; // wait before re-checking a chat we just acted on
  const IDLE_COOLDOWN_MS = 4 * 60 * 1000; // wait for chats where WE spoke last (unread bypasses it)
  const UNREAD_REOPEN_MS = 45 * 1000; // min spacing between opens of the same unread chat

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
  const lastHandled = {}; // threadId -> dedupe key of the buyer turn we last replied to
  const lastOpenedAt = {}; // threadId -> last time we opened it (spaces out unread re-opens)
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
  // Long UI phrases match as prefixes; SHORT words match exactly — the old
  // prefix match on "sent"/"seen"/"mon…" was eating real buyer messages
  // ("sent you an offer", "mon budget c'est 300") and those chats never got
  // a reply because the bot then thought IT spoke last.
  const NOISE_PREFIX = [
    "privacy & support", "privacy and support", "customize chat", "chat members",
    "media, files and links", "media files and links", "rate seller", "more options",
    "active now", "view profile", "view seller profile", "see listing", "you sent",
  ];
  const NOISE_EXACT = [
    "marketplace", "mute", "search", "block", "enter", "sent", "delivered",
    "seen", "report", "archive",
  ];
  function isNoise(text) {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return true;
    if (/^(ca\s?)?\$\s?\d[\d.,\s]*$/.test(t)) return true; // price card ("CA$420") — amount ONLY, "300$ cash?" survives
    if (/^\d+\s*(go|gb|tb)\b[^a-z0-9]*$/.test(t)) return true; // spec card ("128 GB ·") — "128gb still available?" survives
    if (/^\d{1,2}\s*[:h]\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?$/.test(t)) return true; // bare time
    if (/^[a-zà-ÿ]{2,10}\.?,?\s+\d{1,2}\s*[:h]\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?$/.test(t)) return true; // "sat 7:11 pm" headers
    if (/^(yesterday|today|hier|aujourd'hui)\s*(at|à)?\s*\d{1,2}\s*[:h]\s*\d{2}/.test(t)) return true; // "today at 7:11"
    if (/^(yesterday|today|hier|aujourd'hui)$/.test(t)) return true; // bare relative-date header
    if (/^to help identify/.test(t) || t.includes("meta may use technology")) return true; // Meta footer
    return NOISE_EXACT.some((n) => t === n) || NOISE_PREFIX.some((n) => t.startsWith(n));
  }

  // Returns the conversation as [{ role:"buyer"|"me", text }] oldest→newest, or [].
  // Includes "[attachment]" entries for photo/video/sticker bubbles so a buyer
  // whose LAST message is just a picture still gets answered (those chats used
  // to look like "we spoke last" and were skipped forever).
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
    // Media bubbles: real photos/videos in the message column. Avatars and
    // inline emoji are tiny (<48px) and upload previews use blob: URLs — skip both.
    const media = safe(() => Array.from(main.querySelectorAll('[role="row"] img, [role="row"] video')), []);
    for (const el of media) {
      const src = safe(() => el.getAttribute("src") || "", "");
      if (src.startsWith("blob:")) continue; // composer upload preview, not a message
      if (safe(() => el.closest("a[href]"), null)) continue; // listing card / profile links
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width < 48 || r.height < 48) continue;
      const cx = r.left + r.width / 2;
      if (cx < left - 40 || cx > right + 40) continue;
      if (r.top >= top) continue;
      const key = "[attachment]@" + Math.round(r.top / 40); // merge poster+player of one bubble
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ role: cx > center ? "me" : "buyer", text: "[attachment]", top: r.top });
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
    // Dedupe key = what WE last said + how many buyer bubbles followed + the
    // buyer's text. Keying on the text alone meant a buyer who repeated the
    // same words later ("ok", "?") was skipped forever.
    let lastMine = "";
    let trailing = 0;
    for (let i = convo.length - 1; i >= 0; i--) {
      if (convo[i].role === "me") {
        lastMine = convo[i].text;
        break;
      }
      trailing++;
    }
    const buyerMessage =
      last.text === "[attachment]"
        ? "(the buyer sent a photo/video attachment with no text)"
        : last.text;
    const transcript = convo
      .slice(-12)
      .map((m) => (m.role === "buyer" ? "Buyer: " : "You: ") + m.text)
      .join("\n");
    return {
      buyerMessage,
      transcript,
      dedupeKey: lastMine + "\u0001" + trailing + "\u0001" + last.text,
    };
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
  // Drop the file into Messenger's uploader and send it. Tries the hidden file
  // input, then a paste, then drag-drop — and only reports success if the upload
  // preview ACTUALLY appeared. (The old version returned true as soon as an
  // event was dispatched, so threads got marked "video sent" when nothing was
  // ever attached — the main reason videos silently never went out.)
  const PREVIEW_SEL = 'img[src^="blob:"], [role="progressbar"]';
  async function waitForNewPreview(main, before, ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      await sleep(800);
      if (safe(() => main.querySelectorAll(PREVIEW_SEL).length, before) > before) return true;
    }
    return false;
  }
  function pickFileInput() {
    const inputs = safe(() => Array.from(document.querySelectorAll('input[type="file"]')), []);
    const accepts = (el) => (safe(() => el.getAttribute("accept"), "") || "").toLowerCase();
    return (
      inputs.find((el) => accepts(el).includes("video")) ||
      inputs.find((el) => !accepts(el) || accepts(el).includes("*")) ||
      inputs[0] ||
      null
    );
  }
  async function injectVideo(file) {
    const main = getMain() || document;
    const before = safe(() => main.querySelectorAll(PREVIEW_SEL).length, 0);
    const composer = findComposer();
    if (composer) composer.focus();

    const tryInput = () => {
      const input = pickFileInput();
      if (!input) return false;
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    const tryPaste = () => {
      if (!composer) return false;
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: dt });
      composer.dispatchEvent(ev);
      return true;
    };
    const tryDrop = () => {
      if (!composer) return false;
      const dt = new DataTransfer();
      dt.items.add(file);
      for (const t of ["dragenter", "dragover", "drop"]) {
        const ev = new DragEvent(t, { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "dataTransfer", { value: dt });
        composer.dispatchEvent(ev);
      }
      return true;
    };

    let attached = false;
    for (const attempt of [tryInput, tryPaste, tryDrop]) {
      if (!safe(attempt, false)) continue;
      attached = await waitForNewPreview(main, before, 12000);
      if (attached) break;
    }
    if (!attached) return false; // nothing ever reached the uploader — caller retries later

    // Let the upload finish before sending (progressbar gone, up to 60s for big files).
    const upStart = Date.now();
    while (Date.now() - upStart < 60000) {
      if (!safe(() => main.querySelector('[role="progressbar"]'), null)) break;
      await sleep(1000);
    }
    await sleep(1200);

    // Send it: Enter, then the send button, then Enter again — verified by the
    // upload preview leaving the composer tray.
    const cleared = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        await sleep(700);
        if (safe(() => main.querySelectorAll(PREVIEW_SEL).length, 0) <= before) return true;
      }
      return false;
    };
    const composer2 = findComposer();
    if (composer2) pressEnter(composer2);
    if (await cleared()) return true;
    clickSend();
    if (await cleared()) return true;
    if (composer2) {
      composer2.focus();
      pressEnter(composer2);
    }
    await cleared();
    return true; // it attached and we pushed every send path — don't re-attach a duplicate
  }
  // Send the stored demo video(s) to the current chat — INSTANTLY when the buyer
  // messages (no delay; the TEXT reply is the one that waits), ONCE per chat.
  // Supports MULTIPLE videos, sent in order. Failed attach attempts are retried
  // on later scans, up to VIDEO_MAX_TRIES per chat.
  const VIDEO_MAX_TRIES = 3;
  async function maybeSendVideo(id, name) {
    try {
      const cfg = await getLocal(["videoEnabled", "demoVideos", "demoVideo", "videoSentThreads", "videoTries"]);
      if (!cfg.videoEnabled) return;
      let vids = Array.isArray(cfg.demoVideos) ? cfg.demoVideos : [];
      if (!vids.length && cfg.demoVideo && cfg.demoVideo.dataUrl) vids = [cfg.demoVideo]; // legacy single
      vids = vids.filter((v) => v && v.dataUrl);
      if (!vids.length) return;
      const sent = cfg.videoSentThreads || {};
      if (sent[id]) return; // already sent in this conversation
      const tries = cfg.videoTries || {};
      if ((tries[id] || 0) >= VIDEO_MAX_TRIES) return; // uploader keeps rejecting — stop trying this chat
      tries[id] = (tries[id] || 0) + 1;
      await setLocal({ videoTries: tries });

      let sentCount = 0;
      for (let i = 0; i < vids.length; i++) {
        setStatus({ lastAction: `sending video ${i + 1}/${vids.length}…`, currentThread: name });
        const file = dataUrlToFile(vids[i].dataUrl, vids[i].name, vids[i].type);
        if (await injectVideo(file)) sentCount++;
        if (i < vids.length - 1) await sleep(rand(3000, 5000)); // gap between videos
      }
      if (sentCount > 0) {
        // At least one went out — mark the chat done so we never send duplicates.
        sent[id] = true;
        await setLocal({ videoSentThreads: sent });
        setStatus({ lastAction: `demo video(s) sent ✓ (${sentCount}/${vids.length})`, currentThread: name });
        ask({ type: "LOG_EVENT", entry: { thread: name, action: "video", reply: `sent ${sentCount}/${vids.length} demo video(s)` } });
      } else {
        setStatus({ lastError: `video didn't attach (try ${tries[id]}/${VIDEO_MAX_TRIES}) — will retry` });
      }
    } catch (e) {
      setStatus({ lastError: "video error: " + e.message });
    }
  }

  /* ---------------- handle ONE conversation ---------------- */
  async function handleThread(anchor) {
    const id = threadId(anchor);
    const name = anchorName(anchor);
    lastOpenedAt[id] = Date.now();
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
      setStatus({ lastAction: "skip — you spoke last (nothing to answer)", currentThread: name });
      return;
    }
    if (lastHandled[id] === turn.dedupeKey) {
      setStatus({ lastAction: "skip — already replied to this message", currentThread: name });
      return;
    }
    setStatus({ lastAction: "buyer said: " + trunc(turn.buyerMessage, 80), currentThread: name });

    // Cheap LOCAL pre-check (no API call): business hours + caps gate the
    // instant video too, so nothing goes out at 3 AM or over the limits.
    const st = await ask({ type: "GET_STATUS" });
    if (st && st.ok) {
      if (!st.withinHours) {
        cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
        setStatus({ lastAction: "skip — outside business hours", currentThread: name });
        return;
      }
      if (st.hourlyCap && st.hourCount >= st.hourlyCap) {
        setStatus({ lastAction: "skip — hourly cap reached", currentThread: name });
        return;
      }
      if (st.fullDailyCap && st.dayCount >= st.fullDailyCap) {
        setStatus({ lastAction: "skip — daily cap reached", currentThread: name });
        return;
      }
    }

    // 1) demo video FIRST — triggered instantly by the buyer's message
    //    (once per chat). The text reply below is the one that waits.
    await maybeSendVideo(id, name);

    // 2) ask Claude for the text reply.
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
      lastHandled[id] = turn.dedupeKey;
      setStatus({ lastAction: "needs you: " + reply.reason, currentThread: name });
      return;
    }
    if (!reply.text || !reply.text.trim()) {
      setStatus({ lastAction: "skip — empty reply" });
      return;
    }

    // 3) the TEXT reply respects the configured delay (human-ish typing lag).
    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const delayMs = (settings.responseDelaySec || 15) * 1000 + rand(0, (settings.jitterSec || 15) * 1000);
    setStatus({ lastAction: "waiting " + Math.round(delayMs / 1000) + "s before replying", currentThread: name });
    await sleep(delayMs);

    // Messenger may have re-rendered the composer while the video uploaded.
    const composerNow = findComposer() || composer;
    const sent = await typeAndSend(composerNow, reply.text);
    if (!sent) {
      setStatus({ lastError: "typed the reply but couldn't send it" });
      return;
    }
    lastHandled[id] = turn.dedupeKey;
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    setStatus({ lastAction: "replied ✓", lastReplySent: trunc(reply.text, 200), currentThread: name });

    // Schedule a follow-up (background handles the timing). Re-armed on every
    // reply, so it only fires after the conversation has gone quiet. Fire-and-forget.
    ask({ type: "BOT_REPLIED", threadId: id });
  }

  /* ---------------- main loop ---------------- */
  function onMarketplace() {
    return /messenger\.com/.test(location.host) || /facebook\.com\/(messages|marketplace)/.test(location.href);
  }
  // Best-effort unread detection: Messenger renders unread rows' preview text
  // in a bold font. If the heuristic misses, we just fall back to the normal
  // rotation — it can only make replies FASTER, never stop them.
  function isUnread(anchor) {
    return safe(() => {
      const spans = anchor.querySelectorAll('span[dir="auto"]');
      let n = 0;
      for (const s of spans) {
        if (++n > 12) break;
        const w = parseInt(getComputedStyle(s).fontWeight, 10) || 0;
        if (w >= 600) return true;
      }
      return false;
    }, false);
  }
  async function scan() {
    if (busy) return;
    const anchors = conversationAnchors();
    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const unread = anchors.filter(isUnread);
    setStatus({
      marketplaceAnchorCount: anchors.length,
      unreadCount: unread.length,
      lastAction: settings.enabled ? "scanning" : "off",
    });
    if (!settings.enabled || !onMarketplace()) return;

    const now = Date.now();
    // Unread chats jump the queue (a buyer just wrote — answer promptly) and
    // bypass idle cooldowns; a minimum reopen spacing plus oldest-first order
    // stops any single chat from being hammered in a loop. Everything else
    // rotates through cooldowns exactly like before.
    const unreadEligible = unread
      .filter((a) => now > (lastOpenedAt[threadId(a)] || 0) + UNREAD_REOPEN_MS)
      .sort((a, b) => (lastOpenedAt[threadId(a)] || 0) - (lastOpenedAt[threadId(b)] || 0));
    const target =
      unreadEligible[0] ||
      anchors.find((a) => {
        const id = threadId(a);
        return !cooldowns[id] || now > cooldowns[id];
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
            unread: isUnread(a),
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
