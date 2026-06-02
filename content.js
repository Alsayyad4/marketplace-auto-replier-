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
  const STORAGE_KEY_RULE = "learnedUnreadRule"; // self-learning detection
  const SCAN_MS = 8000;
  const COOLDOWN_MS = 90 * 1000;
  const MAX_HTML = 1500;
  const SMALL_PX = 20;

  const log = (...a) => console.log("[SubSell]", ...a);

  /* in-memory state (per page session) */
  let busy = false;
  let learnedRule = null; // { kind, ... } derived from a user-tagged unread row
  const cooldowns = {}; // threadId -> until-timestamp
  const repliedThreads = {}; // threadId -> timestamp (awaiting buyer reply)
  let lastTick = {};
  let breakUntil = 0; // human-cadence: timestamp until which we're "on a break"

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

  /* Is this anchor a REAL conversation row (not the left-rail "Marketplace"
   * nav button)? The diagnostic showed the sidebar nav button also matches
   * a[href*="/marketplace/t/"] but has id="left-sidebar-button-*",
   * aria-label "Marketplace · N unread", and is NOT inside a [role="row"].
   * Real conversation rows sit inside a [role="row"] and their aria-label
   * starts with "Group chat:" or the buyer's name. */
  function isConversationAnchor(anchor) {
    const id = safe(() => anchor.id, "") || "";
    if (/left-sidebar-button/i.test(id)) return false;
    const label = (safe(() => anchor.getAttribute("aria-label"), "") || "");
    if (/^Marketplace\b/.test(label)) return false; // the nav button label
    if (/^(Chats|Requests|Marketplace)\b/i.test(label)) return false;
    // must live inside a real conversation row
    const inRow = safe(() => anchor.closest('[role="row"]'), null);
    if (!inRow) return false;
    // href must point at a specific thread id
    const href = safe(() => anchor.getAttribute("href"), "") || "";
    if (!/\/marketplace\/t\/\d+/.test(href)) return false;
    return true;
  }

  function marketplaceAnchors() {
    const all = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
    return all.filter(isConversationAnchor);
  }

  /* Read a conversation row's preview snippet to tell who spoke last — WITHOUT
   * relying on the unread dot. When a thread is open/focused, Messenger marks
   * new messages read instantly (no bold/dot), so unread detection misses them.
   * The snippet is the longest grey (rgb(101,103,107)) text in the row; if it
   * doesn't start with "You:"/"Vous:" the buyer spoke last and likely needs a
   * reply. handleThread re-verifies against the real transcript before sending. */
  function rowPreview(anchor) {
    const row = resolveRow(anchor).el;
    let snippet = "";
    for (const sp of safe(() => row.querySelectorAll("span"), [])) {
      const c = safe(() => getComputedStyle(sp).color, "");
      // grey snippet text; the name is near-black, so this isolates the preview
      if (c !== "rgb(101, 103, 107)" && c !== "rgb(101,103,107)") continue;
      const t = safe(() => (sp.textContent || "").trim(), "");
      if (t.length > snippet.length) snippet = t;
    }
    // Strip Facebook's "Unread message:" prefix before judging who spoke.
    const s = snippet.replace(/^unread message:\s*/i, "").trim();
    // Facebook/Meta system rows that are NOT a real buyer message — reactions,
    // "automated suggestion" placeholders, Meta scam notices, rating prompts.
    // These were inflating the work list and wasting open/skip cycles.
    const SYSTEM_SNIPPET = /(reacted\b.*\bto your message|reacted to your message|this is an automated suggestion|to help identify and reduce scams|you have a rating waiting|^you sent\b|sent an attachment)/i;
    const fromBuyer =
      !!s && !/^(you|vous)\s*:/i.test(s) && s !== "·" && !SYSTEM_SNIPPET.test(s);
    return { snippet, fromBuyer };
  }

  /* =================================================================
   * SELF-LEARNING DETECTION
   * signalSnapshot() reduces a row to a small comparable feature vector.
   * learnUnreadByIndex() takes the row the user tagged as unread, compares
   * it against all the read rows, and stores the FIRST feature that cleanly
   * separates it. isUnread() then prefers that learned rule. When the DOM
   * drifts, the user just re-tags one unread row and the rule re-derives.
   * ================================================================= */
  function signalSnapshot(anchor) {
    const row = resolveRow(anchor).el;
    // max font weight among text spans
    let maxWeight = 400;
    for (const sp of safe(() => row.querySelectorAll("span"), [])) {
      const txt = safe(() => (sp.textContent || "").trim(), "");
      if (!txt) continue;
      const w = parseInt(safe(() => getComputedStyle(sp).fontWeight, "400"), 10);
      if (!isNaN(w) && w > maxWeight) maxWeight = w;
    }
    // small colored dot present?
    let dot = false;
    let dotBg = null;
    for (const d of safe(() => row.querySelectorAll("*"), [])) {
      const r = rect(d);
      if (r && r.w > 0 && r.h > 0 && r.w < SMALL_PX && r.h < SMALL_PX) {
        const bg = safe(() => getComputedStyle(d).backgroundColor, null);
        if (isColored(bg)) {
          dot = true;
          dotBg = bg;
          break;
        }
      }
    }
    const label = (safe(() => anchor.getAttribute("aria-label"), "") || "").toLowerCase();
    const aria = label.includes("unread") || label.includes("non lu");
    // any descendant class containing a hint token
    let hintClass = null;
    for (const d of safe(() => row.querySelectorAll("*"), [])) {
      for (const c of classList(d)) {
        if (/unread|unseen|bold|nonlu/i.test(c)) {
          hintClass = c;
          break;
        }
      }
      if (hintClass) break;
    }
    return { maxWeight, dot, dotBg, aria, hintClass };
  }

  // Derive a rule from the tagged-unread row vs. the rest. Returns a rule object
  // or null if nothing cleanly separates it.
  function deriveRule(anchors, unreadIndex) {
    const snaps = anchors.map(signalSnapshot);
    const target = snaps[unreadIndex];
    if (!target) return null;
    const others = snaps.filter((_, i) => i !== unreadIndex);

    // 1) aria-label is the gold standard if present and unique
    if (target.aria && others.every((o) => !o.aria)) {
      return { kind: "aria", note: "aria-label says unread" };
    }
    // 2) a distinctive class token only the unread row has
    if (target.hintClass && others.every((o) => o.hintClass !== target.hintClass)) {
      return { kind: "class", value: target.hintClass };
    }
    // 3) a colored dot only the unread row has
    if (target.dot && others.every((o) => !o.dot)) {
      return { kind: "dot" };
    }
    // 4) font weight strictly heavier than every read row
    const maxOther = others.length ? Math.max(...others.map((o) => o.maxWeight)) : 0;
    if (target.maxWeight > maxOther) {
      // pick a threshold halfway between, clamped to a sane min
      const threshold = Math.max(500, Math.floor((target.maxWeight + maxOther) / 2));
      return { kind: "weight", threshold };
    }
    return null;
  }

  function applyRule(rule, anchor) {
    if (!rule) return null;
    const s = signalSnapshot(anchor);
    switch (rule.kind) {
      case "aria":
        return s.aria;
      case "class":
        return s.hintClass === rule.value || (function () {
          // re-check directly in case snapshot only kept the first hint
          const row = resolveRow(anchor).el;
          for (const d of safe(() => row.querySelectorAll("*"), [])) {
            if (classList(d).includes(rule.value)) return true;
          }
          return false;
        })();
      case "dot":
        return s.dot;
      case "weight":
        return s.maxWeight >= rule.threshold;
      default:
        return null;
    }
  }

  /* =================================================================
   * isUnread() — prefers a LEARNED rule (self-learning detection); falls
   * back to the combined heuristics. Records which matched for the debug
   * panel.
   * ================================================================= */
  function isUnread(anchor) {
    // learned rule wins when present
    if (learnedRule) {
      const r = applyRule(learnedRule, anchor);
      if (r !== null) {
        anchor.__subsellSignal = "learned:" + learnedRule.kind;
        return r;
      }
    }
    return isUnreadHeuristic(anchor);
  }

  function isUnreadHeuristic(anchor) {
    // Never treat the left-rail nav button as a conversation.
    if (!isConversationAnchor(anchor)) {
      anchor.__subsellSignal = null;
      return false;
    }
    const row = resolveRow(anchor).el;
    // CONFIRMED SIGNAL (from diagnostic dump): unread conversation rows render
    // their name/snippet at fontWeight 600-700; read rows cap at 500. This is
    // the single cleanest separator. The small blue dot (rgb(33,111,219)) is a
    // secondary confirmation but the nav button also has one, so weight leads.
    let boldSignal = false;
    let maxW = 0;
    const spans = safe(() => row.querySelectorAll("span"), []);
    for (const sp of spans) {
      const txt = safe(() => (sp.textContent || "").trim(), "");
      if (!txt) continue;
      const w = parseInt(safe(() => getComputedStyle(sp).fontWeight, "400"), 10);
      if (!isNaN(w) && w > maxW) maxW = w;
      if (w >= 600) {
        boldSignal = true;
        break;
      }
    }
    // secondary: small blue unread dot
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
    // Require the BOLD signal (confirmed separator). The dot alone is not
    // enough — the nav button has a dot at weight 400. aria 'unread' is a
    // strong positive on its own if Facebook ever exposes it on a row.
    return boldSignal || ariaSignal;
  }

  /* ---------------- diagnostic capture (kept) ---------------- */
  function captureAnchor(anchor, index) {
    const rowInfo = resolveRow(anchor);
    const row = rowInfo.el;
    const text = safe(() => anchor.innerText || anchor.textContent || "", "");
    // who-spoke-last preview (independent of the unread dot) — lets the dump
    // show whether buyer-spoke-last detection would flag this row.
    const preview = safe(() => rowPreview(anchor), { snippet: "", fromBuyer: false });
    const isConvo = safe(() => isConversationAnchor(anchor), false);

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
      isConversation: isConvo,
      previewSnippet: trunc(preview.snippet, 120),
      fromBuyer: preview.fromBuyer,
      wouldReply: isConvo && (isUnread(anchor) || preview.fromBuyer),
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
      fromBuyer: cap.fromBuyer,
      wouldReply: cap.wouldReply,
      snippet: cap.previewSnippet,
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
    const convos = captures.filter((c) => c.isConversation);
    const dump = {
      version: "0.3.0",
      capturedAt: new Date().toISOString(),
      url: location.href,
      reason: reason || "auto",
      anchorCount: anchors.length,
      capturedCount: captures.length,
      // headline summary: what the auto-replier would actually act on
      conversationCount: convos.length,
      unreadCount: convos.filter((c) => c.detectedUnread).length,
      buyerSpokeLastCount: convos.filter((c) => !c.detectedUnread && c.fromBuyer).length,
      wouldReplyCount: convos.filter((c) => c.wouldReply).length,
      wouldReplyNames: convos.filter((c) => c.wouldReply).map((c) => c.name),
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
  function findComposer() {
    const main = getMain() || document;
    return (
      main.querySelector('[contenteditable="true"][role="textbox"]') ||
      main.querySelector('div[aria-label][contenteditable="true"]') ||
      main.querySelector('[contenteditable="true"]')
    );
  }

  // UI labels / chrome that must never be mistaken for a buyer message.
  const UI_NOISE = [
    "privacy & support", "customize chat", "chat members", "media, files and links",
    "rate seller", "more options", "marketplace", "mute", "search", "block",
    "you sent", "enter", "sent", "delivered", "seen", "active now", "view profile",
    // Facebook "Send a quick response" suggestion UI + automated placeholders.
    // These render near the buyer's message and were being mistaken for OUR
    // reply, causing "skip: last message isn't a fresh buyer message".
    "send a quick response", "tap a response to send it to the buyer",
    "yes. are you interested?", "yes, are you interested?",
    "in talks. i'll let you know.", "sorry, it's not available.",
    "this is an automated suggestion", "add video", "allow other buyers",
  ];
  function looksLikeNoise(text) {
    const t = text.trim().toLowerCase();
    if (!t) return true;
    if (/^ca\$|^\$\d|^\d+\s*(go|gb|tb)\b/.test(t)) return true; // price/spec card
    if (/^\d{1,2}:\d{2}\s*(am|pm)?$/i.test(t)) return true; // timestamps
    for (const n of UI_NOISE) if (t === n || t.startsWith(n)) return true;
    return false;
  }

  /* Read the conversation as a labeled transcript.
   * Returns [{ role: "buyer"|"me", text }] in chronological order.
   * Classification is by horizontal alignment inside the message column:
   * your messages sit on the right, the buyer's on the left. Only elements
   * that are real message bubbles (inside a [role="row"], within the column,
   * above the composer) are considered — this excludes the right info panel,
   * the listing card, the left sidebar, and all menu chrome. */
  function readConversation() {
    const main = getMain();
    if (!main) return [];
    const composer = findComposer();
    // Column bounds: prefer the composer's x-range; fall back to main.
    const cRect = composer ? composer.getBoundingClientRect() : main.getBoundingClientRect();
    const colLeft = cRect.left;
    const colRight = cRect.right;
    const colCenter = (colLeft + colRight) / 2;
    const colTop = composer ? cRect.top : Infinity; // messages are above the input

    // Locate Facebook's "Send a quick response" suggestion block and exclude its
    // ENTIRE subtree. Those grey chips ("Yes. Are you interested?", "In talks…",
    // "Sorry, it's not available.") render right under the buyer's message and
    // were being read as our own last turn — so the bot saw a fake "we replied"
    // and skipped a real buyer message like "hey". Matching the block container
    // is robust to wording/punctuation (curly vs straight apostrophes) changes.
    const quickBlocks = [];
    for (const d of safe(() => Array.from(main.querySelectorAll("div")), [])) {
      const t = safe(() => (d.textContent || "").trim(), "");
      if (/^Send a quick response/i.test(t) || /^Tap a response to send it to the buyer/i.test(t)) {
        quickBlocks.push(d);
      }
    }
    const inQuickBlock = (el) => quickBlocks.some((b) => safe(() => b.contains(el), false));

    const bubbles = [];
    const seen = new Set();
    const nodes = safe(() => Array.from(main.querySelectorAll('[role="row"] [dir="auto"]')), []);
    for (const el of nodes) {
      // take leaf-ish text nodes only (skip wrappers that contain another dir=auto)
      if (safe(() => el.querySelector('[dir="auto"]'), null)) continue;
      // Skip the quick-response suggestion subtree and any button UI — seller-side
      // SUGGESTIONS, not messages.
      if (inQuickBlock(el)) continue;
      if (safe(() => el.closest('[role="button"]'), null)) continue;
      const text = safe(() => (el.innerText || el.textContent || "").trim(), "");
      if (!text || text.length < 1) continue;
      if (looksLikeNoise(text)) continue;
      const r = safe(() => el.getBoundingClientRect(), null);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      // must be inside the message column and above the composer
      const center = r.left + r.width / 2;
      if (center < colLeft - 40 || center > colRight + 40) continue;
      if (r.top >= colTop) continue;
      const key = text + "@" + Math.round(r.top);
      if (seen.has(key)) continue;
      seen.add(key);
      // align: right side => me, left side => buyer
      const role = center > colCenter ? "me" : "buyer";
      bubbles.push({ role, text, top: r.top });
    }
    bubbles.sort((a, b) => a.top - b.top);
    return bubbles.map((b) => ({ role: b.role, text: b.text }));
  }

  // The buyer message we should actually respond to: the last bubble, and only
  // if it's the buyer's. Returns { buyerMessage, transcript } or null when the
  // last turn isn't a fresh buyer message (so we DON'T reply to ourselves/noise).
  function getBuyerTurn() {
    const convo = readConversation();
    if (!convo.length) return null;
    const last = convo[convo.length - 1];
    if (last.role !== "buyer") return null; // last message is ours (or none) → skip
    const transcript = convo
      .slice(-12)
      .map((m) => (m.role === "buyer" ? "Buyer: " : "You: ") + m.text)
      .join("\n");
    return { buyerMessage: last.text, transcript };
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
  function composerText(el) {
    return safe(() => (el.innerText || el.textContent || "").replace(/ /g, " ").trim(), "");
  }
  // Type word-by-word (not char-by-char) — far more reliable on Messenger's
  // Lexical editor, which dropped/reordered single chars in char mode. Newlines
  // are normalised to spaces so a stray Enter never splits the message.
  async function typeHuman(el, text, settings) {
    text = String(text).replace(/\s*\n\s*/g, " ").trim();
    const wpm = rand(settings.wpmMin || 38, settings.wpmMax || 78);
    const perChar = 60000 / (wpm * 5);
    const words = text.split(" ");
    for (let i = 0; i < words.length; i++) {
      const chunk = (i === 0 ? "" : " ") + words[i];
      insertText(el, chunk);
      await sleep(perChar * chunk.length * rand(0.6, 1.4));
      if (Math.random() < 0.06) await sleep(rand(300, 900)); // occasional think-pause
    }
  }
  // Replace whatever is in the composer with `text` in one shot (reliable path
  // used when verification fails). Selects-all then inserts.
  function setComposerText(el, text) {
    el.focus();
    safe(() => document.execCommand("selectAll", false, null));
    safe(() => document.execCommand("insertText", false, text));
  }
  function pressEnter(el) {
    el.focus();
    for (const type of ["keydown", "keypress", "keyup"]) {
      el.dispatchEvent(
        new KeyboardEvent(type, { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true })
      );
    }
  }
  // Type, then verify the composer actually holds the intended text before
  // sending. If it's garbled/empty, fix it with a single insert. Only then Enter.
  async function typeAndSend(el, text, settings) {
    const want = String(text).replace(/\s*\n\s*/g, " ").trim();
    await typeHuman(el, want, settings);
    await sleep(rand(200, 500));
    let have = composerText(el);
    if (have !== want) {
      // one corrective pass — clear and insert the whole thing at once
      setComposerText(el, want);
      await sleep(rand(150, 350));
      have = composerText(el);
    }
    if (!have) {
      updateTick({ lastError: "composer empty after typing — not sending" });
      return false;
    }
    await sleep(rand(150, 400));
    pressEnter(el);
    return true;
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

    // Open the conversation. A bare anchor.click() often does NOT trigger
    // Messenger's in-app (SPA) navigation, which is why threads were aborting
    // with "URL did not change". Drive a full pointer/mouse event sequence on
    // the anchor, then POLL for up to ~7s (Messenger can be slow), retrying the
    // click once. Only bail if it truly never navigates.
    function openThread() {
      const clickTarget = safe(() => anchor.querySelector("div") || anchor, anchor);
      safe(() => {
        for (const type of ["pointerover", "pointerenter", "pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          clickTarget.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
      });
      // belt-and-suspenders: also fire the element's native click()
      safe(() => anchor.click());
    }
    openThread();
    let opened = !id || location.href.includes(id);
    for (let i = 0; i < 14 && !opened; i++) {
      await sleep(500);
      if (!id || location.href.includes(id)) { opened = true; break; }
      if (i === 5) openThread(); // one retry partway through
    }
    if (!opened) {
      // Last resort: navigate straight to the thread URL (full SPA route load).
      const href = safe(() => anchor.getAttribute("href"), null);
      if (href) {
        safe(() => { location.href = href.startsWith("http") ? href : location.origin + href; });
        await sleep(2500);
        opened = !id || location.href.includes(id);
      }
    }
    if (!opened) {
      updateTick({ lastError: "URL did not change to thread " + id, lastAction: "aborted" });
      return;
    }

    // Let the thread render, then read a labeled transcript and pull the
    // buyer's actual last message. If the last turn isn't the buyer's (it's
    // ours, or only UI noise), DO NOT reply — this is what stops the bot from
    // talking to itself or to menu labels like "Privacy & support".
    await sleep(1200);
    const turn = getBuyerTurn();
    if (!turn) {
      updateTick({ lastAction: "skip: last message isn't a fresh buyer message", currentThread: name });
      return;
    }
    const buyerMessage = turn.buyerMessage;
    updateTick({ lastAction: "buyer said: " + trunc(buyerMessage, 80), currentThread: name });

    const reply = await ask({
      type: "GET_REPLY",
      buyerMessage,
      context: "Conversation so far (most recent last):\n" + turn.transcript,
      threadId: id,
      threadName: name,
    });
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
      if (typeof reply.text !== "string" || !reply.text.trim()) {
        updateTick({ lastAction: "skipped: empty reply text" });
        return;
      }
      const composer = findComposer();
      if (!composer) {
        updateTick({ lastError: "composer not found" });
        return;
      }
      const sent = await typeAndSend(composer, reply.text, settings);
      if (!sent) return; // composer was empty/garbled — don't mark replied
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
    // Diagnostic captures EVERYTHING (incl. the nav button) for debugging,
    // but the pipeline only ever acts on real conversation rows.
    const allAnchors = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
    writeDiagnostic(allAnchors, reason);
    const anchors = allAnchors.filter(isConversationAnchor);

    const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
    const unread = anchors.filter(isUnread);
    // Also pick up threads where the BUYER spoke last even if not marked unread
    // (open/auto-read threads). Union, de-duped by thread id.
    const buyerLast = anchors.filter((a) => !isUnread(a) && rowPreview(a).fromBuyer);
    const seen = new Set();
    const pending = [];
    // PRIORITY: real buyer-spoke-last threads FIRST, unread dot second. The blue
    // "unread" dot often sits on a thread where WE actually spoke last (Facebook
    // marks our own just-sent message unread), so processing unread first made
    // the bot loop on an already-answered chat (e.g. Justice) and never reach the
    // genuine buyers (e.g. Tedy "hey"). Buyer messages now win the queue.
    for (const a of [...buyerLast, ...unread]) {
      const id = threadId(a);
      if (seen.has(id)) continue;
      seen.add(id);
      pending.push(a);
    }

    // Detect buyer replies on threads we already answered -> cancel follow-ups
    for (const a of anchors) {
      const id = threadId(a);
      if (repliedThreads[id] && (isUnread(a) || rowPreview(a).fromBuyer)) {
        delete repliedThreads[id];
        ask({ type: "BUYER_REPLIED", threadId: id });
      }
    }

    updateTick({
      marketplaceAnchorCount: anchors.length,
      unreadCount: pending.length,
      lastAction: settings.enabled ? "scanning" : "idle (disabled)",
      lastError: null,
    });

    if (!settings.enabled) return;
    if (!onMessagesPage()) {
      updateTick({ lastAction: "idle (not on messages page)" });
      return;
    }
    // Loud, explicit blockers — so the popup shows WHY nothing is sending
    // instead of silently doing nothing. The API key is the usual culprit.
    if (!settings.apiKey) {
      updateTick({
        lastAction: "BLOCKED — no API key",
        lastError: "API key not set. Open Settings, paste your sk-ant-… key, Save. Replies are blocked until then.",
      });
      return;
    }

    // --- human cadence (anti-detection pacing) ---
    // CRITICAL FIX: pacing must NEVER strand a waiting buyer. The old logic
    // rolled multi-minute "breaks" precisely when pending.length > 0, which is
    // exactly why the bot sat "on break (13m left)" while 15 customers went
    // unanswered. Now a waiting buyer ALWAYS wins (force-reply): breaks/skips
    // are only ever considered while the inbox is already empty, where they're
    // invisible and harmless. Per-reply delay + jitter + the 90s per-thread
    // cooldown still keep replies from looking robotic/metronomic.
    if (pending.length) {
      breakUntil = 0; // cancel any lingering rest — someone is waiting
    } else if (settings.humanCadence !== false) {
      const now = Date.now();
      if (breakUntil > now) {
        updateTick({ lastAction: `resting (${Math.ceil((breakUntil - now) / 60000)}m left)` });
        return;
      }
      const breakChance = settings.breakChance != null ? settings.breakChance : 0.05;
      if (Math.random() < breakChance) {
        const minM = settings.breakMinMin != null ? settings.breakMinMin : 3;
        const maxM = settings.breakMaxMin != null ? settings.breakMaxMin : 18;
        breakUntil = now + rand(minM, maxM) * 60000;
      }
    }

    const target = pending.find((a) => {
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
    if (msg && msg.type === "TICK_NOW") {
      // Background heartbeat — fires even when this tab is backgrounded, where
      // setInterval is throttled to ~1/min. Keeps the bot replying while you
      // work in other tabs (as long as Chrome + this tab stay open).
      tick("alarm");
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === "PING") {
      sendResponse({ ok: true, url: location.href, anchorCount: document.querySelectorAll(MP_SELECTOR).length });
      return true;
    }
    if (msg && msg.type === "LEARN_UNREAD") {
      // msg.index = the row the user tagged as unread in the popup table
      const anchors = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
      const rule = deriveRule(anchors, msg.index);
      if (rule) {
        learnedRule = rule;
        safe(() => chrome.storage.local.set({ [STORAGE_KEY_RULE]: rule }));
        updateTick({ lastAction: "learned unread rule: " + rule.kind, signalMatched: "learned:" + rule.kind });
        sendResponse({ ok: true, rule });
      } else {
        sendResponse({ ok: false, error: "no feature cleanly separated that row — need a real unread row + at least one read row visible" });
      }
      return true;
    }
    if (msg && msg.type === "CLEAR_RULE") {
      learnedRule = null;
      safe(() => chrome.storage.local.remove(STORAGE_KEY_RULE));
      sendResponse({ ok: true });
      return true;
    }
    if (msg && msg.type === "GET_RULE") {
      sendResponse({ ok: true, rule: learnedRule });
      return true;
    }
    if (msg && msg.type === "SEND_FOLLOWUP") {
      (async () => {
        const settings = (await ask({ type: "GET_SETTINGS" })).settings || {};
        const anchor = marketplaceAnchors().find((a) => threadId(a) === msg.threadId);
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
          await sleep(1200);
          const composer = findComposer();
          if (composer) {
            const sent = await typeAndSend(composer, msg.text, settings);
            updateTick({ lastAction: sent ? "follow-up sent" : "follow-up failed", lastReplySent: sent ? trunc(msg.text, 200) : null });
            if (sent) ask({ type: "LOG_EVENT", entry: { thread: msg.threadId, action: "followup", reply: trunc(msg.text, 200) } });
            sendResponse({ ok: sent });
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
  // Restore any learned unread rule before the first scan.
  safe(() =>
    chrome.storage.local.get([STORAGE_KEY_RULE], (res) => {
      if (res && res[STORAGE_KEY_RULE]) {
        learnedRule = res[STORAGE_KEY_RULE];
        log("restored learned unread rule:", learnedRule);
      }
    })
  );
  setTimeout(() => tick("boot"), 2500);
  setInterval(() => tick("auto"), SCAN_MS);
})();
