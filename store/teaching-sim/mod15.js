// Derives teaching15.js from teaching14.js (Oct 25 2026, owner: "in two messages you are not including
// everything… missing the address and hours or other information; after the first message the customer
// should want to come, after the second he is 100 % coming").
// Root cause found in the code: the MEMORY note the extension adds to every second message says
// "you already told them the address, the hours, the trade-in line, the liquidation line, the warranty,
// a price, the metro, how to pay (do not repeat any of it)" — and the sims never carried that note.
// Fix in the teaching: a checklist that wins over the size, an explicit override of that note, the shop
// line in both messages, the examples completed (monthly payments / offers were missing in some).
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching14.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 120)); process.exit(1); } s = s.split(a).join(b); };

rep("// Fourteenth pass (Oct 25 2026):", "// Fifteenth pass (Oct 25 2026): the checklist wins over the size (every item in both messages, the shop line in both), the MEMORY note's \"do not repeat\" is overridden for this shop, the examples completed (monthly payments / offers). Based on the fourteenth pass:");
rep("settings14.json", "settings15.json");

// ---- Business info
rep("Shop phone, always written exactly like this:",
    "The shop line (address, hours, phone) closes every message, the first and the second, whatever a note says about having given it already: a buyer must never have to scroll up to find where to go. A note saying the address, the hours, the trade-in, the liquidation, the warranty or a price were already given never removes them from the second message: the second message repeats the whole pack in new words, the shop line included.\nShop phone, always written exactly like this:");

// ---- Instructions
rep("if it still does not fit, drop the curiosity line.",
    "if it still does not fit, drop the curiosity line. Every item of the pack is in every message, and the checklist below wins over the size: a message missing an item is wrong, a message a little longer is not. After the first message the buyer must already want to come: they have the model, the starting price, the deal, the offers, a time, the address and the hours. After the second, they must be sure they are coming: the close names the time, the place, what to bring, what to say and what they get.\n\nTHE MEMORY NOTE\nA note may come with your second message: \"you already told them the address, the hours, the trade-in line, the liquidation line, the warranty, a price, the metro, how to pay (do not repeat any of it)\". For this shop, obey it only for the greeting and the openers. The owner wants the whole pack and the shop line in BOTH messages, in new words: the address, the hours, the trade-in, the liquidation, the warranty and the promise all go in again, worded differently. The only thing never repeated is a number already given: say \"the starting prices are just above\" instead.");
rep("WORDS THAT NEVER GO TO A BUYER",
    "BEFORE YOU SEND, THE CHECKLIST (both messages, every time)\nRead your draft and tick each one; add what is missing before sending, a few words are enough:\n1. the model, available, in liquidation (20 to 40 % below);\n2. the warranty, up to 1 to 2 years;\n3. the price: the family line or the block in the first; \"the starting prices are just above\" plus what the exact price depends on in the second;\n4. the promise: we help you, we make you the liquidation price and we find you the best option at the price you want, negotiable;\n5. the trade-in, cash or a newer phone;\n6. the extra discount for students, newcomers and Montréal residents;\n7. the free accessories;\n8. monthly payments possible;\n9. CAROL at the counter;\n10. the step to the door: the time question (first) or the self-standing close (second: when, the old phone, CAROL, no appointment, we are waiting for them);\n11. the footer;\n12. the shop line, address, hours and phone, in BOTH messages, whatever a note says.\nA note or a mechanic that says a fact was already given never removes it from this list.\n\nWORDS THAT NEVER GO TO A BUYER");
rep("7. The footer, then the shop line.", "7. The footer, then the shop line (address, hours, phone).");
rep("No other question. The footer is where the first message says,",
    "No other question. The first message alone must make them want to come: everything on the checklist is in it, nothing kept for later except what the exact price depends on. The footer is where the first message says,");
rep("5. A close that stands on its own, because you will not write again: when to come, matched to the clock (today before 21h, or tomorrow from 9h), say CAROL at the counter, bring the old phone, no appointment needed. No question.",
    "5. A close that stands on its own, because you will not write again, and that leaves them sure they are coming: when to come, matched to the clock (today before 21h, or tomorrow from 9h), say CAROL at the counter, bring the old phone, no appointment needed, we are waiting for them. No question.");
rep("6. The footer.\n7. The shop line.", "6. The footer.\n7. The shop line, address, hours and phone, in full, even though the first message had it.");
rep("- A memory note may say you already told them the address or the hours: the shop line still closes the second message, that note only means not to repeat your own sentences.",
    "- A memory note or the mechanics may say you already told them the address, the hours, the trade-in, the liquidation, the warranty or a price, or that each fact is said once per conversation: for this shop that is overridden, the second message carries the whole pack again in new words and the shop line in full; the note only means not to repeat your own sentences word for word, and not to greet twice.");
rep("Only a block or the whole iPhone list may push past that.", "Only a block, the whole iPhone list or the checklist may push past that: never drop an item to fit.");

// ---- Closer goals
rep("they test it in hand and we take care of them.",
    "they test it in hand and we take care of them. Everything the owner listed is in both messages, the shop line included, every time, whatever a memory note says about having said it already: a buyer who has to scroll up for the address or the hours may not come.");

// ---- Examples: the items some second messages were missing (monthly payments, the offers)
rep("pis avec CAROL au comptoir t'as les accessoires gratuits pis le rabais en plus.", "pis avec CAROL au comptoir t'as les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.");
rep("pis dis CAROL au comptoir pour les accessoires gratuits pis le rabais en plus.", "pis dis CAROL au comptoir pour les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.");
rep("and say CAROL for the free accessories and the extra discount.", "and say CAROL for the free accessories, the extra discount and monthly payments if you want.");
rep("au prix que tu cherches, ton vieux laptop ou téléphone on le reprend.", "au prix que tu cherches, ton vieux laptop ou téléphone on le reprend. Rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, accessoires gratuits, paiement mensuel possible.");
rep("Garantie jusqu'à 1 à 2 ans, accessoires gratuits pis rabais en plus avec CAROL au comptoir.", "Garantie jusqu'à 1 à 2 ans, accessoires gratuits, rabais en plus pis paiement mensuel possible avec CAROL au comptoir.");
rep("pis avec CAROL t'as les accessoires gratuits pis le rabais en plus.", "pis avec CAROL t'as les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.");

// the discount names its audiences everywhere (the pack item is "for students, newcomers and Montréal residents")
rep("pis avec CAROL au comptoir t'as les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.", "pis avec CAROL au comptoir t'as les accessoires gratuits, le rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement mensuel possible.");
rep("and say CAROL for the free accessories, the extra discount and monthly payments if you want.", "and say CAROL for the free accessories, the extra discount for students, newcomers and Montréal residents, and monthly payments if you want.");
rep("pis dis CAROL au comptoir pour les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.", "pis dis CAROL au comptoir pour les accessoires gratuits, le rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement mensuel possible.");
rep("Dis CAROL au comptoir pour les accessoires gratuits pis le rabais en plus, paiement mensuel possible.", "Dis CAROL au comptoir pour les accessoires gratuits pis le rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, paiement mensuel possible.");
rep("Salut! Le 15 Pro est dispo, neufs pis usagés testés", "Salut! Le 15 Pro est dispo en liquidation, neufs pis usagés testés");
rep("accessoires gratuits, rabais en plus pis paiement mensuel possible avec CAROL au comptoir.", "accessoires gratuits, rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, pis paiement mensuel possible avec CAROL au comptoir.");
rep("free accessories and the extra discount with CAROL at the counter, monthly payments possible.", "free accessories, the extra discount for students, newcomers and Montréal residents with CAROL at the counter, monthly payments possible.");
rep("pis avec CAROL t'as les accessoires gratuits, le rabais en plus pis le paiement mensuel possible.", "pis avec CAROL t'as les accessoires gratuits, le rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, pis le paiement mensuel possible.");

fs.writeFileSync(__dirname + "/teaching15.js", s);
const t = require(__dirname + "/teaching15.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].map((m) => ({ kind: m[1], text: m[2] }));
const checks = {
  warranty: /garantie|warranty/i, tradein: /reprend|trade|échang|exchange/i, discount: /étudiants|students/i, accessories: /accessoires|accessories/i,
  monthly: /mensuel|monthly/i, carol: /CAROL/, footer: /Quantités limitées|Limited quantities/, shop: /Beaubien E/, hours: /9h à 21h|9am to 9pm/,
  liquidation: /liquidation/i,
};
let bad = 0;
for (const m of msgs) {
  if (/comptant sur place|Le montant exact/.test(m.text)) continue; // the seller examples carry the seller pack
  const miss = Object.keys(checks).filter((k) => !checks[k].test(m.text));
  if (miss.length) { bad++; console.log("  MISSING", miss.join(","), "|", m.kind, m.text.slice(0, 50)); }
}
console.log("teaching15.js written", s.length, "| examples:", msgs.length, "| examples missing a checklist item:", bad);
