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
  let cooldowns = {}; // threadId -> timestamp we may re-check it (persisted, shared across tabs)
  let lastHandled = {}; // threadId -> the buyer message we last replied to (persisted)
  // threadId -> how many TEXT replies the bot has sent in this whole conversation.
  // This is the hard per-conversation reply cap (maxRepliesPerConvo). Counted ONLY on a
  // confirmed text send, so videos and follow-ups never inflate it. Persisted, so it
  // survives convo-switching, page reloads and content-script restarts — once a chat
  // hits the cap it stays capped even when the buyer keeps asking questions.
  let replyCounts = {};
  let tick = {}; // live status shown in the popup

  // Texts WE recently sent — a hard guard so the bot never replies to its own
  // message even if alignment detection ever slips. PERSISTED so a content-script
  // reload (common on laggy Remote Desktop) doesn't re-arm the self-reply bug.
  let recentSent = [];
  const normMsg = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
  // Hydrate persisted state at boot.
  safe(() =>
    chrome.storage.local.get(["recentSent", "cooldowns", "lastHandled", "replyCounts"], (r) => {
      if (r && Array.isArray(r.recentSent)) recentSent = r.recentSent;
      if (r && r.cooldowns && typeof r.cooldowns === "object") cooldowns = r.cooldowns;
      if (r && r.lastHandled && typeof r.lastHandled === "object") lastHandled = r.lastHandled;
      if (r && r.replyCounts && typeof r.replyCounts === "object") replyCounts = r.replyCounts;
    })
  );
  function rememberSent(t) {
    const m = normMsg(t);
    if (!m) return;
    recentSent.push(m);
    while (recentSent.length > 60) recentSent.shift();
    safe(() => chrome.storage.local.set({ recentSent }));
  }
  function persistDedup() {
    // keep the persisted maps from growing unbounded (cap ~400 threads)
    for (const map of [cooldowns, lastHandled, replyCounts]) {
      const keys = Object.keys(map);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete map[k];
    }
    safe(() => chrome.storage.local.set({ cooldowns, lastHandled, replyCounts }));
  }
  function isOwnEcho(msg) {
    const m = normMsg(msg);
    if (!m) return false;
    return recentSent.some((s) => s === m || (m.length > 12 && (s.includes(m) || m.includes(s))));
  }

  // Cross-tab single-flight: if the operator has >1 Messenger tab open in the SAME
  // Chrome profile, both run their own scan loop and would otherwise grab the same
  // chat and double-reply/double-video. A short storage "lease" per threadId — with
  // last-writer-wins verification and a stale timeout — ensures only one tab acts on
  // a given thread at a time. Degrades safely: a failed acquire just skips (no spam).
  const TAB_UID = safe(
    () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    String(Date.now()) + ":" + Math.random()
  );
  const LOCK_MS = 120000; // a lease older than this is considered stale (crashed tab)
  async function acquireThreadLock(id) {
    const now = Date.now();
    const locks = (await getLocal(["threadLocks"])).threadLocks || {};
    const cur = locks[id];
    if (cur && cur.tab !== TAB_UID && now - (cur.at || 0) < LOCK_MS) return false; // another tab holds a fresh lease
    locks[id] = { at: now, tab: TAB_UID };
    for (const k of Object.keys(locks)) if (now - (locks[k].at || 0) > LOCK_MS) delete locks[k]; // prune stale
    await setLocal({ threadLocks: locks });
    const after = (await getLocal(["threadLocks"])).threadLocks || {};
    return !!(after[id] && after[id].tab === TAB_UID); // confirm we actually won the race
  }
  async function releaseThreadLock(id) {
    const locks = (await getLocal(["threadLocks"])).threadLocks || {};
    if (locks[id] && locks[id].tab === TAB_UID) {
      delete locks[id];
      await setLocal({ threadLocks: locks });
    }
  }

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
  // Multi-word phrases are matched as a prefix; SHORT single words must match EXACTLY
  // (so a real buyer message like "Sent it yet?" or "Mute point…" isn't dropped).
  const NOISE = [
    "privacy & support", "privacy and support", "customize chat", "chat members",
    "media, files and links", "media files and links", "rate seller", "more options",
    "you sent", "view profile", "view seller profile", "see listing",
  ];
  const NOISE_EXACT = new Set([
    "marketplace", "mute", "search", "block", "enter", "sent", "delivered",
    "seen", "active now", "report", "archive", "vu", "distribué", "envoyé",
  ]);
  function isNoise(text) {
    const t = text.trim().toLowerCase().replace(/\s+/g, " ");
    if (!t) return true;
    if (/^ca\$|^\$\d|^\d+\s*(go|gb|tb)\b/.test(t)) return true; // price / spec card
    if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(t)) return true; // bare time
    if (/^(mon|tue|wed|thu|fri|sat|sun)\b/i.test(t)) return true; // "Sat 7:11 PM" headers
    if (/^(yesterday|today|hier|aujourd)/i.test(t)) return true; // relative date headers
    if (/^to help identify/.test(t) || t.includes("meta may use technology")) return true; // Meta footer
    // Facebook system / rating prompts — NOT real buyer messages (don't reply to these).
    if (/^you can now rate/.test(t)) return true; // "You can now rate each other"
    if (/^people (may|can) rate/.test(t)) return true; // "People may rate one another based on…"
    if (/^rate /.test(t)) return true; // "Rate Zachary" / "Rate seller" button
    if (/started this chat/.test(t)) return true; // "X started this chat"
    if (/^mark as sold$/.test(t)) return true;
    if (/^view buyer/.test(t)) return true; // "View buyer" / "View buyer profile"
    if (/automated suggestion/.test(t)) return true; // "This is an automated suggestion."
    if (/waiting for your response/.test(t)) return true; // "X is waiting for your response."
    if (/add video to listing|update listing/.test(t)) return true;
    if (/allow other buyers|part of your marketplace listing/.test(t)) return true;
    if (/^message sent$/.test(t)) return true;
    if (/ sent you a (message|video|photo|gif)/.test(t)) return true; // "X sent you a message"
    if (/^more options$|^view listing$|^see listing$/.test(t)) return true;
    // Facebook "Send a quick response" card + its preset reply buttons (seller options,
    // NOT buyer messages).
    if (/send a quick response|tap a response|réponse rapide|envoyer une réponse/.test(t)) return true;
    if (/^(yes, are you interested|in talks|sorry,? it'?s not available|is this still available|yes,? it'?s available|when can you|is this available)/.test(t)) return true;
    // FRENCH equivalents of the system/UI lines above (operator runs FR accounts too).
    if (/suggestion automatis/.test(t)) return true; // "Ceci est une suggestion automatisée"
    if (/attend (ta|votre) réponse/.test(t)) return true; // "X attend ta/votre réponse"
    if (/vous a envoyé un|t'a envoyé un/.test(t)) return true; // "X vous a envoyé un message"
    if (/a démarré (cette|la) discussion|a lancé cette conversation/.test(t)) return true;
    if (/ajouter (une |la )?vidéo|mettre à jour l'annonce|voir l'acheteur|marquer comme vendu/.test(t)) return true;
    if (/^(jour|hier|aujourd|lun|mar|mer|jeu|ven|sam|dim)\b/.test(t)) return true; // FR date headers
    return NOISE_EXACT.has(t) || NOISE.some((n) => t === n || t.startsWith(n));
  }

  // Is this text node inside OUR (seller) message bubble? Facebook paints the
  // SELLER's bubbles blue / a blue-purple gradient and the BUYER's a neutral gray.
  // Color is far more reliable than geometry (immune to window width, the right
  // panel being open, wide bubbles, zoom, Remote-Desktop lag). We only ever use
  // this to declare "me" — it never declares "buyer" — so it can only PREVENT the
  // bot from replying to its own message, never cause a new misread.
  // TRI-STATE: true = ours (blue/gradient), false = the buyer's (neutral gray),
  // null = can't tell. "null" must NEVER be treated as "buyer" by callers — that was
  // the bug that made ambiguity default to a reply. Theme-agnostic (works in dark mode).
  function looksLikeOurBubble(el) {
    let node = el;
    for (let i = 0; i < 12 && node && node.nodeType === 1; i++) {
      const cs = safe(() => getComputedStyle(node), null);
      if (cs) {
        const radius = Math.max(
          parseFloat(cs.borderTopLeftRadius) || 0,
          parseFloat(cs.borderTopRightRadius) || 0,
          parseFloat(cs.borderBottomLeftRadius) || 0,
          parseFloat(cs.borderBottomRightRadius) || 0
        );
        if (radius >= 8) {
          // This is the rounded message bubble. Decide from its paint.
          if (/gradient/i.test(cs.backgroundImage || "")) return true; // our outgoing bubble is a gradient
          const m = (cs.backgroundColor || "").match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?/);
          if (!m) return null; // no solid bg → unknown
          const r = +m[1], g = +m[2], b = +m[3], a = m[4] == null ? 1 : +m[4];
          if (a < 0.2) return null; // transparent / not painted yet → unknown
          if (b > r + 20 && b > g + 12 && b >= 120) return true; // blue-dominant → us
          if (Math.abs(r - g) < 18 && Math.abs(g - b) < 22) return false; // neutral gray → the buyer's
          return null; // colored but not clearly blue → unknown
        }
      }
      node = node.parentElement;
    }
    return null; // never found a bubble → unknown
  }

  // Returns the conversation as [{ role:"buyer"|"me", text }] oldest→newest, or [].
  function readConversation() {
    const main = getMain();
    const composer = findComposer();
    if (!main || !composer) return []; // not a loaded thread → read nothing
    const c = composer.getBoundingClientRect();
    const cLeft = c.left, cRight = c.right, top = c.top; // messages live above the input

    // Pass 1 — collect candidate message text nodes (filtered) with their rects.
    const cands = [];
    const seen = new Set();
    let nodes = safe(() => Array.from(main.querySelectorAll('[role="row"] [dir="auto"]')), []);
    if (!nodes.length) nodes = safe(() => Array.from(main.querySelectorAll('[dir="auto"]')), []);
    for (const el of nodes) {
      if (safe(() => el.querySelector('[dir="auto"]'), null)) continue; // leaf text only
      if (safe(() => el.closest("a[href]"), null)) continue; // skip links (listing card, profile)
      // Skip anything inside a button/menu — Facebook's "Send a quick response" preset
      // buttons (Yes, are you interested? / Sorry, it's not available. …) and other UI
      // chips look like gray left-aligned bubbles but are NOT buyer messages.
      if (safe(() => el.closest('[role="button"],[role="menuitem"],button'), null)) continue;
      const text = safe(() => (el.innerText || el.textContent || "").trim(), "");
      if (!text || isNoise(text)) continue;
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      const cx = r.left + r.width / 2;
      if (cx < cLeft - 60 || cx > cRight + 60) continue; // roughly the message column
      if (r.top >= top) continue; // above the composer only
      const key = text + "@" + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      cands.push({ el, text, r });
    }
    if (!cands.length) return [];

    // The real message column = the span of the bubbles themselves. Self-calibrating,
    // so role detection no longer depends on the composer's exact width/position.
    let colLeft = Infinity, colRight = -Infinity;
    for (const k of cands) {
      if (k.r.left < colLeft) colLeft = k.r.left;
      if (k.r.right > colRight) colRight = k.r.right;
    }

    // Pass 2 — classify each bubble. A message is the BUYER's ONLY with positive
    // evidence (neutral-gray bubble, or — if color is unknown — clearly hugging the
    // left). Everything ambiguous is treated as "me" so the bot can never reply to
    // its own message. This is the core anti-self-reply rule.
    const out = [];
    for (const { el, text, r } of cands) {
      const ours = looksLikeOurBubble(el); // true | false | null
      let role;
      if (isOwnEcho(text) || ours === true) {
        role = "me"; // our own message
      } else if (ours === false) {
        role = "buyer"; // neutral-gray bubble = the buyer's (ours are blue/gradient)
      } else {
        // color inconclusive → only call it the buyer when it CLEARLY hugs the left
        role = (colRight - r.right) - (r.left - colLeft) > 30 ? "buyer" : "me";
      }
      out.push({ role, text, top: r.top });
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
  // Transcript regardless of who spoke last (used for smart follow-ups on quiet chats).
  function fullTranscript() {
    const convo = readConversation();
    if (!convo.length) return null;
    return convo
      .slice(-12)
      .map((m) => (m.role === "buyer" ? "Buyer: " : "You: ") + m.text)
      .join("\n");
  }
  // How many times WE (the bot) spoke in a row at the very end of the chat.
  // 0 = buyer spoke last; 1 = we replied once; 2+ = we've already followed up.
  // This is the anti-spam cap: read straight from the conversation, never a counter
  // that can drift out of sync.
  function botTailCount() {
    const convo = readConversation();
    let n = 0;
    for (let i = convo.length - 1; i >= 0; i--) {
      if (convo[i].role === "me") n++;
      else break;
    }
    return n;
  }

  /* ---------------- type + send (and VERIFY it sent) ---------------- */
  function composerText(el) {
    return safe(
      () =>
        (el.innerText || el.textContent || "")
          .replace(/[\u200b-\u200d\ufeff]/g, "") // zero-width chars Lexical injects
          .replace(/[\u00a0\u2009\u202f]/g, " ") // nbsp / thin / narrow no-break
          .trim(),
      ""
    );
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
    // keydown only (Lexical sends on keydown); shiftKey:false so it's a SEND, not a
    // soft line-break. Don't dispatch keypress/keyup — that caused double handling.
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, shiftKey: false, bubbles: true, cancelable: true })
    );
  }
  function clickSend() {
    const main = getMain() || document;
    // Only ever click a real SEND control (the label filter below). When nothing is
    // staged, Messenger shows like/mic instead of Send, so this naturally no-ops —
    // and it still works for a video-only send (empty text but an attachment staged).
    const els = safe(() => Array.from(main.querySelectorAll('[role="button"]')), []);
    for (const b of els) {
      const al = (safe(() => b.getAttribute("aria-label"), "") || "").toLowerCase();
      if (!al) continue;
      if (/voice|vocal|clip|audio|micro|record|enregistr/.test(al)) continue; // mic / voice clip
      if (/like|j'?aime|sticker|autocollant|gif|emoji|r[ée]action/.test(al)) continue; // like/sticker/gif
      if (!(/\bsend\b/.test(al) || /press enter to send/.test(al) || /envoyer un message/.test(al) || /^envoyer\b/.test(al))) continue;
      safe(() => b.click());
      return true;
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
    // Compare ignoring invisible chars Lexical injects, so a CORRECT long/multiline
    // reply isn't falsely rejected (which used to make the bot silently never reply).
    const norm = (s) =>
      (s || "").replace(/[\u200b-\u200d\ufeff]/g, "").replace(/[\u00a0\u2009\u202f]/g, " ").replace(/\s+/g, " ").trim();
    const clear = () => {
      el.focus();
      safe(() => document.execCommand("selectAll", false, null));
      safe(() => document.execCommand("delete", false, null));
    };
    const setWhole = () => {
      // Insert the ENTIRE message in ONE operation. Typing word-by-word raced and
      // jumbled/duplicated on Messenger's editor over a laggy Remote Desktop.
      clear();
      safe(() => document.execCommand("insertText", false, want));
    };

    setWhole();
    await sleep(350);
    if (norm(composerText(el)) !== norm(want)) {
      setWhole(); // one clean retry
      await sleep(450);
    }
    // If the box still isn't EXACTLY the intended message, bail — never send a
    // duplicated/garbled message to a customer.
    if (norm(composerText(el)) !== norm(want)) {
      clear();
      setStatus({ lastError: "compose mismatch — skipped to avoid a duplicate/garbled send" });
      return false;
    }

    // Send ONCE. The box clearing = it sent. Wait generously (laggy Remote Desktop),
    // and only escalate to the Send button if the box STILL holds exactly our text —
    // so we can NEVER fire a second send / a stray sticker after it already went.
    pressEnter(el);
    if (await composerEmptied(el, 5000)) return true;
    if (norm(composerText(el)) === norm(want)) {
      clickSend();
      if (await composerEmptied(el, 4000)) return true;
    }
    // Ambiguous (box neither cleared nor still our exact text) — do NOT blind-resend.
    return !composerText(el);
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

    // Wait for the upload preview to actually attach (poll up to ~25s for a NEW one).
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
    if (!attached) return false; // nothing attached → NEVER blind-press Enter (caused stray sends)
    await sleep(1500);
    const composer2 = findComposer();
    // The clip ATTACHED (uploaded into the composer). Press Enter to send, with a
    // click-Send fallback. We return TRUE on attach + send-attempt and do NOT require
    // observing the preview detach: that confirmation is flaky on slow uploads, and a
    // false "not sent" was making the caller record a failure and RETRY → duplicate
    // videos. Attach + Enter is a reliable "it's on its way"; the caller marks the chat
    // done so it can never re-send.
    if (composer2) {
      const previews = safe(() => main.querySelectorAll(previewSel).length, before);
      pressEnter(composer2);
      const s2 = Date.now();
      while (Date.now() - s2 < 6000) {
        await sleep(300);
        if (safe(() => main.querySelectorAll(previewSel).length, previews) < previews) return true; // confirmed gone = sent
      }
      clickSend(); // single fallback for layouts where Enter doesn't send
      await sleep(1500);
    }
    return true; // attached + send attempted — treat as sent (never re-upload to this chat)
  }
  // Belt-and-suspenders: does THIS open chat already show a video on our side?
  // A sent video renders as a thumbnail with a play button and a small duration
  // badge ("0:16"). Facebook renders that badge as a plain overlay span (NOT a
  // [dir="auto"] text node) and shows no real <video> element until you press play
  // — so we must scan broadly for the badge, not just [dir="auto"]. If the
  // persistent "already sent" flag is ever lost, this still stops us re-sending.
  function chatAlreadyHasOurVideo() {
    const main = getMain();
    const composer = findComposer();
    if (!main || !composer) return false;
    const c = safe(() => composer.getBoundingClientRect(), null);
    if (!c) return false;
    const top = c.top;
    const mid = c.left + c.width / 2; // column midpoint (NOT window center — panel-proof)
    // On our (seller) side AND a real message — `[role="row"]` excludes the pinned
    // LISTING CARD's own video/preview at the top (which isn't a message row).
    const ours = (el, r) =>
      !!safe(() => el.closest('[role="row"]'), null) &&
      (looksLikeOurBubble(el) === true || (r && r.left + r.width / 2 > mid));

    // (a) An actual <video> element on our side (present once the clip renders).
    const vids = safe(() => Array.from(main.querySelectorAll('[role="row"] video')), []);
    for (const v of vids) {
      const r = safe(() => v.getBoundingClientRect(), null);
      if (r && r.top < top && r.width > 0 && ours(v, r)) return true;
    }
    // (b) The duration badge ("0:16", "1:03"). It's a small overlay element on the
    //     thumbnail — usually NOT [dir="auto"] — so scan every leaf element in the
    //     message rows for one whose OWN text is exactly mm:ss and is badge-sized.
    const leaves = safe(() => Array.from(main.querySelectorAll('[role="row"] span, [role="row"] div')), []);
    for (const n of leaves) {
      if (n.childElementCount !== 0) continue; // the badge itself, not a wrapper
      const t = safe(() => (n.textContent || "").trim(), "");
      if (!/^\d{1,2}:\d{2}$/.test(t)) continue; // a video duration badge
      const r = safe(() => n.getBoundingClientRect(), null);
      if (!r || r.top >= top || r.width <= 0 || r.width > 90) continue; // small badge, in the msg area
      if (ours(n, r)) return true;
    }
    return false;
  }

  // Send the stored demo video(s) to the current chat — ONCE per chat, a set delay
  // after the text reply (default 10s). Supports MULTIPLE videos, sent in order.
  // Demo-video state machine. Goal: send the configured clip(s) EXACTLY once per chat
  // (with the first-video delay + the between-videos delay), CONFIRM they actually
  // landed, RETRY later if a send genuinely failed (backoff, capped — no spam), and
  // NEVER resend once a video is confirmed in the chat.
  const VIDEO_CLAIM_TTL = 3 * 60 * 1000; // an in-flight claim older than this is stale
  const VIDEO_RETRY_BACKOFF = 20 * 60 * 1000; // wait this long before retrying a failed send
  const VIDEO_MAX_TRIES = 3; // give up after this many failed attempts
  // Synchronous, in-memory guard: threadIds this content-script instance has already
  // committed a video to. Checked with ZERO awaits at the very top of maybeSendVideo,
  // so even if chrome.storage writes lag, a chat can't be sent to twice in one session.
  const videoLocked = new Set();
  async function recordVideoFail(id) {
    const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
    const a = am[id] || {};
    am[id] = { fails: (a.fails || 0) + 1, failAt: Date.now() };
    await setLocal({ videoAttempts: am });
  }
  async function maybeSendVideo(id, name, immediate) {
    try {
      // SYNCHRONOUS guard first (no awaits): if this instance already committed a video
      // to this chat, never touch it again — closes the rapid-re-entry "non-stop" loop.
      if (id && videoLocked.has(id)) {
        console.debug("[SubSell] video: skip — already locked this session", id);
        return;
      }
      const cfg = await getLocal([
        "videoEnabled", "demoVideos", "demoVideo", "videoDelaySec", "videoSentThreads", "videoAttempts",
      ]);

      // LOCAL videos (uploaded per-machine, base64 dataUrls).
      let local = Array.isArray(cfg.demoVideos) ? cfg.demoVideos : [];
      if (!local.length && cfg.demoVideo && cfg.demoVideo.dataUrl) local = [cfg.demoVideo]; // legacy single
      local = local.filter((v) => v && v.dataUrl);

      // CENTRAL videos + the configurable delays from the synced config.
      let central = [];
      let centralDelay = null;
      let betweenSec = null;
      try {
        const s = (await ask({ type: "GET_SETTINGS" })).settings || {};
        if (Array.isArray(s.demoVideoUrls)) central = s.demoVideoUrls.filter((v) => v && v.url);
        if (s.demoVideoDelaySec != null) centralDelay = Number(s.demoVideoDelaySec);
        if (s.demoVideoBetweenSec != null) betweenSec = Number(s.demoVideoBetweenSec);
      } catch (e) {
        /* background unavailable — just skip central videos this cycle */
      }

      if (!cfg.videoEnabled && !central.length) return;
      if (!local.length && !central.length) return;

      const now = Date.now();
      const done = cfg.videoSentThreads || {};

      // (1) CONFIRMED sent → never resend. Only the NEW {done:true} is authoritative.
      if (done[id] && done[id].done) {
        videoLocked.add(id);
        console.debug("[SubSell] video: skip — chat already marked sent", id);
        return;
      }
      // A video is visibly in the chat (real message row) → it's sent; mark + stop.
      if (chatAlreadyHasOurVideo()) {
        videoLocked.add(id);
        done[id] = { done: true, at: now };
        await setLocal({ videoSentThreads: done });
        console.debug("[SubSell] video: skip — video already visible in chat", id);
        return;
      }
      // A leftover OLD boolean `true` mark with NO actual video in the chat was a
      // premature "marked up-front" mark from the old bug — clear it so this chat
      // (the backlog that never got its video) gets it now.
      if (done[id] === true) {
        delete done[id];
        await setLocal({ videoSentThreads: done });
      }
      // (2) Backoff / give-up so a chat whose upload keeps failing isn't retried forever.
      const att0 = (cfg.videoAttempts || {})[id] || null;
      if (att0) {
        if ((att0.fails || 0) >= VIDEO_MAX_TRIES) return; // gave up
        if (att0.claimAt && now - att0.claimAt < VIDEO_CLAIM_TTL && att0.claimTab !== TAB_UID) return; // in flight elsewhere
        if (att0.failAt && now - att0.failAt < VIDEO_RETRY_BACKOFF) return; // backing off
      }
      // (3) Short-lived claim (TTL) so two passes/tabs don't both send right now.
      const attempts = (await getLocal(["videoAttempts"])).videoAttempts || {};
      const cur = attempts[id];
      if (cur && cur.claimAt && now - cur.claimAt < VIDEO_CLAIM_TTL && cur.claimTab !== TAB_UID) return;
      attempts[id] = Object.assign({}, cur, { claimAt: now, claimTab: TAB_UID });
      await setLocal({ videoAttempts: attempts });
      const verify = (await getLocal(["videoAttempts"])).videoAttempts || {};
      if (!(verify[id] && verify[id].claimTab === TAB_UID)) return; // lost the claim race

      // Delays (configurable): pause before the FIRST video + pause BETWEEN videos.
      const firstSec = centralDelay != null ? centralDelay : cfg.videoDelaySec != null ? cfg.videoDelaySec : 10;
      const gapSec = betweenSec != null && betweenSec >= 0 ? betweenSec : 8;
      if (!immediate) {
        setStatus({ lastAction: `video in ${Math.round(firstSec)}s…`, currentThread: name });
        await sleep(firstSec * 1000);
      }

      // Re-check AFTER the delay: during the wait the chat may have received a video
      // (another pass finished, or one finally rendered). Re-read storage + the DOM so
      // we never pile a second clip onto a chat that already has one.
      {
        const fresh = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (videoLocked.has(id) || (fresh[id] && fresh[id].done) || chatAlreadyHasOurVideo()) {
          videoLocked.add(id);
          if (!(fresh[id] && fresh[id].done)) {
            fresh[id] = { done: true, at: Date.now() };
            await setLocal({ videoSentThreads: fresh });
          }
          console.debug("[SubSell] video: skip after delay — chat already has a video", id);
          return;
        }
      }

      // Build the ordered File list (local first, then central downloaded via background).
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
        // Couldn't load any clip this cycle (e.g. a central download failed). Nothing
        // was sent, so DON'T mark done — but record an attempt so we back off and
        // don't refetch every single scan (self-limits via VIDEO_MAX_TRIES).
        await recordVideoFail(id);
        setStatus({ lastError: "video: couldn't load any clip — will retry later", currentThread: name });
        return;
      }

      // *** LOCK THE CHAT BEFORE SENDING — the zero-resend guarantee. ***
      // Persist {done:true} for this conversation BEFORE uploading a single clip, in
      // BOTH the in-memory set (synchronous, instant) and storage (survives reloads).
      // From this instant every other pass/tab/reload that reaches the guards above
      // sees the chat as done and skips. There is NO retry path and NO fail record for
      // the send itself: even if the upload, the send, the confirmation, AND the DOM
      // detection all fail, this chat is recorded and can NEVER receive another video.
      // (Operator priority: never re-send / never spam. A rare missed clip on a truly
      // failed upload is the accepted trade.)
      videoLocked.add(id);
      {
        const dm = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        dm[id] = { done: true, at: Date.now() };
        const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
        delete am[id];
        await setLocal({ videoSentThreads: dm, videoAttempts: am });
      }
      console.debug("[SubSell] video: LOCKED chat + sending " + files.length + " clip(s) to", id);

      // Best-effort send of the configured clip(s), in order. No retry, no fail record.
      let okCount = 0;
      for (let i = 0; i < files.length; i++) {
        setStatus({ lastAction: `sending video ${i + 1}/${files.length}…`, currentThread: name });
        if (await injectVideo(files[i])) okCount++;
        if (i < files.length - 1) await sleep(gapSec * 1000 + rand(0, 1500)); // pause BETWEEN videos
      }
      setStatus({ lastAction: `demo video(s) sent ✓ (${okCount}/${files.length})`, currentThread: name });
    } catch (e) {
      setStatus({ lastError: "video error: " + e.message });
    }
  }

  // Smart follow-up on a quiet chat (WE spoke last). Gated by configurable quiet
  // period + a per-chat count cap so it can never spam. Claude decides whether
  // there's room (or returns [SKIP]). State per thread: { lastAt, count }.
  async function maybeFollowUp(id, name) {
    try {
      const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
      if (!settings.smartFollowupEnabled) return;
      const maxCount = Math.max(0, Number(settings.smartFollowupMaxCount) || 0);
      if (maxCount <= 0) return;
      const quietH = settings.smartFollowupQuietHours != null ? Number(settings.smartFollowupQuietHours) : 6;
      const gapH = settings.smartFollowupGapHours != null ? Number(settings.smartFollowupGapHours) : 24;

      // ---- ANTI-SPAM CAP (read from the actual conversation) ----
      // Count how many messages in a row at the end are OURS. The first is our
      // reply; any beyond that are follow-ups already sent. If we've hit the cap,
      // send NOTHING. (max=1 → stop once the last 2 messages are both ours.)
      const botTail = botTailCount();
      if (botTail === 0) return; // buyer actually spoke last → not a follow-up case
      const followupsDone = botTail - 1;
      if (followupsDone >= maxCount) return; // already followed up enough → STOP

      // ---- TIME GATE ----
      const store = (await getLocal(["followUpState"])).followUpState || {};
      const now = Date.now();
      let st = store[id];
      if (!st) {
        // First time we notice this quiet chat — start the clock; don't message yet.
        store[id] = { lastAt: now };
        await setLocal({ followUpState: store });
        return;
      }
      const thresholdMs = (followupsDone === 0 ? quietH : gapH) * 3600 * 1000;
      if (now - (st.lastAt || 0) < thresholdMs) return; // not quiet long enough yet

      const transcript = fullTranscript();
      if (!transcript) return;
      const r = await ask({ type: "GET_FOLLOWUP", context: transcript, threadName: name });
      if (!r || !r.ok) {
        setStatus({ lastError: "follow-up: " + (r && r.error), currentThread: name });
        return;
      }
      // Push the clock forward whether we send or skip, so we don't re-ask every cycle.
      st.lastAt = now;
      store[id] = st;
      await setLocal({ followUpState: store });
      if (r.skip || !r.text || !r.text.trim()) {
        setStatus({ lastAction: "follow-up: no room (" + (r.reason || "skip") + ")", currentThread: name });
        return;
      }
      const composer = findComposer();
      if (!composer) return;
      setStatus({ lastAction: "follow-up: sending…", currentThread: name });
      const ok = await typeAndSend(composer, r.text);
      if (ok) {
        rememberSent(r.text); // so we never mistake our follow-up for a buyer message
        cooldowns[id] = Date.now() + COOLDOWN_MS;
        setStatus({ lastAction: `follow-up sent ✓ (${followupsDone + 1}/${maxCount})`, lastReplySent: trunc(r.text, 200), currentThread: name });
        ask({ type: "LOG_EVENT", entry: { thread: name, action: "followup", reply: r.text } });
      } else {
        setStatus({ lastError: "follow-up: typed but couldn't send" });
      }
    } catch (e) {
      setStatus({ lastError: "follow-up error: " + e.message });
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

    // Wait for the thread's messages to actually render before reading them. On slow
    // loads / Remote Desktop the message list can lag behind the URL change, so a
    // naive read would grab the PREVIOUS chat and reply with the wrong context
    // ("answering the wrong person"). Require two identical reads in a row = settled.
    let turn = buyerSpokeLast();
    let prevSig = turn ? turn.transcript : "(you-last)";
    for (let i = 0; i < 5; i++) {
      await sleep(600);
      const t = buyerSpokeLast();
      const sig = t ? t.transcript : "(you-last)";
      turn = t;
      if (sig === prevSig) break; // stable → safe to act
      prevSig = sig;
    }
    if (!turn) {
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      // You spoke last — nothing to reply to. But still: (1) send the demo video if
      // this chat never got one, and (2) consider a smart, capped follow-up if the
      // chat has been quiet long enough. Both are once/limited per chat — no spam.
      await maybeSendVideo(id, name, true);
      await maybeFollowUp(id, name);
      setStatus({ lastAction: "skip — you spoke last (checked video + follow-up)", currentThread: name });
      return;
    }
    if (isOwnEcho(turn.buyerMessage)) {
      // The "last message" is actually OUR OWN (alignment mis-read) — never reply to
      // ourselves. Hard stop against self-reply spam.
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      setStatus({ lastAction: "skip — that last message was ours, not the buyer", currentThread: name });
      return;
    }
    if (lastHandled[id] === turn.buyerMessage) {
      setStatus({ lastAction: "skip — already replied to this message", currentThread: name });
      return;
    }

    // ---- HARD PER-CONVERSATION REPLY CAP (maxRepliesPerConvo) ----
    // Count = TEXT replies the bot has already sent in THIS chat (videos & follow-ups
    // are separate and never counted). Once a chat reaches the cap we go silent for the
    // rest of the conversation — even if the buyer keeps asking more questions. Checked
    // here, before spending a Claude call. cap 0 = unlimited.
    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const replyCap = Math.max(0, Number(settings.maxRepliesPerConvo) || 0);
    const repliesSoFar = replyCounts[id] || 0;
    if (replyCap > 0 && repliesSoFar >= replyCap) {
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      // No more text replies — but the demo video is separate ("2 + videos"), so still
      // make sure this chat got its one-time video (idempotent: no-op if already sent).
      await maybeSendVideo(id, name);
      if ((settings.convoCapBehavior || "stop") === "notify") {
        setStatus({ lastAction: "needs you — reply cap reached (" + repliesSoFar + "/" + replyCap + "), buyer still messaging", currentThread: name });
      } else {
        setStatus({ lastAction: "skip — reply cap reached (" + repliesSoFar + "/" + replyCap + ") for this chat", currentThread: name });
      }
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

    // small, human-ish delay before replying (settings already fetched above for the cap)
    const delayMs = (settings.responseDelaySec || 15) * 1000 + rand(0, (settings.jitterSec || 15) * 1000);
    setStatus({ lastAction: "waiting " + Math.round(delayMs / 1000) + "s before replying", currentThread: name });
    await sleep(delayMs);

    const sent = await typeAndSend(composer, reply.text);
    if (!sent) {
      setStatus({ lastError: "typed the reply but couldn't send it" });
      return;
    }
    rememberSent(reply.text); // so we never mistake this for a buyer message later
    lastHandled[id] = turn.buyerMessage;
    replyCounts[id] = repliesSoFar + 1; // count this text reply toward the per-convo cap
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    persistDedup(); // survive a content-script reload — don't re-reply the same message (and keep the cap count)
    setStatus({
      lastAction: "replied ✓" + (replyCap > 0 ? " (" + replyCounts[id] + "/" + replyCap + ")" : ""),
      lastReplySent: trunc(reply.text, 200),
      currentThread: name,
    });

    // Schedule a follow-up (background handles the timing). Re-armed on every
    // reply, so it only fires after the conversation has gone quiet. Fire-and-forget.
    ask({ type: "BOT_REPLIED", threadId: id });

    // Buyer re-engaged and we replied — restart the smart follow-up clock for this
    // chat (the per-chat cap itself is read live from the conversation tail).
    try {
      const fs = (await getLocal(["followUpState"])).followUpState || {};
      fs[id] = { lastAt: Date.now() };
      await setLocal({ followUpState: fs });
    } catch (e) {
      /* non-fatal */
    }

    // After the text reply, send the demo video once per chat (optional, isolated).
    await maybeSendVideo(id, name);
  }

  /* ---------------- main loop ---------------- */
  function onMarketplace() {
    return /messenger\.com/.test(location.host) || /facebook\.com\/(messages|marketplace)/.test(location.href);
  }
  async function scan() {
    // Claim the lock SYNCHRONOUSLY before any await, so two scans (interval +
    // heartbeat) can never both get past here (no check/set gap).
    if (busy) return;
    busy = true;
    try {
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
      // Cross-tab lease so a second Messenger tab in this profile can't process the
      // same chat at the same time (double-reply / double-video).
      const tid = threadId(target);
      if (!(await acquireThreadLock(tid))) {
        setStatus({ lastAction: "skip — another tab/window is handling this chat", currentThread: anchorName(target) });
        return;
      }
      try {
        await handleThread(target);
      } finally {
        await releaseThreadLock(tid);
      }
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
        if (!(await acquireThreadLock(msg.threadId))) {
          busy = false;
          return send({ ok: false, error: "another tab is handling this chat" });
        }
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
          // Enforce the SAME anti-spam cap the smart-follow-up path uses, so the
          // alarm path can't post a 3rd consecutive bot message.
          const tail = botTailCount();
          const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
          const maxCount = Math.max(0, Number(settings.smartFollowupMaxCount) || 1);
          if (tail === 0 || tail - 1 >= maxCount) {
            setStatus({ lastAction: "follow-up skipped — cap reached", currentThread: anchorName(anchor) });
            return send({ ok: true, skipped: "cap" });
          }
          const ok = await typeAndSend(composer, msg.text);
          if (ok) {
            rememberSent(msg.text); // never read our own follow-up back as a buyer message
            cooldowns[msg.threadId] = Date.now() + COOLDOWN_MS;
            persistDedup();
          }
          setStatus({ lastAction: ok ? "follow-up sent ✓" : "follow-up failed", currentThread: anchorName(anchor) });
          send({ ok });
        } catch (e) {
          send({ ok: false, error: e.message });
        } finally {
          await releaseThreadLock(msg.threadId);
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
