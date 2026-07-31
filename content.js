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
 * learned rules — on purpose. Scheduling IS unread-aware: chats showing as
 * unread (waiting buyer) jump every cooldown; idle chats rotate fairly.
 * ===================================================================== */
(() => {
  "use strict";

  // Each injected instance stamps a unique generation on the shared isolated-world
  // window. When the background re-injects after an extension update, the newest
  // instance wins and any older/orphaned one self-terminates (see scan()).
  const MY_GEN = Date.now() + ":" + Math.random();
  try { window.__subsellGen = MY_GEN; } catch (e) { /* ignore */ }
  let scanTimer = null;

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
  // Watchdog: when `busy` was set (0 = idle). If a cycle ever hangs (a DOM wait that
  // never settles, a dead message port, …) the next tick force-resets after
  // BUSY_MAX_MS instead of freezing the bot until a manual page reload.
  let busySince = 0;
  const BUSY_MAX_MS = 6 * 60 * 1000; // > max legit cycle (delay+jitter+typing+videos)
  let cooldowns = {}; // threadId -> timestamp we may re-check it (persisted, shared across tabs)
  let lastOpened = {}; // threadId -> when THIS instance last opened it (unread re-open floor)
  let openFails = {}; // sidebar threadId -> consecutive failed opens (quarantine at 3)
  // NEVER-MISS LEDGER: threadId -> when we FIRST saw this chat waiting for a reply.
  // Re-verified every scan; an entry is cleared ONLY when the chat is actually
  // resolved (replied / handed to human / cap-stop / turned out not waiting).
  // Persisted so reloads can't forget anyone. Chats waiting past OVERDUE_MS jump
  // to the FRONT of the queue (oldest first) — the "make sure everyone is replied".
  let waitingSince = {};
  let suspiciousReads = {}; // threadId -> consecutive sidebar-says-buyer/chat-says-idle reads
  // VIDEO-PENDING QUEUE: threadId -> when its video set was deferred (busy queue).
  // Persisted. Serviced by its own picker lane, so a deferred set is GUARANTEED to
  // be delivered minutes later — deferral is a postponement, never a cancellation.
  let videoPending = {};
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
    chrome.storage.local.get(["recentSent", "cooldowns", "lastHandled", "replyCounts", "waitingSince", "videoPending"], (r) => {
      if (r && Array.isArray(r.recentSent)) recentSent = r.recentSent;
      if (r && r.cooldowns && typeof r.cooldowns === "object") cooldowns = r.cooldowns;
      if (r && r.lastHandled && typeof r.lastHandled === "object") lastHandled = r.lastHandled;
      if (r && r.replyCounts && typeof r.replyCounts === "object") replyCounts = r.replyCounts;
      if (r && r.waitingSince && typeof r.waitingSince === "object") waitingSince = r.waitingSince;
      if (r && r.videoPending && typeof r.videoPending === "object") videoPending = r.videoPending;
      // ONE-TIME MIGRATION (v0.21.4): the "Add video to listing" card false-positive
      // marked chats {done:true} WITHOUT sending since the fleet reinstall. Un-mark
      // every done-flag younger than 7 days so those chats finally get their videos.
      // Chats that truly received one are still protected by the strong DOM signals
      // (their video bubbles are visible in the chat).
      chrome.storage.local.get(["migVideoMarks0214", "videoSentThreads"], (m) => {
        if (m && m.migVideoMarks0214) return;
        const vt = (m && m.videoSentThreads) || {};
        const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
        let cleared = 0;
        for (const k of Object.keys(vt)) {
          const e = vt[k];
          if (e && e.done && typeof e.at === "number" && e.at > cutoff) {
            delete vt[k];
            cleared++;
          }
        }
        chrome.storage.local.set({ videoSentThreads: vt, migVideoMarks0214: true }, () => void chrome.runtime.lastError);
        if (cleared) console.debug("[SubSell] migration: cleared", cleared, "false 'video sent' marks");
      });
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
    for (const map of [cooldowns, lastHandled, replyCounts, waitingSince, videoPending]) {
      const keys = Object.keys(map);
      if (keys.length > 400) for (const k of keys.slice(0, keys.length - 400)) delete map[k];
    }
    safe(() => chrome.storage.local.set({ cooldowns, lastHandled, replyCounts, waitingSince, videoPending }));
  }
  function clearVideoPending(id) {
    if (id && videoPending[id] != null) {
      delete videoPending[id];
      persistDedup();
    }
  }
  // A chat is RESOLVED for its current message — take it off the never-miss ledger.
  function clearWaiting(id, sid) {
    if (id && waitingSince[id] != null) delete waitingSince[id];
    if (sid && waitingSince[sid] != null) delete waitingSince[sid];
    if (id) delete suspiciousReads[id];
    if (sid) delete suspiciousReads[sid];
  }
  function isOwnEcho(msg) {
    const m = normMsg(msg);
    if (!m) return false;
    // Length floor on the EXACT match too: recentSent is GLOBAL across chats, so a
    // buyer's short greeting ("allo", "oui", "ok", "merci") must never be muted just
    // because WE once sent the same word in some other chat — that made the bot
    // ignore buyers who opened with one word. Bubble color stays the primary
    // anti-self-reply; this echo guard is for longer, distinctive texts only.
    return recentSent.some((s) => (m.length >= 10 && s === m) || (m.length > 12 && (s.includes(m) || m.includes(s))));
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
  // Re-stamp a lease WE hold so it can't go stale mid-task. A legit handle (response
  // delay + typing + videos) routinely outlives LOCK_MS; without refreshing, a second
  // window could steal the lease mid-reply and double-message the buyer.
  async function refreshThreadLock(id) {
    const locks = (await getLocal(["threadLocks"])).threadLocks || {};
    if (locks[id] && locks[id].tab === TAB_UID) {
      locks[id].at = Date.now();
      await setLocal({ threadLocks: locks });
    }
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
  // Is the target conversation STILL the one open on screen? The operator may click
  // another chat while the bot is in a long wait (response delay, video delay…) —
  // sending then would post into the WRONG conversation. Every send re-checks this
  // and aborts silently if the user navigated; the chat is retried next cycle.
  function stillOnThread(id) {
    return !!id && location.href.includes(id);
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

  // Sidebar snippet heuristic: does the row's PREVIEW look like the BUYER spoke last?
  // Catches chats the operator already opened (which clears the unread style) — like
  // "Pedro sent you a message · 1h" sitting unanswered. Only affects VISIT ORDER;
  // every reply/send guard stays in charge of what actually happens.
  function snippetSuggestsBuyerLast(a) {
    const t = safe(() => a.innerText || "", "");
    if (!t) return false;
    const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) return false;
    const prev = lines.slice(1).join(" ").toLowerCase();
    // OUR last message / system & UI lines → not a waiting buyer.
    if (/^you[:\s]|^vous\s?:|you sent|vous avez envoyé|automated suggestion|suggestion automatis|to help identify|pour (mieux )?identifier|you can now rate|rate each other|vous pouvez (désormais|maintenant) (vous )?évaluer|started this chat|a démarré|marketplace ·|reacted .{0,4}to your|a réagi|liked your|a aimé/i.test(prev)) return false;
    return true;
  }

  // Does this sidebar row show as UNREAD (buyer waiting)? Two independent signals:
  // (1) Messenger's blue unread dot — a tiny, perfectly round, blue-painted element;
  // (2) bold preview text — unread rows render the name AND snippet at weight >= 600.
  // Used only to PRIORITIZE (a false positive costs one harmless visit, never a
  // duplicate reply — lastHandled/caps still gate everything downstream).
  function isUnreadAnchor(a) {
    const els = safe(() => a.querySelectorAll("span,div"), []);
    for (const el of els) {
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width < 6 || r.width > 16 || Math.abs(r.width - r.height) > 3) continue;
      const cs = safe(() => getComputedStyle(el), null);
      if (!cs) continue;
      const radius = parseFloat(cs.borderRadius) || 0;
      const m = (cs.backgroundColor || "").match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
      if (radius >= r.width / 2 - 1 && m && +m[3] > 150 && +m[3] > +m[1] + 40) return true; // blue dot
    }
    let bold = 0;
    for (const el of safe(() => a.querySelectorAll("span"), [])) {
      if (el.children.length) continue;
      const t = safe(() => (el.textContent || "").trim(), "");
      if (!t) continue;
      const w = parseInt(safe(() => getComputedStyle(el).fontWeight, "400"), 10) || 400;
      if (w >= 600 && ++bold >= 2) return true;
    }
    return false;
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
  // Best-effort: hand the file to Messenger's COMPOSER, wait for the preview to
  // actually appear, then send. AUDIT FIX (2026-07-29): the old order tried the
  // first document-global input[type=file] FIRST — which can be the LISTING CARD's
  // own "Add video to listing" uploader, silently feeding clips to the listing
  // instead of the buyer. New order: PASTE into the focused composer (unambiguous
  // target) → DRAG-DROP on the composer → file input only as a last resort, and
  // never one that lives inside the "Add video to listing" card.
  async function injectVideo(file) {
    const main = getMain() || document;
    const previewSel = 'img[src^="blob:"], [role="progressbar"], video';
    const composer = findComposer();
    if (composer) composer.focus();
    const dtFor = () => {
      const dt = new DataTransfer();
      dt.items.add(file);
      return dt;
    };
    const attempts = [];
    if (composer) {
      attempts.push(() => {
        const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clipboardData", { value: dtFor() });
        composer.dispatchEvent(ev);
        return true;
      });
      attempts.push(() => {
        const dt = dtFor();
        for (const t of ["dragenter", "dragover", "drop"]) {
          const ev = new DragEvent(t, { bubbles: true, cancelable: true });
          Object.defineProperty(ev, "dataTransfer", { value: dt });
          composer.dispatchEvent(ev);
        }
        return true;
      });
    }
    attempts.push(() => {
      // Last resort: a file input — but ONLY one that is not part of the listing
      // card's own uploader (the input whose surrounding text says "add video to
      // listing"/"update listing" belongs to the LISTING, not the chat).
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((inp) => {
        const wrap = safe(() => inp.closest("div,form,section"), null);
        const t = safe(() => ((wrap && wrap.innerText) || "").toLowerCase(), "");
        return !/add video to listing|update listing|mettre à jour l|ajouter (une |la )?vid/.test(t);
      });
      const input = inputs[inputs.length - 1]; // composer attachments render late in the DOM
      if (!input) return false;
      input.files = dtFor().files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    });

    // Try each strategy IN ORDER, and require the preview to actually attach before
    // trusting it — a dispatched event that lands nowhere no longer counts.
    let attached = false;
    for (const attempt of attempts) {
      const before = safe(() => main.querySelectorAll(previewSel).length, 0);
      if (!safe(attempt, false)) continue;
      const start = Date.now();
      while (Date.now() - start < 12000) {
        await sleep(1000);
        if (safe(() => main.querySelectorAll(previewSel).length, before) > before) {
          attached = true;
          break;
        }
      }
      if (attached) break; // this strategy worked — stop trying others
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
      const previews = safe(() => main.querySelectorAll(previewSel).length, 1);
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

    // NOTE (audit 2026-07-29): the old check (0) — matching Facebook's "Add video to
    // listing / Update listing" card TEXT anywhere in [role=main] — was a confirmed
    // FALSE-POSITIVE: FB shows that card/nudge in conversations where we never sent
    // a video, so every fresh chat was marked done-without-sending ("videos not
    // sending at all", fleet-wide after the storage-wiping reinstall). REMOVED.
    // Only the strong, row-scoped signals below may declare a chat served.
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
  // Live "why" line for the popup: every exit of the video engine reports itself, so
  // "videos not sending" is diagnosable from a screenshot instead of guesswork.
  function vstat(reason) {
    setStatus({ videoLast: reason });
  }
  async function maybeSendVideo(id, name, immediate) {
    try {
      // SYNCHRONOUS guard first (no awaits): if this instance already committed a video
      // to this chat, never touch it again — closes the rapid-re-entry "non-stop" loop.
      if (id && videoLocked.has(id)) {
        clearVideoPending(id);
        vstat("skip — already sent this session (" + (name || id) + ")");
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
      let settingsOk = true;
      try {
        const resp = await ask({ type: "GET_SETTINGS" });
        const s = (resp && resp.settings) || {};
        if (!resp || !resp.settings) settingsOk = false;
        if (Array.isArray(s.demoVideoUrls)) central = s.demoVideoUrls.filter((v) => v && v.url);
        if (s.demoVideoDelaySec != null) centralDelay = Number(s.demoVideoDelaySec);
        if (s.demoVideoBetweenSec != null) betweenSec = Number(s.demoVideoBetweenSec);
      } catch (e) {
        settingsOk = false;
      }

      // CENTRAL videos (the dashboard set) are the single source of truth when they
      // exist — legacy per-machine local clips are ignored then. This stops (a) a
      // corrupt old local file from blocking the whole set via the complete-set
      // guard, and (b) buyers receiving local+central duplicates.
      if (central.length) local = [];
      if (!settingsOk && !central.length && !local.length) {
        vstat("couldn't read settings this cycle — will retry");
        return;
      }
      if (!cfg.videoEnabled && !central.length) {
        clearVideoPending(id);
        vstat("videos OFF — no central videos in dashboard and per-machine toggle unchecked");
        return;
      }
      if (!local.length && !central.length) {
        clearVideoPending(id);
        vstat("no videos configured");
        return;
      }

      const now = Date.now();
      const done = cfg.videoSentThreads || {};

      // RESUME-TAIL: a set interrupted by operator navigation records resumeFrom = the
      // first clip index NEVER ATTEMPTED (we break BEFORE attempting). Only that
      // strictly-untouched tail may be sent later — zero duplicate risk, and the chat
      // finally gets all 3 configured clips instead of 2.
      const resumeFrom = done[id] && done[id].done && typeof done[id].resumeFrom === "number" ? done[id].resumeFrom : null;

      // (1) CONFIRMED sent → never resend. Only the NEW {done:true} is authoritative.
      if (done[id] && done[id].done && resumeFrom == null) {
        videoLocked.add(id);
        clearVideoPending(id);
        vstat("skip — chat already marked sent (" + (name || id) + ")");
        return;
      }
      // A video is visibly in the chat (real message row) → it's sent; mark + stop.
      // (Skipped in resume mode — of course there are already videos there.)
      if (resumeFrom == null && chatAlreadyHasOurVideo()) {
        videoLocked.add(id);
        clearVideoPending(id);
        done[id] = { done: true, at: now };
        await setLocal({ videoSentThreads: done });
        vstat("skip — detected an existing video in chat (" + (name || id) + ")");
        return;
      }
      // A leftover OLD boolean `true` mark with NO actual video in the chat was a
      // premature "marked up-front" mark from the old bug — clear it so this chat
      // (the backlog that never got its video) gets it now.
      if (done[id] === true) {
        delete done[id];
        await setLocal({ videoSentThreads: done });
      }
      // (2) Backoff so a chat whose clip keeps failing to LOAD isn't retried every
      // scan. NOT permanent anymore: after 24h the fail count resets — a transient
      // download problem used to ban a chat from ever getting its video.
      const att0 = (cfg.videoAttempts || {})[id] || null;
      if (att0) {
        if ((att0.fails || 0) >= VIDEO_MAX_TRIES) {
          if (now - (att0.failAt || 0) < 24 * 3600 * 1000) {
            vstat("paused 24h — clips failed to load 3× for " + (name || id));
            return;
          }
          const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
          delete am[id];
          await setLocal({ videoAttempts: am }); // expired → give the chat a fresh chance
        }
        if (att0.claimAt && now - att0.claimAt < VIDEO_CLAIM_TTL && att0.claimTab !== TAB_UID) {
          vstat("another tab is sending to " + (name || id));
          return;
        }
        if (att0.failAt && now - att0.failAt < VIDEO_RETRY_BACKOFF) {
          vstat("backing off after a failed load — retry soon (" + (name || id) + ")");
          return;
        }
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
      if (!immediate && resumeFrom == null) {
        setStatus({ lastAction: `video in ${Math.round(firstSec)}s…`, currentThread: name });
        await sleep(firstSec * 1000);
      }

      // ABORT if the operator opened a different chat during the pre-video wait —
      // uploading now would drop the clip into the WRONG conversation. Not locked
      // yet, so this chat still gets its video on a later visit.
      if (!stillOnThread(id)) {
        console.debug("[SubSell] video: aborted — user switched chats during the wait", id);
        setStatus({ lastAction: "video postponed — you switched chats (will retry)", currentThread: name });
        return;
      }
      // Re-check AFTER the delay: during the wait the chat may have received a video
      // (another pass finished, or one finally rendered). Re-read storage + the DOM so
      // we never pile a second clip onto a chat that already has one. (Not in resume
      // mode — there the done-flag and existing videos are expected.)
      if (resumeFrom == null) {
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

      // A clip that fails to LOAD 3 times GLOBALLY (any chat) is excluded from the
      // set instead of blocking it: one oversized/broken upload in the dashboard used
      // to fail the complete-set rule on EVERY chat = "no videos at all". The
      // remaining clips still ship, and the popup names the bad one.
      const urlFails = (await getLocal(["videoUrlFails"])).videoUrlFails || {};
      const activeCentral = central.filter((v) => (urlFails[v.url] || 0) < 3);
      const excluded = central.length - activeCentral.length;
      if (excluded > 0) vstat("⚠ " + excluded + " dashboard clip(s) can't load (too big/broken?) — sending the rest");

      // Build the ordered File list (local first, then central downloaded via background).
      const files = [];
      for (const v of local) {
        try {
          files.push(dataUrlToFile(v.dataUrl, v.name, v.type));
        } catch (e) {
          /* skip a bad local video */
        }
      }
      let urlFailsChanged = false;
      for (const v of activeCentral) {
        let ok = false;
        try {
          const r = await ask({ type: "FETCH_VIDEO", url: v.url });
          if (r && r.ok && r.base64) {
            const mime = r.mime || "video/mp4";
            files.push(dataUrlToFile(`data:${mime};base64,${r.base64}`, v.name || "video.mp4", mime));
            ok = true;
          }
        } catch (e) {
          /* fall through to failure accounting */
        }
        if (ok) {
          if (urlFails[v.url]) { delete urlFails[v.url]; urlFailsChanged = true; }
        } else {
          urlFails[v.url] = (urlFails[v.url] || 0) + 1;
          urlFailsChanged = true;
        }
      }
      if (urlFailsChanged) await setLocal({ videoUrlFails: urlFails });

      // The set must be COMPLETE before we send anything (a partial set + lock was
      // how "3 configured, buyer got 2" happened) — but "complete" now means the
      // clips that CAN load: globally-dead clips are excluded above, never blocking.
      const expected = activeCentral.length ? activeCentral.length : files.length;
      if (!files.length || files.length < expected) {
        await recordVideoFail(id);
        vstat("loaded " + files.length + "/" + expected + " clip(s) — will retry (" + (name || id) + ")");
        setStatus({ lastError: "video: loaded " + files.length + "/" + expected + " clip(s) — will retry later", currentThread: name });
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
      clearVideoPending(id); // committed to sending — off the pending queue
      {
        const dm = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        dm[id] = { done: true, at: Date.now() }; // resume marker (if any) cleared here, BEFORE sending
        const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
        delete am[id];
        await setLocal({ videoSentThreads: dm, videoAttempts: am });
      }
      const startAt = resumeFrom != null ? Math.min(resumeFrom, files.length) : 0;
      console.debug("[SubSell] video: LOCKED chat + sending clips " + (startAt + 1) + "–" + files.length + " to", id);

      // Best-effort send of the configured clip(s), in order. No retry, no fail record.
      let okCount = 0;
      for (let i = startAt; i < files.length; i++) {
        // The between-videos gap is another window for the operator to navigate away —
        // never drop a clip into whatever chat is now open. Record the first
        // UNATTEMPTED index so a later visit can deliver the missing tail (and only
        // the tail — clips before this point were attempted and must never repeat).
        if (!stillOnThread(id)) {
          console.debug("[SubSell] video: stopped mid-set at clip", i + 1, "— will finish on a later visit", id);
          const dm2 = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          dm2[id] = { done: true, at: Date.now(), resumeFrom: i };
          await setLocal({ videoSentThreads: dm2 });
          videoLocked.delete(id); // allow the resume visit through the in-memory guard
          setStatus({ lastAction: `video set paused at ${i}/${files.length} — finishing later`, currentThread: name });
          return;
        }
        setStatus({ lastAction: `sending video ${i + 1}/${files.length}…`, currentThread: name });
        if (await injectVideo(files[i])) okCount++;
        if (i < files.length - 1) await sleep(gapSec * 1000 + rand(0, 1500)); // pause BETWEEN videos
      }
      if (okCount === 0 && startAt === 0) {
        // NOTHING attached in this whole run. Attach detection is preview-based —
        // no preview ever appeared, so nothing can possibly have been sent. It is
        // therefore SAFE to undo the lock and let the chat retry later (with the
        // normal 3-try/24h backoff) instead of burning it forever at 0 videos.
        videoLocked.delete(id);
        const undo = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (undo[id] && undo[id].done && !undo[id].resumeFrom) {
          delete undo[id];
          await setLocal({ videoSentThreads: undo });
        }
        await recordVideoFail(id);
        vstat("⚠ 0/" + files.length + " attached in " + (name || id) + " — unlocked for retry (FB upload UI may have changed)");
        setStatus({ lastError: "video: nothing attached — will retry later", currentThread: name });
        return;
      }
      vstat("sent ✓ " + (okCount + startAt) + "/" + files.length + " to " + (name || id));
      setStatus({ lastAction: `demo video(s) sent ✓ (${okCount + startAt}/${files.length})`, currentThread: name });
      // Mirror to the local + cloud activity log (fire-and-forget; no effect on sending).
      ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: okCount + " demo video(s) sent" } });
    } catch (e) {
      vstat("error: " + e.message);
      setStatus({ lastError: "video error: " + e.message });
    }
  }

  // Smart follow-up on a quiet chat (WE spoke last). Gated by configurable quiet
  // period + a per-chat count cap so it can never spam. Claude decides whether
  // there's room (or returns [SKIP]). State per thread: { lastAt, count }.
  // How long ago was this row's last activity, per the SIDEBAR time tag ("· 22m",
  // "· 2h", "· 3j")? Lets an already-long-quiet chat qualify for a follow-up on its
  // FIRST visit instead of restarting the whole quiet clock from zero.
  function sidebarQuietMs(anchor) {
    const t = safe(() => anchor.innerText || "", "");
    let last = null;
    const re = /(?:^|[\s·•])(\d{1,3})\s?(min|m|h|hr|j|d)\b/gi;
    let m;
    while ((m = re.exec(t)) !== null) last = m;
    if (!last) return null;
    const n = parseInt(last[1], 10);
    const u = last[2].toLowerCase();
    if (u === "m" || u === "min") return n * 60 * 1000;
    if (u === "h" || u === "hr") return n * 3600 * 1000;
    return n * 24 * 3600 * 1000; // j / d
  }
  async function maybeFollowUp(id, name, anchor) {
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

      // ---- COST GUARD: dead-lead cutoff ----
      // Every follow-up evaluation is a full-price API call even when the model
      // just answers [SKIP]. A chat quiet for over a week is not coming back —
      // don't pay to keep re-asking about it. Fresh leads are unaffected.
      const quietNow = anchor ? sidebarQuietMs(anchor) : null;
      if (quietNow != null && quietNow > 7 * 24 * 3600 * 1000) return;

      // ---- TIME GATE ----
      const store = (await getLocal(["followUpState"])).followUpState || {};
      const now = Date.now();
      const thresholdMs = (followupsDone === 0 ? quietH : gapH) * 3600 * 1000;
      let st = store[id];
      if (!st) {
        // First time we notice this quiet chat. If the SIDEBAR already shows it's
        // been quiet longer than the threshold, it qualifies NOW — restarting the
        // whole clock here was a big reason follow-ups "never happened".
        const quietMs = anchor ? sidebarQuietMs(anchor) : null;
        if (quietMs != null && quietMs >= thresholdMs) {
          st = { lastAt: now - thresholdMs - 60000 }; // eligible immediately
        } else {
          store[id] = { lastAt: now };
          await setLocal({ followUpState: store });
          return;
        }
      }
      if (now - (st.lastAt || 0) < thresholdMs) return; // not quiet long enough yet

      // ---- COST GUARD: skip cap ----
      // Three consecutive [SKIP] verdicts for the same chat won't turn into a
      // yes on the 10th try — stop billing evaluations for it. A follow-up that
      // actually SENDS resets the count (the chat proved alive again).
      if ((st.skips || 0) >= 3) return;

      const transcript = fullTranscript();
      if (!transcript) return;
      const r = await ask({ type: "GET_FOLLOWUP", context: transcript, threadName: name });
      if (!r || !r.ok) {
        setStatus({ lastError: "follow-up: " + (r && r.error), currentThread: name });
        return;
      }
      // Advance the clock: a SENT follow-up restarts it fully; a Claude [SKIP] only
      // pushes it HALF a period (a full reset meant a few skips = never following up).
      const skipped = r.skip || !r.text || !r.text.trim();
      st.lastAt = skipped ? now - Math.floor(thresholdMs / 2) : now;
      st.skips = skipped ? (st.skips || 0) + 1 : 0; // 3 in a row → skip-cap above stops the spend
      store[id] = st;
      await setLocal({ followUpState: store });
      if (skipped) {
        setStatus({ lastAction: "follow-up: no room (" + (r.reason || "skip") + ")", currentThread: name });
        return;
      }
      if (!stillOnThread(id)) {
        setStatus({ lastAction: "follow-up aborted — you switched chats", currentThread: name });
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
    let id = threadId(anchor); // may be ADOPTED below if FB redirects to a canonical id
    const sidebarId = id;
    const name = anchorName(anchor);
    // Snapshot the sidebar's opinion BEFORE opening: opening marks the chat READ on
    // Facebook (the blue dot dies), so if this visit fails to reply for any reason
    // we must not lose the fact that a buyer was probably waiting.
    const sidebarSaysBuyer = safe(() => isUnreadAnchor(anchor), false) || safe(() => snippetSuggestsBuyerLast(anchor), false);
    cooldowns[id] = Date.now() + COOLDOWN_MS;
    setStatus({ currentThread: name, lastAction: "opening", lastError: null });

    safe(() => anchor.click());
    await sleep(2000);
    if (id && !location.href.includes(id)) {
      // Facebook sometimes opens the chat under a DIFFERENT canonical /t/<id> than
      // the sidebar row's href (group-style threads etc.). The old code declared
      // "couldn't open thread" and abandoned — but the chat WAS open on screen, its
      // unread dot already killed → the "opened but never replied" middle convo.
      // ADOPT the redirected id when the open chat's header matches the row we
      // clicked; abandon only if it's genuinely a different/failed chat.
      const m = safe(() => location.href.match(/\/t\/([^/?#]+)/), null);
      const urlId = m ? m[1] : "";
      // Compare on the FIRST participant's name only. Sidebar rows like
      // "Skylie +1 other · Iphone 13 pro" never appear verbatim in the open chat's
      // header (it renders "Skylie and 1 other" or the member list), which made the
      // strict match fail forever on group threads.
      const label = ((name || "").split("·")[0] || "").split(/\s*(?:\+|&|,| et | and )\s*/i)[0].trim();
      const headerHasName =
        label.length >= 2 &&
        safe(() => (((getMain() && getMain().innerText) || "").toLowerCase().indexOf(label.toLowerCase()) !== -1), false);
      if (urlId && urlId !== id && headerHasName) {
        console.debug("[SubSell] thread id redirected", id, "->", urlId, "— adopting");
        delete openFails[sidebarId];
        id = urlId; // all state (dedup, caps, videos) now keys on the REAL id
        cooldowns[id] = Date.now() + COOLDOWN_MS; // mirror the entry cooldown
      } else {
        // QUARANTINE repeat offenders: a thread that keeps failing to open must not
        // eat scan cycles while real buyers (the next chats down) sit waiting.
        openFails[sidebarId] = (openFails[sidebarId] || 0) + 1;
        if (openFails[sidebarId] >= 3) {
          cooldowns[sidebarId] = Date.now() + 30 * 60 * 1000;
          setStatus({ lastError: "thread won't open (" + openFails[sidebarId] + "×) — parked for 30 min: " + sidebarId });
        } else {
          setStatus({ lastError: "couldn't open thread " + sidebarId });
        }
        return;
      }
    }
    delete openFails[sidebarId]; // opened fine (directly or adopted) — clear the strike count
    refreshThreadLock(sidebarId); // keep our lease alive through the long parts
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
      // SUSPICIOUS READ: the sidebar said a buyer message was waiting, but the open
      // chat reads as "you spoke last". On slow loads (Remote Desktop) the buyer's
      // last bubbles sometimes haven't rendered yet — and since opening already
      // KILLED the unread dot, shelving this chat for 10 minutes = the "opened,
      // then forgotten" bug. Re-check in 2 minutes instead; after 3 straight
      // suspicious reads accept the chat really is idle (stops a permanently
      // buyer-looking snippet — e.g. some group rows — from looping forever).
      if (sidebarSaysBuyer && (suspiciousReads[id] = (suspiciousReads[id] || 0) + 1) < 3) {
        cooldowns[id] = Date.now() + 2 * 60 * 1000;
        setStatus({ lastAction: "sidebar showed a buyer message but chat reads you-last — re-checking in 2 min", currentThread: name });
        return;
      }
      clearWaiting(id, sidebarId); // genuinely idle — resolved, off the never-miss ledger
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      // You spoke last — nothing to reply to. But still: (1) send the demo video if
      // this chat never got one, and (2) consider a smart, capped follow-up if the
      // chat has been quiet long enough. Both are once/limited per chat — no spam.
      await maybeSendVideo(id, name, true);
      await maybeFollowUp(id, name, anchor);
      setStatus({ lastAction: "skip — you spoke last (checked video + follow-up)", currentThread: name });
      return;
    }
    delete suspiciousReads[id]; // got a real buyer turn — reset the misread counter
    if (isOwnEcho(turn.buyerMessage)) {
      // The "last message" is actually OUR OWN (alignment mis-read) — never reply to
      // ourselves. Hard stop against self-reply spam.
      clearWaiting(id, sidebarId);
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      setStatus({ lastAction: "skip — that last message was ours, not the buyer", currentThread: name });
      return;
    }
    if (lastHandled[id] === turn.buyerMessage) {
      clearWaiting(id, sidebarId); // already answered this exact message
      // Audit fix: chats that keep landing here (our reply mis-read as not-last)
      // previously NEVER reached a video pass — give them one (idempotent).
      await maybeSendVideo(id, name, true);
      setStatus({ lastAction: "skip — already replied to this message (video checked)", currentThread: name });
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
      clearWaiting(id, sidebarId); // cap says stay silent — resolved by policy
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
      clearWaiting(id, sidebarId); // handed to the human — resolved for the bot
      await maybeSendVideo(id, name, true); // demo video still helps the human close
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
    refreshThreadLock(sidebarId); // the delay is the longest window — re-stamp the lease

    // ABORT if the operator navigated to a different chat during the wait — typing
    // now would post this reply into the WRONG conversation. The chat is not marked
    // handled, so it's retried cleanly on a later cycle.
    if (!stillOnThread(id)) {
      setStatus({ lastAction: "aborted — you switched chats during the wait (will retry)", currentThread: name });
      return;
    }
    // Also make sure the chat didn't move on while we waited (buyer sent more) —
    // better to re-read next cycle with full context than answer a stale message.
    const recheck = buyerSpokeLast();
    if (!recheck || recheck.buyerMessage !== turn.buyerMessage) {
      setStatus({ lastAction: "aborted — conversation changed during the wait (will retry)", currentThread: name });
      return;
    }

    const sent = await typeAndSend(composer, reply.text);
    if (!sent) {
      setStatus({ lastError: "typed the reply but couldn't send it" });
      return;
    }
    rememberSent(reply.text); // so we never mistake this for a buyer message later
    lastHandled[id] = turn.buyerMessage;
    replyCounts[id] = repliesSoFar + 1; // count this text reply toward the per-convo cap
    clearWaiting(id, sidebarId); // ANSWERED — off the never-miss ledger
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
    // BACKLOG-FIRST SCHEDULING: a 3-clip video set with pauses costs 1–2 minutes —
    // during a morning burst (business hours just opened, many unread) that turned a
    // 15-buyer queue into an hour of waiting. When other buyers are waiting, their
    // REPLIES outrank this chat's videos: defer the set — the existing quiet-chat
    // revisit path delivers it (guaranteed, once per chat) as soon as the queue is
    // clear. Nobody loses their video; everybody gets their answer fast.
    let waitingNow = 0;
    for (const a of conversationAnchors()) {
      if (safe(() => isUnreadAnchor(a), false) && safe(() => snippetSuggestsBuyerLast(a), false)) waitingNow++;
    }
    if (waitingNow >= 3) {
      // Postpone, never cancel: the pending queue has its own picker lane, so this
      // chat's video set is guaranteed to go out minutes later.
      videoPending[id] = Date.now();
      persistDedup();
      setStatus({ lastAction: "video queued — " + waitingNow + " buyers waiting; replying to everyone first", currentThread: name });
      return;
    }
    refreshThreadLock(sidebarId); // video delay + uploads can outlive the lease too
    await maybeSendVideo(id, name);
  }

  /* ---------------- main loop ---------------- */
  function onMarketplace() {
    return /messenger\.com/.test(location.host) || /facebook\.com\/(messages|marketplace)/.test(location.href);
  }
  // Facebook sometimes serves its OWN error page ("This page isn't available right
  // now" / "Reload Page") — the conversation list is gone, so the bot is stuck with
  // nothing to scan, and the operator finds that screen the next day. We detect ONLY
  // that explicit error page (this wording never appears on a working Messenger), so
  // self-healing can never fire on a page that's working fine.
  const MP_INBOX = "https://www.messenger.com/marketplace/";
  const RECOVER_COOLDOWN_MS = 4 * 60 * 1000; // never auto-reload more than this often
  let zeroAnchorStreak = 0;
  let lastRecoverAt = 0;
  function onFacebookErrorPage() {
    const t = safe(() => (document.body && document.body.innerText) || "", "");
    if (!t || t.length > 3000) return false; // a real Messenger is huge; the error page is tiny
    return /isn'?t available right now|this page isn'?t available|try reloading this page|reload page|n'?est pas disponible|recharger la page/i.test(t);
  }
  // Pick the next chat to handle, by priority, skipping any already handled this wake.
  // P1 unread (buyer waiting) overrides cooldowns; P2 the sidebar preview looks like
  // the buyer spoke last; P3 fair idle rotation (oldest-seen first).
  // The unread re-open floor is 4 MINUTES: Messenger sometimes leaves a chat's blue
  // dot lit even after we visited (reactions, glitches — see the operator's sidebar,
  // many dots that never clear). With a short floor the bot cycled those same
  // "sticky-dot" chats forever and STARVED everything below — the real "missing
  // conversations". A brand-new unread chat (never opened) still fires instantly;
  // floored dot-chats simply fall through to P2/P3 so rotation always progresses.
  const UNREAD_REOPEN_MS = 4 * 60 * 1000;
  // Anyone waiting longer than this jumps to the FRONT of the queue (oldest first).
  // Fresh buyers get instant service; this lane is the "nobody is ever missed" law.
  const OVERDUE_MS = 5 * 60 * 1000;
  function pickTarget(anchors, now, exclude) {
    // LANE 0 — OVERDUE (the never-miss guarantee): any chat on the waiting ledger
    // longer than OVERDUE_MS is served BEFORE everything else, oldest first. So the
    // newest buyer gets instant service (lane 1), but a busy stream can only delay
    // an older buyer by ~OVERDUE_MS — never bury them.
    let overdue = null, overdueT = Infinity;
    for (const a of anchors) {
      const id = threadId(a);
      if (exclude.has(id)) continue;
      const ws = waitingSince[id];
      if (!ws || now - ws < OVERDUE_MS) continue;
      if (!safe(() => snippetSuggestsBuyerLast(a), false)) continue; // resolved meanwhile
      if (now - (lastOpened[id] || 0) <= UNREAD_REOPEN_MS) continue;
      if (ws < overdueT) { overdueT = ws; overdue = a; }
    }
    if (overdue) return overdue;

    // LANE 1 — INSTANT: the NEWEST genuinely-waiting buyer (topmost matching row —
    // the sidebar is recency-sorted). Two conditions, not just the dot: unread AND
    // the preview reads like the BUYER's message. A dot with OUR preview ("You: …")
    // is a STALE dot — on minimized windows FB often never clears dots after we
    // reply, and those ghosts were re-opened forever, eating the queue.
    for (const a of anchors) {
      const id = threadId(a);
      if (exclude.has(id)) continue;
      if (!safe(() => isUnreadAnchor(a), false)) continue;
      if (!safe(() => snippetSuggestsBuyerLast(a), false)) continue; // stale dot → not lane 1
      if (now - (lastOpened[id] || 0) <= UNREAD_REOPEN_MS) continue;
      return a; // first match = newest buyer → instant reply
    }

    // LANE 1.5 — PENDING VIDEOS (guaranteed delivery): sets deferred during a busy
    // queue are serviced the moment no fresh buyer needs a reply — BEFORE idle
    // rotation, oldest first. This is what makes deferral a postponement, not a
    // cancellation ("latest version not sending videos at all" = this lane missing).
    {
      let pv = null, pvT = Infinity;
      for (const a of anchors) {
        const id = threadId(a);
        if (exclude.has(id)) continue;
        const t = videoPending[id];
        if (t == null) continue;
        if (now <= (cooldowns[id] || 0) && now - t < 15 * 60 * 1000) continue; // fresh cooldown; wait unless pending >15 min
        if (t < pvT) { pvT = t; pv = a; }
      }
      if (pv) return pv;
    }
    let target = null, bestT = Infinity, bestIdleT = Infinity, idleTarget = null;
    for (const a of anchors) {
      const id = threadId(a);
      if (exclude.has(id)) continue;
      const cd = cooldowns[id] || 0;
      if (now <= cd) continue;
      if (safe(() => snippetSuggestsBuyerLast(a), false)) {
        if (cd < bestT) { bestT = cd; target = a; }
      } else if (cd < bestIdleT) { bestIdleT = cd; idleTarget = a; }
    }
    return target || idleTarget;
  }
  // DEEP-SCAN: Facebook's sidebar is virtualized — only ~20 conversation rows exist
  // in the DOM; anything below the scroll fold is INVISIBLE to the bot. When the tab
  // is minimized (nobody is watching, so moving the scrollbar disturbs no one) and a
  // scan found nothing to do, page the sidebar down one step so deeper conversations
  // get rendered (and picked up by the next scans), then wrap back to the top.
  function sidebarScroller() {
    const a = conversationAnchors()[0];
    if (!a) return null;
    let el = a.parentElement;
    for (let i = 0; i < 15 && el; i++) {
      if (el.scrollHeight > el.clientHeight + 50) return el;
      el = el.parentElement;
    }
    return null;
  }
  function deepScanStep() {
    const sc = sidebarScroller();
    if (!sc) return;
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 60) {
      sc.scrollTop = 0; // reached the bottom → wrap to top (newest chats stay covered)
      setStatus({ lastAction: "deep-scan: back to newest conversations" });
    } else {
      sc.scrollTop += Math.max(200, Math.floor(sc.clientHeight * 0.8));
      setStatus({ lastAction: "deep-scan: checking older conversations…" });
    }
  }

  async function scan() {
    // Stop instantly if (a) a newer injection took over this tab, or (b) the
    // extension was reloaded and this context is orphaned (chrome.* is dead). Either
    // way, terminate this stale loop so it can't double-scan or spam dead-context
    // errors — the fresh instance (re-injected by the background on update) runs on.
    if ((safe(() => window.__subsellGen, MY_GEN) !== MY_GEN) || !safe(() => chrome.runtime && chrome.runtime.id, null)) {
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      return;
    }
    // Claim the lock SYNCHRONOUSLY before any await, so two scans (interval +
    // heartbeat) can never both get past here (no check/set gap).
    if (busy) {
      // Watchdog: a hung cycle (stuck await) used to freeze the bot until the page
      // was reloaded. If busy for longer than any legit cycle, force-recover.
      if (busySince && Date.now() - busySince > BUSY_MAX_MS) {
        console.warn("[SubSell] watchdog: scan stuck for >6min — force-recovering");
        setStatus({ lastError: "watchdog: previous cycle hung — recovered automatically" });
        busy = false;
        busySince = 0;
      }
      return;
    }
    busy = true;
    busySince = Date.now();
    try {
      const anchors = conversationAnchors();
      const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};

      // CONSTANT VERIFICATION — every scan, every rendered row: any chat whose
      // preview reads like a waiting buyer goes on the never-miss ledger (first-seen
      // timestamp). Entries clear ONLY when the chat is actually resolved, so even a
      // reload, a failed open, or a flood of new buyers can't make one disappear.
      const nowT = Date.now();
      let unread = 0, waiting = 0;
      for (const a of anchors) {
        if (safe(() => isUnreadAnchor(a), false)) unread++;
        if (safe(() => snippetSuggestsBuyerLast(a), false)) {
          waiting++;
          const wid = threadId(a);
          if (wid && waitingSince[wid] == null) waitingSince[wid] = nowT;
        }
      }
      setStatus({ marketplaceAnchorCount: anchors.length, unreadCount: unread, waitingCount: waiting, videoQueueCount: Object.keys(videoPending).length, lastAction: settings.enabled ? "scanning" : "off" });
      if (!settings.enabled || !onMarketplace()) return;

      // AUTO-RECOVER from Facebook's error page ONLY. Guarded so it can never touch a
      // working page: requires 0 conversations AND Facebook's literal error wording AND
      // two scans in a row AND a 4-min cooldown. On that error screen the bot is already
      // stuck doing nothing, so navigating back to the Marketplace inbox is pure upside.
      if (anchors.length === 0) {
        if (onFacebookErrorPage()) {
          zeroAnchorStreak++;
          if (zeroAnchorStreak >= 2 && Date.now() - lastRecoverAt > RECOVER_COOLDOWN_MS) {
            lastRecoverAt = Date.now();
            zeroAnchorStreak = 0;
            setStatus({ lastAction: "Facebook error page — reloading Marketplace to recover", lastError: null });
            safe(() => { location.href = MP_INBOX; });
          }
        } else {
          zeroAnchorStreak = 0;
        }
        return;
      }
      zeroAnchorStreak = 0;

      // NEVER open a chat when a reply is impossible (outside business hours, hourly
      // or daily cap hit). Opening marks the chat READ on Facebook, so the old flow —
      // open → "skip: outside business hours" — silently destroyed every "buyer
      // waiting" signal overnight, and those chats were forgotten by morning. Now the
      // dots survive until the bot is actually allowed to answer.
      const st = await ask({ type: "GET_STATUS" });
      if (st && st.ok) {
        if (st.withinHours === false) {
          setStatus({ lastAction: "paused — outside business hours (chats stay unread until open)" });
          return;
        }
        if (st.hourlyCap && st.hourCount >= st.hourlyCap) {
          setStatus({ lastAction: "paused — hourly cap reached (chats stay unread)" });
          return;
        }
        const dCap = st.fullDailyCap != null ? st.fullDailyCap : st.dailyCap;
        if (dCap && st.dayCount >= dCap) {
          setStatus({ lastAction: "paused — daily cap reached (chats stay unread)" });
          return;
        }
      }

      // Handle ONE chat per scan (the proven, reliable model from v0.16.0). The v0.16.1
      // "burst" — handling several chats per wake when the tab was hidden — caused the
      // bot to go dead while the operator was away (long busy periods on a throttled,
      // minimized tab collided with the watchdog), so it was reverted. Throughput when
      // minimized is best solved by keeping a window un-minimized (scans every 8s).
      const target = pickTarget(anchors, Date.now(), new Set());
      if (!target) {
        // Nothing eligible among the RENDERED rows. If minimized, use the free cycle
        // to reveal deeper (virtualized) conversations so none stay invisible forever.
        if (safe(() => document.visibilityState === "hidden", false)) deepScanStep();
        return;
      }
      const tid = threadId(target);
      // Cross-tab lease so a second window in this profile can't process the same chat.
      // NOTE: lastOpened is stamped only AFTER winning the lease — stamping before it
      // meant a lock collision ALSO burned the 4-min unread floor, deferring a hot
      // buyer ~5 minutes. Now a blocked chat is simply retried on the next 8s scan
      // (the lease goes stale in ≤2 min if its holder died in a reload/update).
      if (!(await acquireThreadLock(tid))) {
        setStatus({ lastAction: "waiting — another tab/window holds this chat (auto-retries)", currentThread: anchorName(target) });
        return;
      }
      lastOpened[tid] = Date.now(); // lease won — NOW it counts as an open
      try {
        await handleThread(target);
      } finally {
        await releaseThreadLock(tid);
      }
    } catch (e) {
      setStatus({ lastError: "error: " + e.message });
    } finally {
      busy = false;
      busySince = 0;
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
      // Health-check from the background. `busy` lets it avoid reloading this tab
      // mid-send; a missing response at all means the script is dead → auto-reload.
      send({ ok: true, url: location.href, anchorCount: conversationAnchors().length, busy });
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
        busySince = Date.now();
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
          if (!stillOnThread(msg.threadId)) {
            setStatus({ lastAction: "follow-up aborted — you switched chats", currentThread: anchorName(anchor) });
            return send({ ok: false, error: "user navigated away" });
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
          busySince = 0;
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
  scanTimer = setInterval(scan, SCAN_MS);
})();
