// Derives teaching21.js from teaching20.js (Nov 7 2026, owner: "dont mention subsell"): the shop is Liquidation Téléphone
// Montréal and nothing else — the brand name SubSell and the website subselltrade.ca leave every box the buyer can hear;
// sellers get "cash on the spot, evaluated in minutes at the shop" with no website. Nothing else changes.
const fs = require("fs");
let s = fs.readFileSync(__dirname + "/teaching20.js", "utf8");
function rep(a, b, all) {
  const n = s.split(a).length - 1;
  if (n === 0) { console.error("MISSING anchor:", a.slice(0, 100)); process.exit(1); }
  if (n > 1 && !all) { console.error("AMBIGUOUS anchor (" + n + "):", a.slice(0, 100)); process.exit(1); }
  s = s.split(a).join(b);
  return n;
}
s = "// Twenty-first pass (Nov 7 2026): the shop is Liquidation Téléphone Montréal only — no SubSell, no subselltrade.ca.\n" + s;
rep("settings20.json", "settings21.json");
// Business info
rep("Shop: Liquidation Téléphone Montréal (SubSell), 7️⃣5️⃣7️⃣ Rue Beaubien E, Montréal, right beside métro Beaubien.",
    "Shop: Liquidation Téléphone Montréal, 7️⃣5️⃣7️⃣ Rue Beaubien E, Montréal, right beside métro Beaubien. That is the only name the shop has in the chat: never another brand name, never a website; the shop is its name, its address, its hours and its phone.");
rep("We buy phones for cash on the spot, at the highest prices, and we pay more when someone brings several devices. Buyback prices and the trade form are on subselltrade.ca",
    "We buy phones for cash on the spot, at the highest prices, and we pay more when someone brings several devices. The buyback price is given at the shop, in a few minutes, in front of them; never a website, never an amount in the chat.");
rep("Q: How much for my phone? → Cash on the spot, evaluated in minutes at the shop; the buyback prices are on subselltrade.ca; no amount in the chat; worth more on an exchange than in cash.",
    "Q: How much for my phone? → Cash on the spot, evaluated in minutes at the shop, in front of them; no amount in the chat and no website; worth more on an exchange than in cash.");
// Instructions
rep("The words of your own rules never go to a buyer either: \"neither yes nor no\", \"I can't confirm\", \"the owner\", \"the rules\".",
    "The words of your own rules never go to a buyer either: \"neither yes nor no\", \"I can't confirm\", \"the owner\", \"the rules\". The shop is Liquidation Téléphone Montréal and nothing else: never another brand name, never a website address; a seller is told the price is set at the shop in minutes, never sent to a site.");
rep("(and a more recent phone in liquidation with the warranty, up to 1 to 2 years for just the difference), the buyback prices are on subselltrade.ca, bring it and any other device (we pay more for several), when do they come.",
    "(and a more recent phone in liquidation with the warranty, up to 1 to 2 years for just the difference), the price is set at the shop in a few minutes in front of them, bring it and any other device (we pay more for several), when do they come.");
// Examples
rep("pis en échange contre un plus récent ton 13 vaut encore plus. Les prix de rachat sont sur subselltrade.ca. C'est la semaine de liquidation:",
    "pis en échange contre un plus récent ton 13 vaut encore plus. Le prix de rachat, on te le fait sur place en quelques minutes, devant toi. C'est la semaine de liquidation:");
fs.writeFileSync(__dirname + "/teaching21.js", s);
const t = require(__dirname + "/teaching21.js");
const all = Object.values(t).filter((v) => typeof v === "string").join("\n");
const left = (all.match(/subsell/gi) || []).length;
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)].length;
console.log("teaching21.js written", s.length, "| examples:", msgs, "| subsell left in the boxes:", left);
if (left) process.exit(1);
