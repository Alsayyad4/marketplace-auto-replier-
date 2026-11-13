// node post29.js <settings.json> <scenarios.json> <outdir> [--v28]
// What each buyer RECEIVES, turn by turn (the extension's own parseReply -> humanTouch -> brandWall -> shopDigits ->
// line breaks flattened), and the v29 checks on it: nothing pasted, no emoji digits, no legal notice, every amount
// a number of the owner's price list (or the buyer's own), the right starting price for the right iPhone, three
// texts at most, the fine print once and never to a seller, CAROL only inside the lower-budget line.
// --v28 = print the transcript only (the v29 checks would all fire on a v28 chat by design).
// Writes <outdir>/transcripts.json = [{ id, listing, turns: [{ buyer, raw, sent, kind }] }].
const fs = require("fs"), path = require("path");
const SRC = "C:/Users/hovig/projects/marketplace-auto-replier/background.js";
const CORE_BEGIN = "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER";
const CORE_END = "/* ---------------- video fetch ---------------- */";
const src = fs.readFileSync(SRC, "utf8");
const a = src.indexOf(CORE_BEGIN), b = src.indexOf(CORE_END, a);
if (a < 0 || b < 0) throw new Error("slice markers not found");
const core = new Function("DEFAULTS", "fetch", src.slice(a, b) + "\nreturn { parseReply, humanTouch, brandWall, shopDigits, ownerTextOf, listingFromTitle };")({}, async () => { throw new Error("no network in post29"); });

const args = process.argv.slice(2);
const v28mode = args.includes("--v28");
const [settingsPath, scenariosPath, outdir] = args.filter((x) => x !== "--v28");
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
const ownerText = core.ownerTextOf(settings);
const flatten = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();
const VS = String.fromCharCode(0xfe0f), KC = String.fromCharCode(0x20e3);

// the iPhone starting prices, from the owner's lines
const IPHONE = {};
for (const line of String(settings.priceList).split("\n")) {
  const m = line.match(/^(?:Série )?iPhone (.+?) : à partir de (.+)$/);
  if (!m) continue;
  const models = m[1].split(" / ").map((s) => s.trim()), nums = (m[2].match(/\d+/g) || []).map(Number);
  models.forEach((name, i) => { IPHONE[name] = nums[i]; });
}
const listNums = new Set((String(settings.priceList).match(/\d+/g) || []).map(Number));
const LOWER_FR = "Inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher aussi, on s'arrange au comptoir, dis juste CAROL en arrivant.";
const LOWER_EN = "Don't worry about the list prices: with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you get here.";
const BAD = /à confirmer|confirme au magasin|confirmer au magasin|en appelant|appelle pour|appelez pour|change avec les arrivages|dépend des arrivages|vérifies sur place|vérifie sur place|tu le vois sur place|on vérifie|se confirme au magasin|to confirm|to be confirmed|check at the shop|verify in person|call to check|exact model you see|availability to confirm|depends on arrivals|stock changes|ça bouge|partent vite|ça rentre|vrais deals|\d+ minutes de|minutes away|google|review|\bavis\b|étoile|subsell|website|\.ca\b|\bétat\b|\bcondition\b|\bconditions\b|\bgrade\b|n'hésite|feel free|let me know|great question|dernier message|last message|three texts|trois textes|je dois y aller|I have to go|gotta go|c'est moi qui réponds|\bmessage\b|plus rapide|faster|je suis là|i'm here|i am here|c'est noté|\bnoted\b|prends ton temps|prenez votre temps|take your time|pas de souci|je te réserve|je te sors|on te sort|je te garde|c'est bon\b|\bparfait[,.]|\bperfect[,.]/i;
const KEYCAP = new RegExp("[0-9#*]" + VS + "?" + KC);
const PASTED = /\d\s?\$\s?\/\s?\d|\s·\s|s'appliquent|conditions apply|Quantités limitées, pas de réservation|Limited quantities, no reservations/i;
const hasFoot = (m) => /premier arriv|first come/i.test(m);
const hasLower = (m) => m.includes(LOWER_FR) || m.includes(LOWER_EN);
const amounts = (t) => [...t.matchAll(/(\d{2,4})\s?\$|\$\s?(\d{2,4})/g)].map((m) => Number(m[1] || m[2]));
const MODEL_RE = () => /\b(XR|XS Max|1[1-7])( Pro Max| Pro)?\b(?![0-9])/gi;
const canon = (a1, a2) => (/^xr$/i.test(a1) ? "XR" : /^xs max$/i.test(a1) ? "XS Max" : a1) + (a2 ? (/max/i.test(a2) ? " Pro Max" : " Pro") : "");
const pairFaults = (t) => {
  const out = []; const re = MODEL_RE(); let m;
  while ((m = re.exec(t))) {
    const model = canon(m[1], m[2]);
    const rest = t.slice(m.index + m[0].length, m.index + m[0].length + 46);
    const stop = rest.search(MODEL_RE());
    const seg = stop >= 0 ? rest.slice(0, stop) : rest;
    const p = seg.match(/(\d{2,4})\s?\$|\$\s?(\d{2,4})/);
    if (p && IPHONE[model] != null && IPHONE[model] !== Number(p[1] || p[2])) out.push(model + " said at " + (p[1] || p[2]) + ", the list says " + IPHONE[model]);
  }
  return out;
};
const listingModel = (thread) => { // "Name · iPhone 15 Pro Max 256 Go 1$" -> "15 Pro Max" (iPhone only)
  const head = String(thread || "").split("·").slice(1).join("·");
  const m = head.match(/iPhone\s+(XR|XS Max|1[1-7])(\s+Pro Max|\s+Pro)?\b/i);
  return m ? canon(m[1], m[2] ? m[2].trim() : "") : "";
};

const transcripts = []; let totalFaults = 0; const lengths = [];
for (const sc of scenarios) {
  const lines = []; const turns = []; const faults = [];
  let missing = false;
  for (let k = 1; k <= sc.turns.length; k++) {
    const pt = path.join(outdir, "replies-" + sc.id + "-t" + k + ".txt");
    if (!fs.existsSync(pt)) { missing = true; break; }
    const raw = fs.readFileSync(pt, "utf8").trim();
    lines.push("Buyer: " + sc.turns[k - 1]);
    const parsed = core.parseReply(raw);
    let sent = "";
    if (parsed.kind === "text") {
      sent = core.humanTouch(parsed.text, { transcript: lines.join("\n"), seed: sc.id, ownerText });
      sent = core.shopDigits(core.brandWall(sent), settings);
      sent = flatten(sent);
    }
    const kind = parsed.kind === "text" ? "text" : parsed.skip ? "skip" : parsed.kind;
    turns.push({ buyer: sc.turns[k - 1], raw, sent, kind, visit: parsed.visit || "", clip: !!parsed.clip, gap: !!parsed.gap });
    if (sent) lines.push("You: " + sent);
  }
  if (missing && !turns.length) continue;
  const texts = turns.filter((t) => t.sent);
  const seller = /vendre|vends|sell my/i.test(sc.turns.join(" "));
  const buyerNums = new Set((sc.turns.join(" ").match(/\d+/g) || []).map(Number));
  const model = listingModel(sc.thread);
  if (!v28mode) {
    if (texts.length > 3) faults.push("more than 3 texts");
    if (texts.filter((t) => hasFoot(t.sent)).length > 1) faults.push("the fine print said twice");
    if ((texts.map((t) => t.sent).join(" ").match(/CAROL/g) || []).length > 1) faults.push("CAROL twice");
    turns.forEach((t, i) => {
      const s = t.sent; if (!s) return;
      lengths.push(s.length);
      const tag = "t" + (i + 1) + ": ";
      if (KEYCAP.test(s)) faults.push(tag + "emoji digits");
      if (PASTED.test(s)) faults.push(tag + "a price line, a list or the notice pasted: " + (s.match(PASTED) || [""])[0]);
      if (BAD.test(s)) faults.push(tag + "banned wording: " + s.match(BAD)[0]);
      if ((s.match(/\?/g) || []).length > 1) faults.push(tag + "two questions");
      if (s.length > (hasFoot(s) || hasLower(s) || t.visit === "yes" ? 430 : 300)) faults.push(tag + "too long: " + s.length);
      if (/CAROL/.test(s) && !hasLower(s)) faults.push(tag + "CAROL outside the lower-budget line");
      if (seller && hasFoot(s)) faults.push(tag + "the fine print to a seller");
      if (/\d{3}[ -]\d{3}[ -]?\d{4}/.test(s) && !/num[ée]ro|number|appeler|\bcall\b|joindre|reach/i.test(sc.turns.slice(0, i + 1).join(" "))) faults.push(tag + "a phone number nobody asked for");
      for (const n of amounts(s)) if (!listNums.has(n) && !buyerNums.has(n)) faults.push(tag + "an amount that is not on the price list: " + n);
      for (const f of pairFaults(s)) faults.push(tag + "wrong price for a model: " + f);
      if (hasFoot(s)) { const parts = s.split(/(?<=[.!?])\s+/); if (/premier arriv|first come|réserv|de côté|\bheld\b|\bhold|quantit/i.test(parts[parts.length - 1] || "")) faults.push(tag + "the fine print is the last sentence"); }
    });
    if (texts.length === 3) { const t3 = texts[2].sent; if (/\?/.test(t3)) faults.push("3rd text asks a question"); if (!/757/.test(t3)) faults.push("3rd text has no address"); }
    const allSent = texts.map((t) => t.sent).join(" ");
    const underBudget = model && [...buyerNums].some((n) => n >= 50 && n < IPHONE[model]); // a budget under their model: the models that fit it instead
    if (model && texts.length && !seller && !underBudget && !new RegExp("\\b" + IPHONE[model] + "\\b").test(allSent)) faults.push("the starting price of the " + model + " (" + IPHONE[model] + " $) is never said");
    // a Samsung whose group has a range on the list: the range is said (both ends), never one number alone
    const head = String(sc.thread || "").split("·").slice(1).join("·");
    const range = /S2[2-5]\s?Ultra/i.test(head) ? [450, 700] : /\bS(22|24)\b|S25\s?FE|S2[235]\s?Plus/i.test(head) ? [140, 300] : /\bA(16|17|26|36|56)\b/i.test(head) ? [90, 140] : null;
    if (range && texts.length && !seller && !(amounts(allSent).includes(range[0]) && amounts(allSent).includes(range[1]))) faults.push("the range of its Samsung group (" + range[0] + " $ to " + range[1] + " $) is never said");
    // the buyer's casing is kept: a lowercase first line gets texts that start lowercase (the lower-budget line excepted)
    const lowerBuyer = /^[a-zà-ÿ]/.test(String(sc.turns[0] || "").trim());
    texts.forEach((t, i) => { let own = t.sent; for (const f of [LOWER_FR, LOWER_EN]) own = own.split(f).join(" "); const first = own.replace(/^[^A-Za-zÀ-ÿ]+/, "")[0] || ""; if (lowerBuyer && first !== first.toLowerCase()) faults.push("t" + (turns.indexOf(t) + 1) + ": a capitalized text to a lowercase buyer"); });
    // the buyer's language: an English message gets an English text, a French one a French text
    const FRW = /\b(le|la|les|est|pis|avec|on est|au|aux|des|une|un|vous|tu|ton|votre|oui|pour|ça|c'est|à partir de|jusqu'à)\b/gi, ENW = /\b(the|is|are|you|your|we|we're|it's|at|and|with|yes|no|for|from|starts?|open|till|by|bring|get|got)\b/gi;
    const lang = (x) => { const f = (String(x).match(FRW) || []).length, e = (String(x).match(ENW) || []).length; return f > e ? "fr" : e > f ? "en" : ""; };
    turns.forEach((t, i) => { if (!t.sent) return; const b = lang(t.buyer), r = lang(t.sent.split(LOWER_FR).join(" ").split(LOWER_EN).join(" ").split("rue Beaubien E").join(" ")); if (b && r && b !== r) faults.push("t" + (i + 1) + ": answered in " + (r === "fr" ? "French" : "English") + " to a buyer writing " + (b === "fr" ? "French" : "English")); });
    const tu = /\b(tu|ton|ta|tes|t'as|t'es|toi)\b/i.test(allSent.split(LOWER_FR).join(" ")), vous = /\b(vous|votre|vos)\b/i.test(allSent);
    if (tu && vous) faults.push("tu and vous in the same chat");
  }
  totalFaults += faults.length;
  transcripts.push({ id: sc.id, listing: (String(sc.thread || "").split("·")[1] || "").trim() || "(no listing: someone selling)", turns, faults });
  console.log("\n=== " + sc.id + " | " + (sc.thread || "") + (model ? " | list: " + model + " = " + IPHONE[model] + " $" : ""));
  turns.forEach((t, i) => { console.log("  Buyer: " + t.buyer); console.log("  Shop : " + (t.sent || "(" + t.kind + ": nothing sent)") + (t.visit ? "   [visit:" + t.visit + "]" : "") + (t.clip ? "   [clip]" : "") + (t.gap ? "   [gap]" : "") + (t.sent ? "   {" + t.sent.length + "}" : "")); });
  for (const f of faults) console.log("  FAULT: " + f);
}
fs.writeFileSync(path.join(outdir, "transcripts.json"), JSON.stringify(transcripts, null, 2));
const mean = lengths.length ? Math.round(lengths.reduce((x, y) => x + y, 0) / lengths.length) : 0;
console.log("\n" + JSON.stringify({ chats: transcripts.length, texts: lengths.length, meanChars: mean, maxChars: lengths.length ? Math.max(...lengths) : 0, faults: totalFaults }));
