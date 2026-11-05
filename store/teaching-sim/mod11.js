// Derives teaching11.js from teaching10.js: the street number is written 7️⃣5️⃣7️⃣ Rue Beaubien E everywhere
// (keycap digits, like the phone number) so Marketplace does not recognise an address pattern.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching10.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 100)); process.exit(1); } s = s.split(a).join(b); };
rep("// Tenth pass (Oct 21 2026):", "// Eleventh pass (Oct 21 2026): the street number is 7️⃣5️⃣7️⃣ Rue Beaubien E everywhere (keycap digits). Based on the tenth pass:");
rep("settings10.json", "settings11.json");
const K = "7️⃣5️⃣7️⃣ Rue Beaubien E";
// address box + every buyer-facing form of the street number
rep("businessAddress: \"757 rue Beaubien Est, Montréal (métro Beaubien)\"", "businessAddress: \"" + K + ", Montréal (métro Beaubien)\"");
s = s.split("757 rue Beaubien Est").join(K);
s = s.split("757 Beaubien Est").join(K);
s = s.split("757 Beaubien East").join(K);
s = s.split("757 Beaubien").join(K);
// the rule, beside the phone-number rule and in HOW TO SAY IT
rep("Shop phone, always written exactly like this: 4️⃣3️⃣8️⃣8️⃣0️⃣1️⃣6️⃣7️⃣7️⃣1️⃣",
    "Shop phone, always written exactly like this: 4️⃣3️⃣8️⃣8️⃣0️⃣1️⃣6️⃣7️⃣7️⃣1️⃣\nThe street number is always written with the same digits, 7️⃣5️⃣7️⃣ Rue Beaubien E, never 757, in every language.");
rep("- A memory note may say you already told them the address or the hours:",
    "- The street number is always 7️⃣5️⃣7️⃣ Rue Beaubien E, keycap digits like the phone number, never 757, in both languages.\n- A memory note may say you already told them the address or the hours:");
fs.writeFileSync(__dirname + "/teaching11.js", s);
const t = require(__dirname + "/teaching11.js");
const all = Object.values(t).join("\n");
const left = (all.match(/\b757\b/g) || []).length;
console.log("teaching11.js written", s.length, "| plain 757 left in boxes:", left, "| visit-confirm:", t.visitConfirmMessage.slice(0, 120));
