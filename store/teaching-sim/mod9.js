// Derives teaching9.js from teaching8.js: warranty "up to 1 to 2 years", never "1 year", never "some come with less".
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching8.js", "utf8");
const rep = (a, b) => { if (!s.includes(a)) { console.error("MISSING:", a.slice(0, 100)); process.exit(1); } s = s.split(a).join(b); };
rep("// Eighth pass (Oct 21 2026):", "// Ninth pass (Oct 21 2026): the warranty is \"up to 1 to 2 years\" (never \"1 year\", never that some\n// phones come with less). Based on the eighth pass:");
rep("settings8.json", "settings9.json");
rep("Every phone comes with a 1-year warranty (garantie 1 an), used or brand new.",
    "Every phone comes with a warranty, up to 1 to 2 years (garantie jusqu'à 1 à 2 ans), used or brand new. Always say \"up to 1 to 2 years\" / \"jusqu'à 1 à 2 ans\", never \"1 year\" and never that some phones come with less: the \"up to\" does the job quietly, like \"à partir de\".");
rep("Also never \"sujet à changement\", \"sans garantie\", \"sous réserve\", \"we can't guarantee\", \"no guarantee\": they scare buyers; \"à partir de\" and the closing phrase do the job quietly.",
    "Also never \"sujet à changement\", \"sans garantie\", \"sous réserve\", \"we can't guarantee\", \"no guarantee\": they scare buyers; \"à partir de\" and the closing phrase do the job quietly. The warranty is always \"up to 1 to 2 years\" / \"jusqu'à 1 à 2 ans\", said as a plus: never \"1 year\", never a shorter number, never that some phones come with less.");
rep("\"À partir de\" and the closing phrase protect the shop without a word of explanation: the buyer reads a normal starting price, never a warning.",
    "\"À partir de\", the warranty \"up to 1 to 2 years\" and the closing phrase protect the shop without a word of explanation: the buyer reads a normal starting price and a real warranty, never a warning.");
// global wording
s = s.split("1-year warranty").join("warranty, up to 1 to 2 years");
s = s.split("garantie 1 an").join("garantie jusqu'à 1 à 2 ans");
s = s.split("garantie d'un an").join("garantie jusqu'à 1 à 2 ans");
s = s.split("un an de garantie").join("une garantie jusqu'à 1 à 2 ans");
fs.writeFileSync(__dirname + "/teaching9.js", s);
const left = (s.match(/1-year|garantie 1 an|1 an de garantie|one year|un an/g) || []);
console.log("teaching9.js written", s.length, "leftovers:", JSON.stringify(left));
