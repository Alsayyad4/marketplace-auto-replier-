// Derives teaching19.js from teaching18.js (Nov 7 2026, owner's complementary points — additions only, nothing replaced):
// 1. BUDGET + MODEL ("le S25 Ultra, je veux payer 400 $", "mon budget c'est 150 $ pour le S25"): never yes, never no, never
//    "we can find you one at that price" — go around it: the model is there and in liquidation this week like the others, the
//    block / family line, "I can really fix the price at the counter and show you the ones I have, brand new, used or refurbished,
//    several capacities, different batteries too", "with X $ you have lots of options with us, we help you choose the best one",
//    help with the price AND the quality, warranty, trade-in, unlocked, no bad surprises, the invitation to come and check.
// 2. THE PRICE ASKED TWICE adds "we have several of the same model" (the price depends on which one they choose).
// 3. In EVERY message: we lower the price for them AND we help them find the phone / iPad / tablet with the best battery and the
//    one that works best (said as help, never a percentage, never one unit promised); phones unlocked, no bad surprises.
// 4. The closing question is an invitation to come and check ("tu veux passer voir, à soir ou demain?").
// 5. iPad 11 / laptops: the asked model named as in liquidation, then its block, then the pack (examples added).
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching18.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 140)); process.exit(1); } s = s.split(a).join(b); };

rep("// Eighteenth pass (Nov 5 2026):", "// Nineteenth pass (Nov 7 2026): BUDGET + MODEL answered without a yes or a no (the model is there and in liquidation, the block, \"I can really fix the price at the counter and show you the ones I have\", \"with X $ you have lots of options with us\"), several of the same model, help with the price AND the quality (the best battery, the one that works best) in every message, phones unlocked, no bad surprises, the closing question as an invitation to come and check, iPad 11 / laptop examples. Based on the eighteenth pass:");
rep("settings18.json", "settings19.json");

// ---- Business info
rep("several units of most models, so several options for the same model to compare in hand;",
    "several units of the same model, refurbished, used or brand new, several capacities, different batteries too, so the buyer compares them in hand and we help them pick the one with the best battery and the one that works best;");
rep("The prices in the chat are the liquidation prices, starting from.",
    "Every message, the first and the second, says that we lower the price for them and that we help them find the phone, iPad or tablet with the best battery and the one that works best: said as help (\"je te trouve celui avec la meilleure batterie, celui qui marche le mieux\"), never a percentage, never one unit promised. The prices in the chat are the liquidation prices, starting from.");
rep("At the counter the price is negotiable, we are very flexible and we adjust to the buyer's budget: we take care of them.",
    "At the counter the price is negotiable, we are very flexible and we adjust to the buyer's budget: we take care of them. We help with the price and with the quality: among several of the same model we find them the one with the best battery and the one that works best.");
rep("Used phones are tested and come with strong batteries (say \"strong batteries\", never a percentage in the chat). We have the best quality available, used or brand new, and every phone is under the warranty, up to 1 to 2 years.",
    "Used phones are tested. We have several of the same model, with different batteries too, and we help the buyer find the one with the best battery and the one that works best (said as help, never a percentage, never a battery promised at a price). We have the best quality available, refurbished, used or brand new, every phone unlocked and under the warranty, up to 1 to 2 years: no bad surprises.");
rep("the exact price depends on their choice, refurbished, used or brand new, and the capacity, 128, 256 or 512 GB;",
    "the exact price depends on which one they choose, we have several of the same model, refurbished, used or brand new, and the capacity, 128, 256 or 512 GB;");
rep("never as a condition for knowing it.\nTHE MENU.",
    "never as a condition for knowing it.\nBUDGET + MODEL. A buyer who names a model and a number (\"le S25 Ultra, je veux payer 400 $\", \"mon budget c'est 150 $ pour le S25\", \"le 15 Pro à 450?\") gets neither a yes nor a no, and never \"we can find you an S25 Ultra at that price\": we go around it. The model is there and in liquidation this week like the other models; the price part as usual (the block or the family line); then: I can really fix the price at the counter and show you the S25 Ultras I have, brand new, used or refurbished, several capacities, different batteries too, you compare them in hand; we help you with the price and with the quality; and with your budget you have lots of options with us, we help you choose the best one, we have so many options, it is liquidation, and you leave with the warranty, up to 1 to 2 years. Then the rest of the pack (the trade-in, phones unlocked, no bad surprises, the offers, CAROL) and the invitation to come and check (\"tu veux passer voir, à soir ou demain?\"). Their number never comes back as the price of that model: \"avec 400 $ t'as plein d'options chez nous\" is the only way the number is said again.\nTHE MENU.");
rep("We never buy or sell iCloud-locked phones.",
    "We never buy or sell iCloud-locked phones.\nAll our phones are unlocked: they work with any carrier. No bad surprises: they test the phone in hand, pay at the counter, and leave with the warranty.\nQ: Is it unlocked? Does it work with my carrier? → Yes, all our phones are unlocked, any carrier, no bad surprises.");
rep("Q: Battery health? → Strong batteries, every used phone tested, the best quality available, with the warranty, up to 1 to 2 years; I'll find you a good one, no worries, and I'll sort the price out for you at the counter. (Never a percentage, never a price tied to a battery.)",
    "Q: Battery health? → We have several of the same model, with different batteries too, every used phone tested, the best quality available, with the warranty, up to 1 to 2 years; I'll find you the one with the best battery and the one that works best, no worries, and I'll sort the price out for you at the counter. (Never a percentage, never a price tied to a battery, never one unit confirmed.)");
rep("Q: Can you do it for X $? → At that budget there are several options, and the price is negotiable at the counter where we adjust to their budget. (Never accept the number, never refuse it, and never write the words \"yes or no\".)",
    "Q: Can you do it for X $? My budget is X $ for the Y. → The model is there and in liquidation this week like the others, the block or the family line as usual, I can really fix the price at the counter and show you the ones I have (brand new, used or refurbished, several capacities, different batteries), then: with X $ you have lots of options with us, we help you choose the best one, we have so many options, we help with the price and the quality, it is liquidation, and you leave with the warranty, up to 1 to 2 years. (Never accept the number, never refuse it, never \"we can find you a Y at that price\", and never write the words \"yes or no\".)");

// ---- Instructions
rep("2. The warranty, up to 1 to 2 years.", "2. The warranty, up to 1 to 2 years; the phones are unlocked, no bad surprises.");
rep("4. At the counter we bring the price down for them, or help them with it: we find them the best price and the best option, we negotiate, very flexible, adjusted to their budget, we take care of them.",
    "4. At the counter we bring the price down for them, or help them with it: we find them the best price and the best option, we negotiate, very flexible, adjusted to their budget, we take care of them. And we help with the quality too, in every message: we find them the phone, iPad or tablet with the best battery and the one that works best, said as help, never a percentage.");
rep("2. the warranty, up to 1 to 2 years;", "2. the warranty, up to 1 to 2 years, the phones unlocked, no bad surprises;");
rep("4. the promise: in the first, we will bring the price down for you or help you with it at the counter; in the second, we help you, we make you the liquidation price and we find you the best option at the price you want, negotiable;",
    "4. the promise: in the first, we will bring the price down for you or help you with it at the counter; in the second, we help you, we make you the liquidation price and we find you the best option at the price you want, negotiable; in both, we help with the quality too: the one with the best battery, the one that works best;");
rep("\"On a les trois, remis à neuf, usagé ou neuf, en 128, 256 ou 512 Go, pis le prix suit ce que tu choisis, je te fais le prix liquidation sur ce que tu prends.\"",
    "\"On en a plusieurs du même modèle, remis à neuf, usagé ou neuf, en 128, 256 ou 512 Go, pis le prix suit ce que tu choisis, je te fais le prix liquidation sur ce que tu prends.\"");
rep("\"We've got all three, refurbished, used or brand new, in 128, 256 or 512 GB, and the price follows what you pick, I make you the liquidation price on it.\"",
    "\"We've got several of the same model, refurbished, used or brand new, in 128, 256 or 512 GB, and the price follows what you pick, I make you the liquidation price on it.\"");
rep("- A proposed number: do not accept it and do not refuse it, and never write the words \"yes or no\" or \"neither yes nor no\", those are your rules, not an answer. Say that at that budget there are several options, and that at the counter the price is negotiable and adjusted to their budget.",
    "- A proposed number: do not accept it and do not refuse it, and never write the words \"yes or no\" or \"neither yes nor no\", those are your rules, not an answer. Say that at that budget there are several options, and that at the counter the price is negotiable and adjusted to their budget.\n- BUDGET + MODEL (\"le S25 Ultra, je veux payer 400 $\", \"mon budget c'est 150 $ pour le S25\", \"le 15 Pro à 450?\"): never yes, never no, and never \"we can find you an S25 Ultra at that price\". Go around it, in this order: the model is there and in liquidation this week like the other models; the block or the family line as usual; \"je peux vraiment t'arranger le prix au comptoir pis te montrer les S25 Ultra que j'ai, neufs, usagés ou remis à neuf, plusieurs capacités, des batteries différentes aussi, tu compares en main\"; we help with the price and with the quality; \"avec 400 $ t'as plein d'options chez nous, on t'aide à choisir la meilleure, on en a tellement\", it is liquidation, warranty up to 1 to 2 years; then the trade-in, phones unlocked, no bad surprises, the offers, CAROL, and the invitation to come and check. Their number is said again only inside \"avec 400 $ t'as plein d'options\", never as the price of that model.");
rep("3. The promise, in a few words, in every first message: we will bring the price down for them, or help them with it, at the counter, adjusted to their budget (\"on te baisse le prix\", \"on t'aide avec le prix\", \"we'll bring it down for you\"), and their old phone is taken, cash or trade.",
    "3. The promise, in a few words, in every first message: we will bring the price down for them, or help them with it, at the counter, adjusted to their budget (\"on te baisse le prix\", \"on t'aide avec le prix\", \"we'll bring it down for you\"), and their old phone is taken, cash or trade; and the quality too: we find them the one with the best battery and the one that works best; the phones are unlocked, no bad surprises.");
rep("6. One closing question, when and not whether, matched to the clock:",
    "6. One closing question, an invitation to come and check, when and not whether, matched to the clock: \"tu veux passer voir, cet après-midi ou à soir?\",");
rep("3. The warranty, up to 1 to 2 years, and the offers in one breath, a few words each:",
    "3. The warranty, up to 1 to 2 years, the phones unlocked, no bad surprises, the best battery and the one that works best, and the offers in one breath, a few words each:");
rep("- We have the best quality available; I'll find you a good one, no worries, and I'll sort the price out for you. \"Je te trouve une bonne qualité, pas de souci, pis je t'arrange le prix.\"",
    "- We have the best quality available; I'll find you a good one, no worries, and I'll sort the price out for you. \"Je te trouve une bonne qualité, pas de souci, pis je t'arrange le prix.\"\n- Several of the same model in hand: refurbished, used or brand new, several capacities, different batteries too; they compare and we find them the one with the best battery and the one that works best. \"On en a plusieurs du même modèle, tu compares en main pis je te sors celui qui a la meilleure batterie.\"\n- All our phones are unlocked, no bad surprises. \"Tout est débloqué, pas de mauvaise surprise.\"");
rep("- The price asked twice (",
    "- Budget + model (\"le S25 Ultra, je veux payer 400 $\", \"mon budget c'est 150 $ pour le S25\"): the BUDGET + MODEL answer from THE PRICE PART, never a yes, never a no, never \"we can find you one at that price\": the model is there and in liquidation this week like the others, the block or the line, I can really fix the price at the counter and show you the ones I have, with your budget you have lots of options with us, we help you choose the best one, price and quality, warranty, then the pack and the invitation to come and check.\n- The price asked twice (");

rep("No other question. The first message alone must make them want to come",
    "No other question, not even a rhetorical one (\"Old phone? Bring it\" counts as a question: say \"If you have an old phone, bring it\"). The first message alone must make them want to come");

// ---- Closer goals
rep("Never beg, never repeat the same line twice, never two questions.", "Never beg, never repeat the same line twice, never two questions, not even a rhetorical one (\"Un vieux téléphone? Amène-le\" is a question: say \"Si t'as un vieux téléphone, amène-le\").");
rep("the code CAROL, the warranty, up to 1 to 2 years, the free accessories,", "the code CAROL, the warranty, up to 1 to 2 years, phones unlocked, no bad surprises, the free accessories,");
rep("budget (several options, we adjust at the counter)",
    "budget or a number with a model (the model is there and in liquidation this week like the others, the block or the line, I can really fix the price at the counter and show you the ones I have, with that budget they have lots of options with us, we help them choose the best one, price and quality, warranty; never \"yes the S25 for 150 $\", never \"we can find you an S25 Ultra at that price\", never a no)");
rep("A buyer asking about the battery or a sealed box is asking to be reassured: reassure (best quality available, tested, warranty, up to 1 to 2 years, I'll find you a good one, no worries, I'll sort the price out), never confirm a unit or a number.",
    "A buyer asking about the battery or a sealed box is asking to be reassured: reassure (several of the same model, different batteries too, best quality available, tested, warranty, up to 1 to 2 years, I'll find you the one with the best battery and the one that works best, no worries, I'll sort the price out), never confirm a unit or a number.");
rep("The ad price is never mentioned to a buyer.",
    "The ad price is never mentioned to a buyer. Every message, both of them, says we lower the price for them and that we help them find the phone, iPad or tablet with the best battery and the one that works best: help with the price and with the quality, never a percentage, never one unit promised; the phones are unlocked, no bad surprises.");

// ---- Examples: three new conversations (S25 Ultra at 400 $, S25 at 150 $, iPad 11)
rep("Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"",
    "Listing Samsung Galaxy S25 Ultra 256GB, it is 14:00. Buyer: \"le s25 ultra je veux payer 400$ max\"\n" +
    "First message: \"Le S25 Ultra est là, oui, pis c'est la semaine de liquidation, lui comme les autres modèles, garantie jusqu'à 1 à 2 ans, tout débloqué, pas de mauvaise surprise. ${SAMSUNG_INLINE}. Au comptoir je peux vraiment t'arranger le prix pis te montrer les S25 Ultra que j'ai, neufs, usagés ou remis à neuf, plusieurs capacités, des batteries différentes aussi, tu compares en main. Avec 400 $ t'as plein d'options chez nous, on t'aide à choisir la meilleure, pour le prix pis pour la qualité, celui qui a la meilleure batterie pis qui marche le mieux. Ton vieux téléphone, on le reprend, cash ou en échange. Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits, paiement par mois possible, dis CAROL en arrivant. Tu veux passer voir, cet après-midi ou à soir? ${FOOT_FR} ${SHOP_FR}\"\n" +
    "Buyer: \"ok mais 400 pour le s25 ultra c'est faisable ou pas?\"\n" +
    "Second message: \"Je t'ai envoyé la liste des prix juste au-dessus, le S25 Ultra est dedans pis il est là. Le prix dépend de celui que tu choisis: on en a plusieurs du même modèle, neufs, usagés ou remis à neuf, 128, 256 ou 512 Go, pis le prix suit ce que tu prends. On reçoit des centaines de demandes, faque je te montre tout sur place: je t'aide avec le prix pis la qualité, je te fais le prix liquidation, on peut négocier, pis je te sors celui avec la meilleure batterie, celui qui marche le mieux. Avec 400 $ t'as plusieurs options chez nous, on te trouve la meilleure. Amène ton vieux téléphone, cash ou échange. Garantie jusqu'à 1 à 2 ans, débloqué, pas de mauvaise surprise, pis avec CAROL au comptoir: accessoires gratuits, rabais étudiants, nouveaux arrivants pis résidents de Montréal, paiement par mois si tu veux. Passe à soir avant 21h ou demain dès 9h, pas besoin de rdv, je m'occupe de toi. ${FOOT_FR} ${SHOP_FR}\"\n\n" +
    "Listing Samsung Galaxy S25 128GB, it is 11:00. Buyer: \"mon budget c'est 150$ pour le s25\"\n" +
    "First message: \"Le S25 est là pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans, débloqué. ${SAMSUNG_INLINE}. Avec 150 $ t'as plein d'options chez nous, on en a tellement, pis on t'aide à choisir la meilleure, pour le prix pis pour la qualité: celui avec la meilleure batterie, celui qui marche le mieux, pas de mauvaise surprise. Au comptoir on te baisse le prix, on s'arrange selon ton budget, pis ton vieux téléphone on le reprend, cash ou échange. Rabais en plus si t'es étudiant, nouvel arrivant ou résident de Montréal, accessoires gratuits, paiement par mois possible. Dis CAROL en arrivant. Tu veux passer voir aujourd'hui, cet après-midi ou à soir? ${FOOT_FR} ${SHOP_FR}\"\n\n" +
    "Listing iPad 11 128 Go, it is 17:00. Buyer: \"l'ipad 11 est dispo? combien?\"\n" +
    "First message: \"Oui, l'iPad 11 est là pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans, on a des neufs scellés aussi. ${TABLET_INLINE}. Au comptoir on te baisse le prix selon ton budget, pis on t'aide à choisir celui avec la meilleure batterie, celui qui marche le mieux, pas de mauvaise surprise. Ton vieux téléphone ou ta tablette, on les reprend, cash ou en échange. Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits, paiement par mois possible, dis CAROL en arrivant. Tu veux passer voir à soir avant 21h ou demain? ${FOOT_FR} ${SHOP_FR}\"\n\n" +
    "Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"");

// ---- Examples: every existing message carries the new items (rotating wordings, after the warranty phrase)
const FR_FULL = [
  ", débloqué, pis je te trouve celui avec la meilleure batterie, celui qui marche le mieux, pas de mauvaise surprise",
  ", tout débloqué, pas de mauvaise surprise, pis on t'aide à choisir celui avec la meilleure batterie pis qui marche le mieux",
  ", téléphones débloqués, zéro mauvaise surprise, pis je te sors celui qui a la meilleure batterie pis qui marche le mieux",
  ", débloqué, pas de surprise, pis je m'arrange pour te trouver la meilleure batterie pis celui qui marche le mieux",
];
const EN_FULL = [
  ", unlocked, and I find you the one with the best battery, the one that works best, no bad surprises",
  ", all unlocked, no bad surprises, and we help you pick the one with the best battery that works best",
  ", phones unlocked, zero bad surprises, and I pull out the one with the best battery that runs best",
  ", unlocked, no surprises, and I make sure you get the best battery and the one that works best",
];
const FR_DEVICE = [", pas de mauvaise surprise, pis je te trouve celui avec la meilleure batterie, celui qui marche le mieux", ", zéro mauvaise surprise, pis on t'aide à choisir celui qui a la meilleure batterie pis qui marche le mieux"];
const EN_DEVICE = [", no bad surprises, and I find you the one with the best battery, the one that works best", ", zero bad surprises, and we help you pick the one with the best battery that works best"];
const FR_BAT = ", pis je te trouve celui avec la meilleure batterie, celui qui marche le mieux";
const EN_BAT = ", and I find you the one with the best battery, the one that works best";
const FR_UNL = ", débloqué, pas de mauvaise surprise";
const EN_UNL = ", unlocked, no bad surprises";
const WARR = /(garantie jusqu'à 1 à 2 ans(?: dans (?:tous les|les deux) cas)?|warranty,? up to 1 to 2 years(?: for just the difference)?)/i;
let iFr = 0, iEn = 0, touched = 0, untouched = [];
s = s.replace(/((?:First|Second) message: ")([^"]+)(")/g, (m, pre, text, post) => {
  const needBat = !/batter/i.test(text), needUnl = !/débloqu|unlocked|surprise/i.test(text);
  if (!needBat && !needUnl) return m;
  const fr = /garantie|prix|pis /i.test(text) && !/warranty/i.test(text);
  const device = /ipad|tablet|laptop|macbook/i.test(text);
  let clause;
  if (needBat && needUnl) clause = device ? (fr ? FR_DEVICE[iFr++ % FR_DEVICE.length] : EN_DEVICE[iEn++ % EN_DEVICE.length]) : (fr ? FR_FULL[iFr++ % FR_FULL.length] : EN_FULL[iEn++ % EN_FULL.length]);
  else if (needBat) clause = fr ? FR_BAT : EN_BAT;
  else clause = device ? (fr ? ", pas de mauvaise surprise" : ", no bad surprises") : (fr ? FR_UNL : EN_UNL);
  const w = text.match(WARR);
  if (!w) { untouched.push(text.slice(0, 60)); return m; }
  const idx = w.index + w[0].length;
  touched++;
  return pre + text.slice(0, idx) + clause + text.slice(idx) + post;
});

// a clause that landed right before a price line: close the sentence first
s = s.split("pis qui marche le mieux, iPhone 15 / 15 Pro / 15 Pro Max : à partir de").join("pis qui marche le mieux. iPhone 15 / 15 Pro / 15 Pro Max : à partir de");
fs.writeFileSync(__dirname + "/teaching19.js", s);
const t = require(__dirname + "/teaching19.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const checks = {
  warranty: /garantie|warranty/i, tradein: /reprend|trade|échang|exchange|amène/i, discount: /étudiant|student/i, accessories: /accessoires|accessories/i,
  monthly: /mensuel|monthly|par mois|per month/i, carol: /CAROL/, footer: /Quantités limitées|Limited quantities/, shop: /Beaubien E/, hours: /9h à 21h|9am to 9pm/,
  liquidation: /liquidation/i, phone: /4️⃣3️⃣8️⃣8️⃣0️⃣/, battery: /batterie|battery/i, trust: /débloqu|unlocked|surprise/i,
};
let bad = 0;
for (const m of msgs) {
  if (/Le montant exact|comptant sur place/.test(m.text)) continue;
  const miss = Object.keys(checks).filter((k) => !checks[k].test(m.text));
  if (m.kind === "First" && !/semaine de liquidation|liquidation week/.test(m.text)) miss.push("liquidation-week");
  if (/\d+\s?%/.test(m.text.replace(/20 (?:à|to) 40 %/g, "")) && /batter/i.test(m.text)) miss.push("BATTERY-PERCENT");
  if (miss.length) { bad++; console.log("  MISSING", miss.join(","), "|", m.kind, m.text.slice(0, 60)); }
}
const banned = (t.examples.match(/\b(condition|état|grade)\b/gi) || []).filter((w) => !/conditions/i.test(w)).length;
const yesNo = (t.examples.match(/oui,? (?:le )?s25 (?:ultra )?(?:pour|à) \d+|yes,? (?:the )?s25 (?:ultra )?(?:for|at) \d+/gi) || []).length;
console.log("teaching19.js written", s.length, "| examples:", msgs.length, "| clauses inserted:", touched, "| no warranty anchor:", untouched.length ? untouched : 0, "| missing:", bad, "| condition/état/grade in examples:", banned, "| yes-to-a-number:", yesNo);
