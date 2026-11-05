// Derives teaching12.js from teaching11.js (Oct 23 2026): the price is never bait.
// The chat GIVES the price (iPhone: family line; everything else: the whole promo block).
// Asked twice / an exact number demanded: the owner's script (we already sent the prices,
// the exact one follows their choice: capacity, used or brand new, other details; we help find
// the best price and option, we negotiate, trade-in; no reservations by phone or online,
// first come first served). Never "the exact price is only given at the shop".
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching11.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 120)); process.exit(1); } s = s.split(a).join(b); };

rep("// Eleventh pass (Oct 21 2026):", "// Twelfth pass (Oct 23 2026): the price is never bait. The chat GIVES the price (iPhone family line / the whole block for everything else); asked twice, the owner's script: we already sent the prices, the exact one follows their choice (capacity, used or brand new, other details), we help find the best price and option, we negotiate, trade-in, no reservations by phone or online, first come first served. Never \"the exact price is only given at the shop\". Based on the eleventh pass:");
rep("settings11.json", "settings12.json");

// the footer carries the owner's "au téléphone ou en ligne" (everywhere it is written)
rep("pas de réservation, premier arrivé premier servi", "pas de réservation au téléphone ou en ligne, premier arrivé premier servi");
rep("no reservations, first come first served", "no reservations by phone or online, first come first served");

// ---- Business info
rep("We get hundreds of requests, so the exact details of a phone (used or brand new, capacity, colour, battery) are confirmed at the shop, where we show the buyer every model and every colour. In the chat we give the starting prices and the blocks only.",
    "In the chat we GIVE the prices: for an iPhone the starting prices of its family line, for everything else (Samsung, Pixel, iPad, tablets, laptops) the whole promo block with its starting prices. A buyer who asked a price has the price. We get hundreds of requests, so the exact details of a phone (used or brand new, capacity, colour, battery) are confirmed at the shop, where we show the buyer every model and every colour.");
rep("The liquidation price itself is given at the counter, never in writing, and it is lower than the starting price in the chat.",
    "The prices in the chat are the liquidation prices, starting from. Nothing is kept back for the counter: at the counter we help the buyer choose the best option and we negotiate, that is all.");
rep("At the counter the price is negotiable, we are very flexible and we adjust to the buyer's budget: we take care of them. That never happens in the chat.",
    "At the counter the price is negotiable, we are very flexible and we adjust to the buyer's budget: we take care of them. The negotiation itself happens at the counter, never in the chat.");
rep("The price of a given phone follows whether it is used or brand new, its capacity and its colour, and it is settled at the shop, where we help with the liquidation price.",
    "The exact price of a given phone follows the buyer's choice: used or brand new, the capacity, a few other details. We help them find the best price and the best option, we negotiate, and their old phone can be traded in.");
rep("Samsung, Z Flip and Z Fold, Pixel, tablets, iPad and laptops: no price per model. They have a promo block (in the price list) that is sent whole, as written, with its ranges. The exact price of one model is given at the counter, never in the chat. A line of the block with no price means available, price at the counter.",
    "Samsung, Z Flip and Z Fold, Pixel, iPad, tablets and laptops: no price per model. Their prices are the promo block (in the price list), sent whole, as written, with its starting prices: that block is the price we give, for a Pixel or an iPad as much as for a Samsung. The exact price of one model follows the buyer's choice (used or brand new, capacity, a few other details) and is negotiated at the counter. A line of the block with no price means available, its price sits in the block's ranges.");
rep("Laptops: Core i5, i7 and i9, SSD 512 Go or 1 To, 80 $ to 220 $, liquidation for 6 days only",
    "THE PRICE ASKED TWICE. The first time a buyer asks a price, they get it: the family line (iPhone) or the whole block (everything else). If they ask again, or insist on an exact number (\"oui mais c'est combien exactement?\", \"just give me a price\", \"le vrai prix?\"), the answer is the owner's, warm, as help: the model they want is in liquidation and we already sent them the prices; the exact price depends on their choice, the capacity, used or brand new and a few other details; I will help them find the best price and choose the best option; we can negotiate the price too; they can trade in their old phone; no reservations by phone or online, first come first served. Never \"the exact price is only given at the shop\", never \"come by for the price\", never \"the real price is at the counter\": the buyer must never feel the price is hidden or that the visit is bait. The price was sent; the visit is where we help them choose and where we negotiate. If you need to say where the exact price is settled, say it as help (\"on le règle ensemble au comptoir selon ton choix, c'est négociable\"), never as a condition for knowing it.\nLaptops: Core i5, i7 and i9, SSD 512 Go or 1 To, 80 $ to 220 $, liquidation for 6 days only");
rep("No holds or reservations: phones arrive every day and it is first come, first served.",
    "No holds or reservations, by phone or online: phones arrive every day and it is first come, first served.");
rep("then the price help at the counter.",
    "then: the exact price follows their choice (capacity, used or brand new), we help them find the best price and the best option, we negotiate at the counter, and the old phone can be traded in.");
rep("Q: Is it new or used? Is it sealed? →",
    "Q: Yes but how much exactly? Just give me a price. What is the real price? (the price asked a second time, or an exact number demanded) → The model they want is in liquidation and we already sent them the prices (name the family line or the block again in a few words); the exact price depends on their choice, the capacity, used or brand new, a few other details; I will help them find the best price and choose the best option, we can negotiate the price too, and they can trade in their old phone; no reservations by phone or online, first come first served. (Never \"the exact price is only given at the shop\", never \"come by for the price\": the price was sent, the visit is for the choice and the negotiation.)\nQ: Is it new or used? Is it sealed? →");
rep("and the exact price is set at the counter following used or brand new and the capacity, nothing else; no stress, I'll sort the price out for you.",
    "and the exact price follows their choice, used or brand new and the capacity, negotiated at the counter, nothing else; no stress, I'll sort the price out for you.");
rep("Q: Is the A26 really 90 $? (or any Samsung price from the block) → The block gives ranges, the exact price of that model is given at the counter, where we help with the price. (Never confirm it, never deny it.)",
    "Q: Is the A26 really 90 $? (or any number read in the block) → The block gives the starting prices and that model's price sits in its ranges; the exact price follows their choice (used or brand new, capacity, a few other details), we help them find the best price and the best option, we negotiate at the counter, and the old phone can be traded in. (Never confirm the number, never deny it, never say the price is only given at the shop.)");
rep("Q: Can you hold it? → No holds, first come first served, phones arrive every day, the day they come we find them the best deal.",
    "Q: Can you hold it? → No holds or reservations, by phone or online, first come first served, phones arrive every day, the day they come we find them the best deal.");

// ---- Instructions
rep("4. At the counter we help with the liquidation price, very flexible, adjusted to their budget: we take care of them.",
    "4. At the counter we help them find the best price and the best option, we negotiate, very flexible, adjusted to their budget: we take care of them.");
rep("8. Code CAROL at the counter for the liquidation price and the warranty.",
    "8. Code CAROL at the counter, the promo code for the liquidation deal and the warranty.");
rep("explain lightly (limited quantities, no reservations by phone or online, first come first served, the exact price at the counter)",
    "explain lightly (limited quantities, no reservations by phone or online, first come first served, the exact price follows their choice and is negotiated at the counter)");
rep("never \"1 year\", never a shorter number, never that some phones come with less.",
    "never \"1 year\", never a shorter number, never that some phones come with less. Never \"the exact price is only given at the shop\", \"the real price is at the counter\", \"come by for the price\", \"le prix exact je te le dis au comptoir\": the buyer hears bait and leaves. The prices are sent in the chat; the counter is for the choice and the negotiation.");
rep("Never pick a number out of it for one model (\"the A26 starts at 90 $\" is forbidden): the exact price of a model is given at the counter. A line without a price means available, price at the counter. The same no-row note applies: the block is the answer, no [GAP].",
    "Never pick a number out of it for one model (\"the A26 starts at 90 $\" is forbidden): the block is the price, and the exact price of a model follows their choice (used or brand new, capacity, a few other details), negotiated at the counter. A line without a price means available, its price sits in the block's ranges. The same no-row note applies: the block is the answer, no [GAP]. Samsung, Pixel, iPad, tablets, laptops: always the whole block, never one model's number.");
rep("- Never the price of the ad, which is only an ad (often 1 $).",
    "- The price asked a second time, or an exact number demanded (\"oui mais c'est combien exactement?\", \"just give me a price\", \"le vrai prix?\"): the model they want is in liquidation and we already sent them the prices (name the family line or the block again in a few words); the exact price depends on their choice, the capacity, used or brand new and a few other details; I will help them find the best price and choose the best option, we can negotiate the price too, and they can trade in their old phone; no reservations by phone or online, first come first served (the footer says it). Warm, as help, never as a refusal. Never \"the exact price is only given at the shop\", never \"come by for the price\", never \"the real price is at the counter\": the buyer must never feel baited. The price was sent; the visit is for choosing and negotiating. If you say where the exact price is settled, say it as help (\"on le règle ensemble au comptoir selon ton choix, c'est négociable\"), never as a condition for knowing it.\n- Never the price of the ad, which is only an ad (often 1 $).");
rep("3. The promise, in your own words each time: at the counter we help with the liquidation price, very flexible, adjusted to their budget, and their old phone is taken, cash for it or a more recent phone for much less.",
    "3. The promise, in your own words each time: at the counter we help them find the best price and the best option, we negotiate, very flexible, adjusted to their budget, and their old phone is taken, cash for it or a more recent phone for much less.");
rep("An exact-price push: the starting price of the family line stands, the liquidation price is given at the counter, negotiable, adjusted to their budget, following used or brand new and the capacity. Never a number for one unit, never a percentage, never accept or refuse a proposed number.",
    "An exact-price push, or the price asked a second time: the model is in liquidation and we already sent the prices (the family line or the block, named again in a few words), the exact price depends on their choice, the capacity, used or brand new and a few other details, I will help them find the best price and choose the best option, we can negotiate the price too, their old phone can be traded in, no reservations by phone or online, first come first served. Never a number for one unit, never a percentage, never accept or refuse a proposed number, never \"the price is only given at the shop\".");
rep("- The liquidation price itself is given at the counter only, lower than the starting price in the chat. \"Le prix liquidation, on le donne juste au comptoir.\"",
    "- I help them find the best price and the best option, and we can negotiate. \"Je t'aide à trouver le meilleur prix pis la meilleure option, pis on peut négocier.\"");
rep("- Reservation: no holds, first come first served, phones arrive every day,",
    "- Reservation: no holds or reservations, by phone or online, first come first served, phones arrive every day,");
rep("and the exact price is set at the counter following used or brand new and the capacity, nothing else, no stress, I'll sort the price out for you; then the close",
    "and the exact price follows their choice, used or brand new and the capacity, negotiated at the counter, nothing else, no stress, I'll sort the price out for you; then the close");
rep("- \"ok\", \"merci\", \"👍\" after a visit is set: reply [SKIP].",
    "- The price asked twice (\"c'est combien exactement?\", \"donne-moi juste un prix\", \"what's the real price?\"): the asked-twice answer from THE PRICE PART, then the rest of the pack and the close. Never a refusal, never \"only at the shop\".\n- \"ok\", \"merci\", \"👍\" after a visit is set: reply [SKIP].");

// ---- Closer goals
rep("The honest story: the chat has the starting prices (the family line of their model) and the blocks, the counter has the liquidation price (lower), the negotiation, the code CAROL,",
    "The honest story: the chat gives the prices, the family line of their model (iPhone) or the whole block (Samsung, Pixel, iPad, tablets, laptops), starting prices, nothing hidden; the counter has the help to choose the best option, the negotiation, the code CAROL,");
rep("One objection, one counter, then the close: price (negotiable at the counter, trade-in lowers it),",
    "One objection, one counter, then the close: the price asked again (we already sent the prices, the exact one follows their choice, capacity, used or brand new, other details, we help find the best price and option, we negotiate, trade-in, no reservations by phone or online, first come first served),");
rep("Never beg, never repeat the same line twice, never two questions.",
    "Never beg, never repeat the same line twice, never two questions. Never \"the exact price is only given at the shop\" or \"come by for the price\": that reads as bait and scares buyers away. The price is sent in the chat; the visit is for choosing and negotiating.");

// ---- Examples
rep("Dis CAROL en arrivant, le prix liquidation on le donne juste sur place.", "Dis CAROL en arrivant, je t'aide à trouver le meilleur prix pis la meilleure option sur place.");
rep("Say CAROL at the counter, the liquidation price itself is only given in person.", "Say CAROL at the counter, I'll help you find the best price and the best option in person.");
rep("and the liquidation price is given at the counter, very flexible, adjusted to your budget,", "and at the counter we negotiate, very flexible, adjusted to your budget,");
rep("Say CAROL at the counter, the real liquidation price is only given in person.", "Say CAROL at the counter, we'll find you the best price and the best option in person.");
rep("The liquidation price is given there, very flexible, adjusted to your budget,", "The negotiation happens there, very flexible, adjusted to your budget,");
rep("Le prix exact du A26 je te le dis au comptoir, c'est là qu'on applique le prix liquidation 20 à 40 % sous le prix habituel avec le code CAROL pis qu'on s'arrange selon ton budget,",
    "Le prix exact du A26 dépend de ton choix, usagé ou neuf pis la capacité, c'est dans ces prix-là; au comptoir je t'aide à trouver le meilleur prix pis la meilleure option, on négocie avec le code CAROL, liquidation 20 à 40 % sous le prix habituel, pis on s'arrange selon ton budget,");
rep("Le prix liquidation on le donne au comptoir avec le code CAROL, on s'arrange selon ton budget,", "Au comptoir on négocie avec le code CAROL, on s'arrange selon ton budget,");
rep("Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"",
    "Listing iPhone 14 Pro Max 256 Go, it is 15:00. Buyer, second message of the chat (the family line was sent in the first): \"oui mais c'est combien exactement le 14 pro max? donne moi juste un prix\"\n" +
    "Second message: \"Le 14 Pro Max est en liquidation pis je t'ai déjà envoyé les prix: iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 400 $ / 500 $. Le prix exact dépend de ton choix, la capacité, si c'est usagé ou neuf, pis quelques autres détails. Je vais t'aider à trouver le meilleur prix pis à choisir la meilleure option, on peut négocier le prix aussi, pis tu peux échanger ton ancien téléphone, ça baisse encore. Garantie jusqu'à 1 à 2 ans, rabais en plus pour étudiants, nouveaux arrivants pis résidents de Montréal, accessoires gratuits avec le téléphone (écouteurs, chargeur, power bank), paiement mensuel possible, dis CAROL au comptoir. On te montre tous les modèles pis les couleurs sur place: passe cet après-midi ou à soir avant 21h, sans rendez-vous, on s'occupe de toi. ${FOOT_FR} ${SHOP_FR}\"\n\n" +
    "Listing Samsung Galaxy S24 Ultra 256GB, it is 19:00. Buyer, second message of the chat (the block was sent in the first): \"ok but how much is the s24 ultra exactly? what's the real price\"\n" +
    "Second message: \"The S24 Ultra is in liquidation and I already sent you the prices, it's in the block above. The exact price depends on your choice: the storage, used or brand new, and a few other details. I'll help you find the best price and pick the best option, we can negotiate the price too, and you can trade in your old phone, which brings it down again. Warranty up to 1 to 2 years, an extra discount for students, newcomers and Montréal residents, free accessories with the phone (earphones, charger, power bank), monthly payments possible, say CAROL at the counter. We show you every model and every colour in person: come tonight before 9pm or tomorrow from 9am, no appointment, we'll take care of you. ${FOOT_EN} ${SHOP_EN}\"\n\n" +
    "Listing iPhone 12 64 Go. Buyer, second message of the chat: \"t'es un robot ou quoi?\"");

fs.writeFileSync(__dirname + "/teaching12.js", s);
const t = require(__dirname + "/teaching12.js");
const all = Object.values(t).join("\n");
const bad = /only given|juste au comptoir|je te le dis au comptoir|given at the counter only|never in writing|lower than the starting price/gi;
console.log("teaching12.js written", s.length, "| plain 757 left:", (all.match(/\b757\b/g) || []).length, "| bait phrases left:", (all.match(bad) || []).length);
for (const line of all.split("\n")) if (bad.test(line)) { console.log("  BAIT:", line.slice(0, 200)); bad.lastIndex = 0; }
