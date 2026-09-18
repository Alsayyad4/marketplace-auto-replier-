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
    videoLinkFallback: true, // send the demo as a LINK when native attach keeps failing
    videoLinkUrl: "", // blank = the first central video's URL
    videoLinkText: "", // blank = built-in FR/EN line; {link} = the URL
    // (v0.21.53) the four power switches moved OUT of the shared config: a stale
    // videoForeground:true in this row was grabbing the desktop on the whole fleet.
    // They are per-machine now (extension Settings -> Videos), never synced.
    smartFollowupEnabled: false,
    smartFollowupMaxCount: 1,
    smartFollowupQuietHours: 6,
    smartFollowupGapHours: 24,
    coaching: [], // graded real replies from the Activity tab (👍/👎+correction) — fed into every bot's prompt
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
    ["videoRetryMax", "number"], ["videoLinkFallback", "checked"], ["videoLinkUrl", "value"], ["videoLinkText", "value"],
    ["smartFollowupEnabled", "checked"], ["smartFollowupMaxCount", "number"],
    ["smartFollowupQuietHours", "number"], ["smartFollowupGapHours", "number"],
  ];

  // (v0.21.56) Fields whose REAL default text lives in the extension (background.js
  // DEFAULTS), not here. Blank means "use the extension's", never "".
  const EXT_DEFAULT_TEXT = { businessInfo: 1, instructions: 1, closerGoals: 1 };
  let settings = Object.assign({}, DEFAULTS); // working copy (preserves loaded advanced fields)
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
  function formToFields() {
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
    flash(data.config && Object.keys(data.config).length ? "Loaded from cloud." : "New config — fill it in and save.");
  }

  async function saveConfig(quiet) {
    // (v0.21.56) never write a config this page has not read (see rowLoaded above)
    if (!rowLoaded) {
      if (autoMsg) { autoMsg.textContent = "Not saved — still loading your settings"; autoMsg.className = "hint"; }
      if (!quiet) flash("Still loading your settings — nothing was saved.", true);
      return false;
    }
    formToFields();
    const clean = Object.assign({}, settings);
    delete clean.enabled; // per-machine
    // (v0.21.56) OPTIMISTIC CONCURRENCY. Both this page and every extension write
    // the whole config column, with no precondition — so whoever saved last simply
    // erased the other's edits, and the loser was never told. Send the stamp we
    // read as a condition: zero rows back means someone else changed the row since,
    // and we re-read instead of flattening their work.
    let q = client.from("subsell_configs")
      .update({ config: clean, updated_at: new Date().toISOString() })
      .eq("user_id", session.user.id);
    if (loadedStamp) q = q.eq("updated_at", loadedStamp);
    const { data: wrote, error } = await q.select("updated_at");
    if (!error && (!wrote || !wrote.length)) {
      // Someone (another tab, or a machine's own save) wrote first.
      if (autoMsg) { autoMsg.textContent = "Someone else saved first — reloading their version"; autoMsg.className = "err"; }
      flash("Another device saved these settings while you were editing — reloaded theirs so nothing is lost. Re-apply your change and save again.", true);
      await loadConfig();
      return false;
    }
    if (!error && wrote && wrote[0]) loadedStamp = wrote[0].updated_at || loadedStamp;
    if (error) {
      if (autoMsg) { autoMsg.textContent = "Not saved: " + error.message; autoMsg.className = "err"; }
      flash("Save failed: " + error.message, true);
      return false;
    }
    // Machines on cloud sync re-pull once a minute; the old copy said ~10 min,
    // which is the REMOTE-URL cadence, and made the operator think their edits
    // had not landed. Say the true number and show the clock.
    if (autoMsg) { autoMsg.textContent = "Saved " + new Date().toLocaleTimeString() + " \u2014 live on every bot within ~1 min"; autoMsg.className = "saved"; }
    if (!quiet) flash("Saved \u2713 \u2014 every bot picks this up within ~1 min.");
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
    const L = [];
    L.push("\u2500\u2500 WHO YOU ARE \u2500\u2500");
    L.push(`You are the auto-reply assistant for "${settings.businessName || "(no name)"}".`);
    L.push(`Address: ${settings.businessAddress || "(none)"}. Hours: ${settings.businessHoursText || "(none)"}.`);
    const sec = (title, body) => { if (body && String(body).trim()) { L.push(""); L.push("\u2500\u2500 " + title + " \u2500\u2500"); L.push(String(body).trim()); } };
    sec("BUSINESS INFO", settings.businessInfo);
    sec("INSTRUCTIONS / TONE", settings.instructions);
    sec("STARTING PRICES the bot may share", settings.priceList);
    sec("HOW TO CLOSE", settings.closerMode ? settings.closerGoals : "");
    sec("EXAMPLE CONVERSATIONS / RULES", settings.examples);
    const av = (settings.listings || []).filter((l) => l && l.available !== false);
    if (av.length) {
      L.push("");
      L.push("\u2500\u2500 LISTINGS it can quote \u2500\u2500");
      for (const l of av.slice(0, 20)) L.push(`\u2022 ${l.title || l.model || "item"} ${l.storage || ""} ${l.condition || ""}`.replace(/\s+/g, " ").trim());
      if (av.length > 20) L.push(`\u2026 and ${av.length - 20} more`);
    }
    const co = settings.coaching || [];
    if (co.length) {
      L.push("");
      L.push("\u2500\u2500 YOUR COACHING (outranks every style rule) \u2500\u2500");
      for (const c of co.slice(-12)) {
        L.push(c.kind === "good"
          ? `\u2714 answer like this \u2014 "${truncTxt(c.buyer, 70)}" \u2192 "${truncTxt(c.reply, 120)}"`
          : `\u2718 NOT "${truncTxt(c.bad || "", 60)}" \u2014 say instead: "${truncTxt(c.better, 120)}"${c.note ? "  (" + truncTxt(c.note, 60) + ")" : ""}`);
      }
    }
    L.push("");
    L.push("\u2500\u2500 plus, built into every bot \u2500\u2500");
    L.push("The closing playbook, the platform-safety rules (never share a phone number or move off Messenger), the sound-like-a-person rules, and the reply-format rules. Those ship with the extension \u2014 they are not editable here.");
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
      await addCoaching({ kind: "bad", buyer: "(general rule from the boss)", bad: "", better: t, note: "always applies" });
      $("ruleText").value = "";
      $("addRule").disabled = false;
      flash("Rule taught \u2713 \u2014 every bot has it within ~1 min.");
    };
    $("addRule").addEventListener("click", submitRule);
    $("ruleText").addEventListener("keydown", (e) => { if (e.key === "Enter") submitRule(); });
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
  async function addCoaching(item) {
    settings.coaching = settings.coaching || [];
    settings.coaching.push(Object.assign({ at: Date.now() }, item));
    // (v0.21.55) A standing RULE the boss typed ("never quote an exact price") must
    // not be evicted by a run of thumbs-ups on ordinary replies — plain FIFO did
    // exactly that. Drop the oldest graded EXAMPLE first; only start dropping rules
    // when the list is nothing but rules.
    const isRule = (c) => c && c.note === "always applies";
    while (settings.coaching.length > COACH_MAX) {
      const i = settings.coaching.findIndex((c) => !isRule(c));
      settings.coaching.splice(i >= 0 ? i : 0, 1);
    }
    renderCoaching();
    await saveConfig();
  }

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
          await addCoaching({ kind: "good", buyer: truncTxt(r.buyer_text, 200), reply: truncTxt(r.bot_text, 300) });
          up.textContent = "✓";
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
            await addCoaching({
              kind: "fix",
              buyer: truncTxt(r.buyer_text, 200),
              bad: truncTxt(r.bot_text, 200),
              better: truncTxt(better, 300),
              note: truncTxt(note.value.trim(), 120),
            });
            ftr.remove();
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
