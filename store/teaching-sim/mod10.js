// Derives teaching10.js from teaching9.js: THE FOOTER (quantités limitées, pas de réservation, premier
// arrivé premier servi, certaines conditions s'appliquent) closes EVERY message, right before the shop line.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching9.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 100)); process.exit(1); } s = s.split(a).join(b); };
rep("// Ninth pass (Oct 21 2026):", "// Tenth pass (Oct 21 2026): THE FOOTER (quantités limitées, pas de réservation, premier arrivé premier\n// servi, certaines conditions s'appliquent) closes every message before the shop line. Based on the ninth pass:");
rep("settings9.json", "settings10.json");
rep("const COND_EN = \"Certain conditions apply.\";",
    "const COND_EN = \"Certain conditions apply.\";\nconst FOOT_FR = \"Quantités limitées, pas de réservation, premier arrivé premier servi. Certaines conditions s'appliquent.\";\nconst FOOT_EN = \"Limited quantities, no reservations, first come first served. Certain conditions apply.\";");

// business info
rep("\"Certaines conditions s'appliquent\" / \"certain conditions apply\" is said once, lightly, at the very end of the last message, never explained and never turned into other warnings.",
    "Every message ends with the footer, right before the shop line, exactly like this in the buyer's language: \"Quantités limitées, pas de réservation, premier arrivé premier servi. Certaines conditions s'appliquent.\" / \"Limited quantities, no reservations, first come first served. Certain conditions apply.\" It is a signature, said lightly, never explained and never turned into other warnings. It is there so that a buyer who travels for one exact model, colour or price has been told; never say that reason to a buyer.");
rep("The phrase \"certaines conditions s'appliquent\" / \"certain conditions apply\" is the one allowed use.",
    "The footer's \"certaines conditions s'appliquent\" / \"certain conditions apply\" is the one allowed use.");
rep("Q: What are the conditions? What does \"certain conditions apply\" mean? → Just that the prices are starting prices and the exact price is set at the counter, following used or brand new and the capacity, nothing else; no stress, I'll sort the price out for you.",
    "Q: What are the conditions? What does \"certain conditions apply\" mean? → Just that quantities are limited, no reservations, first come first served, and the exact price is set at the counter following used or brand new and the capacity, nothing else; no stress, I'll sort the price out for you.");

// instructions
rep("The last message you send ends with \"Certaines conditions s'appliquent.\" / \"Certain conditions apply.\" right before the shop line: always in the second message, and in the first message only when it starts with [VISIT:yes]. Short and light, never explained, never followed by other warnings. If they just asked what the conditions are, you have explained them: no need to repeat the phrase.",
    "Every message you send ends with THE FOOTER, right before the shop line, exactly as written in HOW TO SAY IT, in the buyer's language: a signature, short and light, never explained, never followed by other warnings, never in the way of the conversation. If they ask what the conditions are, explain lightly (limited quantities, no reservations, first come first served, the exact price at the counter) and the footer still closes the message as usual.");
rep("12. The shop line.\nThe pack applies to a seller too,", "12. The footer, then the shop line.\nThe pack applies to a seller too,");
rep("CAROL at the counter, the shop line. A seller's second message is never short.", "CAROL at the counter, the footer, the shop line. A seller's second message is never short.");
rep("the one allowed use is the closing phrase \"certaines conditions s'appliquent\" / \"certain conditions apply\".", "the one allowed use is the footer's \"certaines conditions s'appliquent\" / \"certain conditions apply\".");
rep("they scare buyers; \"à partir de\" and the closing phrase do the job quietly.", "they scare buyers; \"à partir de\" and the footer do the job quietly.");
rep("6. One closing question, when and not whether, matched to the clock: \"tu passes cet après-midi ou à soir?\", \"ce soir avant 21h ou demain?\", \"demain matin ou après-midi?\".\n7. The shop line.",
    "6. One closing question, when and not whether, matched to the clock: \"tu passes cet après-midi ou à soir?\", \"ce soir avant 21h ou demain?\", \"demain matin ou après-midi?\".\n7. The footer, then the shop line.");
rep("say CAROL at the counter, the warranty, the accessories, the offers, monthly payments, \"Certaines conditions s'appliquent.\", the shop line.",
    "say CAROL at the counter, the warranty, the accessories, the offers, monthly payments, the footer, the shop line.");
rep("6. \"Certaines conditions s'appliquent.\" / \"Certain conditions apply.\"\n7. The shop line.", "6. The footer.\n7. The shop line.");
rep("the offers; monthly payments; we take care of them), \"Certaines conditions s'appliquent.\", the shop line.", "the offers; monthly payments; we take care of them), the footer, the shop line.");
rep("- No bullet points, no numbered lists, no headings. One emoji per message: the 📍 of the shop line, or the 🫣 of the laptop block (then write the shop line without 📍). The shop line is always written exactly like this:",
    "- THE FOOTER, always written exactly like this, right before the shop line, in the buyer's language:\n${FOOT_FR}\nIn English: ${FOOT_EN}\n- No bullet points, no numbered lists, no headings. One emoji per message: the 📍 of the shop line, or the 🫣 of the laptop block (then write the shop line without 📍). The shop line is always written exactly like this:");
rep("the trade-in specialist's number if they want to trade, we are waiting for them, the closing phrase, shop line.", "the trade-in specialist's number if they want to trade, we are waiting for them, the footer, shop line.");
rep("- \"What are the conditions?\": just that prices are starting prices and the exact price is set at the counter, following used or brand new and the capacity, nothing else, no stress, I'll sort the price out for you; then the close, without repeating the phrase.",
    "- \"What are the conditions?\": just that quantities are limited, no reservations, first come first served, and the exact price is set at the counter following used or brand new and the capacity, nothing else, no stress, I'll sort the price out for you; then the close, the footer as usual, the shop line.");

// closer goals
rep("and ends with \"certaines conditions s'appliquent\".", "and ends with the footer (limited quantities, no reservations, first come first served, certain conditions apply).");
rep("\"À partir de\", the warranty \"up to 1 to 2 years\" and the closing phrase protect the shop", "\"À partir de\", the warranty \"up to 1 to 2 years\" and the footer protect the shop");
rep("one curiosity line, the step to the door, the shop line), in different words each time", "one curiosity line, the step to the door, the footer, the shop line), in different words each time");

// examples: the footer replaces the closing phrase and is added to first messages
s = s.split("${COND_FR} ${SHOP_FR}").join("${FOOT_FR} ${SHOP_FR}");
s = s.split("${COND_EN} ${SHOP_EN}").join("${FOOT_EN} ${SHOP_EN}");
s = s.split("Certaines conditions s'appliquent. ${SHOP_FR}").join("${FOOT_FR} ${SHOP_FR}");
s = s.split("? ${SHOP_FR}\"").join("? ${FOOT_FR} ${SHOP_FR}\"");
s = s.split("? ${SHOP_EN}\"").join("? ${FOOT_EN} ${SHOP_EN}\"");
s = s.split("? ${SHOP_FR_NOPIN}\"").join("? ${FOOT_FR} ${SHOP_FR_NOPIN}\"");
s = s.split("on s'occupe de toi. ${SHOP_FR}\"").join("on s'occupe de toi. ${FOOT_FR} ${SHOP_FR}\"");
fs.writeFileSync(__dirname + "/teaching10.js", s);
const ex = require(__dirname + "/teaching10.js").examples;
const msgs = ex.split("\n").filter((l) => /^(First|Second) message:/.test(l));
const missing = msgs.filter((l) => !/premier arrivé premier servi|first come first served/.test(l)).length;
console.log("teaching10.js written", s.length, "| example messages:", msgs.length, "| without footer:", missing);
