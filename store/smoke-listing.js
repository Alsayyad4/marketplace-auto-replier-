/* (v0.21.88) WHICH LISTING THE BUYER IS WRITING FROM — WITHOUT ITS PRICE, and the
 * owner's own entry for that item — run against the real code sliced out of
 * background.js and docs/app.js.
 *
 * Why this file exists: the owner (Oct 19 2026): "check the headline of what the
 * customer is looking for but not the price … at least it answers knowing what the
 * customer is asking for … make sure all the learning tabs also being learnt". Since
 * .73 the chat's title was not given to the model at all, so "is it available?" got
 * "which model?". Now the headline, prices out, is in the user turn as the item, it
 * is the key into the Listings rows and the price-list lines, and a lesson about
 * another model is never offered for this one.
 *
 * Under test:
 *   1. listingFromTitle: the headline after "Buyer ·", every price shape removed
 *      (650$, $650, CA$ 1,099.00, 1 099 $, 650 dollars, prix: 650, tx incl), storage
 *      and model numbers kept, the sidebar time tag out, no "·" → "";
 *   2. modelKeys / sameModel: 13 Pro ≠ 13 Pro Max, S24 Ultra = Galaxy S24 Ultra,
 *      storage mismatch noted, a text with no number never matches one with one;
 *   3. ownerEntryFor: the Listings row for the item (same storage + available first),
 *      the price-list lines for that model, prices hidden under noExactPrices;
 *   4. listingContext: the line, the entry, the "no entry → no price, [GAP]" line;
 *   5. callClaude: the lines sit in the USER turn (after the memory, before the
 *      lesson, before the clock), the system prompt is unchanged by them, no
 *      threadName → nothing added; the follow-up call carries them too;
 *   6. lessonFor with an item: a lesson about another model is left out, a lesson
 *      tied to an item applies only on that item, general lessons still apply, the
 *      listing's words count as the message's subject;
 *   7. the prompt sentence, the corrections' "(about the listing …)", the plumbing
 *      (writeReply → callClaude, GET_REPLY_SIMPLE → writeReply);
 *   8. the dashboard: the mirror of listingFromTitle is byte-identical, the gap list
 *      keys by listing and names it, lessons carry `item` where the question is about
 *      the item, the Try-it box passes the listing, the preview says so.
 *
 * Run:  node store/smoke-listing.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "docs", "index.html"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a + " → " + b); process.exit(1); }
  return src.slice(s, e);
}

/* ---------------- the real functions ---------------- */
// The real postClaude runs (it sits between nowLine and callClaude), on a fake fetch
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
  between(bg, "async function callClaudeFollowup(", "\n/* ---------------- reply token parsing") + "\n" +
  "return { listingFromTitle, stripPrices, modelKeys, sameModel, ownerEntryFor, listingContext, lessonClash, lessonFor, buildOwnerPrompt, callClaude, callClaudeFollowup };"
)({ apiKey: "", model: "claude-haiku-4-5", businessInfo: "", instructions: "", closerGoals: "" }, fakeFetch);
ok(!/function postClaude\(/.test(between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "\nfunction buildOwnerPrompt(")), "(harness) the teacher slice defines no postClaude of its own");

console.log("— 1. the headline, prices out —");
const T = (s) => B.listingFromTitle(s);
ok(T("Dreamliner · iPhone 13 Pro Max 256 Go 650$") === "iPhone 13 Pro Max 256 Go", "650$ removed, storage kept — " + T("Dreamliner · iPhone 13 Pro Max 256 Go 650$"));
ok(T("Marc · iPhone 15 128GB $899 CAD comme neuf") === "iPhone 15 128GB comme neuf", "$899 CAD removed, the words after it kept — " + T("Marc · iPhone 15 128GB $899 CAD comme neuf"));
ok(T("Sarah · Samsung S24 Ultra 512 Go, prix: 1 099 $, négociable") === "Samsung S24 Ultra 512 Go", "prix: 1 099 $ removed (thousands with a space), and the advert's \"négociable\" with it — " + T("Sarah · Samsung S24 Ultra 512 Go, prix: 1 099 $, négociable"));
ok(T("Buyer · iPhone 13 128 Go garantie 1 an URGENT 450$ nég") === "iPhone 13 128 Go" && T("Ali · iPhone 15 Pro, prix ferme 900$, non négociable!") === "iPhone 15 Pro" && T("Buyer · Galaxy S23 for sale cheap OBO $400") === "Galaxy S23", "advert words (warranty claim, urgent, nég, prix ferme, non négociable, for sale, cheap, OBO) leave with the price, punctuation left behind too — " + T("Buyer · iPhone 13 128 Go garantie 1 an URGENT 450$ nég") + " / " + T("Ali · iPhone 15 Pro, prix ferme 900$, non négociable!"));
ok(T("Buyer · iPhone 13 Pro Max 256 Go noir sidéral batterie 92%") === "iPhone 13 Pro Max 256 Go noir sidéral batterie 92%", "identity words (colour, battery) stay");
// (review) a price written BEFORE the storage used to eat the storage and leave the price
ok(T("Marc · iPhone 13 650$ 128 Go") === "iPhone 13 128 Go" && T("Marc · iPhone 13 650$ 128GB noir") === "iPhone 13 128GB noir" && T("Marc · iPhone 13 650 $ 128 Go") === "iPhone 13 128 Go",
   "price before the storage: the price goes, the storage stays — " + T("Marc · iPhone 13 650$ 128 Go") + " / " + T("Marc · iPhone 13 650$ 128GB noir"));
ok(T("Marc · iPhone 13 650$ 1 To") === "iPhone 13 1 To" && T("Marc · iPhone 13 650$ 5G") === "iPhone 13 5G" && T("Marc · iPhone 13 1 099,99 $ 128 Go") === "iPhone 13 128 Go",
   "…also before 1 To, 5G and after a 1 099,99 $ — " + T("Marc · iPhone 13 650$ 1 To") + " / " + T("Marc · iPhone 13 650$ 5G") + " / " + T("Marc · iPhone 13 1 099,99 $ 128 Go"));
ok(T("Marc · iPhone 13 650$ 2 ans garantie") === "iPhone 13" && T("Buyer · iPhone 13 garantie 2 ans 650$") === "iPhone 13", "a warranty claim before or after its duration leaves");
ok(T("Buyer · iPhone 13 650-700$") === "iPhone 13" && T("Buyer · iPhone 13 650 à 700$") === "iPhone 13" && T("Buyer · iPhone 13 C$650") === "iPhone 13" && T("Buyer · iPhone 13 650 C$") === "iPhone 13" && T("Buyer · iPhone 13 650€") === "iPhone 13" && T("Buyer · iPhone 13 650 tx incl") === "iPhone 13" && T("Buyer · iPhone 13 650$ tx incl") === "iPhone 13",
   "ranges, C$, €, tx incl — " + [T("Buyer · iPhone 13 650-700$"), T("Buyer · iPhone 13 C$650"), T("Buyer · iPhone 13 650 tx incl")].join(" / "));
ok(T("Buyer · iPhone 13 Pro · 128 Go · 650$") === "iPhone 13 Pro · 128 Go" && T("Marc · S8") === "S8" && T("Buyer · iPhone 13 à vendre 650$") === "iPhone 13", "a trailing dot-separator goes, a two-letter model stays, \"à vendre\" leaves — " + T("Buyer · iPhone 13 Pro · 128 Go · 650$") + " / " + T("Marc · S8") + " / " + T("Buyer · iPhone 13 à vendre 650$"));
ok(T("Jean · iPhone 12 64GB CA$ 1,099.00") === "iPhone 12 64GB", "CA$ 1,099.00 removed — " + T("Jean · iPhone 12 64GB CA$ 1,099.00"));
ok(T("Buyer · 650$ iPhone 13") === "iPhone 13", "a price in front — " + T("Buyer · 650$ iPhone 13"));
ok(T("Buyer · iPhone 13 650 dollars ferme") === "iPhone 13", "650 dollars removed (and \"ferme\", a haggling word) — " + T("Buyer · iPhone 13 650 dollars ferme"));
ok(T("Buyer · iPhone SE 2022 64 Go 250$") === "iPhone SE 2022 64 Go", "a year is not a price; 64 Go survives beside a removed 250$ — " + T("Buyer · iPhone SE 2022 64 Go 250$"));
ok(T("Buyer · Galaxy S23 128GB 450 $ CAD") === "Galaxy S23 128GB", "450 $ CAD removed — " + T("Buyer · Galaxy S23 128GB 450 $ CAD"));
ok(T("Buyer · iPhone 11 $450 128 Go") === "iPhone 11 128 Go", "a price BEFORE the storage does not eat the storage — " + T("Buyer · iPhone 11 $450 128 Go"));
ok(T("Ali +1 other · Pixel 8 Pro 128 Go 1 To") === "Pixel 8 Pro 128 Go 1 To", "no price → unchanged, group label handled — " + T("Ali +1 other · Pixel 8 Pro 128 Go 1 To"));
ok(T("Buyer · iPhone 13 · 2h") === "iPhone 13", "the sidebar's time tag is not part of the headline");
ok(T("Just a name") === "" && T("") === "" && T(null) === "" && T("· $650") === "", "no 'Buyer ·' label, or nothing but a price → no listing");
ok(B.stripPrices("iPhone 14 Plus 256 Go 1,099.00 $ - noir") === "iPhone 14 Plus 256 Go - noir", "1,099.00 $ in the middle — " + B.stripPrices("iPhone 14 Plus 256 Go 1,099.00 $ - noir"));

console.log("\n— 2. the model's identity —");
const same = (a, b) => B.sameModel(B.modelKeys(a), B.modelKeys(b));
ok(same("iPhone 13 Pro Max 256 Go", "iPhone 13 Pro Max | 256GB").same && same("iPhone 13 Pro Max 256 Go", "iPhone 13 Pro Max | 256GB").storageMatch, "13 Pro Max 256 = 13 Pro Max 256GB");
ok(!same("iPhone 13 Pro Max 256 Go", "iPhone 13 Pro").same && !same("iPhone 13", "iPhone 13 Pro").same, "13 Pro Max ≠ 13 Pro ≠ 13");
ok(same("iPhone 13 Pro Max 256 Go", "iPhone 13 Pro Max 128").same && !same("iPhone 13 Pro Max 256 Go", "iPhone 13 Pro Max 128").storageMatch, "same model, other storage: same but noted");
ok(same("Samsung S24 Ultra", "Galaxy S24 Ultra 256").same, "Samsung S24 Ultra = Galaxy S24 Ultra");
ok(!same("iPhone 13", "Galaxy S23").same && !same("iPhone 14", "iPhone 15").same, "another number is another model");
ok(!same("combien?", "iPhone 13").same && !same("iPhone", "iPhone 13").same, "a text with no model number never matches one");
ok(same("Pixel 4a 128 Go", "Google Pixel 4a").same && same("iPhone 16e", "iphone 16e 128gb").same, "4a and 16e are model numbers");
ok(B.modelKeys("iPhone 15 1 To").storage === "1" && B.modelKeys("iPhone 15 1 To").digits.has("15") && !B.modelKeys("iPhone 15 1 To").digits.has("1"), "\"1 To\" is storage, not a model number");
// (review) specs, grades, durations, counts and prices are not model numbers
ok(same("Samsung Galaxy S23 Ultra 5G 256GB", "Samsung S23 Ultra").same, "5G is not a model number: the Galaxy S23 Ultra 5G finds the S23 Ultra row");
ok(same("iPhone 13 pro 128gb 9/10", "iPhone 13 Pro").same && same("iPhone 13 garantie 1 an", "iPhone 13").same && same("iPhone 13 2 ans garantie", "iPhone 13").same && same("iPhone 13 x2", "iPhone 13").same, "9/10, 1 an, 2 ans, x2 are not model numbers");
ok(same("iPhone 13 128 Go", "iPhone 13 à partir de 99 $").same && same("iPhone 13 Pro Max 256 Go noir sidéral batterie 92%", "iPhone 13 Pro Max 256GB").storageMatch, "a price in a price-list line and a battery % are not model numbers");
ok(same("iPhone SE 2022", "iPhone SE").same && same("Apple Watch SE", "Apple Watch SE").same && same("Nintendo Switch OLED", "Nintendo Switch").same, "models without a number match their own row (SE 2022 = SE, Switch OLED = Switch)");
ok(!same("Nintendo Switch OLED", "Nintendo Switch Lite").same && !same("iPhone SE", "iPhone").same && !same("iPhone SE", "iPhone 13").same, "…but not a contradicting variant, the bare brand, or a numbered model");

console.log("\n— 3. the owner's own entry —");
const S = {
  listings: [ // the 256 row FIRST: a later row must not win on order alone
    { title: "iPhone 13 Pro Max", storage: "256GB", condition: "A+", price: 650, available: true },
    { title: "iPhone 13 Pro Max", storage: "128GB", condition: "A", price: 600, available: true },
    { title: "iPhone 13 Pro", storage: "256GB", condition: "A", price: 520, available: true },
    { title: "iPhone 15", storage: "128GB", condition: "A", price: 899, available: false },
  ],
  priceList: "iPhone 13: à partir de 400$\niPhone 13 Pro Max: à partir de 600$\nSamsung S24 Ultra: à partir de 900$",
  noExactPrices: true,
};
let e = B.ownerEntryFor(S, "iPhone 13 Pro Max 256 Go");
ok(e.listing && e.listing.price === 650 && e.storageMatch, "the row with the same storage wins — " + (e.listing && e.listing.storage));
ok(e.priceLines.length === 1 && e.priceLines[0] === "iPhone 13 Pro Max: à partir de 600$", "the price-list line for 13 Pro Max, not the one for 13 — " + JSON.stringify(e.priceLines));
e = B.ownerEntryFor(S, "iPhone 13 Pro Max 512 Go");
ok(e.listing && /^iPhone 13 Pro Max$/.test(e.listing.title) && !e.storageMatch, "no 512 row → a 13 Pro Max row, with the storage mismatch noted");
e = B.ownerEntryFor(S, "iPhone 15 128 Go");
ok(e.listing && e.listing.available === false && e.priceLines.length === 0, "an unavailable row is still the entry (the model is told available: no)");
e = B.ownerEntryFor(S, "iPhone 14 Plus");
ok(!e.listing && e.priceLines.length === 0, "a model the owner never entered → no entry");
e = B.ownerEntryFor({ listings: S.listings, noExactPrices: true }, "iPhone 13 Pro Max 256 Go");
ok(e.hidePrices === true, "noExactPrices with no price list → the entry's price is hidden");
ok(B.ownerEntryFor(S, "iPhone 13").priceLines.length === 1 && B.ownerEntryFor(S, "iPhone 13").priceLines[0].startsWith("iPhone 13:"), "\"iPhone 13\" gets the iPhone 13 line only");

console.log("\n— 4. the lines the model gets —");
let c = B.listingContext(S, "Dreamliner · iPhone 13 Pro Max 256 Go 650$");
ok(c.startsWith('The buyer is writing from this listing: "iPhone 13 Pro Max 256 Go".') && !c.includes("650$"), "the listing line, price out — " + c.split("\n")[0]);
ok(c.includes('The owner\'s own entry for this item: "iPhone 13 Pro Max | 256GB | A+ | $650 CAD | available: yes".'), "the owner's row beside it, with the owner's price");
ok(c.includes('The owner\'s price-list line for this model: "iPhone 13 Pro Max: à partir de 600$" (starting prices'), "and the owner's price-list line");
c = B.listingContext(S, "Buyer · iPhone 14 Plus 128 Go 700$");
ok(c.includes("have no row for this exact model: take no price from the title") && c.includes("otherwise say it is confirmed at the shop") && c.includes("[GAP]"), "no entry → no price from the title, and a [GAP] so the owner is asked");
c = B.listingContext({ listings: S.listings, noExactPrices: true }, "Buyer · iPhone 13 Pro Max 256 Go 650$");
ok(c.includes('"iPhone 13 Pro Max | 256GB | A+ | available: yes"') && !c.includes("$650"), "noExactPrices → the entry shows availability, no price");
c = B.listingContext(S, "Buyer · iPhone 13 Pro Max 512 Go 700$");
ok(c.includes("a different storage than the listing"), "a storage mismatch is said");
c = B.listingContext(Object.assign({}, S, { priceList: S.priceList + "\niPhone 15: à partir de 850$" }), "Ali · iPhone 15 128GB $899");
ok(c.includes("available: no") && c.includes("the owner marks it unavailable: say so plainly, give no price for it") && !c.includes("à partir de 850$"), "an item the owner marked unavailable: said plainly, and no starting price beside it");
ok(c.includes("anything else it claims is advert wording, not a fact") && c.includes("when the buyer names another model, answer about the one they name"), "the listing line says the title is only the item's identity, and yields to a model the buyer names");
// (review) no row, but the owner taught a price in a lesson or in prose: no contradiction, no [GAP]
c = B.listingContext(S, "Buyer · iPhone 14 Plus 128 Go 700$", { hasLesson: true });
ok(c.includes("take no price from the title") && c.includes("or the lesson beside this message") && !c.includes("[GAP]"), "no row + a lesson beside the message: the lesson may give the price, no [GAP] asked");
c = B.listingContext(S, "Buyer · iPhone 14 Plus 128 Go 700$", { followup: true });
ok(!c.includes("[GAP]") && c.includes("take no price from the title"), "the follow-up decision never gets the [GAP] instruction (a leading token would be read as 'skip')");
ok(B.listingContext(S, "Just a name") === "" && B.listingContext(S, "") === "", "no listing → nothing");

console.log("\n— 5. the user turn —");
(async () => {
  const base = { apiKey: "k", model: "claude-haiku-4-5", businessName: "SubSell", businessAddress: "757", businessHoursText: "9-21", listings: S.listings, priceList: S.priceList,
    coaching: [{ kind: "good", buyer: "Is this still available?", reply: "ouais toujours dispo", at: 1 }] };
  await B.callClaude(base, "Is this still available?", "Conversation so far (most recent last):\nBuyer: Is this still available?", "MEMORY-LINE", undefined, "Dreamliner · iPhone 13 Pro Max 256 Go 650$");
  let body = captured.pop();
  let u = body.messages[0].content;
  ok(u.includes('The buyer is writing from this listing: "iPhone 13 Pro Max 256 Go"') && !u.includes("650$"), "the listing line is in the user turn, price out");
  ok(u.indexOf("MEMORY-LINE") < u.indexOf("The buyer is writing from") && u.indexOf("The buyer is writing from") < u.indexOf("The owner approved this answer") && u.indexOf("The owner approved this answer") < u.indexOf("Current local time"), "order: memory, listing, lesson, clock");
  ok(u.includes("$650 CAD") && u.includes("à partir de 600$"), "the owner's entry and price line are there");
  ok(!body.system[0].text.includes("iPhone 13 Pro Max 256 Go") && body.system[0].text.startsWith("SYSTEM-SHEET"), "the system prompt does not carry the listing (it stays cached)");
  await B.callClaude(base, "Is this still available?", "", "");
  u = captured.pop().messages[0].content;
  ok(!u.includes("writing from this listing") && u.includes("Buyer's latest message:"), "no threadName → nothing added (a chat with no post, the Options test box)");
  await B.callClaudeFollowup(base, "Buyer: allo\nYou: salut", "Buyer · iPhone 13 Pro Max 256 Go 650$", "");
  u = captured.pop().messages[0].content;
  ok(u.includes('The buyer is writing from this listing: "iPhone 13 Pro Max 256 Go"') && u.includes("$650 CAD"), "the follow-up decision knows the item too");
  await B.callClaudeFollowup(Object.assign({}, base, { ownerTeachingOnly: false }), "Buyer: allo\nYou: salut", "Buyer · iPhone 13 Pro Max 256 Go 650$", "");
  ok(captured.pop().messages[0].content.includes("writing from this listing"), "…in the playbook mode as well");
  await B.callClaudeFollowup(base, "Buyer: allo\nYou: salut", "Marc · iPhone 14 Plus 128 Go 700$", "");
  ok(!captured.pop().messages[0].content.includes("[GAP]"), "a follow-up on an unlisted model carries no [GAP] instruction");
  // (review) no row, but a lesson with the price: the turn carries the lesson and no [GAP] clause
  const base14 = Object.assign({}, base, { coaching: [{ kind: "good", buyer: "combien?", reply: "600 pour le 14 plus", item: "iPhone 14 Plus 128 Go", at: 1 }] });
  await B.callClaude(base14, "combien?", "", "", undefined, "Marc · iPhone 14 Plus 128 Go 700$");
  u = captured.pop().messages[0].content;
  ok(u.includes("or the lesson beside this message") && !u.includes("[GAP]") && u.includes("600 pour le 14 plus"), "unlisted model + the owner's price lesson: the lesson answers, no [GAP] asked");
  // (review) a unit the owner marked gone: a general "still available" lesson is not taught on it
  const baseGone = Object.assign({}, base, { coaching: [{ kind: "good", buyer: "Is this still available?", reply: "ouais toujours dispo", at: 1 }] });
  await B.callClaude(baseGone, "Is this still available?", "", "", undefined, "Ali · iPhone 15 128GB $899");
  u = captured.pop().messages[0].content;
  ok(u.includes("the owner marks it unavailable") && !u.includes("ouais toujours dispo"), "on an unavailable unit the 'still available' lesson stays out");
  await B.callClaude(baseGone, "Is this still available?", "", "", undefined, "Dreamliner · iPhone 13 Pro Max 256 Go 650$");
  ok(captured.pop().messages[0].content.includes("ouais toujours dispo"), "…and is taught as usual on an available one");

  console.log("\n— 6. lessons and the item —");
  const L = { coaching: [
    { kind: "good", buyer: "combien?", reply: "650 pour le 13 pro max", item: "iPhone 13 Pro Max 256 Go", at: 1 },
    { kind: "good", buyer: "combien pour le iphone 14?", reply: "le 14 c'est 500", at: 2 },
    { kind: "fix", buyer: "Do you ship?", bad: "Yes!", better: "non, en personne au shop seulement", note: "", at: 3 },
    { kind: "good", buyer: "le 13 pro max est dispo?", reply: "oui le 13 pro max est là", at: 4 },
  ] };
  ok(B.lessonFor(L, "combien?", "iPhone 13 Pro Max 256 Go").includes("650 pour le 13 pro max"), "a lesson tied to this listing applies on this listing");
  ok(!B.lessonFor(L, "combien?", "iPhone 15 128 Go").includes("650 pour le 13 pro max") && !B.lessonFor(L, "combien?", "iPhone 15 128 Go").includes("le 14 c'est 500"), "on another listing: neither the 13 Pro Max lesson nor the iPhone 14 one");
  ok(!B.lessonFor(L, "combien?").includes("650 pour le 13 pro max") && !B.lessonFor(L, "combien?").includes("Give that answer now"), "with no listing known, an item-bound lesson is not applied (a general price lesson may still be offered softly)");
  ok(B.lessonFor(L, "vous livrez?", "iPhone 15 128 Go").includes("non, en personne au shop seulement"), "a general lesson applies on any listing");
  ok(!B.lessonFor(L, "vous livrez?", "iPhone 13 Pro Max 256 Go").includes("650 pour le 13 pro max"), "the item alone never drags a price lesson into a delivery question (the subject must come from the message)");
  ok(B.lessonFor(L, "dispo?", "iPhone 13 Pro Max 256 Go").includes("oui le 13 pro max est là"), "the listing's words count as the subject: \"dispo?\" on the 13 Pro Max recalls the 13 Pro Max lesson");
  ok(!B.lessonFor(L, "dispo?", "iPhone 15 128 Go").includes("oui le 13 pro max est là"), "…and not on the 15");
  ok(B.lessonClash({ buyer: "combien pour le iphone 14?" }, "combien?", "iPhone 13 Pro Max") === true && B.lessonClash({ buyer: "Do you ship?" }, "combien?", "iPhone 13 Pro Max") === false, "lessonClash: another model's number clashes, no number never does");

  console.log("\n— 7. the prompt and the plumbing —");
  const p = B.buildOwnerPrompt(Object.assign({}, base, { coaching: L.coaching }));
  ok(p.includes("you are also told which listing the buyer is writing from (its title, with the price removed)") && p.includes("never from the title, which is an advert and not a stock list") && !p.includes("You are not told which post"), "the sheet says the listing is given, and the title is no price");
  ok(p.includes('- Buyer: "combien?" (about the listing "iPhone 13 Pro Max 256 Go") Approved answer: "650 pour le 13 pro max"'), "a lesson tied to an item says so in the corrections");
  ok(/const r = await callClaude\(settings, buyerMessage, extraContext, memory, undefined, opts\.threadName\);/.test(bg) && /callClaude\(settings, buyerMessage, extraContext, memory, \{ bad: raw \}, opts\.threadName\)/.test(bg), "writeReply passes the chat's label to both calls");
  ok(/\{ threadId: msg\.threadId, threadName: msg\.threadName \}/.test(bg), "GET_REPLY_SIMPLE passes the label to writeReply");
  ok(/const listing = listingContext\(settings, threadName, \{ followup: true \}\);/.test(between(bg, "async function callClaudeFollowup(", "\n/* ---------------- reply token parsing")), "the follow-up call builds the listing line, in follow-up mode");
  const core = between(bg, "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER", "/* ---------------- video fetch ---------------- */");
  ok(core.includes("function listingFromTitle(") && core.includes("function listingContext(") && !/\bchrome\.(storage|runtime|tabs|alarms|downloads|scripting|notifications|debugger)\b/.test(core), "the new helpers live in the dashboard's Try-it slice and use no chrome.* API");

  console.log("\n— 8. the dashboard —");
  const mirrorApp = between(app, "/* ==== LISTING-MIRROR-BEGIN", "/* ==== LISTING-MIRROR-END ==== */");
  const mirrorBg = between(bg, "const PRICE_AMOUNT = String.raw", "\n// A model's identity");
  const strip = (s) => s.replace(/^\s*\/\*.*$/gm, "").replace(/^\s+/gm, "").replace(/\s*\/\/.*$/gm, "").trim();
  ok(strip(mirrorApp) === strip(mirrorBg), "docs/app.js carries the same listingFromTitle as background.js (indentation and comments aside)");
  const A = new Function(mirrorApp + "; return listingFromTitle;")();
  ok(["Dreamliner · iPhone 13 Pro Max 256 Go 650$", "Sarah · Samsung S24 Ultra 512 Go, prix: 1 099 $, négociable", "Buyer · iPhone 13 · 2h", "x"].every((t) => A(t) === T(t)), "…and it answers the same");
  const G = new Function("listingFromTitle", between(app, "  const gapKey = ", "\n  const GAP_DISMISS") + "\n" + between(app, "  function gapList(", "\n  let gapRows = []") + "; return { gapList, itemBound };")(A);
  const rows = [
    { buyer_text: "combien?", bot_text: "[GAP]…", thread_name: "A · iPhone 13 Pro Max 256 Go 650$", created_at: "2026-10-19T10:00:00Z" },
    { buyer_text: "combien?", bot_text: "[GAP]…", thread_name: "B · iPhone 15 128 Go 899$", created_at: "2026-10-19T10:01:00Z" },
    { buyer_text: "Combien ?", bot_text: "[GAP]…", thread_name: "C · iPhone 13 Pro Max 256 Go 650$", created_at: "2026-10-19T10:02:00Z" },
    { buyer_text: "vous livrez?", bot_text: "[GAP]…", thread_name: "D · iPhone 13 Pro Max 256 Go 650$", created_at: "2026-10-19T10:03:00Z" },
  ];
  let gl = G.gapList(rows, [], []);
  ok(gl.length === 3 && gl[0].item === "iPhone 13 Pro Max 256 Go" && gl[0].n === 2 && gl.some((x) => x.item === "iPhone 15 128 Go"), "one box per question AND listing: \"combien?\" twice on the 13 Pro Max, once on the 15 — " + gl.map((x) => x.question + "|" + x.item + "|" + x.n).join(" ; "));
  gl = G.gapList(rows, [{ kind: "fix", buyer: "combien?", better: "650", item: "iPhone 13 Pro Max 256 Go" }], []);
  ok(gl.length === 2 && !gl.some((x) => x.item === "iPhone 13 Pro Max 256 Go" && x.question === "combien?"), "taught for the 13 Pro Max → that box goes, the 15's stays");
  gl = G.gapList(rows, [{ kind: "fix", buyer: "combien?", better: "en personne", item: "" }], []);
  ok(gl.length === 1 && gl[0].question === "vous livrez?", "an answer given without a listing covers every listing");
  ok(G.itemBound("combien?", "650", "iPhone 13") && G.itemBound("c'est dispo?", "oui", "iPhone 13") && G.itemBound("quelle couleur?", "noir", "iPhone 13") && !G.itemBound("vous livrez?", "non", "iPhone 13") && !G.itemBound("combien?", "650", ""), "a lesson is tied to the item only for questions about the item");
  ok(!G.itemBound("vous êtes ouvert dimanche?", "oui de 10h à 17h", "iPhone 13") && !G.itemBound("c'est quoi l'adresse?", "757 rue Beaubien Est", "iPhone 13") && !G.itemBound("garantie?", "oui 1 an", "iPhone 13") && G.itemBound("ok merci", "650$ cash au shop", "iPhone 13"),
     "(review) a digit in the ANSWER (hours, address, warranty) does not tie a general lesson to the item; a price in the answer does");
  ok(/item: itemBound\(it\.question, a, it\.item\) \? truncTxt\(it\.item, 120\) : ""/.test(app), "Teach it stores the item with the lesson");
  ok(/kind: "good", buyer: truncTxt\(r\.buyer_text, 200\), reply: truncTxt\(r\.bot_text, 300\), item: itemBound\(r\.buyer_text, r\.bot_text, rowItem\)/.test(app) && /item: itemBound\(r\.buyer_text, better, rowItem\)/.test(app), "👍 and a correction on the Activity tab carry the listing when the question is about the item");
  ok(/\(a\.item \|\| ""\) === \(item\.item \|\| ""\)/.test(app), "two lessons that differ only by listing are two lessons");
  ok(/select\("created_at, buyer_text, bot_text, thread_name"\)/.test(app), "the gap list reads the listing from the row");
  ok(/id="tryListing"/.test(html) && /threadName: tryName/.test(app) && /const CORE_VER = "20261019"/.test(app), "Try it has a listing box, passes it, and fetches the new core");
  ok(/which listing the buyer is writing from \(the post's title, with the price taken out\)/.test(app), "the teaching preview tells the owner");
  ok(/about: \$\{truncTxt\(c\.item, 40\)\}/.test(app) && /\(about the listing "\$\{one\(c\.item, 80\)\}"\)/.test(bg), "the lesson list and the sheet show the listing a lesson is tied to");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
