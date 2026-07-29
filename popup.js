/* SubSell — popup: on/off, status, delay slider, live debug, diagnostic. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  let settings = null;

  // Read merged (synced) settings from the background.
  function getSettings() {
    return new Promise((r) =>
      chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => r((res && res.settings) || {}))
    );
  }
  // Full config save -> syncs across computers via the background.
  function saveSettings(s) {
    return new Promise((r) => chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: s }, r));
  }

  try { if ($("ver")) $("ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (e) { /* cosmetic */ }

  function renderStatePill(on) {
    const pill = $("statePill");
    pill.textContent = on ? "ON" : "OFF";
    pill.className = "pill " + (on ? "on" : "off");
    $("toggle").textContent = on ? "Turn OFF" : "Turn ON";
  }

  async function refreshStatus() {
    chrome.runtime.sendMessage({ type: "GET_STATUS" }, (s) => {
      if (chrome.runtime.lastError || !s || !s.ok) return;
      renderStatePill(s.enabled);
      $("apiKey").textContent = s.apiKeySet ? "set ✓" : "NOT set";
      $("apiKey").className = s.apiKeySet ? "ok" : "bad";
      $("hour").textContent = `${s.hourCount} / ${s.hourlyCap}`;
      // Show the cap that is actually ENFORCED (s.fullDailyCap). s.dailyCap is the
      // warm-up display target, which confused ("34 / 10") — warm-up isn't enforced.
      $("day").textContent = `${s.dayCount} / ${s.fullDailyCap != null ? s.fullDailyCap : s.dailyCap}`;
      $("hours").textContent = s.withinHours ? "open ✓" : "closed";
      $("hours").className = s.withinHours ? "ok" : "warn";
      // Activity-log (central) health — so an empty Activity tab is self-explaining.
      const cl = $("cloudlog");
      if (cl) {
        const m = s.lastMirror;
        if (!m) { cl.textContent = "no sends yet"; cl.className = "muted"; }
        else if (m.ok) { cl.textContent = "✓ reporting"; cl.className = "ok"; }
        else { cl.textContent = "✗ " + (m.error || "failed"); cl.className = "bad"; }
      }
    });
  }

  function renderTick(tick) {
    const el = $("tick");
    el.innerHTML = "";
    if (!tick) {
      el.innerHTML = '<div class="muted">No scan yet.</div>';
      return;
    }
    const pairs = [
      ["last scan", tick.lastScanTime],
      ["marketplace anchors", tick.marketplaceAnchorCount],
      ["unread count", tick.unreadCount],
      ["current thread", tick.currentThread || "—"],
      ["signal matched", tick.signalMatched || "—"],
      ["last action", tick.lastAction || "—"],
      ["last reply", tick.lastReplySent || "—"],
      ["last error", tick.lastError || "—"],
    ];
    for (const [k, v] of pairs) {
      const a = document.createElement("div");
      a.textContent = k;
      const b = document.createElement("div");
      b.textContent = v == null ? "" : String(v);
      if (k === "last error" && tick.lastError) b.className = "bad";
      el.appendChild(a);
      el.appendChild(b);
    }
  }

  function cell(v) {
    const td = document.createElement("td");
    td.textContent = v == null ? "" : String(v);
    return td;
  }
  function renderFingerprints(fps) {
    const body = document.querySelector("#fp tbody");
    body.innerHTML = "";
    if (!fps || !fps.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 9;
      td.className = "muted";
      td.textContent = "No marketplace anchors captured.";
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }
    for (const f of fps) {
      const tr = document.createElement("tr");
      tr.appendChild(cell(f.index));
      const n = cell(f.name);
      n.className = "name";
      n.title = f.name || "";
      tr.appendChild(n);
      tr.appendChild(cell(f.unread ? "YES" : ""));
      tr.appendChild(cell(f.signal));
      tr.appendChild(cell(f.maxFontWeight));
      tr.appendChild(cell(f.coloredDotBg));
      tr.appendChild(cell(f.pseudoDotBg));
      tr.appendChild(cell(f.svgCount));
      const a = cell(f.ariaLabel);
      a.className = "name";
      a.title = f.ariaLabel || "";
      tr.appendChild(a);
      body.appendChild(tr);
    }
  }

  function loadStored() {
    chrome.storage.local.get(["debugTick", "diagnosticDump"], (res) => {
      renderTick(res.debugTick);
      if (res.diagnosticDump) {
        renderFingerprints(res.diagnosticDump.fingerprints);
        $("dump").value = JSON.stringify(res.diagnosticDump, null, 2);
      }
    });
  }

  async function toggle() {
    settings = await getSettings();
    settings.enabled = !settings.enabled;
    // On/off is PER-MACHINE — cheap local write, not a full config sync.
    await new Promise((r) => chrome.runtime.sendMessage({ type: "SET_ENABLED", enabled: settings.enabled }, r));
    renderStatePill(settings.enabled);
    refreshStatus();
  }

  function activeTab() {
    return new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r(t[0])));
  }
  async function scanNow() {
    $("diagStatus").textContent = "Scanning…";
    const tab = await activeTab();
    if (!tab) {
      $("diagStatus").textContent = "No tab.";
      return;
    }
    chrome.tabs.sendMessage(tab.id, { type: "SCAN" }, (resp) => {
      if (chrome.runtime.lastError) {
        $("diagStatus").textContent = "Open messenger.com & reload the tab.";
        $("diagStatus").className = "warn";
        return;
      }
      if (resp && resp.ok) {
        renderFingerprints(resp.dump.fingerprints);
        $("dump").value = JSON.stringify(resp.dump, null, 2);
        $("diagStatus").textContent = `Captured ${resp.dump.capturedCount}/${resp.dump.anchorCount}.`;
        $("diagStatus").className = "ok";
      }
    });
  }
  async function copyAll() {
    const v = $("dump").value;
    if (!v) {
      $("diagStatus").textContent = "Scan first.";
      return;
    }
    try {
      await navigator.clipboard.writeText(v);
      $("diagStatus").textContent = "Copied.";
      $("diagStatus").className = "ok";
    } catch (e) {
      $("dump").focus();
      $("dump").select();
      $("diagStatus").textContent = "Press Ctrl+C.";
    }
  }

  async function initDelay() {
    settings = await getSettings();
    const d = settings.responseDelaySec != null ? settings.responseDelaySec : 30;
    $("delay").value = d;
    $("delayVal").textContent = d;
  }
  async function onDelay() {
    settings = await getSettings();
    settings.responseDelaySec = Number($("delay").value);
    $("delayVal").textContent = settings.responseDelaySec;
    await saveSettings(settings);
  }

  /* ----- Wake scanner: re-inject the bot into every open Messenger tab, so the
   * operator never has to reload pages by hand if a tab ever looks stalled. ----- */
  if ($("wake")) {
    $("wake").addEventListener("click", () => {
      $("wakeStatus").textContent = "Waking…";
      chrome.runtime.sendMessage({ type: "WAKE_TABS" }, (r) => {
        $("wakeStatus").textContent = chrome.runtime.lastError ? "error" : "Scanner re-armed ✓";
        setTimeout(() => ($("wakeStatus").textContent = ""), 2500);
      });
    });
  }

  /* The updater has to know the unpacked folder's real name to write into it,
   * and only a foreground page can read it — so the popup reports it to the
   * background every time it opens. Renamed folders then auto-update fine. */
  try {
    if (chrome.runtime.getPackageDirectoryEntry) {
      chrome.runtime.getPackageDirectoryEntry((dir) => {
        void chrome.runtime.lastError;
        if (dir && dir.name) {
          chrome.runtime.sendMessage({ type: "SUD_DIRNAME", name: dir.name }, () => void chrome.runtime.lastError);
        }
      });
    }
  } catch (e) { /* optional signal — the updater falls back to known names */ }

  /* ----- Built-in updater: check the cloud and update this extension now ----- */
  if ($("checkUpdate")) {
    $("checkUpdate").addEventListener("click", () => {
      $("updStatus").textContent = "Checking…";
      chrome.runtime.sendMessage({ type: "CHECK_UPDATE" }, (r) => {
        if (chrome.runtime.lastError || !r) { $("updStatus").textContent = "error"; return; }
        if (r.upToDate) $("updStatus").textContent = "Up to date ✓ (v" + r.version + ")";
        else if (r.updated) $("updStatus").textContent = "v" + r.version + " downloaded — reloading…";
        else $("updStatus").textContent = r.reason || "failed";
      });
    });
  }

  /* ----- Open Marketplace: force-open the Messenger Marketplace inbox -----
   * Whatever Chrome profile is signed in handles the login automatically.
   * If a Messenger/messages tab is already open we reuse + focus it (and
   * nudge it to the Marketplace folder) instead of stacking duplicates. */
  const MP_INBOX_URL = "https://www.messenger.com/marketplace/";
  const EXISTING_TAB_MATCH = [
    "https://*.messenger.com/*",
    "https://www.facebook.com/messages/*",
  ];

  function openMarketplace() {
    const status = $("openMpStatus");
    status.className = "muted";
    status.textContent = "Opening…";
    chrome.tabs.query({ url: EXISTING_TAB_MATCH }, (tabs) => {
      if (chrome.runtime.lastError) {
        // No tabs permission / query failed — just open a fresh tab.
        chrome.tabs.create({ url: MP_INBOX_URL, active: true });
        status.textContent = "Opened.";
        status.className = "ok";
        return;
      }
      // Prefer a tab already on the Marketplace folder; else any messages tab.
      const onMp = tabs.find((t) => (t.url || "").includes("/marketplace"));
      const target = onMp || tabs[0];
      if (target) {
        const updates = { active: true };
        // If it's a messages tab but not on Marketplace, steer it there.
        if (!onMp) updates.url = MP_INBOX_URL;
        chrome.tabs.update(target.id, updates, () => {
          if (target.windowId != null) chrome.windows.update(target.windowId, { focused: true });
        });
        status.textContent = onMp ? "Focused existing tab." : "Reused tab → Marketplace.";
        status.className = "ok";
      } else {
        chrome.tabs.create({ url: MP_INBOX_URL, active: true });
        status.textContent = "Opened new tab.";
        status.className = "ok";
      }
    });
  }

  $("toggle").addEventListener("click", toggle);
  $("openMp").addEventListener("click", openMarketplace);
  $("scan").addEventListener("click", scanNow);
  $("copy").addEventListener("click", copyAll);
  $("delay").addEventListener("input", onDelay);
  $("openOptions").addEventListener("click", (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  loadStored();
  refreshStatus();
  initDelay();
  setInterval(loadStored, 2000);
  setInterval(refreshStatus, 3000);
})();
