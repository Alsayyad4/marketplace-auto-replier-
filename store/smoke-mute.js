/* (v0.21.91) A CLIP, THEN SILENCE — the owner's Oct 24 2026 complaint: "some accounts are
 * not sending messages but are sending videos". Run against the real code sliced out of
 * content.js and background.js:
 *
 *   1. EMOJI ARE PICTURES: a bubble made only of emoji (<img alt="👍">, innerText empty)
 *      is read as the text "👍" — the buyer's 👍 / 🙏 is a turn, not "you spoke last";
 *      an emoji picture is never an attachment; a sidebar preview "Jimmy: · 1h" with an
 *      emoji picture carries that emoji as its body, with none it is media (blank);
 *   2. THE SIDEBAR IS THE WITNESS: turnFromSidebar builds the buyer's turn from the row's
 *      own words when the pane never shows the message — transcript ends with it, the key
 *      counts it once, a cut preview keeps its ellipsis, a blank row becomes the
 *      no-readable-text message, our own rows and system rows give nothing;
 *   3. THE CAP COUNTS OUR BUBBLES: ownTextCount counts painted / right-hugging own texts
 *      and echoes, never a left-hugging unpainted bubble (the buyer's by construction),
 *      and the background prefers that count (youLinesOf) over the "You:" line count;
 *   4. Messenger's own notices are not a waiting buyer (end-to-end encryption line, the
 *      Marketplace Assistant);
 *   5. WIRING: the reply's verdict is awaited BEFORE the clip engine runs; no clip on a
 *      [HUMAN] / held / skipped / failed reply; the text is OWED and lane 1.2 serves it;
 *      the sidebar-sourced turn is tried before the idle verdict; both pre-send looks pass
 *      the chat's own seller count and the right transcript.
 *
 * Run:  node store/smoke-mute.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const cs = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a); process.exit(1); }
  return src.slice(s, e);
}
const SEP = "\u0001";
const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
const normMsg = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
const THUMB = String.fromCodePoint(0x1f44d); // 👍
const PRAY = String.fromCodePoint(0x1f64f); // 🙏
const HEART = String.fromCodePoint(0x2764, 0xfe0f); // ❤️

// --- the page reader, the same slice smoke-teach runs (now with the emoji helpers) ----
const readerSrc = between(cs, "  // Things that are NOT chat messages", "  function buyerSpokeLast() {");
const ROW = { left: 300, right: 900 };
function makeThread(label, ownEcho, mainRect) {
  const state = { nodes: [], href: "https://www.messenger.com/marketplace/t/123456/", anchors: [], label };
  const rect = (left, right, top) => ({ left, right, top, bottom: top + 20, width: right - left, height: 20 });
  const row = { getBoundingClientRect: () => rect(ROW.left, ROW.right, 0) };
  // el(text, left, right, top, paint, imgAlts): a leaf text node; imgAlts = emoji pictures inside it
  const el = (text, left, right, top, paint, imgAlts) => {
    const style = paint === "blue" ? { borderTopLeftRadius: "18px", backgroundColor: "rgb(0, 132, 255)", backgroundImage: "none" }
      : paint === "gray" ? { borderTopLeftRadius: "18px", backgroundColor: "rgb(240, 240, 240)", backgroundImage: "none" }
      : { borderTopLeftRadius: "0px", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none" };
    const imgs = (imgAlts || []).map((alt) => ({ getAttribute: (k) => (k === "alt" ? alt : "") }));
    const n = { nodeType: 1, innerText: text, textContent: text, _cs: style, parentElement: null,
      querySelector: () => null, querySelectorAll: (sel) => (sel === "img" ? imgs.slice() : []),
      closest: (sel) => (sel === '[role="row"]' ? row : null), getBoundingClientRect: () => rect(left, right, top) };
    state.nodes.push(n);
    return n;
  };
  const main = { querySelectorAll: (sel) => (sel.indexOf("img") >= 0 ? [] : state.nodes.slice()) };
  if (mainRect) main.getBoundingClientRect = () => mainRect; // (the pane's box; absent = the old textbox bound)
  const composer = { getBoundingClientRect: () => rect(ROW.left, ROW.right, 800) };
  const api = new Function(
    "safe", "normMsg", "isOwnEcho", "getMain", "findComposer", "conversationAnchors", "threadId", "anchorName", "location", "getComputedStyle",
    readerSrc + "\nreturn { readConversation, turnFromConvo, turnFromSidebar, ownTextCount, isEmojiAlt, emojiAlt, noteOpenThread, NO_TEXT_MSG, isNoise };"
  )(safe, normMsg, (t) => !!ownEcho && ownEcho === t, () => main, () => composer, () => state.anchors, (a) => a.id, (a) => a.name, { get href() { return state.href; } }, (n) => n._cs || {});
  if (label) api.noteOpenThread("123456", "123456", label);
  return { state, el, api };
}

console.log("— 1. emoji are pictures —");
{
  const t = makeThread("Jimmy · tablet samsung");
  t.el("Allô! Oui, la tablette est dispo, en liquidation.", 600, 900, 100, "blue");
  t.el("", 300, 340, 200, "gray", [THUMB]); // the buyer's 👍: no text node, one picture
  const convo = t.api.readConversation();
  const turn = t.api.turnFromConvo(convo, null);
  ok(convo.length === 2 && convo[1].role === "buyer" && convo[1].text === THUMB, "a bubble made only of an emoji picture reads as that emoji, the buyer's (gray)");
  ok(!!turn && turn.buyerMessage === THUMB && turn.transcript.endsWith("Buyer: " + THUMB) && turn.dedupeKey === "Allô! Oui, la tablette est dispo, en liquidation." + SEP + "1" + SEP + THUMB, "…and it is the buyer's turn — before this the chat read \"you spoke last\" (clip sent, no answer)");
  const t2 = makeThread("Jimmy · tablet samsung");
  t2.el("Allô! Oui, la tablette est dispo.", 600, 900, 100, "blue");
  t2.el("", 300, 380, 200, "gray", [PRAY, HEART]);
  ok(t2.api.turnFromConvo(t2.api.readConversation(), null).buyerMessage === PRAY + " " + HEART, "several emoji pictures join into one text");
  const t3 = makeThread("Jimmy · tablet samsung");
  t3.el("Merci!", 300, 400, 200, "gray", [THUMB]); // text with an inline emoji keeps its text (keys stay stable across the update)
  ok(t3.api.readConversation()[0].text === "Merci!", "a bubble with text keeps its innerText (an inline emoji does not change the key an older build stored)");
  const E = t.api;
  ok(E.isEmojiAlt(THUMB) && E.isEmojiAlt(HEART) && E.isEmojiAlt(THUMB + PRAY) && !E.isEmojiAlt("") && !E.isEmojiAlt("Sticker") && !E.isEmojiAlt("May be an image of a phone") && !E.isEmojiAlt("photo " + THUMB + " of it"), "isEmojiAlt: emoji alts only — never a sticker's or a photo's description");
  ok(E.emojiAlt({ querySelectorAll: () => [{ getAttribute: () => THUMB }, { getAttribute: () => "Profile picture" }] }) === THUMB && E.emojiAlt({}) === "", "emojiAlt reads the emoji pictures of an element, ignores other images, survives a node without querySelectorAll");
  ok(/if \(isEmojiAlt\(safe\(\(\) => el\.getAttribute\("alt"\), ""\)\)\) continue;/.test(cs), "the media pass skips emoji pictures (they are text, never an attachment)");
  ok(/Pass 1\.2 — emoji pictures OUTSIDE any text node/.test(cs) && /main\.querySelectorAll\('\[role="row"\] img\[alt\]'\)/.test(cs), "a lone emoji picture with no text wrapper is read by its alt too");
}

// --- the sidebar row readers -------------------------------------------------------
const sideSrc = between(cs, "  function snippetSuggestsBuyerLast(a) {", "  // Does this sidebar row show as UNREAD");
const S = new Function("safe", "emojiAlt", "sidebarQuietMs", sideSrc + "\nreturn { snippetSuggestsBuyerLast, sidebarSnippetBody, snipKey };")(
  safe,
  (a) => (a.alts || []).join(" "),
  () => null
);
const rowOf = (text, alts) => ({ innerText: text, alts: alts || [] });

console.log("\n— 2. the sidebar row's own words —");
{
  ok(JSON.stringify(S.sidebarSnippetBody(rowOf("Amel · iPhone\nAmel: 11pro · 20h"))) === JSON.stringify({ body: "11pro", media: false, cut: false }), "\"Amel: 11pro · 20h\" → body 11pro, not cut");
  ok(JSON.stringify(S.sidebarSnippetBody(rowOf("Jonathan · Ma\nJonathan: Tu peux m'envoyer le prix de chaque té… · 3h"))) === JSON.stringify({ body: "Tu peux m'envoyer le prix de chaque té", media: false, cut: true }), "a preview Messenger cut short is marked cut");
  ok(JSON.stringify(S.sidebarSnippetBody(rowOf("Jimmy · table\nJimmy: · 1h", [THUMB]))) === JSON.stringify({ body: THUMB, media: false, emoji: true }), "\"Jimmy: · 1h\" with an emoji picture → the emoji is the body");
  ok(JSON.stringify(S.sidebarSnippetBody(rowOf("Jimmy · table\nJimmy: · 1h"))) === JSON.stringify({ body: "", media: true, blank: true }), "\"Jimmy: · 1h\" with nothing to read → media, blank (the buyer still sent something)");
  ok(S.sidebarSnippetBody(rowOf("Malik · Magni\nUnread message: You: Oui, on a du stock · 2h")) === null && S.sidebarSnippetBody(rowOf("Papino\nVous : oui, on a les iPhone 17 · 1h")) === null, "our own rows give nothing");
  ok(S.sidebarSnippetBody(rowOf("Naveed · Magn\nUnread message: This is an automated suggestion.")) === null, "a system row with no name: body gives nothing");
  ok(JSON.stringify(S.sidebarSnippetBody(rowOf("Mohand\nMohand sent a photo. · 4h"))) === JSON.stringify({ body: "", media: true }), "\"Mohand sent a photo.\" is media (unchanged)");
  const T = makeThread("Amel · iPhone");
  T.el("Allô! Oui, le 13 Pro Max est dispo.", 600, 900, 100, "blue");
  const convo = T.api.readConversation();
  const st = T.api.turnFromSidebar(convo, { body: "11pro", media: false, cut: false });
  ok(!!st && st.fromSidebar === true && st.buyerMessage === "11pro" && st.transcript === "You: Allô! Oui, le 13 Pro Max est dispo.\nBuyer: 11pro" && st.memTranscript === st.transcript, "turnFromSidebar: the row's words become the buyer's turn, the transcript ends with that line");
  ok(st.dedupeKey === "Allô! Oui, le 13 Pro Max est dispo." + SEP + "1" + SEP + "11pro" && st.legacyKey === null && st.youTexts === 1, "…keyed as one buyer bubble after our last text (answered once), with the seller count of what was readable");
  const st2 = T.api.turnFromSidebar(convo, { body: "Tu peux m'envoyer le prix de chaque té", media: false, cut: true });
  ok(st2.buyerMessage === "Tu peux m'envoyer le prix de chaque té…" && st2.dedupeKey.endsWith(SEP + "Tu peux m'envoyer le prix de chaque té…"), "a cut preview keeps its ellipsis so the model knows the message is longer");
  const st3 = T.api.turnFromSidebar(convo, { body: "", media: true, blank: true });
  ok(st3.buyerMessage === T.api.NO_TEXT_MSG && /no readable text/.test(st3.buyerMessage), "a blank row is answered as a message with no readable text");
  ok(T.api.turnFromSidebar(convo, null) === null && T.api.turnFromSidebar(convo, { body: "", media: false }) === null, "no hint, or a hint with nothing in it, gives no turn");
  ok(T.api.turnFromSidebar([], { body: "allo", media: false }).transcript === "Buyer: allo" && T.api.turnFromSidebar([], { body: "allo", media: false }).dedupeKey === SEP + "1" + SEP + "allo", "an empty read still yields the turn (first contact)");
  const T2 = makeThread("Amel · iPhone");
  T2.el("Allô!", 600, 900, 60, "blue");
  T2.el("le 13", 300, 400, 100, "gray");
  T2.el("Oui, le 13 Pro Max est dispo.", 600, 900, 140, "blue");
  T2.el("ok", 300, 360, 180, "gray");
  const st4 = T2.api.turnFromSidebar(T2.api.readConversation(), { body: "11pro", media: false });
  ok(st4.dedupeKey === "Oui, le 13 Pro Max est dispo." + SEP + "2" + SEP + "11pro" && st4.transcript.split("\n").length === 5, "the key counts the readable buyer bubbles since our last text plus the row's own");
}

console.log("\n— 3. the per-chat cap counts OUR bubbles —");
{
  const t = makeThread("Fæî · Samsung");
  const C = t.api.ownTextCount;
  const e = (role, text, paint, hug) => ({ role, text, paint, hug });
  ok(C([e("me", "allo", true, "right"), e("me", "le prix", true, null), e("me", "echo", true, "left")]) === 3, "painted own bubbles count (an echo of what we sent even when it hugs left)");
  ok(C([e("me", "unpainted right", null, "right"), e("me", "no row box", null, null), e("me", "no row box 2", false, undefined)]) === 3, "an unpainted bubble hugging the right, or one with no geometry, still counts (the safe side of the limit)");
  ok(C([e("me", "the buyer's words, unreadable paint", null, "left"), e("me", "same again", null, "left"), e("buyer", "hi", false, "left")]) === 0, "a LEFT-hugging unpainted bubble labelled \"me\" by default is not a seller text — it used to fill the cap on the buyer's own second message");
  ok(C([e("me", "[attachment]", null, "right"), e("me", "ok", true, "right")]) === 1 && C([]) === 0 && C(null) === 0, "clips and nothing count as nothing");
  // from a real read: a first-contact chat whose buyer bubbles paint-read as unknown (a
  // transparent wrapper) — with no bubble of ours the column collapses onto them, the
  // geometry rule calls them "me", and the sidebar's name rescues only the LAST one.
  const t2 = makeThread("Fæî · Samsung");
  t2.el("c combien le S23?", 300, 440, 100, null);
  t2.el("allo t'es là?", 300, 440, 180, null);
  const hint2 = { body: "allo t'es là?", media: false };
  const r2 = t2.api.readConversation(hint2);
  const turn2 = t2.api.turnFromConvo(r2, hint2);
  ok(r2[0].role === "me" && r2[0].hug === "left" && r2[0].paint === null, "(the read itself is unchanged: ambiguity still defaults to \"me\", never a self-reply; the row's name rescues the last bubble only)");
  ok(!!turn2 && turn2.buyerMessage === "allo t'es là?" && turn2.transcript === "You: c combien le S23?\nBuyer: allo t'es là?" && turn2.youTexts === 0, "…the buyer's earlier line still reads \"You:\" in the transcript, but the cap count is 0 seller texts where the line count said 1 — the chat is not capped one message early");
  const L = new Function(between(bg, "/* ===== (v0.21.86) THE MESSAGE LEDGER", "/* ===== LEDGER END ===== */") + "\nreturn { youLinesOf, youLineCount };")();
  ok(L.youLinesOf({ youTexts: 0 }, turn2.transcript) === 0 && L.youLinesOf({}, turn2.transcript) === 1, "background: youLinesOf takes the content script's count, falls back to the line count for an older content script");
}

console.log("\n— 4. Messenger's own notices are not a waiting buyer —");
{
  ok(!S.snippetSuggestsBuyerLast(rowOf("Zahra Za\nMessages and calls are secured with end-to-end encryption. · 4w")) && !S.snippetSuggestsBuyerLast(rowOf("Zahra\nLes messages et les appels sont chiffrés de bout en bout. · 4w")), "the end-to-end encryption line of an empty chat");
  ok(!S.snippetSuggestsBuyerLast(rowOf("Facebook Marketplace Assistant\nUnread message: It looks like you listed this item over 4 weeks ago.")), "the Marketplace Assistant thread");
  ok(S.snippetSuggestsBuyerLast(rowOf("Amel · iPhone\nAmel: 11pro · 20h")) && S.snippetSuggestsBuyerLast(rowOf("Jimmy · table\nJimmy: · 1h")) && !S.snippetSuggestsBuyerLast(rowOf("Malik\nUnread message: You: Oui · 2h")), "real buyer rows still count (an emoji-only one too); our rows do not");
  // (v0.21.91) a settled row is remembered by its words, not its age
  const k1 = S.snipKey(rowOf("Amel · iPhone\nAmel: 11pro · 20h"));
  ok(k1 === "amel · iphone amel: 11pro" && k1 === S.snipKey(rowOf("Amel · iPhone\nUnread message: Amel: 11pro · 21h")) && k1 === S.snipKey(rowOf("Amel · iPhone\nAmel: 11pro\n·\n1j")), "snipKey: the same words an hour later, unread or not, on one line or several, are the same key");
  ok(k1 !== S.snipKey(rowOf("Amel · iPhone\nAmel: le 12 aussi · 1m")) && S.snipKey(rowOf("")) === "" && S.snipKey({}) === "", "…a new message is a new key; nothing reads as nothing");
}

console.log("\n— 5. wiring —");
{
  const h = between(cs, "  async function handleThread(anchor) {", "  /* ---------------- main loop ---------------- */");
  const iVerdict = h.indexOf("const reply = await replyPromise;");
  const iEngine = h.indexOf("await maybeSendVideo(id, name, true, sidebarId, false, { onClipSent: (i) => shipReply(typeof i === \"number\" && i >= 0) });");
  const iShip = h.indexOf("const shipReply = async (afterClip) => {");
  ok(iVerdict > 0 && iEngine > 0 && iVerdict < iShip && iShip < iEngine, "the reply's verdict is awaited BEFORE the clip engine runs (verdict → shipReply defined → videos-first)");
  const verdict = h.slice(iVerdict, iShip);
  ok(/if \(!reply \|\| !reply\.ok\) \{[\s\S]{0,200}oweOrGiveUp\(id, sidebarId, turn, "claude error: " \+ \(reply && reply\.error\), rescueHint\);\s*\n\s*return;/.test(verdict), "a Claude error: nothing typed, no clip, the text is owed (three tries, then let go)");
  ok(/if \(reply\.human\) \{[\s\S]{0,300}return; \/\/ \(v0\.21\.91\) no clip either/.test(verdict), "[HUMAN] / a held reply: no clip either");
  ok(/else if \(reply\.held\) \{[\s\S]{0,200}oweText\(id, sidebarId, turn, reply\.reason, rescueHint\);/.test(verdict) && /else if \(reply\.memory === "claimed"\) \{[\s\S]{0,700}oweText\(id, sidebarId, turn, "claimed elsewhere", rescueHint\);/.test(verdict), "a budget hold or a claim elsewhere owes the text (with the row hint the revisit may need)");
  ok(/if \(reply\.reason === "empty reply" \|\| reply\.memory === "answered" \|\| reply\.memory === "echo" \|\| reply\.title \|\| reply\.screen\) \{/.test(verdict) && !/maybeSendVideo/.test(verdict), "a deliberate silence is marked handled, and no clip goes out in the verdict block");
  ok(/"counted across computers", false, reply\.cloudTexts\);\s*\n\s*return;\s*\n\s*\}/.test(verdict), "the cloud-counted cap takes the clip pass inside atConvoCap (the engine is not running yet)");
  ok(/if \(!memoOk\) pendingReply\[id\] = \{[^\n]*\n\n\s*\/\/ Ships the text reply exactly once/.test(h), "the billed text is memoized before the clip engine runs (an abort during the attach replays it free)");
  const ship = h.slice(iShip, iEngine);
  ok(/oweText\(id, sidebarId, turn, "chat switched during the wait", rescueHint\)/.test(ship) && /oweOrGiveUp\(id, sidebarId, turn, "send failed", rescueHint\)/.test(ship) && /delete textOwed\[sidebarId \|\| id\]; delete textOwed\[id\];/.test(ship), "a switched chat or a failed send owes the text; a delivery settles it");
  ok(/transcript: presendTranscript\(turn\), localReplies: replyCounts\[id\] \|\| 0, youTexts: ownTextsNow\(turn\)/.test(ship), "the pre-send look passes the right transcript and the chat's own seller count");
  ok(/\|\| \(turn\.fromSidebar \? sidebarTurnNow\(id, sidebarId\) : null\)/.test(ship), "the conversation recheck re-reads a sidebar-sourced turn from the row");
  const cap = between(cs, "  async function atConvoCap(", "  /* ---------------- handle ONE conversation ---------------- */");
  ok(/transcript: presendTranscript\(turn\), localReplies: so, youTexts: ownTextsNow\(turn\)/.test(cap), "the cap's closing-line look does the same");
  const idle = h.slice(0, iVerdict);
  const iRow = idle.indexOf("const fromRow = hintRow ? turnFromSidebar(");
  const iIdle = idle.indexOf("waitSuppress[id] = Date.now() + 6 * 3600 * 1000;");
  ok(iRow > 0 && iIdle > iRow && /if \(!turn\) \{\s*\n\s*clearWaiting\(id, sidebarId\); \/\/ genuinely idle/.test(idle), "the sidebar-sourced turn is tried before the idle verdict (6 h suppression + clip) — only a chat with no row words is still declared idle");
  ok(/if \(fromRow\) \{\s*\n\s*turn = fromRow;\s*\n\s*rescueHint = hintRow;/.test(idle) && /const hintRow = safe\(\(\) => sidebarSnippetBody\(anchor\), null\);/.test(idle), "…and a turn the row gives IS adopted (turn + the hint the pre-send recheck re-runs)");
  ok(/rescueStats\.sidebar\+\+;/.test(idle) && /rescue: sidebarTurns=" \+ rescueStats\.sidebar \+ " textOwed=" \+ Object\.keys\(textOwed\)\.length/.test(cs), "🩺 counts the sidebar-sourced answers and the texts owed");
  const pick = between(cs, "  function pickTarget(anchors, now, exclude, videoAtt) {", "  // DEEP-SCAN:");
  const iLane1 = pick.indexOf("return a; // first match = newest buyer");
  const iLane12 = pick.indexOf("LANE 1.2 — TEXT OWED");
  const iLane15 = pick.indexOf("LANE 1.5 — PENDING VIDEOS");
  ok(iLane1 > 0 && iLane12 > iLane1 && iLane15 > iLane12 && /const o = textOwed\[id\];[\s\S]{0,400}if \(now - o\.at < COOLDOWN_MS\) continue;[\s\S]{0,700}if \(owed\) return owed;/.test(pick), "lane 1.2 serves an owed text after the newest buyer and before the pending videos, after its cooldown");
  ok(/lastHandled\[o\.id\] === o\.key \|\| lastHandled\[id\] === o\.key\) \{ delete textOwed\[id\]; continue; \}/.test(pick), "…and forgets a text settled another way (or older than 45 min)");
  ok(/youTexts: turn\.youTexts \}\); \/\/ \(v0\.21\.86\)/.test(h), "GET_REPLY_SIMPLE carries the chat's own seller count");
  ok(/youLinesOf\(msg, dropTitleLines\(msg\.memContext, msg\.threadName\) \|\| ctx\)/.test(bg) && /youLinesOf\(msg, dropTitleLines\(msg\.transcript, msg\.threadName\)\), memTextCount\(rows\)\)/.test(bg), "both background gates count through youLinesOf");
  ok(!/const reply = await replyPromise; \/\/ usually already resolved while clip 1 attached/.test(cs), "the old in-engine verdict is gone");
  // (v0.21.91) settled rows leave the buyer-last rotation until their words change
  ok(/openSnip = safe\(\(\) => snipKey\(anchor\), ""\);/.test(h) && /clearWaiting\(id, sidebarId\); \/\/ already answered this exact message\s*\n\s*noteSettled\(sidebarId\);/.test(h) && /waitSuppress\[sidebarId\] = waitSuppress\[id\];\s*\n\s*noteSettled\(sidebarId\);/.test(h), "a visit that finds the message already answered, or declares the chat idle, remembers the row's words");
  ok(/lastHandled\[id\] = turn\.dedupeKey;\s*\n\s*noteSettled\(sidebarId\);/.test(cap), "…so does the reply cap");
  ok(/if \(settledSnip\[id\] && settledSnip\[id\] === safe\(\(\) => snipKey\(a\), ""\)\) continue;/.test(pick) && pick.indexOf("settledSnip[id]") > pick.indexOf("LANE 1.5 — PENDING VIDEOS"), "lane 2 (buyer-last rotation) skips a settled row whose words have not changed — lanes 0/1 and the owed lane are not affected");
  ok(/delete settledSnip\[sidebarId\];/.test(ship) && /function noteSettled\(sid\) \{[\s\S]{0,300}if \(ks\.length > 600\)/.test(cs), "a delivery forgets the row; the memory is bounded");
}

console.log("\n— 6. the audit's findings (Oct 24 2026) —");
{
  // THE ECHO GUARD, real code: exact or near-exact, and local to the chat
  const echoSrc = between(cs, "  function isOwnEcho(msg) {", "  // Cross-tab single-flight");
  const mk = (recent, ids) => new Function("recentSent", "normMsg", "openThreadIds", echoSrc + "\nreturn isOwnEcho;")(recent, normMsg, () => ids);
  const ours = "oui, on en a! iphone 17 pro max en liquidation avec garantie, passe nous voir";
  let E = mk([{ t: ours, id: "A" }], ["A"]);
  ok(!E("iPhone 17 Pro Max") && !E("le 17 pro max svp") && !E("en liquidation avec garantie"), "a buyer naming a model or a phrase our text contains is NOT an echo any more (the old substring rule read it as our own bubble → clip, no text)");
  ok(E("Oui, on en a! iPhone 17 Pro Max en liquidation avec garantie, passe nous voir") && E(ours + " !") , "our own text read back IS an echo (exact, or within 10 % — the same text with a stray character)");
  ok(mk([{ t: ours + " " + THUMB, id: "A" }], ["A"])(ours), "…and our bubble read back WITHOUT its trailing emoji (Facebook draws it as a picture) is still ours");
  ok(!mk([{ t: ours, id: "A" }], ["B"])(ours) && mk([{ t: ours, id: "A" }], [])(ours) && mk([ours], ["B"])(ours), "an entry remembers its chat: not an echo in another chat; unknown open chat or an older plain-string entry counts anywhere");
  ok(!mk([{ t: "allo", id: "A" }], ["A"])("allo") && !mk([{ t: "ok merci", id: "A" }], ["A"])("ok merci"), "short greetings never (the 10-char floor stands)");
  const remSrc = between(cs, "  function rememberSent(t) {", "  // (v0.21.91) the ids the open chat is known by");
  const bag = []; const chromeStub = { storage: { local: { set: () => {} } } };
  new Function("recentSent", "normMsg", "safe", "openLabel", "chrome", remSrc + "\nrememberSent('Oui, on en a!  iPhone 17 Pro Max');")(bag, normMsg, safe, { id: "123", sid: "" }, chromeStub);
  ok(bag.length === 1 && bag[0].t === "oui, on en a! iphone 17 pro max" && bag[0].id === "123", "rememberSent stores the text with its chat id");
  ok(/!turn\.fromSidebar && !turn\.owed && isOwnEcho\(turn\.buyerMessage\)/.test(cs), "a turn Messenger's own row attributes to the buyer by name is never judged an echo");

  // A BLANK ROW NEVER ADOPTS OUR OWN CLIP
  const T = makeThread("Jimmy · tablet");
  const ourClip = [{ role: "me", text: "Allô! Oui, la tablette est dispo.", paint: true, hug: "right", top: 1 }, { role: "me", text: "[attachment]", paint: null, hug: "right", top: 2 }];
  ok(T.api.turnFromConvo(ourClip.map((e) => Object.assign({}, e)), { body: "", media: true, blank: true }) === null, "a blank row (\"Jimmy: · 1h\") does not adopt the trailing attachment — it is our own clip");
  ok(T.api.turnFromConvo(ourClip.map((e) => Object.assign({}, e)), { body: "", media: true }) === null, "nor does an explicit media row adopt an attachment hugging OUR side");
  // an attachment with no geometry at all: the explicit "sent a photo." row vouches for it (Messenger's order — it is the buyer's), the blank row does not
  const noGeo = () => [{ role: "me", text: "Allô!", paint: true, hug: "right", top: 1 }, { role: "me", text: "[attachment]", paint: null, hug: null, top: 2 }];
  ok(T.api.turnFromConvo(noGeo(), { body: "", media: true, blank: true }) === null && !!T.api.turnFromConvo(noGeo(), { body: "", media: true }), "with no geometry to read, only the explicit media row adopts the attachment — a blank row never does");
  const theirs = [{ role: "me", text: "Allô!", paint: true, hug: "right", top: 1 }, { role: "me", text: "[attachment]", paint: null, hug: "left", top: 2 }];
  const adopted = T.api.turnFromConvo(theirs, { body: "", media: true });
  ok(!!adopted && adopted.buyerMessage === "(the buyer sent a photo/video attachment with no text)", "a left-hugging attachment under \"Mohand sent a photo.\" is still adopted as the buyer's (unchanged)");
  ok(T.api.turnFromSidebar([], { body: "", media: true, blank: true }).buyerMessage === T.api.NO_TEXT_MSG, "…the blank row is answered from the row instead (no readable text)");

  // THE PANE, NOT THE TEXTBOX, BOUNDS THE READ
  const near = makeThread("Amel · iPhone");
  near.el("11pro", 110, 170, 200, "gray"); // a short buyer bubble at the far left, centre 140 < textbox.left (300) - 60
  ok(near.api.readConversation().length === 0, "(before: a short left-hugging bubble was dropped by the textbox's own left edge)");
  const wide = makeThread("Amel · iPhone", null, { left: 100, right: 900, top: 0, bottom: 800, width: 800, height: 800 });
  wide.el("11pro", 110, 170, 200, "gray");
  const wc = wide.api.readConversation();
  ok(wc.length === 1 && wc[0].role === "buyer" && wc[0].text === "11pro", "with the pane's box the same bubble is read, the buyer's");
  ok(near.api.isNoise("Jimmy is waiting for your response.") && !near.api.isNoise("still waiting for your response") && !near.api.isNoise("I'm waiting for your response!!"), "isNoise: only Facebook's own \"X is waiting for your response.\" is noise — a buyer who says they are waiting is a message");

  // OWED TURNS, HOOK-LESS PASSES, THE ENGINE HOOK
  const h = between(cs, "  async function handleThread(anchor) {", "  /* ---------------- main loop ---------------- */");
  ok(/const owed = textOwed\[sidebarId\] \|\| textOwed\[id\];\s*\n\s*if \(owed && owed\.turn && lastHandled\[id\] !== owed\.key && Date\.now\(\) - owed\.at <= 45 \* 60 \* 1000\) \{\s*\n\s*turn = Object\.assign\(\{\}, owed\.turn, \{ owed: true \}\);/.test(h), "a revisit whose pane cannot show the message answers the turn remembered when the text was owed");
  ok(/if \(!recheck && !live && turn\.owed\) recheck = turn;/.test(h), "…and the pre-send recheck accepts it when no new buyer bubble is live");
  ok(/oweOrGiveUp\(id, sidebarId, turn, "claude error: " \+ \(reply && reply\.error\), rescueHint\);/.test(h) && /oweOrGiveUp\(id, sidebarId, turn, "send failed", rescueHint\);/.test(h) && /function oweOrGiveUp\(id, sid, turn, why, hint\) \{[\s\S]{0,200}if \(!o \|\| o\.tries < 3\) return false;/.test(cs), "a Claude error or a failed send is owed with the hint; the third failure lets the message go");
  const pick = between(cs, "  function pickTarget(anchors, now, exclude, videoAtt) {", "  // DEEP-SCAN:");
  ok(/if \(now <= \(cooldowns\[id\] \|\| 0\) \|\| \(o\.id && now <= \(cooldowns\[o\.id\] \|\| 0\)\)\) continue;/.test(pick), "lane 1.2 is paced by the visit's own cooldown (no 8-s loop)");
  const gated = (h.match(/if \(chatHasOurText\(id, sidebarId, (turn|null)\)\) \{/g) || []).length;
  const cap = between(cs, "  async function atConvoCap(", "  /* ---------------- handle ONE conversation ---------------- */");
  ok(gated === 3 && /if \(!noVideo && chatHasOurText\(id, sidebarId, turn, cloudTexts\)\) \{/.test(cap), "the hook-less clip passes (already answered, echo, idle, the cap) run only for a chat that holds a text of ours (" + gated + " + cap)");
  ok(/const keep = Math\.max\(replyCounts\[id\] \|\| 0, Math\.floor\(Number\(cloudTexts\) \|\| 0\)\);/.test(cap) && /replyCounts\[id\] = Number\(fresh\.cloudTexts\) \|\| 0;/.test(cap), "the cap persists only a DELIVERED count (this computer's or the Activity log's), never one read off the bubbles");
  ok(/"counted across computers", false, reply\.cloudTexts\);/.test(h) && /"counted across computers", true, pre\.cloudTexts\);/.test(h), "both cap verdicts hand the cloud count to atConvoCap");
  ok(/onClipSent: \(i\) => shipReply\(typeof i === "number" && i >= 0\)/.test(h), "the engine's give-up hook (-1) ships the text as a text-only visit (full delay, recheck kept)");

  // BACKGROUND: the cap answer, the screen wall, accidental empties, the claim, the title, the prompt
  const g = between(bg, 'case "GET_REPLY_SIMPLE": {', 'case "MEMORY_PRESEND": {');
  ok(/const capAnswer = \(cloud\) => \{/.test(g) && /cloudTexts: Math\.max\(0, Math\.floor\(Number\(cloud\) \|\| 0\)\)/.test(g) && /capAnswer\(0\); break;/.test(g) && /capAnswer\(memTextCount\(memRows\)\); break;/.test(g) && /cloudTexts: memTextCount\(rows\), max: cc\.cap/.test(bg), "the cap answers carry cloudTexts (0 before the memory is read, the log's text rows after)");
  const screenSrc = between(bg, "const SCREEN_RES = [", "// The buyer's message without Facebook's lines");
  const screenText = new Function(screenSrc + "\nreturn screenText;")();
  ok(screenText("Jimmy is waiting for your response.") && screenText("Amel attend ta réponse") && !screenText("still waiting for your response") && !screenText("I'm waiting for your reply since yesterday") && !screenText("j'attends votre réponse"), "the screen wall drops only Facebook's \"X is waiting for your response.\" — a buyer who says they are waiting gets an answer");
  ok(/if \(parsed\.kind === "empty" && parsed\.skip\) \{[\s\S]{0,300}sendResponse\(\{ ok: true, skip: true, reason: "empty reply" \}\);/.test(g) && /sendResponse\(\{ ok: false, error: "empty model output \(" \+ \(parsed\.kind \|\| "\?"\)/.test(g), "[SKIP] stays the model's deliberate silence; an ACCIDENTAL empty is an error the content script retries (owed)");
  ok((g.match(/if \(claimed\) memUnclaim\(msg\.threadId, msg\.threadName, msg\.buyerMessage, machineId\);/g) || []).length >= 5, "every verdict that delivers nothing withdraws the claim (error, held, human, [SKIP], accidental empty)");
  const titleSrc = between(bg, "const titleNorm = ", "function dropTitleLines");
  const isChatTitle = new Function(titleSrc + "\nreturn isChatTitle;")();
  const TT = "Cheikh Ibreu · Magnifique iPhone 17 Pro Max 256";
  ok(!isChatTitle("Cheikh Ibreu", TT) && !isChatTitle("cheikh ibreu ", TT) && isChatTitle("Cheikh Ibreu · Magnifique", TT) && isChatTitle(TT, TT) && isChatTitle(TT + " · CA$1", TT), "isChatTitle: a buyer typing their own name is a message; a cut title reaching into the headline is still the title");
  ok(/Never \[SKIP\] a buyer's FIRST message in a chat, not even a lone emoji/.test(bg), "the owner prompt: a first message is never silence (a lone 👍 reaches the model now)");
}

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
