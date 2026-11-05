// Derives teaching18.js from teaching17.js (Nov 5 2026, owner):
// 1. THE MENU: what the exact price follows is said as a choice the buyer makes at the counter —
//    refurbished, used or brand new; 128, 256 or 512 GB — in the second message and the rules, never as
//    a warning, never a grade or capacity promised at a price, never a battery percentage.
// 2. The owner's NEW Samsung list replaces the old block (S24 / S25 FE / S25 Plus, Z Flip/Fold from 350,
//    S22-S25 Ultra line); the asked model (S25 / S26 Ultra…) is named as available first, then the whole list.
// 3. iPad and tablets become their own block (new prices); brand-new sealed iPads are a fact to say.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching17.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 120)); process.exit(1); } s = s.split(a).join(b); };

rep("// Seventeenth pass (Oct 30 2026):", "// Eighteenth pass (Nov 5 2026): THE MENU (refurbished / used / brand new, 128 / 256 / 512 GB, said as a choice in the second message), the owner's new Samsung list (asked model named first), the iPad and tablet block with brand-new sealed iPads. Based on the seventeenth pass:");
rep("settings17.json", "settings18.json");

// ---- the blocks
const a = s.indexOf("const SAMSUNG_BLOCK_LINES = ["), b = s.indexOf("];", a) + 2;
if (a < 0) { console.error("samsung block not found"); process.exit(1); }
s = s.slice(0, a) + `const SAMSUNG_BLOCK_LINES = [
  "Telephone Neuf 60$ -120$",
  "Samsung Neuf à partir de 90$-140$",
  "Samsung A16 A17-A26-A36-A56",
  "Samsung s10- s22-s22 plus - S23 plus samsung s24 / s25 fe s25 plus",
  "A partir de (140$-200$- 300)",
  "Samsung S10 -S20 - S20 Ultra - S21 Ultra S22 Ultra : a partir de (200$-250-350$)",
  "Samsung z flip / fold a partir de 350$ 5-6-7-9-10 disponible",
  "Samsung serie s26 / ultra disponible",
  "S22 Ultra s23 Ultra - s24 Ultra - S25 Ultra",
  "a partir de 450$-550$-700",
];
const TABLET_BLOCK_LINES = [
  "Tablette Neuf 75$",
  "Tablette Samsung a partir de 60$-150$",
  "iPad a partir de 80$",
  "iPad air / pro a partir de 80$-160$ (liquidation)",
];
const TABLET_INLINE = "Tablettes et iPad : " + TABLET_BLOCK_LINES.join(" · ");` + s.slice(b);
rep("const SAMSUNG_INLINE = \"Voici la liste complète de prix des Samsung disponibles : \" + SAMSUNG_BLOCK_LINES.join(\" · \");",
    "const SAMSUNG_INLINE = \"Liquidation Samsung : \" + SAMSUNG_BLOCK_LINES.join(\" · \");");
rep("Voici la liste complète de prix des Samsung disponibles :\n${SAMSUNG_BLOCK_LINES.join(\"\\n\")}\n${LAPTOP_BLOCK_LINES.join(\"\\n\")}",
    "Liquidation Samsung :\n${SAMSUNG_BLOCK_LINES.join(\"\\n\")}\nTablettes et iPad :\n${TABLET_BLOCK_LINES.join(\"\\n\")}\n${LAPTOP_BLOCK_LINES.join(\"\\n\")}");

// ---- the menu, everywhere the price explanation is worded
rep("follows the buyer's choice: used or brand new, the capacity, a few other details.", "follows the buyer's choice: refurbished, used or brand new, and the capacity, 128, 256 or 512 GB.");
rep("(used or brand new, capacity, a few other details)", "(refurbished, used or brand new, and 128, 256 or 512 GB)");
rep("the capacity, used or brand new and a few other details", "refurbished, used or brand new, and the capacity, 128, 256 or 512 GB");
rep("the capacity, used or brand new, a few other details", "refurbished, used or brand new, and the capacity, 128, 256 or 512 GB");
rep("follows their choice, used or brand new and the capacity, negotiated at the counter", "follows their choice, refurbished, used or brand new and the capacity, 128, 256 or 512 GB, negotiated at the counter");
rep("the exact one follows their choice, capacity, used or brand new, other details,", "the exact one follows their choice, refurbished, used or brand new, 128, 256 or 512 GB,");
rep("we have the best quality available, used or brand new, tested,", "we have all three, refurbished, used and brand new, every capacity, tested,");
rep("We have the best quality available, used or brand new, tested, with the warranty", "We have all three, refurbished, used and brand new, every capacity, tested, with the warranty");
rep("say we have the best quality available, it comes with the warranty,", "say we have all three, refurbished, used and brand new, every capacity, the best quality available, it comes with the warranty,");
rep("We sell used and brand-new phones:", "We sell refurbished, used and brand-new phones, in 128, 256 or 512 GB:");
rep("Words: say \"usagé ou neuf\" / \"used or brand new\" and \"capacité\" / \"storage\".", "Words: say \"remis à neuf, usagé ou neuf\" / \"refurbished, used or brand new\" and \"capacité, 128, 256 ou 512 Go\" / \"storage, 128, 256 or 512 GB\", as a menu the buyer chooses from.");
rep("(they hear \"maybe a broken one\": say \"usagé ou neuf\" / \"used or brand new\" and \"capacité\" / \"storage\")", "(they hear \"maybe a broken one\": say \"remis à neuf, usagé ou neuf\" / \"refurbished, used or brand new\" and \"128, 256 ou 512 Go\", as a menu)");
rep("Q: Is it new or used? Is it sealed? → We have both, used and brand new, the best quality available,", "Q: Is it new or used? Is it sealed? → We have all three, refurbished, used and brand new, in 128, 256 or 512 GB, the best quality available (iPads: brand-new sealed ones too),");
rep("All the colours and capacities are shown at the shop, they come in all the time; never promise one specific unit in the chat.", "All the colours and capacities, 128, 256 or 512 GB, are shown at the shop, they come in all the time; never promise one specific unit, grade or capacity at a price in the chat.");
rep("Samsung, Z Flip and Z Fold, Pixel, iPad, tablets and laptops: no price per model. Their prices are the promo block (in the price list), sent whole, as written, with its starting prices: that block is the price we give, for a Pixel or an iPad as much as for a Samsung.",
    "Samsung, Z Flip and Z Fold and Pixel: the Samsung block. iPad and tablets: the iPad and tablet block. Laptops: the laptop block. No price per model: the block is the price we give, sent whole, as written, with its starting prices. For a Samsung, name the model they asked (S25 Ultra, S26 Ultra, A26, Z Flip…) as there and in liquidation week FIRST, in one sentence, then the whole list: a buyer who asked for one model must read that it is available before the list. iPads: we also have brand-new sealed iPads; say it when they ask about an iPad.");
rep("Laptops: Core i5, i7 and i9, SSD 512 Go or 1 To, 80 $ to 220 $, liquidation for 6 days only",
    "THE MENU. What we have is said as a choice: refurbished, used or brand new (\"remis à neuf, usagé ou neuf\"), in 128, 256 or 512 GB, all shown at the counter, and the price follows what the buyer picks. That is how the second message explains the price: a menu they choose from, said warmly, never a warning. Never \"the starting price is for the refurbished one\", never which grade or capacity sits at which price, never a battery percentage, never a promise that a given grade or capacity is in stock at a given price: they see every option at the counter and we find them a good one, at the price they are looking for.\nLaptops: Core i5, i7 and i9, SSD 512 Go or 1 To, 80 $ to 220 $, liquidation for 6 days only");

// ---- Instructions
rep("3. The price part: the family line (iPhone) or the block (Samsung, Pixel, iPad, tablets, laptops); in the second message only if it is not already in the chat.",
    "3. The price part: the family line (iPhone), the Samsung block (Samsung, Z Flip, Z Fold, Pixel), the iPad and tablet block, or the laptop block; in the second message only if it is not already in the chat.");
rep("3. the price: the family line or the block in the first; \"the starting prices are just above\" plus what the exact price depends on in the second;",
    "3. the price: the family line or the block in the first; in the second, \"the starting prices are just above\" plus the menu, refurbished, used or brand new, 128, 256 or 512 GB, the price follows the pick;");
rep("- Samsung, Z Flip, Z Fold, tablets, iPad, laptops: the promo block is the answer, sent whole and as written, lines joined by \" · \".",
    "- Samsung, Z Flip, Z Fold, Pixel: the Samsung block; iPad and tablets: the iPad and tablet block; laptops: the laptop block. The block is the answer, sent whole and as written, lines joined by \" · \", right after one sentence that names the model they asked as there and in liquidation week (\"Oui, le S25 Ultra est là, pis c'est la semaine de liquidation\"): an S25 or S26 Ultra buyer reads that their phone is available before the list. iPad: say we have brand-new sealed ones too.");
rep("Samsung, Pixel, iPad, tablets, laptops: always the whole block, never one model's number.",
    "Samsung, Pixel, iPad, tablets, laptops: always the whole block, never one model's number.\n- THE MENU, how the price explanation is said (second message only): as a choice they make at the counter, never as a warning. \"On a les trois, remis à neuf, usagé ou neuf, en 128, 256 ou 512 Go, pis le prix suit ce que tu choisis, je te fais le prix liquidation sur ce que tu prends.\" / \"We've got all three, refurbished, used or brand new, in 128, 256 or 512 GB, and the price follows what you pick, I make you the liquidation price on it.\" Never \"à partir de c'est le remis à neuf\", never which grade or capacity is at which price, never a battery percentage, never a promise that a given grade or capacity is in stock: they see them all at the counter and we find them a good one.");
rep("2. The price part: the family line (iPhone) or the block (Samsung, Pixel, iPad, tablets, laptops), always in the first message, as the starting prices, \"à partir de\".",
    "2. The price part: the family line (iPhone), the Samsung block, the iPad and tablet block or the laptop block, always in the first message, as the starting prices, \"à partir de\" (a Samsung or an iPad: the model named as there, then the whole block).");

// ---- Closer goals
rep("The ad price is never mentioned to a buyer.",
    "The ad price is never mentioned to a buyer. The menu (refurbished, used or brand new; 128, 256 or 512 GB) is said as a choice the buyer makes at the counter: it is what makes the starting price honest and the visit natural; never as a warning, never with a grade or capacity promised at a price, never a battery percentage.");

// ---- Examples: the menu wording, and two new conversations (S25 Ultra, iPad)
rep("dépend de ce que tu choisis, usagé ou neuf pis la capacité", "dépend de ce que tu choisis, remis à neuf, usagé ou neuf, pis la capacité, 128, 256 ou 512 Go");
rep("dépend de ton choix, usagé ou neuf pis la capacité", "dépend de ton choix, remis à neuf, usagé ou neuf, pis la capacité, 128, 256 ou 512 Go");
rep("Le prix exact dépend de ton choix, la capacité, usagé ou neuf, pis deux trois détails.", "Le prix exact dépend de ton choix, remis à neuf, usagé ou neuf, pis la capacité, 128, 256 ou 512 Go.");
rep("the exact one follows what you pick, used or new and the storage,", "the exact one follows what you pick, refurbished, used or brand new, and the storage, 128, 256 or 512 GB,");
rep("The exact price depends on what you pick, storage, used or brand new, a couple of details.", "The exact price depends on what you pick, refurbished, used or brand new, and the storage, 128, 256 or 512 GB.");
rep("Les deux, neuf pis usagé, les meilleures qualités, garantie jusqu'à 1 à 2 ans dans les deux cas.", "Les trois, remis à neuf, usagé pis neuf, les meilleures qualités, garantie jusqu'à 1 à 2 ans dans tous les cas.");
rep("Used and brand new, both with the warranty, up to 1 to 2 years. The starting prices are above,", "Refurbished, used and brand new, all with the warranty, up to 1 to 2 years. The starting prices are above,");
rep("Les deux, neufs pis usagés testés, les meilleures qualités, pis c'est la semaine de liquidation sur le 15 Pro,", "Les trois, remis à neuf, usagés pis neufs, testés, les meilleures qualités, pis c'est la semaine de liquidation sur le 15 Pro,");
rep("Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"",
    "Listing Samsung Galaxy S25 Ultra 256GB, it is 15:30. Buyer: \"le s25 ultra est dispo? c'est combien?\"\n" +
    "First message: \"Oui, le S25 Ultra est là, pis c'est la semaine de liquidation, garantie jusqu'à 1 à 2 ans. ${SAMSUNG_INLINE}. Au comptoir on te baisse le prix, on s'arrange selon ton budget, pis ton vieux téléphone on le reprend, cash ou en échange. Étudiant, nouvel arrivant ou résident de Montréal, rabais en plus, accessoires gratuits avec, paiement par mois possible. Dis CAROL en arrivant. Tu passes cet après-midi ou à soir? ${FOOT_FR} ${SHOP_FR}\"\n" +
    "Buyer: \"ok mais le s25 ultra c'est combien exactement, il est neuf?\"\n" +
    "Second message: \"Les prix sont juste au-dessus, le S25 Ultra est dans la liste pis il est là. On a les trois, remis à neuf, usagé ou neuf, en 128, 256 ou 512 Go, pis le prix suit ce que tu choisis: je te fais le prix liquidation sur ce que tu prends, la meilleure option au prix que tu cherches, on peut négocier. Garantie jusqu'à 1 à 2 ans dans tous les cas. Amène ton vieux téléphone, cash ou échange, pis avec CAROL au comptoir t'as les accessoires gratuits, le rabais étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement par mois si tu veux. Passe à soir avant 21h ou demain dès 9h, je suis là, pas besoin de rdv. ${FOOT_FR} ${SHOP_FR}\"\n\n" +
    "Listing iPad Air 64GB, it is 12:00. Buyer: \"is the ipad new? how much\"\n" +
    "First message: \"Yes, we've got brand-new sealed iPads, and it's liquidation week, warranty up to 1 to 2 years. ${TABLET_INLINE}. In person we bring the price down for you, to your budget, and your old phone or tablet counts, cash or trade. Student, newcomer or Montréal resident, there's an extra discount, accessories are free with it, and you can pay monthly if you want. Say CAROL at the counter. This afternoon or tonight before 9pm? ${FOOT_EN} ${SHOP_EN}\"\n" +
    "Buyer: \"ok how much for the air exactly\"\n" +
    "Second message: \"The starting prices are just above, the Air and the Pro are in that list and they're here, sealed ones too. We've got refurbished, used and brand new, in every storage, and the price follows what you pick: I make you the liquidation price on it and find you the best option at the price you want, we can negotiate. Warranty up to 1 to 2 years. Bring your old phone or tablet, cash or trade, and say CAROL for the free accessories, the discount for students, newcomers and Montréal residents, and monthly payments if you want. This afternoon or tonight before 9pm, no appointment, I'm here. ${FOOT_EN} ${SHOP_EN}\"\n\n" +
    "Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"");

fs.writeFileSync(__dirname + "/teaching18.js", s);
const t = require(__dirname + "/teaching18.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const checks = {
  warranty: /garantie|warranty/i, tradein: /reprend|trade|échang|exchange|amène/i, discount: /étudiant|student/i, accessories: /accessoires|accessories/i,
  monthly: /mensuel|monthly|par mois|per month/i, carol: /CAROL/, footer: /Quantités limitées|Limited quantities/, shop: /Beaubien E/, hours: /9h à 21h|9am to 9pm/,
  liquidation: /liquidation/i, phone: /4️⃣3️⃣8️⃣8️⃣0️⃣/,
};
let bad = 0;
for (const m of msgs) {
  if (/Le montant exact|comptant sur place/.test(m.text)) continue;
  const miss = Object.keys(checks).filter((k) => !checks[k].test(m.text));
  if (m.kind === "First" && !/semaine de liquidation|liquidation week/.test(m.text)) miss.push("liquidation-week");
  if (miss.length) { bad++; console.log("  MISSING", miss.join(","), "|", m.kind, m.text.slice(0, 50)); }
}
const all = Object.values(t).join("\n");
const oldMenu = (all.match(/used or brand new and a few|used or brand new, a few|usagé ou neuf pis la capacité(?!, 128)/g) || []).length;
const banned = (t.examples.match(/\b(condition|état|grade)\b/gi) || []).filter((w) => !/conditions/i.test(w)).length;
console.log("teaching18.js written", s.length, "| examples:", msgs.length, "| missing:", bad, "| old menu wordings left:", oldMenu, "| condition/état/grade in examples:", banned,
  "\n  samsung:", t.priceList.split("\n").slice(10, 20).join(" | "), "\n  tablets:", t.priceList.split("\n").slice(21, 25).join(" | "));
