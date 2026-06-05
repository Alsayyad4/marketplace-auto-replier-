/* SubSell — options page (tabbed). Reads/writes the full settings object
 * in chrome.storage.local. Tables for listings / follow-ups / videos. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    enabled: false,
    apiKey: "",
    model: "claude-sonnet-4-6",
    responseDelaySec: 30,
    jitterSec: 60,
    hourlyCap: 30,
    dailyCap: 200,
    wpmMin: 38,
    wpmMax: 78,
    businessHoursEnabled: true,
    businessHoursStart: 9,
    businessHoursEnd: 22,
    businessName: "SubSell",
    businessAddress: "757 Rue Beaubien E, Montréal",
    businessHoursText: "9AM–10PM, 7 days",
    businessInfo:
      "Used iPhone sales in Montreal. Pickup at 757 Rue Beaubien E, Montréal. Cash or e-transfer.",
    instructions:
      "Be friendly and concise. Auto-detect the buyer's language (French or English) and reply in the same language; for French use casual Quebec French. Quote prices from the listings. Never discount more than 10% without flagging a human. If the buyer is rude, scammy, or asking something unusual, return [HUMAN] with a short reason.",
    examples: "",
    offPlatformGuard: true,
    closerMode: true,
    noExactPrices: true,
    closerGoals:
      "Your #1 goal is to get the buyer to come visit the shop in person. We give better prices in person than online. We also do trade-ins/exchanges, buyback of their old phone, and have liquidation deals — mention these naturally when relevant. Build excitement and urgency without being pushy. Always steer toward 'come by the shop and we'll take care of you'.",
    priceList: "",
    visitConfirmEnabled: true,
    visitConfirmAfterMin: 120,
    visitConfirmMessage: "",
    maxRepliesPerConvo: 5,
    convoCapBehavior: "stop",
    humanCadence: true,
    skipChance: 0.12,
    breakChance: 0.05,
    breakMinMin: 3,
    breakMaxMin: 18,
    warmupEnabled: true,
    warmupDays: 7,
    warmupStartCap: 10,
    listings: [],
    followUps: [],
    videos: [],
  };

  let settings = Object.assign({}, DEFAULTS);

  /* ----- tabs ----- */
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("section").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(t.dataset.tab).classList.add("active");
    });
  });

  /* ----- field bindings (simple inputs) ----- */
  const FIELDS = [
    ["apiKey", "value"],
    ["model", "value"],
    ["responseDelaySec", "number"],
    ["jitterSec", "number"],
    ["hourlyCap", "number"],
    ["dailyCap", "number"],
    ["wpmMin", "number"],
    ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"],
    ["businessHoursStart", "number"],
    ["businessHoursEnd", "number"],
    ["businessName", "value"],
    ["businessAddress", "value"],
    ["businessHoursText", "value"],
    ["businessInfo", "value"],
    ["instructions", "value"],
    ["examples", "value"],
    ["offPlatformGuard", "checked"],
    ["closerMode", "checked"],
    ["noExactPrices", "checked"],
    ["closerGoals", "value"],
    ["priceList", "value"],
    ["visitConfirmEnabled", "checked"],
    ["visitConfirmAfterMin", "number"],
    ["visitConfirmMessage", "value"],
    ["maxRepliesPerConvo", "number"],
    ["convoCapBehavior", "value"],
    ["humanCadence", "checked"],
    ["skipChance", "number"],
    ["breakChance", "number"],
    ["breakMinMin", "number"],
    ["breakMaxMin", "number"],
    ["warmupEnabled", "checked"],
    ["warmupDays", "number"],
    ["warmupStartCap", "number"],
  ];

  function fieldsToForm() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") el.checked = !!settings[id];
      else el.value = settings[id] != null ? settings[id] : "";
    }
  }
  function formToFields() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") settings[id] = el.checked;
      else if (kind === "number") settings[id] = Number(el.value);
      else settings[id] = el.value;
    }
  }

  /* ----- generic table editor ----- */
  function renderTable(tbodySel, items, cols, onChange) {
    const tbody = document.querySelector(tbodySel);
    tbody.innerHTML = "";
    items.forEach((item, idx) => {
      const tr = document.createElement("tr");
      for (const col of cols) {
        const td = document.createElement("td");
        let input;
        if (col.type === "checkbox") {
          input = document.createElement("input");
          input.type = "checkbox";
          input.checked = item[col.key] !== false;
        } else if (col.type === "textarea") {
          input = document.createElement("textarea");
          input.value = item[col.key] != null ? item[col.key] : "";
        } else {
          input = document.createElement("input");
          input.type = col.type || "text";
          input.value = item[col.key] != null ? item[col.key] : "";
        }
        input.addEventListener("input", () => {
          item[col.key] =
            col.type === "checkbox" ? input.checked : col.type === "number" ? Number(input.value) : input.value;
        });
        input.addEventListener("change", () => {
          item[col.key] = col.type === "checkbox" ? input.checked : input.value;
        });
        td.appendChild(input);
        tr.appendChild(td);
      }
      const tdDel = document.createElement("td");
      const del = document.createElement("button");
      del.textContent = "✕";
      del.className = "danger";
      del.addEventListener("click", () => {
        items.splice(idx, 1);
        onChange();
      });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }

  function renderListings() {
    renderTable(
      "#listingsTable tbody",
      settings.listings,
      [
        { key: "title" },
        { key: "model" },
        { key: "storage" },
        { key: "condition" },
        { key: "price", type: "number" },
        { key: "videoUrl" },
        { key: "available", type: "checkbox" },
      ],
      renderListings
    );
  }
  function renderFollowUps() {
    renderTable(
      "#followupsTable tbody",
      settings.followUps,
      [
        { key: "name" },
        { key: "afterMinutes", type: "number" },
        { key: "message", type: "textarea" },
        { key: "enabled", type: "checkbox" },
      ],
      renderFollowUps
    );
  }
  function renderVideos() {
    renderTable(
      "#videosTable tbody",
      settings.videos,
      [{ key: "name" }, { key: "url" }, { key: "notes", type: "textarea" }],
      renderVideos
    );
  }

  $("addListing").addEventListener("click", () => {
    settings.listings.push({ title: "", model: "", storage: "", condition: "", price: 0, videoUrl: "", available: true });
    renderListings();
  });
  $("addFollowUp").addEventListener("click", () => {
    settings.followUps.push({ name: "", afterMinutes: 60, message: "", enabled: true });
    renderFollowUps();
  });
  $("addVideo").addEventListener("click", () => {
    settings.videos.push({ name: "", url: "", notes: "" });
    renderVideos();
  });

  $("exportListings").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(settings.listings, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subsell-listings.json";
    a.click();
    URL.revokeObjectURL(url);
  });
  $("importListings").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", () => {
      const file = input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (Array.isArray(data)) {
            settings.listings = data;
            renderListings();
          } else alert("Expected a JSON array.");
        } catch (e) {
          alert("Invalid JSON: " + e.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  });

  /* ----- test responses ----- */
  $("runTest").addEventListener("click", () => {
    formToFields();
    // Persist (synced) before testing so the test uses the current form values.
    chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
      $("testStatus").textContent = "Calling Claude…";
      chrome.runtime.sendMessage(
        { type: "TEST_REPLY", buyerMessage: $("testInput").value },
        (resp) => {
          if (chrome.runtime.lastError) {
            $("testStatus").textContent = "Error: " + chrome.runtime.lastError.message;
            return;
          }
          if (!resp || !resp.ok) {
            $("testStatus").textContent = "Error: " + (resp && resp.error);
            $("testResult").textContent = "—";
            return;
          }
          $("testStatus").textContent = "Done.";
          const p = resp.parsed;
          let label = "";
          if (p.kind === "human") label = `[HUMAN] ${p.reason}`;
          else if (p.kind === "video") label = `[VIDEO ${p.url}] ${p.caption}`;
          else label = p.text;
          $("testResult").textContent = label + "\n\n— raw —\n" + resp.raw;
        }
      );
    });
  });

  /* ----- activity log ----- */
  function esc(v) {
    return v == null ? "" : String(v);
  }
  function renderLog(entries) {
    const tbody = document.querySelector("#logTable tbody");
    tbody.innerHTML = "";
    const rows = (entries || []).slice().reverse(); // most recent first
    if (!rows.length) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.colSpan = 5;
      td.textContent = "No activity logged yet.";
      tr.appendChild(td);
      tbody.appendChild(tr);
      return;
    }
    for (const e of rows) {
      const tr = document.createElement("tr");
      const when = e.at ? new Date(e.at).toLocaleString() : "";
      for (const v of [when, e.action, e.thread, e.buyer, e.reply]) {
        const td = document.createElement("td");
        td.textContent = esc(v);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
  }
  function loadLog() {
    $("logStatus").textContent = "Loading…";
    chrome.runtime.sendMessage({ type: "GET_LOG" }, (resp) => {
      if (chrome.runtime.lastError || !resp || !resp.ok) {
        $("logStatus").textContent = "Could not load log.";
        return;
      }
      renderLog(resp.log);
      $("logStatus").textContent = `${resp.log.length} entr${resp.log.length === 1 ? "y" : "ies"}.`;
    });
  }
  $("refreshLog").addEventListener("click", loadLog);
  $("clearLog").addEventListener("click", () => {
    if (!confirm("Clear the entire activity log for this account?")) return;
    chrome.runtime.sendMessage({ type: "CLEAR_LOG" }, () => loadLog());
  });
  $("exportLog").addEventListener("click", () => {
    chrome.runtime.sendMessage({ type: "GET_LOG" }, (resp) => {
      const data = resp && resp.ok ? resp.log : [];
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "subsell-activity-log.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  });
  // Auto-load the log when its tab is opened.
  document.querySelector('.tab[data-tab="log"]').addEventListener("click", loadLog);

  /* ----- save / load ----- */
  function save() {
    formToFields();
    // Synced across all computers on the same Google account (via background).
    chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, () => {
      $("savedMsg").textContent = "Saved ✓ (syncs to your other computers)";
      setTimeout(() => ($("savedMsg").textContent = ""), 2500);
    });
  }
  $("save").addEventListener("click", save);

  /* ----- remote config (the "permanent link") ----- */
  function loadRemoteConfig() {
    chrome.storage.local.get(["remoteConfigUrl", "remoteConfigAt"], (r) => {
      if ($("remoteConfigUrl")) $("remoteConfigUrl").value = (r && r.remoteConfigUrl) || "";
      if ($("configStatus") && r && r.remoteConfigAt)
        $("configStatus").textContent = "last synced " + new Date(r.remoteConfigAt).toLocaleString();
    });
  }
  if ($("remoteConfigUrl")) {
    $("remoteConfigUrl").addEventListener("change", () => {
      chrome.storage.local.set({ remoteConfigUrl: ($("remoteConfigUrl").value || "").trim() });
    });
  }
  if ($("fetchConfig")) {
    $("fetchConfig").addEventListener("click", () => {
      chrome.storage.local.set({ remoteConfigUrl: ($("remoteConfigUrl").value || "").trim() }, () => {
        $("configStatus").textContent = "Fetching…";
        chrome.runtime.sendMessage({ type: "FETCH_CONFIG" }, (r) => {
          if (chrome.runtime.lastError) {
            $("configStatus").textContent = "Error: " + chrome.runtime.lastError.message;
            return;
          }
          $("configStatus").textContent =
            r && r.ok ? `Synced ✓ (${r.keys} settings). Reload your Messenger tab.` : "Failed: " + (r && r.error);
        });
      });
    });
  }
  if ($("exportConfig")) {
    $("exportConfig").addEventListener("click", () => {
      formToFields(); // capture current form edits
      const data = Object.assign({}, settings);
      delete data.enabled; // on/off stays per machine
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "subsell-config.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }
  loadRemoteConfig();

  /* ----- demo video(s) (stored locally on this computer, NOT synced) ----- */
  let demoVideos = [];
  function fmtSize(n) {
    return n ? (n / 1048576).toFixed(1) + " MB" : "";
  }
  function renderVideoList() {
    const el = $("videoList");
    if (!el) return;
    if (!demoVideos.length) {
      el.textContent = "No videos uploaded yet.";
      return;
    }
    el.innerHTML = "";
    demoVideos.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "row";
      const label = document.createElement("span");
      label.textContent = `${i + 1}. ${v.name || "video"} (${fmtSize(v.size)})`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        demoVideos.splice(i, 1);
        chrome.storage.local.set({ demoVideos }, renderVideoList);
      });
      row.appendChild(label);
      row.appendChild(del);
      el.appendChild(row);
    });
  }
  function loadVideo() {
    chrome.storage.local.get(["videoEnabled", "demoVideos", "demoVideo", "videoDelaySec"], (r) => {
      if ($("videoEnabled")) $("videoEnabled").checked = !!r.videoEnabled;
      if ($("videoDelaySec")) $("videoDelaySec").value = r.videoDelaySec != null ? r.videoDelaySec : 10;
      demoVideos = Array.isArray(r.demoVideos) ? r.demoVideos : [];
      if (!demoVideos.length && r.demoVideo && r.demoVideo.dataUrl) demoVideos = [r.demoVideo]; // migrate legacy single
      renderVideoList();
    });
  }
  if ($("videoEnabled")) {
    $("videoEnabled").addEventListener("change", () => {
      chrome.storage.local.set({ videoEnabled: $("videoEnabled").checked });
    });
  }
  if ($("videoDelaySec")) {
    $("videoDelaySec").addEventListener("change", () => {
      chrome.storage.local.set({ videoDelaySec: Number($("videoDelaySec").value) || 0 });
    });
  }
  if ($("videoFile")) {
    $("videoFile").addEventListener("change", () => {
      const f = $("videoFile").files && $("videoFile").files[0];
      if (!f) return;
      if ($("videoList")) $("videoList").textContent = `Loading ${f.name}…`;
      const reader = new FileReader();
      reader.onload = () => {
        demoVideos.push({ name: f.name, type: f.type || "video/mp4", size: f.size, dataUrl: reader.result });
        chrome.storage.local.set({ demoVideos }, () => {
          if (chrome.runtime.lastError) {
            demoVideos.pop();
            if ($("videoList")) $("videoList").textContent = "Couldn't store (too big?): " + chrome.runtime.lastError.message;
          } else {
            if ($("videoEnabled") && !$("videoEnabled").checked) {
              $("videoEnabled").checked = true;
              chrome.storage.local.set({ videoEnabled: true });
            }
            renderVideoList();
          }
          if ($("videoFile")) $("videoFile").value = "";
        });
      };
      reader.onerror = () => {
        if ($("videoList")) $("videoList").textContent = "Could not read that file.";
      };
      reader.readAsDataURL(f);
    });
  }
  loadVideo();

  function load() {
    // Read the merged (synced) settings from the background.
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (res) => {
      const got = (res && res.settings) || {};
      settings = Object.assign({}, DEFAULTS, got);
      // ensure arrays exist
      settings.listings = settings.listings || [];
      settings.followUps = settings.followUps || [];
      settings.videos = settings.videos || [];
      fieldsToForm();
      renderListings();
      renderFollowUps();
      renderVideos();
    });
  }

  load();
})();
