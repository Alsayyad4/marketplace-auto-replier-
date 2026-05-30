/* SubSell — diagnostic popup. Renders the latest dump from chrome.storage
 * and lets the human trigger a fresh scan + copy the full JSON. */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const statusEl = $("status");
  const dumpEl = $("dump");
  const fpBody = document.querySelector("#fp tbody");
  const tickEl = $("tick");

  let lastDump = null;

  function setStatus(msg, cls) {
    statusEl.textContent = msg || "";
    statusEl.className = cls || "muted";
  }

  function cell(v) {
    const td = document.createElement("td");
    td.textContent = v == null ? "" : String(v);
    return td;
  }

  function renderFingerprints(fps) {
    fpBody.innerHTML = "";
    if (!fps || !fps.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 10;
      td.className = "muted";
      td.textContent = "No marketplace anchors captured.";
      tr.appendChild(td);
      fpBody.appendChild(tr);
      return;
    }
    for (const f of fps) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(f.index));
      const nameTd = cell(f.name);
      nameTd.className = "name";
      nameTd.title = f.name || "";
      tr.appendChild(nameTd);
      tr.appendChild(cell(f.maxFontWeight));
      tr.appendChild(cell(f.boldSpanCount));
      tr.appendChild(cell(f.smallElementCount));
      tr.appendChild(cell(f.coloredDotBg));
      tr.appendChild(cell(f.pseudoDotBg));
      tr.appendChild(cell(f.svgCount));
      tr.appendChild(cell(f.dataAttrCount));
      const aria = cell(f.ariaLabel);
      aria.className = "name";
      aria.title = f.ariaLabel || "";
      tr.appendChild(aria);
      fpBody.appendChild(tr);
    }
  }

  function renderTick(tick) {
    tickEl.innerHTML = "";
    if (!tick) {
      tickEl.innerHTML = '<div class="muted">No scan yet.</div>';
      return;
    }
    const pairs = [
      ["last scan", tick.lastScanTime],
      ["url", tick.url],
      ["marketplace anchors", tick.marketplaceAnchorCount],
      ["captured", tick.capturedCount],
      ["reason", tick.reason],
      ["unread count", tick.unreadCount === null ? "(detection TBD)" : tick.unreadCount],
      ["signal matched", tick.signalMatched || "(none yet)"],
      ["last action", tick.lastAction],
      ["last error", tick.lastError || "—"],
    ];
    for (const [k, v] of pairs) {
      const a = document.createElement("div");
      a.textContent = k;
      const b = document.createElement("div");
      b.textContent = v == null ? "" : String(v);
      tickEl.appendChild(a);
      tickEl.appendChild(b);
    }
  }

  function render(dump, tick) {
    lastDump = dump || null;
    renderTick(tick);
    if (dump) {
      renderFingerprints(dump.fingerprints);
      dumpEl.value = JSON.stringify(dump, null, 2);
    }
  }

  function loadFromStorage() {
    chrome.storage.local.get(["diagnosticDump", "debugTick"], (res) => {
      render(res.diagnosticDump, res.debugTick);
    });
  }

  async function activeTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  async function scanNow() {
    setStatus("Scanning…");
    try {
      const tab = await activeTab();
      if (!tab || !tab.id) {
        setStatus("No active tab.", "warn");
        return;
      }
      chrome.tabs.sendMessage(tab.id, { type: "SCAN" }, (resp) => {
        if (chrome.runtime.lastError) {
          setStatus(
            "Content script not loaded here. Open messenger.com and reload the tab.",
            "warn"
          );
          return;
        }
        if (resp && resp.ok) {
          render(resp.dump, {
            lastScanTime: resp.dump.capturedAt,
            url: resp.dump.url,
            marketplaceAnchorCount: resp.dump.anchorCount,
            capturedCount: resp.dump.capturedCount,
            reason: resp.dump.reason,
            unreadCount: null,
            signalMatched: null,
            lastAction: "diagnostic-scan",
            lastError: null,
          });
          setStatus(
            `Captured ${resp.dump.capturedCount}/${resp.dump.anchorCount} anchors.`,
            "ok"
          );
        } else {
          setStatus("Scan returned no data.", "warn");
        }
      });
    } catch (e) {
      setStatus("Error: " + e.message, "warn");
    }
  }

  async function copyAll() {
    if (!dumpEl.value) {
      setStatus("Nothing to copy — scan first.", "warn");
      return;
    }
    try {
      await navigator.clipboard.writeText(dumpEl.value);
      setStatus("Copied full dump to clipboard.", "ok");
    } catch (e) {
      // Fallback: select the textarea so the user can Ctrl+C.
      dumpEl.focus();
      dumpEl.select();
      setStatus("Press Ctrl+C / Cmd+C to copy (selected).", "warn");
    }
  }

  $("scan").addEventListener("click", scanNow);
  $("copy").addEventListener("click", copyAll);
  $("refresh").addEventListener("click", loadFromStorage);

  loadFromStorage();
})();
