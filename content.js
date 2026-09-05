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
  const BUSY_MAX_MS = 9 * 60 * 1000; // > max legit cycle (delay+jitter+typing+a fully streamed 3-clip set)
  let pausedForUpdate = 0; // set by PAUSE_SCANS: an update is on disk, stop starting new chats
  let pendingReply = {}; // threadId -> {buyerMessage, transcript, text, at} — billed but undelivered replies (abort recovery). In-memory only: a lost memo just falls back to a normal call.
  let cooldowns = {}; // threadId -> timestamp we may re-check it (persisted, shared across tabs)
  let lastOpened = {}; // threadId -> when THIS instance last opened it (unread re-open floor)
  let openFails = {}; // sidebar threadId -> {n, at}: consecutive failed opens (quarantine at 3; strikes decay after 2h)
  // Strikes older than 2h are stale (a bad-lag morning must not combine with one
  // later hiccup into a 6h park on a real buyer). In-memory by design.
  const openFailCount = (tid) => {
    const e = openFails[tid];
    if (!e) return 0;
    if (Date.now() - (e.at || 0) > 2 * 3600 * 1000) { delete openFails[tid]; return 0; }
    return e.n || 0;
  };
  // sidebar threadId -> the ADOPTED canonical id FB redirected it to. Group-style
  // threads open under a different /t/ id than their sidebar row; per-chat state
  // written under the adopted id (replyCounts, videoAttempts) is invisible to
  // sidebar-keyed lookups without this bridge. In-memory: repopulated on the
  // first visit after a reload, which is soon enough for the gates that use it.
  const adoptedAlias = {};
  // threadId -> suppress-until timestamp: chats whose OPEN CHAT read idle three
  // times in a row while the sidebar nudge kept claiming "waiting" (FB's
  // "X is waiting for your response" row can stay lit for hours after the chat
  // is actually resolved). Without this, such a chat re-entered the never-miss
  // ledger every scan and burned a lane-0 visit every few minutes all day
  // (a diagnostic showed one chat churning like that for 9.5 hours).
  const waitSuppress = {};
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
  // One-click backlog catch-up (per machine): when armed, replied-to chats that
  // have NO confirmed video are re-queued for a video visit, delivered through the
  // existing aged-video lane and gated by the same chatAlreadyHasOurVideo() guard
  // that prevents duplicates. Persisted so it survives reloads; self-disarms.
  let videoCatchUp = { armed: false, at: 0 };
  let catchUpDry = 0;
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
    chrome.storage.local.get(["recentSent", "cooldowns", "lastHandled", "replyCounts", "waitingSince", "videoPending", "videoCatchUp"], (r) => {
      if (r && Array.isArray(r.recentSent)) recentSent = r.recentSent;
      if (r && r.cooldowns && typeof r.cooldowns === "object") cooldowns = r.cooldowns;
      if (r && r.lastHandled && typeof r.lastHandled === "object") lastHandled = r.lastHandled;
      if (r && r.replyCounts && typeof r.replyCounts === "object") replyCounts = r.replyCounts;
      if (r && r.waitingSince && typeof r.waitingSince === "object") waitingSince = r.waitingSince;
      // TTL sweep (boot): ledger entries older than 24h are unservable ghosts —
      // buried, deleted, or pre-0.21.14 phantom system rows — that no visit can
      // clear and that silently forced the overdue-buyer video deferral forever.
      // A rendered, genuinely waiting buyer is re-stamped by the next scan.
      {
        const nowB = Date.now();
        for (const k of Object.keys(waitingSince)) {
          if (typeof waitingSince[k] !== "number" || nowB - waitingSince[k] > 24 * 3600 * 1000) delete waitingSince[k];
        }
      }
      if (r && r.videoPending && typeof r.videoPending === "object") videoPending = r.videoPending;
      if (r && r.videoCatchUp && typeof r.videoCatchUp === "object") videoCatchUp = r.videoCatchUp;
      // AUTOMATIC one-time backlog catch-up (v0.21.13): the operator wants ZERO
      // manual work — every machine arms the video catch-up by itself on its first
      // boot after this update. Same engine as the popup button: only ambiguous
      // old-era marks are cleared, delivery is paced through the aged-video lane,
      // every send passes the duplicate guards, and it self-disarms when drained.
      // v0.21.17 re-arm: the 0.21.13 catch-up self-disarmed within ~48s on
      // all-dotted machines (the old enqueuer skipped every dotted row, queued 0,
      // and hit the 6-dry-scan disarm) — its one-shot flag was consumed having
      // done nothing. Fresh flag = exactly one effective run under the fixed
      // enqueuer; transactional-write semantics unchanged.
      chrome.storage.local.get(["autoCatchUp01217"], (ac) => {
        if (chrome.runtime.lastError || (ac && ac.autoCatchUp01217)) return;
        armVideoCatchUp({ autoCatchUp01217: true }).catch(() => { /* retried next boot */ });
      });
      // v0.21.26 re-arm: the operator reports "most convos without videos" — the
      // backlog accumulated under the old fragile per-clip pipeline. One fresh
      // sweep through the NEW one-message engine (a set now takes ~30s, and idle
      // machines drain lane 1.5 continuously) — same guards, zero manual work.
      chrome.storage.local.get(["autoCatchUp01226"], (ac) => {
        if (chrome.runtime.lastError || (ac && ac.autoCatchUp01226)) return;
        armVideoCatchUp({ autoCatchUp01226: true }).catch(() => { /* retried next boot */ });
      });
      // v0.21.29 ONE-SHOT UNPAUSE: the 15s attach-detection window judged good
      // pastes "failed" on slow machines — chats collected 3 strikes and sat in
      // 24h attach-pauses (a diagnostic showed 20 on one machine). The window is
      // fixed now; clear the attach-pauses once so those chats retry under the
      // fixed engine immediately instead of waiting out the day.
      chrome.storage.local.get(["autoUnpause0129", "videoAttempts"], (r) => {
        if (chrome.runtime.lastError || (r && r.autoUnpause0129)) return;
        const am = (r && r.videoAttempts) || {};
        let n = 0;
        for (const k of Object.keys(am)) {
          const e = am[k];
          if (e && e.why === "attach" && (e.fails || 0) >= 1) { delete am[k]; n++; }
        }
        chrome.storage.local.set({ videoAttempts: am, autoUnpause0129: true }, () => void chrome.runtime.lastError);
        if (n) console.debug("[SubSell] cleared", n, "attach strikes/pauses for the fixed engine");
      });
      // v0.21.34 ONE-SHOT UNPAUSE: the old hold-then-send path struck chats whose
      // 2nd/3rd clip was rejected mid-upload; under streaming delivery each clip
      // attaches on an empty, settled tray. Clear the attach-pauses once so those
      // chats retry now instead of waiting out the day (same pattern as 0.21.29).
      chrome.storage.local.get(["autoUnpause0134", "videoAttempts"], (r) => {
        if (chrome.runtime.lastError || (r && r.autoUnpause0134)) return;
        const am = (r && r.videoAttempts) || {};
        let n = 0;
        for (const k of Object.keys(am)) {
          const e = am[k];
          if (e && e.why === "attach" && (e.fails || 0) >= 1) { delete am[k]; n++; }
        }
        chrome.storage.local.set({ videoAttempts: am, autoUnpause0134: true }, () => void chrome.runtime.lastError);
        if (n) console.debug("[SubSell] cleared", n, "attach strikes/pauses for the streaming engine");
      });
      // v0.21.38 ONE-SHOT UNPAUSE: file-API sets whose tiles rendered late were
      // judged "nothing attached" (12-30 s windows), swept, re-pasted and struck —
      // a diagnostic showed 21 chats in 24h attach-pauses on one machine. The
      // engine now streams one clip at a time, reads the composer's own staged
      // signal and adopts late tiles; clear the pauses once so those chats retry
      // under it now (same pattern as 0.21.29 / 0.21.34).
      chrome.storage.local.get(["autoUnpause0138", "videoAttempts"], (r) => {
        if (chrome.runtime.lastError || (r && r.autoUnpause0138)) return;
        const am = (r && r.videoAttempts) || {};
        let n = 0;
        for (const k of Object.keys(am)) {
          const e = am[k];
          if (e && e.why === "attach" && (e.fails || 0) >= 1) { delete am[k]; n++; }
        }
        chrome.storage.local.set({ videoAttempts: am, autoUnpause0138: true }, () => void chrome.runtime.lastError);
        if (n) console.debug("[SubSell] cleared", n, "attach strikes/pauses for the one-clip-in-flight engine");
      });
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
    safe(() => chrome.storage.local.set({ cooldowns, lastHandled, replyCounts, waitingSince, videoPending, videoCatchUp }));
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
    let prev = lines.slice(1).join(" ").toLowerCase();
    // Messenger now prefixes unread rows' snippet with "Unread message:" (FR:
    // "Message non lu"). That prefix defeated the ^you:/^vous: anchors below, so
    // rows where WE spoke last ("Unread message: You: …") counted as waiting
    // buyers — immortal ghost ledger entries that monopolized lane 0 (real new
    // buyers never reached, "not replying at all") and kept overdueNow true
    // (every video force-queued). Diagnosed live from two machine reports
    // 2026-08-17. Strip the UI prefix before judging; a genuine buyer message
    // is judged identically with or without it.
    prev = prev.replace(/^(?:unread messages?|messages? non lus?)\s*[:.,]?\s*/i, "");
    // OUR last message / system & UI lines → not a waiting buyer.
    // NOTE (audit 2026-08-09): terms must survive SIDEBAR TRUNCATION — "This is an
    // automated su…" evaded the full-phrase `automated suggestion` term and made 4
    // system rows count as waiting buyers (⇒ every video deferred, phantom lane-0
    // churn). Do NOT add "waiting for your response" here — that nudge is a GENUINE
    // buyer-waiting signal; rejecting it would starve real buyers off the ledger.
    // NOTE: terms must survive SIDEBAR TRUNCATION, and the "Unread message: "
    // prefix (stripped above) eats ~16 chars of the visible width — so the reject
    // terms are shortened again ("this is an autom…" is how the row actually
    // renders on the operator's machines).
    if (/^you[:\s]|^vous\s?:|you sent|vous avez envoyé|automated suggestion|this is an autom|ceci est une sugg|suggestion automati|to help identi|pour (mieux )?identifier|you can now ra|rate each other|vous pouvez (désormais|maintenant) (vous )?évaluer|started this chat|a démarré|marketplace ·|reacted .{0,4}to your|a réagi|liked your|a aimé|left the group|a quitté le groupe|joined the group|a rejoint le groupe/i.test(prev)) return false;
    return true;
  }

  // The sidebar row's OWN attribution of the last message: "Charles: How much? · 2h"
  // → { body: "How much?", media: false }. Messenger writes the sender's name
  // itself, so this is positive "the BUYER spoke last" evidence — used to rescue
  // chats where the open-chat paint/geometry read is inconclusive (defaults to
  // "me") and a real buyer was being suppressed for hours. Returns null for our
  // own rows ("You: …"), system rows, or rows without a "Name: body" shape.
  function sidebarSnippetBody(a) {
    const t = safe(() => a.innerText || "", "");
    if (!t) return null;
    const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
    if (lines.length < 2) return null;
    let s = lines.slice(1).join(" ").replace(/^(?:unread messages?|messages? non lus?)\s*[:.,]?\s*/i, "");
    const m = s.match(/^([^:]{1,60}?):\s*(.+)$/);
    if (!m) {
      // Colon-less MEDIA rows: "Mohand sent a photo." / "Mohand a envoyé une vidéo."
      // (our own "You sent…"/"Vous avez envoyé…" rows are excluded up front).
      const mm = s.match(/^(?!you\b|vous\b|toi\b|moi\b)([^:]{1,60}?)\s+(sent|a envoyé|vous a envoyé|t'a envoyé)\b.*\b(photo|video|vidéo|attachment|pièce jointe|voice|vocal|audio|gif|sticker|autocollant)/i);
      return mm ? { body: "", media: true } : null;
    }
    if (/^(you|vous|toi|moi)$/i.test(m[1].trim())) return null;
    let body = m[2].replace(/\s*[·•]\s*\d{1,3}\s?(min|m|h|hr|j|d|sem|w)\b.*$/i, "").replace(/(\.\.\.|…)\s*$/, "").trim();
    if (!body) return null;
    const media = /\b(sent|a envoyé|vous a envoyé|t'a envoyé)\b.*\b(photo|video|vidéo|attachment|pièce jointe|voice|vocal|audio|gif|sticker|autocollant)/i.test(body);
    return { body, media };
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
    // Price / spec CARD text only — the old prefix forms ("^\$\d", "^\d+gb")
    // ate real buyer messages ("$300 possible?", "128gb still available?") and
    // those chats never got a reply.
    if (/^ca\$/.test(t)) return true; // "CA$420 · …" listing card
    if (/^\$\s?\d[\d.,\s]*$/.test(t)) return true; // bare amount ONLY — "$300 cash?" survives
    if (/^\d+\s*(go|gb|tb)\b[^a-z0-9]*$/.test(t)) return true; // "128 GB ·" card — "128gb still available?" survives
    // Time/date HEADERS only. Buyers type compact times ("18h30", "demain 14h30",
    // "dimanche 13h00") when scheduling a visit — those must NOT be noise, and
    // the old "^(mon|…)" / "^(…|hier|aujourd)" prefixes ate real FR messages
    // ("mon budget c'est 300", "hier j'ai vu l'annonce").
    if (/^\d{1,2}\s*:\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?$/.test(t)) return true; // bare "7:11 pm"
    if (/^\d{1,2}\s+h\s+\d{2}$/.test(t)) return true; // FR header "19 h 11" (buyers type "19h11")
    if (/^(mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|sat(urday)?|sun(day)?)\s*,?\s+(at\s+)?\d{1,2}\s*(:\s*\d{2}\s*(a\.?m\.?|p\.?m\.?)?|h\s+\d{2})$/.test(t)) return true; // "Sat 7:11 PM" headers — "saturday works for me" survives
    if (/^(yesterday|today|hier|aujourd['’]hui)\s*(at|à)?\s*\d{1,2}\s*[:h]\s*\d{2}/.test(t)) return true; // "Today at 7:11" / "aujourd’hui à 19 h 11"
    if (/^(yesterday|today|hier|aujourd['’]hui)$/.test(t)) return true; // bare relative-date header
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
    // Group-membership system rows (this fleet's chats are "Group chat: …"):
    // "A contact left the group.", joins, renames, FR equivalents. NOT buyer
    // messages — replying to one sent Claude's meta-commentary to a buyer.
    if (/left the group|a quitté le groupe|joined the group|a rejoint le groupe|added .{1,60} to the group|removed .{1,60} from the group|named the group|nommé le groupe|created the group|a créé le groupe/.test(t)) return true;
    if (/^more options$|^view listing$|^see listing$/.test(t)) return true;
    // Facebook "Send a quick response" card + its preset reply buttons (seller options,
    // NOT buyer messages).
    if (/send a quick response|tap a response|réponse rapide|envoyer une réponse/.test(t)) return true;
    // NOTE: "is this (still) available" is deliberately NOT in this list — that
    // exact text is also the buyer's REAL standard opener (Facebook sends it as
    // their first message); filtering it meant those chats never got a reply.
    // The preset CHIPS with that text are excluded structurally instead (the
    // closest('[role="button"]…') check in readConversation).
    if (/^(yes, are you interested|in talks|sorry,? it'?s not available|yes,? it'?s available|when can you)/.test(t)) return true;
    // FRENCH equivalents of the system/UI lines above (operator runs FR accounts too).
    if (/suggestion automatis/.test(t)) return true; // "Ceci est une suggestion automatisée"
    if (/attend (ta|votre) réponse/.test(t)) return true; // "X attend ta/votre réponse"
    if (/vous a envoyé un|t'a envoyé un/.test(t)) return true; // "X vous a envoyé un message"
    if (/a démarré (cette|la) discussion|a lancé cette conversation/.test(t)) return true;
    if (/ajouter (une |la )?vidéo|mettre à jour l'annonce|voir l'acheteur|marquer comme vendu/.test(t)) return true;
    if (/^(lun|mar|mer|jeu|ven|sam|dim)\.?,?\s+(à\s+)?\d{1,2}\s*[:h]\s*\d{2}/.test(t)) return true; // FR day headers ("sam. 19:11") — day word + TIME required, so "mardi je peux passer" survives
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
  function readConversation(hint) {
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

    // Pass 1.5 — MEDIA bubbles (photos/videos/stickers have no text node). A buyer
    // whose LAST message is just a picture used to be invisible: the chat read as
    // "we spoke last" and was parked forever — one of the "never replied" causes.
    // Avatars and inline emoji are tiny (<48px); composer upload previews use
    // blob: URLs; the listing card sits inside a link — all skipped.
    const mediaCands = [];
    const mediaEls = safe(() => Array.from(main.querySelectorAll('[role="row"] img, [role="row"] video')), []);
    for (const el of mediaEls) {
      const src = safe(() => el.getAttribute("src") || "", "");
      if (src.startsWith("blob:")) continue; // upload preview in the tray, not a message
      if (safe(() => el.closest("a[href]"), null)) continue; // listing card / profile links
      if (safe(() => el.closest('[role="button"],[role="menuitem"],button'), null)) continue;
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width < 48 || r.height < 48) continue;
      const cx = r.left + r.width / 2;
      if (cx < cLeft - 60 || cx > cRight + 60) continue;
      if (r.top >= top) continue;
      const key = "[attachment]@" + Math.round(r.top / 40); // merge poster+player of one bubble
      if (seen.has(key)) continue;
      seen.add(key);
      mediaCands.push({ el, r });
    }
    if (!cands.length && !mediaCands.length) return [];

    // The real message column = the span of the bubbles themselves. Self-calibrating,
    // so role detection no longer depends on the composer's exact width/position.
    let colLeft = Infinity, colRight = -Infinity;
    for (const k of cands) {
      if (k.r.left < colLeft) colLeft = k.r.left;
      if (k.r.right > colRight) colRight = k.r.right;
    }
    for (const k of mediaCands) {
      if (k.r.left < colLeft) colLeft = k.r.left;
      if (k.r.right > colRight) colRight = k.r.right;
    }

    // Pass 2 — classify each bubble. A message is the BUYER's ONLY with positive
    // evidence (neutral-gray bubble, or — if color is unknown — clearly hugging the
    // left). Everything ambiguous is treated as "me" so the bot can never reply to
    // its own message. This is the core anti-self-reply rule.
    // SYSTEM rows (v0.21.37): Facebook injects unpainted, CENTERED blocks into
    // the thread — "X started this chat", "X is waiting for your response", the
    // Marketplace "automated suggestion" cards, date dividers. The known ones
    // are filtered by text; the unknown ones used to fall through the
    // ambiguous⇒"me" rule and made a chat read "you spoke last" right after a
    // real buyer message ("Mohand: Bonjour · 1h" sat unanswered + suppressed).
    // A block that is unpainted AND centered AND narrower than the column is
    // never one of OUR bubbles (ours hug the right edge, and are painted) nor
    // the buyer's (they hug the left) — drop it. Every entry also records its
    // `paint` so the sidebar rescue below can tell a CONFIRMED own bubble from
    // an ambiguous one.
    const colW = Math.max(1, colRight - colLeft);
    // Centering is judged against the block's OWN [role="row"] box — Facebook's
    // rows span the whole column for every author. The candidate span above
    // collapses onto the system block itself in a first-contact chat (no own
    // bubble rendered yet), where the rightmost block could never read as
    // centered; the row box has no such blind spot. No trustworthy row box →
    // hug = null → the old rules apply unchanged.
    const rowBox = (el) => {
      const row = safe(() => el.closest('[role="row"]'), null);
      const b = row && safe(() => row.getBoundingClientRect(), null);
      return b && b.width > 100 && b.width >= colW ? b : null;
    };
    const hugOf = (r, el) => {
      const b = rowBox(el);
      if (!b) return null;
      const L = b.left, R = b.right, W = Math.max(1, R - L);
      const gap = (R - r.right) - (r.left - L); // > 0 hugs left (buyer), < 0 hugs right (ours)
      if (Math.abs(gap) <= 30 && r.width < W * 0.6) return "center";
      return gap > 30 ? "left" : gap < -30 ? "right" : null;
    };
    // Never drop the very text the sidebar attributes to the buyer (confirmed path).
    const hb = hint && !hint.media ? normMsg(hint.body || "") : "";
    const namedBySidebar = (t) => hb.length >= 2 && (normMsg(t) === hb || normMsg(t).startsWith(hb));
    const out = [];
    for (const { el, text, r } of cands) {
      const ours = looksLikeOurBubble(el); // true | false | null
      const hug = hugOf(r, el);
      let role;
      if (isOwnEcho(text) || ours === true) {
        role = "me"; // our own message
      } else if (ours === false) {
        role = "buyer"; // neutral-gray bubble = the buyer's (ours are blue/gradient)
      } else if (hug === "center" && !namedBySidebar(text)) {
        continue; // unpainted centered block = Facebook system row / card, not a message
      } else {
        // color inconclusive → only call it the buyer when it CLEARLY hugs the left
        role = (colRight - r.right) - (r.left - colLeft) > 30 ? "buyer" : "me";
      }
      out.push({ role, text, top: r.top, paint: ours === true || isOwnEcho(text) ? true : ours, hug });
    }
    // Media bubbles carry no paint to read, so the SAME rule applies: buyer only
    // with positive evidence (clearly hugging the left); centered = system card
    // (listing thumbnails in suggestion cards); ambiguous = "me".
    for (const { el, r } of mediaCands) {
      const ours = looksLikeOurBubble(el); // usually null for media
      const hug = hugOf(r, el);
      let role;
      if (ours === true) role = "me";
      else if (ours === false) role = "buyer";
      else if (hug === "center") continue;
      else role = (colRight - r.right) - (r.left - colLeft) > 30 ? "buyer" : "me";
      out.push({ role, text: "[attachment]", top: r.top, paint: ours, hug });
    }
    out.sort((a, b) => a.top - b.top);
    return out;
  }
  // The buyer message to answer: the last bubble, and only if it's the buyer's.
  // `hint` (optional) = the sidebar's own attribution of the last message (see
  // sidebarSnippetBody): when the open-chat read is inconclusive and defaulted
  // the last bubble to "me", but its text is exactly what the sidebar attributes
  // to the BUYER by name, that bubble IS the buyer's — Messenger says so.
  function turnFromConvo(convo, hint) {
    // Our own demo clips render as trailing "me [attachment]" bubbles — never
    // let them hide a buyer message whose TEXT reply still needs to go out.
    // (Kept when the sidebar says the buyer's LATEST message is media: then the
    // last attachment is theirs and the rescue below adopts it.)
    if (!(hint && hint.media)) {
      while (
        convo.length &&
        convo[convo.length - 1].role === "me" &&
        convo[convo.length - 1].text === "[attachment]"
      )
        convo.pop();
    }
    if (!convo.length) return null;
    let last = convo[convo.length - 1];
    if (last.role !== "buyer") {
      if (!hint) return null;
      // SIDEBAR-CONFIRMED rescue (v0.21.37, generalized): Messenger's own row says
      // the buyer wrote `hint.body` last. Walk back over the trailing entries that
      // are NOT a confirmed own bubble (paint !== true — i.e. ambiguous/system-ish
      // blocks Facebook rendered after the buyer's message) looking for that
      // text; stop the moment a PAINTED own bubble is met (then we truly spoke
      // last). A match is the buyer's latest message: adopt it and drop what
      // follows it, so the transcript/dedupe key see the real conversation.
      const hb = normMsg(hint.body || "");
      const matches = (e) =>
        (e.text !== "[attachment]" && hb.length >= 2 && (normMsg(e.text) === hb || normMsg(e.text).startsWith(hb))) ||
        (!!hint.media && e.text === "[attachment]");
      let found = -1;
      for (let i = convo.length - 1, steps = 0; i >= 0 && steps < 6; i--, steps++) {
        const e = convo[i];
        // A real buyer bubble: adopt it ONLY if it is the message the sidebar names.
        // A different one means the named (newer) message isn't rendered/readable
        // yet → null, and the 2-min suspicious re-check handles the slow load.
        if (e.role === "buyer") { if (matches(e)) found = i; break; }
        if (e.paint === true) break; // confirmed OUR bubble → we spoke last, no rescue
        // A right-hugging TEXT bubble measured against its own row is ours by
        // construction (buyers hug left) even when unpainted — never step over
        // it, or our own "ok" could be adopted as the buyer's "ok".
        if (e.text !== "[attachment]" && e.hug === "right") break;
        if (matches(e)) { found = i; break; }
      }
      if (found < 0) return null;
      convo.length = found + 1; // drop the unconfirmed blocks after the buyer's message
      last = convo[found];
      last.role = "buyer"; // sidebar-confirmed: Messenger attributes this message to the buyer
    }
    // Dedupe key = what WE last said + how many buyer TEXT bubbles followed + the
    // buyer's text. lastHandled keyed on the text alone meant a buyer who repeated
    // the same words later ("ok", "?") was skipped forever. TEXT bubbles only —
    // media rendering varies between opens and must not re-fire handled messages.
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
  function buyerSpokeLast() {
    return turnFromConvo(readConversation(), null);
  }
  function buyerSpokeLastConfirmed(hint) {
    return turnFromConvo(readConversation(hint), hint);
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
      // Media bubbles don't count: our demo clips must not eat the follow-up
      // budget (pre-media-detection behavior counted text messages only), and a
      // buyer photo (rare "buyer" media) still ends our tail.
      if (convo[i].text === "[attachment]") {
        if (convo[i].role === "me") continue;
        break;
      }
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
      if (!(/\bsend\b/.test(al) || /press enter to send/.test(al) || /entr[eé]e pour envoyer/.test(al) || /envoyer un message/.test(al) || /^envoyer\b/.test(al))) continue;
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
  /* ---- ONE-MESSAGE VIDEO SETS (v0.21.26) ----------------------------------
   * Clips are ATTACHED to the composer one after another (each verified by
   * new-element identity), then the WHOLE SET is sent with a single Enter as
   * one message. No per-clip sends, no between-clip waits, no partial-set
   * windows — the set either rides one message or records exactly which tail
   * is missing. AUDIT FIX (2026-07-29) preserved: paste into the focused
   * composer first → drag-drop → file input last, never the listing card's
   * own "Add video to listing" uploader. */
  const VIDEO_PREVIEW_SEL = 'img[src^="blob:"], [role="progressbar"], video, [aria-label*="remove" i][aria-label*="attach" i], [aria-label*="supprimer" i][aria-label*="jointe" i]';
  const VIDEO_REMOVE_SEL = '[aria-label*="remove" i][aria-label*="attach" i], [aria-label*="supprimer" i][aria-label*="jointe" i]';
  // TRAY elements = preview-ish elements NOT inside a MESSAGE row ([role="row"]
  // holds a just-sent clip's media, which must never count in attach math). A
  // row that CONTAINS the composer is the composer's own wrapper, not a message
  // row — previews inside it still count.
  function trayQuery(sel) {
    const main = getMain() || document;
    const composer = findComposer();
    const notInRow = (el) => {
      const r = safe(() => el.closest('[role="row"]'), null);
      return !r || safe(() => !!composer && r.contains(composer), false);
    };
    return safe(() => Array.from(main.querySelectorAll(sel)).filter(notInRow), []);
  }
  const trayEls = () => trayQuery(VIDEO_PREVIEW_SEL);
  const trayRemoveBtns = () => trayQuery(VIDEO_REMOVE_SEL);
  // Remove ONLY attachments beyond the first `expectedGood` — POSITION-based,
  // not node-identity-based: React re-creates DOM nodes freely, so a Set of
  // "known" buttons could mistake a re-rendered GOOD clip for a stray and
  // remove it. Attachments append in order, so extras are always the TAIL.
  // THREE passes with settle gaps: a paste can render its preview (and even its
  // remove button) many seconds late on throttled tabs.
  async function sweepTrayExtras(expectedGood) {
    for (let pass = 0; pass < 3; pass++) {
      const btns = trayRemoveBtns();
      for (let k = btns.length - 1; k >= expectedGood; k--) safe(() => btns[k].click());
      await sleep(pass === 2 ? 1200 : 2500);
    }
  }
  // PRE-ENTER EXACTNESS (v0.21.38): the tray must hold exactly `expected` tiles
  // (the known head + the ONE clip just attached) before Enter. A surplus is a
  // late-rendered copy from an earlier attempt (PC-mnbbd: SEVEN tiles piled up,
  // one Enter would have sent them all). Attachments render in the order they
  // entered the composer's state, so an older stray sits BEFORE the clip we just
  // added: trim from the first non-known slot, keeping the newest (ours). Returns
  // true when the tray is exact, false when a surplus would not go away — the
  // caller must NOT send then.
  async function trimTraySurplus(expected) {
    for (let pass = 0; pass < 3; pass++) {
      const btns = trayRemoveBtns();
      if (btns.length <= expected) return true;
      safe(() => btns[Math.max(0, expected - 1)].click());
      await sleep(pass === 2 ? 1200 : 2000);
    }
    return trayRemoveBtns().length <= expected;
  }
  // RENDER-INDEPENDENT "something is staged" signal (v0.21.38). Messenger swaps
  // the composer bar's rightmost control the instant its state holds content:
  // empty → the like/thumb button, staged or typed → the Send button. That swap
  // is a plain React commit (no file decode, no thumbnail), so it lands even on
  // machines where the preview TILE renders 30-60 s late or not at all while the
  // window is occluded (PC-mnbbd: every strategy judged "nothing attached", then
  // all of them rendered at once). We compare the control's aria-label BEFORE
  // and AFTER a dispatch — a change means staged, in any language.
  function composerSendControl() {
    const composer = findComposer();
    if (!composer) return null;
    const cr = safe(() => composer.getBoundingClientRect(), null);
    if (!cr || !cr.height) return null;
    const main = getMain() || document;
    let best = null, bestLeft = -Infinity;
    for (const b of safe(() => Array.from(main.querySelectorAll('[role="button"][aria-label], button[aria-label]')), [])) {
      const r = safe(() => b.getBoundingClientRect(), null);
      if (!r || !r.width || !r.height) continue;
      if (r.bottom < cr.top - 8 || r.top > cr.bottom + 8) continue; // same band as the textbox
      if (r.left < cr.right - 4) continue; // to its RIGHT (never the tray's remove buttons above)
      if (r.left > bestLeft) { bestLeft = r.left; best = b; }
    }
    return best;
  }
  const sendControlLabel = () => {
    const b = composerSendControl();
    return b ? (safe(() => b.getAttribute("aria-label"), "") || "").trim().toLowerCase() : "";
  };
  // The empty-composer control is the LIKE/thumb button ("Send a like",
  // "Envoyer un j'aime", "Send a 👍"…); the staged one is Send ("Press Enter to
  // send", "Envoyer"). A baseline is accepted only when it reads like the former.
  const LIKE_CTL_RE = /like|j'?aime|pouce|thumb|^send an? \S+$|^envoyer un \S+$/i;
  const SEND_CTL_RE = /press enter|entr[eé]e pour|^send$|^envoyer$|envoyer un message/i;
  // true = the control changed since the empty-composer baseline (staged),
  // false = unchanged (nothing staged), null = signal unavailable right now.
  function stagedPerControl(baseline) {
    if (!baseline) return null;
    const now = sendControlLabel();
    if (!now) return null;
    return now !== baseline;
  }
  // Which attach channel produced the last attachVideo verdict (for the 🩺 trace),
  // and the empty-composer control label it started from (blind-send baseline).
  let lastAttachVia = "-";
  let lastAttachCtlBase = "";
  // Attach ONE clip (no send). knownCount = how many attachments are already
  // legitimately in the tray; tid = the thread this clip belongs to. Returns:
  // true (new preview verified), false (provably nothing new attached, extras
  // cleaned — safe to RE-ATTEMPT this clip later), "dirty" (unverifiable
  // leftover — treat the clip as attempted, never re-attempt), "navigated"
  // (the operator switched chats mid-attach — nothing may be trusted or sent;
  // any stray the paste created in the NEW chat's tray is best-effort removed).
  // Attachments still UPLOADING in the tray (progressbars). Some FB builds /
  // slow machines reject a new paste while an upload is running — the direct
  // cause of "clip 1-2 attach, clip 3 always fails" on those machines.
  const trayUploads = () => safe(() => trayQuery('[role="progressbar"]').length, 0);
  // BULK ATTACH (v0.21.31 — the big speed win): hand ALL clips to the composer
  // in ONE paste, exactly like a human dragging three files at once. Facebook
  // then uploads them in PARALLEL instead of one-after-another, which is the
  // difference between ~15s and ~45s for a 3-clip set — and it removes the
  // per-clip settle waits entirely. Returns the number of NEW previews verified
  // (0 = nothing landed, caller falls back to the one-by-one path), or
  // "navigated" when the operator switched chats mid-attach.
  async function attachVideosBulk(filesArr, tid, pathsArr) {
    const composer = findComposer();
    if (!composer) return 0;
    composer.focus();
    if (tid && !stillOnThread(tid)) return "navigated";
    const before = new Set(trayEls());
    const beforeBtns = new Set(trayRemoveBtns());
    // (v0.21.38) The Chrome file API no longer runs here: a multi-file set whose
    // tiles render late leaves up to N strays behind, and the per-clip fallback
    // then stacked copies on top (the PC-mnbbd pile). With the file API usable
    // the engine streams ONE clip at a time instead (attachVideo) — at most one
    // clip in flight per chat, always the next one due, so any late tile is
    // adopted or trimmed, never doubled. This synthetic multi-paste stays for
    // machines without the file API. `pathsArr` is kept for signature stability.
    void pathsArr;
    const dtAll = () => {
      const dt = new DataTransfer();
      for (const f of filesArr) dt.items.add(f);
      return dt;
    };
    const fired = safe(() => {
      const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: dtAll() });
      composer.dispatchEvent(ev);
      return true;
    }, false);
    if (!fired) return 0;
    // Wait for ALL previews. Bounded generously — uploads run in parallel, so
    // this is one wait for the whole set instead of one per clip.
    const want = filesArr.length;
    const start = Date.now();
    let seen = 0;
    while (Date.now() - start < 45000) {
      await sleep(700);
      if (tid && !stillOnThread(tid)) {
        for (const b of trayRemoveBtns()) if (!beforeBtns.has(b)) safe(() => b.click());
        return "navigated";
      }
      seen = trayEls().filter((el) => !before.has(el)).length;
      if (seen >= want) return want;
      // FAIL FAST (v0.21.32): a live diagnostic showed Facebook's composer takes
      // ZERO files from a synthetic multi-file paste on at least some builds
      // (attach-trace "bulk:0") — and this probe then burned ~50s per set before
      // the fallback. If NOTHING has appeared within 10s, multi-paste is
      // unsupported here: bail immediately to the one-by-one path.
      if (seen === 0 && Date.now() - start > 10000) return 0;
    }
    await sleep(6000); // late-render grace — a slow machine may still be painting
    seen = trayEls().filter((el) => !before.has(el)).length;
    return Math.min(seen, want);
  }
  // Verdicts (v0.21.38): true (tile verified), "blind" (Messenger's composer
  // reports content staged — the send control flipped — but no tile rendered
  // yet; send it, never dispatch another copy), "unverified" (the browser
  // accepted the file-API set, no tile and no control signal — a late render
  // can't be ruled out, so the clip is treated as attempted: skip-forward, the
  // resume visit adopts its tile if it shows up), false / "dirty" / "navigated"
  // as before. `file` may be a LAZY loader {lazy:true, load()} — on-disk clips
  // no longer haul their base64 through the message channel unless a synthetic
  // strategy actually needs the File.
  async function attachVideo(file, knownCount, tid, diskPath) {
    lastAttachVia = "-";
    const composer = findComposer();
    if (composer) composer.focus();
    if (tid && !stillOnThread(tid)) return "navigated";
    let fileObj = file && file.lazy ? null : file;
    const ensureFile = async () => {
      if (fileObj) return fileObj;
      if (file && file.lazy) { try { fileObj = await file.load(); } catch (e) { fileObj = null; } }
      return fileObj;
    };
    // CHROME FILE API FIRST (v0.21.36) when the clip is on disk. Runs as
    // strategy 0; the synthetic strategies keep their old order/windows behind it.
    const useCdp = !!diskPath && cdpUsableNow() && !!composer && !composerText(composer);
    const firstPasteIdx = useCdp ? 1 : 0;
    // The render-independent staged signal is trustworthy only from an EMPTY,
    // draft-free composer: with a known head or typed text the control already
    // shows Send and cannot flip again.
    // …and only when the control we found IS the like/thumb button (its label
    // says so): any other button that happens to sit rightmost in the band
    // would never flip and would silently disable the signal — or worse, flip
    // for its own reasons. No recognizable like button ⇒ no signal (tile only).
    let ctlBase = knownCount === 0 && composer && !composerText(composer) ? sendControlLabel() : "";
    if (ctlBase && !(LIKE_CTL_RE.test(ctlBase) && !SEND_CTL_RE.test(ctlBase))) ctlBase = "";
    lastAttachCtlBase = ctlBase; // the send path compares against it in blind mode
    // OPTIMISTIC PIPELINING (v0.21.32): the next clip is pasted immediately,
    // WHILE the previous clip is still uploading — most FB builds accept it,
    // which makes the uploads overlap instead of running one after another
    // (this was the remaining 30-60s). Builds that reject a mid-upload paste
    // fail the first short detection window; the loop then waits the uploads
    // out and pastes AGAIN (second attempt below) with the long window — the
    // proven v0.21.29 behavior, just demoted from "always" to "fallback".
    const dtFor = (f) => {
      const dt = new DataTransfer();
      dt.items.add(f);
      return dt;
    };
    const attempts = [];
    if (useCdp) {
      const cdpFn = async () => {
        setStatus({ lastAction: "attaching video via Chrome file API…" });
        const r = await ask({ type: "CDP_SET_FILES", paths: [diskPath] });
        if (r && r.ok) return true;
        if (r && r.missing) forgetDiskPaths([diskPath]); // deleted on disk — background re-downloads
        noteCdpFail(r);
        return false; // nothing reached the composer's input → synthetic strategies are safe
      };
      cdpFn.isCdp = true;
      cdpFn.via = "cdp";
      attempts.push(cdpFn);
    }
    if (composer) {
      const pasteFn = async () => {
        const f = await ensureFile();
        if (!f) return false;
        const ev = new ClipboardEvent("paste", { bubbles: true, cancelable: true });
        Object.defineProperty(ev, "clipboardData", { value: dtFor(f) });
        composer.dispatchEvent(ev);
        return true;
      };
      pasteFn.via = "paste";
      attempts.push(pasteFn); // optimistic — fired even while a previous upload runs
      attempts.push(pasteFn); // retry after the loop settles the uploads (see below)
      const dragFn = async () => {
        const f = await ensureFile();
        if (!f) return false;
        const dt = dtFor(f);
        for (const t of ["dragenter", "dragover", "drop"]) {
          const ev = new DragEvent(t, { bubbles: true, cancelable: true });
          Object.defineProperty(ev, "dataTransfer", { value: dt });
          composer.dispatchEvent(ev);
        }
        return true;
      };
      dragFn.via = "drag";
      attempts.push(dragFn);
    }
    const inputFn = async () => {
      // Last resort: a file input — but ONLY one that is not part of the listing
      // card's own uploader (the input whose surrounding text says "add video to
      // listing"/"update listing" belongs to the LISTING, not the chat).
      const f = await ensureFile();
      if (!f) return false;
      const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter((inp) => {
        const wrap = safe(() => inp.closest("div,form,section"), null);
        const t = safe(() => ((wrap && wrap.innerText) || "").toLowerCase(), "");
        return !/add (a |your )?videos? to( your| the)? listing|update( your)? listing|mettre à jour|modifier (l|votre annonce)|ajoute[rz]? (une |la |des )?vid/.test(t);
      });
      const input = inputs[inputs.length - 1]; // composer attachments render late in the DOM
      if (!input) return false;
      input.files = dtFor(f).files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    };
    inputFn.via = "input";
    attempts.push(inputFn);

    // Try each strategy IN ORDER; require a NEW preview element to appear before
    // trusting it (identity, not count-delta — immune to simultaneous changes).
    let attached = false;
    let strategyIdx = 0;
    let lastBeforeEls = new Set();
    for (const attempt of attempts) {
      // A previous strategy's paste may have rendered too late for its window —
      // clean the EXTRAS (never the known-good clips) before escalating, or the
      // next strategy would stage a second copy and one Enter sends both.
      if (strategyIdx > 0 && trayRemoveBtns().length > knownCount) await sweepTrayExtras(knownCount);
      // Escalating past the optimistic paste: settle any running uploads first
      // (some FB builds reject a paste mid-upload — the retry then lands).
      if (strategyIdx > 0 && trayUploads() > 0) {
        const tS = Date.now();
        while (Date.now() - tS < 60000 && trayUploads() > 0) {
          if (tid && !stillOnThread(tid)) return "navigated";
          await sleep(1000);
        }
      }
      // Navigating away mid-attach means any further paste would land in the
      // WRONG chat's composer — stop before dispatching, and if a stray already
      // appeared in the new chat's tray, remove it immediately (fresh node
      // identities are reliable milliseconds after render).
      const beforeBtns = new Set(trayRemoveBtns());
      if (tid && !stillOnThread(tid)) return "navigated";
      const beforeEls = new Set(trayEls());
      lastBeforeEls = beforeEls;
      const uploadsAtDispatch = trayUploads();
      // (the strategies are async: the file API round-trips to the background,
      // the synthetic ones may have to load the File first)
      let fired = false;
      try { fired = !!(await Promise.resolve(safe(attempt, false))); } catch (e) { fired = false; }
      if (!fired) { strategyIdx++; continue; }
      lastAttachVia = attempt.via || "-";
      // Window sizing: the OPTIMISTIC paste fails fast (12s) when uploads were
      // running at dispatch — if this build rejects mid-upload pastes we want to
      // move to the settle-and-retry quickly, not burn 30s. The settled retry
      // keeps the LONG 30s window (throttled/RDP machines render previews
      // 20-30s late; a short window there judged good attaches "failed", swept
      // them away and struck the chat — the v0.21.29 lockout bug). The file API
      // strategy gets 45s when the staged signal can shortcut it, 60s when it
      // cannot (a tile is then the only evidence, and it can be a minute late).
      const windowMs = attempt.isCdp ? (ctlBase ? 45000 : 60000) : strategyIdx === firstPasteIdx ? (uploadsAtDispatch > 0 ? 12000 : 30000) : strategyIdx === firstPasteIdx + 1 ? 30000 : 12000;
      const start = Date.now();
      let navigated = false;
      let blind = false;
      // The control also flips when the OPERATOR types: a flip counts as staged
      // only while the textbox is still empty (otherwise Enter would ship their
      // half-typed text along with the clip).
      const flipped = () => ctlBase && stagedPerControl(ctlBase) === true && !composerText(composer);
      while (Date.now() - start < windowMs) {
        await sleep(1000);
        if (tid && !stillOnThread(tid)) { navigated = true; break; }
        if (trayEls().some((el) => !beforeEls.has(el))) {
          attached = true;
          break;
        }
        if (flipped()) { blind = true; break; } // staged per the composer, tile pending
      }
      if (blind && !attached) {
        // The composer holds the clip — give its tile a short chance to show
        // (it is the better evidence), then proceed on the control alone.
        const tB = Date.now();
        while (Date.now() - tB < 10000) {
          await sleep(1000);
          if (tid && !stillOnThread(tid)) { navigated = true; break; }
          if (trayEls().some((el) => !beforeEls.has(el))) { attached = true; break; }
        }
      }
      if (navigated) {
        for (const b of trayRemoveBtns()) if (!beforeBtns.has(b)) safe(() => b.click()); // de-stray the wrong chat
        return "navigated";
      }
      if (attached) {
        if (attempt.isCdp) noteCdpVerified(false);
        break; // this strategy worked — stop trying others
      }
      if (blind) {
        if (attempt.isCdp) noteCdpVerified(true);
        return "blind"; // staged for sure, invisible so far — NEVER dispatch another copy
      }
      if (attempt.isCdp) {
        // The browser accepted the set, yet neither a tile nor the composer's
        // own control showed anything for the whole window. A late render (or a
        // lagging control) cannot be ruled out, and a second dispatch into this
        // tray is exactly how tiles piled up — so NEVER fall through to the
        // synthetic strategies here (the v0.21.36 rule, kept): the clip counts
        // as attempted (skip-forward), the reply's Enter flushes it if it was
        // staged invisibly, and the resume visit adopts its tile if it renders
        // late. Two of these in a row park the file API so the synthetic path
        // gets the NEXT set instead.
        noteCdpUnverified();
        return "unverified";
      }
      strategyIdx++;
    }
    if (!attached) {
      // LATE-RENDER GRACE before declaring failure: one more beat — a paste that
      // rendered after the last window is a SUCCESS, not a stray to sweep.
      await sleep(8000);
      if (trayEls().some((el) => !lastBeforeEls.has(el))) {
        await sleep(1200);
        return true;
      }
      if (ctlBase && stagedPerControl(ctlBase) === true && !composerText(composer)) return "blind"; // flipped late
      await sweepTrayExtras(knownCount);
      if (trayRemoveBtns().length > knownCount) return "dirty"; // unverifiable leftover — never re-attempt
      return false; // provably nothing new attached — re-attempting later cannot duplicate
    }
    await sleep(1200); // let the upload begin before the next paste
    return true;
  }
  // ONE Enter sends everything attached (+ click-Send fallback). Attach + send-
  // attempt = delivered (the v0.12.3 law): detach confirmation stays best-effort
  // because a false "not sent" used to trigger retries → duplicate videos.
  async function sendAttachedVideos(blindBaseline, tid) {
    const composer2 = findComposer();
    const previews = trayEls().length || 1;
    if (composer2) pressEnter(composer2);
    const s2 = Date.now();
    // Every wait below stops the moment the operator opens another chat: a
    // Send click there would ship THEIR draft to another buyer.
    const gone = () => tid && !stillOnThread(tid);
    if (blindBaseline) {
      // BLIND SEND (v0.21.38): no tile to watch, and the upload may still be
      // running (Enter is queued by Messenger until it completes). "Sent" = the
      // send control reverting to its empty-composer label; allow the upload time.
      while (Date.now() - s2 < 90000) {
        await sleep(1000);
        if (gone()) return true;
        if (sendControlLabel() === blindBaseline) return true;
      }
      if (gone()) return true;
      clickSend();
      const s3 = Date.now();
      while (Date.now() - s3 < 20000) {
        await sleep(1000);
        if (gone() || sendControlLabel() === blindBaseline) return true;
      }
      return true; // attach + send attempt = delivered (the v0.12.3 law)
    }
    while (Date.now() - s2 < 8000) {
      await sleep(400);
      if (gone()) return true;
      if (trayEls().length < previews) return true; // confirmed gone = sent
    }
    if (gone()) return true;
    clickSend(); // fallback for layouts where Enter doesn't send
    await sleep(1500);
    return true;
  }
  // After a streamed send: let a QUEUED Enter (pressed mid-upload) fire — never
  // touch the tray while a progressbar is visible — then clear whatever is left.
  // A tile still there once the send has cleared is a late-rendered stray from an
  // earlier attempt; adopting it into the NEXT clip's message is how a buyer got
  // the same clip twice, so it is removed. (No second send attempt here: the
  // v0.12.3 law — attach + one send attempt = delivered; retries on a false "not
  // sent" were the original duplicate-video bug.) Only an unremovable tile is
  // carried as "known" (it rides the next Enter). Returns the tiles left.
  async function settleTrayAfterSend(tid) {
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && trayUploads() > 0) {
      if (tid && !stillOnThread(tid)) return trayRemoveBtns().length;
      await sleep(1000);
    }
    const t1 = Date.now();
    while (Date.now() - t1 < 6000 && trayRemoveBtns().length > 0) await sleep(500);
    if (trayRemoveBtns().length > 0 && !(tid && !stillOnThread(tid))) await sweepTrayExtras(0);
    return trayRemoveBtns().length;
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
    // (a) An actual <video> element on our side (present once the clip renders).
    // Hardened (audit 2026-08-09): the old test degraded to `center-x > composer
    // midpoint` because looksLikeOurBubble() is null for unpainted media wrappers —
    // an autoplaying LISTING clip (shared listing / collapsed listing header inside
    // a [role=row] in GROUP threads) or a buyer clip in a narrow window then marked
    // text-only chats "already sent" (operator screenshot: Jing Jr.). Now:
    // message-media size floor, listing-link exclusion, and side decided by
    // RIGHT-ANCHORING against the ROW rect (our bubbles are flush-right; buyer
    // media is gutter-inset left) — never against the composer's toolbar-inset box.
    const vids = safe(() => Array.from(main.querySelectorAll('[role="row"] video')), []);
    for (const v of vids) {
      const r = safe(() => v.getBoundingClientRect(), null);
      if (!r || r.top >= top || r.width < 80 || r.height < 80) continue;
      if (safe(() => v.closest('a[href*="/marketplace/"]'), null)) continue; // inside a listing link
      const rowEl0 = safe(() => v.closest('[role="row"]'), null);
      if (!rowEl0) continue;
      if (safe(() => rowEl0.querySelector('a[href*="/marketplace/"]'), null)) continue; // row carries a listing link
      const paint = looksLikeOurBubble(v);
      if (paint === false) continue; // painted gray → the buyer's
      if (paint === true) return true; // painted blue/gradient → ours
      const rowR = safe(() => rowEl0.getBoundingClientRect(), null);
      if (!rowR) continue;
      const rightGap = rowR.right - r.right, leftGap = r.left - rowR.left;
      if (rightGap <= 64 && leftGap > rightGap + 40) return true; // flush-right in its row → ours
    }
    // (b) The duration badge ("0:16", "1:03"). It's a small overlay element on the
    //     thumbnail — usually NOT [dir="auto"] — so scan every leaf element in the
    //     message rows for one whose OWN text is exactly mm:ss and is badge-sized.
    const leaves = safe(() => Array.from(main.querySelectorAll('[role="row"] span, [role="row"] div')), []);
    for (const n of leaves) {
      if (n.childElementCount !== 0) continue; // the badge itself, not a wrapper
      // mm:ss inside [dir="auto"] is TEXT (our "5:30" reply, 24h-locale time
      // dividers like "14:32" on FR accounts) — never a duration badge. Those
      // false matches were marking fresh chats "already has video" on FR machines.
      if (safe(() => n.closest('[dir="auto"]'), null)) continue;
      const t = safe(() => (n.textContent || "").trim(), "");
      if (!/^\d{1,2}:\d{2}$/.test(t)) continue; // a video duration badge
      const r = safe(() => n.getBoundingClientRect(), null);
      if (!r || r.top >= top || r.width <= 0 || r.width > 90) continue; // small badge, in the msg area
      // A real duration badge OVERLAYS a media thumbnail. Find a large media element
      // in the same row whose rect contains the badge center, and decide the side
      // from THAT rect — never from the tiny badge rect (spoofable by buyer
      // voice-note durations and buyer clips in narrow windows/panel-open layouts).
      const rowEl = safe(() => n.closest('[role="row"]'), null);
      if (!rowEl) continue;
      // Hardened (audit 2026-08-10): listing-link exclusions + side decided by
      // paint or ROW-rect right-anchoring on the MEDIA rect — the old composer-
      // midpoint test with null-paint pass-through matched listing/buyer media.
      if (safe(() => n.closest('a[href*="/marketplace/"]'), null)) continue; // badge inside a listing link
      if (safe(() => rowEl.querySelector('a[href*="/marketplace/"]'), null)) continue; // row carries a listing link
      const rowR = safe(() => rowEl.getBoundingClientRect(), null);
      if (!rowR) continue;
      const bcx = r.left + r.width / 2, bcy = r.top + r.height / 2;
      const medias = safe(() => Array.from(rowEl.querySelectorAll('video, img, [style*="background-image"]')), []);
      for (const mEl of medias) {
        const mr = safe(() => mEl.getBoundingClientRect(), null);
        if (!mr || mr.width < 80 || mr.height < 80) continue; // avatars/emoji/stickers are smaller
        if (bcx <= mr.left || bcx >= mr.right || bcy <= mr.top || bcy >= mr.bottom) continue; // badge not on this thumbnail
        const paint = looksLikeOurBubble(mEl);
        if (paint === false) continue; // painted gray → the buyer's
        if (paint === true) return true; // painted blue/gradient → ours
        const rightGap = rowR.right - mr.right, leftGap = mr.left - rowR.left;
        if (rightGap <= 64 && leftGap > rightGap + 40) return true; // flush-right in its row → ours
      }
    }
    return false;
  }

  // FROZEN pre-2026-08-10 <video>-branch detector (v0.21.10-13 behavior) — used
  // ONLY by the false-mark divergence probe in maybeSendVideo: if THIS fires while
  // the hardened detector does not, the false-positive source of an old mark is
  // identified live in the DOM and the mark is safe to clear. Never marks chats.
  function legacyChatVideoDetect() {
    const main = getMain();
    const composer = findComposer();
    if (!main || !composer) return false;
    const c = safe(() => composer.getBoundingClientRect(), null);
    if (!c) return false;
    const top = c.top;
    const mid = c.left + c.width / 2;
    const vids = safe(() => Array.from(main.querySelectorAll('[role="row"] video')), []);
    for (const v of vids) {
      const r = safe(() => v.getBoundingClientRect(), null);
      if (!r || r.top >= top || r.width <= 0) continue;
      if (!safe(() => v.closest('[role="row"]'), null)) continue;
      const paint = looksLikeOurBubble(v);
      if (paint === true) return true;
      if (paint !== false && r.left + r.width / 2 > mid) return true;
    }
    return false;
  }
  const VIDEO_DETECTOR_FIX_TS = Date.parse("2026-08-10T00:00:00Z"); // marks written before this used the weaker <video> branch
  const BADGE_FIX_TS = Date.parse("2026-08-10T06:00:00Z"); // marks written before this may come from the buggy badge branch

  // FROZEN pre-fix BADGE-branch detector (composer-midpoint side test with
  // null-paint pass-through — the FP source until 2026-08-10). Used ONLY by the
  // divergence probe: firing while the hardened detector stays silent identifies
  // a false mark's source live in the DOM. Never marks chats.
  function legacyBadgeDetect() {
    const main = getMain();
    const composer = findComposer();
    if (!main || !composer) return false;
    const c = safe(() => composer.getBoundingClientRect(), null);
    if (!c) return false;
    const top = c.top;
    const mid = c.left + c.width / 2;
    const leaves = safe(() => Array.from(main.querySelectorAll('[role="row"] span, [role="row"] div')), []);
    for (const n of leaves) {
      if (n.childElementCount !== 0) continue;
      if (safe(() => n.closest('[dir="auto"]'), null)) continue;
      const t = safe(() => (n.textContent || "").trim(), "");
      if (!/^\d{1,2}:\d{2}$/.test(t)) continue;
      const r = safe(() => n.getBoundingClientRect(), null);
      if (!r || r.top >= top || r.width <= 0 || r.width > 90) continue;
      const rowEl = safe(() => n.closest('[role="row"]'), null);
      if (!rowEl) continue;
      const bcx = r.left + r.width / 2, bcy = r.top + r.height / 2;
      const medias = safe(() => Array.from(rowEl.querySelectorAll('video, img, [style*="background-image"]')), []);
      for (const mEl of medias) {
        const mr = safe(() => mEl.getBoundingClientRect(), null);
        if (!mr || mr.width < 80 || mr.height < 80) continue;
        if (bcx <= mr.left || bcx >= mr.right || bcy <= mr.top || bcy >= mr.bottom) continue;
        if (looksLikeOurBubble(mEl) !== false && mr.left + mr.width / 2 > mid) return true;
      }
    }
    return false;
  }

  // Send the stored demo video(s) to the current chat — ONCE per chat, a set delay
  // after the text reply (default 10s). Supports MULTIPLE videos, sent in order.
  // Demo-video state machine. Goal: send the configured clip(s) EXACTLY once per chat
  // (with the first-video delay + the between-videos delay), CONFIRM they actually
  // landed, RETRY later if a send genuinely failed (backoff, capped — no spam), and
  // NEVER resend once a video is confirmed in the chat.
  // ---- Chrome FILE API attach (v0.21.36): real files via the debugger protocol ----
  // See background.js cdpSetFiles(). A hard failure parks the path for a while so a
  // machine without the permission/file access doesn't burn seconds on every clip.
  let cdpDisabledUntil = 0;
  let cdpStrikes = 0; // consecutive TRANSIENT misses (input not found / no preview)
  let cdpSetToken = 0; // bumped per video set; a miss skips the file API for the REST of that set only
  let cdpFailedSetToken = -1;
  const cdpAvailable = () => Date.now() > cdpDisabledUntil;
  const cdpUsableNow = () => cdpAvailable() && cdpFailedSetToken !== cdpSetToken;
  function noteCdpFail(r) {
    const err = (r && r.error) || "no response";
    if (r && r.fileAccess === "denied") {
      cdpDisabledUntil = Date.now() + 6 * 3600 * 1000;
      vstat("file API blocked: turn ON 'Allow access to file URLs' for SubSell in chrome://extensions — using fallback attach");
      return;
    }
    if (r && r.missing) {
      // The clip file is gone from disk (verified by the pre-set probe, nothing
      // touched the composer): the background re-downloads it; this set goes
      // synthetic, the next set is back on the file API.
      cdpFailedSetToken = cdpSetToken;
      setStatus({ videoLast: "clip file missing on disk — re-downloading; paste attach this time" });
      return;
    }
    if (/unavailable|permission/i.test(err)) {
      cdpDisabledUntil = Date.now() + 30 * 60 * 1000; // API not granted yet (reload pending)
    } else if (/input not found|no preview/i.test(err)) {
      // Transient CHAT state (composer holding a draft, stuck preview, dead file):
      // skip the file API for the rest of this set, but never black it out for
      // the next chats on a single miss — three in a row park it 5 min.
      cdpFailedSetToken = cdpSetToken;
      if (++cdpStrikes >= 3) { cdpStrikes = 0; cdpDisabledUntil = Date.now() + 5 * 60 * 1000; }
    } else {
      cdpDisabledUntil = Date.now() + 5 * 60 * 1000; // attach/detach/timeout/protocol errors
    }
    setStatus({ videoLast: "file API attach failed: " + trunc(err, 80) + " — falling back to paste" });
  }
  let lastCdpVerifiedAt = 0;
  // Seed from the persisted stats so a content-script reload on a healthy machine
  // doesn't start in "unproven" mode (rush mode would queue videos needlessly).
  getLocal(["cdpStats"]).then((r) => {
    const t = r && r.cdpStats && r.cdpStats.lastVerifiedAt;
    if (t && t > lastCdpVerifiedAt) lastCdpVerifiedAt = t;
  });
  // "Healthy" = a file-API attach was VERIFIED (preview appeared) within the last
  // 2 h on this machine — the signal that an attach will cost seconds, not minutes.
  // (Hard parks only — the per-set skip token is meaningless outside a set.)
  const cdpRecentlyHealthy = () => cdpAvailable() && Date.now() - lastCdpVerifiedAt < 2 * 3600 * 1000;
  // Rush must not starve its own health signal: noteCdpVerified() only fires inside
  // the attach path, which rush skips — so once the 2 h window lapsed (overnight),
  // a HEALTHY machine could never leave rush while ≥3 buyers wait. While unproven
  // but usable, let ONE videos-first probe visit through every 10 min: a healthy
  // attach verifies in seconds and restores videos-first for 2 h; an unhealthy
  // machine pays at most one slow visit per 10 min.
  let lastRushProbeAt = 0;
  const RUSH_PROBE_EVERY_MS = 10 * 60 * 1000;
  function rushProbeDue() {
    if (!cdpUsableNow()) return false;
    if (Date.now() - lastRushProbeAt <= RUSH_PROBE_EVERY_MS) return false;
    lastRushProbeAt = Date.now();
    return true;
  }
  function noteCdpVerified(blind) {
    cdpStrikes = 0;
    cdpUnverifiedStreak = 0;
    lastCdpVerifiedAt = Date.now();
    ask({ type: "CDP_VERIFIED", blind: !!blind }); // fire-and-forget telemetry ("protocol ok" ≠ "clip staged")
  }
  // The browser accepted a file-API set but the composer showed NOTHING (no tile,
  // no staged signal) for the whole window. One miss is a chat/layout quirk; two
  // in a row mean this machine's composer is not taking file-API sets right now
  // (wrong input on a new layout, frozen renderer…): park the file API 30 min so
  // the synthetic strategies get their turn, then re-probe. A verified attach
  // resets the streak. Telemetry: the 🩺 fileapi line shows unverified=N.
  let cdpUnverifiedStreak = 0;
  function noteCdpUnverified() {
    ask({ type: "CDP_UNVERIFIED" });
    if (++cdpUnverifiedStreak >= 2) {
      cdpUnverifiedStreak = 0;
      cdpDisabledUntil = Date.now() + 30 * 60 * 1000;
      setStatus({ videoLast: "file API sets are not showing up in the composer on this machine — paste attach for 30 min" });
    }
  }
  // Absolute on-disk path for a clip (background downloads it once per machine).
  // null = no path → that clip uses the synthetic strategies. Successes are memoized
  // only briefly (2 min) so a deleted file is re-validated by the background (it
  // re-checks `exists`); failures are remembered 15 min so we don't re-ask per clip.
  const diskPathMem = {};
  let diskFailStreak = 0;
  function forgetDiskPaths(paths) {
    for (const k of Object.keys(diskPathMem)) {
      const e = diskPathMem[k];
      if (!paths || (e && e.path && paths.includes(e.path))) delete diskPathMem[k];
    }
  }
  async function diskPathFor(req) {
    if (!cdpAvailable()) return null;
    const key = req.url || "local:" + (req.name || "") + ":" + ((req.dataUrl && req.dataUrl.length) || 0);
    const m = diskPathMem[key];
    if (m && Date.now() - m.at < (m.path ? 2 * 60 * 1000 : 15 * 60 * 1000)) return m.path;
    try {
      // Per-clip time budget: the background keeps the download running past it
      // and persists the id, so the NEXT visit adopts the file — this visit falls back.
      const r = await Promise.race([
        ask(Object.assign({ type: "VIDEO_DISK_PATH" }, req)),
        sleep(60000).then(() => ({ ok: false, error: "disk path lookup timed out (download still running)" })),
      ]);
      if (r && r.ok && r.path) {
        diskFailStreak = 0;
        diskPathMem[key] = { path: r.path, at: Date.now() };
        return r.path;
      }
      diskPathMem[key] = { path: null, at: Date.now() };
      if (++diskFailStreak >= 6) { diskFailStreak = 0; cdpDisabledUntil = Date.now() + 15 * 60 * 1000; } // this machine can't stage clips on disk right now
      setStatus({ videoLast: "clip not on disk yet: " + trunc((r && r.error) || "?", 60) + " — paste attach this time" });
    } catch (e) { /* fall back */ }
    return null;
  }
  const VIDEO_CLAIM_TTL = 3 * 60 * 1000; // an in-flight claim older than this is stale
  // (v0.21.40, operator: "remove all blocks — send any video you can") the only
  // pacing left on a chat whose clips fail to load/attach is this short backoff;
  // there is NO 24h pause and NO give-up count any more. `fails` is still counted
  // (diagnostic), the pending lane's own per-chat retry spacing bounds the cost.
  const VIDEO_RETRY_BACKOFF = 3 * 60 * 1000; // wait this long before retrying a failed send
  const VIDEO_MAX_TRIES = 3; // telemetry threshold only ("attachFails3+" in 🩺) — never blocks
  // Synchronous, in-memory guard: threadIds this content-script instance has already
  // committed a video to. Checked with ZERO awaits at the very top of maybeSendVideo,
  // so even if chrome.storage writes lag, a chat can't be sent to twice in one session.
  const videoLocked = new Set();
  async function recordVideoFail(id, why) {
    const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
    const a = am[id] || {};
    am[id] = { fails: (a.fails || 0) + 1, failAt: Date.now(), why: why || a.why || "" };
    await setLocal({ videoAttempts: am });
  }
  // Live "why" line for the popup: every exit of the video engine reports itself, so
  // "videos not sending" is diagnosable from a screenshot instead of guesswork.
  function vstat(reason) {
    setStatus({ videoLast: reason });
    reportVideoStatus(reason); // fire-and-forget; must never block the caller
  }
  // Central video-status telemetry: mirrors MATERIAL blocked states into the existing
  // Activity feed, deduped to at most one row per reason per 24h — the dashboard now
  // NAMES the machines whose videos are blocked and why. Healthy exits never post.
  const VSTAT_CLASSES = [
    [/^videos OFF/, "cfg-off"],
    [/^no videos configured/, "cfg-none"],
    [/^couldn't read settings/, "settings-unreadable"],
    [/^loaded \d+\/\d+ clip/, "clips-load-failed"],
    [/^⚠ 0\//, "attach-failed"],
    [/^⚠ all /, "clips-all-blocked"],
    [/^skip — detected an existing video/, "dom-marked"],
    [/can't load/, "clips-excluded"],
    [/^paused 24h/, "chat-paused-24h"],
    [/^file API blocked/, "file-access-off"],
    [/^error:/, "engine-error"],
  ];
  // Machine-wide blockers: only these trigger the one-time "OK again" recovery row.
  const VSTAT_FULL_BLOCK = { "cfg-off": 1, "cfg-none": 1, "settings-unreadable": 1, "attach-failed": 1, "clips-all-blocked": 1, "engine-error": 1 };
  const VSTAT_TTL = 24 * 3600 * 1000;
  let vstatMap = null, vstatHydrating = null; // {key: lastPostedAt}, persisted
  async function reportVideoStatus(reason) {
    try {
      if (!vstatMap) {
        if (!vstatHydrating) vstatHydrating = getLocal(["videoBlockReported"]).then((r) => { vstatMap = (r && r.videoBlockReported) || {}; });
        await vstatHydrating;
      }
      const now = Date.now();
      if (/^sent ✓/.test(reason)) {
        const hadBlock = Object.keys(vstatMap).some((k) => VSTAT_FULL_BLOCK[k] && vstatMap[k] > (vstatMap.ok || 0));
        if (hadBlock && now - (vstatMap.ok || 0) > VSTAT_TTL) {
          vstatMap.ok = now;
          await setLocal({ videoBlockReported: vstatMap });
          ask({ type: "LOG_EVENT", entry: { action: "video-status", thread: null, buyer: null, reply: "videos OK again — " + reason } });
        }
        return;
      }
      let key = null;
      for (const [re, k] of VSTAT_CLASSES) if (re.test(reason)) { key = k; break; }
      if (!key) return; // normal skips/backoffs — never mirrored
      if (now - (vstatMap[key] || 0) < VSTAT_TTL) return; // deduped: no storage read, no post
      vstatMap[key] = now; // never deleted — keys re-assert at most daily, immune to flapping
      await setLocal({ videoBlockReported: vstatMap });
      ask({ type: "LOG_EVENT", entry: { action: "video-status", thread: null, buyer: null, reply: "videos blocked [" + key + "]: " + reason } });
    } catch (e) { /* telemetry must never disturb the bot */ }
  }
  // Set true when a deferSend run staged the whole set but SKIPPED the Enter so
  // the caller can put the text reply into the SAME message (one send delivers
  // videos + answer together). The caller is then responsible for firing an
  // Enter (typeAndSend, or sendAttachedVideos as fallback) in this same visit.
  let videoSendDeferred = false;
  // Called by the reply path AFTER an Enter actually shipped the staged bundle:
  // converts the owned DRAFT marker into a real sent stamp, and only THEN posts
  // the "sent ✓" status + Activity row (staging must never claim delivery). A
  // partial set keeps its tail resumable and stays on the pending queue.
  async function finalizeDeferredVideoSend(id, sidebarKey, name) {
    try {
      const dm = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
      const mk = dm[id];
      if (!mk || mk.owner !== TAB_UID || typeof mk.resumeFrom !== "number") return;
      const total = typeof mk.resumeTotal === "number" ? mk.resumeTotal : mk.resumeFrom;
      const n = mk.sent || 0;
      if (mk.resumeFrom < total) {
        // Partial set shipped with the reply — tail still owed on a later visit.
        dm[id] = { done: true, at: Date.now(), owner: TAB_UID, sent: n, resumeFrom: mk.resumeFrom, resumeTotal: total };
        await setLocal({ videoSentThreads: dm });
        await recordVideoFail(id, "attach"); // paces the tail retries
        vstat("sent " + n + "/" + total + " with the reply — finishing the rest on a later visit (" + (name || id) + ")");
        if (n > 0) ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: n + "/" + total + " demo videos sent — finishing the rest later" } });
        return;
      }
      dm[id] = { done: true, at: Date.now(), owner: TAB_UID, sent: n };
      const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
      if (am[id]) delete am[id];
      await setLocal({ videoSentThreads: dm, videoAttempts: am });
      videoLocked.add(id);
      clearVideoPending(id);
      if (sidebarKey && sidebarKey !== id) clearVideoPending(sidebarKey);
      vstat("sent ✓ " + n + "/" + total + " to " + (name || id) + " (with the reply)");
      if (n > 0) ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: n + "/" + total + " demo video(s) sent" } });
    } catch (e) { /* bookkeeping must never break the reply path */ }
  }
  // Called when a staged draft is being ABANDONED this visit (navigation, send
  // failure): drops the in-flight via:"lock" tag so the pending-lane visit may
  // adopt and ship the draft immediately instead of waiting out the 30-min
  // in-flight window. Everything else about the marker stays honest.
  async function demoteDraftMarker(id) {
    try {
      const dm = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
      const mk = dm[id];
      if (mk && mk.owner === TAB_UID && mk.via === "lock" && typeof mk.resumeFrom === "number") {
        delete mk.via;
        mk.at = Date.now();
        dm[id] = mk;
        await setLocal({ videoSentThreads: dm });
      }
    } catch (e) { /* best-effort */ }
  }
  async function maybeSendVideo(id, name, immediate, sidebarKey, deferSend, hooks) {
    videoSendDeferred = false;
    try {
      // Terminal exits must clear the pending queue under BOTH keys: deferral
      // writes videoPending[sidebarId] (v0.21.14) but this engine runs on the
      // ADOPTED id — clearing only `id` left sidebar-keyed entries immortal
      // (the aged lane revisited a done chat every hour forever).
      const clearPend = () => {
        clearVideoPending(id);
        if (sidebarKey && sidebarKey !== id) clearVideoPending(sidebarKey);
      };
      // SYNCHRONOUS guard first (no awaits): if this instance already committed a video
      // to this chat, never touch it again — closes the rapid-re-entry "non-stop" loop.
      if (id && videoLocked.has(id)) {
        clearPend();
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
        // Queue instead of dropping: a one-cycle settings hiccup used to consume
        // this chat's visit permanently (next visit could be days away on rotation).
        {
          const dn = (cfg.videoSentThreads || {})[id];
          const alreadyDone = !!(dn && dn.done && typeof dn.resumeFrom !== "number");
          const qk = sidebarKey || id;
          if (qk && !alreadyDone && videoPending[qk] == null && videoPending[id] == null) {
            videoPending[qk] = Date.now();
            persistDedup();
          }
        }
        vstat("couldn't read settings this cycle — will retry");
        return;
      }
      if (!cfg.videoEnabled && !central.length) {
        clearPend();
        vstat("videos OFF — no central videos in dashboard and per-machine toggle unchecked");
        setStatus({ lastError: "VIDEOS OFF on this machine — this machine has no video list (check dashboard Videos tab / this machine's config link)" });
        return;
      }
      if (!local.length && !central.length) {
        clearPend();
        vstat("no videos configured");
        setStatus({ lastError: "NO VIDEOS CONFIGURED — this machine receives no video list (check dashboard Videos tab / this machine's config link)" });
        return;
      }

      const now = Date.now();
      const done = cfg.videoSentThreads || {};

      // RESUME-TAIL: a set interrupted by operator navigation records resumeFrom = the
      // first clip index NEVER ATTEMPTED (we break BEFORE attempting). Only that
      // strictly-untouched tail may be sent later — zero duplicate risk, and the chat
      // finally gets all 3 configured clips instead of 2.
      const resumeFrom = done[id] && done[id].done && typeof done[id].resumeFrom === "number" ? done[id].resumeFrom : null;

      // IN-FLIGHT guard: a via:"lock" progress stamp younger than 10 min means a
      // set is probably being sent RIGHT NOW in another pass/tab (every loop
      // iteration refreshes `at`, so a live pass stays fresh even under heavy
      // background-tab timer throttling). Only a STALE stamp (crash mid-set) may
      // resume. Belt: even if a live pass IS wrongly resumed, the per-iteration
      // owner check + pre-attempt stamps below make interleaving duplicate-free —
      // the resumer starts strictly after the last stamped clip and the old owner
      // bows out at its next iteration.
      // (v0.21.40: 10 min, was 30 — a live pass re-stamps `at` at least every few
      // minutes; a crashed one used to block its own chat's resume for half an hour)
      if (resumeFrom != null && done[id].via === "lock" && now - (done[id].at || 0) < 10 * 60 * 1000) {
        vstat("set in progress in another pass — waiting (" + (name || id) + ")");
        return;
      }

      // (1) CONFIRMED sent → never resend. Only the NEW {done:true} is authoritative.
      if (done[id] && done[id].done && resumeFrom == null) {
        const dmk = done[id];
        // SELF-HEAL (i) — orphaned pre-send lock: via:"lock" with no clip ever
        // confirmed attached, older than 24h = a crash between lock and first
        // attach. If the open chat visibly has our video → confirm it; if the
        // loaded chat shows none → provably nothing attached (attach is preview-
        // based), clear the mark so the chat finally gets its set.
        if (dmk.via === "lock" && !dmk.sent && now - (dmk.at || 0) > 24 * 3600 * 1000 && !dmk.recon) {
          const mainEl = getMain();
          if (mainEl && findComposer() && safe(() => mainEl.querySelector('[role="row"]'), null)) {
            const dmR = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
            if (chatAlreadyHasOurVideo()) {
              dmR[id] = Object.assign({}, dmR[id], { sent: 1, recon: 1 }); // confirmed after all
              await setLocal({ videoSentThreads: dmR });
            } else {
              delete dmR[id];
              await setLocal({ videoSentThreads: dmR });
              videoLocked.delete(id);
              vstat("cleared an orphaned send-lock (" + (name || id) + ") — video sends on a later visit");
              return; // NEVER send in the same visit as a heal — normal pipeline takes it later
            }
          }
        }
        // SELF-HEAL (ii) — pre-hardening DOM mark (video branch until 2026-08-10,
        // badge branch until this release): BOUNDED divergence probe, max 3 tries
        // >= 4h apart, only on a LOADED chat. A single both-negative read is NOT
        // terminal — on throttled/minimized RDP windows the FP source (autoplaying
        // listing clip / badge media) is often not rendered at probe time. Clear
        // ONLY when the hardened detector is silent while a frozen legacy detector
        // still fires (FP source identified live). Both-negative keeps the mark —
        // the zero-duplicate direction. Legacy one-shot rechecked:1 counts as one
        // consumed probe, so already-burned marks get two more chances.
        const probeN = typeof dmk.recheckN === "number" ? dmk.recheckN : (dmk.rechecked ? 1 : 0);
        if (dmk.via === "dom" && !dmk.sent && probeN < 3 && now - (dmk.recheckAt || 0) > 4 * 3600 * 1000 && (dmk.at || 0) < BADGE_FIX_TS) {
          const mainEl2 = getMain();
          if (mainEl2 && findComposer() && safe(() => mainEl2.querySelector('[role="row"]'), null)) {
            const dmP = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
            if (!chatAlreadyHasOurVideo() && (legacyChatVideoDetect() || legacyBadgeDetect())) {
              delete dmP[id];
              await setLocal({ videoSentThreads: dmP });
              videoLocked.delete(id);
              vstat("cleared a false 'already sent' mark (" + (name || id) + ") — video sends on a later visit");
              return; // heal now, deliver on a later visit through the full pipeline
            }
            dmP[id] = Object.assign({}, dmP[id], { recheckN: probeN + 1, recheckAt: now });
            if (probeN + 1 >= 3) dmP[id].rechecked = 1; // terminal only after the 3rd both-negative
            await setLocal({ videoSentThreads: dmP });
          }
        }
        videoLocked.add(id);
        clearPend();
        vstat("skip — chat already marked sent (" + (name || id) + ")");
        return;
      }
      // A video is visibly in the chat (real message row) → it's sent; mark + stop.
      // (Skipped in resume mode — of course there are already videos there.)
      if (resumeFrom == null && chatAlreadyHasOurVideo()) {
        videoLocked.add(id);
        clearPend();
        done[id] = { done: true, at: now, via: "dom" }; // inert marker: DOM-detected, not a confirmed send
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
        // (v0.21.40) No 24h pause: a chat that failed 3× keeps retrying on the
        // short backoff below. The count is kept for the diagnostic only.
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
      if (cur && cur.claimAt && now - cur.claimAt < VIDEO_CLAIM_TTL && cur.claimTab !== TAB_UID) { vstat("claim race — another pass owns " + (name || id)); return; }
      attempts[id] = Object.assign({}, cur, { claimAt: now, claimTab: TAB_UID });
      await setLocal({ videoAttempts: attempts });
      const verify = (await getLocal(["videoAttempts"])).videoAttempts || {};
      if (!(verify[id] && verify[id].claimTab === TAB_UID)) { vstat("claim race — another pass owns " + (name || id)); return; } // lost the claim race

      // NO DELAYS (v0.21.25/26, operator directive): no pre-video wait on any
      // path, no between-clips gap at all — clips are ATTACHED back-to-back and
      // sent together in ONE message below. `immediate`, centralDelay and
      // betweenSec are kept in signatures/config for compatibility but no
      // longer do anything. (void reads keep linters honest.)
      void immediate; void centralDelay; void betweenSec;

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
          // Do NOT latch videoLocked when the observed mark is a RESUME marker —
          // "done" is transient there (another pass's partial set); a latched tab
          // would eat the tail's pending-queue entry forever without delivering.
          if (!(fresh[id] && typeof fresh[id].resumeFrom === "number")) videoLocked.add(id);
          if (!(fresh[id] && fresh[id].done)) {
            fresh[id] = { done: true, at: Date.now(), via: "dom" };
            await setLocal({ videoSentThreads: fresh });
          }
          vstat("skip after delay — video appeared meanwhile (" + (name || id) + ")");
          console.debug("[SubSell] video: skip after delay — chat already has a video", id);
          return;
        }
      }

      // A clip that fails to LOAD 3 times GLOBALLY (any chat) is excluded from the
      // set instead of blocking it: one oversized/broken upload in the dashboard used
      // to fail the complete-set rule on EVERY chat = "no videos at all". The
      // remaining clips still ship, and the popup names the bad one.
      const STRIKE_TTL = 6 * 3600 * 1000; // an excluded URL is re-probed after this
      const urlFails = (await getLocal(["videoUrlFails"])).videoUrlFails || {};
      const strikeN = (e) => (typeof e === "number" ? e : (e && e.n) || 0);   // legacy numeric = {n:value, at:0}
      const strikeAt = (e) => (typeof e === "number" ? 0 : (e && e.at) || 0);
      let urlFailsChanged = false;
      for (const u of Object.keys(urlFails)) {
        if (strikeN(urlFails[u]) >= 3 && now - strikeAt(urlFails[u]) > STRIKE_TTL) {
          delete urlFails[u]; // ban expired — the URL re-enters the set and is re-probed this pass
          urlFailsChanged = true;
        }
      }
      const activeCentral = central.filter((v) => strikeN(urlFails[v.url]) < 3);
      const excluded = central.length - activeCentral.length;
      if (excluded > 0 && activeCentral.length) vstat("⚠ " + excluded + " dashboard clip(s) can't load (too big/broken?) — sending the rest");

      // Build the ordered File list (local first, then central downloaded via background),
      // plus the parallel list of on-disk paths for the Chrome file API (null = none).
      const files = [];
      const paths = [];
      for (const v of local) {
        try {
          files.push(dataUrlToFile(v.dataUrl, v.name, v.type));
          paths.push(await diskPathFor({ dataUrl: v.dataUrl, name: v.name }));
        } catch (e) {
          /* skip a bad local video */
        }
      }
      for (const v of activeCentral) {
        let ok = false;
        try {
          // ON-DISK FIRST (v0.21.38): with the file API on, the clip's path is all
          // the attach needs — hauling 10-30 MB of base64 per clip through the
          // message channel before the first attach was seconds of "instant"
          // lost on every visit. The File is loaded LAZILY, only if a synthetic
          // strategy ever runs for this clip.
          const p = cdpAvailable() ? await diskPathFor({ url: v.url, name: v.name }) : null;
          if (p) {
            const load = async () => {
              const r = await ask({ type: "FETCH_VIDEO", url: v.url });
              if (!(r && r.ok && r.base64)) return null;
              const mime = r.mime || "video/mp4";
              return dataUrlToFile(`data:${mime};base64,${r.base64}`, v.name || "video.mp4", mime);
            };
            files.push({ lazy: true, name: v.name || "video.mp4", load });
            paths.push(p);
            ok = true;
          } else {
            const r = await ask({ type: "FETCH_VIDEO", url: v.url });
            if (r && r.ok && r.base64) {
              const mime = r.mime || "video/mp4";
              files.push(dataUrlToFile(`data:${mime};base64,${r.base64}`, v.name || "video.mp4", mime));
              paths.push(null);
              ok = true;
            }
          }
        } catch (e) {
          /* fall through to failure accounting */
        }
        if (ok) {
          if (urlFails[v.url]) { delete urlFails[v.url]; urlFailsChanged = true; }
        } else {
          // (v0.21.40) keep the slot: indices stay aligned with the configured
          // set, the loop sends the clips BEFORE this one and resumes here later.
          files.push(null);
          paths.push(null);
          urlFails[v.url] = { n: strikeN(urlFails[v.url]) + 1, at: Date.now() };
          urlFailsChanged = true;
        }
      }
      if (urlFailsChanged) {
        await setLocal({ videoUrlFails: urlFails });
        // Fires only on the TRANSITION into full lockout (some clips were active at
        // the start of this pass, and now every URL is struck out) — one dashboard row.
        if (activeCentral.length > 0 && central.length > 0 && central.every((v) => strikeN(urlFails[v.url]) >= 3)) {
          ask({ type: "LOG_EVENT", entry: { thread: "(system)", threadId: "", buyer: "(system)", action: "video-status", reply: "all " + central.length + " dashboard clip(s) failing to DOWNLOAD on this machine (network/proxy?) — re-probing in 6h; replies unaffected" } });
        }
      }

      // SEND WHAT LOADED (v0.21.40, operator: "send any video you can, you don't
      // need all to send"). The old rule held the WHOLE set until every clip had
      // loaded — one slow download meant no video at all. Now a clip that can't
      // load right now is a `null` slot: the clips before it go out on this visit,
      // the loop stops at the slot with a resume marker (that clip is re-tried on
      // the next visit, not skipped), and only a set whose NEXT DUE clip is
      // missing waits (short backoff + pending queue).
      const expected = files.length;
      const loadedN = files.filter(Boolean).length;
      const firstMissing = files.findIndex((f) => !f);
      const nextDue = resumeFrom != null ? Math.min(resumeFrom, files.length) : 0;
      if (!files.length || (nextDue < files.length && !files[nextDue])) {
        await recordVideoFail(id, "load");
        const allBlocked = central.length > 0 && !activeCentral.length;
        const msg = allBlocked
          ? "⚠ all " + central.length + " dashboard clip(s) failing to DOWNLOAD on this machine (network/proxy?) — replies unaffected, re-probing in 6h"
          : "loaded " + loadedN + "/" + expected + " clip(s), clip " + (nextDue + 1) + " not yet — retrying in a few minutes (" + (name || id) + ")";
        vstat(msg);
        setStatus({ lastError: "video: " + msg, currentThread: name });
        // Queue the retry explicitly (pending lane, honored after the short backoff).
        {
          const qkL = sidebarKey || id;
          const dnL = (cfg.videoSentThreads || {})[id];
          const doneL = !!(dnL && dnL.done && typeof dnL.resumeFrom !== "number");
          if (qkL && !doneL && videoPending[qkL] == null && videoPending[id] == null) { videoPending[qkL] = Date.now(); persistDedup(); }
        }
        return;
      }
      {
        const laterMissing = files.findIndex((f, k) => k > nextDue && !f);
        if (laterMissing >= 0) vstat("clip " + (laterMissing + 1) + " can't load right now — sending the others first (" + (name || id) + ")");
      }
      void firstMissing;

      // Resume-tail is an INDEX into `files`. With strike decay the active set can
      // GROW between visits (a revived URL slots in earlier), so replaying the index
      // could REPEAT an already-delivered clip. Resume only against the exact same
      // set size it was recorded with; otherwise drop the tail (never resend).
      if (resumeFrom != null && !(done[id] && done[id].resumeTotal === files.length)) {
        videoLocked.add(id);
        clearPend();
        const dm0 = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        // via:"taildrop" + resumeTotal ⇒ catch-up treats it as confirmed (head clips
        // WERE attempted — must never re-queue) and the self-heals never touch it.
        dm0[id] = { done: true, at: Date.now(), via: "taildrop", resumeTotal: typeof done[id].resumeTotal === "number" ? done[id].resumeTotal : 0 };
        await setLocal({ videoSentThreads: dm0 });
        vstat("resume tail dropped — clip set changed since interruption (" + (name || id) + ")");
        return;
      }

      // RE-VERIFY the claim right before locking: the pre-lock phase (first-video
      // delay + clip downloads) can outlive the 3-min claim TTL on slow machines,
      // and a second tab may have legitimately claimed over a stale one. Losing
      // the claim here = the other pass owns this chat — bow out with no writes.
      {
        const amV = (await getLocal(["videoAttempts"])).videoAttempts || {};
        const curV = amV[id];
        if (curV && curV.claimTab && curV.claimTab !== TAB_UID && curV.claimAt && Date.now() - curV.claimAt < VIDEO_CLAIM_TTL) {
          vstat("claim lost during the pre-send wait — another pass owns " + (name || id));
          return;
        }
        amV[id] = Object.assign({}, curV, { claimAt: Date.now(), claimTab: TAB_UID });
        await setLocal({ videoAttempts: amV });
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
      clearPend(); // committed to sending — off the pending queue (both keys)
      {
        const dm = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        // via:"lock": tag the pre-send lock so a crash mid-send is detectable later
        // (the tag is overwritten by the mid-set/undo/final stamps on normal flow).
        const priorRecon = dm[id] && dm[id].recon ? 1 : 0;
        dm[id] = { done: true, at: Date.now(), via: "lock", owner: TAB_UID };
        if (priorRecon) dm[id].recon = 1;
        // On a RESUME visit, carry the marker's fields through the lock: a crash
        // between this write and the first tail attach used to degrade the mark to
        // a bare lock — heal (i) could then wrongly clear it (its "no sent means
        // nothing attached" premise is false here) and re-send the HEAD clips.
        // With sent/resumeFrom preserved, a crash in this window simply resumes.
        if (resumeFrom != null) {
          if (done[id] && done[id].sent) dm[id].sent = done[id].sent;
          dm[id].resumeFrom = Math.min(resumeFrom, files.length);
          dm[id].resumeTotal = files.length;
        }
        const am = (await getLocal(["videoAttempts"])).videoAttempts || {};
        // Keep the FAIL history through the send attempt (drop only the claim):
        // deleting the whole entry here reset `fails` to 0 on every retry visit,
        // so the 3-strikes/24h attach pause could never actually trigger — chats
        // with a flaky clip retried every 20 min forever (both diagnostics showed
        // pausedAttach=0 despite repeated attach failures).
        if (am[id] && am[id].fails) am[id] = { fails: am[id].fails, failAt: am[id].failAt, why: am[id].why };
        else delete am[id];
        await setLocal({ videoSentThreads: dm, videoAttempts: am });
      }
      const startAt = resumeFrom != null ? Math.min(resumeFrom, files.length) : 0;
      console.debug("[SubSell] video: LOCKED chat + sending clips " + (startAt + 1) + "–" + files.length + " to", id);

      // ONE-MESSAGE DELIVERY: attach every clip back-to-back (each verified),
      // then a single Enter sends the whole set as ONE message. A clip that
      // provably fails to attach stops the set with a resume marker; whatever
      // is already in the tray still goes out with the one send.
      // A previous visit's LATE-rendered tile is restored with the chat's draft a
      // beat after the chat opens: look for it before deciding the tray is clean.
      {
        const tW = Date.now();
        while (Date.now() - tW < 2500 && trayRemoveBtns().length === 0) await sleep(500);
      }
      if (startAt === 0 && trayRemoveBtns().length > 0) {
        await sweepTrayExtras(0); // fresh run: stale strays out before we stack clips
      }
      // Resume runs ADOPT a leftover unsent preview (a crashed run's attached
      // clip, or the tile of a clip the file API staged that rendered after we
      // left) as known-good — it rides the first Enter, finally delivered. The
      // streaming engine keeps at most ONE clip in flight per chat, so more than
      // one leftover is a pile of copies: keep the newest (tail), trim the rest.
      if (startAt > 0 && trayRemoveBtns().length > 1) {
        for (let pass = 0; pass < 3 && trayRemoveBtns().length > 1; pass++) {
          safe(() => trayRemoveBtns()[0].click());
          await sleep(2000);
        }
        if (trayRemoveBtns().length > 1) {
          // Skip this visit, but leave the chat RESUMABLE: the lock stamp above
          // (via:"lock", fresh `at`) would read as "set in progress" for 30 min,
          // and clearPend() already dropped the pending entry — rewrite a plain
          // resume marker and re-queue (the pending lane retries it, paced).
          const dmK = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (!(dmK[id] && dmK[id].owner && dmK[id].owner !== TAB_UID)) {
            dmK[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: startAt, resumeTotal: files.length, sent: startAt };
            await setLocal({ videoSentThreads: dmK });
          }
          videoLocked.delete(id);
          {
            const qkK = sidebarKey || id;
            if (qkK && videoPending[qkK] == null && videoPending[id] == null) { videoPending[qkK] = Date.now(); persistDedup(); }
          }
          vstat("tray holds " + trayRemoveBtns().length + " stuck previews — skipping this visit (" + (name || id) + ")");
          return;
        }
      }
      let knownCount = trayRemoveBtns().length;
      let okCount = 0;
      let failedAt = -1;    // first clip whose attach provably failed (tray verified clean → re-attempt allowed)
      let dirtyStop = false; // a clip whose attach is UNCONFIRMED — must never be re-attempted
      // STREAMING DELIVERY (v0.21.34, operator: "send whatever can send"): in the
      // one-by-one path each clip is SENT the moment its own upload finishes,
      // instead of being held until the whole set is attached. On builds where
      // Facebook rejects a paste while a previous clip is still uploading (this
      // fleet: every set showed bulk:0 + ~60s per clip) the old hold meant ~4
      // minutes of nothing, then everything at once — and the text reply waited
      // just as long. Now: clip 1 out in ~30s, the reply right behind it (via
      // hooks.onClipSent), clips 2..N streaming after, and between clips the
      // engine YIELDS whenever another buyer is waiting (the tail resumes via
      // the pending lane — a postponement, never a loss). The bulk fast path
      // (all clips landed in one paste) still sends as one message.
      const streaming = !deferSend;
      let streamedCount = 0;
      // Park the un-sent tail (resume marker + pending queue) — shared by the
      // navigation and yield exits of the streaming path.
      const parkTail = async (nextIdx, statusLine) => {
        const dmPk = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (dmPk[id] && dmPk[id].owner && dmPk[id].owner !== TAB_UID) return; // taken over — its stamps govern
        dmPk[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: nextIdx, resumeTotal: files.length, sent: okCount + startAt };
        await setLocal({ videoSentThreads: dmPk });
        videoLocked.delete(id); // the finishing visit must pass the in-memory guard
        const qkPk = sidebarKey || id;
        if (qkPk && videoPending[qkPk] == null && videoPending[id] == null) { videoPending[qkPk] = Date.now(); persistDedup(); }
        setStatus({ lastAction: statusLine, currentThread: name });
      };

      // FAST PATH: hand the whole remaining set over in ONE paste so Facebook
      // uploads the clips in PARALLEL (a human dragging 3 files at once). This
      // is where the old 30-60s went — serialized uploads plus a settle wait
      // between each. Nothing is SENT until the final Enter, so if the bulk
      // paste lands only partially we can simply clear the tray and fall back
      // to the verified one-by-one path: zero duplicate risk either way.
      let bulkDone = false;
      cdpSetToken++; // new set: a file-API miss inside it skips the file API for its remaining clips only
      // FILE API ⇒ STREAM ONE CLIP AT A TIME (v0.21.38, operator: "send whatever
      // you can, don't wait for all"): no multi-file set — clip 1 is on its way
      // in seconds, the reply rides right behind it, and at most one clip is ever
      // in flight per chat (the property that makes late tiles adoptable instead
      // of a pile). The synthetic multi-paste below stays for machines without it.
      // (the run covers the loadable clips from startAt up to the first missing
      // slot AT OR AFTER it — a missing slot before startAt was already delivered)
      const firstMissingFromStart = files.findIndex((f, k) => k >= startAt && !f);
      const runEnd = firstMissingFromStart >= 0 ? firstMissingFromStart : files.length;
      const cdpPerClip = cdpUsableNow() && runEnd > startAt && paths.slice(startAt, runEnd).every(Boolean);
      let bulkFiles = null;
      if (!cdpPerClip && runEnd - startAt > 1) {
        bulkFiles = [];
        for (let k = startAt; k < runEnd; k++) {
          const f = files[k];
          let real = f;
          if (f && f.lazy) { try { real = await f.load(); } catch (e) { real = null; } }
          if (!real) { bulkFiles = null; break; } // can't load one → one-by-one handles it
          files[k] = real; // keep the loaded File — the one-by-one fallback must not reload it
          bulkFiles.push(real);
        }
      }
      if (bulkFiles) {
        const rest = bulkFiles;
        const bulk = await attachVideosBulk(rest, id, paths.slice(startAt));
        safe(() => chrome.storage.local.get(["videoAttachTrace"], (rB) => {
          if (chrome.runtime.lastError) return;
          const tr = (rB && rB.videoAttachTrace) || [];
          tr.push({ at: Date.now(), clip: 0, of: rest.length, res: "bulk:" + String(bulk), tray: trayRemoveBtns().length, up: trayUploads() });
          while (tr.length > 12) tr.shift();
          chrome.storage.local.set({ videoAttachTrace: tr }, () => void chrome.runtime.lastError);
        }));
        if (bulk === "navigated") {
          const dmB2 = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (dmB2[id] && dmB2[id].owner && dmB2[id].owner !== TAB_UID) return;
          dmB2[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: startAt, resumeTotal: files.length, sent: startAt };
          await setLocal({ videoSentThreads: dmB2 });
          videoLocked.delete(id);
          {
            const qkB2 = sidebarKey || id;
            if (qkB2 && videoPending[qkB2] == null && videoPending[id] == null) { videoPending[qkB2] = Date.now(); persistDedup(); }
          }
          setStatus({ lastAction: "video set interrupted (chat switched) — finishing later", currentThread: name });
          return;
        }
        if (typeof bulk === "number" && bulk >= rest.length && runEnd === files.length) {
          okCount = rest.length;
          // Belt-and-suspenders: never let a surplus preview (any source) ride the
          // single Enter — extras always append at the TAIL, same rule as sweepTrayExtras.
          {
            const expect = knownCount + rest.length;
            if (trayRemoveBtns().length > expect) await sweepTrayExtras(expect);
          }
          knownCount = trayRemoveBtns().length;
          bulkDone = true;
          const dmB = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (dmB[id] && dmB[id].owner && dmB[id].owner !== TAB_UID) return;
          dmB[id] = { done: true, at: Date.now(), via: "lock", owner: TAB_UID, sent: okCount + startAt, resumeFrom: files.length, resumeTotal: files.length };
          await setLocal({ videoSentThreads: dmB });
          setStatus({ lastAction: `${okCount} video(s) attached together`, currentThread: name });
        } else if (trayRemoveBtns().length > knownCount) {
          await sweepTrayExtras(knownCount); // partial/none: reset (nothing sent yet) and verify one by one
        }
      }

      let loadStop = false; // the loop stopped at a clip that could not be loaded (re-tried later, never skipped)
      for (let i = bulkDone ? files.length : startAt; i < files.length; i++) {
        if (!files[i]) {
          // Not loadable right now: everything before it is out (or going out);
          // resume exactly here on a later visit. No pre-attempt stamp — the
          // clip was never touched.
          loadStop = true;
          failedAt = i;
          break;
        }
        // Navigation abort: NOTHING has been sent yet (send is one Enter at the
        // end) and Enter must never fire after the operator switched chats.
        // Clips already attached are recorded as attempted (if Messenger kept
        // them as a draft they'd double-send on a re-attempt); the tail resumes
        // on a later visit.
        if (!stillOnThread(id)) {
          console.debug("[SubSell] video: stopped mid-set at clip", i + 1, "— will finish on a later visit", id);
          const dm2 = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (dm2[id] && dm2[id].owner && dm2[id].owner !== TAB_UID) return; // taken over — its stamps govern
          dm2[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: i, resumeTotal: files.length, sent: okCount + startAt };
          await setLocal({ videoSentThreads: dm2 });
          videoLocked.delete(id); // allow the resume visit through the in-memory guard
          // Queue the finish explicitly: waiting for an organic revisit left tails
          // sitting for hours (both machine diagnostics showed exactly this).
          {
            const qk2 = sidebarKey || id;
            if (qk2 && videoPending[qk2] == null && videoPending[id] == null) { videoPending[qk2] = Date.now(); persistDedup(); }
          }
          setStatus({ lastAction: `video set paused at ${i}/${files.length} — finishing later`, currentThread: name });
          return;
        }
        {
          // TAKEOVER check: if another pass lock-stamped this chat (its `owner`),
          // bow out silently — the new owner resumes strictly AFTER our last
          // stamped clip, so nothing double-sends and nothing is skipped.
          const curM = ((await getLocal(["videoSentThreads"])).videoSentThreads || {})[id];
          if (curM && curM.owner && curM.owner !== TAB_UID) {
            console.debug("[SubSell] video: another pass took over this set — bowing out", id);
            return;
          }
          // PRE-ATTEMPT stamp: exclude the CURRENT clip from any future resume
          // BEFORE touching it — a crash anywhere inside the attempt (even after
          // Enter fired) can then never re-send it. This keeps the original
          // "attempted clips never repeat" law under the new resume machinery;
          // the cost is the old accepted trade (a crashed attempt's clip may be
          // missed, never duplicated). Also refreshes `at` (the in-flight signal)
          // and stamps ownership for the takeover check above.
          const dmA = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          dmA[id] = { done: true, at: Date.now(), via: "lock", owner: TAB_UID, sent: okCount + startAt, resumeFrom: i + 1, resumeTotal: files.length };
          await setLocal({ videoSentThreads: dmA });
        }
        setStatus({ lastAction: `attaching video ${i + 1}/${files.length}…`, currentThread: name });
        let res = await attachVideo(files[i], knownCount, id, paths[i]);
        const resVia = lastAttachVia;
        const resTrace = res === true ? "ok" : String(res);
        // ATTACH TRACE (ring of 12, shown in 🩺): which clip, what verdict, how
        // the tray looked — ends the guessing when a machine's attaches fail.
        safe(() => chrome.storage.local.get(["videoAttachTrace"], (rT) => {
          if (chrome.runtime.lastError) return;
          const tr = (rT && rT.videoAttachTrace) || [];
          tr.push({ at: Date.now(), clip: i + 1, of: files.length, res: resTrace + (resVia && resVia !== "-" ? "/" + resVia : ""), tray: trayRemoveBtns().length, up: trayUploads() });
          while (tr.length > 12) tr.shift();
          chrome.storage.local.set({ videoAttachTrace: tr }, () => void chrome.runtime.lastError);
        }));
        if (res === "navigated") {
          // Mid-attach navigation: clip i counts as ATTEMPTED (its paste may have
          // landed somewhere unverifiable — re-attempting could double-send);
          // clips already attached stay in this chat's draft and are ADOPTED by
          // the queued resume visit if Messenger kept them. Nothing is sent now.
          const dmN = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (dmN[id] && dmN[id].owner && dmN[id].owner !== TAB_UID) return;
          dmN[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: i + 1, resumeTotal: files.length, sent: okCount + startAt };
          await setLocal({ videoSentThreads: dmN });
          videoLocked.delete(id);
          {
            const qkN = sidebarKey || id;
            if (qkN && videoPending[qkN] == null && videoPending[id] == null) { videoPending[qkN] = Date.now(); persistDedup(); }
          }
          setStatus({ lastAction: "video set interrupted (chat switched) — finishing later", currentThread: name });
          return;
        }
        if (res === true || res === "blind") {
          okCount++;
          // Count-based, +1 exactly: re-snapshotting the whole tray here would
          // absorb an undetected stray copy into the "known-good" set and let it
          // ride the Enter as a duplicate.
          knownCount += 1;
          // Progress stamp: the attached count is recorded IMMEDIATELY, so a
          // mid-set death can never look like "nothing sent" and get re-queued.
          // Never clobber a takeover: if another pass owns the mark now, bow out
          // WITHOUT stamping — it resumed after our last stamped clip, so this
          // clip is excluded from its run (undercounted, never re-sent).
          const dmP2 = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (dmP2[id] && dmP2[id].owner && dmP2[id].owner !== TAB_UID) return;
          dmP2[id] = { done: true, at: Date.now(), via: "lock", owner: TAB_UID, sent: okCount + startAt, resumeFrom: i + 1, resumeTotal: files.length };
          await setLocal({ videoSentThreads: dmP2 });
          if (streaming) {
            if (res === "blind") {
              // The composer says staged: give the tile up to 20 s more — once it
              // is visible the normal upload-settled, exact-count send applies.
              const tV = Date.now();
              while (Date.now() - tV < 20000 && trayEls().length === 0) {
                if (!stillOnThread(id)) break;
                await sleep(1000);
              }
              if (trayEls().length > 0) res = true;
            }
            // Let THIS clip's upload finish (Enter mid-upload is queued by FB, but
            // a finished upload sends instantly and leaves the tray empty for the
            // next paste — which is also what makes the next attach land on the
            // first try instead of being rejected mid-upload).
            const upS = Date.now();
            while (res === true && Date.now() - upS < 75000 && trayUploads() > 0) {
              if (!stillOnThread(id)) break;
              await sleep(1000);
            }
            if (!stillOnThread(id)) {
              await parkTail(i + 1, `video set paused at ${i}/${files.length} (chat switched) — finishing later`);
              return;
            }
            // EXACTLY ONE MESSAGE'S WORTH before Enter (v0.21.38): known head + this
            // clip. A surplus tile is an earlier attempt's late copy — trimmed; if
            // it won't go, nothing is sent (the clip counts as attempted and the
            // set stops here rather than posting a pile — the PC-mnbbd tray7 case).
            if (res === true && !(await trimTraySurplus(knownCount))) {
              okCount--;
              dirtyStop = true;
              failedAt = i;
              // Empty the tray entirely before leaving: the text reply that
              // follows this visit presses Enter in the same composer, and a
              // staged pile would ride it. Losing our own copy is the safe side
              // (this clip is stamped attempted; the set resumes after it).
              await sweepTrayExtras(0);
              vstat("tray holds extra previews that won't clear — not sending a pile (" + (name || id) + ")");
              break;
            }
            if (res === "blind" && composerText(findComposer())) {
              // The operator started typing here: their Enter will carry the
              // staged clip; ours must not ship their half-typed text.
              await parkTail(i + 1, `video set paused at ${i}/${files.length} (you are typing) — finishing later`);
              return;
            }
            setStatus({ lastAction: `sending video ${i + 1}/${files.length}…`, currentThread: name });
            await sendAttachedVideos(res === "blind" ? lastAttachCtlBase : null, id);
            streamedCount++;
            // Normally 0 now. A late stray is REMOVED here (never adopted into the
            // next message); only an unremovable tile is carried as known.
            knownCount = await settleTrayAfterSend(id);
            refreshThreadLock(sidebarKey || id); // uploads outlive the cross-tab lease
            if (hooks && typeof hooks.onClipSent === "function") {
              // Interleave the TEXT reply right after the first clip (the reply
              // path honors its own delay clock and reports its own errors).
              try { await hooks.onClipSent(i); } catch (e) { /* never break the set */ }
              if (!stillOnThread(id)) {
                await parkTail(i + 1, `video set paused at ${i + 1}/${files.length} (chat switched) — finishing later`);
                return;
              }
            }
            if (i + 1 < files.length && buyersWaitingNow(id, sidebarKey)) {
              // YIELD: someone else is waiting for a reply. Their answer outranks
              // this chat's remaining clips — the tail is queued (pending lane,
              // guaranteed delivery), not dropped, and no failure is recorded.
              await parkTail(i + 1, `${okCount + startAt}/${files.length} videos sent — pausing for a waiting buyer, finishing later`);
              vstat("sent " + (okCount + startAt) + "/" + files.length + " — yielded to a waiting buyer, finishing later (" + (name || id) + ")");
              ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: (okCount + startAt) + "/" + files.length + " demo videos sent — finishing the rest after a waiting buyer" } });
              return;
            }
          }
        } else if (res === "dirty" || res === "unverified") {
          // Attach unconfirmed AND the tray couldn't be verified clean ("dirty"),
          // or the browser accepted a file-API set that showed nothing yet
          // ("unverified" — a late tile is possible, and the resume visit adopts
          // it): treat the clip as attempted (the pre-attempt stamp already
          // excludes it) and stop — never dispatch a second copy.
          dirtyStop = true;
          failedAt = i;
          if (res === "unverified") {
            // FLUSH: if the clip IS staged invisibly, one Enter on the (text-empty)
            // composer sends it — delivered instead of lost, and consistent with
            // the skip-forward stamp; on a truly empty composer Enter is a no-op.
            const cF = findComposer();
            if (cF && stillOnThread(id) && !composerText(cF)) pressEnter(cF);
            vstat("clip " + (i + 1) + " handed to the composer but nothing showed — finishing later, never twice (" + (name || id) + ")");
          }
          break;
        } else {
          // attachVideo=false ⇒ no new preview appeared AND extras were cleaned ⇒
          // nothing of this clip can ride the send — re-attempting it later
          // cannot duplicate.
          failedAt = i;
          break;
        }
      }
      // THE ONE SEND: everything attached (new clips + any adopted leftovers)
      // goes out with a single Enter. Never pressed on an empty tray, and never
      // after navigation — and a navigation-blocked send must NEVER fall through
      // to the terminal "sent ✓" stamp (that would record a full set the buyer
      // never received). The attached draft is adopted by the queued resume
      // visit if Messenger kept it.
      const attachedNow = trayRemoveBtns().length;
      // Streamed clips already went out one by one — nothing is held for a final Enter.
      const wantSend = streamedCount > 0 ? false : (okCount > 0 || (startAt > 0 && attachedNow > 0));
      if (wantSend && !stillOnThread(id)) {
        const dmB = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (!(dmB[id] && dmB[id].owner && dmB[id].owner !== TAB_UID)) {
          dmB[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: failedAt >= 0 ? (dirtyStop ? failedAt + 1 : failedAt) : files.length, resumeTotal: files.length, sent: okCount + startAt };
          await setLocal({ videoSentThreads: dmB });
        }
        videoLocked.delete(id);
        {
          const qkB = sidebarKey || id;
          if (qkB && videoPending[qkB] == null && videoPending[id] == null) { videoPending[qkB] = Date.now(); persistDedup(); }
        }
        vstat("set attached but chat switched before the send — finishing on a later visit (" + (name || id) + ")");
        setStatus({ lastAction: "video send postponed (chat switched) — finishing later", currentThread: name });
        return;
      }
      // Tray/bookkeeping mismatch = something attached or vanished that we can't
      // explain — send what's there, but never RE-ATTEMPT ambiguous clips
      // (skip-forward), the duplicate-safe direction.
      const trayMismatch = wantSend && attachedNow !== knownCount;
      if (wantSend && deferSend) {
        // COMBINED-MESSAGE MODE: leave the set STAGED — the caller types the text
        // reply into the same composer and ONE Enter ships videos + text together.
        // CRITICAL: nothing has been sent yet, so NO terminal stamp, NO "sent ✓"
        // status and NO Activity row here — those fire in
        // finalizeDeferredVideoSend() only after an Enter actually goes. The mark
        // becomes an owned DRAFT (resumeFrom = resumeTotal = full set attached):
        // if this visit is abandoned, the queued pending visit adopts the draft
        // and ships it through the normal send path.
        videoSendDeferred = true;
        {
          const dmD = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          if (!(dmD[id] && dmD[id].owner && dmD[id].owner !== TAB_UID)) {
            dmD[id] = {
              done: true, at: Date.now(), via: "lock", owner: TAB_UID, sent: okCount + startAt,
              // Partial attach: the tail stays resumable (same skip-forward rules
              // as the normal partial branch); full attach: resumeFrom = total.
              resumeFrom: failedAt >= 0 ? ((dirtyStop || trayMismatch) ? failedAt + 1 : failedAt) : files.length,
              resumeTotal: files.length,
            };
            await setLocal({ videoSentThreads: dmD });
          }
        }
        videoLocked.delete(id); // DRAFT is not terminal — finalize re-locks
        {
          const qkD = sidebarKey || id;
          if (qkD && videoPending[qkD] == null && videoPending[id] == null) { videoPending[qkD] = Date.now(); persistDedup(); }
        }
        setStatus({ lastAction: `${Math.max(attachedNow, okCount)} video(s) staged — sending with the reply…`, currentThread: name });
        return;
      }
      if (wantSend) {
        setStatus({ lastAction: `sending ${Math.max(attachedNow, okCount)} video(s) in one message…`, currentThread: name });
        await sendAttachedVideos();
      }
      if (okCount === 0 && startAt === 0 && !dirtyStop) {
        // NOTHING attached in this whole run, with the tray VERIFIED CLEAN. Attach
        // detection is preview-based — no preview ever appeared, so nothing can
        // possibly have been sent. It is therefore SAFE to undo the lock and let
        // the chat retry later (with the normal 3-try/24h backoff) instead of
        // burning it forever at 0 videos. (A dirty stop is NOT safe to undo — the
        // resume marker written below skips the unverifiable clip instead.)
        videoLocked.delete(id);
        const undo = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (undo[id] && undo[id].done && !undo[id].sent) {
          delete undo[id];
          await setLocal({ videoSentThreads: undo });
        }
        await recordVideoFail(id, "attach");
        // Fleet-visible breadcrumb, max one per 24h per machine (state-change only):
        // an attach-stage failure means this account's FB upload UI needs attention.
        const thrAt = (await getLocal(["videoAttachFailLoggedAt"])).videoAttachFailLoggedAt || 0;
        if (Date.now() - thrAt > 24 * 3600 * 1000) {
          await setLocal({ videoAttachFailLoggedAt: Date.now() }); // written BEFORE posting so two tabs can't double-log
          ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(video attach failure)", action: "video-status", reply: "0/" + files.length + " attached — all 3 attach strategies failed; FB upload UI may have changed on this machine" } });
        }
        // Queue the retry EXPLICITLY (pending lane, honored after the 20-min
        // backoff) — waiting for an organic idle revisit left "0 attached" chats
        // without their videos for days on busy machines.
        {
          const qk0 = sidebarKey || id;
          if (qk0 && videoPending[qk0] == null && videoPending[id] == null) { videoPending[qk0] = Date.now(); persistDedup(); }
        }
        vstat("⚠ 0/" + files.length + " attached in " + (name || id) + " — unlocked for retry (FB upload UI may have changed)");
        setStatus({ lastError: "video: nothing attached — will retry later", currentThread: name });
        return;
      }
      if (failedAt >= 0) {
        // PARTIAL set (some clips delivered, or a resume tail that attached 0):
        // record the exact tail and finish on a later, paced visit. Previously a
        // failed resume tail fell through to the terminal stamp — the mark burned
        // to {done, sent:2} forever and logged "0 demo video(s) sent" (machine
        // PC-o9ppb's whole sidebar was sent2 for exactly this reason).
        // A CLEAN failure re-attempts the failed clip (provably nothing attached);
        // a DIRTY one skips it forever (attach unverifiable — never risk a dup).
        {
          const chk = ((await getLocal(["videoSentThreads"])).videoSentThreads || {})[id];
          if (chk && chk.owner && chk.owner !== TAB_UID) return; // taken over — its stamps govern
        }
        const resumeAtF = (dirtyStop || trayMismatch) ? failedAt + 1 : failedAt;
        if (resumeAtF >= files.length) {
          // Nothing left to resume (dirty on the LAST clip) — terminal-stamp what
          // was actually delivered; the unverifiable tail clip is dropped (the
          // long-standing "never repeat an attempted clip" trade). resumeTotal
          // marks the stamp as protocol-confirmed so the catch-up arm keeps it
          // even when sent is 0 (single-clip dirty case).
          const dmT = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          dmT[id] = { done: true, at: Date.now(), owner: TAB_UID, sent: okCount + startAt, resumeTotal: files.length };
          await setLocal({ videoSentThreads: dmT });
          vstat("sent " + (okCount + startAt) + "/" + files.length + " — last clip unverifiable, dropped to stay duplicate-safe (" + (name || id) + ")");
          if (okCount > 0) ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: (okCount + startAt) + "/" + files.length + " demo video(s) sent" } });
          return;
        }
        const dmF = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        dmF[id] = { done: true, at: Date.now(), owner: TAB_UID, resumeFrom: resumeAtF, resumeTotal: files.length, sent: okCount + startAt };
        await setLocal({ videoSentThreads: dmF });
        videoLocked.delete(id); // the finishing visit must pass the in-memory guard
        await recordVideoFail(id, loadStop ? "load" : "attach"); // short backoff only (v0.21.40)
        {
          const qkF = sidebarKey || id;
          if (qkF && videoPending[qkF] == null && videoPending[id] == null) { videoPending[qkF] = Date.now(); persistDedup(); }
        }
        const whyF = loadStop ? "couldn't load yet" : "didn't attach";
        vstat("sent " + (okCount + startAt) + "/" + files.length + " — clip " + (failedAt + 1) + " " + whyF + "; finishing on a later visit (" + (name || id) + ")");
        setStatus({ lastError: "video: " + (okCount + startAt) + "/" + files.length + " sent, clip " + (failedAt + 1) + " " + whyF + " — will finish later", currentThread: name });
        if (okCount > 0) ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: (okCount + startAt) + "/" + files.length + " demo videos sent — finishing the rest on a later visit" } });
        return;
      }
      // Stamp the mark as a CONFIRMED send (sent count) so the backlog catch-up can
      // tell genuine sends from old ambiguous marks and never re-queues this chat.
      {
        const dmS = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        if (dmS[id] && dmS[id].owner && dmS[id].owner !== TAB_UID) return; // taken over — its stamps govern
        // `owner` stays on the terminal stamp: without it, a >30-min-stalled pass
        // that wakes AFTER another pass finished would see no owner, pass every
        // takeover check, and re-send the tail on top of the finished set.
        dmS[id] = { done: true, at: Date.now(), owner: TAB_UID, sent: okCount + startAt };
        const amS = (await getLocal(["videoAttempts"])).videoAttempts || {};
        if (amS[id]) delete amS[id]; // full set delivered — clean fail/claim slate
        await setLocal({ videoSentThreads: dmS, videoAttempts: amS });
      }
      vstat("sent ✓ " + (okCount + startAt) + "/" + files.length + " to " + (name || id));
      setStatus({ lastAction: `demo video(s) sent ✓ (${okCount + startAt}/${files.length})`, currentThread: name });
      // Mirror to the local + cloud activity log (fire-and-forget; no effect on sending).
      ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: "(demo video)", action: "video", reply: (okCount + startAt) + "/" + files.length + " demo video(s) sent" } });
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

      // Pre-call guard: reading the transcript and paying for an evaluation is
      // pointless (and would read the WRONG chat) if the operator has already
      // navigated away — the post-call guard below only threw the paid result out.
      if (!stillOnThread(id)) return;

      const transcript = fullTranscript();
      if (!transcript) return;
      // Billed-followup memo: a follow-up that was paid for but never delivered
      // (chat switch, missing composer, send failure) is replayed on the next
      // pass instead of re-billed — only while the chat transcript and the
      // settings are byte-identical; anything changed voids the memo.
      const fp = JSON.stringify(settings);
      const memoValid = !!(st.pendingText && st.pendingFor === transcript && st.pendingFp === fp);
      if (!memoValid && st.pendingText) { delete st.pendingText; delete st.pendingFor; delete st.pendingFp; }
      const r = await ask({ type: "GET_FOLLOWUP", context: transcript, threadName: name, pendingText: memoValid ? st.pendingText : undefined });
      if (!r || !r.ok) {
        setStatus({ lastError: "follow-up: " + (r && r.error), currentThread: name });
        return;
      }
      // Advance the clock: a SENT follow-up restarts it fully; a Claude [SKIP] only
      // pushes it HALF a period (a full reset meant a few skips = never following up).
      // TITLE-ECHO GUARD: the model occasionally echoes the thread label ("Svargood ·
      // S25 ultra S23 ultra…") as its whole answer — one machine SENT that to a
      // buyer as a "follow-up". A real follow-up never begins with the full
      // "Name · listing" label; treat an echo as a skip, never type it.
      const titleEcho = !!(r.text && name && normMsg(name).length >= 8 && normMsg(r.text).startsWith(normMsg(name)));
      const skipped = r.skip || !r.text || !r.text.trim() || titleEcho;
      st.lastAt = skipped ? now - Math.floor(thresholdMs / 2) : now;
      st.skips = skipped ? (st.skips || 0) + 1 : 0; // 3 in a row → skip-cap above stops the spend
      // Store the billed text BEFORE the send attempt — any abort below keeps it
      // for a free replay next pass. (A skip must not clear an existing memo.)
      if (!skipped) { st.pendingText = r.text; st.pendingFor = transcript; st.pendingFp = fp; }
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
        delete st.pendingText; delete st.pendingFor; delete st.pendingFp; // delivered
        store[id] = st;
        await setLocal({ followUpState: store });
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
    // Snippet ONLY — a stuck-lit dot on minimized windows is not evidence of a
    // waiting buyer (this fleet's dots never clear), and dot-triggered suspicious
    // rechecks tripled the latency of every queued-video delivery visit.
    const sidebarSaysBuyer = safe(() => snippetSuggestsBuyerLast(anchor), false);
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
      let headerHasName =
        label.length >= 2 &&
        safe(() => (((getMain() && getMain().innerText) || "").toLowerCase().indexOf(label.toLowerCase()) !== -1), false);
      let urlIdNow = urlId;
      if (!(urlIdNow && urlIdNow !== id && headerHasName)) {
        // SLOW-LOAD grace: on laggy Remote Desktop the URL/header can land seconds
        // after the 2s settle — scoring a "failed open" here was how real buyers
        // collected quarantine strikes. One more beat, then re-judge.
        await sleep(4000);
        if (location.href.includes(id)) {
          // it WAS just slow — fall through below as a normal successful open
          urlIdNow = id;
        } else {
          const m2 = safe(() => location.href.match(/\/t\/([^/?#]+)/), null);
          urlIdNow = m2 ? m2[1] : "";
          headerHasName =
            label.length >= 2 &&
            safe(() => (((getMain() && getMain().innerText) || "").toLowerCase().indexOf(label.toLowerCase()) !== -1), false);
        }
      }
      if (urlIdNow === id) {
        // late load — opened fine after all
      } else if (urlIdNow && urlIdNow !== id && headerHasName) {
        console.debug("[SubSell] thread id redirected", id, "->", urlIdNow, "— adopting");
        delete openFails[sidebarId];
        id = urlIdNow; // all state (dedup, caps, videos) now keys on the REAL id
        adoptedAlias[sidebarId] = id; // bridge sidebar-keyed lookups to the real id
        cooldowns[id] = Date.now() + COOLDOWN_MS; // mirror the entry cooldown
      } else {
        // QUARANTINE repeat offenders: a thread that keeps failing to open must not
        // eat scan cycles while real buyers (the next chats down) sit waiting.
        // ESCALATING parks (30 min → 6 h → 24 h): one diagnostic showed a thread at
        // 60 failed opens because the flat 30-min park barely slowed the retry loop.
        // Lanes 0/1/1.5 now honor this park (see pickTarget), so it actually holds.
        openFails[sidebarId] = { n: openFailCount(sidebarId) + 1, at: Date.now() };
        const nOF = openFails[sidebarId].n;
        if (nOF >= 3) {
          const parkMs = nOF >= 10 ? 24 * 3600 * 1000 : nOF >= 6 ? 6 * 3600 * 1000 : 30 * 60 * 1000;
          cooldowns[sidebarId] = Date.now() + parkMs;
          persistDedup();
          if (nOF === 6) {
            // Never park a possible buyer silently: one Activity row names the chat
            // so the operator can open it by hand on this machine.
            ask({ type: "LOG_EVENT", entry: { thread: name, threadId: sidebarId, buyer: "(system)", action: "video-status", reply: "a chat refuses to open (6+ tries) — open it by hand on this machine: " + (name || sidebarId) } });
          }
          setStatus({ lastError: "thread won't open (" + nOF + "×) — parked " + (parkMs >= 3600000 ? Math.round(parkMs / 3600000) + "h" : "30 min") + ": " + sidebarId });
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
    // SIDEBAR-CONFIRMED BUYER TURN (v0.21.34): the open-chat read defaults every
    // inconclusive bubble to "me" (the anti-self-reply law), and on some chats
    // (group-style threads, custom themes, media-heavy tails) that turned a REAL
    // buyer message into "you spoke last" three times → 6h suppression (a
    // diagnostic showed "Charles: How much? · 2h" and "Dreamliner: Le 13 pro ·
    // 12h" sitting unanswered exactly like that). When the sidebar row itself
    // attributes the last message to the buyer BY NAME and that same text is the
    // last bubble in the open chat, that bubble is the buyer's — answer it.
    let rescueHint = null; // the sidebar hint that produced `turn`, if any (the pre-send recheck re-runs it)
    if (!turn && sidebarSaysBuyer) {
      const hint = safe(() => sidebarSnippetBody(anchor), null);
      const confirmed = hint ? buyerSpokeLastConfirmed(hint) : null;
      if (confirmed) {
        turn = confirmed;
        rescueHint = hint;
        setStatus({ lastAction: "buyer message confirmed via sidebar attribution", currentThread: name });
      }
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
      // Three straight idle reads against a still-lit sidebar nudge: stop the
      // ledger from re-stamping this chat for a while, or lane 0 revisits it
      // every few minutes all day. A NEW buyer message clears through lane 1
      // (unread + buyer snippet) regardless of this suppression.
      if (sidebarSaysBuyer) {
        waitSuppress[id] = Date.now() + 6 * 3600 * 1000;
        waitSuppress[sidebarId] = waitSuppress[id];
      }
      cooldowns[id] = Date.now() + IDLE_COOLDOWN_MS;
      // You spoke last — nothing to reply to. But still: (1) send the demo video if
      // this chat never got one, and (2) consider a smart, capped follow-up if the
      // chat has been quiet long enough. Both are once/limited per chat — no spam.
      // A visit that DELIVERS a queued/deferred set honors demoVideoDelaySec
      // (immediate only on genuinely idle revisits) — "instant burst on open" fix.
      await maybeSendVideo(id, name, videoPending[id] == null && videoPending[sidebarId] == null, sidebarId);
      if (videoLocked.has(id)) clearVideoPending(sidebarId); // terminal → clear sidebar-keyed pending
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
    // Composite dedupe key (new writes) with backward compat for entries persisted
    // by older builds as the plain buyer text. The composite key lets a buyer who
    // REPEATS the same words later ("ok", "?") get answered again — the plain-text
    // key skipped them forever.
    if (lastHandled[id] === turn.dedupeKey || lastHandled[id] === turn.buyerMessage) {
      clearWaiting(id, sidebarId); // already answered this exact message
      // Audit fix: chats that keep landing here (our reply mis-read as not-last)
      // previously NEVER reached a video pass — give them one (idempotent).
      await maybeSendVideo(id, name, videoPending[id] == null && videoPending[sidebarId] == null, sidebarId);
      if (videoLocked.has(id)) clearVideoPending(sidebarId); // terminal → clear sidebar-keyed pending
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
      await maybeSendVideo(id, name, false, sidebarId);
      if (videoLocked.has(id)) clearVideoPending(sidebarId); // terminal → clear sidebar-keyed pending
      // COURTESY CLOSE at the cap — ZERO API cost. The operator's law is "every
      // message gets an answer"; going silent mid-conversation broke it. The
      // FIRST buyer message past the cap gets ONE canned, settings-built closing
      // line (no Claude call, so the cap still caps the spend); after that,
      // silence. replyCounts moves to cap+1 as the sent-once flag.
      if (repliesSoFar === replyCap && stillOnThread(id)) {
        const composerC = findComposer();
        if (composerC) {
          const closeLine =
            "Passe nous voir au shop quand tu veux — " +
            (settings.businessAddress || "757 Rue Beaubien E, Montréal") + ", " +
            (settings.businessHoursText || "9AM–10PM, 7 days") +
            " 😊 On va bien s'occuper de toi! (Come by anytime — we'll take care of you!)";
          const okC = await typeAndSend(composerC, closeLine);
          if (okC) {
            rememberSent(closeLine);
            lastHandled[id] = turn.dedupeKey;
            replyCounts[id] = replyCap + 1; // courtesy close sent once — never again
            persistDedup();
            ask({ type: "LOG_EVENT", entry: { thread: name, threadId: id, buyer: trunc(turn.buyerMessage, 120), action: "text", reply: closeLine } });
            setStatus({ lastAction: "cap reached — one-time courtesy close sent (no API cost)", lastReplySent: trunc(closeLine, 120), currentThread: name });
            return;
          }
        }
      }
      if ((settings.convoCapBehavior || "stop") === "notify") {
        setStatus({ lastAction: "needs you — reply cap reached (" + repliesSoFar + "/" + replyCap + "), buyer still messaging", currentThread: name });
      } else {
        setStatus({ lastAction: "skip — reply cap reached (" + repliesSoFar + "/" + replyCap + ") for this chat", currentThread: name });
      }
      return;
    }

    // VIDEOS-FIRST (v0.21.24, operator directive): the demo set goes out the
    // moment a buyer engages — BEFORE the text reply, with no first-video delay.
    // Rationale: the post-reply tail (delay → clips → gaps) was where every
    // timing bug lived; sending on a freshly-opened, settled chat is the most
    // reliable moment there is, and the buyer watching clips while the reply is
    // being written reads perfectly natural. All one-set-per-chat guards live
    // inside maybeSendVideo, so for an already-served chat this returns in
    // milliseconds. Costs nothing: zero extra API calls.
    setStatus({ lastAction: "buyer said: " + trunc(turn.buyerMessage, 80), currentThread: name });

    // Pre-call guard: if the operator already clicked into a different chat during
    // the load/settle window above, the Claude call's result would only be thrown
    // away later — don't pay for it. No state is touched (not marked handled,
    // still on the waiting ledger), so the chat is retried on a later cycle.
    if (!stillOnThread(id)) {
      setStatus({ lastAction: "aborted — you switched chats before asking Claude (will retry)", currentThread: name });
      return;
    }
    // Billed-reply memo: if a previous cycle already PAID for a reply to this exact
    // buyer message + transcript but the send was aborted (chat switch, send
    // failure), replay that text instead of billing an identical call again.
    const memo = pendingReply[id];
    const memoOk = !!(memo && memo.buyerMessage === turn.buyerMessage && memo.transcript === turn.transcript && Date.now() - memo.at < 10 * 60 * 1000);
    if (memo && !memoOk) delete pendingReply[id];

    // PARALLEL PIPELINE (v0.21.28) + STREAMING DELIVERY (v0.21.34):
    // The Claude call is FIRED here (not awaited) so the reply is generated
    // while clip 1 attaches. Then — instead of holding EVERYTHING until the
    // whole set is attached and shipping it with one Enter at the very end (on
    // this fleet's FB build a paste is rejected mid-upload, so that meant ~4
    // minutes of "holding" per chat, with the text answer waiting just as long
    // and every other buyer blocked) — clip 1 is sent the moment its upload
    // finishes, the TEXT reply ships right behind it (still honoring the
    // configured delay, counted from this instant), and the remaining clips
    // stream out one by one, yielding whenever another buyer is waiting.
    // Still exactly one API call per reply.
    const replyPromise = ask({ type: "GET_REPLY_SIMPLE", buyerMessage: turn.buyerMessage, context: turn.transcript, threadName: name, cachedText: memoOk ? memo.text : undefined });
    const replyClockStart = Date.now();
    const targetDelayMs = (settings.responseDelaySec || 15) * 1000 + rand(0, (settings.jitterSec || 15) * 1000);

    // Ships the text reply exactly once — called by the video engine right after
    // the first clip goes out, or below when there are no clips to send.
    const rs = { done: false };
    const shipReply = async (afterClip) => {
      if (rs.done) return;
      rs.done = true;
      const reply = await replyPromise; // usually already resolved while clip 1 attached
      if (!reply || !reply.ok) {
        setStatus({ lastError: "Claude error: " + (reply && reply.error) });
        return;
      }
      if (reply.skip) {
        if (reply.reason === "empty reply") {
          // Claude DELIBERATELY chose silence (system/meta message, nothing to answer).
          // Mark handled so the same unanswerable message isn't re-billed every
          // cooldown; a NEW buyer message (different text) still gets handled fresh.
          lastHandled[id] = turn.dedupeKey;
          clearWaiting(id, sidebarId);
          persistDedup();
        }
        setStatus({ lastAction: "skip — " + reply.reason, currentThread: name });
        return;
      }
      if (reply.human) {
        lastHandled[id] = turn.dedupeKey;
        clearWaiting(id, sidebarId); // handed to the human — resolved for the bot
        setStatus({ lastAction: "needs you: " + reply.reason, currentThread: name });
        return; // (the clips keep streaming — videos alone still help the human close)
      }
      if (!reply.text || !reply.text.trim()) {
        setStatus({ lastAction: "skip — empty reply" });
        return;
      }
      // Remember the billed text until it's actually delivered — an abort below used
      // to throw it away and bill a fresh call on the retry.
      if (!memoOk) pendingReply[id] = { buyerMessage: turn.buyerMessage, transcript: turn.transcript, text: reply.text, at: Date.now() };

      // Only the REMAINDER of the configured delay — the clip-1 attach/upload time
      // already counted toward it. Zero extra waiting is ever added on top.
      const delayMs = Math.max(0, targetDelayMs - (Date.now() - replyClockStart));
      if (delayMs > 0) {
        setStatus({ lastAction: "waiting " + Math.round(delayMs / 1000) + "s before replying", currentThread: name });
        await sleep(delayMs);
      }
      refreshThreadLock(sidebarId); // the delay is the longest window — re-stamp the lease

      // ABORT if the operator navigated to a different chat during the wait — typing
      // now would post this reply into the WRONG conversation. The chat is not marked
      // handled, so it's retried cleanly on a later cycle (the billed reply is
      // already memoized above).
      if (!stillOnThread(id)) {
        setStatus({ lastAction: "aborted — you switched chats during the wait (will retry)", currentThread: name });
        return;
      }
      // Make sure the chat didn't move on while we waited (buyer sent more) — better
      // to re-read next cycle than answer a stale message. NOT enforced right after
      // a clip went out: the chat's tail is ours by construction then, and a human
      // answers sequentially anyway (a newer buyer message gets its own reply next
      // cycle).
      if (!afterClip) {
        // A sidebar-rescued turn is invisible to the hint-less read — re-run the
        // same rescue. buyerSpokeLast() is tried FIRST so a NEW buyer bubble still
        // aborts, and the rescue still stops at any painted/right-hugging own
        // bubble, so a message WE sent during the wait aborts too.
        const recheck = buyerSpokeLast() || (rescueHint ? buyerSpokeLastConfirmed(rescueHint) : null);
        if (!recheck || recheck.buyerMessage !== turn.buyerMessage) {
          setStatus({ lastAction: "aborted — conversation changed during the wait (will retry)", currentThread: name });
          return;
        }
      }

      // The composer node may have been re-rendered by the attach work — re-find it.
      const composerNow = findComposer() || composer;
      const sent = await typeAndSend(composerNow, reply.text);
      if (!sent) {
        // NO blind re-fire: typeAndSend's false covers ambiguous outcomes (its
        // compose-mismatch guard may have CLEARED the text, or the Enter may have
        // actually taken) — a second Enter here could ship a garbled fragment or a
        // duplicate. The billed reply stays memoized (replayed free next cycle).
        setStatus({ lastError: "typed the reply but couldn't send it (will retry)" });
        return;
      }
      rememberSent(reply.text); // so we never mistake this for a buyer message later
      lastHandled[id] = turn.dedupeKey;
      delete pendingReply[id]; // delivered — the billed-reply memo is no longer needed
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
    };

    // VIDEOS FIRST, streamed: clip 1 → (reply) → clip 2 → clip 3, each sent as
    // soon as it is ready. All one-set-per-chat guards live inside the engine,
    // so for an already-served chat this returns in milliseconds and the reply
    // simply goes out below.
    // RUSH MODE (v0.21.37): when several OTHER buyers are already waiting and the
    // Chrome file API has not proven itself on this machine recently (i.e. an
    // attach would go through the slow synthetic path — minutes per set), the
    // buyer's ANSWER outranks this chat's clips: reply now, queue the set on the
    // pending lane (guaranteed later delivery). A machine with a healthy file
    // API keeps videos-first — its attach costs seconds, not minutes.
    let rush = false;
    // (v0.21.40, operator: "remove the blocks — videos instantly") rush only when
    // the file API is genuinely UNAVAILABLE on this machine right now (denied /
    // parked): then an attach means minutes of synthetic pasting and three other
    // buyers should not wait for it. With the file API usable the streaming
    // engine costs seconds per clip and yields between clips, so it is always
    // videos-first — "unproven recently" no longer counts against it.
    if (!videoLocked.has(id) && buyersWaitingCount(id, sidebarId) >= 3 && !cdpUsableNow()) {
      // Never queue a chat whose set is already CONFIRMED delivered (persisted
      // mark — videoLocked is in-memory and empty after a reload): the engine
      // exits in ms for it and latches videoLocked.
      const dnR = ((await getLocal(["videoSentThreads"])).videoSentThreads || {})[id];
      const served = !!(dnR && dnR.done && typeof dnR.resumeFrom !== "number");
      rush = !served;
    }
    void rushProbeDue; void cdpRecentlyHealthy; // kept for the diagnostic/health line
    if (rush) {
      const qkR = sidebarId || id;
      if (qkR && videoPending[qkR] == null && videoPending[id] == null) { videoPending[qkR] = Date.now(); persistDedup(); }
      setStatus({ lastAction: "rush: " + buyersWaitingCount(id, sidebarId) + " buyers waiting — replying first, videos queued", currentThread: name });
    } else if (!videoLocked.has(id)) {
      refreshThreadLock(sidebarId); // uploads can outlive the cross-tab lease
      await maybeSendVideo(id, name, true, sidebarId, false, { onClipSent: () => shipReply(true) });
      if (videoLocked.has(id)) clearVideoPending(sidebarId); // terminal → clear the sidebar-keyed pending too
    }
    // No clips configured / set already delivered / engine exited before a clip
    // went out — the reply goes now (text-only path keeps the full delay).
    await shipReply(false);
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
  // Buried-pending rescue pacing: in-memory only; the 6h freshness reload retries muted orphans.
  let lastOrphanScrollAt = 0;
  const orphanRescueTries = {};
  const ORPHAN_RESCUE_MAX = 40; // ~2 full sweeps of a large list, then stop until next page reload
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
  // AGED-VIDEO throttle: at most ONE pending-video visit per interval may preempt
  // LANE 1, and a chat that just got an aged attempt is skipped for an hour so one
  // stuck chat (e.g. clips in 24h fail-pause) can't wedge the lane. In-memory only —
  // a content-script reload restarts the pacing, which fails toward FEWER preemptions.
  // (v0.21.40) queued sets must not sit for hours (a diagnostic showed 21 pending,
  // oldest 19 h): one queued set every 90 s, eligible after 2 min, a failing chat
  // re-tried every 15 min. Lanes 0/1 (overdue / brand-new buyer) still outrank it.
  const AGED_VIDEO_EVERY_MS = 90 * 1000;
  const AGED_VIDEO_MIN_AGE_MS = 2 * 60 * 1000;
  // (Note: whenever NO buyer is waiting, LANE 1.5 drains continuously with no
  // pacing at all — these constants only bound the worst case on busy machines.)
  const AGED_VIDEO_RETRY_MS = 15 * 60 * 1000;
  let lastAgedVideoAt = 0;
  const agedVideoTried = {}; // threadId -> last aged-lane attempt
  // Is this chat's video engine in a backoff that would refuse a send instantly?
  // Checks BOTH the sidebar id and its adopted canonical id (group threads redirect
  // on open; the engine records attempts under the ADOPTED id, the lanes look up
  // the SIDEBAR id — without the alias the 20-min/24h backoffs never gated the
  // lanes on this all-group fleet and a failing chat churned every scan).
  const videoAttBlocked = (videoAtt, id, now) => {
    const one = (k) => {
      const att = (videoAtt || {})[k];
      return !!(att && att.failAt && now - att.failAt < VIDEO_RETRY_BACKOFF); // (v0.21.40) short backoff only — no 24h pause
    };
    return one(id) || (adoptedAlias[id] != null && one(adoptedAlias[id]));
  };
  // Is any OTHER buyer waiting for a reply right now? Same evidence lane 0/1 use
  // (overdue ledger, or unread + buyer-attributed snippet). The streaming video
  // engine consults this between clips so a long set never makes a new buyer
  // wait for an old chat's remaining videos.
  function buyersWaitingCount(excludeId, excludeSidebarId) {
    const now = Date.now();
    let n = 0;
    for (const a of safe(() => conversationAnchors(), [])) {
      const id = threadId(a);
      if (id === excludeId || id === excludeSidebarId || adoptedAlias[id] === excludeId) continue;
      if (openFailCount(id) >= 3 && now <= (cooldowns[id] || 0)) continue; // won't-open park
      if (!safe(() => snippetSuggestsBuyerLast(a), false)) continue;
      const ws = waitingSince[id];
      if ((ws && now - ws > OVERDUE_MS) || safe(() => isUnreadAnchor(a), false)) n++;
    }
    return n;
  }
  function buyersWaitingNow(excludeId, excludeSidebarId) {
    return buyersWaitingCount(excludeId, excludeSidebarId) > 0;
  }
  function pickTarget(anchors, now, exclude, videoAtt) {
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
      // WON'T-OPEN quarantine: lane 0 deliberately ignores cooldowns, which made
      // the 30-min "parked" cooldown on unopenable threads a no-op — one broken
      // thread was retried every ~4 min for hours (a diagnostic showed 60 failed
      // opens). Honor the park ONLY for repeat open-failers; normal chats keep
      // lane 0's cooldown immunity.
      if (openFailCount(id) >= 3 && now <= (cooldowns[id] || 0)) continue;
      if (ws < overdueT) { overdueT = ws; overdue = a; }
    }
    if (overdue) return overdue;

    // LANE 1 — INSTANT, and now ABOVE the aged-video lane (v0.21.30, operator:
    // "new people first — videos + reply the moment they message"): the NEWEST
    // genuinely-waiting buyer (topmost matching row — the sidebar is
    // recency-sorted) is served before any old chat's queued video visit. Their
    // visit delivers everything at once anyway (staged clips + reply in one
    // message), so prioritizing them costs old chats at most one ~1-min slot.
    // Two conditions, not just the dot: unread AND the preview reads like the
    // BUYER's message. A dot with OUR preview ("You: …") is a STALE dot — on
    // minimized windows FB often never clears dots after we reply, and those
    // ghosts were re-opened forever, eating the queue.
    for (const a of anchors) {
      const id = threadId(a);
      if (exclude.has(id)) continue;
      if (!safe(() => isUnreadAnchor(a), false)) continue;
      if (!safe(() => snippetSuggestsBuyerLast(a), false)) continue; // stale dot → not lane 1
      if (now - (lastOpened[id] || 0) <= UNREAD_REOPEN_MS) continue;
      if (openFailCount(id) >= 3 && now <= (cooldowns[id] || 0)) continue; // won't-open park (see lane 0)
      return a; // first match = newest buyer → instant videos + reply
    }

    // LANE 0.5 — AGED PENDING VIDEOS (anti-starvation): on busy accounts lanes 0/1
    // are never both empty during business hours, so LANE 1.5 never ran and deferred
    // sets waited FOREVER ("replies fine, videos never send" — the busiest accounts).
    // At most one pending set goes out per 4 min. LANES 0 and 1 above outrank this:
    // an overdue buyer or a BRAND-NEW buyer is never displaced by an old chat's set.
    if (now - lastAgedVideoAt > AGED_VIDEO_EVERY_MS) {
      let av = null, avT = Infinity;
      for (const a of anchors) {
        const id = threadId(a);
        if (exclude.has(id)) continue;
        const t = videoPending[id];
        if (t == null || now - t < AGED_VIDEO_MIN_AGE_MS) continue;
        if (now - (agedVideoTried[id] || 0) < AGED_VIDEO_RETRY_MS) continue; // a stuck chat can't wedge the lane
        if (videoAttBlocked(videoAtt, id, now)) continue; // engine would refuse instantly — don't waste the slot
        if (t < avT) { avT = t; av = a; }
      }
      if (av) {
        lastAgedVideoAt = now;
        agedVideoTried[threadId(av)] = now; // stamped BEFORE the visit — a lock collision or failed open just delays 10 min (safe direction)
        return av;
      }
    }

    // LANE 1.5 — PENDING VIDEOS (guaranteed delivery): sets deferred during a busy
    // queue are serviced the moment no fresh buyer needs a reply — BEFORE idle
    // rotation, oldest first. This is what makes deferral a postponement, not a
    // cancellation ("latest version not sending videos at all" = this lane missing).
    {
      let pv = null, pvT = Infinity, evicted = false;
      for (const a of anchors) {
        const id = threadId(a);
        if (exclude.has(id)) continue;
        const t = videoPending[id];
        if (t == null) continue;
        // Stuck >24h → evict from the priority lane. NOT a cancellation: every
        // idle/already-replied/cap visit still runs maybeSendVideo, so the chat
        // gets its set on normal rotation once sending works again.
        // >24h stuck → RE-STAMP to the back of the queue (still lane-visible),
        // never evict: eviction dumped the chat onto slow idle rotation, which on
        // busy machines meant "never". Wedge protection stays via videoAttBlocked.
        if (now - t > 24 * 3600 * 1000) { videoPending[id] = now - (AGED_VIDEO_MIN_AGE_MS + 60000); evicted = true; continue; }
        // Never churn a chat the video engine would refuse instantly — mirrors the
        // 3-fail/24h pause and the retry backoff exits exactly.
        if (videoAttBlocked(videoAtt, id, now)) continue;
        // Won't-open park applies here too — the 15-min cooldown bypass below used
        // to override it, so one unopenable pending chat was retried every scan.
        if (openFailCount(id) >= 3 && now <= (cooldowns[id] || 0)) continue;
        if (now <= (cooldowns[id] || 0) && now - t < 15 * 60 * 1000) continue; // fresh cooldown; wait unless pending >15 min
        if (t < pvT) { pvT = t; pv = a; }
      }
      if (evicted) persistDedup(); // batched: one write per scan max, only on state change
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
    // An update is sitting on disk: stop STARTING new chats so the background
    // can restart onto the new version the moment we go idle. The in-flight
    // send (busy above) always finishes untouched. 10-min failsafe: if no
    // restart arrives (files turned out identical), resume normally.
    if (pausedForUpdate) {
      if (Date.now() - pausedForUpdate < 10 * 60 * 1000) {
        setStatus({ lastAction: "paused — installing update…" });
        return;
      }
      pausedForUpdate = 0;
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
      // TTL sweep (ongoing): kill ledger ghosts >24h old BEFORE the stamp loop so a
      // rendered, still-waiting buyer re-stamps in this same pass (no off-ledger gap).
      for (const k of Object.keys(waitingSince)) {
        if (typeof waitingSince[k] !== "number" || nowT - waitingSince[k] > 24 * 3600 * 1000) delete waitingSince[k];
      }
      let unread = 0, waiting = 0, purgedStale = false;
      const capN = Math.max(0, Number(settings.maxRepliesPerConvo) || 0);
      for (const a of anchors) {
        if (safe(() => isUnreadAnchor(a), false)) unread++;
        if (safe(() => snippetSuggestsBuyerLast(a), false)) {
          waiting++;
          const wid = threadId(a);
          // REPLY-CAPPED chats are resolved BY POLICY — the bot may not answer, so
          // holding them on the never-miss ledger jammed lane 0 (oldest-first) and
          // kept overdueNow true, force-queueing every video. The popup's unread
          // count still shows them; serving them is the operator's call.
          // replyCounts keys on the ADOPTED id for redirected group threads — check
          // through the alias too, or capped group chats (this whole fleet) would
          // keep re-stamping forever.
          const effReplies = Math.max(replyCounts[wid] || 0, adoptedAlias[wid] != null ? (replyCounts[adoptedAlias[wid]] || 0) : 0);
          if (wid && capN > 0 && effReplies >= capN) {
            if (waitingSince[wid] != null) { delete waitingSince[wid]; purgedStale = true; }
          } else if (wid && waitSuppress[wid] && waitSuppress[wid] > nowT) {
            // Chat repeatedly read idle in-chat despite the lit sidebar nudge —
            // keep it OFF the ledger until the suppression lapses (see waitSuppress).
            if (waitingSince[wid] != null) { delete waitingSince[wid]; purgedStale = true; }
          } else if (wid && waitingSince[wid] == null) waitingSince[wid] = nowT;
        } else if (safe(() => (a.innerText || "").split("\n").filter((s) => s.trim()).length >= 2, false)) {
          // Row is FULLY RENDERED (name + snippet) and reads not-buyer-last — the
          // exact condition under which lane 0 refuses to serve it, so its ledger
          // entry is unservable noise. A buyer who writes again flips the snippet
          // and is re-stamped this same loop. Mid-render rows never purge.
          const wid = threadId(a);
          if (wid && waitingSince[wid] != null) { delete waitingSince[wid]; purgedStale = true; }
        }
      }
      if (purgedStale) persistDedup(); // batched: at most one local write per scan, only on change
      setStatus({ marketplaceAnchorCount: anchors.length, unreadCount: unread, waitingCount: waiting, videoQueueCount: Object.keys(videoPending).length, lastAction: settings.enabled ? "scanning" : "off" });
      if (!settings.enabled || !onMarketplace()) return;

      // RESUME-MARK RESCUE: a crash mid-set leaves {done, resumeFrom, resumeTotal}
      // with no pending-queue entry (the lock cleared it), and the tail then waited
      // for an organic revisit that busy machines never make. Queue it explicitly.
      // Marks live under the ADOPTED id for redirected group threads; rendered rows
      // give the sidebar id, so look through the alias too.
      {
        const vtScan = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
        let queuedResume = false;
        for (const a of anchors) {
          const rid = threadId(a);
          if (!rid) continue;
          const adKey = adoptedAlias[rid];
          const mk = vtScan[rid] || (adKey != null ? vtScan[adKey] : null);
          if (!mk || typeof mk.resumeFrom !== "number") continue;
          if (typeof mk.resumeTotal === "number" && mk.resumeFrom >= mk.resumeTotal) continue; // nothing left to send
          if (mk.via === "lock" && nowT - (mk.at || 0) < 30 * 60 * 1000) continue; // in-flight — leave it alone
          if (videoPending[rid] == null && (adKey == null || videoPending[adKey] == null)) {
            videoPending[rid] = nowT;
            queuedResume = true;
          }
        }
        if (queuedResume) persistDedup();
      }

      // BACKLOG CATCH-UP: while armed (operator pressed "Catch up videos"), queue
      // replied-to chats that have no CONFIRMED video for a video visit. Delivery
      // runs through the normal aged-video lane (paced, reply-safe) and the same
      // chatAlreadyHasOurVideo() guard that prevents duplicates. Self-disarms.
      if (videoCatchUp.armed) {
        if (nowT - (videoCatchUp.at || 0) > 3 * 24 * 3600 * 1000) {
          videoCatchUp = { armed: false, at: 0 }; persistDedup();
        } else {
          const doneMap = (await getLocal(["videoSentThreads"])).videoSentThreads || {};
          let queued = 0;
          for (const a of anchors) {
            if (queued >= 30) break;
            const cid = threadId(a);
            if (!cid || videoPending[cid] != null) continue;
            // NOTE: no dot/unread check here — stuck-lit dots on minimized windows
            // made the old check skip the ENTIRE sidebar (queued 0 forever). The
            // snippet test below already leaves every truly-waiting buyer to the
            // reply lanes; a dotted "You:" row is exactly the backlog to queue.
            if (safe(() => snippetSuggestsBuyerLast(a), false)) continue; // buyer last → not a we-replied chat
            const dm = doneMap[cid];
            if (dm && dm.done) continue; // confirmed sent (real / DOM-seen) — never re-queue
            videoPending[cid] = nowT - (AGED_VIDEO_MIN_AGE_MS + 60000); // immediately aged-eligible
            queued++;
          }
          if (queued > 0) { catchUpDry = 0; persistDedup(); }
          else if (Object.keys(videoPending).length === 0 && (catchUpDry = (catchUpDry || 0) + 1) >= 6) {
            videoCatchUp = { armed: false, at: 0 }; catchUpDry = 0; persistDedup(); // backlog drained
          }
        }
      }

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
      // Lane 1.5 needs fail-backoff visibility so it never churns an unsendable chat.
      // Read videoAttempts ONLY when the pending queue is non-empty (local storage,
      // no network; queue is empty in the steady state so this is normally free).
      const vAtt = Object.keys(videoPending).length ? ((await getLocal(["videoAttempts"])).videoAttempts || {}) : {};
      const target = pickTarget(anchors, Date.now(), new Set(), vAtt);
      // BURIED-PENDING RESCUE: a chat owed its video can scroll out of the sidebar's
      // ~20 rendered rows and become unpickable by ANY lane. When minimized and only
      // idle work (or nothing) is on deck, page the virtualized list toward it so it
      // re-renders and the normal lanes can serve it. Buyer-facing picks are never
      // preempted — only discretionary idle rotation gives up its turn.
      if (safe(() => document.visibilityState === "hidden", false)) {
        const nowR = Date.now();
        const idleOnly = !target || (!safe(() => isUnreadAnchor(target), false) && !safe(() => snippetSuggestsBuyerLast(target), false) && videoPending[threadId(target)] == null);
        if (idleOnly && nowR - lastOrphanScrollAt > 30 * 1000) {
          const rendered = new Set(anchors.map((a) => threadId(a)));
          let orphan = null;
          for (const pid of Object.keys(videoPending)) {
            if (nowR - videoPending[pid] < 20 * 60 * 1000) continue;
            if (rendered.has(pid)) continue;
            if ((orphanRescueTries[pid] || 0) >= ORPHAN_RESCUE_MAX) continue;
            orphan = pid;
            break;
          }
          if (orphan) {
            orphanRescueTries[orphan] = (orphanRescueTries[orphan] || 0) + 1;
            lastOrphanScrollAt = nowR;
            setStatus({ lastAction: "deep-scan: paging to a buried pending-video chat…" });
            deepScanStep();
            return;
          }
        }
      }
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

  // Arm the backlog catch-up: clear only AMBIGUOUS done-marks (old-bug era),
  // KEEPING confirmed sends (`sent` count), DOM-seen marks (via:"dom") and
  // partial-set resume markers (resumeFrom/resumeTotal — clearing those would
  // re-send the already-delivered head clips). Then the scan-loop enqueuer +
  // aged-video lane deliver, each send still passing every duplicate guard.
  async function armVideoCatchUp(extraSet) {
    // Transactional: the one-shot boot flag (extraSet) commits in the SAME write as
    // the cleared map — a failed read/write leaves the flag unset so the next boot
    // retries; a landed write means the arm ran exactly once. Read rejects on error
    // instead of silently defaulting to {} (which would "clear" nothing but still
    // consume the one-shot).
    const st = await new Promise((resolve, reject) => {
      try {
        chrome.storage.local.get(["videoSentThreads", "videoAttempts"], (r) => {
          if (chrome.runtime.lastError || !r) return reject(new Error("catch-up read failed"));
          resolve(r);
        });
      } catch (e) { reject(e); }
    });
    const vt = st.videoSentThreads || {};
    const am = st.videoAttempts || {};
    let cleared = 0;
    for (const k of Object.keys(vt)) {
      const e = vt[k];
      const confirmed = e && e.done && (e.sent || e.via === "dom" || e.resumeFrom != null || e.resumeTotal != null);
      // A bare via:"lock" younger than the in-flight window is a set being sent
      // RIGHT NOW in some pass — clearing it (and its claim) would let a second
      // full set go out in parallel. Skip; a genuinely orphaned lock ages past
      // the window and is healed/cleared by the normal paths.
      const inFlight = e && e.via === "lock" && Date.now() - (e.at || 0) < 30 * 60 * 1000;
      if (e && (e === true || (e.done && !confirmed && !inFlight))) { delete vt[k]; delete am[k]; videoLocked.delete(k); cleared++; }
    }
    videoCatchUp = { armed: true, at: Date.now() };
    catchUpDry = 0;
    await setLocal(Object.assign({ videoSentThreads: vt, videoAttempts: am, videoCatchUp }, extraSet || {}));
    return cleared;
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
    if (msg && msg.type === "PAUSE_SCANS") {
      // Background has an update on disk — hold off on NEW chats so the restart
      // isn't blocked by nonstop activity. Current send finishes untouched.
      pausedForUpdate = Date.now();
      send({ ok: true, busy });
      return true;
    }
    if (msg && msg.type === "RESUME_SCANS") {
      pausedForUpdate = 0;
      send({ ok: true });
      return true;
    }
    if (msg && msg.type === "DIAG_PROBE") {
      // Popup 🩺 button — READ-ONLY live probe of THIS tab: what the scanner sees
      // in the sidebar right now (per-row unread/buyer verdicts + queue ages) and
      // what the video detectors say about the OPEN chat. Nothing is mutated.
      (async () => {
        try {
          const now = Date.now();
          const ageM = (t) => (typeof t === "number" && t > 0 ? Math.round((now - t) / 60000) + "m" : "-");
          const det = (fn) => { try { return fn() ? "Y" : "n"; } catch (e) { return "err"; } };
          const st = await getLocal(["videoSentThreads", "videoAttempts"]);
          const vt = st.videoSentThreads || {};
          const am = st.videoAttempts || {};
          const anchors = conversationAnchors();
          let overdue = 0;
          for (const a of anchors) {
            const ws = waitingSince[threadId(a)];
            if (ws && now - ws > OVERDUE_MS && snippetSuggestsBuyerLast(a)) overdue++;
          }
          const L = [];
          L.push("TAB " + location.href.replace(/[?#].*$/, ""));
          L.push(
            "state: busy=" + (busy ? "Y(" + ageM(busySince) + ")" : "n") +
            " pausedForUpdate=" + (pausedForUpdate ? "Y(" + ageM(pausedForUpdate) + ")" : "n") +
            " catchUp=" + (videoCatchUp && videoCatchUp.armed ? "ARMED dry=" + catchUpDry : "off") +
            " | mem: waiting=" + Object.keys(waitingSince).length +
            " vidPending=" + Object.keys(videoPending).length +
            " sessionLocked=" + videoLocked.size +
            " cooldowns=" + Object.keys(cooldowns).length
          );
          L.push("sidebar: anchors=" + anchors.length + " overdueNow=" + overdue + " — rows (first 12):");
          anchors.slice(0, 12).forEach((a, i) => {
            const id = threadId(a);
            const lines2 = (safe(() => a.innerText || "", "")).split("\n").map((s) => s.trim()).filter(Boolean);
            const ve = vt[id];
            const ae = am[id];
            L.push(
              " #" + i + " " + (trunc(anchorName(a), 13) || "?") +
              " unread=" + (isUnreadAnchor(a) ? "Y" : "n") +
              " buyerLast=" + (snippetSuggestsBuyerLast(a) ? "Y" : "n") +
              " wait=" + ageM(waitingSince[id]) +
              " vidQ=" + ageM(videoPending[id]) +
              " cool=" + (cooldowns[id] && cooldowns[id] > now ? Math.round((cooldowns[id] - now) / 60000) + "m" : "-") +
              " replies=" + (replyCounts[id] || 0) +
              " vmark=" + (ve
                ? (ve.sent ? "sent" + ve.sent : ve.via || "done") +
                  (typeof ve.resumeFrom === "number" ? "+r" + ve.resumeFrom + "/" + (ve.resumeTotal != null ? ve.resumeTotal : "?") : "")
                : "-") +
              " att=" + (ae && (ae.fails || 0) >= 3 ? "PAUSED-" + (ae.why || "load") : ae && ae.fails ? "f" + ae.fails : "-") +
              (suspiciousReads[id] ? " susp=" + suspiciousReads[id] : "") +
              (waitSuppress[id] && waitSuppress[id] > now ? " SUPP" : "") +
              " \"" + (trunc(lines2.slice(1).join(" "), 48) || "") + "\""
            );
          });
          const m = location.href.match(/\/t\/([^/?#]+)/);
          if (m) {
            const convo = safe(() => readConversation(), []) || [];
            const last = convo.length ? convo[convo.length - 1] : null;
            L.push(
              "open chat: id=…" + m[1].slice(-6) +
              " composer=" + (findComposer() ? "Y" : "NO") +
              " msgs=" + convo.length + " last=" + (last ? last.role : "-") +
              " | detectors: hardened=" + det(chatAlreadyHasOurVideo) +
              " legacyVideo=" + det(legacyChatVideoDetect) +
              " legacyBadge=" + det(legacyBadgeDetect) +
              " | mark=" + (vt[m[1]] ? JSON.stringify(vt[m[1]]).slice(0, 90) : "-")
            );
          } else {
            L.push("open chat: none");
          }
          send({ ok: true, text: L.join("\n") });
        } catch (e) {
          send({ ok: false, error: String((e && e.message) || e) });
        }
      })();
      return true;
    }
    if (msg && msg.type === "CLEAR_VIDEO_MARK_OPEN_CHAT") {
      // Popup maintenance button: clear the "video already sent" mark for the chat
      // the operator has OPEN and verified by eye. Single-chat, manual-only —
      // refuses when a sent video is actually visible in the conversation.
      (async () => {
        const m = location.href.match(/\/t\/([^/?#]+)/);
        const id = m ? m[1] : null;
        if (!id) return send({ ok: false, error: "no chat open" });
        if (chatAlreadyHasOurVideo()) return send({ ok: false, error: "a sent video is visible in this chat — not clearing" });
        const st = await getLocal(["videoSentThreads", "videoAttempts"]);
        const vt = st.videoSentThreads || {};
        const am = st.videoAttempts || {};
        const had = !!vt[id];
        delete vt[id];
        delete am[id];
        await setLocal({ videoSentThreads: vt, videoAttempts: am });
        videoLocked.delete(id); // mandatory: the in-memory lock short-circuits before storage
        send({ ok: true, cleared: had });
      })();
      return true;
    }
    if (msg && msg.type === "CATCH_UP_VIDEOS") {
      // Popup catch-up button (kept for re-runs). Same engine as the automatic
      // boot-time arm — delivery + duplicate-safety are the normal pipeline's.
      (async () => {
        const cleared = await armVideoCatchUp();
        send({ ok: true, cleared });
      })().catch((e) => send({ ok: false, error: String((e && e.message) || e) }));
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
