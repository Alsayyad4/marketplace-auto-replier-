/* SubSell — cloud dashboard logic.
 * Talks to Supabase (auth + the `configs` table) using the supabase-js client.
 * The settings shape here MUST stay in sync with DEFAULTS in the extension's
 * background.js / options.js — it's the same JSON object that the extension
 * reads back. Only synced settings live here; per-machine state (the On/Off
 * toggle, rate-limit counters, logs, uploaded video blobs) stays in the
 * extension's local storage and is intentionally NOT shown. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  /* ---- same defaults as the extension (minus per-machine `enabled`) ---- */
  const DEFAULTS = {
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
    businessInfo: "",
    instructions: "",
    examples: "",
    offPlatformGuard: true,
    closerMode: true,
    noExactPrices: true,
    closerGoals: "",
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

  const FIELDS = [
    ["apiKey", "value"], ["model", "value"], ["responseDelaySec", "number"], ["jitterSec", "number"],
    ["hourlyCap", "number"], ["dailyCap", "number"], ["wpmMin", "number"], ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"], ["businessHoursStart", "number"], ["businessHoursEnd", "number"],
    ["businessName", "value"], ["businessAddress", "value"], ["businessHoursText", "value"],
    ["businessInfo", "value"], ["instructions", "value"], ["examples", "value"],
    ["offPlatformGuard", "checked"], ["closerMode", "checked"], ["noExactPrices", "checked"],
    ["closerGoals", "value"], ["priceList", "value"], ["visitConfirmEnabled", "checked"],
    ["visitConfirmAfterMin", "number"], ["visitConfirmMessage", "value"], ["maxRepliesPerConvo", "number"],
    ["convoCapBehavior", "value"], ["humanCadence", "checked"], ["skipChance", "number"],
    ["breakChance", "number"], ["breakMinMin", "number"], ["breakMaxMin", "number"],
    ["warmupEnabled", "checked"], ["warmupDays", "number"], ["warmupStartCap", "number"],
  ];

  let settings = Object.assign({}, DEFAULTS);
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

  /* ---------------- generic table editor ---------------- */
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

  function renderAll() {
    settings.listings = settings.listings || [];
    settings.followUps = settings.followUps || [];
    settings.videos = settings.videos || [];
    fieldsToForm();
    renderListings();
    renderFollowUps();
    renderVideos();
  }

  /* ---------------- Supabase data ---------------- */
  async function loadConfig() {
    const { data, error } = await client.from("subsell_configs").select("config").maybeSingle();
    if (error) { $("savedMsg").textContent = ""; $("savedMsg").className = "err"; $("savedMsg").textContent = "Load failed: " + error.message; return; }
    settings = Object.assign({}, DEFAULTS, (data && data.config) || {});
    renderAll();
    $("savedMsg").className = "hint";
    $("savedMsg").textContent = data ? "Loaded from cloud." : "No config yet — fill it in and save.";
  }

  async function saveConfig() {
    formToFields();
    const clean = Object.assign({}, settings);
    delete clean.enabled; // on/off is per-machine
    const msg = $("savedMsg");
    msg.className = "hint";
    msg.textContent = "Saving…";
    const { error } = await client.from("subsell_configs").upsert(
      { user_id: session.user.id, config: clean },
      { onConflict: "user_id" }
    );
    if (error) { msg.className = "err"; msg.textContent = "Save failed: " + error.message; return; }
    msg.className = "saved";
    msg.textContent = "Saved ✓ — every connected Chrome updates within ~1 min.";
    setTimeout(() => (msg.textContent = ""), 4000);
  }
  $("save").addEventListener("click", saveConfig);
  $("reload").addEventListener("click", loadConfig);

  /* ---------------- auth ---------------- */
  function showApp(sess) {
    session = sess;
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("whoami").textContent = sess.user.email || "";
    loadConfig();
  }
  function showLogin() {
    session = null;
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  }

  async function doLogin() {
    $("loginStatus").className = "hint";
    $("loginStatus").textContent = "Signing in…";
    const { data, error } = await client.auth.signInWithPassword({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value,
    });
    if (error) { $("loginStatus").className = "err"; $("loginStatus").textContent = error.message; return; }
    showApp(data.session);
  }
  async function doSignup() {
    $("loginStatus").className = "hint";
    $("loginStatus").textContent = "Creating account…";
    const { data, error } = await client.auth.signUp({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value,
    });
    if (error) { $("loginStatus").className = "err"; $("loginStatus").textContent = error.message; return; }
    if (data.session) showApp(data.session);
    else { $("loginStatus").className = "hint"; $("loginStatus").textContent = "Account created — check your email to confirm, then log in."; }
  }
  async function doLogout() {
    await client.auth.signOut();
    showLogin();
  }
  $("loginBtn").addEventListener("click", doLogin);
  $("signupBtn").addEventListener("click", doSignup);
  $("logoutBtn").addEventListener("click", doLogout);
  $("loginPassword").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

  /* ---------------- boot ---------------- */
  function boot() {
    const url = window.SUBSELL_SUPABASE_URL;
    const key = window.SUBSELL_SUPABASE_ANON_KEY;
    if (!url || !key || typeof supabase === "undefined") {
      $("configWarn").classList.remove("hidden");
      $("loginBtn").disabled = true;
      $("signupBtn").disabled = true;
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
