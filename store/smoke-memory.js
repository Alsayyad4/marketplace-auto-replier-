/* v0.21.71 — THREAD MEMORY + TYPING PACE. Runs the real functions sliced out of
 * background.js (memVerdict / memVideoSent / memoryLine) and content.js
 * (typingPaceMs) against hand-built Activity rows and transcripts, and asserts:
 *   1. a message another computer just answered is skipped ("answered") — but the
 *      same words in an OLDER exchange (its reply already in the transcript) are not;
 *   2. our own sent text read back as the buyer's is skipped ("echo"), short words never;
 *   3. two claims on the same message: the earlier one replies, the later one stands
 *      down, a tie breaks on the id, stale claims (>10 min) are ignored, my own
 *      earlier claim beats a later one;
 *   4. the video rows the engine writes when clips WENT OUT count as sent, the
 *      "0/N … failed" row never does, and "mine" is read from the #PC- tag;
 *   5. the memory line names the facts already given, the openers already used,
 *      the video already sent — and is empty when there is nothing to say;
 *   6. the typing pace is 0 when off, capped, and grows with length.
 * Run:  node store/smoke-memory.js
 */
const fs = require("fs");
const path = require("path");

const bg = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const ct = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) { console.error("not found: " + startMarker); process.exit(1); }
  const e = src.indexOf(endMarker, s + startMarker.length);
  if (e < 0) { console.error("end not found after: " + startMarker); process.exit(1); }
  return src.slice(s, e);
}
const memBlock = slice(bg, "const MEM_THREAD_LIMIT = ", "\nfunction memNote(");
const memFns = slice(bg, "function memClaimOf(", "\nfunction getCloudAuth() {");
const paceFn = slice(ct, "  function typingPaceMs(", "\n  const log = ");
const mk = new Function(
  "rand",
  memBlock + "\n" + memFns + "\n" + paceFn + "\nreturn { memVerdict, memVideoSent, memoryLine, typingPaceMs, memKey, memNorm, memLiveClaims };"
);
const { memVerdict, memVideoSent, memoryLine, typingPaceMs, memLiveClaims } = mk((a, b) => (a + b) / 2);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

const T0 = Date.parse("2026-09-30T15:00:00Z");
const iso = (secAgo) => new Date(T0 - secAgo * 1000).toISOString();
const ME = "PC-aaaaa";
const row = (kind, secAgo, buyer, bot, machine) => ({ kind, created_at: iso(secAgo), buyer_text: buyer, bot_text: bot, machine: machine || ("Shop PC · v0.21.71 #PC-bbbbb") });
const V = (rows, buyerMessage, transcript, phase) => memVerdict(rows, { buyerMessage, transcript, machineId: ME, now: T0, phase: phase || "gen" });

// --- 1. answered elsewhere ---
{
  const tx = "Buyer: allo\nYou: salut, oui dispo\nBuyer: c'est combien?";
  const r = V([row("text", 20, "c'est combien?", "le meilleur prix se fait en personne, tu passes quand?")], "C'est combien?", tx);
  ok(r && r.memory === "answered" && /Shop PC/.test(r.reason) && !/#PC-/.test(r.reason), "a reply another computer delivered 20 s ago to this exact message → skip (answered, named without the #id)");
  const older = V([row("text", 20, "ok", "parfait, à tantôt")], "ok", "Buyer: ok\nYou: parfait, à tantôt\nBuyer: ok");
  ok(older === null, "the same words in an OLDER exchange (its reply is in the transcript) → go ahead");
  const stale = V([row("text", 40 * 60, "c'est combien?", "en personne")], "c'est combien?", tx);
  ok(stale === null, "a reply older than 30 min is not 'answered'");
  const other = V([row("text", 20, "still available?", "yes it is")], "c'est combien?", tx);
  ok(other === null, "a reply to a DIFFERENT buyer text is not 'answered'");
  // videos-first path: the other computer's reply is already IN the chat, after this very message
  const txAfter = "Buyer: allo\nYou: salut, oui dispo\nBuyer: c'est combien?\nYou: le meilleur prix se fait en personne, tu passes quand?\nYou: [attachment]";
  const seen = V([row("text", 3 * 3600, "c'est combien?", "le meilleur prix se fait en personne, tu passes quand?")], "c'est combien?", txAfter, "pre");
  ok(seen && seen.memory === "answered", "a reply that sits AFTER this buyer message in the chat → answered, however old the row");
  const both = V([row("text", 20, "ok", "parfait, à tantôt")], "ok", "Buyer: ok\nYou: parfait, à tantôt\nBuyer: ok\nYou: parfait, à tantôt", "pre");
  ok(both && both.memory === "answered", "…even when the same reply also appears before it");
  const photo = V([row("text", 20, "(the buyer sent a photo/video attachment with no text)", "belle photo, viens le voir en vrai")], "(the buyer sent a photo/video attachment with no text)", "Buyer: [attachment]\nYou: belle photo, viens le voir en vrai\nYou: [attachment]", "pre");
  ok(photo && photo.memory === "answered", "a photo-only buyer message is matched through its [attachment] line");
  const empty = V([], "c'est combien?", tx);
  ok(empty === null && V(null, "x", "") === null, "no rows / null rows → go ahead");
  // a sidebar-RESCUED buyer bubble reads "You:" in the hint-less pre-send transcript — the buyer's line is still found by its text
  const rescued = V([row("text", 3 * 3600, "c'est combien?", "le meilleur prix se fait en personne, tu passes quand?")], "c'est combien?", "Buyer: allo\nYou: salut, oui dispo\nYou: c'est combien?\nYou: le meilleur prix se fait en personne, tu passes quand?\nYou: [attachment]", "pre");
  ok(rescued && rescued.memory === "answered", "rescued turn (buyer line labelled You:) + the other computer's reply after it → answered");
  const rescuedOld = V([row("text", 20, "ok", "parfait, à tantôt")], "ok", "Buyer: ok\nYou: parfait, à tantôt\nYou: ok", "pre");
  ok(rescuedOld === null, "rescued turn whose same-words reply sits only BEFORE it → an older exchange, go ahead");
  // a three-letter reply can no longer hit inside the buyer's own words
  const shortOld = V([row("text", 2 * 3600, "oui c'est encore dispo?", "Oui")], "Oui c'est encore dispo?", "Buyer: oui c'est encore dispo?\nYou: oui\nBuyer: oui c'est encore dispo?", "pre");
  ok(shortOld === null, "'Oui' answered 2 h ago, buyer repeats the question → the old reply is BEFORE the new line → go ahead");
  const shortNow = V([row("text", 20, "oui c'est encore dispo?", "Oui")], "Oui c'est encore dispo?", "Buyer: oui c'est encore dispo?", "pre");
  ok(shortNow && shortNow.memory === "answered", "'Oui' delivered 20 s ago and not rendered → answered (matched as a whole line, not a substring)");
  const multi = V([row("text", 20, "salut", "allo!")], "Salut\nYou: on est au 757 Beaubien", "");
  ok(multi === null, "a multi-line buyer message never equals a one-line reply of ours (no echo)");
}

// --- 2. our own text read back as the buyer's ---
{
  const r = V([row("text", 3600, "allo", "le meilleur prix se fait en personne, tu passes quand?")], "Le meilleur prix se fait en personne, tu passes quand?", "");
  ok(r && r.memory === "echo", "the buyer 'message' equals a reply we sent → skip (echo)");
  const short = V([row("text", 3600, "allo", "ok")], "ok", "");
  ok(short === null, "a short word ('ok') is never an echo, even if we once sent it");
  const old = V([row("text", 2 * 24 * 3600, "allo", "le meilleur prix se fait en personne, tu passes quand?")], "le meilleur prix se fait en personne, tu passes quand?", "");
  ok(old === null, "an echo older than 24 h is ignored");
}

// --- 3. claims ---
{
  const bm = "c'est combien?";
  const theirs = row("claim", 15, bm, "claim PC-bbbbb");
  const mineLater = row("claim", 10, bm, "claim " + ME);
  const mineEarlier = row("claim", 25, bm, "claim " + ME);
  const g1 = V([theirs], bm, "", "gen");
  ok(g1 && g1.memory === "claimed", "gen phase: another computer's claim, none of mine → stand down (claimed)");
  const g2 = V([theirs, mineEarlier], bm, "", "gen");
  ok(g2 === null, "gen phase: my earlier claim beats their later one → go ahead");
  const p1 = V([theirs, mineLater], bm, "", "pre");
  ok(p1 && p1.memory === "claimed", "pre-send: their earlier claim beats my later one → stand down");
  const p2 = V([mineLater], bm, "", "pre");
  ok(p2 === null, "pre-send: only my own claim → go ahead");
  const staleTheirs = row("claim", 11 * 60, bm, "claim PC-bbbbb");
  ok(V([staleTheirs], bm, "", "pre") === null, "a claim older than 10 min is ignored");
  const tieA = Object.assign(row("claim", 15, bm, "claim PC-bbbbb"), {});
  const tieB = Object.assign(row("claim", 15, bm, "claim " + ME), {});
  const tie = V([tieA, tieB], bm, "", "pre");
  ok(tie === null, "a created_at tie breaks on the id string ('claim PC-aaaaa' < 'claim PC-bbbbb' → mine wins)");
  const tieC = V([row("claim", 15, bm, "claim PC-00000"), tieB], bm, "", "pre");
  ok(tieC && tieC.memory === "claimed", "…and the other way round when their id sorts first");
  ok(V([row("claim", 15, "other message", "claim PC-bbbbb")], bm, "", "pre") === null, "a claim on a different buyer text is not a claim on this one");
  // withdrawn and fulfilled claims are dead
  const withdrawn = V([row("claim", 10, bm, "unclaim PC-bbbbb"), theirs], bm, "", "pre");
  ok(withdrawn === null, "their claim followed by their unclaim (the model call failed there) → go ahead");
  const liveA = memLiveClaims([theirs, row("text", 5, bm, "en personne, tu passes?", "Shop PC · v0.21.71 #PC-bbbbb")], memKeyOf(bm), T0);
  ok(liveA.length === 0, "their claim followed by their delivered text row → the claim is fulfilled (dead)");
  const liveB = memLiveClaims([theirs, row("text", 5, bm, "en personne, tu passes?", "Other PC · v0.21.71 #PC-ccccc")], memKeyOf(bm), T0);
  ok(liveB.length === 1 && liveB[0].id === "PC-bbbbb", "a text row from a THIRD machine does not fulfil their claim");
  const liveC = memLiveClaims([theirs, row("text", 20, bm, "older", "Shop PC · v0.21.71 #PC-bbbbb")], memKeyOf(bm), T0);
  ok(liveC.length === 1, "a text row OLDER than the claim does not fulfil it");
  ok(memLiveClaims([row("claim", 15, bm, "claim PC-bbbbb"), row("claim", 15, "other", "claim PC-ddddd")], null, T0).length === 2, "bm=null → claims on any buyer text, each judged on its own");
}

// --- 4. video rows ---
{
  ok(memVideoSent([row("video", 60, "(demo video)", "2/2 demo video(s) sent")]).sent === true, "'2/2 demo video(s) sent' → sent");
  ok(memVideoSent([row("video", 60, "(demo video)", "1/3 demo videos sent — finishing the rest later")]).sent === true, "'1/3 demo videos sent — finishing…' → sent");
  ok(memVideoSent([row("video", 60, "(demo video)", "1 staged demo clip(s) sent by the watcher (…)")]).sent === true, "the watcher's row → sent");
  ok(memVideoSent([row("video", 60, "(demo video)", "0/2 demo videos — native attach failed 3× (no link is ever sent)")]).sent === false, "'0/2 … failed' → NOT sent");
  ok(memVideoSent([row("video-status", 60, "(video check)", "3 sets in a row sent per protocol but no video visible")]).sent === false, "a video-status row never counts");
  ok(memVideoSent([row("text", 60, "x", "2/2 demo video(s) sent")]).sent === false, "the words in a TEXT row never count");
  const mine = memVideoSent([row("video", 60, "(demo video)", "2/2 demo video(s) sent", "Shop PC · v0.21.71 #" + ME)], ME);
  ok(mine.sent && mine.mine === true && mine.by === "Shop PC · v0.21.71", "a row tagged with my #id is mine, and 'by' drops the tag");
  const unl = memVideoSent([row("video", 60, "(demo video)", "2/2 demo video(s) sent", ME + " · v0.21.70")], ME);
  ok(unl.sent && unl.mine === true, "an unlabelled machine's row (label = id) is mine too");
  const theirs = memVideoSent([row("video", 60, "(demo video)", "2/2 demo video(s) sent")], ME);
  ok(theirs.sent && theirs.mine === false, "another computer's row is not mine");
  const fly = memVideoSent([row("claim", 30, "allo", "claim PC-bbbbb")], ME, T0);
  ok(!fly.sent && fly.inflight === true && fly.inflightBy === "Shop PC · v0.21.71", "another computer's fresh claim = that chat is in flight there");
  ok(memVideoSent([row("claim", 30, "allo", "claim " + ME, ME + " · v0.21.71")], ME, T0).inflight === false, "my own claim is not 'in flight elsewhere'");
  ok(memVideoSent([row("claim", 11 * 60, "allo", "claim PC-bbbbb")], ME, T0).inflight === false, "a stale claim (>10 min) is not in flight");
  const flySent = memVideoSent([row("claim", 30, "allo", "claim PC-bbbbb"), row("video", 90, "(demo video)", "2/2 demo video(s) sent")], ME, T0);
  ok(flySent.sent === true, "a sent row still wins over an in-flight claim");
  // ordering: only a foreign claim EARLIER than mine defers me
  const mineFirst = memVideoSent([row("claim", 40, "allo", "claim " + ME, ME + " · v0.21.71"), row("claim", 30, "allo", "claim PC-bbbbb")], ME, T0);
  ok(mineFirst.inflight === false, "my claim came first → I send the clips, theirs defers");
  const theirsFirst = memVideoSent([row("claim", 40, "allo", "claim PC-bbbbb"), row("claim", 30, "allo", "claim " + ME, ME + " · v0.21.71")], ME, T0);
  ok(theirsFirst.inflight === true, "their claim came first → I defer");
  const ended = memVideoSent([row("claim", 90, "allo", "claim PC-bbbbb"), row("video", 30, "(demo video)", "0/2 demo videos — native attach failed 3× (no link is ever sent)", "Shop PC · v0.21.71 #PC-bbbbb")], ME, T0);
  ok(ended.inflight === false && ended.sent === false, "their claim followed by ANY video row of theirs (even a failure) → no longer in flight, nothing sent");
  const endedStatus = memVideoSent([row("claim", 90, "allo", "claim PC-bbbbb"), row("video-status", 30, "(video attach failure)", "0/2 attached — no attach channel staged a clip", "Shop PC · v0.21.71 #PC-bbbbb")], ME, T0);
  ok(endedStatus.inflight === false, "…a video-status row of theirs ends it too");
  const withdrawnV = memVideoSent([row("claim", 90, "allo", "claim PC-bbbbb"), row("claim", 30, "allo", "unclaim PC-bbbbb")], ME, T0);
  ok(withdrawnV.inflight === false, "a withdrawn claim is not in flight");
}

// --- 5. the memory line ---
{
  const settings = { businessAddress: "757 Rue Beaubien E, Montréal", businessHoursText: "9AM–9PM, 7 days" };
  const tx = "Buyer: allo\nYou: Parfait! Oui c'est dispo, on est au 757 Beaubien, ouvert jusqu'à 9pm\nBuyer: trade in?\nYou: Yo! Oui on prend ton vieux cell en échange\nYou: [attachment]\nBuyer: ok";
  const line = memoryLine(settings, tx, null, null, "t1");
  ok(line.indexOf("MEMORY OF THIS CHAT") === 0, "line has its header");
  ok(/3rd message/.test(line), "counts our messages: this will be the 3rd");
  ok(/the address/.test(line) && /the hours/.test(line) && /the trade-in line/.test(line), "facts already given: address, hours, trade-in");
  ok(!/the warranty/.test(line) && !/a price/.test(line), "facts NOT given are not listed");
  ok(/"Parfait", "Yo"/.test(line), "openers already used, in order");
  ok(/demo video was already sent/.test(line), "a trailing [attachment] of ours = the video was sent");
  ok(!/—/.test(line) && !/;/.test(line), "no em-dash, no semicolon (the voice rules ban them)");
  const first = memoryLine(settings, "Buyer: allo", null, null, "t1");
  ok(first === "", "first message, no rows → nothing to say");
  const others = memoryLine(settings, "Buyer: allo", null, [
    { kind: "text", thread_id: "t9", bot_text: "Salut! oui dispo" },
    { kind: "text", thread_id: "t1", bot_text: "Allô! (same chat, excluded)" },
    { kind: "text", thread_id: "t8", bot_text: "Yo yo" },
    { kind: "followup", thread_id: "t7", bot_text: "Hey (not a text row)" },
  ], "t1");
  ok(/other buyers, vary from these too: "Salut", "Yo"/.test(others), "openers used with OTHER buyers (this chat's own rows and follow-ups excluded)");
  const beyond = memoryLine(settings, "Buyer: ok", [row("text", 60, "allo", "On a une garantie de 6 mois"), row("text", 30, "ok", "cash ou interac")], null, "t1");
  ok(/3rd message/.test(beyond) && /the warranty/.test(beyond) && /how to pay/.test(beyond), "rows beyond the transcript window count too (warranty, payment)");
  const vid = memoryLine(settings, "Buyer: allo\nYou: salut", [row("video", 60, "(demo video)", "2/2 demo video(s) sent")], null, "t1");
  ok(/demo video was already sent/.test(vid), "a cloud video row = the video was sent");
  // the fact regexes do not fire on look-alikes
  const notHours = memoryLine(settings, "Buyer: allo\nYou: je reviens dans 1h, la batterie tient 2 h de plus", null, null, "t1");
  ok(!/the hours/.test(notHours), "'dans 1h' / '2 h de batterie' are not the hours");
  const hours2 = memoryLine(settings, "Buyer: allo\nYou: on ferme à 21h à soir", null, null, "t1");
  ok(/the hours/.test(hours2), "'on ferme à 21h' is the hours");
  const hours3 = memoryLine(settings, "Buyer: allo\nYou: open till 10 pm today", null, null, "t1");
  ok(/the hours/.test(hours3), "'open till 10 pm' is the hours");
  const notAddr = memoryLine(settings, "Buyer: allo\nYou: on est au coin de Beaubien, proche du métro Beaubien", null, null, "t1");
  ok(!/the address/.test(notAddr) && /the metro/.test(notAddr), "'coin de Beaubien' alone is not the address (the metro is noted)");
  const addr2 = memoryLine(settings, "Buyer: allo\nYou: c'est au 757 Rue Beaubien Est", null, null, "t1");
  ok(/the address/.test(addr2), "'757 Rue Beaubien Est' is the address");
  const noNum = memoryLine({ businessAddress: "Rue Beaubien Est" }, "Buyer: allo\nYou: sur Beaubien Est", null, null, "t1");
  ok(/the address/.test(noNum), "an address configured without a number falls back to the street word");
  ok(memoryLine({}, "Buyer: allo\nYou: salut", null, null, "t1").indexOf("2nd message") > 0, "empty settings never throw");
}

// --- 6. typing pace ---
{
  ok(typingPaceMs("hello there", { typingPaceMaxSec: 0 }) === 0, "0 = off");
  ok(typingPaceMs("hello there", {}) === 0, "missing setting = off (old configs)");
  const s = { typingPaceMaxSec: 20, wpmMin: 60, wpmMax: 60 }; // 5 cps
  ok(typingPaceMs("x".repeat(50), s) === 10000, "50 chars at 60 wpm (5 cps) = 10 s");
  ok(typingPaceMs("x".repeat(500), s) === 20000, "capped at typingPaceMaxSec");
  ok(typingPaceMs("x".repeat(10), s) < typingPaceMs("x".repeat(40), s), "grows with length");
  ok(typingPaceMs("", s) === 0, "empty text = 0");
}

// --- 7. the wiring (source-level) ---
{
  ok(/type: "GET_REPLY_SIMPLE"[^\n]*threadId: id/.test(ct), "content passes threadId to GET_REPLY_SIMPLE");
  ok(/type: "MEMORY_PRESEND"/.test(ct) && /case "MEMORY_PRESEND"/.test(bg), "pre-send memory check wired both ends");
  ok(/type: "MEMORY_VIDEO"/.test(ct) && /case "MEMORY_VIDEO"/.test(bg), "video memory check wired both ends");
  ok(/action: "text", reply: reply\.text/.test(ct), "the text Activity row is written by the content script on delivery");
  const grs = slice(bg, 'case "GET_REPLY_SIMPLE"', 'case "MEMORY_PRESEND"');
  ok(!/appendLog\(\{[^}]*action: "text"/.test(grs), "…and no longer by the background at generation time");
  ok(/if \(claimed\) await memClaim\(msg\.threadId/.test(grs) && grs.indexOf("await memClaim(") < grs.indexOf("await callClaude("), "the claim is AWAITED before the model is asked");
  ok(/const claimed = memOn && \(replay \|\| !claudeFailedAt\)/.test(grs), "…never from a machine whose last Anthropic call failed (a replay may claim)");
  ok(/claudeFailedAt = Date\.now\(\);\s*\n\s*if \(claimed\) memUnclaim\(/.test(grs) && /claudeFailedAt = 0;/.test(grs), "a failed call withdraws the claim and marks the machine unhealthy; success clears it");
  const pre = slice(bg, 'case "MEMORY_PRESEND"', 'case "MEMORY_VIDEO"');
  ok(/MEM_RECLAIM_MS\) await memClaim\(/.test(pre), "pre-send renews a missing/old claim before typing");
  const mv = slice(bg, 'case "MEMORY_VIDEO"', 'case "GET_FOLLOWUP"');
  ok(/await memClaimPending\[msg\.threadId\]/.test(mv) && /memThreadRows\(msg\.threadId, true\)/.test(mv) && /memVideoRows\(msg\.threadId\)/.test(mv), "the video decision waits for our own claim, reads fresh, and falls back to the video rows when the window is full");
  { const app = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8"); ok(/const HIDDEN_KINDS = \["claim",/.test(app) && /await messagesOnly\(client/.test(app), "the dashboard hides claim rows"); }
  ok(/via === "cloud"/.test(ct.slice(ct.indexOf("async function armVideoCatchUp"))), "the catch-up arm keeps cloud-memory marks");
  ok(/dmk\.via === "cloud"/.test(ct), "a cloud-memory mark counts as confirmed in the engine");
  ok(/cm\.ok && cm\.inflight && resumeFrom == null && !manual/.test(ct), "the engine yields the video to a computer that claimed the chat first (never on a manual resend or a resume tail)");
  ok((ct.match(/await servedCleanup\(\);/g) || []).length === 4, "every 'served elsewhere' stop clears this machine's leftover tile + retry state (cloud, DOM, skip-after-delay, and the v0.21.72 first-clip credit)");
  ok(/am\[id\] = \{ manualResend: Date\.now\(\) \};/.test(ct) && /attC\.manualResend/.test(ct) && /delete sidebarVideoSeen\[id\];/.test(ct), "the popup's Resend button overrides the memories for 10 min");
  ok(/const hrefAtSend = location\.href;/.test(ct) && /if \(location\.href !== hrefAtSend\) return false;/.test(ct), "typeAndSend never clicks Send in a chat the operator switched to");
  const ship = slice(ct, "const shipReply = async (afterClip) =>", "const composerNow = findComposer()");
  ok(ship.indexOf('setStatus({ lastAction: "aborted — you switched chats during the wait') < ship.indexOf('type: "MEMORY_PRESEND"'), "the pre-send memory check runs AFTER the navigation abort (the transcript is this chat's)");
  ok(/transcript: fullTranscript\(40\)/.test(ship) && /memContext: turn\.memTranscript/.test(ct), "the memory reads 40 bubbles, the model keeps 12");
  ok(/const convoLine = \(m\) =>[^\n]*replace\(\/\\s\*\\n\\s\*\/g, " "\)/.test(ct), "one bubble = one transcript line (newlines flattened)");
  ok(/e\.via !== "cloud"\) vDoneNoSent\+\+/.test(bg), "the diagnostic does not count cloud marks as done-without-send");
}
function memKeyOf(s) { return String(s).toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120); }

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
