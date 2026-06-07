/* SubSell — cloud settings dashboard (Supabase).
 * Auth (Google or email/password) → edit the settings JSON in `subsell_configs`
 * → show the per-user config URL (Edge Function) the extension fetches via its
 * existing "Remote config URL" feature (zero extension changes needed).
 *
 * The JSON shape matches DEFAULTS / buildSystemPrompt() in the extension's
 * background.js (see ../SPEC-webapp.md). Unknown/advanced fields in a loaded
 * config are preserved on save (we only overwrite the fields shown here).
 *
 * The "Test responses" tab calls the Anthropic API directly from the browser
 * (same endpoint + system prompt the extension uses) so what you see here is
 * exactly what the bot would send. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);

  /* Full settings set — mirrors DEFAULTS in the extension's background.js.
   * `enabled` is per-machine and excluded. Video upload/on-off/delay are
   * per-machine (set in each extension) because the file can't sync. */
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
  };

  const FIELDS = [
    ["apiKey", "value"], ["model", "value"],
    ["responseDelaySec", "number"], ["jitterSec", "number"],
    ["hourlyCap", "number"], ["dailyCap", "number"],
    ["maxRepliesPerConvo", "number"], ["convoCapBehavior", "value"],
    ["wpmMin", "number"], ["wpmMax", "number"],
    ["businessHoursEnabled", "checked"], ["businessHoursStart", "number"], ["businessHoursEnd", "number"],
    ["humanCadence", "checked"], ["skipChance", "number"], ["breakChance", "number"], ["breakMinMin", "number"], ["breakMaxMin", "number"],
    ["warmupEnabled", "checked"], ["warmupDays", "number"], ["warmupStartCap", "number"],
    ["offPlatformGuard", "checked"], ["closerMode", "checked"], ["noExactPrices", "checked"],
    ["visitConfirmEnabled", "checked"], ["visitConfirmAfterMin", "number"],
    ["businessName", "value"], ["businessAddress", "value"], ["businessHoursText", "value"],
    ["businessInfo", "value"], ["instructions", "value"], ["examples", "value"],
    ["closerGoals", "value"], ["priceList", "value"], ["visitConfirmMessage", "value"],
  ];

  let settings = Object.assign({}, DEFAULTS); // working copy (preserves loaded advanced fields)
  let configKey = "";
  let client = null;
  let session = null;

  /* ---------------- install / Add to Chrome ----------------
   * Independent of login — people can install before they have an account. */
  function setupInstall() {
    const store = (window.SUBSELL_WEBSTORE_URL || "").trim();
    const zip = (window.SUBSELL_DOWNLOAD_ZIP_URL || "").trim();
    [["downloadZipBtn", zip], ["downloadZipBtn2", zip]].forEach(([id, href]) => {
      const a = $(id);
      if (a && href) a.href = href;
    });
    if (store) {
      // Published: show real "Add to Chrome" buttons, hide the manual fallback note.
      [["addToChromeBtn", true], ["addToChromeBtn2", true]].forEach(([id]) => {
        const a = $(id);
        if (a) { a.href = store; a.target = "_blank"; a.rel = "noopener"; a.style.display = ""; }
      });
      const note = $("webstoreNote");
      if (note) note.classList.add("hidden");
    }
  }

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

  /* listings JSON import/export (parity with the extension) */
  $("exportListings").addEventListener("click", () => {
    download("subsell-listings.json", JSON.stringify(settings.listings, null, 2));
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
          if (Array.isArray(data)) { settings.listings = data; renderListings(); }
          else alert("Expected a JSON array.");
        } catch (e) { alert("Invalid JSON: " + e.message); }
      };
      reader.readAsText(file);
    });
    input.click();
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

  function download(name, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }
  $("downloadConfig").addEventListener("click", () => {
    formToFields();
    const clean = Object.assign({}, settings);
    delete clean.enabled;
    download("subsell-config.json", JSON.stringify(clean, null, 2));
    flash("Downloaded. Host it (e.g. a secret gist) and paste its raw URL into the extension.");
  });

  /* ---------------- Test responses (calls Claude in the browser) ----------------
   * buildSystemPrompt + parseReply are ported verbatim from background.js so the
   * dry-run matches the live bot. */
  function buildSystemPrompt(s) {
    const lines = [];
    lines.push(`You are the auto-reply assistant for "${s.businessName}", a used-iPhone reseller in Montréal.`);
    lines.push(`Address: ${s.businessAddress}. Hours: ${s.businessHoursText}.`);
    lines.push("");
    lines.push("BUSINESS INFO:");
    lines.push(s.businessInfo || "");
    lines.push("");
    lines.push("INSTRUCTIONS:");
    lines.push(s.instructions || "");

    const hasPriceList = !!(s.priceList && s.priceList.trim());
    if (hasPriceList) {
      lines.push("");
      lines.push("STARTING PRICES (share the relevant one when a buyer asks about a model — these are 'starting at' / 'à partir de' prices; the exact price depends on storage, condition, and the in-person deal, so quote it as 'starts at $X' and invite them in for the best price):");
      lines.push(s.priceList.trim());
    }

    if (Array.isArray(s.listings) && s.listings.length) {
      lines.push("");
      if (s.noExactPrices && !hasPriceList) {
        lines.push("CURRENT INVENTORY (availability + video only — do NOT state any price):");
        for (const l of s.listings) {
          lines.push(`- ${l.title || l.model || "item"} | ${l.storage || ""} | ${l.condition || ""} | available: ${l.available === false ? "no" : "yes"}${l.videoUrl ? " | video: " + l.videoUrl : ""}`);
        }
      } else {
        lines.push("CURRENT LISTINGS (only quote available items):");
        for (const l of s.listings) {
          lines.push(`- ${l.title || l.model || "item"} | ${l.storage || ""} | ${l.condition || ""} | $${l.price || "?"} CAD | available: ${l.available === false ? "no" : "yes"}${l.videoUrl ? " | video: " + l.videoUrl : ""}`);
        }
      }
    }

    if (s.closerMode) {
      lines.push("");
      lines.push("HOW TO CLOSE — turn this chat into a call or a shop visit:");
      lines.push(s.closerGoals || "");
      if (hasPriceList) {
        lines.push("PRICING: when asked, GIVE the relevant starting price from the list above — do NOT refuse or dodge the question. Then close: tell them the exact / best price is locked in when they call or drop by, because of the deal you can do in person.");
      } else if (s.noExactPrices) {
        lines.push("PRICING RULE (critical): NEVER state an exact price, number, or dollar amount in chat — not even a range, not even the listed price. If asked the price, say the listed price is on the post but you give your BEST deal in person, and invite them to come by the shop. If they push hard for a number, return [HUMAN].");
      }
      lines.push("Always work these in naturally: we do TRADE-INS — take their old phone/device toward the new one, and if their current phone is NEWER we can even pay them CASH for it. Push our LIQUIDATION deals and create gentle urgency (good stock moves fast). The goal: get them to call or come to the shop, where we take care of them with the best deal.");
    }

    lines.push("");
    lines.push("SPECIAL REPLY TOKENS (use at most one, alone on the first line):");
    lines.push("- [HUMAN] <reason> — when you should NOT auto-reply: scams, payment/shipping requests, off-platform contact pressure, or anything weird/risky. The human is notified.");
    lines.push("- [VIDEO:<url>] <optional caption> — to send a demo video. Use a videoUrl from the inventory when the buyer asks to see the phone working/condition. The app UPLOADS the actual mp4 file as a native video attachment — the URL is never shown to the buyer, so this is safe. Keep the caption short and ALWAYS vary the wording.");
    lines.push("- [VISIT:yes|no|maybe] <your normal reply text> — put this at the very start of your message ONLY when the buyer's latest message reveals whether they intend to come to the shop. yes = they confirm coming / are on their way / agreed to come; no = they decline, bought elsewhere, or back out; maybe = unsure/hesitant. The token is recorded silently and STRIPPED before sending — the buyer only sees your reply text after it. Use it in addition to replying normally; do not let it replace a real, persuasive reply.");

    if (s.offPlatformGuard) {
      lines.push("");
      lines.push("PLATFORM SAFETY RULES (strict — Facebook flags these):");
      lines.push("- NEVER write a phone number, email, WhatsApp, Telegram, or any external link/URL.");
      lines.push("- NEVER say 'text me at', 'call me', 'contact me on …', or push the chat off Marketplace.");
      lines.push("- Keep the whole conversation inside Messenger. If the buyer insists on moving off-platform or wants your number, return [HUMAN] instead of replying.");
      lines.push("- Don't paste identical canned text; vary your wording naturally between buyers.");
    }

    if (s.examples && s.examples.trim()) {
      lines.push("");
      lines.push("EXAMPLE CONVERSATIONS (mimic this tone, format, and decisions — including when to send [VIDEO] or escalate [HUMAN]). Do not copy verbatim; adapt to the actual buyer:");
      lines.push(s.examples.trim());
    }

    lines.push("");
    lines.push("HOW TO READ THE INPUT: you are given the recent conversation and the buyer's latest message. Respond ONLY to what the buyer actually wrote. If their message is empty, a sticker/emoji only, a system line, or makes no sense, reply with a short friendly greeting that invites them to say what they're looking for — do NOT invent a topic, and never react to UI words like 'Privacy & support', 'Marketplace', or menu labels. If you are unsure what they meant, ask a brief clarifying question in their language.");
    lines.push("");
    lines.push("Reply with the message text only (or one token). Keep it short and human, like a real seller texting on their phone — contractions, casual, sometimes a one-word answer. Never reuse the exact same opening sentence twice.");
    return lines.join("\n");
  }

  function parseReply(text) {
    if (!text) return { kind: "empty" };
    text = text.trim();
    let visit = null;
    const visitMatch = text.match(/^\[VISIT:\s*(yes|no|maybe)\s*\]\s*([\s\S]*)$/i);
    if (visitMatch) {
      visit = visitMatch[1].toLowerCase();
      text = visitMatch[2].trim();
      if (!text) return { kind: "empty", visit };
    }
    const human = text.match(/\[HUMAN\]\s*([\s\S]*)/i);
    if (human && text.toUpperCase().startsWith("[HUMAN]")) return { kind: "human", reason: human[1].trim(), visit };
    const video = text.match(/\[VIDEO:([^\]]+)\]\s*([\s\S]*)/i);
    if (video && text.toUpperCase().startsWith("[VIDEO")) return { kind: "video", url: video[1].trim(), caption: (video[2] || "").trim(), visit };
    return { kind: "text", text: text.trim(), visit };
  }

  $("runTest").addEventListener("click", async () => {
    formToFields();
    const status = $("testStatus");
    const out = $("testResult");
    if (!settings.apiKey) { status.className = "err"; status.textContent = "Set your Anthropic API key on the General tab first."; return; }
    status.className = "hint";
    status.textContent = "Calling Claude…";
    out.textContent = "—";
    try {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": settings.apiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify({
          model: settings.model || "claude-sonnet-4-6",
          max_tokens: 1024,
          system: buildSystemPrompt(settings),
          messages: [{ role: "user", content: "Buyer's latest message:\n" + ($("testInput").value || "") }],
        }),
      });
      if (!resp.ok) {
        const t = await resp.text();
        status.className = "err";
        status.textContent = `Anthropic ${resp.status}`;
        out.textContent = t.slice(0, 600);
        return;
      }
      const data = await resp.json();
      const raw = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      const p = parseReply(raw);
      let label;
      if (p.kind === "human") label = `[HUMAN] ${p.reason}`;
      else if (p.kind === "video") label = `[VIDEO ${p.url}] ${p.caption}`;
      else if (p.kind === "empty") label = "(empty reply)";
      else label = p.text;
      if (p.visit) label = `(visit: ${p.visit})\n` + label;
      status.className = "saved";
      status.textContent = "Done.";
      out.textContent = label + "\n\n— raw —\n" + raw;
    } catch (e) {
      status.className = "err";
      status.textContent = "Fetch failed: " + e.message + " (check the API key / network).";
    }
  });

  /* ---------------- config URL ---------------- */
  function buildUrl() {
    const base = (window.SUBSELL_SUPABASE_URL || "").replace(/\/+$/, "");
    $("configUrl").value = configKey ? `${base}/functions/v1/config?key=${configKey}` : "";
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
    setTimeout(() => (el.textContent = ""), 5000);
  }

  /* ---------------- Supabase data ---------------- */
  async function loadConfig() {
    let { data, error } = await client.from("subsell_configs").select("config, config_key").maybeSingle();
    if (error) { flash("Load failed: " + error.message, true); return; }
    if (!data) {
      const ins = await client.from("subsell_configs").insert({ user_id: session.user.id }).select("config, config_key").maybeSingle();
      if (ins.error) { flash("No config row and couldn't create one (" + ins.error.message + "). Run supabase/schema.sql.", true); return; }
      data = ins.data;
    }
    settings = Object.assign({}, DEFAULTS, data.config || {});
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
    flash("Saved ✓ — machines update within ~10 min (or hit Fetch now in the extension).");
  }
  $("save").addEventListener("click", saveConfig);
  $("reload").addEventListener("click", loadConfig);

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
    setupInstall(); // works with or without Supabase configured

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
