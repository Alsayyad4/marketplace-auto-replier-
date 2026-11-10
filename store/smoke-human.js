/* (v0.21.94) SUBSELL OUT + THE CLIP ONLY WHEN ASKED — the owner, Nov 10 2026: "remove the SubSell website and
 * name, links, anything that detects a bot". What ships: the shop's own name in the prompt (never the developer
 * default "SubSell"), a brand wall on every outgoing text and follow-up, a seed that is the shop only, the demo
 * clip only in a chat that asked for it, the renames. What does NOT ship, on purpose: any human-mimicry timing
 * (a fake "typing…" indicator, waits engineered so no two chats look alike, a bot-denial line) — see HANDOFF.
 *
 * Under test:
 *   1. background.js Try-it slice: shopNameFor, brandWall (false positives on legit replies, false negatives on
 *      SubSell / URL / e-mail variants), the three-way demo-clip sentence, writeReply with the wall, [CLIP] parsing;
 *   2. the wiring: no timing-theatre code anywhere, the .93 timing lines back, the clip gate in maybeSendVideo,
 *      the ask-for-a-clip regex, the follow-up wall as a plain skip, the keys in all three DEFAULTS, the UIs,
 *      the reference, the manifest name, the seed, the dashboard mirror.
 * Run:  node store/smoke-human.js
 */
const fs = require("fs");
const path = require("path");
const R = (p) => fs.readFileSync(path.join(__dirname, "..", p), "utf8");
const bg = R("background.js"), ct = R("content.js"), app = R("docs/app.js"), html = R("docs/index.html");
const opt = R("options.js"), optHtml = R("options.html"), ref = R("SETTINGS-REFERENCE.md"), manifest = JSON.parse(R("manifest.json"));
const popupHtml = R("popup.html");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " → " + b); process.exit(1); }
  return src.slice(s, e);
}

console.log("— 1. the name, the wall, the clip line (Try-it slice) —");
const core = between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "/* ---------------- video fetch ---------------- */");
ok(!/\bchrome\.[a-z]/.test(core.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "")), "the Try-it slice still uses no chrome.* API");
let modelText = "Allô! Le 14 Pro Max est là.";
const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: modelText }], usage: { input_tokens: 1, output_tokens: 1 } }), text: async () => "" });
const T = new Function("DEFAULTS", "fetch", core + "\nreturn { brandWall, shopNameFor, buildOwnerPrompt, writeReply, parseReply };")({}, fakeFetch);
ok(T.shopNameFor({ businessName: "SubSell" }) === "" && T.shopNameFor({ businessName: " subsell Montreal " }) === "" && T.shopNameFor({ businessName: "Sub Sell" }) === "" && T.shopNameFor({ businessName: "Sub-Sell" }) === "", "shopNameFor: the developer default and its variants (Sub Sell, Sub-Sell) are no name");
ok(T.shopNameFor({ businessName: "Liquidation Téléphone Montréal" }) === "Liquidation Téléphone Montréal" && T.shopNameFor({}) === "" && T.shopNameFor({ businessName: "Subsellers Inc" }) === "Subsellers Inc", "…the owner's name passes, so does an unrelated name that merely starts with sub; empty is empty");
ok(T.brandWall("Allô, le 14 Pro Max est là. Les prix sont sur subselltrade.ca. Tu passes à soir?") === "Allô, le 14 Pro Max est là. Tu passes à soir?", "brandWall drops the sentence with the website, keeps the rest");
ok(T.brandWall("SubSell te souhaite la bienvenue.") === "" && T.brandWall("Check www.example.com for prices. Come by!") === "Come by!" && T.brandWall("Write me at carol@shop.ca, ok? Or come by.") === "Or come by.", "…a brand-only text is emptied; www. and e-mail sentences go");
ok(T.brandWall("On est sub-sell, 300 $. Viens.") === "Viens." && T.brandWall("Regarde sur subselltrade . ca pour les prix. Sinon 300 $.") === "Sinon 300 $.", "…sub-sell and a spaced-out domain go too (the review's cases)");
ok(T.brandWall("On est au 757 Beaubien E, 9h à 21h. Tu passes à soir ou demain? iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 450 $ / 550 $.") === "On est au 757 Beaubien E, 9h à 21h. Tu passes à soir ou demain? iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 450 $ / 550 $.", "…an ordinary reply with the address, the hours and a price line is untouched");
ok(T.brandWall("Etc. ça marche, pis le reste aussi. Ok.") === "Etc. ça marche, pis le reste aussi. Ok." && T.brandWall("Le S25 Ultra, 1.5 To, a.m. ou p.m., rdv à 9.30.") === "Le S25 Ultra, 1.5 To, a.m. ou p.m., rdv à 9.30.", "…\"etc. ça\", \"1.5\", \"a.m.\" and \"9.30\" are not addresses");
ok(T.brandWall("Visit https://subselltrade.ca/prix to see them. The 13 is here.") === "The 13 is here." && T.brandWall("") === "", "…a URL sentence goes; empty stays empty");
const base = { apiKey: "k", model: "claude-haiku-4-5", ownerTeachingOnly: true, businessName: "SubSell", businessAddress: "757 Rue Beaubien E", businessHoursText: "9h à 21h", businessInfo: "Shop: Liquidation Téléphone Montréal.", instructions: "Short.", closerGoals: "Come.", examples: "", priceList: "", coaching: [], listings: [], closerMode: true, offPlatformGuard: false };
{ const p = T.buildOwnerPrompt(base);
  ok(!/SubSell/.test(p) && /for the shop described below, writing as the seller/.test(p) && /never another company or brand name, never a website or any web address/.test(p), "the prompt with the old default name: no SubSell, the shop is \"described below\", never another brand or a website");
  const p2 = T.buildOwnerPrompt(Object.assign({}, base, { businessName: "Liquidation Téléphone Montréal" }));
  ok(/for "Liquidation Téléphone Montréal", writing as the seller/.test(p2), "…the owner's name is used when it is the owner's");
  ok(/You never send a video, a photo or a link yourself, and you never promise one/.test(p) && !/\[CLIP\]/.test(p), "no clips uploaded: the bot never sends or promises a video, no [CLIP] token taught");
  const clips = { demoVideoUrls: [{ name: "a.mp4", url: "https://x/a.mp4" }] };
  const pAsked = T.buildOwnerPrompt(Object.assign({}, base, clips));
  ok(/- \[CLIP\] at the very start of a normal reply/.test(pAsked) && /only when the buyer asks to see the phone, a video, photos or more pictures/.test(pAsked) && !/sent to each buyer automatically/.test(pAsked), "clips + videoWhen asked (default): the [CLIP] token is taught, the automatic clip is not");
  const pAlways = T.buildOwnerPrompt(Object.assign({}, base, clips, { videoWhen: "always" }));
  ok(/A short demo video is sent to each buyer automatically/.test(pAlways) && !/\[CLIP\]/.test(pAlways), "clips + always: the pre-.94 sentence");
  const pNever = T.buildOwnerPrompt(Object.assign({}, base, clips, { videoWhen: "never" }));
  ok(/never promise one/.test(pNever) && !/\[CLIP\]/.test(pNever), "clips + never: the bot never sends or promises one");
  ok(/do not claim to be a human/.test(p), "the mechanics still forbid claiming to be a human when a buyer asks");
  ok(!/You are the auto-reply assistant/.test(bg), "the legacy prompt no longer calls itself an assistant"); }
ok(T.parseReply("[CLIP] Oui, je t'envoie une petite vidéo là.").clip === true && T.parseReply("[CLIP] Oui, je t'envoie une petite vidéo là.").text === "Oui, je t'envoie une petite vidéo là." && T.parseReply("Oui [CLIP] voilà").clip === true && !T.parseReply("Oui.").clip, "[CLIP] is a silent prefix (leading or mid-text), stripped, recorded");
ok(T.parseReply("[CLIP: vidéo] Oui je t'envoie ça").kind === "text" && T.parseReply("[CLIP: vidéo] Oui je t'envoie ça").clip === true && T.parseReply("Oui [CLIP: la vidéo] voilà").text === "Oui voilà", "…\"[CLIP: …]\" is tolerated like [GAP: …] (the review's case)");
(async () => {
  modelText = "Le 14 Pro Max est là. Les prix de rachat sont sur subselltrade.ca. Tu passes à soir?";
  const r1 = await T.writeReply(Object.assign({}, base, { humanTouch: true, replyGuard: true }), "c'est dispo?", "", "", { threadId: "t1" });
  ok(r1.kind === "text" && r1.walled === true && !/subsell/i.test(r1.text) && /14 Pro Max/.test(r1.text) && /Tu passes/.test(r1.text), "writeReply: the website sentence is walled, the rest goes out (" + r1.text + ")");
  modelText = "SubSell, 757 Beaubien. Voir subselltrade.ca.";
  const r2 = await T.writeReply(Object.assign({}, base, { humanTouch: true, replyGuard: true }), "c'est dispo?", "", "", { threadId: "t2" });
  ok(r2.kind === "held" && /brand wall/.test(r2.reason) && r2.walled === true, "…a text that is only brand and link is held, never sent as a fragment");
  modelText = "Oui, encore dispo. On est au 757 Beaubien E, jusqu'à 21h. Tu passes à soir?";
  const r3 = await T.writeReply(Object.assign({}, base, { humanTouch: true, replyGuard: true }), "c'est dispo?", "", "", { threadId: "t3" });
  ok(r3.kind === "text" && !r3.walled && r3.text === "Oui, encore dispo. On est au 757 Beaubien E, jusqu'à 21h. Tu passes à soir?", "…an ordinary reply is not marked walled");

  console.log("\n— 2. the wiring —");
  const theatre = /humanRhythm|typingLive|rhythmNight|burstMin|burstMax|humanTime|humanPlan|typeLive|liveMs|rhythmHold|cadenceDecision|pacedSleep|chatSeed/;
  ok(!theatre.test(bg) && !theatre.test(ct) && !theatre.test(app) && !theatre.test(opt) && !theatre.test(html) && !theatre.test(optHtml) && !theatre.test(ref) && !theatre.test(popupHtml), "no human-mimicry timing anywhere (no rhythm, no live typing, no bursts, no humanTime)");
  ok(/const targetDelayMs = \(settings\.responseDelaySec \|\| 15\) \* 1000 \+ rand\(0, \(settings\.jitterSec \|\| 15\) \* 1000\);/.test(ct) && /const typingMs = typingPaceMs\(reply\.text, settings\);\s*\n\s*const delayMs = Math\.max\(afterClip \? typingMs : 0, targetDelayMs \+ typingMs - \(Date\.now\(\) - replyClockStart\)\);/.test(ct), "the .93 wait is back: delay + jitter + the typing-pace sleep");
  ok(/async function typeAndSend\(el, text\) \{/.test(ct) && /await typeAndSend\(composerNow, reply\.text\);/.test(ct) && /\n\s*setWhole\(\);\s*\n\s*await sleep\(350\);\s*\n\s*if \(norm\(composerText\(el\)\) !== norm\(want\)\) \{\s*\n\s*setWhole\(\); \/\/ one clean retry/.test(ct), "typeAndSend pastes the whole reply once, verified, as before");
  ok(/function cadenceAfterReply\(settings\) \{\s*\n\s*const ms = cadenceBreakMs\(settings\);/.test(bg), "the break after a reply is the .86 roll (cadenceBreakMs)");
  ok(/<label>Response delay \(s\)<\/label>/.test(html) && /<label>Jitter \(s\)<\/label>/.test(html) && /Response delay: <span id="delayVal"><\/span>s/.test(popupHtml), "the delay boxes carry their .93 names (Response delay, Jitter)");
  ok(/if \(settingsOk\) \{ \/\/ a settings hiccup falls through to the retry queue below, never to a dropped set\s*\n\s*const when = String\(\(sCfg && sCfg\.videoWhen\) \|\| "asked"\);\s*\n\s*if \(when === "never"\) \{ clearPend\(\); vstat\("videos: off/.test(ct) && /if \(!wanted\[id\] && !\(sidebarKey && wanted\[sidebarKey\]\) && !manual\) \{ clearPend\(\); vstat\("clip waits until this buyer asks to see it/.test(ct), "maybeSendVideo: the clip waits for an ask unless videoWhen is always; never = off; a settings hiccup keeps the retry");
  ok(/if \(reply\.clip === true \|\| \(memoOk && memo && memo\.clip === true\) \|\| asksForClip\(turn\.buyerMessage\)\) await markVideoWanted\(id, sidebarId\);/.test(ct) && /await markVideoWanted\(id, null\); \/\/ \(v0\.21\.94\) a manual send is an ask\s*\n\s*await maybeSendVideo\(id, nm, true, id\);/.test(ct), "…a [CLIP] reply, the buyer's own words or the popup's manual send earn the clip");
  { const re = between(ct, "  const ASKS_CLIP_RE = ", ";\n");
    const rx = new Function("return " + re.slice("  const ASKS_CLIP_RE = ".length))();
    ok(rx.test("je peux voir une vidéo?") && rx.test("t'as des photos?") && rx.test("can you send me some pics") && rx.test("montre-moi le téléphone") && !rx.test("je veux voir le 13 pro en magasin demain") && !rx.test("sur les photos de l'annonce l'écran a une rayure") && !rx.test("c'est combien?"), "asksForClip: a request for a video / photos marks the chat; seeing the phone in the shop or the ad's photos does not"); }
  ok(/clip: parsed\.clip === true/.test(bg) && /videoWhen: "asked",/.test(bg) && /videoWhen: "asked",/.test(app) && /videoWhen: "asked",/.test(opt), "the [CLIP] flag reaches the content script; videoWhen defaults to asked in all three DEFAULTS");
  ok(/" clip=" \+ \(settings\.videoWhen \|\| "asked"\)/.test(bg), "🩺 reads clip=");
  ok(/const walledF = brandWall\(ftext\);\s*\n\s*if \(ftext && !walledF\) \{ sendResponse\(\{ ok: true, skip: true, reason: "brand wall/.test(bg) && !/skip: true, held: true, reason: "brand wall/.test(bg), "a follow-up naming SubSell or carrying a link is a plain skip (the skip cap retires the chat), not a budget hold");
  ok(/businessName: "",/.test(bg) && /businessName: "",/.test(app) && /businessName: "",/.test(opt), "the developer default name is empty in all three DEFAULTS");
  ok(/id="videoWhen"/.test(html) && /\["videoWhen", "value"\]/.test(app), "the dashboard has the Send-the-clip box");
  ok(!/id="humanTimeMaxSec"/.test(html) && !/id="visitConfirmEnabled"/.test(html) && !/id="visitConfirmEnabled"/.test(optHtml), "the human-time and visit-confirm boxes are gone from the UIs");
  ok(ref.includes("`videoWhen`") && /box removed in v0\.21\.94/.test(ref), "SETTINGS-REFERENCE documents videoWhen and the removed boxes");
  ok(/mirrors shopNameFor\(\) in background\.js/.test(app) && /for the shop described below, writing as the seller/.test(app) && !/You are the auto-reply assistant/.test(app) && /sub\[\\s-\]\?sell/.test(app), "the dashboard's teaching preview mirrors the name rule (hyphen included)");
  ok(/\(held back, nothing sent: " \+ \(p\.reason \|\| /.test(app), "the dashboard's Try-it shows a held reply's real reason");
  ok(!/SubSell/.test(manifest.name) && manifest.name.length <= 45 && manifest.version === "0.21.94", "manifest: no SubSell in the name (" + manifest.name + "), v0.21.94");
  ok(!/SubSell/.test(popupHtml) && !/SubSell/.test(html) && !/SubSell/.test(optHtml), "no SubSell in the popup, the dashboard or the Options page");
  ok(/seed\.js\?v=20261110/.test(html) && /app\.js\?v=20261110/.test(html), "both dashboard cache-busters moved");
  const seedAt = bg.indexOf("const SEED_CONFIG = {");
  const seedSrc = bg.slice(seedAt, bg.indexOf("\n};", seedAt) + 3);
  ok(/demoVideoUrls: \[\],/.test(seedSrc) && !/subsell|website|review|google|garantie|warranty|2017/i.test(seedSrc) && /Liquidation Téléphone Montréal/.test(seedSrc), "the seed carries no clips, no SubSell, no website, no reviews, no warranty terms");
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
