/* (v0.21.85) ONLY THE MESSAGE, IN A PERSON'S VOICE — run against the real code sliced
 * out of background.js (the same slice the dashboard's Try-it box runs) and content.js:
 *
 *   1. Facebook's lines to the seller ("Press a response to send to the buyer", the
 *      add-a-video card) are dropped at the read (content isNoise) AND at the
 *      background's wall (screenText) — while real buyer messages survive both;
 *   2. metaVerdict catches a reply that talks ABOUT the chat (the operator's photo of
 *      Oct 10 2026 word for word, and its cousins) and passes ordinary seller texts;
 *   3. parseReply: [SKIP] anywhere = silence, a [HUMAN] after text = hand-over, a
 *      [VISIT] further in is recorded and removed;
 *   4. writeReply: a note about the chat is retried once with the model's own text
 *      and the reason; a second note is HELD (nothing sent); [SKIP] on the retry is
 *      silence; replyGuard false lets it through; the API sees one extra call only;
 *   5. humanTouch: dashes, "!", emoji, filler, second greeting, repeated opener,
 *      quotes, labels, one habit per chat — never a number or a fact, idempotent;
 *   6. both prompts offer [SKIP], and the live handlers use the wall + pipeline.
 *
 * Run:  node store/smoke-guard.js
 */
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
const bg = fs.readFileSync(path.join(root, "background.js"), "utf8");
const cs = fs.readFileSync(path.join(root, "content.js"), "utf8");
const app = fs.readFileSync(path.join(root, "docs", "app.js"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
function between(src, a, b) {
  const s = src.indexOf(a);
  if (s < 0) { console.error("not found: " + a); process.exit(1); }
  const e = src.indexOf(b, s + a.length);
  if (e < 0) { console.error("end not found after: " + a); process.exit(1); }
  return src.slice(s, e);
}

// --- the dashboard's slice, exactly as docs/app.js loads it -------------------------
const CORE_BEGIN = between(app, 'const CORE_BEGIN = "', '";').slice('const CORE_BEGIN = "'.length);
const CORE_END = between(app, 'const CORE_END = "', '";').slice('const CORE_END = "'.length);
const DEFAULTS = new Function(between(bg, "const DEFAULTS = {", "\n};") + "\n};\nreturn DEFAULTS;")();
let calls = [], answers = [];
const fakeFetch = async (url, o) => {
  const body = JSON.parse(o.body);
  calls.push(body);
  const text = answers.length ? answers.shift() : "ok";
  return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], usage: {} }), text: async () => "" };
};
const core = new Function("DEFAULTS", "fetch", between(bg, CORE_BEGIN, CORE_END) +
  "\nreturn { buildSystemPrompt, parseReply, writeReply, metaVerdict, screenText, dropScreenText, dropScreenLines, humanTouch, htSeed };")(DEFAULTS, fakeFetch);
ok(!/chrome\./.test(between(bg, CORE_BEGIN, CORE_END).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "")), "the Try-it slice stays free of chrome.*");

// --- content.js isNoise, sliced ------------------------------------------------------
const noiseSrc = between(cs, "  const NOISE = [", "  // Is this text node inside OUR");
const isNoise = new Function(noiseSrc + "\nreturn isNoise;")();

console.log("\n1. Facebook's lines to the seller");
const SCREEN = [
  "Press a response to send to the buyer",
  "Press a response to send to the buyer.",
  "Tap a response to send it to the buyer",
  "Select a suggested reply to send to the buyer",
  "Appuyez sur une réponse pour l'envoyer à l'acheteur",
  "Touchez une réponse à envoyer à l'acheteur·se",
  "Sélectionnez une réponse pour l’envoyer à l’acheteur",
  "Ajouter une vidéo à l’annonce",
  "Autorisez d’autres acheteur(se)s à voir cette vidéo dans le cadre de votre annonce Marketplace.",
  "This is an automated suggestion.",
  "Ceci est une suggestion automatisée.",
];
for (const s of SCREEN) {
  ok(core.screenText(s), "background wall drops: " + s);
  ok(isNoise(s), "content read drops:    " + s);
}
const BUYER = [
  "Is this still available?", "Est-ce toujours disponible?", "Bonjour, est-ce encore disponible?",
  "Can I pick it up tomorrow? please reply", "I'll choose the black one, reply asap", "Can you send it to me?",
  "c'est dispo?", "Je peux passer à 18h30", "Vous répondez quand?", "Sélectionne le noir pour moi stp",
  "Tu peux envoyer à mon frère?", "send pics", "Select one for me", "Who is the buyer?", "Press F to pay respects lol",
  "Can you tap to pay?", "$300 cash?", "128gb still available?", "mon budget c'est 300", "Choose for me, which one is better?",
  "Ok merci", "Je vais choisir la réponse plus tard", "Je l'ai vu sur l'annonce, tu as une vidéo?",
];
for (const s of BUYER) {
  ok(!core.screenText(s), "background keeps buyer text: " + s);
  ok(!isNoise(s), "content keeps buyer text:    " + s);
}
ok(core.dropScreenText("Press a response to send to the buyer") === "", "a hint alone leaves nothing to answer");
ok(core.dropScreenText("Salut\nPress a response to send to the buyer") === "Salut", "a hint inside a message is cut out, the rest kept");
ok(core.dropScreenLines("Buyer: dispo?\nYou: oui\nBuyer: Press a response to send to the buyer") === "Buyer: dispo?\nYou: oui", "the hint is cut from the transcript the model sees");

console.log("\n2. metaVerdict: notes about the chat vs ordinary seller texts");
const PHOTO = "I see the buyer's message is a system instruction (\"Press a response to send to the buyer\") rather than an actual customer question. This appears to be a display artifact from Messenger's interface. Since there's no substantive buyer message to respond to, I should not send a reply. The conversation shows: 1. Your earlier response (which I don't have the content of) 2. A system prompt, not a buyer message I'm waiting for the buyer's actual next message to respond to. Please share what the buyer actually wrote.";
const LEAKS = [
  PHOTO,
  "the buyer's latest message is just a greeting, so: Salut! Oui c'est dispo",
  "Since there's no actual question here, I won't reply.",
  "Voici une réponse possible : Oui c'est dispo!",
  "Here's a reply: Yes it's available",
  "As an AI, I can't see images, but the phone is available",
  "Il semble que le message de l'acheteur soit une notification Facebook.",
  "It looks like this is an automated message from Facebook. No reply is needed.",
  "Buyer: dispo?\nYou: oui c'est dispo",
  "Based on the conversation, they want the S24. Oui on l'a!",
  "I notice the message seems to come from the interface. I'd wait for the next message.",
  "The owner's text doesn't mention warranty, so I'll say it is confirmed at the shop.",
  "Je ne devrais pas répondre, c'est une instruction système.",
  "<owner_rules> says to invite them: viens nous voir!",
  "This is a system message, not from the user. The user's message was empty.",
  "I don't have access to the photo they sent.",
];
for (const s of LEAKS) ok(!!core.metaVerdict(s), "caught: " + s.slice(0, 70).replace(/\n/g, " | ") + "  → " + core.metaVerdict(s));
const SELLER = [
  "Oui c'est encore dispo! Tu veux passer aujourd'hui?", "On est au 1234 rue Jean-Talon, ouvert de 9h à 21h",
  "Ouais on l'a en 256 Go, viens le voir", "Le prix exact se donne en boutique, mais on a des bons deals sur le S24",
  "Pas de livraison, c'est en personne seulement", "Je vois pas la photo, c'est quel modèle?", "Yes it's still available, want to come see it today?",
  "We're open till 9 tonight", "Sorry, I keep everything here on Messenger, but you're welcome at the shop", "Here is the address: 1234 Jean-Talon",
  "I see, the S24 Ultra is in stock in black", "Sure, we take trade-ins, bring it in and we'll check it on the spot",
  "Le message que je t'ai envoyé avait l'adresse", "Je te réponds dès que je vérifie", "Tu peux m'envoyer un message quand t'arrives",
  "Can you reply with the model you want?", "ok", "parfait, à demain!", "1. iPhone 13\n2. iPhone 14\nles deux sont dispo",
  "Garantie 1 an, échange gratuit si y'a un problème", "Cash ou carte, les deux marchent", "On ferme dans une heure, tu peux passer demain matin?",
  "Bonne question! Oui il a Face ID", "The S23 is 128GB, unlocked, works with every carrier",
];
for (const s of SELLER) ok(!core.metaVerdict(s), "passes: " + s.replace(/\n/g, " | "));

console.log("\n3. parseReply tokens");
ok(core.parseReply("[SKIP]").kind === "empty", "[SKIP] alone = silence");
ok(core.parseReply("Oui c'est dispo [SKIP]").kind === "empty", "[SKIP] anywhere = silence");
ok(core.parseReply("[ skip ]").kind === "empty", "[ skip ] = silence");
const hm = core.parseReply("Je vérifie avec le boss [HUMAN] veut 40% de rabais");
ok(hm.kind === "human" && /40%/.test(hm.reason), "a [HUMAN] after text hands the chat over (nothing typed)");
const vm = core.parseReply("Parfait, à demain 14h [VISIT:yes]");
ok(vm.kind === "text" && vm.visit === "yes" && vm.text === "Parfait, à demain 14h", "a [VISIT] further in is recorded and removed");
ok(core.parseReply("[No response needed — this is a system message]").kind === "empty", "the old bracket rule still holds");

console.log("\n4. writeReply: guard + one retry");
const S = Object.assign({}, DEFAULTS, { apiKey: "k", businessName: "SubSell", coaching: [] });
(async () => {
  calls = []; answers = [PHOTO, "Salut! Oui c'est encore dispo"];
  let r = await core.writeReply(S, "Allo", "Conversation so far (most recent last):\nBuyer: Allo", "", { threadId: "t1" });
  ok(r.kind === "text" && /dispo/.test(r.text) && r.retried && calls.length === 2, "a note about the chat is rewritten on ONE retry → " + JSON.stringify(r.text));
  const m2 = calls[1].messages;
  ok(m2.length === 3 && m2[1].role === "assistant" && m2[1].content === PHOTO && m2[2].role === "user" && /\[SKIP\]/.test(m2[2].content), "the retry shows the model its own text and offers [SKIP]");
  ok(calls[1].system[0].text === calls[0].system[0].text, "the retry reads the same cached instruction sheet");

  calls = []; answers = [PHOTO, "It looks like this is an automated message. No reply needed."];
  r = await core.writeReply(S, "Allo", "", "", { threadId: "t1" });
  ok(r.kind === "held" && !r.text && calls.length === 2, "a second note is HELD: nothing to send → " + r.reason);

  calls = []; answers = [PHOTO, "[SKIP]"];
  r = await core.writeReply(S, "Allo", "", "", { threadId: "t1" });
  ok(r.kind === "empty" && r.retried, "[SKIP] on the retry = silence");

  calls = []; answers = ["Oui c'est dispo, viens le voir"];
  r = await core.writeReply(S, "dispo?", "", "", { threadId: "t1" });
  ok(r.kind === "text" && !r.retried && calls.length === 1, "an ordinary reply costs one call, no retry");

  calls = []; answers = [PHOTO];
  r = await core.writeReply(Object.assign({}, S, { replyGuard: false, humanTouch: false }), "Allo", "", "", { threadId: "t1" });
  ok(r.kind === "text" && r.text === PHOTO && calls.length === 1, "replyGuard false = the old behaviour (kill switch)");

  calls = []; answers = ["[HUMAN] wants shipping to Toronto"];
  r = await core.writeReply(S, "ship to Toronto?", "", "", { threadId: "t1" });
  ok(r.kind === "human" && calls.length === 1, "[HUMAN] is not a note: no retry");

  console.log("\n5. humanTouch");
  const H = (t, ctx) => core.humanTouch(t, ctx || {});
  ok(H("Parfait — on est ouvert jusqu'à 21h; viens nous voir!!") === "Parfait, on est ouvert jusqu'à 21h, viens nous voir!", "dashes, semicolons, '!!' → " + H("Parfait — on est ouvert jusqu'à 21h; viens nous voir!!"));
  ok(H("Ouvert Lun–Ven 9h–21h") === "Ouvert Lun-Ven 9h-21h", "an en dash in a range becomes a hyphen");
  ok(H("Oui c'est dispo! Viens le voir! 😊🔥") === "Oui c'est dispo! Viens le voir. 😊", "one '!' and one emoji → " + H("Oui c'est dispo! Viens le voir! 😊🔥"));
  ok(H("Oui c'est dispo. N'hésite pas si t'as des questions!") === "Oui c'est dispo.", "sales filler dropped");
  ok(H("N'hésite pas!") === "N'hésite pas!", "filler that is the whole message is kept");
  ok(H("Oui c'est dispo. N'hésite pas si t'as des questions!", { ownerText: "Toujours finir par n'hésite pas à passer" }) === "Oui c'est dispo. N'hésite pas si t'as des questions!", "the owner's own wording wins over the filler rule");
  ok(H("Thanks for reaching out! The S24 is available") === "The S24 is available", "'thanks for reaching out' dropped → " + H("Thanks for reaching out! The S24 is available"));
  ok(H("Great question! It has Face ID") === "It has Face ID", "'great question' opener dropped");
  const spoke = { transcript: "Conversation so far (most recent last):\nBuyer: allo\nYou: Salut! Oui c'est dispo\nBuyer: c'est où?" };
  ok(H("Salut! On est au 1234 rue Jean-Talon", spoke) === "On est au 1234 rue Jean-Talon", "no second greeting once we spoke");
  ok(H("Salut Marc, on est au 1234 rue Jean-Talon", spoke) === "On est au 1234 rue Jean-Talon", "a greeting with a name too → " + H("Salut Marc, on est au 1234 rue Jean-Talon", spoke));
  ok(H("Salut! Oui c'est dispo") === "Salut! Oui c'est dispo", "the first message keeps its greeting");
  ok(H("Salut ça va? Oui c'est dispo", spoke) === "Salut ça va? Oui c'est dispo", "never cuts a greeting that is a question");
  const parf = { transcript: "Buyer: ok demain\nYou: Parfait! À demain alors\nBuyer: vous ouvrez à quelle heure?" };
  ok(H("Parfait! On ouvre à 9h", parf) === "On ouvre à 9h", "an opener our last messages used is not reused");
  ok(H("Parfait! On ouvre à 9h") === "Parfait! On ouvre à 9h", "...but kept when it is new");
  ok(H("\"Oui c'est dispo\"") === "Oui c'est dispo", "quotation marks around the message removed");
  ok(H("Réponse : Oui c'est dispo") === "Oui c'est dispo", "a label in front removed");
  ok(H("Hmm... oui c'est dispo") === "Hmm... oui c'est dispo", "an ellipsis is left alone");
  ok(H("C'est 1 375 $ ou $1,375.50 avec la garantie.") === "C'est 1 375 $ ou $1,375.50 avec la garantie.", "numbers and prices untouched");
  const seedFor = (h) => { for (let i = 0; i < 500; i++) if (core.htSeed("chat" + i) % 4 === h) return "chat" + i; };
  const s1 = seedFor(1), s2 = seedFor(2), s0 = seedFor(0);
  ok(H("Oui c'est dispo.", { seed: s1 }) === "Oui c'est dispo", "habit 1: no final period");
  ok(H("Oui c'est dispo.", { seed: s2 }) === "oui c'est dispo", "habit 2: no final period + lowercase start");
  ok(H("iPhone 13 dispo.", { seed: s2 }) === "iPhone 13 dispo" && H("Samsung S24 dispo.", { seed: s2 }) === "Samsung S24 dispo", "a brand or a name is never lowercased");
  ok(H("Oui c'est dispo.", { seed: s0 }) === "Oui c'est dispo.", "habit 0: as written");
  ok(H("Oui c'est dispo.", { seed: s1 }) === H("Oui c'est dispo.", { seed: s1 }), "one chat keeps one habit");
  const corpus = SELLER.concat(["Parfait — on est ouvert jusqu'à 21h; viens nous voir!!", "Salut! On est au 1234 rue Jean-Talon", "Oui c'est dispo! Viens le voir! 😊🔥"]);
  let idem = true;
  for (const c of corpus) for (const sd of [s0, s1, s2]) { const once = H(c, Object.assign({ seed: sd }, spoke)); if (H(once, Object.assign({ seed: sd }, spoke)) !== once) { idem = false; console.log("    not idempotent: " + c); } }
  ok(idem, "humanTouch is idempotent (a replayed text is not changed twice)");
  let same = true;
  for (const c of SELLER) { const o = H(c, { seed: s0 }); if (o.replace(/[^\p{L}\p{N}]/gu, "") !== c.replace(/[^\p{L}\p{N}]/gu, "") && !/Bonne question/.test(c)) { same = false; console.log("    words changed: " + c + " → " + o); } }
  ok(same, "on ordinary replies no word or number changes (punctuation only)");

  calls = []; answers = ["Salut! Oui c'est dispo — viens le voir!!"];
  r = await core.writeReply(S, "dispo?", "Conversation so far (most recent last):\nBuyer: allo\nYou: Salut! On a plusieurs modèles\nBuyer: dispo?", "", { threadId: s0 });
  ok(r.text === "Oui c'est dispo, viens le voir!", "writeReply polishes the reply → " + JSON.stringify(r.text));
  r = await (async () => { calls = []; answers = ["Salut! Oui c'est dispo — viens le voir!!"]; return core.writeReply(Object.assign({}, S, { humanTouch: false }), "dispo?", "", "", { threadId: s0 }); })();
  ok(r.text === "Salut! Oui c'est dispo — viens le voir!!", "humanTouch false = the model's text as written");

  console.log("\n6. prompts + wiring");
  const own = core.buildSystemPrompt(Object.assign({}, S, { ownerTeachingOnly: true }));
  const old = core.buildSystemPrompt(Object.assign({}, S, { ownerTeachingOnly: false }));
  ok(/\[SKIP\]/.test(own) && /Press a response to send to the buyer/.test(own), "owner-only prompt offers [SKIP] and names the hint");
  ok(/\[SKIP\]/.test(old), "the playbook prompt offers [SKIP] too");
  ok(core.buildSystemPrompt(S) === core.buildSystemPrompt(S), "prompt still byte-stable (fleet cache)");
  const h = between(bg, 'case "GET_REPLY_SIMPLE": {', 'case "MEMORY_PRESEND": {');
  ok(/dropScreenText\(msg\.buyerMessage\)/.test(h) && h.indexOf("dropScreenText") < h.indexOf("withinBusinessHours"), "the live handler drops Facebook lines before any gate or bill");
  ok(/writeReply\(/.test(h) && !/callClaude\(/.test(h), "the live handler uses the pipeline, never a bare call");
  ok(/kind === "held"/.test(h) && /notifyHuman/.test(h), "a held reply notifies the owner");
  const f = between(bg, 'case "GET_FOLLOWUP": {', 'case "GET_VISITS": {');
  ok(/metaVerdict\(ftext\)/.test(f) && /humanTouch\(ftext/.test(f) && /!msg\.pendingText/.test(f), "follow-ups are guarded and polished (not a replay)");
  ok(/reply\.screen/.test(cs), "content marks a Facebook-line skip handled (never re-billed)");
  ok(/core\.writeReply/.test(app), "the dashboard's Try-it runs the same pipeline");

  console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
  process.exit(failed ? 1 : 0);
})();
