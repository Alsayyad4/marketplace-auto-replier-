// Derives teaching17.js from teaching16.js (Oct 30 2026, owner): (1) the first message says it is
// LIQUIDATION WEEK and that we will bring the price down for them or help them with it, naturally;
// (2) the new iPhone price list (11 series 180/220/280, 14 Pro Max 530, 15 Pro 580, 15 Pro Max 750;
// the rest unchanged) replaces the old one everywhere. Nothing else changes.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching16.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 120)); process.exit(1); } s = s.split(a).join(b); };

rep("// Sixteenth pass (Oct 25 2026):", "// Seventeenth pass (Oct 30 2026): the first message says it is liquidation week and that we bring the price down for them or help them with it; the owner's new iPhone list (11: 180/220/280, 14 Pro Max 530, 15 Pro 580, 15 Pro Max 750). Based on the sixteenth pass:");
rep("settings16.json", "settings17.json");

// ---- the new iPhone starting prices, everywhere the old numbers are written
rep("150 $ / 180 $ / 220 $", "180 $ / 220 $ / 280 $");
rep("300 $ / 400 $ / 500 $", "300 $ / 400 $ / 530 $");
rep("450 $ / 550 $ / 700 $", "450 $ / 580 $ / 750 $");
rep("the 14 Pro Max is 500 $", "the 14 Pro Max is 530 $");

// ---- Business info
rep("Everything is in liquidation: prices 20 to 40 % below the usual price. That is why it is cheap.",
    "Everything is in liquidation and it is liquidation week (\"c'est la semaine de liquidation\" / \"it's liquidation week\"): prices 20 to 40 % below the usual price. That is why it is cheap. The first message always says it is liquidation week and that we will bring the price down for them, or help them with it, at the counter (\"on te baisse le prix\", \"on t'aide avec le prix\", \"we'll bring it down for you\").");

// ---- Instructions
rep("1. The model from the post, available, in liquidation, 20 to 40 % below the usual price.",
    "1. The model from the post, available, and it is liquidation week (\"c'est la semaine de liquidation\" / \"it's liquidation week\"), 20 to 40 % below the usual price.");
rep("4. At the counter we help them find the best price and the best option, we negotiate, very flexible, adjusted to their budget: we take care of them.",
    "4. At the counter we bring the price down for them, or help them with it: we find them the best price and the best option, we negotiate, very flexible, adjusted to their budget, we take care of them.");
rep("1. the model, available, in liquidation (20 to 40 % below);", "1. the model, available, and it is liquidation week (20 to 40 % below);");
rep("4. the promise: we help you, we make you the liquidation price and we find you the best option at the price you want, negotiable;",
    "4. the promise: in the first, we will bring the price down for you or help you with it at the counter; in the second, we help you, we make you the liquidation price and we find you the best option at the price you want, negotiable;");
rep("1. Name the model from the post (or the model they name): available, in liquidation (20 to 40 % below the usual price), with the warranty, up to 1 to 2 years.",
    "1. Name the model from the post (or the model they name): available, and it is liquidation week (\"c'est la semaine de liquidation\" / \"it's liquidation week\", 20 to 40 % below the usual price), with the warranty, up to 1 to 2 years.");
rep("3. The promise, in a few words: at the counter we negotiate, adjusted to their budget, and their old phone is taken, cash or trade.",
    "3. The promise, in a few words, in every first message: we will bring the price down for them, or help them with it, at the counter, adjusted to their budget (\"on te baisse le prix\", \"on t'aide avec le prix\", \"we'll bring it down for you\"), and their old phone is taken, cash or trade.");
rep("- At the counter the price is negotiable and we adjust to their budget. \"Au comptoir on s'arrange selon ton budget.\"",
    "- It is liquidation week. \"C'est la semaine de liquidation.\" / \"It's liquidation week.\"\n- At the counter the price is negotiable and we adjust to their budget. \"Au comptoir on s'arrange selon ton budget.\"");

// ---- Closer goals
rep("The first message proves we know what they want, gives the family line or the block as the starting prices (nothing about what the exact price depends on), promises the price help and the trade-in,",
    "The first message proves we know what they want, says it is liquidation week, gives the family line or the block as the starting prices (nothing about what the exact price depends on), promises that we will bring the price down for them or help them with it, and the trade-in,");

// ---- Examples: every first message says liquidation week + we bring the price down / help
rep("iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 530 $, en liquidation, garantie jusqu'à 1 à 2 ans. Si t'as un vieux téléphone amène-le, on le reprend cash ou en échange, pis au comptoir on s'arrange selon ton budget.",
    "iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 530 $, c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans. Si t'as un vieux téléphone amène-le, on le reprend cash ou en échange, pis au comptoir on te baisse le prix, on s'arrange selon ton budget.");
rep("The 13 is in liquidation with the warranty, up to 1 to 2 years, and here's the whole list:",
    "It's liquidation week, the 13 comes with the warranty, up to 1 to 2 years, and here's the whole list:");
rep("We negotiate at the counter and adjust to your budget, and if you've got an old phone bring it,",
    "At the counter we bring the price down for you and adjust to your budget, and if you've got an old phone bring it,");
rep("The S24 Ultra is here, in liquidation, warranty up to 1 to 2 years.", "The S24 Ultra is here, it's liquidation week, warranty up to 1 to 2 years.");
rep("In person we negotiate to your budget, and your old phone brings it down more, cash or trade.",
    "In person we bring the price down for you, to your budget, and your old phone brings it down more, cash or trade.");
rep("Le A26 est là, oui, en liquidation avec garantie jusqu'à 1 à 2 ans.", "Le A26 est là, oui, pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans.");
rep("Au comptoir on s'arrange selon ton budget, pis si t'as un vieux téléphone on le reprend, cash ou en échange.",
    "Au comptoir on te baisse le prix, on s'arrange selon ton budget, pis si t'as un vieux téléphone on le reprend, cash ou en échange.");
rep("Oui, pis c'est le bon moment: ${LAPTOP_INLINE}. Le modèle exact tu le vois sur place, on s'arrange selon ton budget, garantie jusqu'à 1 à 2 ans.",
    "Oui, pis c'est la semaine de liquidation: ${LAPTOP_INLINE}. Le modèle exact tu le vois sur place, on te baisse le prix selon ton budget, garantie jusqu'à 1 à 2 ans.");
rep("Le 15 Pro est en liquidation, garantie jusqu'à 1 à 2 ans, iPhone 15 / 15 Pro / 15 Pro Max : à partir de 450 $ / 580 $ / 750 $, pis sur place je t'arrange le prix selon ton budget.",
    "Le 15 Pro est là pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans, iPhone 15 / 15 Pro / 15 Pro Max : à partir de 450 $ / 580 $ / 750 $, pis sur place je te baisse le prix selon ton budget.");
rep("Les deux, neufs pis usagés testés, les meilleures qualités, le 15 Pro est en liquidation avec garantie jusqu'à 1 à 2 ans.",
    "Les deux, neufs pis usagés testés, les meilleures qualités, pis c'est la semaine de liquidation sur le 15 Pro, garantie jusqu'à 1 à 2 ans.");
rep("Je te trouve une bonne qualité, pas de souci, pis je t'arrange le prix au comptoir selon ton budget. Si t'as un ancien téléphone, cash ou échange.",
    "Je te trouve une bonne qualité, pas de souci, pis je te baisse le prix au comptoir selon ton budget. Si t'as un ancien téléphone, cash ou échange.");
rep("Tout est en liquidation avec garantie jusqu'à 1 à 2 ans, pis au comptoir on s'arrange selon ton budget.",
    "C'est la semaine de liquidation sur tout, garantie jusqu'à 1 à 2 ans, pis au comptoir on te baisse le prix selon ton budget.");
rep("Si tu l'échanges contre un téléphone en liquidation avec garantie jusqu'à 1 à 2 ans, tu paies juste la différence, accessoires gratuits pis rabais en plus.",
    "C'est la semaine de liquidation: si tu l'échanges contre un plus récent, garantie jusqu'à 1 à 2 ans, tu paies juste la différence pis on te baisse le prix, accessoires gratuits pis rabais en plus.");

fs.writeFileSync(__dirname + "/teaching17.js", s);
const t = require(__dirname + "/teaching17.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const checks = {
  warranty: /garantie|warranty/i, tradein: /reprend|trade|échang|exchange|amène/i, discount: /étudiant|student/i, accessories: /accessoires|accessories/i,
  monthly: /mensuel|monthly|par mois|per month/i, carol: /CAROL/, footer: /Quantités limitées|Limited quantities/, shop: /Beaubien E/, hours: /9h à 21h|9am to 9pm/,
  liquidation: /liquidation/i, phone: /4️⃣3️⃣8️⃣8️⃣0️⃣/,
};
let bad = 0;
for (const m of msgs) {
  if (/Le montant exact/.test(m.text)) continue;
  const miss = Object.keys(checks).filter((k) => !checks[k].test(m.text));
  if (m.kind === "First" && !/semaine de liquidation|liquidation week/.test(m.text)) miss.push("liquidation-week");
  if (m.kind === "First" && !/baisse le prix|bring the price down|bring it down/.test(m.text)) miss.push("bring-down");
  if (miss.length) { bad++; console.log("  MISSING", miss.join(","), "|", m.kind, m.text.slice(0, 50)); }
}
const old = (Object.values(t).join("\n").match(/150 \$ \/ 180 \$|400 \$ \/ 500 \$|550 \$ \/ 700 \$/g) || []).length;
console.log("teaching17.js written", s.length, "| examples:", msgs.length, "| missing:", bad, "| old prices left:", old, "| price list:", t.priceList.split("\n").slice(0, 9).join(" | "));
