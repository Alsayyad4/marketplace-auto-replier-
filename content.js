/* =====================================================================
 * SubSell Marketplace — UNREAD DETECTION DIAGNOSTIC (content.js)
 * ---------------------------------------------------------------------
 * PURPOSE (and the ONLY purpose right now):
 *   For every Marketplace conversation anchor in the Messenger sidebar,
 *   capture every plausible signal that could distinguish an UNREAD row
 *   from a read row, dump it to chrome.storage.local + console, so the
 *   human can compare a known-unread row against a known-read row and
 *   identify the ONE differing signal.
 *
 * THERE IS NO REPLY PIPELINE HERE. Detection first. Do not add clicking,
 * typing, or API calls to this file until isUnread() is confirmed.
 *
 * CONSTRAINTS:
 *   - No ES module imports. Everything inlined.
 *   - No npm packages.
 *   - chrome.storage.local only. Never localStorage.
 *   - Keep ALL instrumentation. Never strip "to clean up".
 * ===================================================================== */

(() => {
  "use strict";

  const MP_SELECTOR = 'a[href*="/marketplace/t/"]';
  const STORAGE_KEY_DUMP = "diagnosticDump";
  const STORAGE_KEY_TICK = "debugTick";
  const AUTO_SCAN_MS = 8000; // matches the planned scan cadence
  const MAX_HTML = 1500; // brief: first 1500 chars of outerHTML
  const SMALL_PX = 20; // brief: nested elements smaller than 20x20

  const log = (...args) => console.log("[SubSell-DIAG]", ...args);

  /* ---------- tiny safe helpers (inlined) ---------- */

  function safe(fn, fallback) {
    try {
      return fn();
    } catch (e) {
      return fallback;
    }
  }

  function trunc(str, n) {
    if (str == null) return null;
    str = String(str);
    return str.length > n ? str.slice(0, n) : str;
  }

  function rect(el) {
    return safe(() => {
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
      };
    }, null);
  }

  function classList(el) {
    return safe(() => {
      if (!el) return [];
      // className can be an SVGAnimatedString on <svg>; getAttribute is uniform.
      const c = el.getAttribute && el.getAttribute("class");
      if (!c) return [];
      return c.trim().split(/\s+/).filter(Boolean);
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
      for (const attr of el.attributes) {
        if (attr.name.startsWith("data-")) out[attr.name] = attr.value;
      }
      return out;
    }, {});
  }

  // Pseudo-element capture: unread "dots" are frequently ::before / ::after
  // with a backgroundColor, so we grab geometry + color too, not just content.
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
      const hasBox =
        display !== "none" &&
        (parseFloat(w) > 0 || parseFloat(h) > 0) &&
        bg &&
        bg !== "rgba(0, 0, 0, 0)" &&
        bg !== "transparent";
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

  /* ---------- "row" resolution ---------- */
  // The meaningful row may be the anchor itself or an ancestor (listitem/row).
  // Capture a best-guess row plus a short ancestor chain so we have options
  // when we later compare read vs unread.
  function resolveRow(anchor) {
    const candidate =
      safe(() => anchor.closest('[role="row"]'), null) ||
      safe(() => anchor.closest('[role="gridcell"]'), null) ||
      safe(() => anchor.closest('[role="listitem"]'), null) ||
      safe(() => anchor.closest("li"), null);
    if (candidate && candidate !== anchor) {
      const r = candidate.getAttribute("role");
      return { el: candidate, via: r ? `role=${r}` : candidate.tagName.toLowerCase() };
    }
    // Fallback: climb up to 4 levels and take that ancestor.
    let el = anchor;
    for (let i = 0; i < 4 && el.parentElement; i++) el = el.parentElement;
    return { el, via: "ancestor+4" };
  }

  function ancestorChain(anchor, levels) {
    const chain = [];
    let el = anchor.parentElement;
    for (let i = 0; i < levels && el; i++) {
      chain.push({
        level: i + 1,
        tag: el.tagName.toLowerCase(),
        role: safe(() => el.getAttribute("role"), null),
        classes: classList(el),
        aria: ariaInfo(el),
      });
      el = el.parentElement;
    }
    return chain;
  }

  /* ---------- per-anchor capture ---------- */

  function captureAnchor(anchor, index) {
    const rowInfo = resolveRow(anchor);
    const row = rowInfo.el;

    // Conversation name / preview text so the human can match a row to a buyer.
    const text = safe(() => anchor.innerText || anchor.textContent || "", "");
    const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
    const name = lines[0] || null;

    // ALL class names: anchor, row, every descendant of the row.
    const descendants = safe(() => Array.from(row.querySelectorAll("*")), []);
    const descClasses = [];
    for (const d of descendants) {
      const cl = classList(d);
      if (cl.length) descClasses.push(cl.join(" "));
    }

    // Computed fontWeight of every text-bearing span.
    const fontWeights = [];
    const spans = safe(() => Array.from(row.querySelectorAll("span")), []);
    for (const sp of spans) {
      const txt = safe(() => (sp.textContent || "").trim(), "");
      if (!txt) continue;
      const cs = safe(() => getComputedStyle(sp), null);
      if (!cs) continue;
      fontWeights.push({
        text: trunc(txt, 60),
        fontWeight: cs.fontWeight,
        color: cs.color,
        fontStyle: cs.fontStyle,
      });
      if (fontWeights.length >= 60) break;
    }

    // Nested elements smaller than 20x20 (candidate unread dots) + bg color.
    const smallElements = [];
    for (const d of descendants) {
      const r = rect(d);
      if (!r) continue;
      if (r.w > 0 && r.h > 0 && r.w < SMALL_PX && r.h < SMALL_PX) {
        const cs = safe(() => getComputedStyle(d), null);
        smallElements.push({
          tag: d.tagName.toLowerCase(),
          classes: classList(d),
          w: r.w,
          h: r.h,
          backgroundColor: cs ? cs.backgroundColor : null,
          borderRadius: cs ? cs.borderRadius : null,
          ariaHidden: safe(() => d.getAttribute("aria-hidden"), null),
          ariaLabel: safe(() => d.getAttribute("aria-label"), null),
        });
      }
      if (smallElements.length >= 40) break;
    }

    // ::before / ::after pseudo content across anchor, row, and descendants.
    const pseudos = [];
    for (const p of pseudosFor(anchor)) pseudos.push({ host: "anchor", ...p });
    for (const p of pseudosFor(row)) pseudos.push({ host: "row", ...p });
    for (const d of descendants) {
      for (const p of pseudosFor(d)) {
        pseudos.push({ host: trunc(d.tagName.toLowerCase() + "." + classList(d).join("."), 80), ...p });
      }
      if (pseudos.length >= 40) break;
    }

    // SVG elements present (icons; sometimes used as unread markers).
    const svgs = [];
    const svgEls = safe(() => Array.from(row.querySelectorAll("svg")), []);
    for (const s of svgEls) {
      svgs.push({
        classes: classList(s),
        ariaLabel: safe(() => s.getAttribute("aria-label"), null),
        title: safe(() => { const t = s.querySelector("title"); return t ? t.textContent : null; }, null),
        rect: rect(s),
        outerHTML: trunc(safe(() => s.outerHTML, ""), 300),
      });
      if (svgs.length >= 12) break;
    }

    // data-* attributes on anchor and row.
    const dataAnchor = dataAttrs(anchor);
    const dataRow = dataAttrs(row);

    return {
      index,
      name,
      href: safe(() => anchor.getAttribute("href"), null),
      textPreview: trunc(text.replace(/\n/g, " | "), 300),
      rowResolvedVia: rowInfo.via,
      anchorRect: rect(anchor),
      rowRect: rect(row),

      anchorOuterHTML: trunc(safe(() => anchor.outerHTML, ""), MAX_HTML),
      rowOuterHTML: trunc(safe(() => row.outerHTML, ""), MAX_HTML),

      classes: {
        anchor: classList(anchor),
        row: classList(row),
        descendants: descClasses,
      },

      ariaAnchor: ariaInfo(anchor),
      ariaRow: ariaInfo(row),

      fontWeights,
      smallElements,
      pseudos,
      svgs,

      dataAttrs: {
        anchor: dataAnchor,
        row: dataRow,
      },

      ancestorChain: ancestorChain(anchor, 5),
    };
  }

  /* ---------- quick-compare fingerprint ---------- */
  // A one-glance summary per anchor so the differing signal jumps out when
  // comparing read vs unread side by side.
  function fingerprint(cap) {
    const weights = cap.fontWeights.map((f) => parseInt(f.fontWeight, 10)).filter((n) => !isNaN(n));
    const maxWeight = weights.length ? Math.max(...weights) : null;
    const boldCount = weights.filter((w) => w >= 600).length;

    const isColored = (bg) =>
      bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    const coloredDot = cap.smallElements.find((s) => isColored(s.backgroundColor));
    const pseudoDot = cap.pseudos.find((p) => isColored(p.backgroundColor));

    return {
      index: cap.index,
      name: cap.name,
      maxFontWeight: maxWeight,
      boldSpanCount: boldCount,
      smallElementCount: cap.smallElements.length,
      coloredDotBg: coloredDot ? coloredDot.backgroundColor : null,
      pseudoDotBg: pseudoDot ? pseudoDot.backgroundColor : null,
      svgCount: cap.svgs.length,
      ariaLabel: cap.ariaAnchor ? cap.ariaAnchor.ariaLabel : null,
      ariaSelected: cap.ariaAnchor ? cap.ariaAnchor.ariaSelected : null,
      dataAttrCount:
        Object.keys(cap.dataAttrs.anchor).length + Object.keys(cap.dataAttrs.row).length,
    };
  }

  /* ---------- main scan ---------- */

  function scan(reason) {
    const anchors = safe(() => Array.from(document.querySelectorAll(MP_SELECTOR)), []);
    const captures = [];
    for (let i = 0; i < anchors.length; i++) {
      const cap = safe(() => captureAnchor(anchors[i], i), null);
      if (cap) captures.push(cap);
    }

    const fingerprints = captures.map(fingerprint);

    const dump = {
      version: "0.1.0",
      capturedAt: new Date().toISOString(),
      url: location.href,
      reason: reason || "auto",
      anchorCount: anchors.length,
      capturedCount: captures.length,
      fingerprints,
      anchors: captures,
    };

    const tick = {
      lastScanTime: dump.capturedAt,
      url: location.href,
      marketplaceAnchorCount: anchors.length,
      capturedCount: captures.length,
      reason: dump.reason,
      // unread count is intentionally null until isUnread() is confirmed.
      unreadCount: null,
      signalMatched: null,
      lastAction: "diagnostic-scan",
      lastError: null,
    };

    safe(() => chrome.storage.local.set({ [STORAGE_KEY_DUMP]: dump, [STORAGE_KEY_TICK]: tick }));

    log(
      `scan (${dump.reason}): ${anchors.length} marketplace anchors, ${captures.length} captured`,
      dump
    );
    return dump;
  }

  /* ---------- messaging from popup ---------- */

  safe(() =>
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg && msg.type === "SCAN") {
        const dump = scan("manual");
        sendResponse({ ok: true, dump });
        return true;
      }
      if (msg && msg.type === "PING") {
        sendResponse({
          ok: true,
          url: location.href,
          anchorCount: document.querySelectorAll(MP_SELECTOR).length,
        });
        return true;
      }
      return false;
    })
  );

  /* ---------- auto-scan loop + boot ---------- */

  log("content script loaded on", location.href);
  // First scan shortly after load (sidebar needs a moment to render).
  setTimeout(() => scan("boot"), 2500);
  setInterval(() => scan("auto"), AUTO_SCAN_MS);
})();
