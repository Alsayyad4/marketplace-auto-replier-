/* (v0.21.73) THE OWNER IS THE ONLY TEACHER — everything that release claims, run
 * against the real code sliced out of background.js, content.js and docs/app.js:
 *
 *   1. the default prompt is built from the owner's text plus mechanics only: no
 *      playbook, no phrasebook, no business fact the owner never wrote, and an
 *      empty Instructions / Closer-goals box yields a neutral line — never the
 *      DEFAULTS text standing in for it;
 *   2. a lesson the owner gave for THIS buyer message (Activity tab) is put beside
 *      the message in the user turn, narrowly matched;
 *   3. the chat's own title ("Name · listing headline") is not a buyer message and
 *      not a line of the conversation — in the page reader (a fake Messenger DOM)
 *      and at the background's second wall — and a dedupe key written before the
 *      change is still recognised (the update never re-answers a chat);
 *   4. the teaching code a computer reports equals the code the dashboard computes
 *      for the row it saved (same function in both files, same DEFAULTS);
 *   5. a dashboard save that loses the race merges instead of dropping;
 *   6. the "which computers answer with this teaching" status is right.
 *
 * Run:  node store/smoke-teach.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const cs = fs.readFileSync(path.join(root, "content.js"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
const BS = String.fromCharCode(92); // one backslash
const SEP = String.fromCharCode(1); // the dedupe-key separator

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b, keepEnd) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " → " + b); process.exit(1); }
  return src.slice(s, keepEnd ? e + b.length : e);
}
const count = (text, needle) => text.split(needle).length - 1;

/* ---------------- background.js: the prompt, the lesson, the title wall, the code ---------------- */
const PB_END = '].join("' + BS + 'n");';
const bgDefaults = new Function(between(bg, "const DEFAULTS = {", "\n};", true) + "\nreturn DEFAULTS;")();
let captured = null;
const fakeFetch = async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }; };
const B = new Function(
  "DEFAULTS", "fetch",
  between(bg, "const SALES_PHRASEBOOK = [", PB_END, true) + "\n" +
  between(bg, "function ownerWroteOf(", "\nfunction getSettings()") + "\n" +
  between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "\n/* Static FR/EN Quebec sales phrasebook") + "\n" +
  between(bg, "function trimContext(", "\n// (v0.21.68) The model has no clock") + "\n" +
  between(bg, "function nowLine(", "\nasync function callClaude(") + "\n" +
  between(bg, "async function callClaude(", "\n/* ---------------- smart follow-up") + "\n" +
  between(bg, "async function callClaudeFollowup(", "\n/* ---------------- reply token parsing") + "\n" +
  "return { buildSystemPrompt, buildOwnerPrompt, lessonFor, isChatTitle, dropTitleLines, teachingFingerprint, teachCanon, ownerWroteOf, coachIsRule, callClaude, callClaudeFollowup, OWNER_FALLBACK_TONE, OWNER_FALLBACK_CLOSE };"
)(bgDefaults, fakeFetch);

const base = {
  businessName: "SubSell", businessAddress: "757 Rue Beaubien E", businessHoursText: "9AM–9PM, 7 days",
  businessInfo: "WARRANTY: 6 months on every phone.\nPAYMENT: cash or Interac at the shop.\nTRADE-IN: yes, valued in person.",
  instructions: "Short, casual, tutoiement. Always ask which model they want.",
  closerMode: true, closerIntensity: "medium", noExactPrices: true, offPlatformGuard: true,
  closerGoals: "Bring them to the shop to test the phone in their hands.",
  priceList: "", examples: "", listings: [], coaching: [], model: "claude-haiku-4-5",
};
const withWrote = (cfg) => {
  const s = Object.assign({}, bgDefaults, cfg);
  Object.defineProperty(s, "ownerWrote", { enumerable: false, value: B.ownerWroteOf(cfg) });
  return s;
};

(async () => {
  console.log("\n— 1. the default prompt is the owner's text plus mechanics, nothing else —");
  const p = B.buildSystemPrompt(base);
  ok(!("ownerTeachingOnly" in base) && bgDefaults.ownerTeachingOnly === true, "the switch is a NEW key and ships ON (a changed default would be shadowed by the stored row)");
  ok(!p.includes("MASTER CLOSER PLAYBOOK") && !p.includes("PHRASEBOOK") && !p.includes("HOW TO CLOSE — turn this chat"), "no built-in sales playbook, no phrasebook");
  const invented = ["used-iPhone reseller", "Laval", "Rive-Sud", "liquidation", "LIQUIDATION", "Samsung", "first come, first served", "10%", "arrives daily", "changes daily", "nos clients", "Tu passes aujourd'hui ou demain"];
  const leaked = invented.filter((w) => p.includes(w));
  ok(leaked.length === 0, "no business fact or canned sales line the owner never wrote" + (leaked.length ? " — LEAKED: " + leaked.join(", ") : ""));
  ok(count(p, "Interac") === 1, "a fact the owner DID write appears exactly once — theirs (" + count(p, "Interac") + ")");
  const iInfo = p.indexOf("<owner_business_info>"), iInfoEnd = p.indexOf("</owner_business_info>");
  ok(iInfo > 0 && p.indexOf("WARRANTY: 6 months on every phone.") > iInfo && p.indexOf("TRADE-IN: yes, valued in person.") < iInfoEnd, "business info is there verbatim, inside its own tagged section");
  ok(p.indexOf("<owner_instructions>") > iInfoEnd && p.includes("Always ask which model they want."), "instructions follow, verbatim, tagged");
  ok(p.includes("<owner_closing_goal>") && p.includes("Bring them to the shop to test the phone in their hands."), "the owner's own closing goal is the closing section");
  ok(p.includes("Everything you know about this business is what its owner wrote") && p.includes("do not guess"), "the contract: the owner's text is all it knows; a gap is never filled by a guess");
  ok(p.includes("Say you would rather confirm it at the shop than tell them something wrong") && p.includes("do not stretch a line beyond what it says") && p.includes("Give no reason of your own for not knowing"), "an uncovered question gets an honest way out: no invention, no stretched line, no made-up reason");
  ok(p.includes("You are not told which post the buyer is writing from") && p.includes("a post's title is an advert, not a stock list"), "the model is told it does not know the post, and that a headline is not stock");
  ok(p.includes("do not claim to be a human") && !p.includes("You are just the human seller"), "it stays in role without claiming to be human when asked");
  ok(B.buildSystemPrompt(Object.assign({}, base)) === p, "same settings → byte-identical prompt");
  console.log("        (owner-only prompt for this config: ~" + Math.ceil(p.length / 3.5) + " est. tokens)");
  ok(B.buildSystemPrompt(Object.assign({}, base, { ownerTeachingOnly: false })).includes("MASTER CLOSER PLAYBOOK"), "switch OFF → the built-in playbook prompt is still there (smoke-prompt.js locks it)");

  console.log("\n— rules and corrections —");
  const longRule = "Never quote the exact price in chat, always say à partir de and bring them to the shop. " + "x".repeat(400) + " END-OF-RULE";
  const coached = Object.assign({}, base, { coaching: [
    { kind: "bad", buyer: "(general rule from the boss)", bad: "", better: longRule, note: "always applies", at: 1 },
    { kind: "good", buyer: "Still available?", reply: "ouais toujours dispo, tu cherches quel modèle?", at: 2 },
    { kind: "fix", buyer: "Do you ship?", bad: "Yes we ship anywhere!", better: "en personne seulement, viens le tester au shop", note: "never offer shipping", at: 3 },
  ] });
  const pc = B.buildSystemPrompt(coached);
  const iRules = pc.indexOf("<owner_rules>"), iCorr = pc.indexOf("<owner_corrections>"), iMech = pc.indexOf("What you receive with each message");
  ok(pc.indexOf("</owner_business_info>") < iRules && iRules < iCorr && iCorr < iMech, "order: business info → instructions → rules → corrections → mechanics");
  ok(pc.includes("- " + longRule.slice(0, 60)) && pc.includes("END-OF-RULE") && !pc.includes("(general rule from the boss)"), "a 500-char standing rule is an order, uncut, with no fake buyer");
  ok(pc.includes('Buyer: "Still available?" Approved answer: "ouais toujours dispo, tu cherches quel modèle?"'), "👍 renders as an approved answer");
  ok(pc.includes('Buyer: "Do you ship?" Rejected answer: "Yes we ship anywhere!" Correct answer: "en personne seulement, viens le tester au shop" Lesson: never offer shipping'), "👎 renders as rejected → correct, with its lesson");
  ok(!pc.slice(iCorr).includes("END-OF-RULE"), "the rule is not repeated among the corrections");
  ok(!p.includes("<owner_rules>") && !p.includes("<owner_corrections>"), "no lessons → no empty sections");

  console.log("\n— an empty box is a neutral line, never this file's DEFAULTS text —");
  ok(bgDefaults.instructions.includes("Never discount more than 10%") && bgDefaults.closerGoals.includes("liquidation"), "(the DEFAULTS texts do carry claims the owner never wrote — the reason for this rule)");
  const blank = withWrote({ businessName: "SubSell", businessInfo: "WARRANTY: 6 months.", closerMode: true });
  const pb = B.buildSystemPrompt(blank);
  ok(blank.instructions === bgDefaults.instructions, "(getSettings still merges DEFAULTS under the config, as before)");
  ok(pb.includes("Tone (a default, until the owner writes instructions): " + B.OWNER_FALLBACK_TONE) && !pb.includes("<owner_instructions>"), "empty Instructions → the neutral tone line");
  ok(!pb.includes("Never discount more than 10%") && !pb.includes("Quote prices from the listings"), "…and the DEFAULTS instructions text is NOT in the prompt");
  ok(pb.includes("Closing (a default, until the owner writes a goal): " + B.OWNER_FALLBACK_CLOSE) && !pb.includes("<owner_closing_goal>") && !pb.includes("liquidation"), "empty Closer goals → the neutral closing line, no built-in claims");
  const none = withWrote({ businessName: "SubSell" });
  ok(B.buildSystemPrompt(none).includes("(The owner has not written any business information yet.)") && !B.buildSystemPrompt(none).includes("Cash or e-transfer"), "empty Business info → said plainly, DEFAULTS text not used");
  const written = withWrote({ businessInfo: "X", instructions: bgDefaults.instructions, closerGoals: "MY GOAL", closerMode: true });
  ok(B.buildSystemPrompt(written).includes("<owner_instructions>\n" + bgDefaults.instructions) && B.buildSystemPrompt(written).includes("MY GOAL"), "a box that DOES hold text is the owner's, whatever the text (it is visible in the dashboard)");

  console.log("\n— the owner's switches still decide —");
  const L1 = [{ title: "iPhone 13", storage: "128", condition: "A", price: 400 }, { title: "Galaxy S23", available: false }];
  const pNo = B.buildSystemPrompt(Object.assign({}, base, { listings: L1 }));
  ok(pNo.includes("keeps exact prices out of the chat") && pNo.includes("- iPhone 13 | 128 | A | available: yes") && !pNo.includes("$400"), "Never quote prices ON, no price list → the rule is stated and listings carry no price");
  const pPl = B.buildSystemPrompt(Object.assign({}, base, { listings: L1, priceList: "iPhone 13: $400" }));
  ok(pPl.includes("<owner_starting_prices>\niPhone 13: $400") && !pPl.includes("keeps exact prices out of the chat") && pPl.includes("| $400 CAD |"), "a price list → starting prices are shared, listings show prices");
  const pFree = B.buildSystemPrompt(Object.assign({}, base, { listings: L1, noExactPrices: false }));
  ok(!pFree.includes("keeps exact prices out of the chat") && pFree.includes("| $400 CAD |") && pFree.includes("| available: no"), "Never quote prices OFF → no price rule, listings show prices and availability");
  const pOff = B.buildSystemPrompt(Object.assign({}, base, { closerMode: false }));
  ok(!pOff.includes("owner_closing_goal") && !pOff.includes("Closing (a default") && !pOff.includes("stop selling"), "Closer mode OFF → no closing section at all");
  ok(B.buildSystemPrompt(Object.assign({}, base, { closerIntensity: "soft" })).includes("once in the conversation at most") &&
     B.buildSystemPrompt(Object.assign({}, base, { closerIntensity: "master" })).includes("one step closer to coming to the shop in each reply") &&
     p.includes("Not every message needs an invitation"), "closing style soft / balanced / master each change one line, no script");
  ok(p.includes("never write a phone number") && !B.buildSystemPrompt(Object.assign({}, base, { offPlatformGuard: false })).includes("never write a phone number"), "the platform-safety paragraph follows its switch");
  ok(p.includes("say you keep everything here on Messenger") && p.includes("only if they insist after that, return [HUMAN]"), "a first request for a phone number gets an answer; only insistence is handed to the owner");
  ok(B.buildSystemPrompt(Object.assign({}, base, { examples: "Buyer: allo\nYou: salut, tu cherches quoi?" })).includes("<owner_examples>\nBuyer: allo"), "the owner's example conversations are a tagged owner section");

  console.log("\n— 2. a lesson for THIS message goes beside it —");
  const T = { coaching: [
    { kind: "bad", buyer: "(general rule from the boss)", bad: "", better: "RULE-TEXT", note: "always applies", at: 1 },
    { kind: "good", buyer: "Is this still available?", reply: "ouais toujours dispo, tu cherches quel modèle?", at: 2 },
    { kind: "fix", buyer: "Vous livrez?", bad: "Oui on livre partout!", better: "non, en personne au shop seulement", note: "we never ship", at: 3 },
    { kind: "fix", buyer: "Bonjour, est-ce que cet article est toujours disponible et est-ce que vous pouvez me le garder jusqu'à samedi prochain parce que je travaille toute la sema…", bad: "x", better: "LONG-LESSON", note: "", at: 4 },
    { kind: "good", buyer: "ok", reply: "parfait", at: 5 },
  ] };
  ok(B.lessonFor(T, "Is this still available?").includes('approved this answer to this same kind of message: "ouais toujours dispo, tu cherches quel modèle?"'), "the exact message → its 👍 lesson");
  ok(B.lessonFor(T, "is this STILL available ??").includes("ouais toujours dispo"), "case and punctuation do not matter");
  ok(B.lessonFor(T, "Hi, is this still available?").includes("ouais toujours dispo"), "one extra word still matches (same words, give or take)");
  ok(B.lessonFor(T, "vous livrez").includes("The owner's answer: \"non, en personne au shop seulement\". The lesson: we never ship."), "a 👎 gives the owner's answer and its lesson");
  ok(B.lessonFor(T, "Vous livrèz ?") !== "", "accents do not matter");
  ok(B.lessonFor(T, "Bonjour, est-ce que cet article est toujours disponible et est-ce que vous pouvez me le garder jusqu'à samedi prochain parce que je travaille toute la semaine et je finis tard").includes("LONG-LESSON"), "a long message matches the lesson's stored (cut) beginning");
  ok(B.lessonFor(T, "Is it available in blue?") === "" && B.lessonFor(T, "combien?") === "", "a different question gets NO lesson pushed onto it");
  ok(B.lessonFor(T, "ok").includes("parfait") && B.lessonFor(T, "ok merci") === "", "one- and two-word messages match exactly or not at all");
  ok(!B.lessonFor(T, "(general rule from the boss)").includes("RULE-TEXT"), "a standing rule is never offered as a per-message lesson");
  const T2 = { coaching: [{ kind: "good", buyer: "prix svp?", reply: "OLD", at: 1 }, { kind: "fix", buyer: "prix svp?", bad: "OLD", better: "NEW", note: "", at: 2 }] };
  ok(B.lessonFor(T2, "prix svp?").includes("NEW") && !B.lessonFor(T2, "prix svp?").includes("OLD"), "two lessons on the same message → the later one wins");
  ok(B.lessonFor({}, "x") === "" && B.lessonFor(T, "") === "", "nothing to match → nothing said");
  await B.callClaude(Object.assign({}, base, T, { apiKey: "k" }), "Is this still available?", "Conversation so far (most recent last):\nBuyer: Is this still available?", "MEMORY-LINE");
  let sys = captured.body.system[0], user = captured.body.messages[0].content;
  ok(sys.cache_control && sys.cache_control.type === "ephemeral" && !sys.text.includes("Current local time"), "system prompt keeps cache_control and has no clock");
  const iCtx = user.indexOf("Conversation so far"), iMem = user.indexOf("MEMORY-LINE"), iLes = user.indexOf("The owner approved this answer"), iClock = user.indexOf("Current local time"), iMsg = user.indexOf("Buyer's latest message:\nIs this still available?");
  ok(iCtx === 0 && iCtx < iMem && iMem < iLes && iLes < iClock && iClock < iMsg, "user turn: conversation → memory → the lesson → clock → the buyer's message");
  ok(user.includes("Give that answer now: keep the owner's wording") && !sys.text.includes("Give that answer now"), "the lesson asks for the owner's own wording, and is NOT in the cached system prompt");
  await B.callClaude(Object.assign({}, base, { apiKey: "k" }), "Hello?", "", "");
  ok(/^Current local time: \w+ \d\d:\d\d\.\nBuyer's latest message:\nHello\?$/.test(captured.body.messages[0].content), "no lesson, no memory → the user turn is just the clock and the message");
  await B.callClaudeFollowup(Object.assign({}, base, { apiKey: "k" }), "Buyer: hi\nYou: allo", "X · Y", "");
  user = captured.body.messages[0].content;
  ok(user.includes("one honest reason to come that the owner's text supports") && !user.includes("liquidation") && user.includes("[SKIP]"), "the follow-up nudge may only use a reason the owner wrote");
  await B.callClaudeFollowup(Object.assign({}, base, { apiKey: "k", ownerTeachingOnly: false }), "Buyer: hi\nYou: allo", "X · Y", "");
  ok(captured.body.messages[0].content.includes("liquidation"), "switch OFF → the built-in follow-up wording, as before");

  console.log("\n— 3a. the chat's title at the background's wall —");
  const NAME = "Svargood · S25 ultra S23 ultra iPhone 15 Pro Max liquidation";
  ok(B.isChatTitle(NAME, NAME) && B.isChatTitle("svargood · s25 ultra s23 ultra iphone 15 pro max liquidation", NAME), "the full label is the title (case does not matter)");
  ok(B.isChatTitle("Svargood · S25 ultra S23", NAME) && B.isChatTitle(NAME + " · CA$1", NAME), "…also cut short, or with a suffix");
  ok(!B.isChatTitle("S25 ultra S23 ultra iPhone 15 Pro Max liquidation", NAME) && !B.isChatTitle("Is this still available?", NAME) && !B.isChatTitle("Svargood", NAME), "a headline alone, a real message, a name alone: NOT judged here (a buyer can type those)");
  ok(!B.isChatTitle("John Smith", "John Smith") && !B.isChatTitle("x", ""), "a label without the “·” is never judged here");
  const scrubbed = B.dropTitleLines("You: " + NAME + "\nBuyer: Is this still available?\nBuyer: " + NAME + "\nYou: allo", NAME);
  ok(scrubbed === "Buyer: Is this still available?\nYou: allo", "title lines leave the transcript, whoever they were attributed to");
  ok(B.dropTitleLines("Buyer: hi", "") === "Buyer: hi" && B.dropTitleLines("", NAME) === "", "no name or no transcript → untouched");
  const h = between(bg, 'case "GET_REPLY_SIMPLE": {', 'case "MEMORY_PRESEND": {');
  ok(h.indexOf("isChatTitle(msg.buyerMessage, msg.threadName)") > 0 && h.indexOf("isChatTitle(msg.buyerMessage, msg.threadName)") < h.indexOf("withinBusinessHours(settings)"), "the reply handler refuses a title BEFORE any gate, claim or API call");
  ok(/sendResponse\(\{ ok: true, skip: true, title: true/.test(h) && h.includes("dropTitleLines(msg.context, msg.threadName)") && !/callClaude\([\s\S]{0,200}msg\.context/.test(h), "…and the model only ever gets the scrubbed transcript");
  ok(between(bg, 'case "GET_FOLLOWUP": {', "const ftext").includes("callClaudeFollowup(settings, fctx,"), "the follow-up gets the scrubbed transcript too");

  console.log("\n— 3b. the chat's title in the page reader (a fake Messenger thread) —");
  const readerSrc = between(cs, "  // Things that are NOT chat messages", "  function buyerSpokeLast() {");
  const ROW = { left: 300, right: 900 };
  function makeThread(label, ownEcho) {
    const state = { nodes: [], href: "https://www.messenger.com/marketplace/t/123456/", anchors: [], label };
    const rect = (left, right, top) => ({ left, right, top, bottom: top + 20, width: right - left, height: 20 });
    const row = { getBoundingClientRect: () => rect(ROW.left, ROW.right, 0) };
    const el = (text, left, right, top, paint) => {
      const style = paint === "blue" ? { borderTopLeftRadius: "18px", backgroundColor: "rgb(0, 132, 255)", backgroundImage: "none" }
        : paint === "gray" ? { borderTopLeftRadius: "18px", backgroundColor: "rgb(240, 240, 240)", backgroundImage: "none" }
        : { borderTopLeftRadius: "0px", backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none" };
      const n = { nodeType: 1, innerText: text, textContent: text, _cs: style, parentElement: null,
        querySelector: () => null, closest: (sel) => (sel === '[role="row"]' ? row : null), getBoundingClientRect: () => rect(left, right, top) };
      state.nodes.push(n);
      return n;
    };
    const main = { querySelectorAll: (sel) => (sel.indexOf("img") >= 0 ? [] : state.nodes.slice()) };
    const composer = { getBoundingClientRect: () => rect(ROW.left, ROW.right, 800) };
    const safe = (fn, fb) => { try { return fn(); } catch (e) { return fb; } };
    const normMsg = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();
    const api = new Function(
      "safe", "normMsg", "isOwnEcho", "getMain", "findComposer", "conversationAnchors", "threadId", "anchorName", "location", "getComputedStyle",
      readerSrc + "\nreturn { readConversation, turnFromConvo, labelLike, noteOpenThread, openThreadName };"
    )(safe, normMsg, (t) => !!ownEcho && ownEcho === t, () => main, () => composer, () => state.anchors, (a) => a.id, (a) => a.name, { get href() { return state.href; } }, (n) => n._cs || {});
    if (label) api.noteOpenThread("123456", "123456", label);
    return { state, el, api };
  }
  // A first-contact chat: Messenger's intro block prints the title (wide, unpainted), then the buyer's gray bubble.
  const build = (label) => {
    const t = makeThread(label);
    t.el(NAME, 320, 880, 100, null);
    t.el("Is this still available?", 300, 520, 200, "gray");
    return t;
  };
  const oldRead = build(""); // a build that does not know the chat's label = the read before this release
  const oldConvo = oldRead.api.readConversation();
  const oldTurn = oldRead.api.turnFromConvo(oldConvo, null);
  ok(oldConvo.length === 2 && oldConvo[0].text === NAME && oldTurn.transcript.split("\n")[0] === "You: " + NAME, "(before: the title was read as a line of the chat — \"" + oldTurn.transcript.split("\n")[0].slice(0, 34) + "…\")");
  const newRead = build(NAME);
  const convo = newRead.api.readConversation();
  const turn = newRead.api.turnFromConvo(convo, null);
  ok(convo.length === 1 && turn.buyerMessage === "Is this still available?" && turn.transcript === "Buyer: Is this still available?", "now: the title is gone, the buyer's message is the whole conversation");
  ok(turn.legacyKey === oldTurn.dedupeKey && turn.dedupeKey !== oldTurn.dedupeKey && turn.dedupeKey === SEP + "1" + SEP + "Is this still available?", "the key the older build stored for this message is rebuilt (legacyKey) — already-answered stays answered");
  ok(/lastHandled\[id\] === turn\.dedupeKey \|\| lastHandled\[id\] === turn\.buyerMessage \|\| \(turn\.legacyKey && lastHandled\[id\] === turn\.legacyKey\)/.test(cs), "handleThread accepts today's key, the plain text, or the older build's key");
  // The title leaning left reads as one MORE buyer bubble on an older build (trailing count differs).
  const mk2 = (label) => { const t = makeThread(label); t.el("allo, tu cherches quoi?", 600, 900, 50, "blue"); t.el(NAME, 300, 700, 100, null); t.el("le 15 pro max", 300, 480, 200, "gray"); return t; };
  const o2 = mk2(""), n2 = mk2(NAME);
  const o2t = o2.api.turnFromConvo(o2.api.readConversation(), null), n2t = n2.api.turnFromConvo(n2.api.readConversation(), null);
  ok(o2t.transcript.includes("Buyer: " + NAME) && !n2t.transcript.includes("S25 ultra") && n2t.transcript === "You: allo, tu cherches quoi?\nBuyer: le 15 pro max", "a title that used to read as the BUYER's line is gone too");
  ok(n2t.legacyKey === o2t.dedupeKey && n2t.dedupeKey === "allo, tu cherches quoi?" + SEP + "1" + SEP + "le 15 pro max", "…and its older key (two buyer bubbles counted) is still recognised");
  // The headline alone, the buyer's name above a bubble, a cut title, the headline with a price.
  const t3 = makeThread(NAME);
  t3.el("S25 ultra S23 ultra iPhone 15 Pro Max liquidation", 300, 760, 60, null);
  t3.el("S25 ultra S23 ultra iPhone 15 Pro Max liquidation · CA$1", 300, 780, 80, null);
  t3.el("Svargood", 300, 380, 180, null);
  t3.el("Svargood · S25 ultra S23", 300, 700, 120, null);
  t3.el("combien pour le S25?", 300, 500, 200, "gray");
  const c3 = t3.api.readConversation();
  ok(c3.length === 1 && c3[0].text === "combien pour le S25?" && c3[0].role === "buyer", "the headline alone, with a price, cut short, and the sender's name above a bubble all leave the read");
  // A buyer who really TYPES the headline does it in a painted bubble — kept.
  const t4 = makeThread(NAME);
  t4.el("S25 ultra S23 ultra iPhone 15 Pro Max liquidation", 300, 700, 200, "gray");
  const c4 = t4.api.readConversation();
  ok(c4.length === 1 && c4[0].role === "buyer" && !c4.legacy, "a GRAY bubble with the headline's text is a real buyer message and stays");
  // Our own (painted) bubble with the title's text — sent once by the echo bug — stays ours.
  const t5 = makeThread(NAME);
  t5.el(NAME, 500, 900, 200, "blue");
  ok(t5.api.readConversation()[0].role === "me", "a BLUE bubble with the title's text is our own message and stays");
  // The sidebar names that exact text as the buyer's last message → it stays (confirmed path).
  const t6 = makeThread(NAME);
  t6.el("Svargood", 300, 380, 200, null);
  ok(t6.api.readConversation().length === 0 && t6.api.readConversation({ body: "Svargood", media: false }).length === 1, "what the sidebar attributes to the buyer by name is never dropped");
  // No label known → nothing is judged; the label is found through the sidebar row when handleThread did not open the chat.
  const t7 = makeThread("");
  t7.el(NAME, 320, 880, 100, null);
  ok(t7.api.readConversation().length === 1 && t7.api.openThreadName() === "", "label unknown → nothing is dropped");
  t7.state.anchors = [{ id: "999", name: "Someone else" }, { id: "123456", name: NAME }];
  ok(t7.api.openThreadName() === NAME && t7.api.readConversation().length === 0, "a chat opened by hand takes its label from the sidebar row that links to it");
  const t8 = makeThread(NAME);
  t8.state.href = "https://www.messenger.com/marketplace/t/777/";
  t8.el(NAME, 320, 880, 100, null);
  ok(t8.api.openThreadName() === "" && t8.api.readConversation().length === 1, "the label of the chat opened LAST is not applied to another chat");
  const LL = newRead.api.labelLike;
  ok(!LL("Is this still available?", NAME) && !LL("ok", NAME) && !LL("s25", NAME) && !LL("le S25 ultra est dispo?", NAME) && !LL("liquidation", NAME), "ordinary messages are not title-like (labelLike is narrow by itself)");
  ok(LL("John Smith", "John Smith") && !LL("John", "John Smith") && !LL("hi", "Jo"), "a plain chat's name is title-like only as a whole");
  ok(/reply\.memory === "echo" \|\| reply\.title\)/.test(cs), "a title refused by the background is marked handled (no retry loop)");

  console.log("\n— 4. one teaching code, computed the same way on both sides —");
  const M = new Function(between(app, "/* ==== TEACHING-MIRROR-BEGIN", "/* ==== TEACHING-MIRROR-END ====") + "\nreturn { OWNER_FALLBACK_TONE, OWNER_FALLBACK_CLOSE, coachIsRule, teachCanon, teachingFingerprint };")();
  const appDefaults = new Function(between(app, "const DEFAULTS = {", "\n  };", true) + "\nreturn DEFAULTS;")();
  ok(M.OWNER_FALLBACK_TONE === B.OWNER_FALLBACK_TONE && M.OWNER_FALLBACK_CLOSE === B.OWNER_FALLBACK_CLOSE, "the two neutral lines are identical in the extension and the dashboard");
  const FP_KEYS = ["ownerTeachingOnly", "businessName", "businessAddress", "businessHoursText", "examples", "priceList", "closerMode", "closerIntensity", "noExactPrices", "offPlatformGuard"];
  const drift = FP_KEYS.filter((k) => JSON.stringify(bgDefaults[k]) !== JSON.stringify(appDefaults[k]));
  ok(drift.length === 0, "the DEFAULTS behind the code are identical in both files" + (drift.length ? " — DRIFT: " + drift.join(", ") : ""));
  const fpExt = (row) => { const s = Object.assign({}, bgDefaults, row); return B.teachingFingerprint(s, B.ownerWroteOf(row)); };
  const fpDash = (row) => M.teachingFingerprint(Object.assign({}, appDefaults, row), null);
  const rows = [
    {},
    { businessInfo: "WARRANTY: 6 months.", instructions: "tu", closerGoals: "shop", priceList: "13: $400", examples: "ex" },
    { businessInfo: "only info — instructions and closer goals left empty" },
    { businessInfo: "x", instructions: "   ", closerGoals: "" },
    { businessInfo: "x", listings: [{ title: "iPhone 13", price: 400, available: true }], coaching: [{ kind: "good", buyer: "dispo?", reply: "ouais", at: 5 }] },
    { businessInfo: "x", ownerTeachingOnly: false, closerMode: false, closerIntensity: "master", noExactPrices: false, offPlatformGuard: false },
  ];
  const mism = rows.filter((r) => fpExt(r) !== fpDash(r) || !/^[0-9a-f]{8}$/.test(fpExt(r)));
  ok(mism.length === 0, "extension and dashboard compute the same 8-hex code for " + rows.length + " different rows (incl. empty boxes standing on DEFAULTS text)" + (mism.length ? " — MISMATCH: " + JSON.stringify(mism[0]) : ""));
  const a = { businessInfo: "x", coaching: [{ at: 5, kind: "good", buyer: "dispo?", reply: "ouais" }] };
  const b = { businessInfo: "x", coaching: [{ reply: "ouais", buyer: "dispo?", kind: "good", at: 5 }] };
  ok(fpExt(a) === fpDash(b), "key order inside a lesson does not change the code (Postgres reorders jsonb keys)");
  const r0 = { businessInfo: "x", instructions: "y" };
  const changed = [{ businessInfo: "x2" }, { instructions: "y2" }, { priceList: "p" }, { examples: "e" }, { closerGoals: "g" }, { ownerTeachingOnly: false }, { noExactPrices: false },
    { coaching: [{ kind: "bad", buyer: "(general rule from the boss)", bad: "", better: "r", note: "always applies" }] }, { listings: [{ title: "t" }] }, { businessHoursText: "9-5" }]
    .filter((d) => fpExt(Object.assign({}, r0, d)) === fpExt(r0));
  ok(changed.length === 0, "every teaching field moves the code" + (changed.length ? " — DID NOT: " + JSON.stringify(changed) : ""));
  ok(fpExt(Object.assign({}, r0, { model: "claude-sonnet-4-6", responseDelaySec: 5, apiKey: "k", demoVideoUrls: [{ url: "u" }] })) === fpExt(r0), "…and a setting that is not teaching (model, timing, key, videos) does not");
  ok(/noteTeaching\(settings\);/.test(h) && /getSettings\(\)\.then\(noteTeaching\)/.test(bg) && /action: "teach"/.test(bg) && /"teaching " \+ fp/.test(bg), "the extension reports its code before a reply and after a pull, as a kind \"teach\" row");
  ok(/if \(ok\) await new Promise\(\(r\) => chrome\.storage\.local\.set\(\{ teachSeen:/.test(bg), "…and remembers it only once the row landed (an offline moment is retried)");

  console.log("\n— 5. a save that loses the race merges —");
  const G = new Function(
    "teachCanon", "DEFAULTS", "EXT_DEFAULT_TEXT", "LEGACY_LINK_OFF", "COACH_MAX",
    between(app, "  const cj = (v) =>", "  async function saveMerged(") + "\nreturn { cj, mergeList, mergeOverTheirs, normalizeForSave, trimCoaching };"
  )(M.teachCanon, appDefaults, { businessInfo: 1, instructions: 1, closerGoals: 1 }, { videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "" }, 30);
  const les = (n, extra) => Object.assign({ kind: "good", buyer: "q" + n, reply: "a" + n, at: n }, extra || {});
  const rule = (n) => ({ kind: "bad", buyer: "(general rule from the boss)", bad: "", better: "rule " + n, note: "always applies", at: n });
  const row0 = G.normalizeForSave(Object.assign({}, appDefaults, { apiKey: "sk-real", businessInfo: "INFO", instructions: "TONE", priceList: "", coaching: [les(1), les(2)] }));
  const mine = Object.assign({}, row0, { coaching: [les(1), les(2), rule(9)] }); // here: a rule was taught
  const theirs = Object.assign({}, row0, { instructions: "TONE EDITED ON THE PHONE", priceList: "13: $400", coaching: [les(1), les(2), les(3)] }); // there: text + a lesson
  let m1 = G.mergeOverTheirs(row0, mine, theirs);
  ok(m1.instructions === "TONE EDITED ON THE PHONE" && m1.priceList === "13: $400", "fields this page did not touch keep the other device's values");
  ok(m1.coaching.length === 4 && m1.coaching.some((c) => c.better === "rule 9") && m1.coaching.some((c) => c.buyer === "q3"), "the lesson taught here AND the lesson taught there are both kept");
  ok(m1.apiKey === "sk-real" && m1.businessInfo === "INFO" && m1.videoLinkFallback === false && !("enabled" in m1), "nothing else is lost; the legacy link gate stays off");
  m1 = G.mergeOverTheirs(row0, Object.assign({}, row0, { businessInfo: "INFO EDITED HERE" }), theirs);
  ok(m1.businessInfo === "INFO EDITED HERE" && m1.instructions === "TONE EDITED ON THE PHONE", "a field edited here wins; theirs stands everywhere else");
  m1 = G.mergeOverTheirs(row0, Object.assign({}, row0, { coaching: [les(2)] }), theirs);
  ok(m1.coaching.map((c) => c.buyer).join() === "q2,q3", "a lesson forgotten here stays forgotten; theirs is kept");
  m1 = G.mergeOverTheirs(row0, mine, Object.assign({}, row0, { coaching: [les(2)] }));
  ok(m1.coaching.map((c) => c.buyer).join() === "q2,(general rule from the boss)", "a lesson forgotten there is not resurrected by this page's save");
  const cleared = Object.assign({}, row0); delete cleared.instructions; // the Instructions box emptied here
  m1 = G.mergeOverTheirs(row0, cleared, Object.assign({}, row0, { priceList: "x" }));
  ok(!("instructions" in m1) && m1.priceList === "x", "a box emptied here leaves the key out (never an empty string)");
  m1 = G.mergeOverTheirs(row0, row0, { apiKey: "sk-real", businessInfo: "INFO" }); // their row lacks keys this page's DEFAULTS know
  ok(!("instructions" in m1) && !("closerGoals" in m1) && m1.businessInfo === "INFO", "a key the row never had is not invented as an empty string");
  const many = []; for (let i = 0; i < 29; i++) many.push(les(100 + i));
  m1 = G.mergeOverTheirs(Object.assign({}, row0, { coaching: [] }), Object.assign({}, row0, { coaching: [rule(1), rule(2)] }), Object.assign({}, row0, { coaching: many }));
  ok(m1.coaching.length === 30 && m1.coaching.filter((c) => c.note === "always applies").length === 2, "the 30-lesson cap still evicts graded examples before rules");

  console.log("\n— 6. which computers answer with this teaching —");
  const F = new Function(between(app, "  const machineKey = (m) =>", "  function renderFleet(") + "\nreturn { machineKey, machineShow, fleetStatus };")();
  const NOW = Date.parse("2026-10-05T18:00:00Z");
  const at = (minAgo) => new Date(NOW - minAgo * 60000).toISOString();
  const CHANGED = NOW - 60 * 60000; // the row's own stamp: the teaching last changed an hour ago
  const teach = [
    { created_at: at(2), machine: "Shop PC · v0.21.73 #PC-aaaaa", bot_text: "teaching 11111111" },
    { created_at: at(900), machine: "Shop PC · v0.21.73 #PC-aaaaa", bot_text: "teaching 99999999" },
    { created_at: at(4000), machine: "Laptop · v0.21.73 #PC-bbbbb", bot_text: "teaching 22222222" },
    { created_at: at(300), machine: "Tablet · v0.21.73 #PC-eeeee", bot_text: "teaching 22222222" },
    { created_at: at(30000), machine: "Old Tower · v0.21.73 #PC-ccccc", bot_text: "teaching 22222222" },
    { created_at: at(5), machine: "DASHBOARD TEST", bot_text: "teaching 11111111" },
  ];
  const seen = [
    { created_at: at(1), machine: "Laptop · v0.21.73 #PC-bbbbb" },   // a message 59 min AFTER the change
    { created_at: at(200), machine: "Tablet · v0.21.73 #PC-eeeee" }, // its last message was BEFORE the change
    { created_at: at(3), machine: "Back office · v0.21.52" },
    { created_at: at(8), machine: "PC-ddddd · v0.21.72" },
  ];
  let st = F.fleetStatus(teach, seen, "11111111", NOW, CHANGED);
  ok(st.ok.length === 1 && F.machineShow(st.ok[0].machine) === "Shop PC · v0.21.73", "a computer whose LATEST report is the saved code is up to date");
  ok(st.behind.length === 1 && st.behind[0].key === "pc-bbbbb" && st.behind[0].fp === "22222222", "a computer that SENT A MESSAGE well after the change, still on an older code, is named as behind");
  ok(st.idle.length === 1 && st.idle[0].key === "pc-eeeee", "a computer that has sent nothing since the change is idle, NOT an alarm (asleep, closed, quiet)");
  ok(st.silent.length === 2 && st.silent.some((e) => e.key === "back office") && st.silent.some((e) => e.key === "pc-ddddd"), "computers that send messages but never report are named as old builds");
  ok(!st.ok.concat(st.behind, st.idle, st.silent, st.syncing).some((e) => e.key === "pc-ccccc" || /dashboard/i.test(e.machine)), "a computer silent for a week, and the dashboard's own test row, are left out");
  st = F.fleetStatus(teach, seen, "11111111", NOW, NOW - 5 * 60000);
  ok(st.syncing.length === 2 && st.behind.length === 0 && st.idle.length === 0, "for 12 minutes after a change, a computer on the old code is “picking it up” — cloud sync pulls every minute, the config link every ten");
  st = F.fleetStatus(teach, seen, "22222222", NOW, CHANGED);
  ok(st.ok.length === 2 && st.behind.length === 1 && st.behind[0].key === "pc-aaaaa", "the comparison is against the code of the row in the cloud, whoever saved it");
  ok(F.machineKey("Shop PC · v0.21.73 #PC-aaaaa") === "pc-aaaaa" && F.machineKey("PC-ddddd · v0.21.72") === "pc-ddddd" && F.machineKey("Back office · v0.21.52") === "back office" && F.machineKey("Office PC-main · v0.21.73 #PC-zzzzz") === "pc-zzzzz", "a computer is keyed by its install id when it has one");
  ok(/select\("config, updated_at"\)\.maybeSingle\(\)/.test(between(app, "  async function loadFleet() {", "  /* ---------------- activity log")), "the status line reads the row as it is in the cloud, not this page's copy (another device may have saved)");
  ok(/\.neq\("kind", "teach"\)/.test(app) && count(app, '.neq("kind", "teach")') >= 4, "teaching reports never show up as messages in the Activity feed or its counts");

  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
