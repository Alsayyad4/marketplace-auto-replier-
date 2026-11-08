// Derives teaching23.js from teaching22.js (Nov 8 2026): the adversarial review of v22 (14 findings) applied.
// (1-2) the toolbox line "New arrivals every day and popular models go fast" and move 6's "les vrais deals c'est pour
// ceux qui se déplacent" were the screenshot's "ça change avec les arrivages" in softer words — out, and banned;
// (3) the laptop example's invented "Les MacBook partent en premier" — out; (4) the 18 Pro price-list row with no
// price was fed to the model as "the owner's price-list line" and came out as "Pour le prix: disponibles" — the row
// leaves the price list (the 18 rule lives in Business info + THE PRICE PART); (5) "the best deals are for those who
// come in" says the chat price is not the real one — out of the toolbox, move 6 and Closer goals, the owner's fact kept
// as background; (6) after a buyer names a number, "au prix que tu cherches" sounds like a yes — the promise becomes
// "la meilleure option avec ton budget" (rule + example); (8) colour/capacity: abundance of the model, the colours and
// the capacities, never "several of" one exact unit; (9) "Half the people we see" → "Plenty of our customers";
// (10) the seller's second example gets the missing pack items; (11) "Fifteen minutes" invented — out; (12) the two
// wordings of "on fait de notre mieux" named for message 1 and 2; (13) "unlocked" is phones only.
const fs = require("fs");
const NL = String.fromCharCode(10);
let s = fs.readFileSync(__dirname + "/teaching22.js", "utf8");
let nrep = 0;
function rep(a, b, all) {
  const n = s.split(a).length - 1;
  if (n === 0) { console.error("MISSING anchor:", a.slice(0, 140)); process.exit(1); }
  if (n > 1 && !all) { console.error("AMBIGUOUS anchor (" + n + "):", a.slice(0, 140)); process.exit(1); }
  s = s.split(a).join(b); nrep++; return n;
}
s = "// Twenty-third pass (Nov 8 2026): the v22 review applied — no urgency line about arrivals or popular models, no 'real deals for those who come in', no 18 row without a price, 'avec ton budget' after a named number, no 'several of' one exact unit." + NL + s;
rep("settings22.json", "settings23.json");

// ---- price list: the 18 row leaves (the mechanic fed it to the model as a price line) ----
rep(`  "iPhone 18 Pro / 18 Pro Max : disponibles, en liquidation aussi",` + NL, "");

// ---- Business info ----
rep(`the buyer walks out with it the same visit; new arrivals every day, popular models go fast.`,
    `the buyer walks out with it the same visit; new arrivals every day and popular models go fast (a fact for you, never a sentence to a buyer: it reads as "maybe not").`);
rep(`a colour or a capacity gets "all the colours, all the capacities".`,
    `a colour or a capacity gets "all the colours, all the capacities" ("toutes les couleurs pis toutes les capacités, plusieurs S25 Ultra en stock"): the abundance is of the model, the colours and the capacities, never "le S25 Ultra 512 en noir, on l'a, pis on en a plusieurs", never several of one exact unit.`, true);
rep(`the price list has no number for them yet, so no number in the chat`,
    `the price list has no line for them, so no number in the chat`);
rep(`Their number never comes back as the price of that model: "avec 400 $ t'as plein d'options chez nous" is the only way the number is said again.`,
    `Their number never comes back as the price of that model: "avec 400 $ t'as plein d'options chez nous" is the only way the number is said again. Once they have named a number, the promise is "je te trouve la meilleure option avec ton budget", never "au prix que tu cherches": right after their number, "at the price you are looking for" sounds like a yes.`);
rep(`Hundreds of people write to us, so we keep the best deals for the serious ones, the people who come to the shop.`,
    `Hundreds of people write to us, so we keep the best deals for the serious ones, the people who come to the shop (for you: to a buyer the deal is said as price help, "on te baisse le prix au comptoir", never "the real deals are for those who come in", which would say the chat price is not the real one).`);
rep(`they pick theirs in hand at the counter; said as abundance, never "to check at the shop"; never promise one specific unit, grade or capacity at a price in the chat.`,
    `they pick theirs in hand at the counter; said as abundance ("toutes les couleurs pis toutes les capacités, plusieurs S25 Ultra en stock, tu choisis le tien en main"), never "to check at the shop", never "several of" one exact colour and capacity; never promise one specific unit, grade or capacity at a price in the chat.`);

// ---- Instructions ----
rep(`2. The warranty, up to 1 to 2 years; the phones are unlocked, no bad surprises.`,
    `2. The warranty, up to 1 to 2 years; the phones are unlocked (phones only: a laptop or an iPad is "testé, garantie jusqu'à 1 à 2 ans, pas de mauvaise surprise"), no bad surprises.`);
rep(`never the model's name or their number in that sentence, and we have a huge variety. And we help with the quality too`,
    `never the model's name or their number in that sentence, and we have a huge variety (first message: "on fait de notre mieux avec ton budget pis le modèle que tu cherches, pis on a une grande variété"; second message: "ton budget pis le modèle que tu cherches, on fait de notre mieux avec, pis y'a une grande variété en magasin": the first wording is never reused). And we help with the quality too`);
rep(`2. the warranty, up to 1 to 2 years, the phones unlocked, no bad surprises;`,
    `2. the warranty, up to 1 to 2 years, the phones unlocked (phones only), no bad surprises;`);
rep(`6. Honest urgency, lightly, once. Liquidation week, popular models go fast, first come first served (the footer says it), "les vrais deals c'est pour ceux qui se déplacent". Never invented buyers, never "last one", never a deadline except the laptop block's own.`,
    `6. Honest urgency, lightly, once: it is liquidation week, and first come first served (the footer says it). Never "popular models go fast", never "new arrivals", never "the real deals are for those who come in" (it says the chat price is not the real one), never invented buyers, never "last one", never a deadline except the laptop block's own.`);
rep(`"depends on arrivals", "stock changes": every one of them tells the buyer`,
    `"depends on arrivals", "stock changes", "les modèles populaires partent vite", "ça rentre tous les jours", "popular models go fast", "new arrivals every day", "les vrais deals c'est pour ceux qui se déplacent": every one of them tells the buyer`);
rep(`Their number is said again only inside "avec 400 $ t'as plein d'options", never as the price of that model.`,
    `Their number is said again only inside "avec 400 $ t'as plein d'options", never as the price of that model. After their number the promise is "je te trouve la meilleure option avec ton budget", never "au prix que tu cherches" (it would sound like a yes to their number).`);
rep(`- New arrivals every day and popular models go fast, so the day they come we find them the best deal. "Ça rentre tous les jours pis les modèles populaires partent vite." Never said about the model they asked for: theirs is there.` + NL, "");
rep(`- Fifteen minutes and they leave with it: they test it in hand, compare several, pay at the counter and walk out with it the same visit. "Tu passes, tu compares en main, pis tu repars avec aujourd'hui." / "Come by, compare them in hand, and leave with it today."` + NL, "");
rep(`- They test it in hand, compare several units, pay at the counter, nothing before, and walk out with it. A real store with more than 1 700 Google reviews.`,
    `- They test it in hand, compare several units, pay at the counter, nothing before, and walk out with it. A real store with more than 1 700 Google reviews. "Tu passes, tu compares en main, pis tu repars avec aujourd'hui." / "Come by, compare them in hand, and leave with it today."`);
rep(`- We keep the best deals for the people who come in. "Les vrais deals, c'est pour ceux qui se déplacent."` + NL, "");

// ---- Closer goals ----
rep(`Honest urgency only: new arrivals every day, popular models go fast, hundreds of people write to us and we keep the best deals for the serious ones who come in; never "stock changes" or "to confirm" about the model they asked for: theirs is there.`,
    `Honest urgency only: it is liquidation week, first come first served (the footer says it), and hundreds of people write to us, so the counter is where we take care of them; never "new arrivals", "popular models go fast", "stock changes", "the real deals are for those who come in" or "to confirm" in a buyer's message: theirs is there and the chat price is the real one.`);

// ---- Examples ----
rep(`Les MacBook partent en premier pis il reste 6 jours de liquidation.`,
    `Pis la liquidation dure encore 6 jours.`);
rep(`No pressure at all. Half the people we see come from Laval or the South Shore, it's worth the trip.`,
    `No pressure at all. Plenty of our customers come from Laval or the South Shore, it's worth the trip.`);
rep(`À ce budget-là t'as plusieurs options, je te fais le prix liquidation pis je te trouve la meilleure au prix que tu cherches.`,
    `À ce budget-là t'as plusieurs options, je te fais le prix liquidation pis je te trouve la meilleure option avec ton budget.`);
rep(`Si tu penses l'échanger contre un plus récent, notre spécialiste reprise est au 4️⃣3️⃣8️⃣2️⃣5️⃣8️⃣7️⃣8️⃣9️⃣5️⃣, pis tu repars avec la garantie jusqu'à 1 à 2 ans, débloqué, pas de surprise, pis je m'arrange pour te trouver la meilleure batterie pis celui qui marche le mieux, les accessoires gratuits pis le paiement par mois si tu veux, dis CAROL au comptoir.`,
    `En échange ton 13 vaut plus qu'en cash: si tu penses le changer pour un plus récent, 20 à 40 % sous le prix habituel cette semaine, notre spécialiste reprise est au 4️⃣3️⃣8️⃣2️⃣5️⃣8️⃣7️⃣8️⃣9️⃣5️⃣, pis tu repars avec la garantie jusqu'à 1 à 2 ans, débloqué, pas de surprise, pis je m'arrange pour te trouver la meilleure batterie pis celui qui marche le mieux, les accessoires gratuits, le rabais étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement par mois si tu veux, dis CAROL au comptoir.`);

fs.writeFileSync(__dirname + "/teaching23.js", s);
const t = require(__dirname + "/teaching23.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)];
const BAD = /à confirmer|confirme au magasin|confirmer au magasin|en appelant|appelle pour|appelez pour|change avec les arrivages|dépend des arrivages|vérifies sur place|vérifie sur place|tu le vois sur place|on vérifie|se confirme au magasin|to confirm|to be confirmed|check at the shop|verify in person|call to check|exact model you see|availability to confirm|depends on arrivals|stock changes|ça change chaque jour|contactez-nous pour confirmer|centaines de demandes|hundreds of requests|pour l'instant|ça bouge|partent vite|ça rentre|vrais deals|partent en premier|Half the people|18 Pro Max : disponibles|Fifteen minutes|15 minutes/i;
const bad = msgs.filter((m) => BAD.test(m[2]));
const noShop = msgs.filter((m) => !/Beaubien/.test(m[2]));
const noFoot = msgs.filter((m) => !/premier arrivé premier servi|first come first served/.test(m[2]));
const twoQ = msgs.filter((m) => (m[2].match(/[?]/g) || []).length > 1);
const noBest = msgs.filter((m) => !/notre mieux|our best/.test(m[2]));
const all = Object.values(t).filter((v) => typeof v === "string").join(NL);
console.log("teaching23.js written", s.length, "| replacements:", nrep, "| examples:", msgs.length, "| bad phrases in examples:", bad.length, "| no shop line:", noShop.length, "| no footer:", noFoot.length, "| two questions:", twoQ.length, "| missing 'our best':", noBest.length, "| 18 row in price list:", (t.priceList.match(/18 Pro/g) || []).length, "| 'vrais deals' left:", (all.match(/vrais deals/g) || []).length, "| 'partent vite' left:", (all.match(/partent vite/g) || []).length, "| 'popular models go fast' left:", (all.match(/popular models go fast/g) || []).length);
for (const m of bad) console.log("BAD:", m[2].match(BAD)[0], "|", m[2].slice(0, 110));
if (bad.length || noShop.length || noFoot.length || twoQ.length) process.exit(1);
