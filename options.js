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
    instantVideoEnabled: false,
    instantVideoCaption: "",
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
    ["instantVideoEnabled", "checked"],
    ["instantVideoCaption", "value"],
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

  /* ----- intro video (uploaded from this computer; stored in local storage,
   * NOT in the synced settings — videos are far too big for chrome.storage.sync,
   * so it lives under its own `instantVideo` key and saves the instant you pick
   * a file, independent of the Save button). ----- */
  function fmtSize(bytes) {
    if (bytes == null) return "";
    const mb = bytes / 1048576;
    return mb >= 1 ? mb.toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";
  }
  function showInstantVideoInfo(v) {
    const el = $("instantVideoInfo");
    if (!el) return;
    el.textContent =
      v && v.name
        ? `Stored on this computer: ${v.name} (${fmtSize(v.size)}).`
        : "No video uploaded on this computer yet.";
  }
  function loadInstantVideoInfo() {
    chrome.storage.local.get(["instantVideo"], (res) => showInstantVideoInfo(res.instantVideo));
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || "");
        const comma = s.indexOf(","); // strip the "data:...;base64," prefix
        resolve(comma >= 0 ? s.slice(comma + 1) : s);
      };
      r.onerror = () => reject(r.error || new Error("read failed"));
      r.readAsDataURL(file);
    });
  }
  const instantVideoFileEl = $("instantVideoFile");
  if (instantVideoFileEl) {
    instantVideoFileEl.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const info = $("instantVideoInfo");
      if (!/^video\//.test(file.type || "")) {
        if (info) info.textContent = "That doesn't look like a video file.";
        return;
      }
      if (info) info.textContent = `Saving ${file.name}…`;
      try {
        const base64 = await fileToBase64(file);
        chrome.storage.local.set(
          { instantVideo: { base64, mime: file.type || "video/mp4", name: file.name, size: file.size } },
          () => {
            if (chrome.runtime.lastError) {
              if (info) info.textContent = "Could not save: " + chrome.runtime.lastError.message;
            } else {
              showInstantVideoInfo({ name: file.name, size: file.size });
            }
          }
        );
      } catch (err) {
        if (info) info.textContent = "Could not read the file: " + (err && err.message);
      }
    });
  }
  const removeInstantVideoEl = $("removeInstantVideo");
  if (removeInstantVideoEl) {
    removeInstantVideoEl.addEventListener("click", () => {
      chrome.storage.local.remove("instantVideo", () => {
        if (instantVideoFileEl) instantVideoFileEl.value = "";
        showInstantVideoInfo(null);
      });
    });
  }

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
      loadInstantVideoInfo();
    });
  }

  load();
})();
