// node ab29.js [outdir of the v29 run, default out29] — builds the reviewers' material from out28c/transcripts.json (teaching v28) and out29/transcripts.json
// (teaching v29), both written by post29.js: out29/blind-ab.md (the buyers both versions answered, as VERSION A and
// VERSION B in an order fixed per buyer and not named), a key file outside that folder (which is which: NOT for the reviewers),
// out29/facts.md (the shop's facts and price list, to check every claim against).
const fs = require("fs");
const dir = __dirname + "/";
const OUT = (process.argv[2] || "out29") + "/"; // where the v29 run and the reviewers' files live
const v28 = JSON.parse(fs.readFileSync(dir + "out28c/transcripts.json", "utf8"));
const v29 = JSON.parse(fs.readFileSync(dir + OUT + "transcripts.json", "utf8"));
const settings = JSON.parse(fs.readFileSync(dir + "settings29.json", "utf8"));
const chat = (c) => c.turns.map((t) => "Buyer: " + t.buyer + "\nShop: " + (t.sent || "(the shop sends nothing)")).join("\n");
const flip = (id) => [...id].reduce((s, ch) => s + ch.charCodeAt(0), 0) % 2 === 1; // fixed per buyer, looks arbitrary
const out = ["# Two versions of the same shop assistant, same buyers", "", "Each buyer below wrote the same three messages to a phone shop about its Marketplace ad. VERSION A and VERSION B are two different sets of answers the shop's chat assistant gave. Which version is which changes from buyer to buyer.", ""];
const key = {};
let n = 0;
for (const c29 of v29) {
  const c28 = v28.find((x) => x.id === c29.id);
  if (!c28) continue;
  n++;
  const f = flip(c29.id);
  key["buyer " + n] = { id: c29.id, A: f ? "v29" : "v28", B: f ? "v28" : "v29" };
  out.push("## Buyer " + n + " — the ad: " + c29.listing, "", "### VERSION A", "```", chat(f ? c29 : c28), "```", "", "### VERSION B", "```", chat(f ? c28 : c29), "```", "");
}
fs.writeFileSync(dir + OUT + "blind-ab.md", out.join("\n"));
// the key is written OUTSIDE the reviewers' folder (argv[3]), so that a reviewer cannot open it by mistake
const KEY = process.argv[3] || (require("os").tmpdir() + "/blind-key-v29.json");
fs.writeFileSync(KEY, JSON.stringify(key, null, 2));
const single = v29.filter((c) => !v28.find((x) => x.id === c.id));
fs.writeFileSync(dir + OUT + "blind-single.md", ["# The same assistant, two more buyers (one version only)", ""].concat(single.flatMap((c, i) => ["## Buyer S" + (i + 1) + " — the ad: " + c.listing, "```", chat(c), "```", ""])).join("\n"));
fs.writeFileSync(dir + OUT + "facts.md", [
  "# The shop's facts (what is true; check every claim in the chats against this)",
  "",
  "- Shop: Liquidation Téléphone Montréal, 757 rue Beaubien E, Montréal, beside métro Beaubien. Open 9h to 21h (9am to 9pm), 7 days, no appointment.",
  "- Shop phone (given only when a buyer asks for a number): 438 801-6771. Trade-in specialist: 438 258-7895. Technician: 438 938-6696.",
  "- Everything is in stock, several units of each model, refurbished, used and brand new, 128 / 256 / 512 GB. Liquidation week: 20 to 40 % below the usual price.",
  "- Prices are STARTING prices (\"à partir de\" / \"starts at\"). The exact price depends on the unit the buyer picks and is settled at the counter. The price in the ad (1 $) is not a price.",
  "- Warranty: up to 1 to 2 years. Phones are unlocked and tested. Payment: cash or Interac at the shop; monthly payments possible. Pickup only: no delivery, no shipping.",
  "- No holds, no reservations by phone or online; first come, first served; quantities are limited.",
  "- Trade-ins and buying phones: evaluated at the shop, cash on the spot, no amount given in the chat.",
  "- Students, newcomers and Montréal residents get an extra discount at the counter. Free with a phone: earphones, charger, power bank.",
  "- The code word CAROL belongs to one sentence only, said to a buyer whose budget is under the price of the model they asked about.",
  "- Asked whether it is a bot: the honest answer is that it is the shop's automated assistant; it must never claim to be a person.",
  "- The assistant sends three texts to a buyer at most.",
  "",
  "## The price list (the only source of a price)",
  "",
  "An iPhone line lists the models in order and their starting prices in the same order (\"iPhone 14 / 14 Pro / 14 Pro Max : à partir de 300 $ / 450 $ / 550 $\" = 14 from 300 $, 14 Pro from 450 $, 14 Pro Max from 550 $). The Samsung part is written by groups: a line of models, its starting prices on the same line or on the line under it; it gives a range for a group, not one price per model.",
  "",
  "```",
  settings.priceList,
  "```",
  "",
].join("\n"));
console.log("blind-ab.md: " + n + " buyers | blind-single.md: " + single.length + " buyers | key: " + KEY);
