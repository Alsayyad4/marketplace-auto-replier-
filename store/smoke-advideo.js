/* v0.21.96 — A VIDEO PER AD: a chat whose ad fits a set gets that set instead of the general list.
 * Runs the real pure block sliced out of background.js (adVideoPick / chatClipChoice /
 * adClipNote, with the real prompt builder and the real callClaude on a fake fetch), the real
 * helpers sliced out of content.js (adSetsOn / clipsOfSet / clipListSig) and the dashboard's
 * adsSeenFrom, then checks the wiring at source level (the engine itself is DOM-bound). Asserts:
 *   1. which set an ad gets: whole words, accents and case aside; a comma = or; the longest
 *      alternative wins; on a tie a set written for this computer beats an every-computer set;
 *      a set written for other computers never applies; a set with no words or no clip is ignored;
 *   2. ONE LIST PER CHAT: a remembered set stands whatever the title says now; a served chat with
 *      no remembered set stays on the general list; a deleted set = the chat keeps what it has
 *      (served) or is chosen again (never served); only a fresh choice of a set is stored;
 *   3. WHICH, never WHETHER: in maybeSendVideo the question to the worker comes after the
 *      videoWhen gate ("never" returns first, "asked" waits for the buyer) and before the clip
 *      list is frozen for the visit;
 *   4. AN ACCOUNT THAT NEVER MADE A SET IS ON THE .95 PATH: content.js asks nothing (no usable
 *      set, nothing remembered for the chat), the worker writes nothing, the list signature and
 *      the general list read as before, the prompt is byte-identical, the user turn has no note;
 *   5. the model: with a set and no general video the [CLIP] line is offered and the per-chat
 *      note says when THIS ad has no video; a set written for another computer is not promised;
 *      with "never" nothing is said;
 *   6. the three DEFAULTS carry adVideoSets: [], the merge lists carry the key, the dashboard
 *      exports the bots' own rule and has the section, Settings shows the sets read-only;
 *   7. the dashboard's "ads the bots answered": titles through listingFromTitle, counted per
 *      computer, each computer under its newest name and version.
 * Run:  node store/smoke-advideo.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const ct = fs.readFileSync(path.join(root, "content.js"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");
const opt = fs.readFileSync(path.join(root, "options.js"), "utf8");
const optHtml = fs.readFileSync(path.join(root, "options.html"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " -> " + b); process.exit(1); }
  return src.slice(s, e);
}

/* ---------------- the real functions ---------------- */
// The worker's teacher slice (the same pieces store/smoke-listing.js runs), on a fake fetch
// that keeps every request: nothing leaves this machine.
const captured = [];
const fakeFetch = async (url, opts) => { captured.push(JSON.parse(opts.body)); return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: "ok" }] }), text: async () => "" }; };
const B = new Function(
  "DEFAULTS", "fetch",
  between(bg, "function ownerWroteOf(", "\nfunction getSettings()") + "\n" +
  between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "\nfunction buildOwnerPrompt(") + "\n" +
  between(bg, "function buildOwnerPrompt(", "\nfunction buildSystemPrompt(") + "\n" +
  "function buildSystemPrompt(s) { return 'SYSTEM-SHEET ' + buildOwnerPrompt(s); }\n" +
  "function trimContext(c) { return c; }\n" +
  "const GUARD_RETRY_NOTE = 'RETRY';\n" +
  between(bg, "function nowLine(", "\nasync function callClaude(") + "\n" +
  between(bg, "async function callClaude(", "\n/* ---------------- smart follow-up") + "\n" +
  "return { adVideoSets, adVideoPick, chatClipChoice, adClipNote, adSetPcs, listingFromTitle, buildOwnerPrompt, callClaude };"
)({ apiKey: "", model: "claude-haiku-4-5", businessInfo: "", instructions: "", closerGoals: "" }, fakeFetch);
// content.js: the clip identity + the three helpers and the list signature
const C = new Function(
  between(ct, "  function clipIdsOf(v) {", "  // What the Activity row calls the clip") + "\n" +
  between(ct, "  function adSetsOn(s) {", "  let videoLockedSig = null;") + "\n" +
  "return { clipIdsOf, adSetsOn, generalClips, clipsOfSet, clipListSig };"
)();

const U = "https://x.supabase.co/storage/v1/object/public/subsell-videos/uid/";
const G1 = { name: "iphones.mp4", url: U + "1780000000001-iphones.mp4", size: 4000000 };
const M1 = { name: "macbook.mp4", url: U + "1780000000002-macbook.mp4", size: 5000000 };
const M2 = { name: "macbook-b.mp4", url: U + "1780000000003-macbook-b.mp4", size: 5100000 };
const P1 = { name: "13promax.mp4", url: U + "1780000000004-13promax.mp4", size: 3000000 };
const S1 = { name: "s24.mp4", url: U + "1780000000005-s24.mp4", size: 3500000 };
const setMac = { id: "mac", ads: "macbook air, MacBook Pro", pcs: [], clips: [M1, M2] };
const set13 = { id: "p13", ads: "13 pro", pcs: [], clips: [G1] };
const set13max = { id: "p13max", ads: "iPhone 13 Pro Max", pcs: [], clips: [P1] };
const setS24here = { id: "s24pc", ads: "s24 ultra", pcs: ["PC-abc12"], clips: [S1] };
const setS24all = { id: "s24all", ads: "S24 Ultra", pcs: [], clips: [G1] };
const cfg = (sets, general) => ({ adVideoSets: sets, demoVideoUrls: general || [] });
const pickId = (s, item, pc) => { const p = B.adVideoPick(s, item, pc); return p ? p.id : ""; };

console.log("— 1. which set an ad gets —");
{
  const s = cfg([setMac, set13, set13max, setS24all, setS24here], [G1]);
  ok(pickId(s, "MacBook Air M2 13 pouces", "") === "mac", "the title holds every word of an alternative: MacBook Air M2 gets the MacBook set");
  ok(pickId(s, "Macbook PRO 14 M3", "") === "mac", "a comma = or, and case does not count: MacBook Pro gets it too");
  ok(pickId(s, "MacBook 12 2017", "") === "", "…but a MacBook that is neither Air nor Pro gets the general list");
  ok(pickId(s, "iPhone 13 Pro Max 256 Go", "") === "p13max", "the longest alternative wins: a 13 Pro Max gets its own set, not the 13 Pro one");
  ok(pickId(s, "iPhone 13 Pro 128", "") === "p13", "…and a plain 13 Pro gets the 13 Pro set");
  ok(pickId(s, "iPhone 130 Promo", "") === "", "whole words only: 130 is not 13, Promo is not Pro");
  ok(pickId(cfg([{ id: "tel", ads: "téléphone", pcs: [], clips: [G1] }]), "Telephone Samsung", "") === "tel", "accents aside");
  ok(pickId(s, "Samsung Galaxy S24 Ultra 256", "PC-abc12") === "s24pc", "on a tie a set written for THIS computer beats the every-computer set");
  ok(pickId(s, "Samsung Galaxy S24 Ultra 256", "PC-zzz99") === "s24all", "…another computer gets the every-computer set");
  ok(pickId(s, "Samsung Galaxy S24 Ultra 256", "") === "s24all", "…and so does a computer with no id");
  ok(pickId(cfg([setS24here]), "S24 Ultra", "PC-zzz99") === "" && pickId(cfg([setS24here]), "S24 Ultra", "pc-ABC12") === "s24pc", "a set written for other computers never applies; the id's case does not count");
  ok(pickId(s, "", "") === "" && pickId(s, null, "") === "" && pickId({}, "MacBook Air", "") === "", "no title or no settings = the general list");
  const dead = cfg([{ id: "a", ads: "", clips: [M1] }, { id: "b", ads: "macbook air", clips: [] }, { id: "", ads: "macbook air", clips: [M1] }, null, { id: "c", ads: " , ; ", clips: [M1] }]);
  ok(B.adVideoSets(dead).length === 0 && pickId(dead, "MacBook Air", "") === "", "a set with no words, no clip or no id is not a set");
  ok(pickId(cfg([set13, { id: "first", ads: "pro 13", pcs: [], clips: [P1] }]), "iPhone 13 Pro", "") === "p13", "an exact tie: the first set of the list");
  ok(pickId(cfg([{ id: "st", ads: "iphone 13 128 go", pcs: [], clips: [G1] }]), "iPhone 13 128GB", "") === "st" && pickId(cfg([{ id: "st", ads: "128gb", pcs: [], clips: [G1] }]), "iPhone 13 128 Go noir", "") === "st", "a storage size is one word however it is written (128 Go = 128GB)");
  ok(pickId(cfg([{ id: "ml", ads: "MacBook Air liquidation 900$", pcs: [], clips: [M1] }]), B.listingFromTitle("Jimmy · MacBook Air M2 liquidation 900$"), "") === "ml", "a phrase is read the way a title is: a price and an advert word copied from the ad do not stop it fitting");
  ok(B.adVideoSets(cfg([{ id: "p", ads: "300$", clips: [G1] }, { id: "q", ads: "liquidation", clips: [G1] }, { id: "r", ads: "$ - !", clips: [G1] }])).length === 0, "…and a phrase made only of a price, an advert word or signs is not a set");
}

console.log("— 2. one list per chat —");
{
  const s = cfg([setMac, set13max], [G1]);
  const ch = (stored, served, item, pc) => B.chatClipChoice(s, stored, served, item, pc || "");
  let r = ch(null, false, "MacBook Air M2", "");
  ok(r.set === "mac" && r.clips.length === 2 && r.clips[0].url === M1.url && r.store === true && !r.gone, "a new chat on a MacBook ad: the MacBook set, remembered");
  r = ch(null, false, "iPhone 12 64", "");
  ok(r.set === "" && r.clips === null && r.store === false, "a new chat on an ad with no set: the general list, nothing to remember");
  r = ch(null, true, "MacBook Air M2", "");
  ok(r.set === "" && r.clips === null && r.store === false, "a chat that already holds a clip and has no remembered set stays on the general list (a set made later never adds a second video)");
  r = ch({ set: "mac" }, true, "iPhone 12 64", "");
  ok(r.set === "mac" && r.clips.length === 2 && r.store === false && r.touch === true, "a remembered set stands whatever the title says now (and is kept young while it is used)");
  r = ch({ set: "mac" }, false, "", "");
  ok(r.set === "mac" && r.clips.length === 2, "…and with no title at all");
  r = ch({ set: "gone1" }, true, "MacBook Air M2", "");
  ok(r.set === "gone1" && r.gone === true && Array.isArray(r.clips) && r.clips.length === 0 && r.store === false, "the chat's set was deleted after it was served: it keeps what it has, nothing more goes out");
  r = ch({ set: "gone1" }, false, "MacBook Air M2", "");
  ok(r.set === "mac" && r.store === true && !r.gone, "the chat's set was deleted before anything was sent: chosen again from the title");
  r = ch({ set: "gone1" }, false, "iPhone 12", "");
  ok(r.set === "" && r.clips === null && !r.gone && r.forget === true, "…or the general list when no set fits, and the stale id is forgotten (it must not come back if the set returns)");
  r = B.chatClipChoice(cfg([], [G1]), { set: "mac" }, true, "MacBook Air M2", "");
  ok(r.gone === true && r.clips.length === 0 && !r.forget, "EVERY set removed: a chat that was served on a set still keeps what it has (never the general video on top)");
  r = B.chatClipChoice(cfg([], [G1]), { set: "mac" }, false, "MacBook Air M2", "");
  ok(r.set === "" && r.clips === null && r.forget === true, "…and a chat that was never served goes back to the general list for good");
  r = B.chatClipChoice(cfg([], [G1]), null, false, "MacBook Air M2", "");
  ok(r.set === "" && !r.store && !r.forget && !r.touch && !r.gone, "no set and nothing remembered: the general list, nothing to write");
  r = ch({ set: "" }, false, "MacBook Air M2", "");
  ok(r.set === "mac", "an empty remembered value is not a choice");
}

console.log("— 3. WHICH, never WHETHER: the gate comes first —");
{
  const eng = between(ct, "  async function maybeSendVideo(", "\n  function sidebarQuietMs(");
  const iNever = eng.indexOf('vstat("videos: off (Send the clip = never)"); return;');
  const iAsked = eng.indexOf('vstat("clip waits until this buyer asks to see it');
  const iAsk = eng.indexOf('type: "CHAT_CLIPS"');
  const iIds = eng.indexOf("const cfgIds = local.concat(central).map(clipIdsOf);");
  ok(iNever > 0 && iAsked > iNever && iAsk > iAsked && iIds > iAsk, "inside maybeSendVideo: never → asked → the question to the worker → the clip list frozen (" + [iNever, iAsked, iAsk, iIds].join(" < ") + ")");
  const guard = eng.slice(iAsked, iAsk);
  ok(/if \(settingsOk && \(adSetsOn\(sCfg\) \|\| rememberedA\)\) \{/.test(guard), "the question is asked only when a usable set exists or this chat was once given one");
  ok(/const rememberedA = safe\(\(\) => \{ const e = cfg\.videoSetOf && cfg\.videoSetOf\[id\];/.test(guard) && /"videoSetOf", \/\/ \(v0\.21\.96\)/.test(eng), "…and that memory comes with the visit's own storage read: no message to the worker when there is none");
  ok(/const nameA = name && String\(name\)\.indexOf\("·"\) > 0 \? name : \(safe\(\(\) => openThreadName\(\), ""\) \|\| name \|\| ""\);/.test(guard), "a caller with no listing in its name (the popup's manual send) gets the sidebar row's label");
  ok(ct.split('type: "CHAT_CLIPS"').length === 2, "content.js asks the worker in exactly one place");
  const blk = eng.slice(iAsk, iIds);
  ok(/if \(pickA\.set\) \{/.test(blk) && /central = \(Array\.isArray\(pickA\.clips\) \? pickA\.clips : \[\]\)\.filter/.test(blk) && /local = \[\];/.test(blk) && /adSetChatA = true;/.test(blk), "a set replaces the visit's list (and the per-computer legacy clips)");
  ok(/if \(pickA\.gone\) \{ clearPend\(\);[^\n]*return; \}/.test(blk), "a deleted set ends the visit without sending");
  ok(/if \(!\(pickA && pickA\.ok\)\) \{[\s\S]{0,600}?videoPending\[qkA\] = Date\.now\(\); persistDedup\(\);[\s\S]{0,250}?return;\n        \}/.test(blk), "no answer from the worker = the chat is queued for a later visit, never a guess at the list");
  ok(/const p = adSetChatA && !HAS_DEBUGGER \? null : await diskPathFor\(\{ url: v\.url, name: v\.name \}\);/.test(eng), "a set's clip gets no on-disk copy where the file API is parked for good (no download shown per ad video)");
  ok(/let servedA = true;/.test(guard + blk) && /servedA = !!\(cfg\.videoSentThreads \|\| \{\}\)\[id\] \|\| !!\(atA && atA\.blindTries\) \|\| Object\.keys\(ledA\.s\)\.length \+ Object\.keys\(ledA\.t\)\.length > 0;/.test(eng), "served = a video mark, a retry in progress or a ledger entry; unreadable = served");
}

console.log("— 4. no set configured = the .95 path —");
{
  const fnAns = between(bg, "function chatClipsAnswer(msg) {", "\nchrome.runtime.onMessage.addListener(");
  ok(/if \(dirty\) \{[\s\S]*chrome\.storage\.local\.set\(\{ videoSetOf: map \}/.test(fnAns) && fnAns.split("chrome.storage.local.set(").length === 2, "the worker writes videoSetOf only when a choice is stored, forgotten or kept young (with no set and nothing remembered: nothing)");
  ok(/const p = chatClipsChain\.then\(run, run\);/.test(fnAns) && /const VIDEO_SET_OF_MAX = 3000;/.test(bg) && /keys\.length > VIDEO_SET_OF_MAX/.test(fnAns), "one question at a time (two tabs cannot lose a choice); 3000 chats at most, the oldest out");
  ok(/case "CHAT_CLIPS": \{[\s\S]{0,220}sendResponse\(await chatClipsAnswer\(msg\)\);/.test(bg), "the message handler answers through it");
  const none = [{}, { demoVideoUrls: [G1] }, { demoVideoUrls: [G1], adVideoSets: [] }, { demoVideoUrls: [G1], adVideoSets: [{ id: "x", ads: "macbook", clips: [] }] }, { demoVideoUrls: [G1], adVideoSets: [{ id: "x", ads: "  ", clips: [M1] }] }, { demoVideoUrls: [G1], adVideoSets: [{ id: "x", ads: "$ !", clips: [M1] }] }];
  ok(none.every((s) => C.adSetsOn(s) === false), "content.js: no set, an empty list, a set without a clip or without words = no question to the worker");
  ok(C.adSetsOn(cfg([setMac])) === true, "…a set with a clip = the question is asked");
  const sigOld = (s) => (s && Array.isArray(s.demoVideoUrls) ? s.demoVideoUrls.filter((v) => v && v.url).map((v) => C.clipIdsOf(v)[0]).join("|") : "");
  ok(none.concat([null, { demoVideoUrls: [G1, M1] }]).every((s) => C.clipListSig(s) === sigOld(s)), "the list signature is what it was (the .72 formula) while no set exists");
  ok(C.clipListSig(cfg([setMac], [G1])) !== C.clipListSig(cfg([], [G1])) && C.clipListSig(cfg([setMac], [G1])) !== C.clipListSig(cfg([Object.assign({}, setMac, { clips: [M1] })], [G1])), "…and it moves when a set is made or its clips change (the session latches re-open)");
  ok(JSON.stringify(C.clipsOfSet({ demoVideoUrls: [G1, { name: "no url" }] }, "")) === JSON.stringify([G1]) && C.clipsOfSet({}, "").length === 0, "the watcher's list with no set = the general list, as before");
  ok(C.clipsOfSet(cfg([setMac], [G1]), "mac").length === 2 && C.clipsOfSet(cfg([setMac], [G1]), "nope").length === 0, "…a chat on a set = that set's clips; a set that is gone = nothing");
  ok(/const setW = \(\(\(await getLocal\(\["videoSetOf"\]\)\)\.videoSetOf \|\| \{\}\)\[id\] \|\| \{\}\)\.set \|\| "";/.test(ct) && /const cfgW = clipsOfSet\(lastSettings, setW\)\.map\(clipIdsOf\);/.test(ct), "the watcher credits a clip against the chat's own list: its remembered set (none of its clips if that set is gone), else the general list");
  const base = { ownerTeachingOnly: true, businessInfo: "Shop.", instructions: "Be brief.", demoVideoUrls: [G1], videoWhen: "asked" };
  const p0 = B.buildOwnerPrompt(base);
  ok(p0 === B.buildOwnerPrompt(Object.assign({}, base, { adVideoSets: [] })) && p0 === B.buildOwnerPrompt(Object.assign({}, base, { adVideoSets: [{ id: "x", ads: "", clips: [M1] }] })), "the prompt is byte-identical with no set (or only unusable ones)");
  ok(p0 === B.buildOwnerPrompt(Object.assign({}, base, { adVideoSets: [setMac] })), "…and with a set beside a general video (the note is per chat, never in the sheet)");
  ok(B.adClipNote(base, "Buyer · MacBook Air M2") === "" && B.adClipNote(Object.assign({}, base, { adVideoSets: [] }), "Buyer · MacBook Air M2") === "", "no set = no note beside the buyer's message");
}

console.log("— 5. what the model is told —");
(async () => {
  const noGen = { ownerTeachingOnly: true, businessInfo: "Shop.", instructions: "Be brief.", demoVideoUrls: [], videoWhen: "asked", apiKey: "k" };
  ok(/never promise one/.test(B.buildOwnerPrompt(noGen)) && !/\[CLIP\] at the very start/.test(B.buildOwnerPrompt(noGen)), "no video anywhere: the model never promises one (as before)");
  const withSet = Object.assign({}, noGen, { adVideoSets: [setMac] });
  ok(/\[CLIP\] at the very start/.test(B.buildOwnerPrompt(withSet)), "a set and no general video: the [CLIP] line is offered");
  ok(/never promise one/.test(B.buildOwnerPrompt(Object.assign({}, withSet, { videoWhen: "never" }))), "…unless Send the clip = never");
  ok(/the one the owner made for this listing/.test(B.adClipNote(withSet, "Buyer · MacBook Air M2 13")), "a chat on the MacBook ad: the note names the owner's video for it");
  ok(/There is no video for this listing: never write \[CLIP\] here/.test(B.adClipNote(withSet, "Buyer · iPhone 12 64 Go")), "a chat on an ad with no video at all: the model is told not to promise one");
  ok(/There is no video for this listing/.test(B.adClipNote(withSet, "Jean")), "…the same for a chat with no listing title");
  ok(B.adClipNote(Object.assign({}, withSet, { demoVideoUrls: [G1] }), "Buyer · iPhone 12 64 Go") === "", "an ad with no set but a general video: nothing to say");
  ok(B.adClipNote(Object.assign({}, withSet, { videoWhen: "never" }), "Buyer · MacBook Air M2") === "", "Send the clip = never: no note");
  const scoped = Object.assign({}, noGen, { adVideoSets: [setS24here] });
  ok(/There is no video/.test(B.adClipNote(scoped, "Buyer · S24 Ultra 256")), "a set written for another computer is not promised here");
  const mine = Object.assign({}, scoped);
  Object.defineProperty(mine, "machineId", { enumerable: false, value: "PC-abc12" });
  ok(/the one the owner made/.test(B.adClipNote(mine, "Buyer · S24 Ultra 256")), "…and is on the computer it was written for (settings.machineId, as getSettings sets it)");
  captured.length = 0;
  await B.callClaude(withSet, "c'est encore dispo?", "Conversation so far:\nBuyer: allo", "", undefined, "Buyer · MacBook Air M2 13");
  await B.callClaude(Object.assign({}, noGen, { demoVideoUrls: [G1] }), "c'est encore dispo?", "Conversation so far:\nBuyer: allo", "", undefined, "Buyer · MacBook Air M2 13");
  const u = captured.map((b) => String(b.messages[0].content));
  ok(u.length === 2 && /the one the owner made for this listing/.test(u[0]) && u[0].indexOf("the one the owner made") < u[0].indexOf("Buyer's latest message:"), "the note rides in the USER turn, before the buyer's message");
  ok(!/owner made for this listing|no video for this listing/.test(u[1]), "…and a chat with no set carries none");
  ok(/SYSTEM-SHEET/.test(String(captured[0].system[0].text)) && !/owner made for this listing/.test(String(captured[0].system[0].text)), "the system sheet never carries it (it stays cached)");

  console.log("— 6. the key is everywhere it must be —");
  ok(/\n  adVideoSets: \[\], \/\/ \(v0\.21\.96\)/.test(bg) && /\n    adVideoSets: \[\], \/\/ \(v0\.21\.96\) MUST match background\.js DEFAULTS/.test(app) && /\n    adVideoSets: \[\],/.test(opt), "the three DEFAULTS carry adVideoSets: []");
  ok(/const CFG_LIST_KEYS = \[[^\]]*"adVideoSets"[^\]]*\];/.test(bg) && /const LIST_KEYS = \[[^\]]*"adVideoSets"[^\]]*\];/.test(app) && /const LIST_KEYS = \[[^\]]*"adVideoSets"[^\]]*\];/.test(opt), "the wipe guard and both merges treat the sets as a list");
  const pure = between(bg, "/* ===== (v0.21.96) A VIDEO PER AD", "// A lesson about another model is never offered");
  ok(!/chrome\./.test(pure) && bg.indexOf("/* ===== (v0.21.96) A VIDEO PER AD") > bg.indexOf("/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER") && bg.indexOf("/* ===== (v0.21.96) A VIDEO PER AD") < bg.indexOf("/* ---------------- video fetch ---------------- */"), "the rule sits inside the Try-it slice and touches no chrome.*");
  ok(/adVideoPick: typeof adVideoPick === .{1,3}function.{1,3} \? adVideoPick : null/.test(app) && /const CORE_VER = "20261112";/.test(app), "the dashboard takes the bots' own rule from that slice, under a new cache-buster");
  ok(/Object\.defineProperty\(merged, "machineId", \{ enumerable: false, value: String\(\(res && res\.machineId\) \|\| ""\) \}\);/.test(bg) && /"cloudConfig", "machineId"\], \(res\) => \{/.test(bg), "getSettings carries this computer's id, never serialized");
  ok(/const adOn = adVideoSets\(settings\)\.length > 0;/.test(bg) && /const warmable = !adOn \|\| slotP\+\+ < 5;/.test(bg), "the pre-download adds the sets' clips only when sets exist");
  ok(/const generalP = new Set\(list\.map\(\(v\) => v\.url\)\);/.test(bg) && /if \(generalP\.has\(v\.url\) && \(!e\.diskAt \|\| now - e\.diskAt > 10 \* 60 \* 1000\)\) \{/.test(bg), "…and only the general list is put on disk ahead of time (a disk copy is a download the computer shows)");
  ok(/const own = setOfD\[k\] && setOfD\[k\]\.set \? \(adChatsD\+\+, setIdsD\[setOfD\[k\]\.set\] \|\| \[\]\) : ids;/.test(bg) && /"cdpStats", "videoDisk", "videoSetOf",/.test(bg), "the diagnostic judges a chat on a set against that set's clips");
  ok(/id="adSets"/.test(html) && /id="addAdSet"/.test(html) && /id="adSetStatus"/.test(html) && /app\.js\?v=20261112/.test(html), "the page has the section");
  ok(app.split("renderAdSets();").length >= 4 && /\n    loadAdsSeen\(\);/.test(app) && /async function saveVideoList\(what, url, statusEl\) \{\n    const status = statusEl \|\| \$\("demoVideoStatus"\);/.test(app), "the dashboard draws the sets, loads the ads answered and saves them like the general list");
  ok(/if \(adCore \|\| !adSetsList\(\)\.length\) return;/.test(app), "the bots' code is fetched for the picker only once a set exists");
  ok(app.indexOf("const one = String(pick.value).replace(/[,;" + String.fromCharCode(92) + "n]+/g, \" \")") > 0, "an ad picked from the list stays ONE alternative: its own commas do not split it");
  ok(/adVideoSets: typeof adVideoSets === .{1,3}function.{1,3} \? adVideoSets : null/.test(app) && /: !usable \? "Not active: these words hold nothing an ad's title is read by/.test(app), "the card says so when the words cannot fit any title (the bots' own reading)");
  ok(/id="adVideoList"/.test(optHtml) && /function renderCentralVideos\(\) \{\n    renderAdVideoSets\(\);/.test(opt), "Settings shows the sets read-only, under the general list");

  console.log("— 7. the ads the bots answered —");
  const D = new Function(
    between(app, "/* ==== LISTING-MIRROR-BEGIN", "/* ==== LISTING-MIRROR-END ==== */") + "\n" +
    between(app, "  const machineKey = (m) =>", "  function savedFingerprint()") + "\n" +
    between(app, "  const verLess = ", "  const newAdSetId") + "\n" +
    between(app, "  function adsSeenFrom(rows) {", "  async function loadAdsSeen() {") + "\n" +
    "return { adsSeenFrom, verLess, listingFromTitle };"
  )();
  const rows = [
    { machine: "Front desk · v0.21.96 #PC-abc12", thread_name: "Jimmy · MacBook Air M2 13 pouces 900$" },
    { machine: "PC-zzz99 · v0.21.95", thread_name: "Amel · iPhone 13 Pro Max 256 Go · 2h" },
    { machine: "Front · v0.21.94 #PC-abc12", thread_name: "Paul · MacBook Air M2 13 pouces" },
    { machine: "PC-zzz99 · v0.21.95", thread_name: "(system)" },
    { machine: null, thread_name: "Lea · iPhone 13 Pro Max 256 Go 650$" },
  ];
  const seen = D.adsSeenFrom(rows);
  ok(seen.ads.length === 2 && seen.ads[0].item === D.listingFromTitle(rows[0].thread_name) && seen.ads[0].n === 2 && seen.ads[0].pcs["pc-abc12"] === 2, "two chats on one ad = one ad, counted on its computer — " + JSON.stringify(seen.ads[0]));
  ok(seen.ads[1].n === 2 && seen.ads[1].pcs["pc-zzz99"] === 1 && Object.keys(seen.ads[1].pcs).length === 1, "prices and the sidebar's time tag do not make a second ad; a row with no computer still counts the ad");
  ok(seen.pcs.length === 2 && seen.pcs[0].key === "pc-abc12" && seen.pcs[0].show === "Front desk" && seen.pcs[0].ver === "0.21.96" && seen.pcs[1].key === "pc-zzz99" && seen.pcs[1].show === "PC-zzz99" && seen.pcs[1].ver === "0.21.95", "each computer once, under its newest name and version — " + JSON.stringify(seen.pcs));
  ok(D.adsSeenFrom([]).ads.length === 0 && D.adsSeenFrom(null).pcs.length === 0, "no rows = empty lists");
  ok(D.verLess("0.21.95", "0.21.96") && !D.verLess("0.21.96", "0.21.96") && !D.verLess("0.22.0", "0.21.96") && D.verLess("0.21.9", "0.21.96"), "a computer is 'behind' below 0.21.96, number by number");
  // the set a seen ad gets, by the bots' rule, with the keys the dashboard stores (lower-case ids)
  ok(pickId(cfg([Object.assign({}, setS24here, { pcs: [seen.pcs[0].key] })]), "S24 Ultra", "PC-abc12") === "s24pc", "a computer ticked on the dashboard (pc-abc12) is the worker's PC-abc12");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nALL GREEN — a video per ad");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
