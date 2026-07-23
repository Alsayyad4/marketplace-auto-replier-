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
    model: "claude-sonnet-4-6",
    responseDelaySec: 30,
    jitterSec: 60,
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
    smartFollowupEnabled: false,
    smartFollowupMaxCount: 1,
    smartFollowupQuietHours: 6,
    smartFollowupGapHours: 24,
  };

  const VIDEO_BUCKET = "subsell-videos"; // Supabase Storage bucket for central demo videos

  const FIELDS = [
    ["apiKey", "value"], ["model", "value"],
    ["responseDelaySec", "number"], ["jitterSec", "number"],
    ["hourlyCap", "number"], ["dailyCap", "number"],
    ["maxRepliesPerConvo", "number"], ["convoCapBehavior", "value"],
    ["wpmMin", "number"], ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"], ["businessHoursStart", "number"], ["businessHoursEnd", "number"],
    ["humanCadence", "checked"], ["skipChance", "number"], ["breakChance", "number"], ["breakMinMin", "number"], ["breakMaxMin", "number"],
    ["warmupEnabled", "checked"], ["warmupDays", "number"], ["warmupStartCap", "number"],
    ["offPlatformGuard", "checked"], ["closerMode", "checked"], ["closerIntensity", "value"], ["noExactPrices", "checked"],
    ["visitConfirmEnabled", "checked"], ["visitConfirmAfterMin", "number"],
    ["businessName", "value"], ["businessAddress", "value"], ["businessHoursText", "value"],
    ["businessInfo", "value"], ["instructions", "value"], ["examples", "value"],
    ["closerGoals", "value"], ["priceList", "value"], ["visitConfirmMessage", "value"],
    ["demoVideoDelaySec", "number"], ["demoVideoBetweenSec", "number"],
    ["smartFollowupEnabled", "checked"], ["smartFollowupMaxCount", "number"],
    ["smartFollowupQuietHours", "number"], ["smartFollowupGapHours", "number"],
  ];

  let settings = Object.assign({}, DEFAULTS); // working copy (preserves loaded advanced fields)
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
  function formToFields() {
    for (const [id, kind] of FIELDS) {
      const el = $(id);
      if (!el) continue;
      if (kind === "checked") settings[id] = el.checked;
      else if (kind === "number") settings[id] = Number(el.value);
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

  /* ----- central demo videos (uploaded to Supabase Storage) ----- */
  function renderDemoVideos() {
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
      const del = document.createElement("button");
      del.type = "button";
      del.className = "danger";
      del.textContent = "Remove";
      del.addEventListener("click", () => {
        vids.splice(i, 1);
        renderDemoVideos();
      });
      row.appendChild(a);
      row.appendChild(del);
      el.appendChild(row);
    });
  }
  if ($("demoVideoFile")) {
    $("demoVideoFile").addEventListener("change", async () => {
      const f = $("demoVideoFile").files && $("demoVideoFile").files[0];
      if (!f) return;
      const status = $("demoVideoStatus");
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
      settings.demoVideoUrls.push({ name: f.name, url });
      renderDemoVideos();
      status.className = "saved";
      status.textContent = "Uploaded ✓ — now click Save to cloud.";
      $("demoVideoFile").value = "";
    });
  }

  function renderAll() {
    settings.listings = settings.listings || [];
    settings.followUps = settings.followUps || [];
    settings.videos = settings.videos || [];
    settings.demoVideoUrls = settings.demoVideoUrls || [];
    fieldsToForm();
    renderListings();
    renderFollowUps();
    renderVideos();
    renderDemoVideos();
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
    let { data, error } = await client.from("subsell_configs").select("config, config_key").maybeSingle();
    if (error) { flash("Load failed: " + error.message, true); return; }
    if (!data) {
      // No row yet (trigger/backfill not run) — create one for this user.
      const ins = await client.from("subsell_configs").insert({ user_id: session.user.id }).select("config, config_key").maybeSingle();
      if (ins.error) { flash("No config row and couldn't create one (" + ins.error.message + "). Run supabase/schema.sql.", true); return; }
      data = ins.data;
    }
    settings = Object.assign({}, DEFAULTS, data.config || {}); // keep any advanced fields present
    configKey = data.config_key || "";
    renderAll();
    buildUrl();
    flash(data.config && Object.keys(data.config).length ? "Loaded from cloud." : "New config — fill it in and save.");
  }

  async function saveConfig() {
    formToFields();
    const clean = Object.assign({}, settings);
    delete clean.enabled; // per-machine
    const { error } = await client.from("subsell_configs")
      .update({ config: clean, updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id);
    if (error) { flash("Save failed: " + error.message, true); return; }
    flash("Saved ✓ — machines update within ~10 min (or hit Fetch now).");
  }
  $("save").addEventListener("click", saveConfig);
  $("reload").addEventListener("click", loadConfig);

  /* ---------------- activity log (combined feed across all machines) ---------------- */
  const truncTxt = (s, n) => { s = s == null ? "" : String(s); return s.length > n ? s.slice(0, n) + "…" : s; };

  async function loadActivity() {
    if (!client || !session) return;
    const totalsEl = $("activityTotals");
    totalsEl.className = "hint";
    totalsEl.textContent = "Loading…";
    const { data, error } = await client
      .from("subsell_messages")
      .select("created_at, sent_at, machine, thread_name, kind, buyer_text, bot_text")
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
      const all = await client.from("subsell_messages").select("id", { count: "exact", head: true });
      if (all.count != null) total = all.count;
      const start = new Date(); start.setHours(0, 0, 0, 0);
      const td = await client.from("subsell_messages").select("id", { count: "exact", head: true }).gte("created_at", start.toISOString());
      if (td.count != null) today = td.count;
    } catch (e) { /* counts are best-effort */ }

    totalsEl.innerHTML = `<b>${total}</b> messages all-time &nbsp;·&nbsp; <b>${today}</b> today &nbsp;·&nbsp; showing latest ${rows.length}`;

    const byMachine = {};
    for (const r of rows) { const m = r.machine || "—"; byMachine[m] = (byMachine[m] || 0) + 1; }
    const parts = Object.entries(byMachine).sort((a, b) => b[1] - a[1]).map(([m, c]) => `${m}: ${c}`);
    $("activityByMachine").textContent = parts.length ? "Recent by machine — " + parts.join("   ·   ") : "";

    const tb = $("activityTable").querySelector("tbody");
    tb.innerHTML = "";
    if (!rows.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = 6; td.className = "hint";
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
