/* (v0.21.97) MY ADS, MY VIDEOS — one computer's page (opened from the popup).
 * The owner, Nov 13 2026: "I open the extension that is connected to the Chrome, I see the ads in
 * that Chrome, nothing else … I choose the ad and an upload button … I put that video."
 * This page only shows and asks: the worker (background.js, MYADS_*) reads this computer's chats,
 * decides what each ad sends with the bots' own rule (adVideoPick) and writes a choice into the
 * account's video sets for this computer alone. The video is uploaded from here straight into the
 * account's own storage folder (the same place the web app uploads to). No data is ever drawn as
 * HTML: every text goes through textContent. */
(() => {
  const $ = (id) => document.getElementById(id);
  const ask = (msg) => new Promise((r) => { try { chrome.runtime.sendMessage(msg, (x) => { void chrome.runtime.lastError; r(x || null); }); } catch (e) { r(null); } });
  const DASHBOARD_URL = "https://alsayyad4.github.io/marketplace-auto-replier-/docs/";
  const HEAVY_BYTES = 8 * 1024 * 1024; // the web app's own "heavy" line
  // Messenger takes a video up to 25 MB, and the bots can never deliver one over 45 MB or under 50 KB.
  // Such a file would upload, read "Saved" and never go out (an ad with its own video gets that video
  // or nothing), so it is refused here, with the reason.
  const MAX_BYTES = 25 * 1024 * 1024;
  const MIN_BYTES = 50 * 1024;
  const WORDS_KEY = "__words__";
  let state = null; // the worker's last MYADS_LIST answer
  let busy = ""; // the ad (its key) a save is running for; one at a time
  let order = []; // the ads' keys in the order they are on screen (cards never move under the pointer)
  let resort = true; // the next drawing takes the worker's order (the first one, and Refresh)
  let loadSeq = 0; // only the newest MYADS_LIST answer draws
  const notes = {}; // ad key → { cls, text, retry }
  const pending = {}; // ad key → { target, clip }: a clip uploaded but not saved yet (saved again without a second upload)

  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const fmtMB = (n) => (n > 0 ? (n / 1048576).toFixed(1) + " MB" : "");
  const clipName = (v) => (v && v.name ? v.name : "video") + (v && v.size > 0 ? " (" + fmtMB(v.size) + ")" : "");
  // The videos of a line, each one a link that plays it in a new tab: a file name such as IMG_4411.mp4
  // does not say which phone is in it.
  function appendClips(node, list) {
    (list || []).forEach((v, i) => {
      if (i) node.appendChild(document.createTextNode(" + "));
      if (v && /^https?:\/\//i.test(String(v.url || ""))) {
        const a = el("a", "", clipName(v));
        a.href = v.url;
        a.target = "_blank";
        a.rel = "noopener";
        a.title = "Watch this video";
        node.appendChild(a);
      } else node.appendChild(document.createTextNode(clipName(v)));
    });
  }
  function fmtWhen(ms) {
    if (!ms) return "";
    const d = new Date(ms), now = new Date();
    const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const hm = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const diff = Math.round((day(now) - day(d)) / 86400000);
    return diff <= 0 ? "today " + hm : diff === 1 ? "yesterday " + hm : d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  const setNote = (key, cls, text, retry) => { notes[key] = { cls, text, retry: retry || null }; };

  /* ---------------- the file: can this Chrome send it? ---------------- */
  const looksVideo = (f) => /^video\/(mp4|quicktime|x-m4v)$/i.test(f.type || "") || /\.(mp4|m4v|mov)$/i.test(f.name || "");
  // Messenger shows a video before it sends it, and it does that with this very Chrome: a file this
  // Chrome cannot play (an .avi, an iPhone "High Efficiency" .MOV on a PC without that decoder) would
  // be saved as the ad's video and never go out. So the file is tried here first. → "ok" | "bad" |
  // "nopicture" | "unknown" (no verdict in 8 s, e.g. the tab went to the background: not a refusal).
  function probeVideo(file) {
    return new Promise((resolve) => {
      let done = false, url = "";
      const v = document.createElement("video");
      const fin = (r) => {
        if (done) return;
        done = true;
        clearTimeout(t);
        try { v.removeAttribute("src"); v.load(); } catch (e) { /* nothing to release */ }
        try { if (url) URL.revokeObjectURL(url); } catch (e) { /* already gone */ }
        resolve(r);
      };
      const t = setTimeout(() => fin("unknown"), 8000);
      v.preload = "metadata";
      v.muted = true;
      v.addEventListener("loadedmetadata", () => fin(v.videoWidth > 0 && v.videoHeight > 0 ? "ok" : "nopicture"));
      v.addEventListener("error", () => fin("bad"));
      try { url = URL.createObjectURL(file); v.src = url; } catch (e) { fin("unknown"); }
    });
  }

  /* ---------------- the upload: this computer → the account's own storage folder ---------------- */
  function uploadFile(ticket, file, onPct) {
    return new Promise((resolve) => {
      const safe = String(file.name || "video.mp4").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-90) || "video.mp4";
      const path = ticket.userId + "/" + Date.now() + "-" + safe; // the folder the storage rules give this account
      const x = new XMLHttpRequest();
      x.open("POST", ticket.url + "/storage/v1/object/" + ticket.bucket + "/" + path);
      x.setRequestHeader("apikey", ticket.key);
      x.setRequestHeader("authorization", "Bearer " + ticket.token);
      x.setRequestHeader("content-type", /^video\//i.test(file.type || "") ? file.type : "video/mp4"); // always a video type: the bots refuse a clip the storage serves as anything else
      x.setRequestHeader("cache-control", "max-age=3600");
      x.timeout = 15 * 60 * 1000;
      x.upload.onprogress = (e) => { if (e.lengthComputable && e.total > 0) onPct(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
      x.onload = () => {
        if (x.status >= 200 && x.status < 300) return resolve({ ok: true, url: ticket.url + "/storage/v1/object/public/" + ticket.bucket + "/" + path });
        let why = "";
        try { const j = JSON.parse(x.responseText); why = String(j.message || j.error || ""); } catch (e) { /* not JSON */ }
        resolve({ ok: false, error: (why || "the storage answered HTTP " + x.status) + (x.status === 413 ? " (the file is too big for the storage)" : "") });
      };
      x.onerror = () => resolve({ ok: false, error: "no connection to the video storage" });
      x.ontimeout = () => resolve({ ok: false, error: "the upload took more than 15 minutes" });
      x.onabort = () => resolve({ ok: false, error: "the upload was stopped" });
      x.send(file);
    });
  }
  // target = { key, item } (an ad of the list) or { key: WORDS_KEY, words } (an ad not in the list yet)
  const saveMsg = (target, clip) => (target.key === WORDS_KEY ? { type: "MYADS_WORDS", words: target.words, clip } : { type: "MYADS_PUT", item: target.item, clip });
  async function saveClip(target, clip) {
    const key = target.key;
    setNote(key, "work", "Saving…");
    render();
    const res = await ask(saveMsg(target, clip));
    if (res && res.ok) {
      delete pending[key];
      // pulled === false: the choice is in the account, this computer has not read it back yet (its pull does, within the minute)
      setNote(key, "ok", "✓ Saved: " + clipName(clip) + ". " + (res.pulled === false
        ? "It is in the account; this Chrome takes it within a minute (press Refresh then)."
        : "From now on the bot sends it in this ad's chats. A buyer who already got a video keeps it."));
      if (key === WORDS_KEY && $("wordsIn")) $("wordsIn").value = "";
    } else {
      pending[key] = { target, clip }; // the file is already up: only the save is tried again
      setNote(key, "err", "The video is uploaded but the choice was NOT saved: " + ((res && res.error) || "the extension did not answer") + ".", "save");
    }
  }
  async function giveVideo(target, file) {
    const key = target.key;
    if (busy || !file) return;
    const name = "“" + file.name + "”";
    if (!looksVideo(file)) { setNote(key, "err", name + " is not an mp4 video: choose an mp4 (or a .mov)."); return render(); }
    if (!(file.size > 0)) { setNote(key, "err", name + " is empty."); return render(); }
    if (file.size < MIN_BYTES) { setNote(key, "err", name + " is too small to be a video (under 50 KB)."); return render(); }
    if (file.size > MAX_BYTES) { setNote(key, "err", name + " is " + fmtMB(file.size) + ": too big. Messenger does not take a video over 25 MB. Export it smaller (a 720p clip of 3–8 MB sends fastest)."); return render(); }
    busy = key;
    try {
      // the same file is already up (a save that failed a moment ago, or a video of another ad of this Chrome): no second upload
      const waiting = pending[key] && pending[key].clip;
      const lib = (state && state.library) || [];
      const have = (waiting && waiting.name === file.name && waiting.size === file.size ? waiting : null) || lib.find((v) => v && v.name === file.name && v.size > 0 && v.size === file.size);
      if (have) { await saveClip(target, have); return; }
      setNote(key, "work", "Checking " + file.name + "…");
      render();
      const playable = await probeVideo(file);
      if (playable === "bad") { setNote(key, "err", "This Chrome cannot play " + name + ", so Messenger could not send it. Export it as mp4 (H.264) and choose it again."); return; }
      if (playable === "nopicture") { setNote(key, "err", name + " has no picture (sound only): choose the video itself."); return; }
      setNote(key, "work", "Uploading " + file.name + "… 0%");
      paintNote(key);
      const ticket = await ask({ type: "MYADS_TICKET" });
      if (!ticket || !ticket.ok) { setNote(key, "err", "Not uploaded: " + ((ticket && ticket.error) || "the extension did not answer") + "."); return; }
      const up = await uploadFile(ticket, file, (pct) => { setNote(key, "work", "Uploading " + file.name + "… " + pct + "%"); paintNote(key); });
      if (!up.ok) { setNote(key, "err", "Not uploaded: " + up.error + "."); return; }
      const heavy = file.size > HEAVY_BYTES;
      await saveClip(target, { name: file.name, url: up.url, size: file.size });
      if (heavy && notes[key] && notes[key].cls === "ok") notes[key].text += " It is heavy (" + fmtMB(file.size) + "): a 720p export of 3–8 MB sends much faster.";
    } finally {
      busy = "";
      await load();
    }
  }
  async function useClip(target, clip) {
    if (busy) return;
    busy = target.key;
    try { await saveClip(target, clip); } finally { busy = ""; await load(); }
  }
  async function retrySave(key) {
    const p = pending[key];
    if (!p || busy) return;
    // the words box may have been corrected since: the save goes out with what it reads now
    const target = key === WORDS_KEY ? { key, words: wordsNow() || p.target.words } : p.target;
    busy = key;
    try { await saveClip(target, p.clip); } finally { busy = ""; await load(); }
  }
  async function dropSet(key, setId, what) {
    if (busy) return;
    if (!confirm("Remove the video of “" + what + "”?\n\nIts chats go back to the general video (or to no video). A buyer who already received it keeps it.")) return;
    busy = key;
    setNote(key, "work", "Removing…");
    render();
    try {
      const res = await ask({ type: "MYADS_DROP", setId });
      if (res && res.ok) setNote(key, "ok", "✓ Removed.");
      else setNote(key, "err", "Not removed: " + ((res && res.error) || "the extension did not answer") + ".");
    } finally { busy = ""; await load(); }
  }
  // One hidden file input per click: the chooser opens straight from the button's own click.
  function chooseFile(then) {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "video/mp4,video/quicktime,.mp4,.m4v,.mov";
    inp.style.display = "none";
    inp.addEventListener("change", () => { const f = inp.files && inp.files[0]; inp.remove(); if (f) then(f); });
    inp.addEventListener("cancel", () => inp.remove()); // the chooser closed with nothing picked
    document.body.appendChild(inp);
    inp.click();
  }
  const wordsNow = () => (($("wordsIn") && $("wordsIn").value) || "").replace(/\s+/g, " ").trim();

  /* ---------------- drawing ---------------- */
  function paintNote(key) {
    const box = Array.from(document.querySelectorAll("[data-note]")).find((n) => n.getAttribute("data-note") === key);
    if (!box) return;
    const n = notes[key];
    box.textContent = "";
    box.className = "status" + (n ? " " + n.cls : "");
    if (!n) return;
    box.appendChild(document.createTextNode(n.text + " "));
    if (n.retry === "save" && pending[key]) {
      const b = el("button", "", "Save again");
      b.type = "button";
      b.disabled = !!busy;
      b.addEventListener("click", () => retrySave(key));
      box.appendChild(b);
    }
  }
  function reuseSelect(target, current) {
    const lib = ((state && state.library) || []).filter((v) => v && v.url && !(current || []).some((c) => c && c.url === v.url));
    if (!lib.length) return null;
    const sel = el("select");
    sel.disabled = !!busy || !(state && state.canSave);
    sel.appendChild(el("option", "", "…or use a video already uploaded here"));
    sel.firstChild.value = "";
    lib.forEach((v, i) => { const o = el("option", "", clipName(v)); o.value = String(i); sel.appendChild(o); });
    sel.addEventListener("change", () => { const v = lib[Number(sel.value)]; if (sel.value !== "" && v) useClip(target, v); });
    return sel;
  }
  function adCard(ad) {
    const can = !!(state && state.canSave) && !busy;
    const target = { key: ad.key, item: ad.item };
    const card = el("div", "card" + (ad.kind === "own" ? " own" : ""));
    const title = el("div", "title", ad.item);
    if (ad.open) title.appendChild(el("span", "pill", "the chat open now"));
    card.appendChild(title);
    const bits = [];
    if (ad.chats > 0) bits.push(ad.chats + (ad.chats === 1 ? " chat" : " chats"));
    if (ad.last) bits.push("last " + fmtWhen(ad.last));
    else if (ad.inbox) bits.push("in the inbox now");
    if (ad.quiet) bits.push("no chat on this ad lately");
    if (bits.length) card.appendChild(el("div", "meta", bits.join(" · ")));
    const stateLine = el("div", "state");
    const general = (state && state.general) || [];
    if (ad.kind === "own") { stateLine.appendChild(document.createTextNode("✅ Its own video: ")); appendClips(stateLine, ad.clips); }
    else if (ad.kind === "set") { stateLine.appendChild(document.createTextNode("Gets ")); appendClips(stateLine, ad.clips); stateLine.appendChild(document.createTextNode(", set " + (ad.mineOnly ? "for this Chrome" : "on the web app") + " for ads with the words “" + ad.words + "”.")); }
    else if (ad.kind === "general") { stateLine.appendChild(document.createTextNode("No video of its own: it gets the general video (")); appendClips(stateLine, general); stateLine.appendChild(document.createTextNode(").")); }
    else if (state && state.localClips > 0) stateLine.textContent = "No video of its own: it gets the video" + (state.localClips === 1 ? "" : "s") + " uploaded in this Chrome's Settings.";
    else stateLine.textContent = "No video for this ad.";
    card.appendChild(stateLine);
    const row = el("div", "row");
    const up = el("button", ad.kind === "own" ? "" : "primary", ad.kind === "own" ? "Change the video" : ad.kind === "set" ? "Give this ad its own video (mp4)" : "Upload a video for this ad (mp4)");
    up.type = "button";
    up.disabled = !can;
    up.addEventListener("click", () => chooseFile((f) => giveVideo(target, f)));
    row.appendChild(up);
    if (ad.kind === "own") {
      const rm = el("button", "danger", "Remove");
      rm.type = "button";
      rm.disabled = !can;
      rm.addEventListener("click", () => dropSet(ad.key, ad.setId, ad.item));
      row.appendChild(rm);
    }
    const sel = reuseSelect(target, ad.kind === "own" ? ad.clips : []);
    if (sel) row.appendChild(sel);
    card.appendChild(row);
    // the same item under another title (posted again, a word changed): its video, in one click
    if (ad.like && ad.like.clip && ad.kind !== "own") {
      const same = el("div", "row");
      same.style.marginTop = "6px";
      same.appendChild(el("span", "muted", "Same item as “" + ad.like.item + "”?"));
      const use = el("button", "", "Use its video (" + (ad.like.clip.name || "video") + ")");
      use.type = "button";
      use.disabled = !can;
      use.addEventListener("click", () => useClip(target, ad.like.clip));
      same.appendChild(use);
      card.appendChild(same);
    }
    const note = el("div", "status");
    note.setAttribute("data-note", ad.key);
    card.appendChild(note);
    return card;
  }
  // The cards keep their places: a card that is on screen never moves under the pointer when the list
  // is read again (the bot opens chats all the time, and "the chat open now" would reorder it each
  // time). New ads come on top. Only the first drawing and the Refresh link take the worker's order.
  function arrange(ads) {
    if (resort || !order.length) { resort = false; order = ads.map((a) => a.key); return ads; }
    const pos = new Map(order.map((k, i) => [k, i]));
    const out = ads.filter((a) => !pos.has(a.key)).concat(ads.filter((a) => pos.has(a.key)).sort((x, y) => pos.get(x.key) - pos.get(y.key)));
    order = out.map((a) => a.key);
    return out;
  }
  // The status lines that are part of the page itself (not of a card) are emptied when their note is gone.
  const clearGoneNotes = () => document.querySelectorAll("[data-note]").forEach((b) => { if (!notes[b.getAttribute("data-note")]) { b.textContent = ""; b.className = "status"; } });
  function render() {
    const s = state;
    clearGoneNotes();
    if (!s) { Object.keys(notes).forEach(paintNote); return; }
    const notesBox = $("notes"), list = $("ads");
    $("who").textContent = "— " + (s.label ? s.label + " (" + s.machine + ")" : s.machine || "this Chrome");
    $("rename").textContent = s.label ? "rename" : "give this computer a name";
    notesBox.textContent = "";
    if (!s.canSave) {
      const n = el("div", "note warn", "A choice cannot be saved from here yet. " + (s.why || "This Chrome is not logged in to the account.") + " ");
      if (s.needLogin) {
        const b = el("button", "", "Open Settings to log in");
        b.type = "button";
        b.addEventListener("click", () => { try { chrome.runtime.openOptionsPage(); } catch (e) { /* the popup's Settings link does the same */ } });
        n.appendChild(b);
      }
      notesBox.appendChild(n);
    }
    if (s.when === "never") notesBox.appendChild(el("div", "note warn", "Videos are switched OFF for the whole account (web app → Videos → “Send the clip”: never). You can choose videos here, but nothing goes out until that is changed."));
    else notesBox.appendChild(el("div", "note", (s.when === "always" ? "When it goes out: once per chat, after the bot's first reply." : "When it goes out: once per chat, when the buyer asks to see the item (a video, photos).") + " Choosing a video here does not send more videos: it only decides which one."));
    const ads = arrange(s.ads || []);
    const own = ads.filter((a) => a.kind === "own").length;
    const total = Number(s.total) > ads.length ? Number(s.total) : ads.length;
    $("sum").textContent = ads.length
      ? total + (total === 1 ? " ad" : " ads") + " on this Chrome · " + own + (own === 1 ? " has its own video" : " have their own video") + (total > ads.length ? " · showing " + ads.length + " (every ad with a video, then the newest)" : "")
      : "No ad yet on this Chrome";
    list.textContent = "";
    if (!ads.length) {
      list.appendChild(el("div", "note", "This list fills by itself: an ad appears here when a buyer writes about it on this Chrome"
        + (s.messengerTabs > 0 ? (s.inboxRead ? "" : " (the Messenger tab is open but did not answer: reload it once)") : " (no Messenger tab is open on this Chrome right now: open Marketplace from the extension)")
        + ". For an ad nobody wrote about yet, use “My ad is not in the list” below."));
    }
    ads.forEach((ad) => list.appendChild(adCard(ad)));
    // the ads set by words (an ad that had no chat yet)
    const wl = $("wordsList");
    wl.textContent = "";
    (s.words || []).forEach((w) => {
      const row = el("div", "row");
      row.style.marginTop = "8px";
      const what = el("span", "", "Ads with the words “" + w.words + "”: ");
      appendClips(what, w.clips);
      row.appendChild(what);
      const rm = el("button", "danger", "Remove");
      rm.type = "button";
      rm.disabled = !s.canSave || !!busy;
      rm.addEventListener("click", () => dropSet(WORDS_KEY, w.setId, w.words));
      row.appendChild(rm);
      wl.appendChild(row);
    });
    if ((s.words || []).length || notes[WORDS_KEY]) $("notListed").open = true;
    $("wordsUp").disabled = !s.canSave || !!busy;
    Object.keys(notes).forEach(paintNote);
  }
  async function load(byHand) {
    const n = ++loadSeq;
    if (byHand === true) {
      resort = true;
      // Refresh shows things as they are now: a "Saved" line of a moment ago goes (it could still read
      // "this Chrome takes it within a minute" under an ad that now shows its video); what failed stays.
      for (const k of Object.keys(notes)) if (notes[k] && notes[k].cls === "ok") delete notes[k];
    }
    const got = await ask({ type: "MYADS_LIST", byHand: byHand === true });
    if (n !== loadSeq) return; // a newer question is out: its answer draws, never this older one over it
    if (!got || !got.ok) {
      $("sum").textContent = "The extension did not answer. Reload this page.";
      render(); // what is on screen stays, with its buttons and notes as they now are (never frozen on "Saving…")
      return;
    }
    state = got;
    render();
  }

  /* ---------------- wiring ---------------- */
  $("refresh").addEventListener("click", (e) => { e.preventDefault(); if (!busy) load(true); });
  $("openWeb").addEventListener("click", (e) => { e.preventDefault(); try { chrome.tabs.create({ url: DASHBOARD_URL + "#videos", active: true }); } catch (err) { location.href = DASHBOARD_URL + "#videos"; } });
  $("wordsUp").addEventListener("click", async () => {
    if (busy) return;
    const words = wordsNow();
    if (!/[\p{L}\p{N}]/u.test(words)) { setNote(WORDS_KEY, "err", "Type words from the ad's title first."); return render(); }
    // the words are checked BEFORE the chooser opens: no video goes up for words the bots cannot read
    const okW = await ask({ type: "MYADS_CHECK", words });
    if (!okW || !okW.ok) { setNote(WORDS_KEY, "err", "These words cannot be used: " + ((okW && okW.error) || "the extension did not answer") + "."); return render(); }
    chooseFile((f) => giveVideo({ key: WORDS_KEY, words }, f));
  });
  // A name for this computer (the same one Settings has): the web app then lists this computer's choices
  // under that name instead of "PC-xxxxx".
  $("rename").addEventListener("click", (e) => {
    e.preventDefault();
    const cur = (state && state.label) || "";
    const v = prompt("A name for this computer, so you recognise it on the web app (for example: Shop PC 3, or the Facebook account's name):", cur);
    if (v == null) return;
    try { chrome.storage.local.set({ machineLabel: v.replace(/\s+/g, " ").trim().slice(0, 60) }, () => { void chrome.runtime.lastError; load(); }); } catch (err) { /* the name stays as it was */ }
  });
  // A new version of the extension installs itself between two chats, but never under a page a person is
  // using. The worker asks (MYADS_IN_USE); this page answers ONLY while someone is on it (the tab in
  // front and a click or a key in the last 3 minutes) or a file is going up. Left open and forgotten it
  // says nothing, and the update goes ahead (the tab then closes with the old version).
  let lastInput = Date.now();
  ["pointerdown", "keydown", "wheel"].forEach((ev) => document.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true }));
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, send) => {
      if (msg && msg.type === "MYADS_IN_USE" && (busy || (document.visibilityState === "visible" && Date.now() - lastInput < 3 * 60 * 1000))) send({ inUse: true });
    });
  } catch (e) { /* no listener = the page never holds an update back */ }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !busy) load(); });
  load();
})();
