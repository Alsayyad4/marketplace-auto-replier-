// Derives teaching20.js from teaching19.js (Nov 7 2026, owner's two additions — nothing replaced):
// 1. In BOTH messages: "we do our best with the budget you have and the model you are looking for", said in those general
//    words (never the model's name or their number inside that sentence), plus "we have a huge variety". The goal is never to
//    tell the buyer we cannot give the exact price: the goal is that the exact price stops being the question, because the
//    message is full of help (we lower the price, the best option with their budget, huge variety, every condition, a good
//    battery) and because they already have the block or the family line, so nothing is hidden. Never "I can't give you the
//    exact price". Rules in Business info, Instructions (pack 4, checklist 4, words, price part, steps, toolbox, situations),
//    Closer goals; one rotating sentence inserted into every example message right after its price-help sentence.
// 2. The iPhone promo block got new prices (owner's paste, spacing normalised to "N $"; the 17 line has no availability tail
//    any more; the 18 line, which is a rule and not a price, is kept).
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching19.js", "utf8");
function rep(a, b, all) {
  const n = s.split(a).length - 1;
  if (n === 0) { console.error("MISSING anchor:", a.slice(0, 100)); process.exit(1); }
  if (n > 1 && !all) { console.error("AMBIGUOUS anchor (" + n + "):", a.slice(0, 100)); process.exit(1); }
  s = s.split(a).join(b);
  return n;
}
s = "// Twentieth pass (Nov 7 2026): \"we do our best with your budget and the model you're looking for\" + huge variety in both\n" +
    "// messages, the exact price never refused but made unnecessary, new iPhone prices. Based on the nineteenth pass:\n" + s;
rep("settings19.json", "settings20.json");

// ---- 2. iPhone prices (every occurrence: the list, the prose, the examples)
const PRICE = [
  ["iPhone 11 / 11 Pro / 11 Pro Max : à partir de 180 $ / 220 $ / 280 $", "iPhone 11 / 11 Pro / 11 Pro Max : à partir de 180 $ / 220 $ / 300 $"],
  ["iPhone 12 / 12 Pro / 12 Pro Max : à partir de 200 $ / 280 $ / 340 $", "iPhone 12 / 12 Pro / 12 Pro Max : à partir de 200 $ / 280 $ / 360 $"],
  ["iPhone 13 / 13 Pro / 13 Pro Max : à partir de 240 $ / 350 $ / 400 $", "iPhone 13 / 13 Pro / 13 Pro Max : à partir de 280 $ / 380 $ / 490 $"],
  ["iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 530 $", "iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 450 $ / 550 $"],
  ["iPhone 15 / 15 Pro / 15 Pro Max : à partir de 450 $ / 580 $ / 750 $", "iPhone 15 / 15 Pro / 15 Pro Max : à partir de 450 $ / 600 $ / 750 $"],
  ["iPhone 16 / 16 Pro / 16 Pro Max : à partir de 650 $ / 750 $ / 950 $", "iPhone 16 / 16 Pro / 16 Pro Max : à partir de 680 $ / 800 $ / 990 $"],
  ["Série iPhone 17 / 17 Pro / 17 Pro Max : à partir de 900 $ / 1200 $ / 1400 $, appelez pour vérifier la disponibilité", "Série iPhone 17 / 17 Pro / 17 Pro Max : à partir de 1040 $ / 1300 $ / 1480 $"],
  ["iPhone 17 series: starting prices 900 $ / 1200 $ / 1400 $", "iPhone 17 series: starting prices 1040 $ / 1300 $ / 1480 $"],
];
const priceHits = PRICE.map(([a, b]) => a.split(" : ")[0].split(":")[0].trim() + "=" + rep(a, b, true));

// ---- 1a. Business info
rep("THE MENU. What we have is said as a choice:",
    "WHAT THE TWO MESSAGES DO WITH THE EXACT PRICE. The goal is never to tell a buyer that we cannot give them the exact price, and never to make them feel it is withheld: the goal is that they stop asking, because the message is full of help. In every message, the first and the second, say that we will do our best with the budget they have and the model they are looking for, in those general words (\"on fait de notre mieux avec ton budget pis le modèle que tu cherches\" / \"we do our best with your budget and the model you're looking for\"), never with the model's name or their number inside that sentence; that we lower the price for them; that we find them the best option with their budget; that we have a huge variety (\"on a une grande variété\" / \"we've got a huge variety\"); all the conditions in their favour (the warranty, up to 1 to 2 years, the trade-in, the extra discount, the free accessories, monthly payments, CAROL); and that we help them find one with a good battery. And they already have the whole promo block of the brand or category they asked about, or the family line of their iPhone, so nothing is mysterious: they have an idea of the price already, and the visit is where it is settled in their favour. Never \"I can't give you the exact price\", never \"je peux pas te dire le prix exact\", never \"on donne pas les prix exacts\": the exact price is never refused, it is made unnecessary.\nTHE MENU. What we have is said as a choice:");
rep("and with your budget you have lots of options with us, we help you choose the best one, we have so many options, it is liquidation, and you leave with the warranty, up to 1 to 2 years.",
    "and with your budget you have lots of options with us, we do our best with your budget and the model you're looking for (those general words, never the model's name in that sentence), we have a huge variety, we help you choose the best one, we have so many options, it is liquidation, and you leave with the warranty, up to 1 to 2 years.");
rep("then: with X $ you have lots of options with us, we help you choose the best one, we have so many options, we help with the price and the quality, it is liquidation, and you leave with the warranty, up to 1 to 2 years.",
    "then: with X $ you have lots of options with us, we do our best with your budget and the model you're looking for (in those words, not the model's name), huge variety, we help you choose the best one, we have so many options, we help with the price and the quality, it is liquidation, and you leave with the warranty, up to 1 to 2 years.");
rep("the price was sent, the visit is for the choice and the negotiation.)",
    "the price was sent, the visit is for the choice and the negotiation; never \"I can't give you the exact price\" either: say instead that we do our best with their budget and the model they are looking for, that we have a huge variety, and that we find them the best option.)");

// ---- 1b. Instructions
rep("very flexible, adjusted to their budget, we take care of them. And we help with the quality too, in every message:",
    "very flexible, adjusted to their budget, we take care of them. We do our best with the budget they have and the model they are looking for, said in those general words, never the model's name or their number in that sentence, and we have a huge variety. And we help with the quality too, in every message:");
rep("in both, we help with the quality too: the one with the best battery, the one that works best;",
    "in both, we do our best with their budget and the model they are looking for (general words, no model name, no number in that sentence) and we have a huge variety; in both, we help with the quality too: the one with the best battery, the one that works best;");
rep("\"le prix exact je te le dis au comptoir\": the buyer hears bait and leaves.",
    "\"le prix exact je te le dis au comptoir\": the buyer hears bait and leaves. Never \"I can't give you the exact price\", \"je peux pas te donner le prix exact\", \"on donne pas les prix exacts\", or any sentence about what we cannot do: the exact price is never refused, it is made unnecessary by the help (we do our best with their budget and the model they are looking for, we lower the price, we find the best option, huge variety, every condition, a good battery), and they already have the block or the family line, so nothing is hidden.");
rep("Warm, as help, never as a refusal. Never \"the exact price is only given at the shop\"",
    "Warm, as help, never as a refusal, never a sentence about what we cannot do: we do our best with their budget and the model they are looking for, we have a huge variety, and they already have the starting prices. Never \"I can't give you the exact price\", never \"the exact price is only given at the shop\"");
rep("on en a tellement\", it is liquidation, warranty up to 1 to 2 years; then the trade-in",
    "on en a tellement\", \"on fait de notre mieux avec ton budget pis le modèle que tu cherches, on a une grande variété\" (those general words, never the model's name or their number inside that sentence), it is liquidation, warranty up to 1 to 2 years; then the trade-in");
rep("and their old phone is taken, cash or trade; and the quality too: we find them the one with the best battery and the one that works best; the phones are unlocked, no bad surprises.",
    "and their old phone is taken, cash or trade; we do our best with the budget they have and the model they are looking for (those general words, never the model's name or their number in that sentence) and we have a huge variety; and the quality too: we find them the one with the best battery and the one that works best; the phones are unlocked, no bad surprises.");
rep("2. Whatever they asked, remind them in a few words that the starting prices are just above and that we will help them, make them the liquidation price and find them the best option at the price they are looking for.",
    "2. Whatever they asked, remind them in a few words that the starting prices are just above and that we will help them, make them the liquidation price and find them the best option at the price they are looking for. Say that we do our best with their budget and the model they are looking for, in general words, and that we have a huge variety: that is what makes the exact price stop mattering, never a sentence about what we cannot say.");
rep("- All our phones are unlocked, no bad surprises. \"Tout est débloqué, pas de mauvaise surprise.\"",
    "- All our phones are unlocked, no bad surprises. \"Tout est débloqué, pas de mauvaise surprise.\"\n- We do our best with the budget they have and the model they are looking for, and we have a huge variety. \"On fait de notre mieux avec ton budget pis le modèle que tu cherches, on a une grande variété.\" / \"We do our best with your budget and the model you're looking for, and we've got a huge variety.\"");
rep("with your budget you have lots of options with us, we help you choose the best one, price and quality, warranty, then the pack and the invitation to come and check.",
    "with your budget you have lots of options with us, we do our best with your budget and the model you're looking for (general words, never the model's name in that sentence), huge variety, we help you choose the best one, price and quality, warranty, then the pack and the invitation to come and check.");
rep("the asked-twice answer from THE PRICE PART, then the rest of the pack and the close. Never a refusal, never \"only at the shop\".",
    "the asked-twice answer from THE PRICE PART, then the rest of the pack and the close. Never a refusal, never \"only at the shop\", never \"I can't give you the exact price\": we do our best with their budget and the model they are looking for, huge variety, the best option.");

// ---- 1c. Closer goals
rep("help with the price and with the quality, never a percentage, never one unit promised; the phones are unlocked, no bad surprises.",
    "help with the price and with the quality, never a percentage, never one unit promised; the phones are unlocked, no bad surprises. Every message also says, in general words, that we do our best with the budget they have and the model they are looking for (never the model's name or their number inside that sentence) and that we have a huge variety. The goal is never to tell a buyer we cannot give the exact price: the goal is that the exact price stops being the question, because the message is full of help (we lower the price, we find the best option with their budget, huge variety, every condition in their favour, a good battery) and because they already have the block or the family line, so nothing is hidden.");
rep("Never \"the exact price is only given at the shop\" or \"come by for the price\": that reads as bait and scares buyers away.",
    "Never \"the exact price is only given at the shop\", \"come by for the price\" or \"I can't give you the exact price\": that reads as bait and scares buyers away.");

// ---- 1d. Examples: one rotating sentence in every message, right after its price-help sentence
const FR_VAR = [
  "On fait de notre mieux avec ton budget pis le modèle que tu cherches, pis on a une grande variété.",
  "Ton budget pis le modèle que tu cherches, on fait de notre mieux avec, pis y'a une grande variété en magasin.",
  "On a une grande variété, pis on fait de notre mieux avec ton budget pis le modèle que tu cherches.",
  "Avec ton budget pis le modèle que tu cherches, on fait de notre mieux, on a une grande variété.",
];
const FR_NOVAR = [
  "On fait de notre mieux avec ton budget pis le modèle que tu cherches.",
  "Ton budget pis le modèle que tu cherches, on fait de notre mieux avec.",
];
const EN_VAR = [
  "We do our best with your budget and the model you're looking for, and we've got a huge variety.",
  "Your budget and the model you want, we do our best with that, and there's a big variety in store.",
  "Big variety in store, and we do our best with your budget and the model you're after.",
  "With your budget and the model you're looking for, we do our best, and we've got lots of variety.",
];
const EN_NOVAR = [
  "We do our best with your budget and the model you're looking for.",
  "Your budget and the model you want, we do our best with that.",
];
const KEY = /baisse le prix|arranger le prix|prix liquidation|bring the price down|liquidation price|arrange the price/i;
const SELLER = /on achète|rachat|spécialiste reprise|montant exact|we buy|buyback/i;
const VARIETY = /tellement|plein d'options|variété|variety|so many|lots of options/i;
let iFr = 0, iEn = 0, iFrN = 0, iEnN = 0, touched = 0, untouched = [];
s = s.replace(/((?:First|Second) message: ")([^"]+)(")/g, (m, pre, text, post) => {
  const fr = /garantie|pis /i.test(text) && !/warranty/i.test(text);
  const seller = SELLER.test(text);
  const key = seller ? /garantie jusqu'à 1 à 2 ans|warranty,? up to 1 to 2 years/i : KEY;
  const k = text.match(key);
  if (!k) { untouched.push("NOKEY " + text.slice(0, 60)); return m; }
  const endRe = /[.!?](?=\s)/g;
  endRe.lastIndex = k.index + k[0].length;
  const e = endRe.exec(text);
  if (!e) { untouched.push("NOEND " + text.slice(0, 60)); return m; }
  const noVar = VARIETY.test(text);
  const clause = fr ? (noVar ? FR_NOVAR[iFrN++ % FR_NOVAR.length] : FR_VAR[iFr++ % FR_VAR.length])
                    : (noVar ? EN_NOVAR[iEnN++ % EN_NOVAR.length] : EN_VAR[iEn++ % EN_VAR.length]);
  touched++;
  const cut = e.index + 1;
  return pre + text.slice(0, cut) + " " + clause + text.slice(cut) + post;
});

fs.writeFileSync(__dirname + "/teaching20.js", s);
const t = require(__dirname + "/teaching20.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const checks = {
  warranty: /garantie|warranty/i, tradein: /reprend|trade|échang|exchange|amène/i, discount: /étudiant|student/i, accessories: /accessoires|accessories/i,
  monthly: /mensuel|monthly|par mois|per month/i, carol: /CAROL/, footer: /Quantités limitées|Limited quantities/, shop: /Beaubien E/, hours: /9h à 21h|9am to 9pm/,
  liquidation: /liquidation/i, phone: /4️⃣3️⃣8️⃣8️⃣0️⃣/, battery: /batterie|battery/i, trust: /débloqu|unlocked|surprise/i,
  ourbest: /notre mieux|our best/i, pricehelp: /baisse le prix|arranger le prix|prix liquidation|bring the price down|liquidation price|meilleur prix/i,
};
let bad = 0, twoQ = 0;
for (const m of msgs) {
  const seller = /Le montant exact|comptant sur place/.test(m.text);
  const miss = Object.keys(checks).filter((k) => !checks[k].test(m.text) && !(seller && !["ourbest", "footer", "shop", "phone", "hours"].includes(k)));
  if (m.kind === "First" && !seller && !/semaine de liquidation|liquidation week/.test(m.text)) miss.push("liquidation-week");
  if (/\d+\s?%/.test(m.text.replace(/20 (?:à|to) 40 %/g, "")) && /batter/i.test(m.text)) miss.push("BATTERY-PERCENT");
  if ((m.text.match(/\?/g) || []).length > 1) twoQ++;
  if (miss.length) { bad++; console.log("  MISSING", miss.join(","), "|", m.kind, m.text.slice(0, 60)); }
}
// every family line written in the examples must be a line of the new list
const lines = t.priceList.split("\n").filter((l) => /^(Série )?iPhone/.test(l));
const stale = [...t.examples.matchAll(/(?:Série )?iPhone [^·"]*?à partir de [^·"]+?(?= ·|,|\.| pis| and|")/g)].map((m) => m[0]).filter((l) => !lines.some((x) => x.startsWith(l) || l.startsWith(x)));
const oldNums = ["/ 530 $", "/ 580 $", "240 $ / 350 $", "650 $ / 750 $", "900 $ / 1200 $", "appelez pour vérifier"].filter((x) => s.includes(x));
const banned = (t.examples.match(/\b(condition|état|grade)\b/gi) || []).filter((w) => !/conditions/i.test(w)).length;
const cant = (s.match(/je peux pas te (?:dire|donner) le prix|I can't give you the exact price|can't tell you the exact/gi) || []).length;
console.log("teaching20.js written", s.length, "| examples:", msgs.length, "| clauses inserted:", touched, "| untouched:", untouched.length ? untouched : 0,
  "| missing:", bad, "| two questions:", twoQ, "| stale family lines in examples:", stale.length ? stale : 0, "| old numbers left:", oldNums.length ? oldNums : 0,
  "| condition/état/grade:", banned, "| price replacements:", priceHits.join(" "), "| 'can't' only as banned phrases:", cant);
