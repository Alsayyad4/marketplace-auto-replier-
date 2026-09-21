/* SubSell — options page (tabbed). Reads/writes the full settings object
 * in chrome.storage.local. Tables for listings / follow-ups / videos. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  const DEFAULTS = {
    enabled: false,
    apiKey: "",
    model: "claude-haiku-4-5",
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
    closerIntensity: "medium",
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
    demoVideoUrls: [],
    demoVideoDelaySec: 10,
    demoVideoBetweenSec: 8,
    videoRetryMax: 2,
    videoLinkFallback: true, // legacy, ignored since .56
    videoLinkOptIn: false,
    videoLinkUrl: "",
    videoLinkText: "",
    smartFollowupEnabled: false,
    smartFollowupMaxCount: 1,
    smartFollowupQuietHours: 6,
    smartFollowupGapHours: 24,
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
    ["closerIntensity", "value"],
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
    ["smartFollowupEnabled", "checked"],
    ["smartFollowupMaxCount", "number"],
    ["smartFollowupQuietHours", "number"],
    ["smartFollowupGapHours", "number"],
    ["demoVideoDelaySec", "number"],
    ["demoVideoBetweenSec", "number"],
    ["videoRetryMax", "number"],
    // videoLinkOptIn / videoLinkUrl / videoLinkText: removed from the form. The
    // demo is sent as a FILE or not at all (sender deleted in v0.21.60).
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
      // (v0.21.60) A <select> shows BLANK when it is set to a value it has no
      // option for, and then reads back as "". DEFAULTS.model was exactly such a
      // value, so on any machine without a cloud config the Model box appeared
      // empty — and pressing Save published model:"" to the whole account, which
      // stops every bot replying. A blank choice never overwrites a real one.
      if (id === "model" && kind === "value" && !String(el.value || "").trim()) continue;
      if (kind === "checked") settings[id] = el.checked;
      else if (kind === "number") {
        // A BLANK box must not silently save 0 (Number("") === 0) — that zeroed the
        // video delay/gap timings whenever a field was left empty. Blank = keep the
        // previously saved value (or the default).
        const n = Number(el.value);
        if (el.value.trim() !== "" && Number.isFinite(n)) settings[id] = n;
      }
      // (v0.21.60) Same rule for the API key. It is a password field, it is easy
      // to see it empty and press Save, and an empty key stops every machine.
      else if (id === "apiKey" && !String(el.value || "").trim()) { /* keep what is stored */ }
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
  // Read-only list of central demo videos (uploaded/removed in the web app).
  function renderCentralVideos() {
    const el = $("centralVideoList");
    if (!el) return;
    const vids = Array.isArray(settings.demoVideoUrls) ? settings.demoVideoUrls : [];
    if (!vids.length) {
      el.textContent = "None set in the web app.";
      return;
    }
    el.innerHTML = "";
    vids.forEach((v, i) => {
      const row = document.createElement("div");
      const a = document.createElement("a");
      a.href = v.url;
      a.target = "_blank";
      a.textContent = `${i + 1}. ${v.name || "video"}`;
      row.appendChild(a);
      el.appendChild(row);
    });
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
    chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings }, (r) => {
      // (v0.21.61) When the guard folds values back into a save that would have
      // cleared them, say so — a silent repair is how you find out months later.
      const rep = (r && r.repaired) || [];
      $("savedMsg").textContent = rep.length
        ? "Saved ✓ — kept " + rep.length + " field(s) a blank form would have cleared (" +
          rep.slice(0, 3).join(", ") + (rep.length > 3 ? "…" : "") + ")"
        : "Saved ✓ (syncs to your other computers)";
      setTimeout(() => ($("savedMsg").textContent = ""), rep.length ? 6000 : 2500);
    });
  }
  $("save").addEventListener("click", save);

  /* ----- remote config (the "permanent link") ----- */
  function loadRemoteConfig() {
    chrome.storage.local.get(["remoteConfigUrl", "remoteConfigAt", "machineLabel"], (r) => {
      if ($("remoteConfigUrl")) $("remoteConfigUrl").value = (r && r.remoteConfigUrl) || "";
      if ($("machineLabel")) $("machineLabel").value = (r && r.machineLabel) || "";
      if ($("configStatus") && r && r.remoteConfigAt)
        $("configStatus").textContent = "last synced " + new Date(r.remoteConfigAt).toLocaleString();
    });
  }
  if ($("remoteConfigUrl")) {
    $("remoteConfigUrl").addEventListener("change", () => {
      // Clear the cached config_key so the activity log re-derives it from the new URL.
      chrome.storage.local.set({ remoteConfigUrl: ($("remoteConfigUrl").value || "").trim(), configKey: "" });
    });
  }
  if ($("machineLabel")) {
    $("machineLabel").addEventListener("change", () => {
      chrome.storage.local.set({ machineLabel: ($("machineLabel").value || "").trim() });
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
  if ($("importConfig")) {
    // (v0.21.62) There was an Export and no Import, so the one backup a machine
    // could make was a file nothing could read back in. Once the account had been
    // emptied and the machines reinstalled, that missing half was the difference
    // between a two-minute recovery and no recovery at all.
    $("importConfig").addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.addEventListener("change", () => {
        const file = input.files && input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          let data;
          try { data = JSON.parse(reader.result); } catch (e) { alert("That file is not valid JSON: " + e.message); return; }
          if (!data || typeof data !== "object" || Array.isArray(data)) { alert("That file does not hold a settings object."); return; }
          delete data.enabled; // on/off stays per machine
          const keys = Object.keys(data).length;
          if (!confirm("Load " + keys + " settings from " + file.name + "?\n\nThis fills the form on this computer. Nothing is sent anywhere until you press Save.")) return;
          settings = Object.assign({}, DEFAULTS, data);
          settings.listings = settings.listings || [];
          settings.followUps = settings.followUps || [];
          settings.videos = settings.videos || [];
          fieldsToForm();
          renderListings();
          renderFollowUps();
          renderVideos();
          renderCentralVideos();
          $("savedMsg").textContent = "Loaded " + keys + " settings from the file — press Save to send them to every computer.";
        };
        reader.readAsText(file);
      });
      input.click();
    });
  }
  loadRemoteConfig();

  /* ----- cloud sync (Supabase web app) ----- */
  function fmtWhen(ts) {
    return ts ? new Date(ts).toLocaleString() : "never";
  }
  function refreshCloudStatus() {
    chrome.runtime.sendMessage({ type: "CLOUD_STATUS" }, (s) => {
      if (chrome.runtime.lastError || !s || !s.ok) return;
      const el = $("cloudStatus");
      if (!el) return;
      if (!s.configured) {
        el.textContent = "Not connected — enter your Supabase URL + anon key, then Save connection.";
      } else if (!s.loggedIn) {
        el.textContent = "Connected to " + s.url + " — log in to start syncing.";
      } else {
        // (v0.21.65) The status line now says what the LAST PULL actually did. A
        // pull that failed used to leave this line reading "logged in · last synced
        // <old time>" — true, and useless: the operator saw a healthy login while
        // nothing from the cloud was reaching the form.
        const lp = s.lastPull || null;
        let pull = "";
        if (lp) {
          pull = lp.ok === false ? "FAILED — " + (lp.error || "unknown error")
            : lp.wiped ? "refused an emptied account, kept this computer's settings" + (lp.healed ? " and put them back" : "")
            : lp.seeded ? "account was empty, set it up again (" + (lp.keys || 0) + " settings)"
            : lp.empty ? "account has no settings in it"
            : lp.unchanged ? "no change"
            : lp.keys ? "applied " + lp.keys + " settings from the account"
            : "ok";
          pull = " · last pull " + fmtWhen(lp.at) + ": " + pull;
        }
        const acct = s.userId ? " · account " + String(s.userId).slice(0, 8) : "";
        el.textContent = "Logged in as " + (s.email || "?") + acct + " · last synced " + fmtWhen(s.lastPullAt) + pull;
      }
    });
  }
  /* ----- (v0.21.60) recovery: put the settings back after an accidental wipe -----
   * The account row can end up full of empty strings (a blank form saved over it).
   * Every bot then runs on defaults with no API key, and the options page looks
   * like a fresh install — which is what makes it feel as if the login is gone.
   * This machine may still hold a good copy in Chrome sync or in its own saved
   * settings; offer the richest one back with one click. */
  let restoreCandidates = [];
  function describeCopy(b) {
    const bits = [];
    if (b.has.apiKey) bits.push("API key");
    if (b.has.businessInfo || b.has.instructions) bits.push("teaching");
    if (b.has.listings) bits.push(b.has.listings + " listing(s)");
    if (b.has.demoVideoUrls) bits.push(b.has.demoVideoUrls + " video(s)");
    if (b.has.coaching) bits.push(b.has.coaching + " coaching note(s)");
    return b.from + (b.at ? " · " + fmtWhen(b.at) : "") + (bits.length ? " · " + bits.join(", ") : " · empty");
  }
  function checkForWipe() {
    chrome.runtime.sendMessage({ type: "CONFIG_BACKUPS" }, (r) => {
      if (chrome.runtime.lastError || !r || !r.ok) return;
      restoreCandidates = r.backups || [];
      const best = restoreCandidates[0];
      // (v0.21.61) The copies this machine holds are listed whether or not anything
      // looks wrong. The old box appeared only when a heuristic fired, so on the
      // machine actually in front of the operator there was no way to ask for a
      // restore at all — the recovery existed and could not be reached.
      const pick = $("restorePick");
      if (pick) {
        pick.innerHTML = "";
        restoreCandidates.forEach((b, i) => {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = describeCopy(b);
          pick.appendChild(o);
        });
        pick.style.display = restoreCandidates.length > 1 ? "" : "none";
      }
      const link = $("restoreOpenLink");
      if (link) link.style.display = restoreCandidates.length ? "" : "none";
      if ($("restoreCfg")) $("restoreCfg").style.display = restoreCandidates.length ? "" : "none";

      // Why the box is showing matters: "the account is empty" and "this computer
      // is behind" need different words and different actions from the operator.
      chrome.runtime.sendMessage({ type: "CLOUD_STATUS" }, (s) => {
        const box = $("wipeWarn");
        if (!box) return;
        const lastPull = (s && s.lastPull) || null;
        const refused = !!(s && s.wipe);
        const accountEmpty = !!(lastPull && lastPull.ok && lastPull.empty);
        const poor = r.currentWeight < 20 || (best && best.weight > r.currentWeight * 2);
        if (!(refused || accountEmpty || (poor && best))) { box.style.display = "none"; return; }
        let title, detail;
        if (refused) {
          title = "⚠️ The shared account came back empty — this computer kept your settings.";
          detail =
            " Another computer saved a blank form over them. Nothing was lost here, and this computer has put them back in the account;" +
            " every other computer picks them up within about a minute.";
        } else if (accountEmpty) {
          title = "⚠️ The shared account has no settings saved in it.";
          detail = best
            ? " This computer still holds a fuller copy. Restoring puts it back here and in the account, so every other computer gets it within about a minute."
            : " This computer holds no copy either. Restore from a computer whose bot still works, or type the settings in here and press Save.";
        } else {
          title = "⚠️ Your saved settings look empty.";
          const bits = [];
          if (best.has.apiKey) bits.push("the API key");
          if (best.has.businessInfo || best.has.instructions) bits.push("your business teaching");
          if (best.has.listings) bits.push(best.has.listings + " listing(s)");
          if (best.has.demoVideoUrls) bits.push(best.has.demoVideoUrls + " demo video(s)");
          if (best.has.coaching) bits.push(best.has.coaching + " coaching note(s)");
          detail =
            " This computer still has a fuller copy in " + best.from +
            (bits.length ? ", including " + bits.join(", ") : "") +
            ". Restoring puts it back here and on every other computer within about a minute.";
        }
        if ($("wipeTitle")) $("wipeTitle").textContent = title;
        $("wipeDetail").textContent = detail;
        box.style.display = "";
      });
    });
  }
  if ($("restoreOpenLink")) {
    $("restoreOpenLink").addEventListener("click", (e) => {
      e.preventDefault();
      const box = $("wipeWarn");
      if (!box) return;
      if (box.style.display === "none" || !box.style.display) {
        if ($("wipeTitle")) $("wipeTitle").textContent = "Earlier copies of your settings on this computer";
        $("wipeDetail").textContent =
          " Pick one and restore it. It is put back here and in the shared account, so every other computer gets it within about a minute.";
        box.style.display = "";
      } else box.style.display = "none";
    });
  }
  if ($("restoreCfg")) {
    $("restoreCfg").addEventListener("click", () => {
      if (!restoreCandidates.length) return;
      const idx = Math.max(0, Number(($("restorePick") && $("restorePick").value) || 0) || 0);
      const b = restoreCandidates[idx];
      if (!b) return;
      if (!confirm("Restore the settings from " + b.from + "?\n\nThis replaces what is saved in the cloud, so every computer gets it within about a minute.")) return;
      $("restoreMsg").textContent = "Restoring…";
      chrome.runtime.sendMessage({ type: "CONFIG_RESTORE", index: idx }, (r) => {
        if (chrome.runtime.lastError || !r || !r.ok) {
          $("restoreMsg").textContent = "Failed: " + ((r && r.error) || (chrome.runtime.lastError && chrome.runtime.lastError.message) || "?");
          return;
        }
        $("restoreMsg").textContent = r.pushed
          ? "Restored ✓ — every computer updates within a minute."
          : "Restored on this computer ✓ (not sent to the cloud: " + (r.pushError || "not logged in") + ")";
        load();
        setTimeout(checkForWipe, 800);
      });
    });
  }

  function persistCloudCreds(cb) {
    const url = ($("supabaseUrl").value || "").trim();
    let anonKey = ($("supabaseAnonKey").value || "").trim();
    // (v0.21.59) Never re-save a legacy Supabase JWT. Machines set up before the
    // project creds were baked into the build have one of these typed in, it is no
    // longer accepted, and while it sat in storage it SHADOWED the working key that
    // ships with the build — which is what locked those machines out of the account.
    // The background now ignores such a key; do not write a fresh copy of it either.
    if (/^eyJ/.test(anonKey)) {
      anonKey = "";
      if ($("supabaseAnonKey")) $("supabaseAnonKey").value = "";
      if ($("cloudMsg")) $("cloudMsg").textContent = "Old-style key cleared — this build has the right one built in.";
    }
    chrome.runtime.sendMessage({ type: "CLOUD_SET_CREDS", url, anonKey }, () => cb && cb());
  }
  if ($("saveCloudCreds")) {
    $("saveCloudCreds").addEventListener("click", () => {
      persistCloudCreds(() => {
        $("cloudMsg").textContent = "Connection saved.";
        setTimeout(() => ($("cloudMsg").textContent = ""), 2000);
        refreshCloudStatus();
      });
    });
  }
  if ($("cloudLogin")) {
    $("cloudLogin").addEventListener("click", () => {
      $("cloudMsg").textContent = "Logging in…";
      // Persist creds first in case they were typed but not explicitly saved.
      persistCloudCreds(() => {
        chrome.runtime.sendMessage(
          { type: "CLOUD_LOGIN", email: ($("cloudEmail").value || "").trim(), password: $("cloudPassword").value },
          (r) => {
            if (chrome.runtime.lastError) {
              $("cloudMsg").textContent = "Error: " + chrome.runtime.lastError.message;
              return;
            }
            if (!r || !r.ok) {
              $("cloudMsg").textContent = "Login failed: " + (r && r.error);
              return;
            }
            $("cloudPassword").value = "";
            // (v0.21.61) Say what came back. This line used to read "pulled your
            // cloud settings" even when the account was empty, which is how a wiped
            // account managed to look like a healthy login with a blank form.
            const p = r.pull || {};
            $("cloudMsg").textContent = p.wiped
              ? "Logged in ✓ — the account was empty, so this computer's settings were put back."
              : p.seeded
              ? "Logged in ✓ — the account was empty, so it was set up again. Only the API key is missing — paste it above and press Save."
              : p.empty
              ? "Logged in ✓ — but the account has no settings saved in it."
              : p.keys
              ? "Logged in ✓ — pulled " + p.keys + " settings from your account."
              : p.unchanged
              ? "Logged in ✓ — already up to date."
              : p.ok === false
              ? "Logged in ✓ — but your settings could NOT be pulled from the account: " + (p.error || "unknown error") + ". Nothing on this page came from the cloud."
              : "Logged in ✓.";
            refreshCloudStatus();
            load(); // re-read merged settings (cloud now wins) into the form
          }
        );
      });
    });
  }
  if ($("cloudLogout")) {
    $("cloudLogout").addEventListener("click", () => {
      chrome.runtime.sendMessage({ type: "CLOUD_LOGOUT" }, () => {
        $("cloudMsg").textContent = "Logged out.";
        setTimeout(() => ($("cloudMsg").textContent = ""), 2000);
        refreshCloudStatus();
        load();
      });
    });
  }
  if ($("cloudPull")) {
    $("cloudPull").addEventListener("click", () => {
      $("cloudMsg").textContent = "Pulling…";
      chrome.runtime.sendMessage({ type: "CLOUD_PULL" }, (r) => {
        if (chrome.runtime.lastError) {
          $("cloudMsg").textContent = "Error: " + chrome.runtime.lastError.message;
          return;
        }
        $("cloudMsg").textContent = !r || !r.ok
          ? "Failed: " + (r && r.error)
          : r.wiped
          ? "The account came back empty — kept this computer's settings and put them back."
          : r.empty
          ? "No settings are saved in the account yet."
          : r.unchanged
          ? "Already up to date ✓"
          : "Synced ✓ (" + (r.keys || 0) + " settings)";
        refreshCloudStatus();
        load();
        checkForWipe();
      });
    });
  }
  function loadCloud() {
    chrome.storage.local.get(["supabaseUrl", "supabaseAnonKey"], (r) => {
      if ($("supabaseUrl")) $("supabaseUrl").value = (r && r.supabaseUrl) || "";
      // A legacy JWT here is ignored by the background (see getCloudCreds), so do
      // not show it as though it were the key in use — it would only get re-saved.
      const shown = (r && r.supabaseAnonKey) || "";
      if ($("supabaseAnonKey")) $("supabaseAnonKey").value = /^eyJ/.test(shown) ? "" : shown;
      refreshCloudStatus();
    });
  }
  loadCloud();

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
  /* ----- (v0.21.53) POWER SWITCHES — THIS COMPUTER ONLY, never synced -----
   * These four grab the desktop (focus, a floating window, a real click on
   * Messenger's attach button). A stale `videoForeground:true` left in the SHARED
   * cloud row by the v0.21.48-.50 dashboard armed the whole fleet at once and gave
   * the operator "crazy stuff on the computer" (PC-1zysp: fg=60 in 7 minutes). They
   * are per-machine local storage now, so arming one machine can never arm the rest. */
  const POWER_KEYS = ["videoForeground", "videoPip", "videoTrustedChannels", "videoActivateTab"];
  chrome.storage.local.get(POWER_KEYS, (r) => {
    for (const k of POWER_KEYS) if ($(k)) $(k).checked = !!(r && r[k]);
  });
  for (const k of POWER_KEYS) {
    if (!$(k)) continue;
    $(k).addEventListener("change", () => {
      const o = {};
      o[k] = $(k).checked;
      chrome.storage.local.set(o);
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
      renderCentralVideos();
      checkForWipe(); // (v0.21.60) offer a restore if the account looks emptied
      // (v0.21.63) The one thing no recovery can supply. Say so where the box is.
      if ($("apiKeyMissing")) $("apiKeyMissing").style.display = String(settings.apiKey || "").trim() ? "none" : "";
    });
  }

  load();
})();
