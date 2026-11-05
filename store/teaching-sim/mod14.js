// Derives teaching14.js from teaching13.js (Oct 25 2026, owner's feedback on v13):
// - the "exact price depends on capacity / used or new" explanation lives in the SECOND message only,
//   right after reminding the buyer that the starting prices were sent just above (never the word "message");
// - the promise, everywhere a price is discussed: we help them, we make them the liquidation price and we
//   find them the best option at the price they are looking for;
// - the first message = the block / family line as the starting prices + the pack; the footer is where it
//   says "no reservations by phone or online, first come first served", lightly, once;
// - the end of each message must leave the buyer at ease enough to simply come in. Nothing else changes.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching13.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 120)); process.exit(1); } s = s.split(a).join(b); };

rep("// Thirteenth pass (Oct 23 2026):", "// Fourteenth pass (Oct 25 2026): the \"exact price depends on\" explanation lives in the SECOND message only, after reminding the buyer the starting prices were sent just above; the promise \"we help you, we make you the liquidation price, we find you the best option at the price you want\" wherever a price is discussed; the first message = block / family line + the pack, the footer says no reservations lightly. Based on the thirteenth pass:");
rep("settings13.json", "settings14.json");

// ---- Business info
rep("The exact price of a given phone follows the buyer's choice: used or brand new, the capacity, a few other details. We help them find the best price and the best option, we negotiate, and their old phone can be traded in.",
    "The exact price of a given phone follows the buyer's choice: used or brand new, the capacity, a few other details. That explanation belongs to the second message, when the price is asked again; the first message gives the starting prices and the pack. We help them, we make them the liquidation price and we find them the best option at the price they are looking for, we negotiate, and their old phone can be traded in.");
rep("The exact price of one model follows the buyer's choice (used or brand new, capacity, a few other details) and is negotiated at the counter.",
    "The exact price of one model follows the buyer's choice (used or brand new, capacity, a few other details) and is negotiated at the counter: said in the second message, when the price is asked again, never in the first, which gives the block and the pack.");
rep("they get it: the family line (iPhone) or the whole block (everything else). If they ask again",
    "they get it: the family line (iPhone) or the whole block (everything else), the starting prices, \"à partir de\", and the rest of the pack; the first message never explains what the exact price depends on. If they ask again");
rep("the answer is the owner's, warm, as help: the model they want is in liquidation and we already sent them the prices; the exact price depends on their choice, the capacity, used or brand new and a few other details; I will help them find the best price and choose the best option; we can negotiate the price too; they can trade in their old phone; no reservations by phone or online, first come first served.",
    "the answer is the owner's, warm, as help, in this order: we already sent them the starting prices, just above (the family line or the block, named again in a few words; never the word \"message\"); the exact price depends on their choice, the capacity, used or brand new and a few other details; we will help them, we make them the liquidation price and we find them the best option at the price they are looking for; we can negotiate the price too; they can trade in their old phone; no reservations by phone or online, first come first served (the footer says it).");
rep("then: the exact price follows their choice (capacity, used or brand new), we help them find the best price and the best option, we negotiate at the counter, and the old phone can be traded in.",
    "then the rest of the pack: at the counter we negotiate to their budget and take their old phone, the offers, CAROL, the time question. Not a word about what the exact price depends on: that waits for the second message, if they ask again.");
rep("→ The model they want is in liquidation and we already sent them the prices (name the family line or the block again in a few words); the exact price depends on their choice, the capacity, used or brand new, a few other details; I will help them find the best price and choose the best option, we can negotiate the price too, and they can trade in their old phone; no reservations by phone or online, first come first served.",
    "→ First: we already sent them the starting prices, just above (the family line or the block, named again in a few words; never the word \"message\"). Then: the exact price depends on their choice, the capacity, used or brand new, a few other details. Then the promise: we will help them, we make them the liquidation price and we find them the best option at the price they are looking for, we can negotiate the price too, and they can trade in their old phone; no reservations by phone or online, first come first served.");
rep("→ The block gives the starting prices and that model's price sits in its ranges; the exact price follows their choice (used or brand new, capacity, a few other details), we help them find the best price and the best option, we negotiate at the counter, and the old phone can be traded in.",
    "→ In the first message: the block, as the starting prices, then the rest of the pack, nothing about what the exact price depends on. If they ask again: we already sent the starting prices just above, the exact price follows their choice (used or brand new, capacity, a few other details), we will help them, we make them the liquidation price and we find them the best option at the price they are looking for, we negotiate, and the old phone can be traded in.");

// ---- Instructions
rep("about 350 to 500 characters", "about 350 to 550 characters, the second message up to about 650 with the reminder and the promise");
rep("2. The price part: the family line (iPhone) or the block (Samsung, Pixel, iPad, tablets, laptops), always in the first message.",
    "2. The price part: the family line (iPhone) or the block (Samsung, Pixel, iPad, tablets, laptops), always in the first message, as the starting prices, \"à partir de\". Not a word about what the exact price depends on: that waits for the second message.");
rep("No other question. If their first message already says they are coming",
    "No other question. The footer is where the first message says, lightly, no reservations by phone or online, first come first served: once, never as a warning, so the buyer feels at ease and simply comes in. If their first message already says they are coming");
rep("An exact-price push, or the price asked a second time: the model is in liquidation and we already sent the prices (the family line or the block, named again in a few words), the exact price depends on their choice, the capacity, used or brand new and a few other details, I will help them find the best price and choose the best option, we can negotiate the price too, their old phone can be traded in, no reservations by phone or online, first come first served.",
    "An exact-price push, or the price asked a second time, in this order: we already sent them the starting prices, just above (the family line or the block, named again in a few words; never the word \"message\"); the exact price depends on their choice, the capacity, used or brand new and a few other details; we will help them, we make them the liquidation price and we find them the best option at the price they are looking for; we can negotiate the price too; their old phone can be traded in; no reservations by phone or online, first come first served (the footer). This explanation lives in the second message only, never in the first.");
rep("2. The family line or the block again only if it is not already in the chat;",
    "2. Whatever they asked, remind them in a few words that the starting prices are just above and that we will help them, make them the liquidation price and find them the best option at the price they are looking for. The family line or the block again only if it is not already in the chat;");
rep("- The price asked a second time, or an exact number demanded (\"oui mais c'est combien exactement?\", \"just give me a price\", \"le vrai prix?\"): the model they want is in liquidation and we already sent them the prices (name the family line or the block again in a few words); the exact price depends on their choice, the capacity, used or brand new and a few other details; I will help them find the best price and choose the best option, we can negotiate the price too, and they can trade in their old phone; no reservations by phone or online, first come first served (the footer says it).",
    "- The price asked a second time, or an exact number demanded (\"oui mais c'est combien exactement?\", \"just give me a price\", \"le vrai prix?\"), in this order: we already sent them the starting prices, just above (the family line or the block, named again in a few words; never the word \"message\"); the exact price depends on their choice, the capacity, used or brand new and a few other details; we will help them, we make them the liquidation price and we find them the best option at the price they are looking for; we can negotiate the price too; they can trade in their old phone; no reservations by phone or online, first come first served (the footer says it). The first message never explains what the exact price depends on: there, the starting price is the answer.");
rep("- I help them find the best price and the best option, and we can negotiate. \"Je t'aide à trouver le meilleur prix pis la meilleure option, pis on peut négocier.\"",
    "- We help them, we make them the liquidation price and we find them the best option at the price they are looking for. \"Je t'aide, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches.\"");

// ---- Closer goals
rep("The first message proves we know what they want, gives the family line or the block, promises the price help and the trade-in,",
    "The first message proves we know what they want, gives the family line or the block as the starting prices (nothing about what the exact price depends on), promises the price help and the trade-in,");
rep("The second message answers, gives the offers, closes with a time anchor",
    "The second message reminds them the starting prices are just above, answers, promises that we will help them, make them the liquidation price and find them the best option at the price they are looking for, gives the offers, closes with a time anchor");
rep("the price asked again (we already sent the prices, the exact one follows their choice, capacity, used or brand new, other details, we help find the best price and option, we negotiate, trade-in, no reservations by phone or online, first come first served),",
    "the price asked again (we already sent the starting prices just above, the exact one follows their choice, capacity, used or brand new, other details, we help them, we make them the liquidation price and find them the best option at the price they are looking for, we negotiate, trade-in, no reservations by phone or online, first come first served; that explanation is for the second message, the first gives the starting prices),");
rep("The price is sent in the chat; the visit is for choosing and negotiating.",
    "The price is sent in the chat; the visit is for choosing and negotiating. At the end of each message the buyer must feel at ease enough to simply come in: no pressure, no warning, a warm welcome, they test it in hand and we take care of them.");

// ---- Examples (only the price sentences)
rep("Le prix exact dépend de ton choix, usagé ou neuf pis la capacité, pis je t'aide à trouver le meilleur prix sur place, on peut négocier.",
    "Les prix à partir de sont juste au-dessus, le prix exact dépend de ton choix, usagé ou neuf pis la capacité. Je t'aide, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, on peut négocier.");
rep("Used and brand new, the best quality available, both with the warranty, up to 1 to 2 years, and at the counter we negotiate to your budget.",
    "Used and brand new, the best quality available, both with the warranty, up to 1 to 2 years. The starting prices are just above, and at the counter I'll help you, make you the liquidation price and find you the best option at the price you're looking for.");
rep("and the exact price follows your choice, we settle it together at the counter, negotiable.",
    "and the starting prices are just above: the exact price follows your choice, used or brand new and the storage, and I'll help you, make you the liquidation price and find you the best option at the price you're looking for.");
rep("Le prix exact dépend de ton choix, usagé ou neuf pis la capacité, c'est dans ces prix-là, pis au comptoir on négocie selon ton budget. Ton vieux téléphone on le reprend, cash ou en échange.",
    "Au comptoir on s'arrange selon ton budget, pis ton vieux téléphone on le reprend, cash ou en échange.");
rep("Parfait. Je te trouve une bonne qualité, pas de souci, pis je t'arrange le prix sur place.",
    "Parfait. Les prix à partir de sont juste au-dessus, le prix exact dépend de ton choix, usagé ou neuf pis la capacité. Je t'aide, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, pas de souci.");
rep("Au comptoir on s'arrange selon ton budget, pis ton vieux laptop ou téléphone on le reprend.",
    "Les prix à partir de sont au-dessus, pis au comptoir je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, ton vieux laptop ou téléphone on le reprend.");
rep("résidents de Montréal, paiement mensuel possible. On s'occupe de toi.",
    "résidents de Montréal, paiement mensuel possible. Je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, on s'occupe de toi.");
rep("Pour le prix, à ce budget-là t'as plusieurs options, pis au comptoir on négocie selon ton budget, usagé ou neuf pis la capacité.",
    "Pour le prix, les prix à partir de sont au-dessus pis le prix exact dépend de ton choix, usagé ou neuf pis la capacité. À ce budget-là t'as plusieurs options, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches.");
rep("pis le prix exact dépend de ton choix, usagé ou neuf pis la capacité, on le règle ensemble au comptoir, c'est négociable. Pas de stress, je t'arrange le prix selon ton budget,",
    "pis le prix exact dépend de ton choix, usagé ou neuf pis la capacité, les prix à partir de sont au-dessus. Pas de stress, je t'aide, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches,");
rep("Je t'ai déjà envoyé les prix, iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 500 $, pis le 14 Pro Max est en liquidation.",
    "Je t'ai déjà envoyé les prix à partir de juste au-dessus, iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 500 $, pis le 14 Pro Max est en liquidation.");
rep("Je vais t'aider à trouver le meilleur prix pis la meilleure option, on peut négocier aussi, pis tu peux échanger ton ancien téléphone.",
    "Je vais t'aider, je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, on peut négocier aussi, pis tu peux échanger ton ancien téléphone.");
rep("I already sent you the prices, the S24 Ultra is in that block and it's in liquidation.",
    "I already sent you the starting prices just above, the S24 Ultra is in that block and it's in liquidation.");
rep("I'll help you find the best price and the best option, we can negotiate too, and you can trade in your old phone.",
    "I'll help you, make you the liquidation price and find you the best option at the price you're looking for, we can negotiate too, and you can trade in your old phone.");
rep("Au comptoir on négocie selon ton budget, ton vieux téléphone on le reprend,",
    "Au comptoir je te fais le prix liquidation pis je te trouve la meilleure option au prix que tu cherches, ton vieux téléphone on le reprend,");

fs.writeFileSync(__dirname + "/teaching14.js", s);
const t = require(__dirname + "/teaching14.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const FOOT = /Quantités limitées, pas de réservation au téléphone ou en ligne|Limited quantities, no reservations by phone or online/;
const firstExplains = msgs.filter((m) => m.kind === "First" && /dépend de ton choix|depends on your choice|follows your choice/.test(m.text)).length;
const secondReminds = msgs.filter((m) => m.kind === "Second" && !/au-dessus|above|comptant sur place|montant exact/.test(m.text)).map((m) => m.text.slice(0, 40));
console.log("teaching14.js written", s.length, "| first messages explaining the exact price (must be 0):", firstExplains, "| second messages without the reminder (sellers excepted):", JSON.stringify(secondReminds), "| 'message' said to a buyer:", (t.examples.match(/\bmessage\b(?![^"]*")/g) || []).length);
for (const m of msgs) { const i = m.text.search(FOOT); console.log("  " + m.kind.padEnd(6), "body", i < 0 ? m.text.length : i, "total", m.text.length, "|", m.text.slice(0, 48)); }
