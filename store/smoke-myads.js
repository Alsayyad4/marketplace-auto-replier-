/* v0.21.97 — MY ADS, MY VIDEOS: on each computer the owner opens the extension, sees the ads of
 * THAT Chrome and gives one its own video. Runs the real pure rules sliced out of background.js
 * (adVideoPick's exact rule, myAdSetsPut / myAdWordsPut / myAdSetsDrop / myAdsRows), the worker's
 * real write (myAdsWrite, on a fake account row and a fake chrome), then checks the wiring at
 * source level. Asserts:
 *   1. EXACT: a choice made for one ad fits that ad (word order, case, accents, "256 Go" = "256GB")
 *      and no ad whose title only holds its words; it never applies on another computer; on a tie
 *      it goes before a words set; a set without the mark reads exactly as in 0.21.96;
 *   2. a choice = one set for this computer alone; changing the video makes a NEW set and removes
 *      the old one, so a chat served on the old one keeps what it has and a chat served on the
 *      general video stays there (ONE LIST PER CHAT); nothing else in the list moves;
 *   3. an ad not in the list: words for this computer; words no title is read by are refused;
 *   4. taking a choice back: only this computer's own; a set of the web app is refused;
 *   5. what the page shows: this computer's chats only, grouped by ad, the video each ad would
 *      really get (the bots' own rule), the open chat first, nothing that is not a Marketplace chat;
 *   6. THE WRITE: the account's row is read, ONLY adVideoSets changes, the write carries the row's
 *      stamp; a save that landed in between = read again, the other save kept; no login, a video
 *      from elsewhere, an emptied row = nothing written; one write at a time;
 *   7. only the extension's own pages may ask for the upload ticket or a write; the inbox is read,
 *      never touched; the popup opens the page on a click; the zips carry the page; no new permission.
 * Run:  node store/smoke-myads.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");
const bg = read("background.js"), ct = read("content.js"), page = read("myads.js"), pageHtml = read("myads.html");
const popupHtml = read("popup.html"), popupJs = read("popup.js"), optHtml = read("options.html"), optJs = read("options.js");
const app = read("docs/app.js"), ref = read("SETTINGS-REFERENCE.md");
const manifest = JSON.parse(read("manifest.json"));

let failed = 0, finished = false;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
process.on("exit", (code) => { if (!finished && code === 0) { console.log("\nTHE RUN NEVER FINISHED (a promise did not settle)"); process.exitCode = 1; } });
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " -> " + b); process.exit(1); }
  return src.slice(s, e);
}

/* ---------------- the real functions ---------------- */
const B = new Function(
  "DEFAULTS",
  between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "\nfunction buildOwnerPrompt(") + "\n" +
  "return { adVideoSets, adVideoPick, chatClipChoice, adClipNote, listingFromTitle, adKey, adOneAlt, adSetMine, adSetExactKey, myAdSetsPut, myAdWordsPut, myAdSetsDrop, myAdsRows };"
)({ apiKey: "", model: "claude-haiku-4-5", businessInfo: "", instructions: "", closerGoals: "" });

const U = "https://x.supabase.co/storage/v1/object/public/subsell-videos/uid/";
const G1 = { name: "general.mp4", url: U + "1-general.mp4", size: 4000000 };
const V1 = { name: "13pro.mp4", url: U + "2-13pro.mp4", size: 3000000 };
const V2 = { name: "13pro-b.mp4", url: U + "3-13pro-b.mp4", size: 3100000 };
const V3 = { name: "other.mp4", url: U + "4-other.mp4", size: 3200000 };
const M1 = { name: "macbook.mp4", url: U + "5-macbook.mp4", size: 5000000 };
const ME = "PC-abc12", OTHER = "PC-zzz99";
const cfg = (sets, general, more) => Object.assign({ adVideoSets: sets, demoVideoUrls: general || [] }, more || {});
const pickId = (s, item, pc) => { const p = B.adVideoPick(s, item, pc); return p ? p.id : ""; };

console.log("— 1. EXACT: this ad, and no other —");
{
  const exA = { id: "eA", ads: "iPhone 13 Pro 256 Go", pcs: ["pc-abc12"], clips: [V1], exact: true };
  ok(pickId(cfg([exA]), "iPhone 13 Pro 256 Go", ME) === "eA", "a choice made for an ad fits that ad");
  ok(pickId(cfg([exA]), "256GB iphone 13 PRO", ME) === "eA", "…whatever the word order, the case, or how the storage is written (256 Go = 256GB)");
  ok(pickId(cfg([exA]), B.listingFromTitle("Jimmy · iPhone 13 Pro, 256 Go — 650$ négociable · 2h"), ME) === "eA", "…and as the chat's own label gives it (price, advert word and time tag out)");
  ok(pickId(cfg([exA]), "iPhone 13 Pro Max 256 Go", ME) === "", "an ad whose title only HOLDS its words is another ad: the 13 Pro Max does not get the 13 Pro's video");
  ok(pickId(cfg([exA]), "iPhone 13 Pro", ME) === "", "…nor does a shorter title");
  ok(pickId(cfg([exA]), "iPhone 13 Pro 256 Go", OTHER) === "" && pickId(cfg([exA]), "iPhone 13 Pro 256 Go", "") === "", "it never applies on another computer");
  const wA = { id: "wA", ads: "iPhone 13 Pro 256 Go", pcs: ["pc-abc12"], clips: [V1] };
  ok(pickId(cfg([wA]), "iPhone 13 Pro Max 256 Go", ME) === "wA", "the same set WITHOUT the mark reads as in 0.21.96: every title that holds the words (what the mark prevents)");
  const wSame = { id: "wS", ads: "iphone 13 pro 256gb", pcs: ["pc-abc12"], clips: [V2] };
  ok(pickId(cfg([wSame, exA]), "iPhone 13 Pro 256 Go", ME) === "eA" && pickId(cfg([exA, wSame]), "iPhone 13 Pro 256 Go", ME) === "eA", "on a tie the choice made for the ad goes before a words set, whatever the list order");
  const wAll = { id: "wAll", ads: "iphone 13 pro 256gb", pcs: [], clips: [V3] };
  ok(pickId(cfg([wAll, exA]), "iPhone 13 Pro 256 Go", ME) === "eA" && pickId(cfg([wAll, exA]), "iPhone 13 Pro 256 Go", OTHER) === "wAll", "…and before an every-computer set here, while the other computers keep the every-computer one");
  const exAll = { id: "exAll", ads: "iPhone 13 Pro 256 Go", pcs: [], clips: [V3], exact: true };
  ok(pickId(cfg([exAll, wSame]), "iPhone 13 Pro 256 Go", ME) === "wS", "a set written for this computer still goes before an every-computer one (the 0.21.96 order: this computer first, then exact)");
  const longer = { id: "long", ads: "iphone 13 pro", pcs: [], clips: [V3] };
  ok(pickId(cfg([longer, exA]), "iPhone 13 Pro 256 Go", ME) === "eA", "the longest alternative still wins: the ad's own choice has every word of the title");
  ok(pickId(cfg([Object.assign({}, exA, { exact: "true" })]), "iPhone 13 Pro Max 256 Go", ME) === "eA" && pickId(cfg([Object.assign({}, exA, { exact: 1 })]), "iPhone 13 Pro Max 256 Go", ME) === "eA", "only exact: true is the mark (a stray value reads as a words set)");
  ok(/if \(new Set\(ph\)\.size !== titleX\.size \|\| !ph\.every\(\(w\) => titleX\.has\(w\)\)\) continue;/.test(bg) && /\} else if \(!ph\.every\(\(w\) => title\.has\(w\)\)\) continue;/.test(bg), "the rule sits in adVideoPick beside the words rule, which is left as it was");
  // read by its own words, once: a title the SECOND reading would change still fits its own ad
  for (const head of ["iPhone 13 nég, 128 Go", "iPhone 13 Pro Max 256 Go, neg, comme neuf", "iPhone 12 64Go neg; tres propre", "iPhone 13 Pro,650$", "iPhone 13, taxes payées", "iPhone 13 Pro - Prix, 650"]) {
    const item = B.listingFromTitle("Jimmy · " + head);
    const put = B.myAdSetsPut([], ME, item, V1, "t1");
    if (!(put.ok && pickId(cfg(put.list), item, ME) === "t1")) ok(false, "a choice for “" + head + "” must fit its own ad (item “" + item + "”): " + JSON.stringify(put.error || "not picked"));
  }
  ok(true, "titles with “nég,”, a price glued to a comma, “taxes payées”: the choice fits its own ad (the stored title is read by its words alone, never re-read for prices and advert words)");
  const plus = B.myAdSetsPut([], ME, "Samsung Galaxy S24+ 256GB", V1, "plus").set, plain = B.myAdSetsPut([], ME, "Samsung Galaxy S24 256GB", V2, "plain").set;
  ok(B.adKey("Samsung Galaxy S24+ 256GB") !== B.adKey("Samsung Galaxy S24 256GB") && pickId(cfg([plus, plain]), "Samsung Galaxy S24+ 256GB", ME) === "plus" && pickId(cfg([plus, plain]), "Samsung Galaxy S24 256GB", ME) === "plain" && pickId(cfg([plus]), "Samsung Galaxy S24 256GB", ME) === "" && B.adKey("iPhone 11 Grade A+") !== B.adKey("iPhone 11 Grade A"), "a “+” at the end of a word belongs to it: the S24+ and the S24 are two ads, each with its own video");
  ok(pickId(cfg([{ id: "w", ads: "galaxy s24", pcs: [], clips: [V3] }]), "Samsung Galaxy S24+ 256GB", ME) === "w", "…while a words set reads “S24+” as it always did (the 0.21.96 rule is untouched)");
}

console.log("— 1b. the model's number is not part of the price (the title reader) —");
{
  const L = (h) => B.listingFromTitle("Buyer · " + h);
  const want = { "iPhone 8 150$": "iPhone 8", "iPhone 7 100$": "iPhone 7", "iPhone 13 - 650$": "iPhone 13", "Pixel 7 250$": "Pixel 7", "iPad 9 300$": "iPad 9", "Samsung Galaxy S9 300$": "Samsung Galaxy S9", "MacBook Air M2 900$": "MacBook Air M2", "iPhone XS 64 Go 200$": "iPhone XS 64 Go" };
  const got = Object.keys(want).filter((h) => L(h) !== want[h]).map((h) => h + " → " + L(h));
  ok(got.length === 0, "a price right after a short model number no longer takes the number with it (iPhone 8 150$ = the iPhone 8; MacBook Air M2 900$ = the M2; iPhone 13 - 650$ = the 13)" + (got.length ? " — WRONG: " + got.join(" | ") : ""));
  const same = { "iPhone 13 650$": "iPhone 13", "iPhone 14 Pro 1 000$": "iPhone 14 Pro", "iPhone 13 Pro Max 256 Go 650$": "iPhone 13 Pro Max 256 Go", "AirPods 80$": "AirPods", "iPhone 12 450$ négociable": "iPhone 12", "iPhone 13 Pro 128Go 500 $": "iPhone 13 Pro 128Go", "iPad 99$": "iPad", "iPhone 15 Pro 1,099.00 $": "iPhone 15 Pro", "650$ iPhone 13": "iPhone 13" };
  const moved = Object.keys(same).filter((h) => L(h) !== same[h]).map((h) => h + " → " + L(h));
  ok(moved.length === 0, "what was read right stays right: a real thousands price, a price straight after a brand word, a price before the model" + (moved.length ? " — MOVED: " + moved.join(" | ") : ""));
  ok(!/[\u0001]/.test(Object.keys(want).concat(Object.keys(same)).map(L).join("")), "nothing of the fence is left in what comes out");
  const two = B.myAdsRows(cfg([], [G1]), ME, [{ label: "A · iPhone 8 150$", id: "a", at: 2, inbox: -1 }, { label: "B · iPhone 7 100$", id: "b", at: 1, inbox: -1 }], "", 10);
  ok(two.ads.length === 2 && two.ads[0].item === "iPhone 8" && two.ads[1].item === "iPhone 7", "…so two different ads are two lines on the page, never one “iPhone” line that would give both the same video");
}

console.log("— 2. a choice = one set for this computer; a change = a NEW set —");
{
  const web = { id: "mac", ads: "macbook air, macbook pro", pcs: [], clips: [M1] };
  const theirs = { id: "o1", ads: "iPhone 13 Pro 256 Go", pcs: ["pc-zzz99"], clips: [V3], exact: true };
  const r1 = B.myAdSetsPut([web, theirs], ME, "iPhone 13 Pro, 256 Go", V1, "m1");
  ok(r1.ok && r1.list.length === 3 && r1.set.id === "m1" && r1.set.ads === "iPhone 13 Pro 256 Go" && r1.set.exact === true && JSON.stringify(r1.set.pcs) === '["pc-abc12"]' && r1.set.clips.length === 1 && r1.set.clips[0].url === V1.url && r1.set.clips[0].size === V1.size, "the choice is one set: the title as ONE alternative, this computer alone, the video, the mark — " + JSON.stringify(r1.set));
  ok(r1.list[0] === web && r1.list[1] === theirs, "the web app's set and the other computer's choice for the same ad are untouched");
  ok(pickId(cfg(r1.list), "iPhone 13 Pro 256 Go", ME) === "m1" && pickId(cfg(r1.list), "iPhone 13 Pro 256 Go", OTHER) === "o1", "each computer gets its own choice for the same ad");
  const r2 = B.myAdSetsPut(r1.list, ME, "iphone 13 pro 256GB", V2, "m2");
  ok(r2.ok && r2.list.length === 3 && !r2.list.some((s) => s.id === "m1") && r2.list.some((s) => s.id === "m2" && s.clips[0].url === V2.url) && r2.list.includes(theirs) && r2.list.includes(web), "changing the video removes this computer's old set for that ad and adds a NEW one (new id)");
  const s2 = cfg(r2.list, [G1]);
  const served = B.chatClipChoice(s2, { set: "m1" }, true, "iPhone 13 Pro 256 Go", ME);
  ok(served.gone === true && served.set === "m1" && Array.isArray(served.clips) && served.clips.length === 0 && !served.store, "a chat already served on the old video keeps what it has: nothing more is sent (never a second, different video)");
  const fresh = B.chatClipChoice(s2, { set: "m1" }, false, "iPhone 13 Pro 256 Go", ME);
  ok(fresh.set === "m2" && fresh.store === true && fresh.clips[0].url === V2.url, "a chat that was never served is chosen again and gets the new video");
  const onGeneral = B.chatClipChoice(s2, null, true, "iPhone 13 Pro 256 Go", ME);
  ok(onGeneral.set === "" && onGeneral.clips === null && !onGeneral.store, "a chat that got the general video before the choice stays on the general list");
  const newChat = B.chatClipChoice(s2, null, false, "iPhone 13 Pro 256 Go", ME);
  ok(newChat.set === "m2" && newChat.store === true, "a new chat on that ad gets the choice");
  ok(B.chatClipChoice(s2, null, false, "iPhone 13 Pro Max 256 Go", ME).set === "", "a new chat on ANOTHER ad that holds the same words stays on the general list");
  ok(B.myAdSetsPut([], "", "iPhone 13", V1, "x").ok === false && B.myAdSetsPut([], ME, "!!! — …", V1, "x").ok === false && B.myAdSetsPut([], ME, "iPhone 13", null, "x").ok === false && B.myAdSetsPut([], ME, "iPhone 13", { name: "a" }, "x").ok === false && B.myAdSetsPut([], ME, "iPhone 13", V1, "").ok === false, "no computer id, a title with no word, no video, no id: refused with a reason, nothing written");
  const r3 = B.myAdSetsPut(null, ME, "Samsung Galaxy S24 Ultra", V1, "m3");
  ok(r3.ok && r3.list.length === 1, "a list that is not there yet is started");
  ok(B.adSetExactKey(r1.set) === B.adKey("256gb iphone 13 pro") && B.adSetExactKey(web) === "" && B.adSetMine(r1.set, "pc-abc12") && !B.adSetMine(web, "pc-abc12") && !B.adSetMine({ pcs: ["pc-abc12", "pc-zzz99"] }, "pc-abc12"), "an ad's identity is its title's words; a set for two computers is not this computer's own");
  const before = JSON.stringify([web, theirs]);
  B.myAdSetsPut([web, theirs], ME, "iPhone 13 Pro 256 Go", V1, "m9");
  ok(JSON.stringify([web, theirs]) === before, "the list handed in is never changed in place");
  const againSame = B.myAdSetsPut(r2.list, ME, "iPhone 13 Pro 256 Go", V2, "m7");
  ok(againSame.ok && againSame.list === r2.list && againSame.set.id === "m2", "the same video chosen again changes nothing (the same list back, the same id): chats in the middle of receiving it are not cut off");
  ok(B.myAdSetsPut(r2.list, ME, "iPhone 13 Pro 256 Go", V1, "m8").list !== r2.list, "…a different video does make a new set");
}

console.log("— 3. an ad that is not in the list yet: words, for this computer —");
{
  const r = B.myAdWordsPut([], ME, "  iphone   14 pro ", V1, "w1");
  ok(r.ok && r.set.ads === "iphone 14 pro" && r.set.exact === undefined && JSON.stringify(r.set.pcs) === '["pc-abc12"]', "words make a words set for this computer (no mark): " + JSON.stringify(r.set));
  ok(pickId(cfg(r.list), "iPhone 14 Pro Max 128 Go", ME) === "w1" && pickId(cfg(r.list), "iPhone 14 Pro Max 128 Go", OTHER) === "", "…it fits the titles that hold the words, on this computer only");
  const bad = B.myAdWordsPut([], ME, "liquidation 300$", V1, "w2");
  ok(bad.ok === false && /title/.test(bad.error), "words no title is read by (a price, an advert word) are refused with the reason: " + bad.error);
  const comma = B.myAdWordsPut([], ME, "iPhone 13 Pro, 256GB, unlocked", V1, "w9");
  ok(comma.ok && comma.set.ads === "iPhone 13 Pro 256GB unlocked" && pickId(cfg(comma.list), "Samsung Galaxy S22 256 Go", ME) === "" && pickId(cfg(comma.list), "iPad Air unlocked", ME) === "" && pickId(cfg(comma.list), "iPhone 13 Pro 256GB unlocked noir", ME) === "w9", "a comma typed or pasted with the words never means “or” here: one ad's words stay one group (a Samsung with 256 Go does not get the iPhone's video)");
  const again = B.myAdWordsPut(r.list, ME, "Pro iPhone 14", V2, "w3");
  ok(again.ok && again.list.length === 1 && again.list[0].id === "w3" && again.list[0].clips[0].url === V2.url, "the same words again replace this computer's earlier words set");
  const exact = B.myAdSetsPut(again.list, ME, "iPhone 14 Pro", V3, "m4");
  ok(exact.ok && exact.list.length === 2 && pickId(cfg(exact.list), "iPhone 14 Pro", ME) === "m4" && pickId(cfg(exact.list), "iPhone 14 Pro 128 Go", ME) === "w3", "a choice made later for the ad itself goes first for that ad; the words keep the others");
}

console.log("— 4. taking a choice back —");
{
  const web = { id: "mac", ads: "macbook", pcs: [], clips: [M1] };
  const theirs = { id: "o1", ads: "iPhone 13", pcs: ["pc-zzz99"], clips: [V3], exact: true };
  const mine = { id: "m1", ads: "iPhone 13", pcs: ["pc-abc12"], clips: [V1], exact: true };
  const list = [web, theirs, mine];
  const d = B.myAdSetsDrop(list, ME, "m1");
  ok(d.ok && d.list.length === 2 && d.list[0] === web && d.list[1] === theirs, "this computer's own choice is removed, the rest stays");
  ok(B.myAdSetsDrop(list, ME, "mac").ok === false && B.myAdSetsDrop(list, ME, "o1").ok === false, "a set made on the web app, or another computer's choice, is refused");
  const gone = B.myAdSetsDrop(list, ME, "nope");
  ok(gone.ok && gone.list === list, "a choice that is already gone = nothing to write (the same list back)");
  const twin = [web, mine, { id: "m1", ads: "iPhone 13", pcs: ["pc-abc12"], clips: [V2], exact: true }];
  const dt = B.myAdSetsDrop(twin, ME, "m1");
  ok(dt.ok && dt.list.length === 1 && dt.list[0] === web && B.chatClipChoice(cfg(dt.list, [G1]), { set: "m1" }, true, "iPhone 13", ME).gone === true, "two sets under one id (two saves that once crossed) go together: the second can never take the id over and hand a served chat its video");
  const after = cfg(d.list, [G1]);
  ok(B.chatClipChoice(after, { set: "m1" }, true, "iPhone 13", ME).gone === true && B.chatClipChoice(after, { set: "m1" }, false, "iPhone 13", ME).set === "", "after a removal: a served chat keeps what it has, a new one goes to the general list");
}

console.log("— 5. what the page shows —");
{
  const T = Date.parse("2026-11-13T15:00:00Z");
  const seen = [
    { label: "Jimmy · iPhone 13 Pro 256 Go 650$", id: "t1", at: T - 3600e3, inbox: -1 },
    { label: "Jimmy · iPhone 13 Pro 256 Go 650$", id: "t1", at: T - 1800e3, inbox: -1 },
    { label: "Amel · iPhone 13 Pro, 256 Go", id: "t2", at: T - 60e3, inbox: -1 },
    { label: "Paul · MacBook Air M2 · 2h", id: "t3", at: 0, inbox: 0 },
    { label: "Marie Tremblay", id: "t4", at: T, inbox: 1 },
    { label: "Zed · Galaxy S24 Ultra négociable", id: "t5", at: T - 86400e3, inbox: -1 },
    { label: "", id: "t6", at: T, inbox: 2 },
    null,
  ];
  const own = B.myAdSetsPut([], ME, "iPhone 13 Pro 256 Go", V2, "m2").set;
  const quiet = B.myAdSetsPut([], ME, "Pixel 8 Pro", V3, "m5").set;
  const web = { id: "mac", ads: "macbook", pcs: [], clips: [M1] };
  const elsewhere = { id: "o1", ads: "Galaxy S24 Ultra", pcs: ["pc-zzz99"], clips: [V3], exact: true };
  const wordsSet = B.myAdWordsPut([], ME, "ipad air", V1, "w1").set;
  const s = cfg([web, own, quiet, elsewhere, wordsSet], [G1], { videoWhen: "asked" });
  const v = B.myAdsRows(s, ME, seen, "Someone · MacBook Air M2", T);
  const by = (item) => v.ads.find((a) => a.item === item) || {};
  ok(v.ads.length === 4 && v.ads.map((a) => a.item).join(" | ") === "MacBook Air M2 | iPhone 13 Pro 256 Go | Galaxy S24 Ultra | Pixel 8 Pro", "this computer's chats, grouped by ad, the open chat's ad first, then the newest: " + v.ads.map((a) => a.item).join(" | "));
  ok(by("iPhone 13 Pro 256 Go").chats === 2 && by("iPhone 13 Pro 256 Go").last === T - 60e3, "an ad's chats are counted once each and its last message is the newest (two spellings of one title are one ad)");
  ok(by("iPhone 13 Pro 256 Go").kind === "own" && by("iPhone 13 Pro 256 Go").setId === "m2" && by("iPhone 13 Pro 256 Go").clips[0].name === "13pro-b.mp4", "an ad with its own choice shows it");
  ok(by("MacBook Air M2").kind === "set" && by("MacBook Air M2").words === "macbook" && by("MacBook Air M2").mineOnly === false && by("MacBook Air M2").open === true && by("MacBook Air M2").inbox === true, "an ad that a web-app set takes says so (and it is the chat open now, seen in the inbox)");
  ok(by("Galaxy S24 Ultra").kind === "general" && by("Galaxy S24 Ultra").clips[0].name === "general.mp4", "another computer's choice does not show here: the ad gets the general video");
  ok(by("Pixel 8 Pro").kind === "own" && by("Pixel 8 Pro").quiet === true && by("Pixel 8 Pro").chats === 0, "a choice whose ad has no chat lately is still listed (to change or remove it)");
  ok(!v.ads.some((a) => /Marie/.test(a.item)), "a chat that is not a Marketplace chat is not an ad");
  ok(v.library.map((c) => c.name).join(",") === "13pro-b.mp4,other.mp4,13pro.mp4" && v.words.length === 1 && v.words[0].words === "ipad air" && v.words[0].setId === "w1", "the videos to use again are this computer's own; its words sets are listed apart");
  ok(v.when === "asked" && v.general.length === 1, "the page is told when a video goes out and what the general video is");
  // more ads than the page shows: the cut never takes a choice already made, and the page is told the real count
  {
    const many = [];
    for (let i = 0; i < 90; i++) many.push({ label: "B" + i + " · Phone model " + (1000 + i), id: "x" + i, at: T - i * 1000, inbox: -1 });
    const mineQuiet = B.myAdSetsPut([], ME, "Old ad that went quiet", V1, "q1").set, mineLate = B.myAdSetsPut([], ME, "Phone model 1089", V2, "q2").set;
    const big = B.myAdsRows(cfg([mineQuiet, mineLate], [G1]), ME, many, "", T);
    ok(big.total === 91 && big.ads.length === 80 && big.ads.filter((a) => a.kind === "own").length === 2 && big.ads.some((a) => a.setId === "q1" && a.quiet) && big.ads.some((a) => a.setId === "q2") && big.ads[0].item === "Phone model 1000", "more than 80 ads: 80 lines are shown, EVERY ad with its own video among them (the quiet one and the 90th), the newest first, and the real count comes with them");
  }
  const none = B.myAdsRows(cfg([own], []), ME, seen, "", T);
  ok(none.ads.find((a) => a.item === "Galaxy S24 Ultra").kind === "none" && none.ads.map((a) => a.item).join(" | ") === "MacBook Air M2 | iPhone 13 Pro 256 Go | Galaxy S24 Ultra", "with no general video an ad without a choice gets none; with no chat open the order is the newest first (the top of the inbox counts as now)");
  ok(B.myAdsRows(cfg([own], []), ME, seen, "Zed · Galaxy S24 Ultra 500$", T).ads[0].item === "Galaxy S24 Ultra", "…and whatever chat is open, its ad comes first");
  ok(B.myAdsRows({}, ME, [], "", T).ads.length === 0 && B.myAdsRows(null, "", null, null, 0).ads.length === 0, "nothing to show = an empty list, never an error");
  const every = v.ads.every((a) => { const p = B.adVideoPick(s, a.item, ME); return a.kind === "general" ? !p : a.kind === "none" ? !p : !!p && p.id === a.setId; });
  ok(every, "every row's video is the one the bots' own rule gives that ad on this computer");
}

console.log("— 6. THE WRITE: only adVideoSets, on the row's stamp —");
const impure = between(bg, "const MYADS_BUCKET = ", "\nchrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {");
const realGuards = between(bg, "const CFG_TEXT_KEYS = ", "\nfunction getConfigBackups()");
function makeWorker(opts) {
  const o = opts || {};
  const TEACH = { apiKey: "sk-ant-x", model: "claude-haiku-4-5", businessInfo: "The shop.", instructions: "Be kind.", priceList: "13 Pro 650", videoLinkFallback: true, demoVideoUrls: [G1], adVideoSets: [{ id: "mac", ads: "macbook", pcs: [], clips: [M1] }] };
  const row = { config: JSON.parse(JSON.stringify(o.config || TEACH)), updated_at: "2026-11-13T15:00:00.000001+00:00" };
  const store = Object.assign({ replyLog: [], cloudConfig: JSON.parse(JSON.stringify(row.config)), cloudAuth: o.noLogin ? null : { refresh_token: "r" } }, o.store || {});
  const calls = { gets: 0, patches: [], pulls: 0, tabMsgs: 0, order: [] };
  let lose = o.lose || 0, stampN = 1;
  const nextStamp = () => "2026-11-13T15:00:0" + (stampN++) + ".000001+00:00";
  const chrome = {
    runtime: { id: "extid", lastError: null, getURL: (p) => "chrome-extension://extid/" + (p || ""), getManifest: () => ({ version: "0.21.97" }) },
    storage: { local: { get: (keys, cb) => { const out = {}; for (const k of keys) if (store[k] != null) out[k] = store[k]; cb(out); } } },
    tabs: {
      query: (q, cb) => cb((o.tabs || []).map((t) => ({ id: t.id }))),
      sendMessage: (id, msg, cb) => { calls.tabMsgs++; const t = (o.tabs || []).find((x) => x.id === id); if (t && t.answer) setTimeout(() => cb(t.answer), 5); /* a sleeping tab never answers */ },
    },
  };
  const fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    if (method === "GET") {
      calls.gets++; calls.order.push("get");
      if (o.getHangs) { const e = new Error("The operation was aborted."); e.name = "AbortError"; throw e; } // what a request cut at its time limit throws
      if (o.getStatus) return { ok: false, status: o.getStatus, json: async () => ({}) };
      if (o.noRow) return { ok: true, status: 200, json: async () => [] };
      return { ok: true, status: 200, json: async () => [{ config: JSON.parse(JSON.stringify(row.config)), updated_at: row.updated_at }] };
    }
    const m = String(url).match(/updated_at=eq\.([^&]+)/);
    const stamp = m ? decodeURIComponent(m[1]) : "";
    const body = JSON.parse(init.body);
    calls.patches.push({ url: String(url), stamp, body, headers: init.headers });
    calls.order.push("patch");
    if (lose > 0) { // another device saved between this computer's read and its write
      lose--;
      row.config = Object.assign({}, row.config, { instructions: "Changed on the web app, save " + stampN });
      row.updated_at = nextStamp();
      return { ok: true, status: 200, json: async () => [] };
    }
    if (stamp !== row.updated_at) return { ok: true, status: 200, json: async () => [] };
    if (o.patchStatus) return { ok: false, status: o.patchStatus, json: async () => ({ message: "refused by a rule" }) };
    row.config = body.config;
    row.updated_at = nextStamp();
    return { ok: true, status: 200, json: async () => [{ config: row.config, updated_at: row.updated_at }] };
  };
  const W = new Function(
    "chrome", "fetch", "getCloudAuth", "abortedMsg", "getSettings", "getMachineId", "getMachineLabel", "cloudValidAuth", "getAuthHold", "authHoldLine", "readManagedConfig", "getCloudCreds", "LEGACY_LINK_OFF", "cloudPull", "LOG", "myAdsRows", "myAdSetsPut", "myAdWordsPut", "myAdSetsDrop", "adOneAlt", "adVideoSets",
    realGuards + "\n" + impure + "\nreturn { myAdsOwnPage, myAdsSeen, myAdsState, myAdsWrite, myAdsClipOk, myAdsWordsCheck, cloudRowPatch, MYADS_BUCKET };"
  )(
    chrome, fetch,
    async () => (o.noLogin ? null : { refresh_token: "r", user_id: "uid" }),
    (e, what, ms) => (/abort/i.test(String((e && (e.name + " " + e.message)) || "")) ? "no answer from " + what + " in " + Math.round(ms / 1000) + " s" : String((e && e.message) || e)),
    async () => Object.assign({ videoWhen: "asked" }, store.cloudConfig || {}),
    async () => ME,
    async () => o.label || ME,
    async () => (o.noLogin || o.authDown || o.authEnded ? null : { access_token: "tok", user_id: "uid" }),
    async () => (o.authEnded ? { until: Date.now() + 60000, kind: "ended" } : o.authDown ? { until: Date.now() + 60000, kind: "limited" } : null),
    (h) => (h ? "waiting 1 min for the login" : ""),
    async () => (o.managed ? { apiKey: "policy" } : null),
    async () => ({ url: "https://x.supabase.co", key: "anon" }),
    Object.freeze({ videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "" }),
    async (force) => { calls.pulls++; calls.order.push("pull:" + force); if (o.pullFails) return { ok: false, error: "offline" }; store.cloudConfig = JSON.parse(JSON.stringify(row.config)); return { ok: true }; },
    () => {},
    B.myAdsRows, B.myAdSetsPut, B.myAdWordsPut, B.myAdSetsDrop, B.adOneAlt, B.adVideoSets
  );
  return { W, row, calls, store };
}

(async () => {
  {
    const { W, row, calls } = makeWorker();
    // everything but the list being changed and the four legacy link keys every write switches off
    const rest = (c) => { const o = Object.assign({}, c); for (const k of ["adVideoSets", "videoLinkFallback", "videoLinkOptIn", "videoLinkUrl", "videoLinkText"]) delete o[k]; return JSON.stringify(o); };
    const teachBefore = rest(row.config);
    const r = await W.myAdsWrite({ op: "put", item: "iPhone 13 Pro 256 Go", clip: V1 });
    const p = calls.patches[0] || { body: { config: {} }, url: "" };
    ok(r.ok === true && /^m[a-z0-9]+$/.test(r.set) && calls.gets === 1 && calls.patches.length === 1, "one read, one write, and the new choice's id comes back: " + JSON.stringify(r));
    ok(/\/rest\/v1\/subsell_configs\?user_id=eq\.uid&updated_at=eq\./.test(p.url) && p.stamp === "2026-11-13T15:00:00.000001+00:00" && p.headers.authorization === "Bearer tok" && p.headers.apikey === "anon", "the write lands only on the row that was read (its stamp), for this account, with this computer's login");
    ok(rest(p.body.config) === teachBefore && Object.keys(p.body.config).length >= 8 && p.body.config.apiKey === "sk-ant-x" && p.body.config.instructions === "Be kind.", "ONLY adVideoSets changed: the key, the teaching, the prices and the general video go back exactly as they were read");
    ok(p.body.config.videoLinkFallback === false && p.body.config.videoLinkUrl === "", "…and the legacy link keys go out switched off, as on every write");
    const sets = row.config.adVideoSets;
    ok(sets.length === 2 && sets[0].id === "mac" && sets[1].exact === true && sets[1].ads === "iPhone 13 Pro 256 Go" && JSON.stringify(sets[1].pcs) === '["pc-abc12"]' && sets[1].clips[0].url === V1.url, "the account's list now holds the web app's set and this computer's choice");
    ok(calls.pulls === 1 && calls.order.join(",") === "get,patch,pull:true", "then this computer reads its own choice at once (a forced pull), in that order");
  }
  {
    const { W, row, calls } = makeWorker({ lose: 2 });
    const r = await W.myAdsWrite({ op: "put", item: "iPhone 13 Pro 256 Go", clip: V1 });
    ok(r.ok === true && calls.gets === 3 && calls.patches.length === 3 && calls.patches[2].stamp !== calls.patches[0].stamp, "a save that landed in between = the row is read again and the write tried on the new stamp (3 reads, 3 writes)");
    ok(/^Changed on the web app/.test(row.config.instructions) && row.config.adVideoSets.length === 2 && row.config.adVideoSets.filter((s) => s.exact === true).length === 1, "…the other save is kept (its teaching stands) and the choice is there once, not twice");
    const ids = new Set(calls.patches.map((p) => p.body.config.adVideoSets[p.body.config.adVideoSets.length - 1].id));
    ok(ids.size === 1, "…under one id across the tries");
  }
  {
    const { W, row, calls } = makeWorker({ lose: 9 });
    const before = JSON.stringify(row.config.adVideoSets);
    const r = await W.myAdsWrite({ op: "put", item: "iPhone 13 Pro 256 Go", clip: V1 });
    ok(r.ok === false && /try again/.test(r.error) && calls.patches.length === 4 && JSON.stringify(row.config.adVideoSets) === before && calls.pulls === 0, "a row that keeps changing: four tries, then it says so; nothing was written: " + r.error);
  }
  {
    const a = makeWorker({ noLogin: true });
    const r = await a.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(r.ok === false && r.login === true && a.calls.gets === 0 && a.calls.patches.length === 0, "no login on this Chrome: refused before anything is asked of the account: " + r.error);
    const b = makeWorker({ authDown: true });
    const r2 = await b.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(r2.ok === false && r2.login === true && /waiting 1 min/.test(r2.error) && b.calls.gets === 0, "a login that is waiting says which wait");
  }
  {
    const { W, calls } = makeWorker();
    const r = await W.myAdsWrite({ op: "put", item: "iPhone 13", clip: { name: "x.mp4", url: "https://evil.example/x.mp4", size: 1 } });
    const r2 = await W.myAdsWrite({ op: "put", item: "iPhone 13", clip: { name: "x.mp4", url: "https://x.supabase.co/storage/v1/object/public/other-bucket/uid/x.mp4", size: 1 } });
    ok(r.ok === false && r2.ok === false && calls.gets === 0 && calls.patches.length === 0, "a video that is not a file of the account's own video storage is refused, nothing asked: " + r.error);
    const P = "https://x.supabase.co/storage/v1/object/public/subsell-videos/";
    const bad = [P + "../other-bucket/x.mp4", P + "uid/../../other-bucket/x.mp4", P + "someone-else/x.mp4", P + "uid/x.mp4?download=1", P + "uid/x.mp4#a", P + "uid/%2e%2e/x.mp4", P + "uid/", "https://x.supabase.co.evil.example/storage/v1/object/public/subsell-videos/uid/x.mp4", "https://user:pw@x.supabase.co/storage/v1/object/public/subsell-videos/uid/x.mp4", "", null, "not a url"];
    ok(bad.every((u) => W.myAdsClipOk(u, "https://x.supabase.co", "uid") === false) && W.myAdsClipOk(P + "uid/1700000000000-demo.mp4", "https://x.supabase.co", "uid") === true && W.myAdsClipOk(P + "uid/1-a.mp4", "https://x.supabase.co", "") === true, "the address is parsed, never matched as a prefix: dots, another account's folder, another bucket or host, a query or a fragment are all refused; this login's own folder passes");
    const r3 = await W.myAdsWrite({ op: "put", item: "iPhone 13", clip: { name: "x.mp4", url: P + "someone-else/x.mp4", size: 1 } });
    ok(r3.ok === false && calls.gets === 0, "a file in another account's folder of the same bucket is refused too");
  }
  {
    const wiped = makeWorker();
    wiped.row.config = { model: "claude-haiku-4-5" }; // the key and the teaching gone
    const r = await wiped.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(r.ok === false && /emptied/.test(r.error) && wiped.calls.patches.length === 0, "an emptied account row is not written on (the heal owns it): " + r.error);
    const none = makeWorker({ noRow: true });
    ok((await none.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 })).ok === false && none.calls.patches.length === 0, "no row = nothing written");
    const down = makeWorker({ getStatus: 503 });
    const rd = await down.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(rd.ok === false && /503/.test(rd.error) && down.calls.patches.length === 0, "the account not answering is said with its code: " + rd.error);
    const ref2 = makeWorker({ patchStatus: 403 });
    const rr = await ref2.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(rr.ok === false && /refused by a rule/.test(rr.error) && ref2.calls.pulls === 0, "a refused write carries the account's own reason: " + rr.error);
    const hang = makeWorker({ getHangs: true });
    const rh = await hang.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(rh.ok === false && /no answer from the account in 20 s/.test(rh.error) && hang.calls.patches.length === 0, "a request that gets no answer is cut at its time limit and said plainly (the worker is never left hanging): " + rh.error);
    ok(/const ROW_PATCH_TIMEOUT_MS = 20 \* 1000;/.test(bg) && (impure.match(/await timed\(/g) || []).length === 2 && !/await fetch\(`\$\{url\}\/rest\/v1\/subsell_configs/.test(impure), "both requests of the narrow writer carry the time limit");
    const slow = makeWorker({ pullFails: true });
    const rs = await slow.W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(rs.ok === true && rs.pulled === false && slow.row.config.adVideoSets.length === 2, "the choice landed but this computer could not read it back yet: still a success, and the answer says so (pulled: false)");
    const fine = await makeWorker().W.myAdsWrite({ op: "put", item: "iPhone 13", clip: V1 });
    ok(fine.ok === true && fine.pulled === true, "…and pulled: true when it did");
  }
  {
    const { W, row, calls } = makeWorker();
    const [a, b] = await Promise.all([W.myAdsWrite({ op: "put", item: "iPhone 13 Pro", clip: V1 }), W.myAdsWrite({ op: "put", item: "Galaxy S24", clip: V2 })]);
    ok(a.ok && b.ok && row.config.adVideoSets.length === 3 && calls.order.join(",") === "get,patch,pull:true,get,patch,pull:true", "two choices at once are written one after the other, both land");
    const drop = await W.myAdsWrite({ op: "drop", setId: a.set });
    ok(drop.ok && row.config.adVideoSets.length === 2 && !row.config.adVideoSets.some((s) => s.id === a.set), "a choice taken back leaves the list");
    const n = calls.patches.length;
    const again = await W.myAdsWrite({ op: "drop", setId: a.set });
    ok(again.ok && again.same === true && calls.patches.length === n, "taking back what is already gone writes nothing");
    const refused = await W.myAdsWrite({ op: "drop", setId: "mac" });
    ok(refused.ok === false && /web app/.test(refused.error) && calls.patches.length === n && row.config.adVideoSets.some((s) => s.id === "mac"), "the web app's set cannot be removed from a computer's page: " + refused.error);
    const words = await W.myAdsWrite({ op: "words", words: "ipad air", clip: V3 });
    ok(words.ok && row.config.adVideoSets.some((s) => s.ads === "ipad air" && s.exact === undefined && s.pcs[0] === "pc-abc12"), "words for an ad not in the list are written the same way");
    ok((await W.myAdsWrite({ op: "nonsense" })).ok === false, "an unknown change is refused");
  }
  console.log("— 7. who may ask, what is read, where it is wired —");
  {
    const { W } = makeWorker();
    ok(W.myAdsOwnPage({ id: "extid", url: "chrome-extension://extid/myads.html", tab: { id: 5 } }) === true && W.myAdsOwnPage({ id: "extid", url: "chrome-extension://extid/popup.html" }) === true, "the extension's own pages may ask");
    ok(W.myAdsOwnPage({ id: "extid", url: "https://www.messenger.com/marketplace/t/1", tab: { id: 3 } }) === false && W.myAdsOwnPage({ id: "other", url: "chrome-extension://other/x.html" }) === false && W.myAdsOwnPage(null) === false && W.myAdsOwnPage({ id: "extid" }) === false, "a content script (a web page's address), another extension, or nobody may not");
    ok(W.myAdsOwnPage({ id: "extid", url: "chrome-extension://extid/myads.html", origin: "chrome-extension://extid" }) === true && W.myAdsOwnPage({ id: "extid", url: "chrome-extension://extid/myads.html", origin: "https://www.messenger.com" }) === false, "…and when Chrome names the sender's origin, it must be the extension's own");
    ok(W.MYADS_BUCKET === "subsell-videos", "the bucket is the web app's own");
  }
  {
    const tabs = [{ id: 1, answer: { ok: true, rows: [{ label: "Paul · MacBook Air M2 · 2h", id: "t3" }, { label: "Marie Tremblay", id: "t4" }, { label: 5 }, null], open: "Paul · MacBook Air M2" } }, { id: 2 /* asleep: never answers */ }];
    const log = [{ at: "2026-11-13T14:00:00Z", thread: "Jimmy · iPhone 13 Pro 256 Go 650$", threadId: "t1", action: "text" }, { at: "2026-11-13T14:10:00Z", thread: "Messenger", threadId: "t9", action: "video" }, { at: "x", thread: null }, null];
    const { W, calls } = makeWorker({ tabs, store: { replyLog: log } });
    const t0 = Date.now();
    const got = await W.myAdsSeen();
    const took = Date.now() - t0;
    ok(got.seen.length === 2 && got.seen[0].label === "Jimmy · iPhone 13 Pro 256 Go 650$" && got.seen[0].id === "t1" && got.seen[0].inbox === -1 && got.seen[1].label === "Paul · MacBook Air M2 · 2h" && got.seen[1].inbox === 0 && got.open === "Paul · MacBook Air M2", "this computer's chats = its own log + what its inbox shows; only labels with a listing (Buyer · headline): " + JSON.stringify(got.seen.map((x) => x.label)));
    ok(got.tabs === 2 && got.answered === 1 && calls.tabMsgs === 2 && took < 4000 && took >= 1400, "a Messenger tab that does not answer is waited for 1.5 s, not for ever (" + took + " ms)");
    const st = await W.myAdsState();
    ok(st.ok && st.machine === ME && st.canSave === true && st.why === "" && st.loggedIn === true && st.inboxRead === true && st.messengerTabs === 2 && st.version === "0.21.97" && Array.isArray(st.ads) && st.ads.length === 2 && st.ads[0].item === "MacBook Air M2" && st.ads[0].open === true && st.ads[0].kind === "set" && st.ads[1].kind === "general", "the page's answer: this computer, may save, its two ads (the open one first) and what each gets");
    const out = await makeWorker({ noLogin: true }).W.myAdsState();
    ok(out.canSave === false && out.loggedIn === false && out.needLogin === true && /not logged in/.test(out.why), "not logged in: the list is shown, saving is off and says why, and a login is what helps: " + out.why);
    const down = await makeWorker({ authDown: true }).W.myAdsState();
    ok(down.canSave === false && down.loggedIn === true && down.needLogin === false && /waiting \(waiting 1 min/.test(down.why) && /Press Refresh to try now/.test(down.why), "a login that is waiting: saving is off for now, with the wait and what tries it now (no login button: it would not help): " + down.why);
    const dead = await makeWorker({ authEnded: true }).W.myAdsState();
    ok(dead.canSave === false && dead.loggedIn === true && dead.needLogin === true && /has ended\. Log in again/.test(dead.why), "a login that ENDED (the stored one is dead): the page says so and offers the login: " + dead.why);
    const pol = await makeWorker({ managed: true }).W.myAdsState();
    ok(pol.canSave === false && pol.needLogin === false && /policy/.test(pol.why), "settings from a company policy: saving is off, said plainly, and no login is offered (it would change nothing)");
    const noPol = await makeWorker({ managed: true, noLogin: true }).W.myAdsState();
    ok(noPol.needLogin === false, "…also when that computer has no login at all");
    const loc = await makeWorker({ config: { apiKey: "sk-ant-x", businessInfo: "The shop.", instructions: "Be kind.", demoVideoUrls: [], adVideoSets: [] }, store: { videoEnabled: true, demoVideos: [{ name: "a.mp4", dataUrl: "data:video/mp4;base64,AAAA" }, { name: "b.mp4", dataUrl: "data:video/mp4;base64,BBBB" }, { name: "empty" }] } }).W.myAdsState();
    const locOff = await makeWorker({ store: { videoEnabled: true, demoVideos: [{ name: "a.mp4", dataUrl: "data:video/mp4;base64,AAAA" }] } }).W.myAdsState();
    ok(loc.localClips === 2 && locOff.localClips === 0 && (await makeWorker().W.myAdsState()).localClips === 0, "the page is told when this computer's own Settings videos are what an ad without a choice gets (no general video on the account), and only then");
    const { W: Wc } = makeWorker();
    ok(Wc.myAdsWordsCheck("iphone 14 pro, 128 Go").ok === true && Wc.myAdsWordsCheck("iphone 14 pro, 128 Go").words === "iphone 14 pro 128 Go" && Wc.myAdsWordsCheck("liquidation 300$").ok === false && Wc.myAdsWordsCheck("").ok === false && Wc.myAdsWordsCheck(null).ok === false, "words are checked before the chooser opens: usable words pass (as one group), a price or an advert word alone does not");
    const named = await makeWorker({ label: "Front desk" }).W.myAdsState();
    ok(named.label === "Front desk" && (await makeWorker().W.myAdsState()).label === "", "the computer's own name is shown when it has one");
  }
  {
    const cases = between(bg, 'case "MYADS_LIST": {', 'case "FETCH_VIDEO": {');
    ok(/case "MYADS_TICKET": \{[\s\S]{0,200}if \(!myAdsOwnPage\(_sender\)\)/.test(cases) && /case "MYADS_PUT":\s*case "MYADS_WORDS":\s*case "MYADS_DROP": \{\s*if \(!myAdsOwnPage\(_sender\)\)/.test(cases), "the upload ticket and every write are for the extension's own pages only (checked before anything else)");
    ok(/token: authT\.access_token, userId: authT\.user_id, bucket: MYADS_BUCKET/.test(cases) && /cloudValidAuth\(\{ user: true \}\)/.test(cases), "the ticket is this computer's own login, through the one auth gate");
    ok(!/cloudPush\(/.test(impure) && /updated_at=eq\.\$\{encodeURIComponent\(stamp\)\}/.test(impure) && /Object\.assign\(\{\}, live, res\.set, LEGACY_LINK_OFF\)/.test(impure) && /return \{ ok: true, set: \{ adVideoSets: res\.list \}, out:/.test(impure), "the write never goes through the whole-row save; it patches the row just read, on its stamp, and a video choice names one key");
    ok(!/\/token|refresh_token"\s*:|grant_type/.test(impure), "no /token call is added (every login call stays behind cloudValidAuth)");
    const pure = between(bg, "/* ===== (v0.21.97) MY ADS, MY VIDEOS (pure", "// A lesson about another model is never offered");
    ok(!/chrome\.|fetch\(|Date\.now\(|Math\.random\(/.test(pure), "the rules are pure (no chrome, no fetch, no clock): the web app can run them from the same slice");
    const lst = between(ct, 'if (msg && msg.type === "LIST_ADS") {', 'if (msg && msg.type === "PAUSE_SCANS") {').replace(/\/\/[^\n]*/g, ""); // the code, without its comments
    ok(/conversationAnchors\(\)/.test(lst) && /anchorName\(a\)/.test(lst) && /openThreadName\(\)/.test(lst) && !/\.click\(|scroll|location\.(href|assign|replace)\s*=|handleThread|typeAndSend|maybeSendVideo|ask\(|setStatus|busy\s*=/.test(lst), "content.js LIST_ADS only reads the inbox rows' labels: no click, no scroll, no navigation, no send, no state");
    ok((ct.match(/LIST_ADS/g) || []).length === 1, "…and it is the only message content.js gained (its one other change is section 8: which sets open the question on this computer)");
    ok(/id="myAds"/.test(popupHtml) && /\$\("myAds"\)\.addEventListener\("click", \(\) => chrome\.tabs\.create\(\{ url: chrome\.runtime\.getURL\("myads\.html"\), active: true \}\)\);/.test(popupJs), "the popup has the button, and the page opens on that click only");
    ok(/id="openMyAds"/.test(optHtml) && /\$\("openMyAds"\)\.addEventListener\("click"/.test(optJs), "Settings → Videos has the same door");
    ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/.test(page), "the page never draws data as HTML and runs no text as code");
    const types = Array.from(new Set((page.match(/type: "([A-Z_]+)"/g) || []).map((x) => x.slice(7, -1)))).sort().join(",");
    ok(types === "MYADS_CHECK,MYADS_DROP,MYADS_LIST,MYADS_PUT,MYADS_TICKET,MYADS_WORDS", "the page talks to the worker through the six MYADS messages and nothing else: " + types);
    ok(/const path = ticket\.userId \+ "\/" \+ Date\.now\(\) \+ "-" \+ safe;/.test(page) && /x\.open\("POST", ticket\.url \+ "\/storage\/v1\/object\/" \+ ticket\.bucket \+ "\/" \+ path\);/.test(page) && /"\/storage\/v1\/object\/public\/" \+ ticket\.bucket \+ "\/" \+ path/.test(page), "the upload goes into the account's own folder of the bucket (the path the storage rules allow) and the public address is the web app's form");
    ok(!/<script(?![^>]*\bsrc=)[^>]*>/.test(pageHtml) && /<script src="myads\.js"><\/script>/.test(pageHtml) && !/\son[a-z]+="/.test(pageHtml), "myads.html carries no inline script and no inline handler (the extension's page rules)");
    ok(/name="google" content="notranslate"/.test(pageHtml), "the browser's translator is told to leave the ad titles alone");
    for (const f of ["store/build-webstore-zip.ps1", "store/build-fleet-zips.ps1", "store/build-extension-zip.sh", "store/boot-store.mjs"]) ok(/myads\.html/.test(read(f)) && /myads\.js/.test(read(f)), f + " carries the page");
    ok(JSON.stringify(manifest.permissions) === JSON.stringify(["storage", "unlimitedStorage", "alarms", "notifications", "activeTab", "tabs", "scripting", "downloads", "debugger"]) && manifest.host_permissions.length === 5 && !manifest.web_accessible_resources, "no new permission, no new host, nothing made reachable from web pages");
    ok(/\n  adVideoSets: \[\], \/\/ \(v0\.21\.96\)/.test(bg), "DEFAULTS are untouched: an account that never made a choice reads as before");
    ok(/if \(set && set\.exact === true\) return;/.test(app) && /const ownChoices = sets\.filter\(\(s\) => s && s\.exact === true\);/.test(app) && /Chosen on the computers themselves: /.test(app) && /box\.id = "adOwnChoices";/.test(app), "the web app lists the computers' own choices in one folded line each, never as a card per choice");
    ok(/if \(pcs\.length && !pcs\.includes\(me\)\) \{ others\+\+; return; \}/.test(optJs) && /for other computers \(not sent from this one\)/.test(optJs), "Settings lists this computer's sets and only counts the others'");
    ok(/exact/.test(ref) && /Videos for my ads/.test(ref), "SETTINGS-REFERENCE documents the mark and the page");
    ok(/ mine=/.test(bg), "the 🩺 videos line counts this computer's own sets (mine=)");
  }
  console.log("— 8. a choice on ONE computer changes nothing on the others —");
  {
    const C = new Function(
      between(ct, "  function clipIdsOf(v) {", "  // What the Activity row calls the clip") + "\n" +
      between(ct, "  function adSetHere(x, me) {", "  let videoLockedSig = null;") + "\n" +
      "return { adSetHere, adSetsOn, clipListSig };"
    )();
    const forA = { id: "a1", ads: "iPhone 13 Pro 256 Go", pcs: ["pc-abc12"], clips: [V1], exact: true };
    const forAll = { id: "all", ads: "macbook", pcs: [], clips: [M1] };
    ok(C.adSetsOn(cfg([forA]), "pc-abc12") === true && C.adSetsOn(cfg([forA]), "pc-zzz99") === false && C.adSetsOn(cfg([forA]), "") === false, "a set made for computer A opens the question to the worker on A only: computer B (and a computer with no id yet) asks nothing");
    ok(C.adSetsOn(cfg([forAll]), "pc-zzz99") === true && C.adSetsOn(cfg([forAll]), "") === true && C.adSetsOn(cfg([forA, forAll]), "pc-zzz99") === true, "a set made for every computer still opens it everywhere");
    ok(C.adSetsOn(cfg([forA])) === true && C.adSetsOn(cfg([])) === false && C.adSetsOn({}, "pc-abc12") === false, "with no computer named the reading is the old one (any usable set): the list signature and the diagnostic keep it");
    ok(C.adSetHere({ pcs: [" PC-ABC12 "] }, "pc-abc12") === true && C.adSetHere({ pcs: ["pc-abc12", "pc-zzz99"] }, "pc-zzz99") === true && C.adSetHere({}, "pc-zzz99") === true && C.adSetHere({ pcs: ["pc-abc12"] }, "pc-zzz99") === false, "the rule is the worker's own: no computer named = every computer; names are read lower case, trimmed");
    for (const me of ["pc-abc12", "pc-zzz99", ""]) for (const sets of [[forA], [forAll], [forA, forAll], []]) {
      const worker = B.adVideoSets(cfg(sets)).some((s) => { const p = (s.pcs || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean); return !p.length || (!!me && p.includes(me)); });
      if (C.adSetsOn(cfg(sets), me) !== worker) ok(false, "content.js and the worker disagree on which sets can apply on '" + me + "' for " + JSON.stringify(sets.map((s) => s.id)));
    }
    ok(true, "content.js and the worker agree, set by set and computer by computer, on which sets can apply here");
    const eng = between(ct, "  async function maybeSendVideo(", "\n  function sidebarQuietMs(");
    ok((eng.match(/adSetsOn\(sCfg, meA\)/g) || []).length === 2 && !/adSetsOn\(sCfg\)/.test(eng), "both readings inside the video visit name this computer");
    ok(B.chatClipChoice(cfg([forA], [G1]), null, false, "iPhone 13 Pro 256 Go", "PC-zzz99").set === "" && B.chatClipChoice(cfg([forA], [G1]), null, true, "iPhone 13 Pro 256 Go", "PC-zzz99").set === "", "…and what computer B would have been told had it asked is the general list anyway: skipping the question changes nothing there");
  }
  console.log("— 9. one key into the row: the slider; one set per id; the update gate; sizes —");
  {
    const { W, row, calls } = makeWorker();
    const before = JSON.stringify(Object.assign({}, row.config, { responseDelaySec: null, videoLinkFallback: null }));
    const r = await W.cloudRowPatch((live) => (Number(live.responseDelaySec) === 45 ? { ok: true, same: true } : { ok: true, set: { responseDelaySec: 45 } }), "response delay 45 s");
    const p = calls.patches[0] || { body: { config: {} } };
    const strip = (c) => { const o = Object.assign({}, c); for (const k of ["responseDelaySec", "videoLinkFallback", "videoLinkOptIn", "videoLinkUrl", "videoLinkText"]) delete o[k]; return JSON.stringify(o); };
    ok(r.ok === true && calls.patches.length === 1 && p.body.config.responseDelaySec === 45 && strip(p.body.config) === strip(JSON.parse(before)) && row.config.adVideoSets.length === 1 && row.config.instructions === "Be kind.", "the delay slider writes ONE key into the row it just read: the teaching and the video sets go back untouched");
    const again = await W.cloudRowPatch((live) => (Number(live.responseDelaySec) === 45 ? { ok: true, same: true } : { ok: true, set: { responseDelaySec: 45 } }), "x");
    ok(again.ok && again.same === true && calls.patches.length === 1, "the same value again writes nothing");
    const [a, b] = await Promise.all([W.myAdsWrite({ op: "put", item: "iPhone 13 Pro", clip: V1 }), W.cloudRowPatch(() => ({ ok: true, set: { responseDelaySec: 60 } }), "y")]);
    ok(a.ok && b.ok && row.config.responseDelaySec === 60 && row.config.adVideoSets.length === 2, "a slider move and a video choice at the same moment both land (one writer, one at a time): neither undoes the other");
    const sd = between(bg, 'case "SET_DELAY": {', 'case "FETCH_VIDEO": {');
    ok(!/cloudPush\(|bankConfig\(|guardOutgoingConfig\(/.test(sd) && /if \(!myAdsOwnPage\(_sender\)\)/.test(sd) && /if \(!\(authD && authD\.refresh_token\)\) \{ sendResponse\(\{ ok: false, fallback: true \}\); break; \}/.test(sd) && /cloudRowPatch\(\(live\) => \(Number\(live\.responseDelaySec\) === secD/.test(sd) && /Math\.max\(0, Math\.min\(180,/.test(sd), "SET_DELAY: the extension's own pages only, the slider's own range, one key through the narrow writer; no login = the popup's old local save");
    ok(/\$\("delay"\)\.addEventListener\("input", showDelay\);/.test(popupJs) && /\$\("delay"\)\.addEventListener\("change", onDelay\);/.test(popupJs) && /type: "SET_DELAY", sec/.test(popupJs) && /if \(r && r\.fallback\) \{ settings = await getSettings\(\); settings\.responseDelaySec = sec; await saveSettings\(settings\); return; \}/.test(popupJs) && !/if \(!r \|\| r\.fallback\)/.test(popupJs), "the popup saves once, when the slider is let go, through SET_DELAY; the whole-row save is left for a computer the worker says has no cloud login — never for a worker that gave no answer");
    ok((popupJs.match(/saveSettings\(/g) || []).length === 2, "…and nothing else in the popup saves the whole row");
  }
  {
    const twice = [{ id: "s1", ads: "macbook", pcs: [], clips: [M1] }, { id: "s1", ads: "macbook", pcs: [], clips: [V3] }, { id: "s2", ads: "ipad", pcs: [], clips: [V1] }];
    const usable = B.adVideoSets(cfg(twice));
    ok(usable.length === 2 && usable[0].clips[0].url === M1.url && usable[1].id === "s2", "two sets under one id (two saves that crossed): the bots read the first one only");
    const picked = B.adVideoPick(cfg(twice), "MacBook Air", ME), remembered = B.chatClipChoice(cfg(twice), { set: "s1" }, true, "MacBook Air", ME);
    ok(picked.clips[0].url === M1.url && remembered.clips[0].url === M1.url, "…so the pick and a chat's remembered set name the same video");
    ok(B.adVideoSets(cfg([twice[0], twice[2]])).length === 2, "a list with no repeated id reads as before");
  }
  {
    const canonV = (v) => (Array.isArray(v) ? v.map(canonV) : v && typeof v === "object" ? Object.keys(v).sort().reduce((o, k) => { o[k] = canonV(v[k]); return o; }, {}) : v);
    const G = new Function(
      "teachCanon", "DEFAULTS", "EXT_DEFAULT_TEXT", "LEGACY_LINK_OFF", "LEGACY_GATE_OFF", "COACH_MAX",
      between(app, "  const cj = (v) =>", "  async function saveMerged(") + "\nreturn { mergeSetsById, mergeOverTheirs };"
    )(canonV, {}, {}, {}, {}, 30);
    const S = (id, ads, clip) => ({ id, ads, pcs: [], clips: [clip] });
    const ids = (l) => l.map((x) => x.id + ":" + x.ads + ":" + x.clips[0].name).join(" | ");
    const base = [S("a", "macbook", M1), S("b", "ipad", V1)];
    let m = G.mergeSetsById(base, [S("a", "macbook air", M1), S("b", "ipad", V1)], [S("a", "macbook", V3), S("b", "ipad", V1)]);
    ok(m.length === 2 && m.filter((x) => x.id === "a").length === 1 && m[0].ads === "macbook air", "the web app merges the sets BY ID: a set edited on both sides stays ONE set (this page's version), never two under one id — " + ids(m));
    m = G.mergeSetsById(base, [S("a", "macbook air", M1), S("b", "ipad", V1)], [S("b", "ipad", V1)]);
    ok(m.length === 1 && m[0].id === "b", "a set removed on a computer does NOT come back because this page had edited it");
    m = G.mergeSetsById(base, [S("b", "ipad", V1)], [S("a", "macbook", M1), S("b", "ipad", V1), Object.assign(S("m1", "iPhone 13 Pro", V2), { pcs: ["pc-abc12"], exact: true })]);
    ok(m.length === 2 && m[0].id === "b" && m[1].id === "m1" && m[1].exact === true, "removed here stays removed; a choice a computer made meanwhile is kept with its mark");
    m = G.mergeSetsById(base, base.concat([S("c", "pixel", V2)]), [S("a", "macbook", V3), S("b", "ipad", V1)]);
    ok(ids(m) === "a:macbook:other.mp4 | b:ipad:13pro.mp4 | c:pixel:13pro-b.mp4", "changed only there = theirs; made on this page = added: " + ids(m));
    m = G.mergeSetsById(base, base, [S("a", "macbook", M1), S("a", "macbook", V3), { ads: "no id", clips: [V1] }]);
    ok(m.length === 1 && m[0].clips[0].name === "macbook.mp4", "what comes back holds one set per id and no set without an id");
    const merged = G.mergeOverTheirs({ adVideoSets: base, businessInfo: "x" }, { adVideoSets: [S("a", "macbook air", M1), S("b", "ipad", V1)], businessInfo: "x" }, { adVideoSets: [S("b", "ipad", V1)], businessInfo: "y" });
    ok(merged.adVideoSets.length === 1 && merged.businessInfo === "y", "the stale-save merge of the whole row uses it for adVideoSets (the other lists merge as before)");
    ok(/set\.clips\.splice\(k, 1\); set\.id = newAdSetId\(\);/.test(app) && /set\.id = newAdSetId\(\); \/\/ \(v0\.21\.97\) a changed clip list = a new set id/.test(app), "a clip removed from or added to a card makes a NEW set id: a chat already served keeps what it has");
    ok(/const MAX_CLIP_BYTES = 25 \* 1024 \* 1024;/.test(app) && (app.match(/if \(f\.size > MAX_CLIP_BYTES\)/g) || []).length === 2 && /const MAX_BYTES = 25 \* 1024 \* 1024;/.test(page) && /if \(file\.size > MAX_BYTES\)/.test(page) && /const MIN_BYTES = 50 \* 1024;/.test(page) && /if \(file\.size < MIN_BYTES\)/.test(page) && /clen > 45 \* 1024 \* 1024/.test(bg) && /const VIDEO_MIN_BYTES = 50 \* 1024;/.test(bg), "a video that could never go out is refused at every upload: over 25 MB (Messenger's limit) on the web app and on the computer's page, and under 50 KB (the worker's floor) on the page");
    ok(/if \(playable === "bad"\)/.test(page) && /v\.addEventListener\("loadedmetadata", \(\) => fin\(v\.videoWidth > 0 && v\.videoHeight > 0 \? "ok" : "nopicture"\)\);/.test(page) && /const looksVideo = \(f\) => \/\^video\\\/\(mp4\|quicktime\|x-m4v\)\$\/i\.test/.test(page), "the page tries the file on this very Chrome before the upload (a video this Chrome cannot play would never go out), and takes mp4 / mov only");
    ok(/for \(let i = 0, seenIds = new Set\(\); i < sets\.length; \) \{/.test(app) && /box\.open = ownWasOpen;/.test(app), "the web app keeps one set per id when it draws (its next save cleans the row), and the folded block stays as the owner left it");
    const warm = between(bg, "async function prewarmDemoClips(settings) {", "    if (!list.length) return;");
    ok(/\(adSetMine\(s, meP\) \? ownP : sharedP\)\.push\(v\);/.test(warm) && /ownP\.reverse\(\);\s*const restP = list\.splice\(1\);[^\n]*\n\s*for \(const v of ownP\.concat\(restP, sharedP\)\) if \(list\.length < 8\) list\.push\(v\);/.test(warm), "the clip warm-up takes this computer's own choices right after the first general clip, the newest first (a choice just made is warmed before its first buyer)");
  }
  {
    const gate = between(bg, "function myAdsInUse() {", "let storeUpdTicking = false;");
    const mk = (contexts, pageAnswers) => {
      const st = { asked: 0 };
      const chrome = { runtime: { lastError: null, getContexts: async () => contexts, sendMessage: (msg, cb) => { st.asked++; if (pageAnswers) setTimeout(() => cb({ inUse: true }), 5); /* a forgotten page says nothing */ } } };
      const F = new Function("chrome", "setTimeout", gate + "\nreturn { storeUpdUiOpen, myAdsInUse };")(chrome, setTimeout);
      return { F, st };
    };
    const tab = (u) => ({ contextType: "TAB", documentUrl: "chrome-extension://x/" + u });
    const none = mk([], false);
    ok((await none.F.storeUpdUiOpen()) === false && none.st.asked === 0, "the update gate: no page open = nothing holds an update");
    const opt = mk([tab("options.html")], false);
    ok((await opt.F.storeUpdUiOpen()) === true && opt.st.asked === 0, "Settings open holds it, as before (no question asked)");
    const pop = mk([{ contextType: "POPUP", documentUrl: "chrome-extension://x/popup.html" }, tab("myads.html")], false);
    ok((await pop.F.storeUpdUiOpen()) === true, "the popup open holds it, as before");
    const used = mk([tab("myads.html")], true);
    ok((await used.F.storeUpdUiOpen()) === true && used.st.asked === 1, "“Videos for my ads” open AND in use holds it (the page says so)");
    const forgotten = mk([tab("myads.html"), tab("myads.html#x")], false);
    const t0 = Date.now();
    const res = await forgotten.F.storeUpdUiOpen();
    ok(res === false && Date.now() - t0 < 2500 && forgotten.st.asked === 1, "the same page left open and forgotten holds nothing: the update goes ahead (answer in " + (Date.now() - t0) + " ms)");
    ok(/if \(msg && msg\.type === "MYADS_IN_USE" && \(busy \|\| \(document\.visibilityState === "visible" && Date\.now\(\) - lastInput < 3 \* 60 \* 1000\)\)\) send\(\{ inUse: true \}\);/.test(page), "the page answers only while a file is going up, or the tab is in front and someone touched it in the last 3 minutes");
  }
  {
    const T = Date.parse("2026-11-13T15:00:00Z");
    const old = B.myAdSetsPut([], ME, "iPhone 13 Pro 128 Go", V1, "m1").set; // its chats went quiet: the older posting
    const live = B.myAdSetsPut([], ME, "Galaxy S24 Ultra 256 Go", V2, "m2").set;
    const seen = [{ label: "A · iPhone 13 Pro 128 Go Bleu comme neuf", id: "t1", at: T - 60e3, inbox: -1 }, { label: "B · Galaxy S24 Ultra 256 Go", id: "t2", at: T - 120e3, inbox: -1 }, { label: "C · iPhone 13 Pro Max 128 Go", id: "t3", at: T - 180e3, inbox: -1 }, { label: "D · Chaise de bureau", id: "t4", at: T - 240e3, inbox: -1 }];
    const v = B.myAdsRows(cfg([old, live], [G1]), ME, seen, "", T);
    const by = (item) => v.ads.find((a) => a.item === item) || {};
    ok(by("iPhone 13 Pro 128 Go Bleu comme neuf").kind === "general" && by("iPhone 13 Pro 128 Go Bleu comme neuf").like && by("iPhone 13 Pro 128 Go Bleu comme neuf").like.item === "iPhone 13 Pro 128 Go" && by("iPhone 13 Pro 128 Go Bleu comme neuf").like.clip.url === V1.url, "“same phone?”: an ad posted again under a changed title is offered the video of its older title (offered, not applied: it still reads general)");
    ok(!by("iPhone 13 Pro Max 128 Go").like && !by("Chaise de bureau").like && !by("Galaxy S24 Ultra 256 Go").like, "…never to another model (13 Pro Max), to an ad with no model, or to an ad that has its own video");
  }
  finished = true;
  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error("the run threw:", e); process.exit(1); });
