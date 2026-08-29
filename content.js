/* =====================================================================
 * SubSell Marketplace Auto-Reply — content script (SIMPLE mode)
 * ---------------------------------------------------------------------
 * Takes over the Messenger Marketplace inbox and does ONE thing:
 *
 *   1. Go through every conversation in the list (unread chats first).
 *   2. Open it and read the LAST message (text OR photo/video attachment).
 *   3. If that last message is from the BUYER:
 *        a. ask Claude for a reply (its hours/caps/[HUMAN] screening also
 *           gates the video — scammers get neither),
 *        b. send the demo video(s) right away (once per chat, if enabled),
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
  const unreadMisses = {}; // threadId -> consecutive opens that sent nothing (demotes stuck-bold rows)
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
    // Time/date HEADERS only. Buyers type compact times ("18h30", "demain 14h30",
    // "dimanche 13h00") when scheduling a visit — those must NOT be noise, so:
    // colon or spaced-h forms only, and day words only as real day names.
    if (/^\d{1,2}\s*:\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?$/.test(t)) return true; // bare "7:11 pm"
    if (/^\d{1,2}\s+h\s+\d{2}$/.test(t)) return true; // FR header "19 h 11" (buyers type "19h11")
    if (/^(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?|lun\.|mar\.|mer\.|jeu\.|ven\.|sam\.|dim\.)\s*,?\s+\d{1,2}\s*(:\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?|\s+h\s+\d{2})$/.test(t)) return true; // "sat 7:11 pm" / "sam. 19 h 11" headers ("dimanche 13h00" survives)
    if (/^(yesterday|today|hier|aujourd['’]hui)\s*(at|à)?\s*\d{1,2}\s*[:h]\s*\d{2}/.test(t)) return true; // "today at 7:11" / "aujourd’hui à 19 h 11"
    if (/^(yesterday|today|hier|aujourd['’]hui)$/.test(t)) return true; // bare relative-date header
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
    // Our own just-sent demo video shows up as a trailing "me [attachment]"
    // bubble. Ignore those when deciding who spoke last — otherwise a buyer
    // message whose TEXT reply failed after the video went out would be
    // hidden behind our video forever.
    while (
      convo.length &&
      convo[convo.length - 1].role === "me" &&
      convo[convo.length - 1].text === "[attachment]"
    )
      convo.pop();
    if (!convo.length) return null;
    const last = convo[convo.length - 1];
    if (last.role !== "buyer") return null;
    // Dedupe key = what WE last said + how many buyer bubbles followed + the
    // buyer's text. Keying on the text alone meant a buyer who repeated the
    // same words later ("ok", "?") was skipped forever. Built from TEXT
    // bubbles only: media/header rendering varies between opens and must not
    // re-fire an already-handled message ([HUMAN] pings, paid Claude calls).
    let lastMine = "";
    let trailing = 0;
    for (let i = convo.length - 1; i >= 0; i--) {
      if (convo[i].text === "[attachment]") continue;
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
  // Drop the file into Messenger's uploader and send it, VERIFIED end to end.
  // Two failure modes of the old code are handled explicitly:
  //   - "dispatched an event" is not "attached": success requires the upload
  //     preview to actually appear in the composer TRAY;
  //   - "pressed send" is not "sent": success requires the tray to empty again.
  // The tray is everything matching PREVIEW_SEL that is NOT inside a chat
  // [role="row"] — chat bubbles (including our own sent videos) live in rows,
  // so they can't pollute the counts.
  const PREVIEW_SEL = 'img[src^="blob:"], video, [role="progressbar"]';
  function trayCount() {
    return safe(() => {
      const main = getMain() || document;
      let n = 0;
      for (const el of main.querySelectorAll(PREVIEW_SEL)) {
        if (!el.closest('[role="row"]')) n++;
      }
      return n;
    }, 0);
  }
  async function waitForTray(base, ms) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      await sleep(800);
      if (trayCount() > base) return true;
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

    // A leftover attachment from a previous failed attempt? Send IT instead of
    // stacking another copy of the file into the tray.
    let base = trayCount();
    let attached = base > 0;
    if (attached) base = 0;

    if (!attached) {
      for (const attempt of [tryInput, tryPaste, tryDrop]) {
        // A previous channel may have landed late — never attach a 2nd copy.
        if (trayCount() > base) {
          attached = true;
          break;
        }
        if (!safe(attempt, false)) continue;
        attached = await waitForTray(base, 15000);
        if (attached) break;
      }
    }
    if (!attached) return false; // nothing ever reached the uploader — caller retries later

    // Let the upload finish before sending. Sending mid-upload does nothing,
    // so if the progressbar outlives the wait, bail — the leftover-tray path
    // above will send it on the next attempt instead of re-attaching.
    const upStart = Date.now();
    while (Date.now() - upStart < 90000) {
      if (!safe(() => (getMain() || document).querySelector('[role="progressbar"]'), null)) break;
      await sleep(1000);
    }
    if (safe(() => (getMain() || document).querySelector('[role="progressbar"]'), null)) return false;
    await sleep(1200);

    // Send it: Enter, then the send button, then Enter again — verified by the
    // tray emptying back to (at most) its baseline.
    const cleared = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 8000) {
        await sleep(700);
        if (trayCount() <= base) return true;
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
    return await cleared(); // honest: unverified send = failure, retried later without re-attaching
  }
  // Send the stored demo video(s) to the current chat — INSTANTLY once Claude's
  // reply confirms this buyer should be answered (the TEXT reply is the one that
  // waits out the response delay). Each configured video is delivered at most
  // once per chat, tracked INDIVIDUALLY, and failed ones are retried up to
  // VIDEO_MAX_TRIES passes per chat.
  const VIDEO_MAX_TRIES = 3;
  const vkey = (v) => (v.name || "video") + "|" + (v.size || 0);
  async function maybeSendVideo(id, name) {
    try {
      const cfg = await getLocal(["videoEnabled", "demoVideos", "demoVideo", "videoSentThreads", "videoTries"]);
      if (!cfg.videoEnabled) return;
      let vids = Array.isArray(cfg.demoVideos) ? cfg.demoVideos : [];
      if (!vids.length && cfg.demoVideo && cfg.demoVideo.dataUrl) vids = [cfg.demoVideo]; // legacy single
      vids = vids.filter((v) => v && v.dataUrl);
      if (!vids.length) return;
      const sent = cfg.videoSentThreads || {};
      if (sent[id] === true) return; // legacy "all done" marker
      const done = Array.isArray(sent[id]) ? sent[id] : [];
      let pending = vids.filter((v) => !done.includes(vkey(v)));
      if (!pending.length) {
        sent[id] = true;
        await setLocal({ videoSentThreads: sent });
        return;
      }
      const tries = cfg.videoTries || {};
      if ((tries[id] || 0) >= VIDEO_MAX_TRIES) return; // uploader keeps rejecting — stop trying this chat
      tries[id] = (tries[id] || 0) + 1;
      await setLocal({ videoTries: tries });
      // Re-read right before sending: another tab of this profile may have
      // just delivered to this chat (narrows the multi-tab race window).
      const again = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
      if (again[id] === true) return;
      const doneNow = Array.isArray(again[id]) ? again[id] : done;
      pending = vids.filter((v) => !doneNow.includes(vkey(v)));
      if (!pending.length) return;

      let failed = 0;
      for (let i = 0; i < pending.length; i++) {
        setStatus({ lastAction: `sending video ${i + 1}/${pending.length}…`, currentThread: name });
        const v = pending[i];
        const file = dataUrlToFile(v.dataUrl, v.name, v.type);
        if (await injectVideo(file)) {
          doneNow.push(vkey(v));
          // Persist after EVERY success so a mid-pass crash can't cause a resend.
          const m = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          m[id] = doneNow;
          await setLocal({ videoSentThreads: m });
        } else {
          failed++;
        }
        if (i < pending.length - 1) await sleep(rand(3000, 5000)); // gap between videos
      }
      if (!failed) {
        const m = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        m[id] = true; // every configured video delivered — chat done
        await setLocal({ videoSentThreads: m });
        setStatus({ lastAction: `demo video(s) sent ✓ (${pending.length}/${pending.length})`, currentThread: name });
        ask({ type: "LOG_EVENT", entry: { thread: name, action: "video", reply: `sent ${pending.length} demo video(s)` } });
      } else {
        setStatus({ lastError: `${failed} video(s) didn't send (try ${tries[id]}/${VIDEO_MAX_TRIES}) — will retry` });
        if (doneNow.length > done.length) {
          ask({ type: "LOG_EVENT", entry: { thread: name, action: "video", reply: `sent ${doneNow.length - done.length} demo video(s), ${failed} pending retry` } });
        }
      }
    } catch (e) {
      setStatus({ lastError: "video error: " + e.message });
    }
  }
  // Does this chat still owe the buyer a demo video? (Used to retry a failed
  // attach on later scans even when we spoke last.)
  async function videoRetryPending(id) {
    const cfg = await getLocal(["videoEnabled", "demoVideos", "demoVideo", "videoSentThreads", "videoTries"]);
    if (!cfg.videoEnabled) return false;
    let vids = Array.isArray(cfg.demoVideos) ? cfg.demoVideos : [];
    if (!vids.length && cfg.demoVideo && cfg.demoVideo.dataUrl) vids = [cfg.demoVideo];
    vids = vids.filter((v) => v && v.dataUrl);
    if (!vids.length) return false;
    const tries = (cfg.videoTries || {})[id] || 0;
    if (tries < 1 || tries >= VIDEO_MAX_TRIES) return false; // only chats where a buyer-triggered pass already ran
    const rec = (cfg.videoSentThreads || {})[id];
    if (rec === true) return false;
    const done = Array.isArray(rec) ? rec : [];
    return vids.some((v) => !done.includes(vkey(v)));
  }

  /* ---------------- handle ONE conversation ---------------- */
  // Local gate for actions that don't go through GET_REPLY_SIMPLE (the video
  // retry path). FAILS CLOSED: no confirmed status = nothing goes out.
  async function statusAllowsSending() {
    const st = await ask({ type: "GET_STATUS" });
    if (!st || !st.ok) return false;
    if (!st.withinHours) return false;
    if (st.hourlyCap && st.hourCount >= st.hourlyCap) return false;
    if (st.fullDailyCap && st.dayCount >= st.fullDailyCap) return false;
    return true;
  }
  async function handleThread(anchor) {
    const id = threadId(anchor);
    const name = anchorName(anchor);
    lastOpenedAt[id] = Date.now();
    unreadMisses[id] = (unreadMisses[id] || 0) + 1; // reset below when we actually send
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
      // A failed video attach still owes this buyer the demo video — retry it
      // here (business hours + caps checked, fail-closed) even though the text
      // conversation is up to date.
      if (await videoRetryPending(id)) {
        if (await statusAllowsSending()) {
          await maybeSendVideo(id, name);
          return;
        }
      }
      setStatus({ lastAction: "skip — you spoke last (nothing to answer)", currentThread: name });
      return;
    }
    if (lastHandled[id] === turn.dedupeKey) {
      setStatus({ lastAction: "skip — already replied to this message", currentThread: name });
      return;
    }
    setStatus({ lastAction: "buyer said: " + trunc(turn.buyerMessage, 80), currentThread: name });

    // 1) ask Claude for the reply FIRST — its business-hours/caps gates (all
    //    checked in the background before any API spend) and its [HUMAN]
    //    screening cover the video too: scammers and off-hours messages get
    //    neither a video nor a text.
    const reply = await ask({ type: "GET_REPLY_SIMPLE", buyerMessage: turn.buyerMessage, context: turn.transcript, threadName: name });
    if (!reply || !reply.ok) {
      setStatus({ lastError: "Claude error: " + (reply && reply.error) });
      return;
    }
    if (reply.skip) {
      if (/business hours/i.test(reply.reason || "")) cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      setStatus({ lastAction: "skip — " + reply.reason, currentThread: name });
      return;
    }
    if (reply.human) {
      lastHandled[id] = turn.dedupeKey;
      unreadMisses[id] = 0;
      setStatus({ lastAction: "needs you: " + reply.reason, currentThread: name });
      return;
    }
    if (!reply.text || !reply.text.trim()) {
      setStatus({ lastAction: "skip — empty reply" });
      return;
    }

    // 2) demo video NOW — instantly, seconds after the buyer's message
    //    (once per chat). Only the text reply waits out the delay.
    await maybeSendVideo(id, name);

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
    unreadMisses[id] = 0;
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
    // bypass idle cooldowns, with two guards against a row that STAYS bold
    // (heuristic false positive / unclearable message request): a minimum
    // reopen spacing, and after 3 fruitless opens in a row the thread falls
    // back to normal cooldown pacing. Everything else rotates like before.
    const unreadEligible = unread
      .filter((a) => {
        const uid = threadId(a);
        if (now <= (lastOpenedAt[uid] || 0) + UNREAD_REOPEN_MS) return false;
        if ((unreadMisses[uid] || 0) >= 3) return !cooldowns[uid] || now > cooldowns[uid];
        return true;
      })
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
