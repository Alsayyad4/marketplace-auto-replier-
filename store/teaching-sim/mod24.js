// Derives teaching24.js from teaching23.js (Nov 8 2026). Owner: "since we raised the list of iphone and samsung prices,
// if we knew the customer's budget, in one of the two messages we can include: don't worry about these prices, if they
// have a lower budget we will find them lower prices, let them ask for CAROL at the counter; include this in the
// smartest way possible, don't miss a point from my previous instructions."
// THE LOWER-BUDGET LINE: the moment a budget below the list is known (a number, "c'est trop cher", "too expensive"),
// that message carries, once: "Inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher
// aussi, on s'arrange au comptoir, dis juste CAROL en arrivant." General words, never their model at their number,
// never yes/no, never a number of ours. No budget known and a list just sent: the first message may invite it lightly,
// no question mark ("Pis si ton budget est plus bas, inquiète-toi pas, on a moins cher aussi, dis-le-moi").
const fs = require("fs");
const NL = String.fromCharCode(10);
const T = (x) => x.replace(/@([A-Z_]+)@/g, (m, n) => "$" + "{" + n + "}");
let s = fs.readFileSync(__dirname + "/teaching23.js", "utf8");
let nrep = 0;
function rep(a, b, all) {
  const n = s.split(a).length - 1;
  if (n === 0) { console.error("MISSING anchor:", a.slice(0, 140)); process.exit(1); }
  if (n > 1 && !all) { console.error("AMBIGUOUS anchor (" + n + "):", a.slice(0, 140)); process.exit(1); }
  s = s.split(a).join(b); nrep++; return n;
}
s = "// Twenty-fourth pass (Nov 8 2026): THE LOWER-BUDGET LINE — a budget below the raised lists gets 'inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher aussi, dis juste CAROL en arrivant', once; the first message may invite the budget lightly." + NL + s;
rep("settings23.json", "settings24.json");

const LB_FR = `Inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher aussi, on s'arrange au comptoir, dis juste CAROL en arrivant.`;
const LB_EN = `Don't worry about the list prices: with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you get here.`;
const INV_FR = `Pis si ton budget est plus bas, inquiète-toi pas, on a moins cher aussi, dis-le-moi.`;
const INV_EN = `And if your budget is lower, no worries, we've got cheaper too, just tell me.`;

// ---- Business info ----
rep(`right after their number, "at the price you are looking for" sounds like a yes.`,
    `right after their number, "at the price you are looking for" sounds like a yes.
A LOWER BUDGET. The iPhone lines and the Samsung block went up: they are the starting prices of the latest, best units, and a buyer with less must never stay home because of them. The moment a buyer's budget is known and sits below the list (a number named, "mon budget c'est 300", "c'est trop cher", "too expensive"), that message, the first or the second, carries the lower-budget line once: don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you arrive ("${LB_FR}" / "${LB_EN}"). General words: never the model they asked for at their number, never "yes", never "no", never a number of ours; the budget rules above still hold ("avec X $ t'as plein d'options chez nous", "la meilleure option avec ton budget", never "au prix que tu cherches"). When no budget is known and a family line or the Samsung block was just sent, the first message may invite it lightly after the price part, without a question mark ("${INV_FR}" / "${INV_EN}"); a budget that comes back gets the lower-budget line in the second message.`);
rep(`Q: What can I get for my budget? What else do you have? → The whole iPhone list, family lines joined by " · ", then the rest of the pack: at the counter we negotiate to their budget`,
    `Q: What can I get for my budget? What else do you have? → The whole iPhone list, family lines joined by " · ", then, when their number sits below the list, the lower-budget line ("${LB_FR}"), then the rest of the pack: at the counter we negotiate to their budget`);
rep(`we help with the price and the quality, it is liquidation, and you leave with the warranty, up to 1 to 2 years. (Never accept the number`,
    `we help with the price and the quality, it is liquidation, and you leave with the warranty, up to 1 to 2 years; and when X sits below the list, the lower-budget line once: don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you get here. (Never accept the number`);
rep(`and never write the words "yes or no".)`,
    `and never write the words "yes or no".)
Q: It is too expensive, I only have X. ("c'est trop cher", "j'ai juste 300", "too expensive for me") → No yes, no no, never their model at their number: the lower-budget line first ("${LB_FR}" / "${LB_EN}"), then with X $ they have lots of options with us, we do our best with their budget and the model they are looking for, huge variety, the trade-in drops it again, the rest of the pack and the step to the door.`);

// ---- Instructions ----
rep(`And we help with the quality too, in every message: we find them the phone, iPad or tablet with the best battery and the one that works best, said as help, never a percentage.`,
    `And we help with the quality too, in every message: we find them the phone, iPad or tablet with the best battery and the one that works best, said as help, never a percentage. And when their budget is known and sits below the list, the lower-budget line, once, in that message: don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you get here.`);
rep(`in both, we help with the quality too: the one with the best battery, the one that works best;`,
    `in both, we help with the quality too: the one with the best battery, the one that works best; a budget known and below the list: the lower-budget line, once, with CAROL;`);
rep(`8. Trust in one line. A real store, more than 1 700 Google reviews, they pay at the counter, nothing before, warranty up to 1 to 2 years.`,
    `8. Trust in one line. A real store, more than 1 700 Google reviews, they pay at the counter, nothing before, warranty up to 1 to 2 years.
9. The list is not a wall. The iPhone lines and the Samsung block went up: they are the starting prices of the latest, best units, and a buyer with less must not stay home because of them. A budget below the list, or "c'est trop cher": "${LB_FR}" / "${LB_EN}" Once, in general words, never their model at their number, never a number of ours. No budget known and a list just sent: the first message may invite it, without a question mark: "${INV_FR}" / "${INV_EN}"`);
rep(`After their number the promise is "je te trouve la meilleure option avec ton budget", never "au prix que tu cherches" (it would sound like a yes to their number).`,
    `After their number the promise is "je te trouve la meilleure option avec ton budget", never "au prix que tu cherches" (it would sound like a yes to their number). When their number sits below the list, add the lower-budget line once ("${LB_FR}"): general words, never their model at their number.`);
rep(`and the quality too: we find them the one with the best battery and the one that works best; the phones are unlocked, no bad surprises.`,
    `and the quality too: we find them the one with the best battery and the one that works best; the phones are unlocked, no bad surprises. A budget already named below the list: the lower-budget line (don't worry about the list prices, with your budget we find you lower prices too, say CAROL at the counter). No budget known and a family line or the Samsung block just sent: when there is room, the light invitation right after the price part, no question mark ("${INV_FR}" / "${INV_EN}").`);
rep(`The family line or the block again only if it is not already in the chat; the whole iPhone list only for a budget or "what else" question.`,
    `The family line or the block again only if it is not already in the chat; the whole iPhone list only for a budget or "what else" question. A budget named, now or before, below the list: the lower-budget line once (don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, say CAROL when you arrive), never their model at their number.`);
rep(`- We do our best with the budget they have and the model they are looking for, and we have a huge variety. "On fait de notre mieux avec ton budget pis le modèle que tu cherches, on a une grande variété." / "We do our best with your budget and the model you're looking for, and we've got a huge variety."`,
    `- We do our best with the budget they have and the model they are looking for, and we have a huge variety. "On fait de notre mieux avec ton budget pis le modèle que tu cherches, on a une grande variété." / "We do our best with your budget and the model you're looking for, and we've got a huge variety."
- A budget below the list: don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, say CAROL when you arrive. "${LB_FR}" / "${LB_EN}"`);
rep(`huge variety, we help you choose the best one, price and quality, warranty, then the pack and the invitation to come and check.`,
    `huge variety, we help you choose the best one, price and quality, warranty, then the pack and the invitation to come and check. When their number sits below the list, the lower-budget line once: don't worry about the list prices, with your budget we find you lower prices too, we work it out at the counter, say CAROL when you arrive.
- "C'est trop cher", "too expensive for me", "j'ai juste 300": no yes, no no, never their model at their number; the lower-budget line first ("${LB_FR}" / "${LB_EN}"), then with their budget they have lots of options with us, we do our best with their budget and the model they are looking for, huge variety, the trade-in drops it again, the rest of the pack and the step to the door.`);

// ---- Closer goals ----
rep(`we help them choose the best one, price and quality, warranty; never "yes the S25 for 150 $"`,
    `we help them choose the best one, price and quality, warranty, and when their number sits below the list the lower-budget line once, don't worry about the list prices, with your budget we find you lower prices too, say CAROL at the counter; never "yes the S25 for 150 $"`);

// ---- Examples: the budget conversations gain the line; two first messages gain the light invitation ----
rep(`At the counter we bring the price down for you and adjust to your budget, and if you've got an old phone bring it, cash for it or as a trade.`,
    `${LB_EN} If you've got an old phone bring it, cash for it or as a trade.`);
rep(`Avec 400 $ t'as plein d'options chez nous, on t'aide à choisir la meilleure, pour le prix pis pour la qualité, celui qui a la meilleure batterie pis qui marche le mieux.`,
    `Avec 400 $ t'as plein d'options chez nous, on t'aide à choisir la meilleure, pour le prix pis pour la qualité, celui qui a la meilleure batterie pis qui marche le mieux. ${LB_FR}`);
rep(`Avec 400 $ t'as plusieurs options chez nous, on te trouve la meilleure.`,
    `Avec 400 $ t'as plusieurs options chez nous, on te trouve la meilleure, pis les prix de la liste c'est des à partir de: avec ton budget on descend aussi, dis CAROL au comptoir pis je m'en occupe.`);
rep(`Ton budget pis le modèle que tu cherches, on fait de notre mieux avec. Rabais en plus si t'es étudiant`,
    `Ton budget pis le modèle que tu cherches, on fait de notre mieux avec. ${LB_FR} Rabais en plus si t'es étudiant`);
rep(`À ce budget-là t'as plusieurs options, je te fais le prix liquidation pis je te trouve la meilleure option avec ton budget.`,
    `À ce budget-là t'as plusieurs options, je te fais le prix liquidation pis je te trouve la meilleure option avec ton budget. ${LB_FR}`);
rep(`pis ton ancien téléphone, cash ou échange, ça baisse encore. On fait de notre mieux avec ton budget pis le modèle que tu cherches, pis on a une grande variété.`,
    `pis ton ancien téléphone, cash ou échange, ça baisse encore. ${INV_FR} On fait de notre mieux avec ton budget pis le modèle que tu cherches, pis on a une grande variété.`);
rep(`Avec ton budget pis le modèle que tu cherches, on fait de notre mieux, on a une grande variété. Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits avec, paiement par mois possible. Dis CAROL en arrivant. Tu passes cet après-midi ou à soir?`,
    `Avec ton budget pis le modèle que tu cherches, on fait de notre mieux, on a une grande variété. ${INV_FR} Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits avec, paiement par mois possible. Dis CAROL en arrivant. Tu passes cet après-midi ou à soir?`);

// ---- Examples: three new conversations (too expensive FR, too expensive EN, the budget that comes back) ----
const NEW_EXAMPLES = T(`Listing iPhone 16 Pro 256 Go, it is 14:00. Buyer: "c'est trop cher pour moi, j'ai 500 max"
First message: "Oui, le 16 Pro, on l'a, pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans, débloqué, pas de mauvaise surprise. iPhone 16 / 16 Pro / 16 Pro Max : à partir de 680 $ / 800 $ / 990 $, mais inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher aussi, on s'arrange au comptoir, dis juste CAROL en arrivant. Avec 500 $ t'as plein d'options chez nous, on t'aide à choisir la meilleure, pour le prix pis pour la qualité, celui qui a la meilleure batterie pis qui marche le mieux. On fait de notre mieux avec ton budget pis le modèle que tu cherches, pis on a une grande variété. Ton vieux téléphone, cash ou échange, ça baisse encore. Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits, paiement par mois possible. Tu passes cet après-midi ou à soir? @FOOT_FR@ @SHOP_FR@"

Listing Samsung Galaxy S24 Ultra 256GB, it is 16:00. Buyer: "too expensive for me, i only have 350"
First message: "The S24 Ultra is here and it's liquidation week, warranty up to 1 to 2 years, unlocked, no bad surprises. @SAMSUNG_INLINE@. Don't worry about the list prices: with your budget we find you lower prices too, we work it out at the counter, just say CAROL when you get here. With 350 you've got lots of options with us, we help you pick the best one, price and quality, the one with the best battery that works best. We do our best with your budget and the model you're looking for, and we've got a huge variety. Bring your old phone, cash or trade, it drops the price again. Students, newcomers and Montréal residents get an extra discount, accessories are free with it, and monthly payments are an option. This afternoon or tonight before 9pm? @FOOT_EN@ @SHOP_EN@"

Listing iPhone 17 Pro Max 256 Go, it is 15:00. Buyer, second message of the chat (the 17 line was sent in the first, with "si ton budget est plus bas, dis-le-moi"): "j'ai 900 max"
Second message: "Avec 900 $ t'as plein d'options chez nous. Inquiète-toi pas pour les prix de la liste: avec ton budget, on te trouve moins cher aussi, on s'arrange au comptoir, dis juste CAROL en arrivant pis je m'occupe de toi. Les prix à partir de sont juste au-dessus, le prix suit ce que tu choisis, remis à neuf, usagé ou neuf, pis la capacité, pis je te fais le prix liquidation dessus, la meilleure option avec ton budget, on peut négocier. Ton budget pis le modèle que tu cherches, on fait de notre mieux avec, pis y'a une grande variété en magasin. Garantie jusqu'à 1 à 2 ans, débloqué, pas de mauvaise surprise, pis je te sors celui avec la meilleure batterie, celui qui marche le mieux. Amène ton vieux téléphone, cash ou échange, ça baisse encore, pis avec CAROL t'as les accessoires gratuits, le rabais étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement par mois si tu veux. Passe à soir avant 21h ou demain dès 9h, je t'attends, pas besoin de rdv. @FOOT_FR@ @SHOP_FR@"`);
rep(T('@FOOT_FR@ @SHOP_FR@"`,'), T('@FOOT_FR@ @SHOP_FR@"') + NL + NL + NEW_EXAMPLES + "`,");

fs.writeFileSync(__dirname + "/teaching24.js", s);
const t = require(__dirname + "/teaching24.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)];
const BAD = /à confirmer|confirme au magasin|confirmer au magasin|en appelant|appelle pour|appelez pour|change avec les arrivages|dépend des arrivages|vérifies sur place|vérifie sur place|tu le vois sur place|on vérifie|se confirme au magasin|to confirm|to be confirmed|check at the shop|verify in person|call to check|exact model you see|availability to confirm|depends on arrivals|stock changes|ça change chaque jour|contactez-nous pour confirmer|centaines de demandes|hundreds of requests|pour l'instant|ça bouge|partent vite|ça rentre|vrais deals|partent en premier|Half the people|18 Pro Max : disponibles|Fifteen minutes|15 minutes/i;
const bad = msgs.filter((m) => BAD.test(m[2]));
const noShop = msgs.filter((m) => !/Beaubien/.test(m[2]));
const noFoot = msgs.filter((m) => !/premier arrivé premier servi|first come first served/.test(m[2]));
const twoQ = msgs.filter((m) => (m[2].match(/[?]/g) || []).length > 1);
const noBest = msgs.filter((m) => !/notre mieux|our best/.test(m[2]));
const budgetMsgs = msgs.filter((m) => /\b(300|350|400|500|900|150) ?\$? ?(cash|max|t'as|you've|avec)|budget c'est|je le prends à/i.test(m[2]));
const budgetNoLine = budgetMsgs.filter((m) => !/prix de la liste|list prices/.test(m[2]));
const all = Object.values(t).filter((v) => typeof v === "string").join(NL);
console.log("teaching24.js written", s.length, "| replacements:", nrep, "| examples:", msgs.length, "| bad phrases in examples:", bad.length, "| no shop line:", noShop.length, "| no footer:", noFoot.length, "| two questions:", twoQ.length, "| missing 'our best':", noBest.length, "| budget messages:", budgetMsgs.length, "| budget messages without the lower-budget line:", budgetNoLine.length, "| lower-budget line mentions in the boxes:", (all.match(/prix de la liste/g) || []).length);
for (const m of bad) console.log("BAD:", m[2].match(BAD)[0], "|", m[2].slice(0, 110));
for (const m of budgetNoLine) console.log("BUDGET-NO-LINE:", m[2].slice(0, 120));
if (bad.length || noShop.length || noFoot.length || twoQ.length) process.exit(1);
