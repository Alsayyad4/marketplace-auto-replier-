/* v0.21.72 — THE CLIP LEDGER: every dashboard clip reaches a chat exactly once.
 * Runs the real pure helpers sliced out of content.js (clipIdsOf / clipOwed /
 * clipMark …) and background.js (memVideoSent), then checks the wiring at source
 * level — the engine itself is DOM-bound and cannot run here. Asserts:
 *   1. a clip's identity is its uploaded object name (+ "=name:size" when the
 *      dashboard recorded the size), so the same FILE listed twice or uploaded
 *      again is one clip;
 *   2. what a chat OWES is exactly the configured clips it holds neither as sent
 *      nor as tried — whatever the list's order, and nothing for a chat the
 *      ledger has never seen (served before v0.21.72 → left alone);
 *   3. marking: sent wins over tried, tried never overrides sent, clear removes;
 *   4. the engine's wiring: the loop steps over held clips BEFORE it looks at the
 *      slot, the top-up needs the buyer + a known chat + a never-attempted clip,
 *      the "video in chat" stop credits only the clip this machine handed over
 *      and only with an empty tray, a stuck last clip gets an adopt visit, the
 *      zero-evidence retry leaves the ledger, the session latches are dropped
 *      when the clip list changes, clips are pre-downloaded, the dashboard list
 *      saves itself;
 *   5. a pre-.71 row of THIS machine (typed label, no #PC- tag) counts as its own.
 * Run:  node store/smoke-clips.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const ct = fs.readFileSync(path.join(root, "content.js"), "utf8");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
const opt = fs.readFileSync(path.join(root, "options.js"), "utf8");
const optHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");
function slice(src, startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) { console.error("not found: " + startMarker); process.exit(1); }
  const e = src.indexOf(endMarker, s + startMarker.length);
  if (e < 0) { console.error("end not found after: " + startMarker); process.exit(1); }
  return src.slice(s, e);
}
const helpers = slice(ct, "  const CLIP_LEDGER_MAX = 1500;", "  async function clipLedgerGet(");
const { clipIdsOf, clipLabelOf, clipOwed, clipMark, clipHeld, clipSent, clipLedgerNorm, clipSentCount, clipLedgerTrusted } =
  new Function(helpers + "\nreturn { clipIdsOf, clipLabelOf, clipOwed, clipMark, clipHeld, clipSent, clipLedgerNorm, clipSentCount, clipLedgerTrusted };")();
const memBlock = slice(bg, "const MEM_THREAD_LIMIT = ", "\nfunction memNote(");
const memFns = slice(bg, "function memClaimOf(", "\n/* What the model is told about THIS chat");
const { memVideoSent } = new Function(memBlock + "\n" + memFns + "\nreturn { memVideoSent };")();

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const B = "https://x.supabase.co/storage/v1/object/public/subsell-videos/uid/";
const A = { name: "Video_iPhone.mp4", url: B + "1780943854937-Video_iPhone.mp4" };
const C2 = { name: "IMG_4008 (1).mp4", url: B + "1790775383768-IMG_4008__1_.mp4", size: 15756526 };
const C3 = { name: "WhatsApp Video.mp4", url: B + "1783399350640-WhatsApp_Video.mp4" };
const led = () => clipLedgerNorm(null);

// --- 1. identities ---
{
  const a = clipIdsOf(A);
  ok(a.length === 1 && a[0] === "1780943854937-Video_iPhone.mp4", "a clip's identity is its uploaded object name");
  const c = clipIdsOf(C2);
  ok(c.length === 2 && c[0] === "1790775383768-IMG_4008__1_.mp4" && c[1] === "=IMG_4008 (1).mp4:15756526", "…plus =name:size when the dashboard recorded the size");
  ok(clipIdsOf({ name: "a b.mp4", url: B + "17-a%20b.mp4?token=1#x" })[0] === "17-a b.mp4", "query/hash dropped, percent-encoding decoded");
  ok(clipIdsOf({ name: "bad.mp4", url: B + "17-%E0%A4%A.mp4" })[0] === "17-%E0%A4%A.mp4", "a malformed escape keeps the raw segment (never throws)");
  ok(clipIdsOf({ name: "local.mp4", dataUrl: "data:video/mp4;base64,AAAA" })[0] === "local:local.mp4:26", "a per-machine local clip gets a local: identity");
  ok(clipIdsOf(null).length === 0 && clipIdsOf({}).length === 1, "null → no identity; an empty entry still gets one (never crashes the loop)");
  ok(clipLabelOf(C2) === "IMG_4008 (1).mp4" && clipLabelOf({ url: B + "1783399350640-WhatsApp_Video.mp4" }) === "WhatsApp_Video.mp4", "the Activity label is the uploaded name (or the object name without its timestamp)");
}

// --- 2. what a chat owes ---
{
  const list = [A, C2].map(clipIdsOf);
  const fresh = clipOwed(led(), list);
  ok(fresh.owed.join() === "0,1" && fresh.known === 0 && fresh.sentN === 0, "a chat the ledger has never seen: everything owed, known = 0 (pre-.72 chats are left alone by the top-up)");
  const L1 = led(); clipMark(L1, clipIdsOf(A), "s", 1);
  const o1 = clipOwed(L1, list);
  ok(o1.owed.join() === "1" && o1.sentN === 1 && o1.known === 1, "has clip A → owes exactly clip B");
  const L2 = led(); clipMark(L2, clipIdsOf(A), "s", 1); clipMark(L2, clipIdsOf(C2), "t", 2);
  const o2 = clipOwed(L2, list);
  ok(o2.owed.length === 0 && o2.sentN === 1 && o2.triedN === 1, "a clip handed over without confirmation is NOT owed (never re-dispatched)");
  const o3 = clipOwed(L1, [C2, A].map(clipIdsOf));
  ok(o3.owed.join() === "0", "the list re-ordered [B, A]: the chat still owes only B (now index 0)");
  const o4 = clipOwed(L2, [A, C2, C3].map(clipIdsOf));
  ok(o4.owed.join() === "2", "a third clip added to the dashboard: the chat owes only the new one");
  const o5 = clipOwed(L1, [A, A, C2].map(clipIdsOf));
  ok(o5.owed.join() === "2" && o5.sentN === 1, "the same clip listed twice is one clip");
  // the same FILE uploaded again later (new object name, same name + size)
  const L6 = led(); clipMark(L6, clipIdsOf(C2), "s", 1);
  const reUp = { name: "IMG_4008 (1).mp4", url: B + "1799999999999-IMG_4008__1_.mp4", size: 15756526 };
  ok(clipOwed(L6, [reUp].map(clipIdsOf)).owed.length === 0, "the same file re-uploaded (same name + size) is still held — not sent again");
  const otherSize = { name: "IMG_4008 (1).mp4", url: B + "1799999999999-IMG_4008__1_.mp4", size: 999 };
  ok(clipOwed(L6, [otherSize].map(clipIdsOf)).owed.length === 1, "…a different file under the same name (another size) is a new clip");
  const twins = [{ name: "v.mp4", url: B + "1-v.mp4", size: 5 }, { name: "v.mp4", url: B + "2-v.mp4", size: 5 }].map(clipIdsOf);
  ok(clipOwed(led(), twins).owed.join() === "0", "two uploads of one file in the list count once (the June double upload)");
  ok(clipOwed(led(), []).owed.length === 0 && clipOwed(null, list).known === 0 && clipOwed({ s: 5, t: "x" }, list).owed.length === 2, "empty list / null / garbage ledger never throw");
}

// --- 3. marking ---
{
  const L = led();
  clipMark(L, ["k"], "t", 5);
  ok(L.t.k === 5 && clipHeld(L, ["k"]) && !clipSent(L, ["k"]), "tried: held, not sent");
  clipMark(L, ["k"], "s", 6);
  ok(L.s.k === 6 && L.t.k === undefined && clipSent(L, ["k"]), "sent replaces tried");
  clipMark(L, ["k"], "t", 7);
  ok(L.s.k === 6 && L.t.k === undefined, "tried never overrides sent");
  clipMark(L, ["k"], "clear");
  ok(!clipHeld(L, ["k"]), "clear removes both (the zero-evidence retry re-dispatches as before)");
  ok(!clipHeld(L, []) && !clipHeld(null, ["k"]) && !clipSent(L, null), "empty ids / null ledger → not held");
  // the ledger is only trusted when it accounts for every clip the chat's mark says was sent
  const T = led(); clipMark(T, clipIdsOf(C2), "s", 1); // one clip, two identities (name + =name:size)
  ok(clipSentCount(T) === 1, "a clip's =name:size alias is not counted as a second clip");
  ok(clipLedgerTrusted(T, { sent: 1 }) && clipLedgerTrusted(T, { via: "dom" }) && clipLedgerTrusted(T, null), "ledger 1 clip vs mark sent:1 / no count → trusted");
  ok(!clipLedgerTrusted(T, { sent: 2 }), "mark says 2 sent, ledger knows 1 → the chat was partly served before v0.21.72: NOT trusted (its first clip would be sent again)");
  ok(!clipLedgerTrusted(led(), { sent: 1 }) && clipSentCount(null) === 0, "an empty ledger never vouches for a served chat");
}

// --- 4. the engine's wiring (source level) ---
{
  const eng = slice(ct, "async function maybeSendVideo(", "  // Smart follow-up on a quiet chat");
  const loop = slice(eng, "for (let i = bulkDone ? runEnd : startAt; i < files.length; i++) {", "// THE ONE SEND:");
  ok(loop.indexOf("if (heldAt(i)) continue;") > 0 && loop.indexOf("if (heldAt(i)) continue;") < loop.indexOf("if (!files[i]) {"), "the loop steps over a held clip BEFORE it looks at the slot (a held clip that cannot load never stops the set)");
  ok(/okCount\+\+;\s*\n\s*\/\/[^\n]*\n\s*clipMark\(led, idsI, "s", Date\.now\(\)\);\s*\n\s*await clipLedgerPut\(id, \(e\) => clipMark\(e, idsI, "s", Date\.now\(\)\)\);/.test(loop), "a counted clip enters the ledger as sent at once (awaited)");
  ok(/okCount--;[\s\S]{0,200}clipMark\(led, idsI, "clear"\); clipMark\(led, idsI, "t", Date\.now\(\)\);/.test(loop), "the pile case moves it to tried (handed over, never again)");
  ok(/dirtyStop = true;\s*\n\s*failedAt = i;\s*\n\s*\/\/[^\n]*\n\s*clipMark\(led, idsI, "t", Date\.now\(\)\);/.test(loop), "a dirty / unverified clip is recorded as tried");
  ok(/fileIds\.push\(clipIdsOf\(v\)\); \/\/ exactly one slot is pushed per iteration below\s*\n\s*fileNames\.push\(clipLabelOf\(v\)\);\s*\n\s*if \(strikeN\(urlFails\[v\.url\]\) >= 3\)/.test(eng), "identities and names are pushed once per dashboard clip, struck-out or not (aligned with files)");
  ok(/while \(nextDue < files\.length && \(\(files\[nextDue\] && files\[nextDue\]\.excluded\) \|\| heldAt\(nextDue\)\)\) nextDue\+\+;/.test(eng), "the next due clip steps over held clips too");
  const gate = slice(eng, "// (v0.21.72) TOP-UP.", "// IN-FLIGHT guard");
  ok(/if \(completeSet && buyerVisit && resumeFrom == null && done\[id\] && done\[id\]\.done\) \{/.test(gate), "top-up: only when the BUYER just wrote, only on a served chat, only with the switch on");
  ok(/if \(confirmedT && !dmkT\.gaveUp && owT\.known > 0 && owT\.owed\.length > 0 && clipLedgerTrusted\(led, dmkT\)\) \{/.test(gate), "…only a confirmed mark, never a given-up chat, only a chat the ledger knows AND fully accounts for, only when something is owed");
  ok(/delete copyT\.via;/.test(gate) && /keyFlow = true;/.test(gate), "…runs as a ledger-started resume (no stale via on the copy)");
  const dom = slice(eng, "if (resumeFrom == null && chatServedVideo(id, sidebarKey)) {", "// A leftover OLD boolean `true` mark");
  ok(/const blindIdx = attD && attD\.blindTries && attD\.blindKey \? cfgIds\.findIndex/.test(dom), "the 'video in chat' stop credits ONLY the clip this machine handed over blind (blindKey)");
  ok(/const trayClean = stillOnThread\(id\) && trayRemoveBtns\(\)\.length === 0 && !uploadingInBand\(\);/.test(dom) && /if \(trayClean && owD\.owed\.length > 0\) \{/.test(dom), "…and keeps the rest deliverable only with a verifiably empty tray");
  ok(/resumeFrom: owD\.owed\[0\], resumeTotal: cfgIds\.length, sent: owD\.sentN, recon: 1, noAdopt: 1 \}/.test(dom), "…as a resume marker that never adopts a leftover tile");
  ok(dom.indexOf('done[id] = { done: true, at: now, via: "dom" };') > dom.indexOf("if (trayClean && owD.owed.length > 0) {"), "…otherwise the old terminal mark stands");
  ok(/const freshTray = startAt === 0 \|\| !!\(done\[id\] && done\[id\]\.noAdopt\);/.test(eng) && /if \(startAt > 0 && !freshTray && trayRemoveBtns\(\)\.length > 1\) \{/.test(eng), "a noAdopt resume sweeps the tray instead of adopting what is in it");
  ok(/if \(keyFlow && \(trayRemoveBtns\(\)\.length > 0 \|\| composerText\(findComposer\(\)\)\)\) \{/.test(eng) && eng.indexOf("if (keyFlow && (trayRemoveBtns().length > 0 || composerText(findComposer()))) {") < eng.indexOf("const freshTray = startAt === 0"), "a top-up never touches a composer it did not fill: something staged or typed there postpones it (before any sweep)");
  ok(/async function clipLedgerGet\(id\) \{/.test(ct) && /let led = await clipLedgerGet\(id\);/.test(eng), "the ledger is read and written under the chat's real id only");
  ok(/const sentBase = keyFlow \? clipOwed\(led, fileIds\)\.sentN/.test(eng), "a ledger-started visit counts from the ledger, not from a prefix index");
  ok(/if \(okCount === 0 && startAt === 0 && !dirtyStop && !keyFlow\) \{/.test(eng) && /startAt === 0 && !keyFlow && okCount \+ adoptedN === 0/.test(eng), "a top-up never enters the fresh-chat zero-evidence retry");
  const zee = slice(eng, "const zeroEvidenceExit = async (why, total, ids) => {", "// (v0.21.72) The dashboard's clip list changed");
  ok(/ids && ids\.length \? \{ blindKey: ids\[0\] \} : \{\}/.test(zee) && /clipMark\(led, ids, "clear"\); await clipLedgerPut\(id, \(e\) => clipMark\(e, ids, "clear"\)\);/.test(zee), "the zero-evidence retry keeps the clip's key on the attempt and takes it OUT of the ledger (re-dispatched as before)");
  ok(/for \(const ci of cfgIds\) if \(!clipSent\(e, ci\)\) clipMark\(e, ci, "t", Date\.now\(\)\);/.test(zee), "giving up marks every clip the chat lacks as tried (no top-up loop on a chat that cannot take clips)");
  ok((eng.match(/await zeroEvidenceExit\("(attach|unconfirmed)", files\.length, /g) || []).length === 3 && /await zeroEvidenceExit\("unconfirmed", files\.length\);/.test(eng), "three exits name the clip they handed over; the adopt-visit exit names none");
  ok(/const stuckTail = lastSres === "stuck" && okCount > 0 && stillOnThread\(id\) && trayRemoveBtns\(\)\.length > 0;/.test(eng) && /resumeFrom: files\.length, resumeTotal: files\.length, unverifiedTail: 1, stuck: 1 \}/.test(eng), "a last clip still staged gets ONE adopt visit instead of a 'sent' stamp");
  ok(/while \(Date\.now\(\) - tU < 150000 && uploadingInBand\(\)\) \{ if \(!stillOnThread\(id\)\) break;/.test(eng), "the adopt send waits an unfinished upload out (never presses mid-upload)");
  ok(/if \(okCount \+ adoptedN > 0\) ask\(\{ type: "LOG_EVENT"[^\n]*" demo video\(s\) sent" \+ clipNamesSent\(\) \} \}\);/.test(eng), "the Activity row names the clips and is written only when this visit sent something");
  ok(/if \(completeSet && clipOwed\(led, fileIds\)\.owed\.length > 0\) videoLocked\.delete\(id\);/.test(eng) && /if \(confirmedMark\) \{ if \(!owesMore\) videoLocked\.add\(id\); clearPend\(\); \}/.test(eng), "a chat that still owes a clip is not latched for the session");
  ok(/if \(sigNow !== videoLockedSig\) \{ videoLockedSig = sigNow; videoLocked\.clear\(\); \}/.test(eng) && eng.indexOf("videoLocked.clear();") < eng.indexOf("if (id && videoLocked.has(id)) {"), "a changed clip list drops the session latches BEFORE the synchronous guard");
  const chg = slice(eng, "// (v0.21.72) …unless the LEDGER knows this chat", "// RE-VERIFY the claim right before locking");
  ok(/const ledOk = owS\.known > 0 && clipLedgerTrusted\(led, done\[id\]\);/.test(chg) && /if \(ledOk && owS\.owed\.length > 0\) \{/.test(chg) && /\} else if \(ledOk\) \{/.test(chg) && /via: "taildrop"/.test(chg), "a changed list resumes by identity only when the ledger is trusted, closes the chat when nothing is owed, and drops a pre-.72 (or mixed) tail as before");
  ok(/if \(resumeFrom == null && files\.length > 0 && files\.every\(\(f, k\) => heldAt\(k\)\)\) \{/.test(eng), "a fresh visit to a chat that already holds every clip restores a confirmed mark instead of looping on \"can't download\"");
  ok(/dmS\[id\]\.stuck = 1;/.test(eng) && /if \(lastSres === "stuck" \|\| \(adoptedN > 0 && stillOnThread\(id\) && trayRemoveBtns\(\)\.length > 0\)\) dmS\[id\]\.stuck = 1;/.test(eng), "an adopt visit whose send left the tile in place keeps the watcher armed (stuck)");
  // the watcher and the popup's manual lever
  const watcher = slice(ct, "async function sweepStagedClip(trigger) {", "document.addEventListener(\"visibilitychange\"");
  ok(/mk && recent\(mk\.at\) && !mk\.noAdopt && \(mk\.via === "lock"/.test(watcher), "the watcher never treats a tile in a 'first clip confirmed, rest follows' chat as ours (it is a late copy)");
  ok(/if \(at && at\.blindKey && lastSettings && lastSettings\.videoCompleteSet !== false\) \{/.test(watcher) && /resumeFrom: owW\.owed\[0\], resumeTotal: cfgW\.length, sent: owW\.sentN, recon: 1, noAdopt: 1 \};\s*\n\s*restQueued = true;/.test(watcher), "the watcher sending a retry-state chat's first clip no longer closes the set: the rest is queued");
  ok(/if \(restQueued\) \{[\s\S]{0,400}if \(amR\[id\]\) \{ delete amR\[id\];[\s\S]{0,300}videoLocked\.delete\(id\);\s*\n\s*\} else if \(!partial\) \{/.test(watcher), "…the retry state is dropped (no watcher re-arm) and the chat stays on the pending queue");
  ok(/for \(const k of Object\.keys\(eW\.t\)\) \{ eW\.s\[k\] = now; delete eW\.t\[k\]; \}/.test(watcher), "a clip the watcher sends moves from tried to sent in the ledger");
  const clr = slice(ct, 'msg.type === "CLEAR_VIDEO_MARK_OPEN_CHAT"', 'msg.type === "SEND_VIDEOS_OPEN_CHAT"');
  ok(/const vc = \(await getLocal\(\["videoClips"\]\)\)\.videoClips \|\| \{\};/.test(clr) && /if \(k && vc\[k\]\) \{ delete vc\[k\]; chg = true; \}/.test(clr), "the popup's 'Resend video' also clears that chat's ledger (else every clip would be stepped over and nothing sent)");
  const scanFn = slice(ct, "async function scan() {", "async function armVideoCatchUp");
  ok(/lastSettings = settings;[\s\S]{0,500}if \(sigS !== videoLockedSig\) \{ videoLockedSig = sigS; videoLocked\.clear\(\); \}/.test(scanFn), "the scan loop drops the session latches on a clip-list change before any chat is picked");
  // the same-clip skip must not swallow the adoption / resume law: no place re-dispatches a tried clip
  ok(!/clipMark\([^)]*"clear"\)/.test(loop.replace(/okCount--;[\s\S]{0,400}/, "")), "inside the loop a clip leaves the ledger only in the pile case (and re-enters as tried)");
}

// --- 5. background + dashboard wiring ---
{
  ok(/videoCompleteSet: true,/.test(bg) && /videoCompleteSet: true,/.test(opt) && /videoCompleteSet: true,/.test(app), "videoCompleteSet defaults ON in all three DEFAULTS");
  ok(/\["videoCompleteSet", "checked"\]/.test(opt) && /\["videoCompleteSet", "checked"\]/.test(app) && /id="videoCompleteSet"/.test(html) && /id="videoCompleteSet"/.test(optHtml), "…and is bound + present in both forms");
  ok(/async function prewarmDemoClips\(settings\)/.test(bg) && /if \(!settings\.enabled\) return;\s*\n\s*prewarmDemoClips\(settings\)\.catch\(/.test(bg), "every machine pre-downloads the dashboard's clips from the heartbeat (never awaited, never throws into it)");
  ok(/chrome\.storage\.local\.get\(\["clipPrewarm"\]/.test(bg) && /now - e\.diskAt > 10 \* 60 \* 1000/.test(bg) && /now - e\.b64At > 24 \* 3600 \* 1000/.test(bg) && /if \(prewarmBusy\) return;/.test(bg), "…paced by PERSISTED stamps (the worker restarts every 30 s) and single-flight");
  ok(/await saveVideoList\("Uploaded", url\);/.test(app) && /await saveVideoList\("Removed"\);/.test(app) && !/now click Save to cloud/.test(app), "the dashboard's video list saves itself on upload and on remove");
  ok(/if \(autoTimer\) \{ clearTimeout\(autoTimer\); autoTimer = null; \}/.test(app) && /upload the video again/.test(app), "…never racing a pending auto-save, and honest when another device's version was loaded instead");
  ok(/settings\.demoVideoUrls\.push\(\{ name: f\.name, url, size: f\.size \|\| 0 \}\);/.test(app), "an upload records the file's size (the clip's second identity)");
  ok(/const dupI = \(settings\.demoVideoUrls \|\| \[\]\)\.findIndex\(\(o\) => sameClip\(o, \{ name: f\.name, size: f\.size \}\)\);/.test(app), "the same file is not added to the list twice");
  const row = (machine, txt) => ({ kind: "video", created_at: new Date().toISOString(), machine, bot_text: txt, buyer_text: "(demo video)" });
  const sent = "1/2 demo videos sent — finishing the rest after a waiting buyer: Video_iPhone.mp4";
  ok(memVideoSent([row("Shop PC · v0.21.70", sent)], "PC-aaaaa", Date.now(), "Shop PC").mine === true, "a pre-.71 row of THIS machine (typed label, no #PC- tag) is its own — its parked tail is not cancelled");
  ok(memVideoSent([row("Other PC · v0.21.70", sent)], "PC-aaaaa", Date.now(), "Shop PC").mine === false, "…another label is not");
  ok(memVideoSent([row("Shop PC · v0.21.72 #PC-bbbbb", sent)], "PC-aaaaa", Date.now(), "Shop PC").mine === false, "…a TAGGED row from another computer with the same label is not");
  ok(memVideoSent([row("Shop PC · v0.21.72 #PC-aaaaa", sent)], "PC-aaaaa", Date.now(), "Shop PC").mine === true && memVideoSent([row("PC-aaaaa · v0.21.72", sent)], "PC-aaaaa", Date.now(), "PC-aaaaa").mine === true, "tagged / unlabelled own rows are mine as before");
  ok(memVideoSent([row("Shop PC · v0.21.72 #PC-bbbbb", "2/2 demo video(s) sent: Video_iPhone.mp4 + IMG_4008 (1).mp4")], "PC-aaaaa", Date.now(), "Shop PC").sent === true, "a row that names its clips still reads as sent");
}

console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
process.exit(failed ? 1 : 0);
