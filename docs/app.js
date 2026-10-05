/* SubSell — cloud settings dashboard (Supabase).
 * Auth (Google or email/password) → edit the settings JSON in `subsell_configs`
 * → show the per-user config URL (Edge Function) the extension fetches.
 * The JSON shape matches DEFAULTS/buildSystemPrompt() in the extension's
 * background.js (see SPEC-webapp.md). Unknown/advanced fields in a loaded config
 * are preserved on save (we only overwrite the fields shown here). */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  /* Full settings set — mirrors DEFAULTS in the extension's background.js and the
   * tabs in SETTINGS-REFERENCE.md. `enabled` is per-machine and excluded. */
  const DEFAULTS = {
    apiKey: "",
    model: "claude-haiku-4-5", // MUST match background.js DEFAULTS — a mismatch here silently re-pins the whole fleet on the next save
    responseDelaySec: 30,
    jitterSec: 60,
    typingPaceMaxSec: 20, // (v0.21.71) MUST match background.js DEFAULTS
    threadMemory: true, // (v0.21.71) MUST match background.js DEFAULTS
    hourlyCap: 30,
    dailyCap: 200,
    maxRepliesPerConvo: 5,
    convoCapBehavior: "stop",
    wpmMin: 38,
    wpmMax: 78,
    businessHoursEnabled: true,
    businessHoursStart: 9,
    businessHoursEnd: 22,
    humanCadence: true,
    skipChance: 0.12,
    breakChance: 0.05,
    breakMinMin: 3,
    breakMaxMin: 18,
    warmupEnabled: true,
    warmupDays: 7,
    warmupStartCap: 10,
    offPlatformGuard: true,
    closerMode: true,
    closerIntensity: "medium",
    noExactPrices: true,
    visitConfirmEnabled: true,
    visitConfirmAfterMin: 120,
    businessName: "SubSell",
    businessAddress: "757 Rue Beaubien E, Montréal",
    businessHoursText: "9AM–10PM, 7 days",
    businessInfo: "",
    instructions: "",
    examples: "",
    closerGoals: "",
    priceList: "",
    visitConfirmMessage: "",
    listings: [],
    followUps: [],
    videos: [],
    demoVideoUrls: [], // central demo videos (uploaded to Supabase Storage) [{name,url}]
    demoVideoDelaySec: 10,
    demoVideoBetweenSec: 8,
    videoRetryMax: 2, // native attach retries per chat before the link fallback
    videoCompleteSet: true, // (v0.21.72) MUST match background.js DEFAULTS — every clip, exactly once per chat
    videoLinkFallback: false, // (v0.21.69) legacy — but machines stuck on .47-.51 READ it from the row and send a link unless it is exactly false
    // (v0.21.66) demo-link keys: kept ONLY so stored configs parse — no form, no
    // reader, no link is ever sent. Mirrors background.js DEFAULTS.
    videoLinkOptIn: false,
    videoLinkUrl: "",
    videoLinkText: "",
    // (v0.21.53) the four power switches moved OUT of the shared config: a stale
    // videoForeground:true in this row was grabbing the desktop on the whole fleet.
    // They are per-machine now (extension Settings -> Videos), never synced.
    smartFollowupEnabled: false,
    smartFollowupMaxCount: 1,
    smartFollowupQuietHours: 6,
    smartFollowupGapHours: 24,
    coaching: [], // graded real replies from the Activity tab (👍/👎+correction) — fed into every bot's prompt
    ownerTeachingOnly: true, // (v0.21.73) MUST match background.js DEFAULTS — the bot answers only from the owner's text
  };

  const VIDEO_BUCKET = "subsell-videos"; // Supabase Storage bucket for central demo videos

  const FIELDS = [
    ["apiKey", "value"], ["model", "value"],
    ["responseDelaySec", "number"], ["jitterSec", "number"],
    ["typingPaceMaxSec", "number"], ["threadMemory", "checked"], // (v0.21.71)
    ["hourlyCap", "number"], ["dailyCap", "number"],
    ["maxRepliesPerConvo", "number"], ["convoCapBehavior", "value"],
    ["wpmMin", "number"], ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"], ["businessHoursStart", "number"], ["businessHoursEnd", "number"],
    ["humanCadence", "checked"], ["skipChance", "number"], ["breakChance", "number"], ["breakMinMin", "number"], ["breakMaxMin", "number"],
    ["warmupEnabled", "checked"], ["warmupDays", "number"], ["warmupStartCap", "number"],
    ["offPlatformGuard", "checked"], ["closerMode", "checked"], ["closerIntensity", "value"], ["noExactPrices", "checked"],
    ["visitConfirmEnabled", "checked"], ["visitConfirmAfterMin", "number"],
    ["businessName", "value"], ["businessAddress", "value"], ["businessHoursText", "value"],
    ["ownerTeachingOnly", "checked"], // (v0.21.73)
    ["businessInfo", "value"], ["instructions", "value"], ["examples", "value"],
    ["closerGoals", "value"], ["priceList", "value"], ["visitConfirmMessage", "value"],
    ["demoVideoDelaySec", "number"], ["demoVideoBetweenSec", "number"],
    ["videoRetryMax", "number"], ["videoCompleteSet", "checked"], // (v0.21.72)
    // videoLinkOptIn / videoLinkUrl / videoLinkText: no field any more. The demo
    // is sent as a FILE or not at all — the link sender was deleted in v0.21.60
    // and the owner asked for the option itself to go ("sounds like a scam").
    ["smartFollowupEnabled", "checked"], ["smartFollowupMaxCount", "number"],
    ["smartFollowupQuietHours", "number"], ["smartFollowupGapHours", "number"],
  ];

  // (v0.21.56) Fields whose REAL default text lives in the extension (background.js
  // DEFAULTS), not here. Blank means "use the extension's", never "".
  const EXT_DEFAULT_TEXT = { businessInfo: 1, instructions: 1, closerGoals: 1 };
  // (v0.21.60) Blank must never ERASE these two either. A <select> set to a value
  // it has no option for shows blank and reads back as "", and the API key box can
  // simply look empty — and an empty model or key stops every bot on the account.
  const NEVER_BLANK = { model: 1, apiKey: 1 };
  // (v0.21.69) Machines stuck on v0.21.47-.51 (their self-updater never fires)
  // still read `videoLinkFallback` from this row and send the demo as a raw
  // storage LINK unless it is exactly false. Every save writes these four so no
  // edit here can ever re-arm them. Mirrors LEGACY_LINK_OFF in background.js.
  const LEGACY_LINK_OFF = { videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "" };
  let settings = Object.assign({}, DEFAULTS); // working copy (preserves loaded advanced fields)
  const liveSettings = () => settings; // formToFields shadows the name when it reads into a copy
  // (v0.21.56) Nothing may be written to the shared row until THIS page has read
  // it. `settings` starts as pristine DEFAULTS and the Save handler is bound at
  // module evaluation, so a click (or, since auto-save, a keystroke) before the
  // network round trip finished would have overwritten the whole fleet's config
  // with empty defaults — no confirmation, no undo, live on every machine in 60 s.
  let rowLoaded = false;
  let loadedStamp = null; // the row's updated_at when we read it — our write precondition
  let configKey = "";
  let client = null;
  let session = null;

  /* ---------------- tabs ---------------- */
  document.querySelectorAll(".tab").forEach((t) => {
    t.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
      document.querySelectorAll("section.pane").forEach((x) => x.classList.remove("active"));
      t.classList.add("active");
      $(t.dataset.tab).classList.add("active");
    });
  });

  /* ---------------- form <-> settings ---------------- */
  function fieldsToForm() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") el.checked = !!settings[id];
      else el.value = settings[id] != null ? settings[id] : "";
    }
  }
  // `into` (v0.21.73): read the form into a COPY instead of the working settings —
  // how the page learns what a save with no edits would write (see snapshotBase).
  function formToFields(into) {
    const settings = into || liveSettings();
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") settings[id] = el.checked;
      else if (kind === "number") {
        // A BLANK box must not silently save 0 (Number("") === 0) — that zeroed the
        // video delay/gap timings whenever a field was left empty. Blank = keep the
        // previously saved value (or the default).
        const n = Number(el.value);
        if (el.value.trim() !== "" && Number.isFinite(n)) settings[id] = n;
      }
      else if (NEVER_BLANK[id] && !String(el.value || "").trim()) { /* keep what is saved */ }
      else if (EXT_DEFAULT_TEXT[id] && !el.value.trim()) {
        // (v0.21.56) A BLANK box must not silently erase real instructions. These
        // three ship with substantial text in background.js DEFAULTS while this
        // page's DEFAULTS have "", so an unconditional write persisted "" and
        // buildSystemPrompt then fed Claude an empty BUSINESS INFO / INSTRUCTIONS /
        // closer playbook. Deleting the key instead lets the extension's own
        // default win the merge again. Same principle as the number branch above.
        delete settings[id];
      }
      else settings[id] = el.value;
    }
  }

  /* ---------------- table editor ---------------- */
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
          item[col.key] = col.type === "checkbox" ? input.checked : col.type === "number" ? Number(input.value) : input.value;
        });
        td.appendChild(input);
        tr.appendChild(td);
      }
      const tdDel = document.createElement("td");
      const del = document.createElement("button");
      del.textContent = "✕";
      del.className = "danger";
      del.addEventListener("click", () => { items.splice(idx, 1); onChange(); });
      tdDel.appendChild(del);
      tr.appendChild(tdDel);
      tbody.appendChild(tr);
    });
  }
  function renderListings() {
    renderTable("#listingsTable tbody", settings.listings, [
      { key: "title" }, { key: "model" }, { key: "storage" }, { key: "condition" },
      { key: "price", type: "number" }, { key: "videoUrl" }, { key: "available", type: "checkbox" },
    ], renderListings);
  }
  function renderFollowUps() {
    renderTable("#followupsTable tbody", settings.followUps, [
      { key: "name" }, { key: "afterMinutes", type: "number" }, { key: "message", type: "textarea" }, { key: "enabled", type: "checkbox" },
    ], renderFollowUps);
  }
  function renderVideos() {
    renderTable("#videosTable tbody", settings.videos, [
      { key: "name" }, { key: "url" }, { key: "notes", type: "textarea" },
    ], renderVideos);
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

  /* ----- central demo videos (uploaded to Supabase Storage) -----
   * (v0.21.72) THE LIST SAVES ITSELF. An upload or a Remove used to change only
   * this page: the status told the operator to press Save, and since v0.21.55 every
   * other field on the dashboard saves by itself — so a list changed and never
   * saved left the bots sending the OLD list (the owner uploaded a second video
   * and the bots kept sending one). Now both write the row at once and say so.
   * Each row also shows the clip's weight: the bots upload every clip into every
   * chat, so a phone's 15 MB original costs each of them several times what a
   * 3–5 MB export does. Sizes missing on older entries are read from the file. */
  const HEAVY_CLIP_BYTES = 8 * 1024 * 1024;
  const fmtMB = (n) => (n > 0 ? (n / 1048576).toFixed(1) + " MB" : "");
  let clipSizeFill = false;
  async function fillClipSizes() {
    if (clipSizeFill || typeof fetch !== "function") return;
    clipSizeFill = true;
    let changed = false;
    try {
      for (const v of settings.demoVideoUrls || []) {
        if (!v || !v.url || v.size > 0) continue;
        try {
          const r = await fetch(v.url, { method: "HEAD" });
          const n = Number((r.headers && r.headers.get && r.headers.get("content-length")) || 0);
          if (r.ok && n > 0) { v.size = n; changed = true; }
        } catch (e) { /* the size stays unknown — nothing depends on it */ }
      }
    } finally { clipSizeFill = false; }
    if (changed) renderDemoVideos(true);
  }
  // Two entries are the SAME FILE when the name and the byte size both match.
  const sameClip = (a, b) => !!(a && b && a.name && a.name === b.name && a.size > 0 && a.size === b.size);
  // `url` (uploads): after a failed save the page may have RELOADED another
  // device's newer row — then the new entry is gone from the list and "press
  // Save" would be a lie; say what actually has to be done.
  async function saveVideoList(what, url) {
    const status = $("demoVideoStatus");
    // one save at a time: a debounced auto-save about to fire would send the same
    // row stamp and one of the two would read as "someone else saved first"
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    autoPending = true; // the leave-page guard covers the save in flight
    let ok = false;
    try { ok = await saveConfig(true); } finally { autoPending = false; }
    if (status) {
      status.className = ok ? "saved" : "err";
      const stillListed = !url || (settings.demoVideoUrls || []).some((o) => o && o.url === url);
      status.textContent = ok
        ? what + " ✓ — saved. Every bot has the new list within ~1 min."
        : stillListed
          ? what + " on this page, but NOT saved (the line at the bottom says why) — press Save to cloud."
          : "NOT saved: another device changed the settings at the same moment and its version was loaded — upload the video again.";
    }
    return ok;
  }
  function renderDemoVideos(noFill) {
    const el = $("demoVideoList");
    if (!el) return;
    const vids = settings.demoVideoUrls || [];
    if (!vids.length) {
      el.textContent = "No central videos yet.";
      return;
    }
    el.innerHTML = "";
    vids.forEach((v, i) => {
      const row = document.createElement("div");
      row.className = "row";
      const a = document.createElement("a");
      a.href = v.url;
      a.target = "_blank";
      a.textContent = `${i + 1}. ${v.name || "video"}`;
      const meta = document.createElement("span");
      meta.className = "hint";
      const dupOf = vids.findIndex((o, k) => k < i && sameClip(o, v));
      meta.textContent =
        (v.size > 0 ? " " + fmtMB(v.size) : "") +
        (v.size > HEAVY_CLIP_BYTES ? " — heavy: every bot uploads it into every chat; a 720p export (3–5 MB) sends much faster" : "") +
        (dupOf >= 0 ? " — same file as #" + (dupOf + 1) + ": the bots send it once" : "");
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Remove";
      del.addEventListener("click", async () => {
        vids.splice(i, 1);
        renderDemoVideos();
        await saveVideoList("Removed");
      });
      row.appendChild(a);
      row.appendChild(meta);
      row.appendChild(del);
      el.appendChild(row);
    });
    const note = document.createElement("div");
    note.className = "hint";
    note.textContent =
      "The bots send " + (vids.length === 1 ? "this video" : "these " + vids.length + " videos") +
      ", in this order, once per chat — never the same one twice. A chat that already has a video is not sent it again; " +
      "a buyer who writes after you add a video receives only the new one.";
    el.appendChild(note);
    if (!noFill) fillClipSizes();
  }
  if ($("demoVideoFile")) {
    $("demoVideoFile").addEventListener("change", async () => {
      const f = $("demoVideoFile").files && $("demoVideoFile").files[0];
      if (!f) return;
      const status = $("demoVideoStatus");
      // the same file already in the list (same name, same size) is not added twice
      const dupI = (settings.demoVideoUrls || []).findIndex((o) => sameClip(o, { name: f.name, size: f.size }));
      if (dupI >= 0) {
        status.className = "hint";
        status.textContent = `${f.name} is already in the list (#${dupI + 1}) — not added twice.`;
        $("demoVideoFile").value = "";
        return;
      }
      status.className = "hint";
      status.textContent = `Uploading ${f.name}…`;
      const safe = f.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
      const path = `${session.user.id}/${Date.now()}-${safe}`;
      const up = await client.storage.from(VIDEO_BUCKET).upload(path, f, { upsert: true, contentType: f.type || "video/mp4" });
      if (up.error) {
        status.className = "err";
        status.textContent = "Upload failed: " + up.error.message + " (did you run the Storage setup SQL?)";
        return;
      }
      const url = client.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
      settings.demoVideoUrls = settings.demoVideoUrls || [];
      settings.demoVideoUrls.push({ name: f.name, url, size: f.size || 0 });
      renderDemoVideos();
      $("demoVideoFile").value = "";
      await saveVideoList("Uploaded", url); // (v0.21.72) the list saves itself — nothing left to press
    });
  }

  function renderAll() {
    settings.listings = settings.listings || [];
    settings.followUps = settings.followUps || [];
    settings.videos = settings.videos || [];
    settings.demoVideoUrls = settings.demoVideoUrls || [];
    settings.coaching = settings.coaching || [];
    fieldsToForm();
    renderListings();
    renderFollowUps();
    renderVideos();
    renderDemoVideos();
    renderCoaching();
    wireAutoSave();       // (v0.21.55) every field auto-saves from here on
    renderTeachPreview(); // and the "what the bot learns" panel tracks it
  }

  /* ---------------- config URL ---------------- */
  function buildUrl() {
    const base = (window.SUBSELL_SUPABASE_URL || "").replace(/\/+$/, "");
    $("configUrl").value = configKey ? `${base}/functions/v1/subsell-config?key=${configKey}` : "";
  }
  $("copyUrl").addEventListener("click", async () => {
    const v = $("configUrl").value;
    if (!v) return;
    try { await navigator.clipboard.writeText(v); flash("Copied ✓"); }
    catch (e) { $("configUrl").select(); flash("Press Ctrl+C to copy"); }
  });
  $("regenKey").addEventListener("click", async () => {
    if (!confirm("Make a new config URL? The old one will stop working — you'll need to re-paste the new URL into each extension.")) return;
    const newKey = (crypto.randomUUID && crypto.randomUUID().replaceAll("-", "")) || String(Date.now()) + Math.random().toString(16).slice(2);
    const { error } = await client.from("subsell_configs").update({ config_key: newKey }).eq("user_id", session.user.id);
    if (error) { flash("Failed: " + error.message, true); return; }
    configKey = newKey;
    buildUrl();
    flash("New URL generated — re-paste it into your extensions.");
  });

  function flash(msg, isErr) {
    const el = $("savedMsg");
    el.className = isErr ? "err" : "saved";
    el.textContent = msg;
    setTimeout(() => (el.textContent = ""), 4000);
  }

  /* ---------------- Supabase data ---------------- */
  async function loadConfig() {
    let { data, error } = await client.from("subsell_configs").select("config, config_key, updated_at").maybeSingle();
    if (error) { flash("Load failed: " + error.message, true); return; }
    if (!data) {
      // No row yet (trigger/backfill not run) — create one for this user.
      const ins = await client.from("subsell_configs").insert({ user_id: session.user.id }).select("config, config_key, updated_at").maybeSingle();
      if (ins.error) { flash("No config row and couldn't create one (" + ins.error.message + "). Run supabase/schema.sql.", true); return; }
      data = ins.data;
    }
    settings = Object.assign({}, DEFAULTS, data.config || {}); // keep any advanced fields present
    configKey = data.config_key || "";
    loadedStamp = data.updated_at || null;
    rowLoaded = true; // saving is unlocked only now
    if ($("save")) $("save").disabled = false;
    renderAll();
    buildUrl();
    snapshotBase(); // (v0.21.73) the row as read — what a merge compares this page's edits against
    loadFleet(); // which computers answer with this teaching (never blocks the load)
    try { // (v0.21.70) the draft offer is in the finally: nothing on this load may clear it first
    // (v0.21.66) A DEAD account — no API key AND nothing it has been taught — is
    // what a blank-form save leaves behind, and what the operator was looking at:
    // blank Model, "No central videos yet", "No lessons yet". The extension puts
    // the starter setup back on login, but this page is where the operator
    // actually is, already signed in, so it does the same thing right here: merge
    // the starter setup into whatever the row still holds and save it. Every
    // machine has it within a minute. Nothing real is overwritten (a dead row has
    // nothing real in the seeded fields), and a working account never qualifies.
    if (accountIsDead(data.config || {}) && window.SUBSELL_SEED) {
      settings = Object.assign({}, settings, window.SUBSELL_SEED);
      renderAll();
      const saved = await saveConfig(true, SYSTEM_SAVE);
      flash(saved
        ? "Your account was empty — the SubSell starter setup was put back (business info, hours, 2 demo videos). Only the API key is missing: paste it on the General tab."
        : "Your account is empty and the starter setup could not be saved — press Save to cloud to retry.", !saved);
      return;
    }
    // (v0.21.69) The row still carries the stale builds' link gate armed (every
    // save before .69 wrote videoLinkFallback:true). This page is signed in and
    // already holds the row, so it switches the gate off right now — the same
    // write an updated machine would make on its next pull, only sooner. Fires
    // once per account: after this save the row reads off and never qualifies.
    if (legacyLinkArmed(data.config || {})) {
      const saved = await saveConfig(true, SYSTEM_SAVE);
      flash(saved
        ? "Switched the old demo-link fallback OFF for every computer — machines on old builds stop sending the video as a link on their next sync."
        : "Loaded from cloud.");
      return;
    }
    flash(data.config && Object.keys(data.config).length ? "Loaded from cloud." : "New config — fill it in and save.");
    } finally {
      offerDraft(); // (v0.21.70) teaching a refused save left behind in this browser — after the load-time saves, which never touch it
    }
  }
  // Mirrors legacyLinkArmed() in background.js: the .47-.55 sender fires unless
  // videoLinkFallback is exactly false; .56/.57 fire on videoLinkOptIn === true.
  function legacyLinkArmed(cfg) {
    if (!cfg || typeof cfg !== "object") return false;
    const txt = (k) => String(cfg[k] == null ? "" : cfg[k]).trim();
    return cfg.videoLinkFallback !== false || cfg.videoLinkOptIn === true || !!txt("videoLinkUrl") || !!txt("videoLinkText");
  }
  // Same rule as background.js accountIsDead(): a real, working account always has
  // a key, so this can never fire on one.
  function accountIsDead(cfg) {
    const blank = (k) => !String((cfg && cfg[k]) == null ? "" : cfg[k]).trim();
    return blank("apiKey") && blank("businessInfo") && blank("instructions");
  }

  /* ---- (v0.21.70) WHEN A SAVE IS REFUSED ----
   * For a week every save died in the database with a message nobody could act
   * on — "new row violates row-level security policy for table
   * subsell_config_history": the safety-net trigger from config-safety.sql ran
   * with the operator's rights and could not write its own history table, so the
   * dashboard said "Not saved" and every extension's push failed silently. The
   * page now (1) says what that means and hands over the cure: one click copies
   * the corrected SQL, one opens the SQL editor; and (2) never lets the typed
   * teaching evaporate: the text fields of a refused save are kept in this
   * browser and offered back the next time the page loads. ---- */
  const SQL_FIX_URLS = [
    "https://raw.githubusercontent.com/alsayyad4/marketplace-auto-replier-/claude/wizardly-noether-Oi6vP/supabase/config-safety.sql",
    "../supabase/config-safety.sql",
  ];
  function sqlEditorUrl() {
    try { return "https://supabase.com/dashboard/project/" + new URL(window.SUBSELL_SUPABASE_URL).hostname.split(".")[0] + "/sql/new"; }
    catch (e) { return "https://supabase.com/dashboard"; }
  }
  // The one save error with a known, one-paste cure.
  function isHistoryRlsError(error) {
    const m = String((error && error.message) || "");
    return /subsell_config_history/i.test(m) && /row-level security|permission denied/i.test(m);
  }
  function explainSaveError(error) {
    if (isHistoryRlsError(error)) {
      return "Not saved \u2014 the account's safety net (a database trigger) is refusing every write, from every computer. One-time fix below. Your text stays on this page.";
    }
    return "Not saved: " + ((error && error.message) || "unknown error");
  }
  async function fetchSqlFix() {
    for (const u of SQL_FIX_URLS) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (r.ok) { const t = await r.text(); if (/subsell_guard_config/.test(t) && /security definer/i.test(t)) return t; }
      } catch (e) { /* try the next copy */ }
    }
    return "";
  }
  function hideFixBanner() { const el = $("fixBanner"); if (el) { el.classList.add("hidden"); el.innerHTML = ""; } }
  function showFixBanner(error) {
    const el = $("fixBanner");
    if (!el) return;
    el.innerHTML = "";
    el.classList.remove("hidden");
    const msg = document.createElement("span");
    msg.textContent = "The database refused the save (" + String((error && error.message) || "").slice(0, 110) + "). Fix it once, for every computer: ";
    const copy = document.createElement("button");
    copy.type = "button"; copy.className = "primary"; copy.textContent = "1. Copy the fix";
    copy.addEventListener("click", async () => {
      copy.disabled = true; copy.textContent = "Fetching\u2026";
      const sql = await fetchSqlFix();
      copy.disabled = false;
      if (!sql) {
        // Never hand over a file that did not pass the check: right after a push the
        // CDN can still serve the OLD copy, and pasting that re-installs the bug.
        copy.textContent = "1. The corrected file is not published yet (or you are offline) \u2014 try again in a few minutes";
        return;
      }
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try { await navigator.clipboard.writeText(sql); copied = true; } catch (e) { /* clipboard blocked */ }
      }
      if (copied) { copy.textContent = "1. Copied \u2713 \u2014 paste it in the SQL editor and press Run"; return; }
      // Clipboard blocked: the text appears right here, ready to select.
      copy.textContent = "1. Clipboard blocked \u2014 click the box below, Ctrl+A, Ctrl+C";
      const ta = document.createElement("textarea");
      ta.readOnly = true; ta.value = sql; ta.style.cssText = "width:100%;height:140px;font:12px/1.3 monospace;";
      ta.addEventListener("focus", () => ta.select());
      el.appendChild(ta);
    });
    const open = document.createElement("a");
    open.href = sqlEditorUrl(); open.target = "_blank"; open.rel = "noopener"; open.textContent = "2. Open the SQL editor";
    const then = document.createElement("span");
    then.textContent = "3. Paste, Run (\u201cSuccess. No rows returned\u201d), come back here and press Save to cloud.";
    el.appendChild(msg); el.appendChild(copy); el.appendChild(open); el.appendChild(then);
  }

  // The teaching typed into a save the database refused, kept in THIS browser only
  // (never the API key), per account, and offered back on the next load. The offer
  // has its own element (#draftBanner) and its own lifecycle: load-time SYSTEM saves
  // (the seed, the legacy-link disarm) never keep or clear it, and while an offer is
  // on screen no later save may overwrite or delete the stored draft — only the
  // operator's own click ("Put my text back" / "Discard it") ends it. The first
  // draft of this code ran the offer BEFORE those load-time saves, which then
  // destroyed it on every reload; the 3-refuter review caught that.
  const DRAFT_KEY = "subsell_unsaved_teaching";
  const DRAFT_FIELDS = ["businessName", "businessAddress", "businessHoursText", "businessInfo", "instructions", "examples", "closerGoals", "priceList", "visitConfirmMessage"];
  const asText = (v) => (v == null ? "" : String(v));
  let draftOffered = false; // an offer is on screen: the stored draft is frozen until the operator decides
  function draftKey() { return DRAFT_KEY + (session && session.user && session.user.id ? ":" + session.user.id : ""); }
  function keepDraft() {
    try {
      const d = { at: Date.now(), user: session && session.user ? session.user.id : null, fields: {}, coaching: Array.isArray(settings.coaching) ? settings.coaching : [] };
      for (const k of DRAFT_FIELDS) d.fields[k] = asText(settings[k]);
      localStorage.setItem(draftKey(), JSON.stringify(d));
    } catch (e) { /* storage blocked or full: nothing to keep */ }
  }
  function keepTypedDraft() { if (!draftOffered) keepDraft(); }
  function clearDraft() { try { localStorage.removeItem(draftKey()); } catch (e) { /* ignore */ } }
  function readDraft() { try { return JSON.parse(localStorage.getItem(draftKey()) || "null"); } catch (e) { return null; } }
  function hideDraftBanner() { const el = $("draftBanner"); if (el) { el.classList.add("hidden"); el.innerHTML = ""; } }
  function offerDraft() {
    const d = readDraft();
    if (!d || !d.fields) return;
    if (d.user && session && session.user && d.user !== session.user.id) return; // another account's text
    const diff = DRAFT_FIELDS.filter((k) => asText(d.fields[k]) !== asText(settings[k]));
    const coachDiff = JSON.stringify(d.coaching || []) !== JSON.stringify(settings.coaching || []);
    if (!diff.length && !coachDiff) { clearDraft(); draftOffered = false; hideDraftBanner(); return; } // it landed after all (or was retyped)
    const el = $("draftBanner");
    if (!el) return;
    el.innerHTML = "";
    el.classList.remove("hidden");
    draftOffered = true;
    const msg = document.createElement("span");
    msg.textContent = "Teaching you typed on " + new Date(d.at).toLocaleString() + " never reached the cloud \u2014 text and lessons only (" +
      diff.concat(coachDiff ? ["lessons"] : []).join(", ") + "). ";
    const put = document.createElement("button");
    put.type = "button"; put.className = "primary"; put.textContent = "Put my text back and save";
    put.addEventListener("click", async () => {
      for (const k of diff) settings[k] = d.fields[k];
      if (coachDiff) settings.coaching = d.coaching;
      renderAll();
      draftOffered = false;
      hideDraftBanner();
      await saveConfig(false); // a landed save clears the draft; a refused one keeps it again
    });
    const drop = document.createElement("button");
    drop.type = "button"; drop.textContent = "Discard it";
    drop.addEventListener("click", () => {
      if (!confirm("Throw away the teaching typed on " + new Date(d.at).toLocaleString() + "? This cannot be undone.")) return;
      clearDraft(); draftOffered = false; hideDraftBanner();
    });
    el.appendChild(msg); el.appendChild(put); el.appendChild(drop);
  }

  /* ==== TEACHING-MIRROR-BEGIN (v0.21.73) — the same code as background.js; store/smoke-teach.js fails on drift ==== */
  // What an empty Instructions / Closer-goals box means to the bot when "Answer
  // only from what I teach" is on: one neutral line each, never a fact about the shop.
  const OWNER_FALLBACK_TONE = "Reply in the buyer's language (French or English). In French, write casual Québec French and say tu. Keep it short and friendly.";
  const OWNER_FALLBACK_CLOSE = "The owner wants buyers to come to the shop in person. Invite them when it fits the conversation.";
  const coachIsRule = (c) => !!c && c.kind !== "good" && (c.note === "always applies" || c.buyer === "(general rule from the boss)");
  function teachCanon(v) {
    if (Array.isArray(v)) return v.map(teachCanon);
    if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = teachCanon(v[k]); return o; }
    return v;
  }
  function teachingFingerprint(cfg, wrote) {
    const c = cfg || {};
    const t = (k, own) => { const s = c[k] == null ? "" : String(c[k]); return (own && wrote && !wrote[k]) || !s.trim() ? "" : s; };
    const parts = {
      only: c.ownerTeachingOnly !== false,
      name: t("businessName"), address: t("businessAddress"), hours: t("businessHoursText"),
      info: t("businessInfo", true), instructions: t("instructions", true), close: t("closerGoals", true),
      examples: t("examples"), prices: t("priceList"),
      closer: !!c.closerMode, intensity: String(c.closerIntensity || "medium"), noPrices: !!c.noExactPrices, guard: !!c.offPlatformGuard,
      listings: Array.isArray(c.listings) ? c.listings : [], coaching: Array.isArray(c.coaching) ? c.coaching : [],
    };
    const s = JSON.stringify(teachCanon(parts));
    let h = 0x811c9dc5; // FNV-1a, 32 bit
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return ("0000000" + (h >>> 0).toString(16)).slice(-8);
  }
  /* ==== TEACHING-MIRROR-END ==== */

  /* ---- (v0.21.73) A SAVE THAT LOSES THE RACE MERGES — IT IS NOT DROPPED ----
   * Every save carries the row stamp this page read, and a save whose stamp is stale
   * used to be thrown away: the page reloaded the other writer's version and parked
   * what was typed in a browser draft behind a banner. On the Activity tab that
   * meant a lesson: 👍 turned into ✓, "Rule taught ✓" flashed, and the lesson was
   * not in the cloud — any other tab, the phone, or a computer's own save in
   * between was enough. Now the page re-reads the row, re-applies ONLY what was
   * changed here on top of the other writer's version, and writes that:
   *   - a field edited here wins; a field not touched here keeps their value;
   *   - lists (lessons, listings, follow-ups, videos) merge item by item: what was
   *     added here is added, what was removed here stays removed, theirs is kept.
   * `baseConfig` is the row as this page last knew it, in the form a save writes. */
  let baseConfig = null;
  const cj = (v) => JSON.stringify(teachCanon(v === undefined ? null : v));
  const LIST_KEYS = ["listings", "followUps", "videos", "demoVideoUrls", "coaching"];
  function normalizeForSave(o) {
    const c = Object.assign({}, o);
    delete c.enabled; // per-machine
    for (const k of Object.keys(EXT_DEFAULT_TEXT)) if (!String(c[k] == null ? "" : c[k]).trim()) delete c[k]; // blank = the extension's own line, never ""
    return Object.assign(c, LEGACY_LINK_OFF);
  }
  function snapshotBase() {
    const b = Object.assign({}, settings);
    formToFields(b); // exactly what a save with no edits would send
    baseConfig = JSON.parse(JSON.stringify(normalizeForSave(b)));
  }
  function trimCoaching(list) {
    // (v0.21.55) A standing RULE the boss typed must not be evicted by a run of
    // thumbs-ups: drop the oldest graded EXAMPLE first, rules only when nothing else is left.
    const isRule = (c) => c && c.note === "always applies";
    while (list.length > COACH_MAX) {
      const i = list.findIndex((c) => !isRule(c));
      list.splice(i >= 0 ? i : 0, 1);
    }
    return list;
  }
  function mergeList(base, mine, theirs) {
    const B = new Set((base || []).map(cj)), M = new Set((mine || []).map(cj));
    const out = (theirs || []).filter((x) => !(B.has(cj(x)) && !M.has(cj(x)))); // removed here → stays removed
    const T = new Set(out.map(cj));
    for (const x of mine || []) if (!B.has(cj(x)) && !T.has(cj(x))) out.push(x); // added here → added
    return out;
  }
  function mergeOverTheirs(base, mine, theirsRaw) {
    const fresh = Object.assign({}, DEFAULTS, theirsRaw || {});
    const b = base || {}, m = mine || {};
    for (const k of new Set(Object.keys(b).concat(Object.keys(m)))) {
      if (cj(b[k]) === cj(m[k])) continue; // not touched here: their value stands
      if (LIST_KEYS.includes(k)) fresh[k] = mergeList(b[k], m[k], Array.isArray(fresh[k]) ? fresh[k] : []);
      else if (k in m) fresh[k] = m[k];
      else delete fresh[k];
    }
    if (Array.isArray(fresh.coaching)) trimCoaching(fresh.coaching);
    return normalizeForSave(fresh);
  }
  async function saveMerged(mine) {
    if (!baseConfig) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const got = await client.from("subsell_configs").select("config, config_key, updated_at").maybeSingle();
      if (got.error || !got.data) return null;
      const config = mergeOverTheirs(baseConfig, mine, got.data.config || {});
      let q = client.from("subsell_configs")
        .update({ config, updated_at: new Date().toISOString() })
        .eq("user_id", session.user.id);
      if (got.data.updated_at) q = q.eq("updated_at", got.data.updated_at);
      const res = await q.select("updated_at");
      if (res.error) return { error: res.error };
      if (res.data && res.data.length) return { config, stamp: res.data[0].updated_at || got.data.updated_at };
    }
    return null; // lost the race three times running — fall back to reload + draft
  }
  // Put the merged row on screen. A box the operator kept typing in while the save
  // was in flight is left alone (the next save carries it); every other box shows
  // the merged value, so the other device's edits appear without a reload.
  function adoptMerged(config, sent) {
    const now = Object.assign({}, settings);
    formToFields(now);
    settings = Object.assign({}, DEFAULTS, config);
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (cj(now[id]) !== cj(sent[id])) continue; // typed since the save left
      if (cj(config[id]) === cj(sent[id])) continue; // nothing of theirs in this box
      if (kind === "checked") el.checked = !!settings[id];
      else el.value = settings[id] != null ? settings[id] : "";
    }
    settings.listings = settings.listings || [];
    settings.followUps = settings.followUps || [];
    settings.videos = settings.videos || [];
    settings.demoVideoUrls = settings.demoVideoUrls || [];
    settings.coaching = settings.coaching || [];
    renderListings();
    renderFollowUps();
    renderVideos();
    renderDemoVideos(true);
    renderCoaching();
  }

  const SYSTEM_SAVE = true; // (v0.21.70) a save this page makes on its own (seed, legacy-link disarm): carries no typed text
  async function saveConfig(quiet, system) {
    // (v0.21.56) never write a config this page has not read (see rowLoaded above)
    if (!rowLoaded) {
      if (autoMsg) { autoMsg.textContent = "Not saved — still loading your settings"; autoMsg.className = "hint"; }
      if (!quiet) flash("Still loading your settings — nothing was saved.", true);
      return false;
    }
    formToFields();
    let clean = Object.assign({}, settings);
    delete clean.enabled; // per-machine
    Object.assign(clean, LEGACY_LINK_OFF); // (v0.21.69) the stale builds' link sender stays off
    // (v0.21.56) OPTIMISTIC CONCURRENCY. Both this page and every extension write
    // the whole config column, with no precondition — so whoever saved last simply
    // erased the other's edits, and the loser was never told. Send the stamp we
    // read as a condition: zero rows back means someone else changed the row since,
    // and we re-read instead of flattening their work.
    let q = client.from("subsell_configs")
      .update({ config: clean, updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id);
    if (loadedStamp) q = q.eq("updated_at", loadedStamp);
    let { data: wrote, error } = await q.select("updated_at");
    let merged = false;
    if (!error && (!wrote || !wrote.length)) {
      // Someone (another tab, the phone, or a machine's own save) wrote first.
      // (v0.21.73) Merge this page's changes over theirs and write that — a lesson
      // or a typed line is no longer dropped into a draft the operator must notice.
      const m = await saveMerged(clean);
      if (m && m.error) error = m.error;
      else if (m) {
        adoptMerged(m.config, clean);
        clean = m.config;
        wrote = [{ updated_at: m.stamp }];
        merged = true;
      } else {
        // The row could not be re-read, or three merges in a row lost the race.
        if (autoMsg) { autoMsg.textContent = "Someone else saved first — reloading their version"; autoMsg.className = "err"; }
        flash("Another device saved these settings while you were editing — reloaded theirs. Your text is kept — the banner offers it back.", true);
        if (!system) keepTypedDraft(); // (v0.21.70) the text on screen is about to be replaced by theirs
        await loadConfig();
        return false;
      }
    }
    if (!error && wrote && wrote[0]) loadedStamp = wrote[0].updated_at || loadedStamp;
    if (error) {
      // (v0.21.70) Keep what was typed, say what the error means, and when it is
      // the safety-net trigger, hand over the one-paste cure right here.
      if (!system) keepTypedDraft(); // a load-time save carries no typed text; a pending offer is never overwritten
      const why = explainSaveError(error);
      if (autoMsg) { autoMsg.textContent = why; autoMsg.className = "err"; autoMsg.title = error.message || ""; }
      if (isHistoryRlsError(error)) showFixBanner(error);
      flash(why, true);
      return false;
    }
    if (!system && !draftOffered) clearDraft(); // a landed save clears the draft — unless an older offer is still on screen
    hideFixBanner();
    baseConfig = JSON.parse(JSON.stringify(normalizeForSave(clean))); // (v0.21.73) the row as this page now knows it
    scheduleFleet(); // …and in a bit over a minute, which computers picked it up
    // Machines on cloud sync re-pull once a minute; the old copy said ~10 min,
    // which is the REMOTE-URL cadence, and made the operator think their edits
    // had not landed. Say the true number and show the clock.
    if (autoMsg) { autoMsg.textContent = "Saved " + new Date().toLocaleTimeString() + (merged ? " \u2014 together with a change made on another device" : "") + " \u2014 live on every bot within ~1 min (computers on the config link: ~10 min)"; autoMsg.className = "saved"; autoMsg.title = ""; }
    if (!quiet) flash(merged ? "Saved \u2713 \u2014 merged with a change made on another device. Every bot picks this up within ~1 min." : "Saved \u2713 \u2014 every bot picks this up within ~1 min.");
    renderTeachPreview();
    return true;
  }
  $("save").addEventListener("click", () => saveConfig(false));
  $("reload").addEventListener("click", loadConfig);

  /* ---- AUTO-SAVE: the operator asked that anything they change apply straight
   * away. Every field on this page is training data, so a change that sits
   * unsaved behind a button is a change the bots are not learning. Debounced so
   * typing is not a write storm; the button still works for the impatient. ---- */
  const autoMsg = $("autoSaveMsg");
  let autoTimer = null;
  let autoPending = false;
  function queueAutoSave() {
    if (!client || !session || !rowLoaded) return; // not signed in, or the row is not read yet
    autoPending = true;
    if (autoMsg) { autoMsg.textContent = "Saving\u2026"; autoMsg.className = "hint"; }
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => { autoPending = false; await saveConfig(true); }, 1200);
  }
  // Never lose an edit the operator typed and walked away from.
  window.addEventListener("beforeunload", (e) => {
    if (!autoPending) return;
    e.preventDefault();
    e.returnValue = "";
  });
  function wireAutoSave() {
    for (const [id] of FIELDS) {
      const el = $(id);
      if (!el || el.dataset.autosave) continue;
      el.dataset.autosave = "1";
      el.addEventListener("input", queueAutoSave);
      el.addEventListener("change", queueAutoSave);
    }
  }

  /* ---- WHAT THE BOT IS ACTUALLY TAUGHT ----
   * The operator could never see whether this page reached the bot. This renders
   * the operator-authored teaching exactly as the extension feeds it to Claude
   * (same fields, same order). It deliberately does NOT reproduce the built-in
   * sales playbook: that lives in background.js and duplicating it here would
   * drift and start lying. Labelled accordingly. ---- */
  function renderTeachPreview() {
    const el = $("teachPreview");
    if (!el || el.classList.contains("hidden")) return;
    formToFields();
    // (v0.21.73) "Answer only from what I teach": the bot gets this page and the
    // Activity rules/corrections, in this order, plus mechanics — nothing else.
    const only = settings.ownerTeachingOnly !== false;
    const has = (v) => !!String(v == null ? "" : v).trim();
    const L = [];
    L.push("── WHO YOU ARE ──");
    L.push(only
      ? `You answer buyers on Facebook Marketplace for "${settings.businessName || "(no name)"}", writing as the seller.`
      : `You are the auto-reply assistant for "${settings.businessName || "(no name)"}".`);
    L.push(`Address: ${settings.businessAddress || "(none)"}. Hours: ${settings.businessHoursText || "(none)"}.`);
    if (only) {
      L.push("");
      L.push("The bot is told: everything you know about this business is what the owner wrote below, and nothing else. When a buyer asks something that is not written here, it says it is best confirmed at the shop. It never guesses.");
    }
    const sec = (title, body) => { if (body && String(body).trim()) { L.push(""); L.push("── " + title + " ──"); L.push(String(body).trim()); } };
    sec("OWNER — BUSINESS INFO (the bot is told to find the line here that answers the buyer, and use it)", settings.businessInfo);
    if (has(settings.instructions)) sec("OWNER — INSTRUCTIONS / TONE", settings.instructions);
    else if (only) sec("INSTRUCTIONS / TONE — the box is empty, so the bot only gets this default", OWNER_FALLBACK_TONE);
    const co = settings.coaching || [];
    const rules = co.filter(coachIsRule);
    if (rules.length) {
      L.push("");
      L.push("── OWNER — STANDING RULES (orders, at the top of every bot's instructions) ──");
      for (const c of rules) L.push(`• ${truncTxt(c.better, 160)}`);
    }
    const graded = co.filter((c) => c && !coachIsRule(c));
    const gradedLines = () => {
      for (const c of graded.slice(-12)) {
        L.push(c.kind === "good"
          ? `✔ answer like this — "${truncTxt(c.buyer, 70)}" → "${truncTxt(c.reply, 120)}"`
          : `✘ NOT "${truncTxt(c.bad || "", 60)}" — say instead: "${truncTxt(c.better, 120)}"${c.note ? "  (" + truncTxt(c.note, 60) + ")" : ""}`);
      }
      if (graded.length > 12) L.push(`… and ${graded.length - 12} older ones`);
    };
    if (only && graded.length) {
      L.push("");
      L.push("── OWNER — CORRECTIONS FROM REAL CHATS (when a buyer writes the same thing again, the matching one is also put right beside their message) ──");
      gradedLines();
    }
    sec("STARTING PRICES the bot may share", settings.priceList);
    const av = (settings.listings || []).filter((l) => l && l.available !== false);
    const listingLines = () => {
      if (!av.length) return;
      L.push("");
      L.push("── LISTINGS it can quote ──");
      for (const l of av.slice(0, 20)) L.push(`• ${l.title || l.model || "item"} ${l.storage || ""} ${l.condition || ""}`.replace(/\s+/g, " ").trim());
      if (av.length > 20) L.push(`… and ${av.length - 20} more`);
    };
    if (only) listingLines();
    if (settings.closerMode) {
      if (has(settings.closerGoals)) sec(only ? "OWNER — HOW TO CLOSE" : "HOW TO CLOSE", settings.closerGoals);
      else if (only) sec("HOW TO CLOSE — the box is empty, so the bot only gets this default", OWNER_FALLBACK_CLOSE);
    }
    sec("EXAMPLE CONVERSATIONS / RULES", settings.examples);
    if (!only) {
      listingLines();
      if (graded.length) {
        L.push("");
        L.push("── OWNER — COACHING FROM REAL CHATS (outranks every style rule) ──");
        gradedLines();
      }
    }
    L.push("");
    L.push("── plus, built into every bot ──");
    L.push(only
      ? "Mechanics only: the rule above (your text is all it knows; anything else is “best confirmed at the shop”), the current time with every message, the reply tokens (hand a risky chat to you, note a planned visit), the platform-safety rule when that switch is on (never share a phone number or a link), your price setting, and a short how-to-write part (short, casual, no AI tells) that your own instructions override. There is NO built-in sales playbook and no canned sentence in this mode."
      : "An authority order (your text wins over the built-in playbook), a before-you-write lookup step (find the line in YOUR business info that answers the buyer before writing), the current time with every message, the closing playbook, the platform-safety rules (never share a phone number or move off Messenger), the sound-like-a-person rules, and the reply-format rules. Those ship with the extension — they are not editable here.");
    L.push("");
    L.push("── teaching code ──");
    L.push("What is SAVED right now has the code " + savedFingerprint() + ". A computer that answers with this teaching reports the same code — the line under this panel and the Activity tab name the computers that do not.");
    el.textContent = L.join("\n");
  }
  if ($("teachPreviewBtn")) {
    $("teachPreviewBtn").addEventListener("click", () => {
      const el = $("teachPreview");
      const open = !el.classList.contains("hidden");
      el.classList.toggle("hidden", open);
      $("teachPreviewBtn").textContent = open ? "\uD83D\uDC41 Show me exactly what the bot is being taught" : "Hide";
      if (!open) renderTeachPreview();
    });
  }

  /* ---- Teach a rule in plain words (no need to wait for a bad reply) ---- */
  if ($("addRule")) {
    const submitRule = async () => {
      const t = ($("ruleText").value || "").trim();
      if (!t) return;
      $("addRule").disabled = true;
      const saved = await addCoaching({ kind: "bad", buyer: "(general rule from the boss)", bad: "", better: t, note: "always applies" });
      $("addRule").disabled = false;
      // (v0.21.73) say what happened: this used to flash "Rule taught ✓" whatever the save did
      if (saved) { $("ruleText").value = ""; flash("Rule taught \u2713 \u2014 every bot has it within ~1 min."); }
      else flash("The rule was NOT saved \u2014 the line at the bottom of the page says why. Your text is still in the box.", true);
    };
    $("addRule").addEventListener("click", submitRule);
    $("ruleText").addEventListener("keydown", (e) => { if (e.key === "Enter") submitRule(); });
  }

  /* ---- (v0.21.73) WHICH COMPUTERS ANSWER WITH THIS TEACHING ----
   * "Saved — live on every bot within ~1 min" was a promise nobody could check.
   * Each extension now writes one hidden Activity row (kind "teach") whenever the
   * teaching it answers with changes, carrying the code of that teaching. The
   * code of the row THIS page saved is computed the same way (teachingFingerprint),
   * so a computer that is behind — a dead cloud login, an old build, a config link
   * that has not refreshed — is named here, instead of being discovered from odd
   * replies days later. */
  let fleetTimer = null;
  // A computer is known by its install id (the "#PC-xxxxx" tail, or the whole label
  // when none was typed); rows from before v0.21.71 carry only the typed label.
  const machineKey = (m) => { const s = String(m || ""); const id = s.match(/#(PC-[a-z0-9]{3,})\s*$/i) || s.match(/^(PC-[a-z0-9]{3,})(?![a-z0-9])/i); return id ? id[1].toLowerCase() : s.replace(/\s*·\s*v[\d.]+\s*$/, "").trim().toLowerCase(); };
  const machineShow = (m) => String(m || "—").replace(/\s*#PC-[a-z0-9]+\s*$/i, "");
  function savedFingerprint() { return teachingFingerprint(Object.assign({}, DEFAULTS, baseConfig || {}), null); }
  function scheduleFleet() {
    clearTimeout(fleetTimer);
    fleetTimer = setTimeout(loadFleet, 75000); // a computer pulls about once a minute
    if (fleetTimer && fleetTimer.unref) fleetTimer.unref(); // (a test run must not be held open by it)
  }
  // (The report reads "teaching <8 hex>". If teachingFingerprint ever takes other
  // inputs, change that word too — a build reporting the old way must read as
  // "cannot report", never as "behind".)
  // Pure: the rows in, five lists out. `teachRows` = kind "teach"; `seenRows` = any
  // other recent row (a message, a video). `cur` = the code of the row AS IT IS IN
  // THE CLOUD and `changedAt` = that row's own stamp — never this page's copy,
  // which another device may have overtaken. All times but `now` are the
  // database's clock, so "behind" does not depend on this browser's.
  //   ok      its latest report is the saved teaching
  //   behind  it sent a message (or a report) more than 12 min after the teaching
  //           changed and still holds another code (cloud sync pulls every minute,
  //           the config link every ten) — it is answering buyers with old teaching
  //   syncing the change is less than 12 min old
  //   idle    it has not sent anything since the change (asleep, closed, quiet)
  //   silent  it sends messages but has never reported: a build before v0.21.73
  function fleetStatus(teachRows, seenRows, cur, now, changedAt) {
    const WEEK = 7 * 24 * 3600 * 1000, GRACE = 12 * 60 * 1000;
    const byKey = {};
    const touch = (m, at) => {
      const k = machineKey(m);
      if (!k || /^dashboard test/i.test(String(m))) return null;
      const e = (byKey[k] = byKey[k] || { key: k, machine: m, lastAt: 0, seenAt: 0, fp: null, fpAt: 0 });
      if (at >= e.lastAt) { e.lastAt = at; e.machine = m; }
      return e;
    };
    for (const r of teachRows || []) {
      const at = Date.parse(r.created_at) || 0;
      const fp = (String(r.bot_text || "").match(/teaching ([0-9a-f]{8})/) || [])[1];
      const e = touch(r.machine, at);
      if (e && fp && at >= e.fpAt) { e.fp = fp; e.fpAt = at; }
    }
    for (const r of seenRows || []) {
      const at = Date.parse(r.created_at) || 0;
      const e = touch(r.machine, at);
      if (e && at > e.seenAt) e.seenAt = at;
    }
    const out = { ok: [], syncing: [], behind: [], idle: [], silent: [] };
    for (const e of Object.values(byKey)) {
      if (now - e.lastAt > WEEK) continue; // nobody has heard from it in a week: retired, not behind
      if (!e.fp) { if (e.seenAt) out.silent.push(e); }
      else if (e.fp === cur) out.ok.push(e);
      else if (changedAt && Math.max(e.seenAt, e.fpAt) - changedAt > GRACE) out.behind.push(e); // it worked, or reported, after the change — on other teaching
      else if (changedAt && now - changedAt < GRACE) out.syncing.push(e);
      else out.idle.push(e);
    }
    return out;
  }
  function renderFleet(st, cur) {
    const total = st.ok.length + st.syncing.length + st.behind.length + st.idle.length + st.silent.length;
    const when = (t) => (t ? new Date(t).toLocaleString() : "?");
    const lines = [];
    if (!total) lines.push("No computer has reported its teaching yet. Each one reports the first time it syncs after updating to v0.21.73.");
    else {
      lines.push((st.ok.length === total ? "✓ " : "") + "Computers answering with the teaching saved here: " + st.ok.length + " of " + total + " (code " + cur + ").");
      for (const e of st.behind) lines.push("⚠ " + machineShow(e.machine) + " kept answering buyers with OLDER teaching after your last change (it last took a change on " + when(e.fpAt) + "). That computer has lost its cloud login: open the extension’s Settings on it and sign in again.");
      for (const e of st.syncing) lines.push("… " + machineShow(e.machine) + " is picking up your last change.");
      if (st.idle.length) lines.push("· Not active since your last change, they take it when they next sync: " + st.idle.map((e) => machineShow(e.machine)).join(", ") + ".");
      for (const e of st.silent) lines.push("? " + machineShow(e.machine) + " runs an older build that cannot report its teaching. It updates by itself; “Update now” in the extension popup on that computer does it at once.");
    }
    for (const id of ["teachFleet", "teachFleetBiz"]) {
      const el = $(id);
      if (!el) continue;
      el.style.whiteSpace = "pre-line";
      el.className = st.behind.length ? "err" : "hint";
      el.textContent = lines.join("\n");
    }
  }
  async function loadFleet() {
    if (!client || !session || !rowLoaded) return;
    try {
      // The row as it is in the cloud right now — another device may have saved since this page did.
      const row = await client.from("subsell_configs").select("config, updated_at").maybeSingle();
      if (row.error || !row.data) return;
      const cur = teachingFingerprint(Object.assign({}, DEFAULTS, row.data.config || {}), null);
      const t = await client.from("subsell_messages").select("created_at, machine, bot_text")
        .eq("kind", "teach").order("created_at", { ascending: false }).limit(200);
      if (t.error) return; // no Activity table yet: nothing to say
      const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      const s = await client.from("subsell_messages").select("created_at, machine")
        .neq("kind", "claim").neq("kind", "teach").gte("created_at", since).order("created_at", { ascending: false }).limit(300);
      renderFleet(fleetStatus(t.data || [], s.error ? [] : s.data || [], cur, Date.now(), Date.parse(row.data.updated_at || "") || 0), cur);
    } catch (e) { /* a status line must never break the page */ }
  }

  /* ---------------- activity log (combined feed across all machines) ---------------- */
  const truncTxt = (s, n) => { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) + "…" : s; };

  /* ----- 🎓 Coaching: grade real replies (👍 imitate / 👎 + correction) -----
   * Lessons live in settings.coaching (capped 30, FIFO) and ride the normal
   * config save — every machine's next system prompt includes them (~1 min). */
  const COACH_MAX = 30;
  function renderCoaching() {
    const el = $("coachingList");
    if (!el) return;
    const list = settings.coaching || [];
    if (!list.length) { el.textContent = "No lessons yet — grade a reply below."; return; }
    el.innerHTML = "";
    list.slice().reverse().forEach((c) => {
      const idx = settings.coaching.indexOf(c);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:8px;align-items:flex-start;margin:4px 0;";
      const txt = document.createElement("div");
      txt.style.flex = "1";
      txt.textContent = c.kind === "good"
        ? `👍 "${truncTxt(c.buyer, 60)}" → "${truncTxt(c.reply, 90)}"`
        : `👎 "${truncTxt(c.buyer, 60)}" → should say: "${truncTxt(c.better, 90)}"${c.note ? "  (" + truncTxt(c.note, 40) + ")" : ""}`;
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "✕";
      del.title = "Forget this lesson";
      del.addEventListener("click", async () => {
        if (idx >= 0) settings.coaching.splice(idx, 1);
        renderCoaching();
        await saveConfig();
      });
      row.appendChild(txt);
      row.appendChild(del);
      el.appendChild(row);
    });
  }
  // Returns whether the lesson REACHED THE CLOUD (v0.21.73) — callers used to show
  // ✓ whatever the save did, so a refused or conflicting save looked taught.
  async function addCoaching(item) {
    settings.coaching = settings.coaching || [];
    const same = (a) => a && a.kind === item.kind && (a.buyer || "") === (item.buyer || "") && (a.reply || "") === (item.reply || "") &&
      (a.bad || "") === (item.bad || "") && (a.better || "") === (item.better || "") && (a.note || "") === (item.note || "");
    if (!settings.coaching.some(same)) settings.coaching.push(Object.assign({ at: Date.now() }, item)); // a retry after a failed save must not add it twice
    trimCoaching(settings.coaching); // rules are evicted last (v0.21.55)
    renderCoaching();
    return await saveConfig();
  }

  async function loadActivity() {
    if (!client || !session) return;
    const totalsEl = $("activityTotals");
    totalsEl.className = "hint";
    totalsEl.textContent = "Loading…";
    // (v0.21.71) kind "claim" rows are the machines' own bookkeeping (which computer
    // is answering a message) — never a message, so never in the feed or the counts.
    const { data, error } = await client
      .from("subsell_messages")
      .select("created_at, sent_at, machine, thread_name, kind, buyer_text, bot_text")
      .neq("kind", "claim")
      .neq("kind", "teach") // (v0.21.73) a computer's teaching receipt — shown in the line above the feed, never as a message
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) {
      totalsEl.className = "err";
      totalsEl.textContent =
        "Couldn't load activity: " + error.message +
        " — run supabase/schema.sql and deploy the subsell-log function.";
      return;
    }
    const rows = data || [];

    // All-time + today totals (cheap head counts).
    let total = rows.length, today = 0;
    try {
      const all = await client.from("subsell_messages").select("id", { count: "exact", head: true }).neq("kind", "claim").neq("kind", "teach");
      if (all.count != null) total = all.count;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const td = await client.from("subsell_messages").select("id", { count: "exact", head: true }).neq("kind", "claim").neq("kind", "teach").gte("created_at", start.toISOString());
      if (td.count != null) today = td.count;
    } catch (e) { /* counts are best-effort */ }

    totalsEl.innerHTML = `<b>${total}</b> messages all-time &nbsp;·&nbsp; <b>${today}</b> today &nbsp;·&nbsp; showing latest ${rows.length}`;
    loadFleet(); // (v0.21.73) which computers answer with the teaching saved here

    const byMachine = {};
    for (const r of rows) { const m = r.machine || "—"; byMachine[m] = (byMachine[m] || 0) + 1; }
    const parts = Object.entries(byMachine).sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m}: ${c}`);
    $("activityByMachine").textContent = parts.length ? "Recent by machine — " + parts.join("   ·   ") : "";

    const tb = $("activityTable").querySelector("tbody");
    tb.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 7; td.className = "hint";
      td.textContent = "No messages yet — once your extensions reply or send a video they'll show up here.";
      tr.appendChild(td); tb.appendChild(tr); return;
    }
    for (const r of rows) {
      const tr = document.createElement("tr");
      const cells = [
        new Date(r.created_at).toLocaleString(),
        r.machine || "—",
        r.thread_name || "—",
        r.kind || "text",
        truncTxt(r.buyer_text, 160),
        truncTxt(r.bot_text, 240),
      ];
      for (const c of cells) { const td = document.createElement("td"); td.textContent = c; tr.appendChild(td); }
      // 🎓 Teach cell — only real conversational replies are gradeable.
      const tdT = document.createElement("td");
      // (v0.21.55) every row is gradeable. A [HUMAN] escalation that should have
      // been answered, or a video row that went to the wrong chat, is exactly the
      // kind of mistake the boss wants to correct — restricting the buttons to
      // text rows hid the most useful lessons.
      const gradeable = !!(r.bot_text || r.buyer_text);
      if (gradeable) {
        tdT.style.whiteSpace = "nowrap";
        const up = document.createElement("button");
        up.type = "button"; up.textContent = "👍"; up.title = "Good — answer like this";
        up.addEventListener("click", async () => {
          up.disabled = true;
          const saved = await addCoaching({ kind: "good", buyer: truncTxt(r.buyer_text, 200), reply: truncTxt(r.bot_text, 300) });
          up.textContent = saved ? "✓" : "✗";
          if (!saved) { up.disabled = false; up.title = "NOT saved — the line at the bottom of the page says why. Click to try again."; }
        });
        const down = document.createElement("button");
        down.type = "button"; down.textContent = "👎"; down.title = "Wrong — correct it";
        down.addEventListener("click", () => {
          if (tr.nextSibling && tr.nextSibling.dataset && tr.nextSibling.dataset.fixrow) { tr.nextSibling.remove(); return; }
          const ftr = document.createElement("tr");
          ftr.dataset.fixrow = "1";
          const ftd = document.createElement("td");
          ftd.colSpan = 7;
          const ta = document.createElement("textarea");
          ta.style.cssText = "width:100%;min-height:60px;box-sizing:border-box;";
          ta.placeholder = "Write what the bot SHOULD have answered…";
          ta.value = r.bot_text || "";
          const note = document.createElement("input");
          note.type = "text";
          note.style.cssText = "width:100%;box-sizing:border-box;margin-top:4px;";
          note.placeholder = "Optional: the rule to learn (e.g. 'never repeat the price twice — push the visit')";
          const ok = document.createElement("button");
          ok.type = "button"; ok.textContent = "Save lesson";
          ok.addEventListener("click", async () => {
            const better = ta.value.trim();
            if (!better) { ta.focus(); return; }
            ok.disabled = true;
            const saved = await addCoaching({
              kind: "fix",
              buyer: truncTxt(r.buyer_text, 200),
              bad: truncTxt(r.bot_text, 200),
              better: truncTxt(better, 300),
              note: truncTxt(note.value.trim(), 120),
            });
            if (saved) ftr.remove();
            else { ok.disabled = false; ok.textContent = "NOT saved — try again"; } // the correction stays in the box
          });
          const cancel = document.createElement("button");
          cancel.type = "button"; cancel.textContent = "Cancel"; cancel.className = "danger";
          cancel.addEventListener("click", () => ftr.remove());
          ftd.appendChild(ta); ftd.appendChild(note);
          const btnRow = document.createElement("div");
          btnRow.style.cssText = "margin-top:4px;display:flex;gap:8px;";
          btnRow.appendChild(ok); btnRow.appendChild(cancel);
          ftd.appendChild(btnRow);
          ftr.appendChild(ftd);
          tr.after(ftr);
          ta.focus();
        });
        tdT.appendChild(up);
        tdT.appendChild(down);
      }
      tr.appendChild(tdT);
      tb.appendChild(tr);
    }
  }
  if ($("refreshActivity")) $("refreshActivity").addEventListener("click", loadActivity);
  // One-click pipeline test — inserts a fake row through the same subsell-log
  // endpoint the extensions use, then reloads the feed. If this works, the whole
  // chain (function deployed, JWT off, table created, key valid) is proven.
  if ($("testActivity")) $("testActivity").addEventListener("click", async () => {
    const totalsEl = $("activityTotals");
    totalsEl.className = "hint";
    if (!configKey) { totalsEl.className = "err"; totalsEl.textContent = "No config key loaded — reload the page and log in first."; return; }
    totalsEl.textContent = "Sending test event…";
    try {
      const resp = await fetch(window.SUBSELL_SUPABASE_URL + "/functions/v1/subsell-log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: configKey,
          events: [{ machine: "DASHBOARD TEST", kind: "text", thread_name: "Pipeline test",
                     buyer_text: "(test) hello", bot_text: "(test) it works!", sent_at: Date.now() }],
        }),
      });
      const out = await resp.json().catch(() => ({}));
      if (resp.ok && out.ok) { await loadActivity(); }
      else {
        totalsEl.className = "err";
        totalsEl.textContent = "Test failed: " + (out.error || "HTTP " + resp.status) +
          (resp.status === 401 ? " — turn Verify JWT OFF on the subsell-log function." : "");
      }
    } catch (e) {
      totalsEl.className = "err";
      totalsEl.textContent = "Test failed: " + e.message;
    }
  });
  {
    const at = document.querySelector('.tab[data-tab="activity"]');
    if (at) at.addEventListener("click", loadActivity);
  }

  /* ---------------- auth ---------------- */
  function showApp(sess) {
    session = sess;
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("whoami").textContent = (sess.user && sess.user.email) || "";
    loadConfig();
  }
  function showLogin() {
    session = null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  }

  $("googleBtn").addEventListener("click", async () => {
    $("loginStatus").className = "hint";
    $("loginStatus").textContent = "Redirecting to Google…";
    const { error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: location.href.split("#")[0] },
    });
    if (error) { $("loginStatus").className = "err"; $("loginStatus").textContent = error.message; }
  });
  $("loginBtn").addEventListener("click", async () => {
    $("loginStatus").className = "hint";
    $("loginStatus").textContent = "Signing in…";
    const { data, error } = await client.auth.signInWithPassword({
      email: $("loginEmail").value.trim(), password: $("loginPassword").value,
    });
    if (error) { $("loginStatus").className = "err"; $("loginStatus").textContent = error.message; return; }
    showApp(data.session);
  });
  $("signupBtn").addEventListener("click", async () => {
    $("loginStatus").className = "hint";
    $("loginStatus").textContent = "Creating account…";
    const { data, error } = await client.auth.signUp({
      email: $("loginEmail").value.trim(), password: $("loginPassword").value,
    });
    if (error) { $("loginStatus").className = "err"; $("loginStatus").textContent = error.message; return; }
    if (data.session) showApp(data.session);
    else { $("loginStatus").className = "hint"; $("loginStatus").textContent = "Account created — check your email to confirm, then log in."; }
  });
  $("logoutBtn").addEventListener("click", async () => { await client.auth.signOut(); showLogin(); });
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") $("loginBtn").click(); });

  /* ---------------- boot ---------------- */
  function boot() {
    const url = window.SUBSELL_SUPABASE_URL;
    const key = window.SUBSELL_SUPABASE_ANON_KEY;
    if (!url || !key || typeof supabase === "undefined") {
      $("configWarn").classList.remove("hidden");
      ["googleBtn", "loginBtn", "signupBtn"].forEach((id) => ($(id).disabled = true));
      return;
    }
    client = supabase.createClient(url, key);
    client.auth.getSession().then(({ data }) => {
      if (data && data.session) showApp(data.session);
      else showLogin();
    });
    client.auth.onAuthStateChange((_event, sess) => {
      if (sess) { if ($("appView").classList.contains("hidden")) showApp(sess); else session = sess; }
      else showLogin();
    });
  }
  boot();
})();
