// Derives teaching25.js from teaching24.js (Nov 8 2026). Owner: "all good, don't mention any SubSell or any Google
// reviews." SubSell has been out since v21 (re-checked here); every mention of the Google reviews and the 1 700 figure
// leaves the boxes, and "Google", "reviews", "avis", "étoiles", "stars", any rating, are banned words. The trust line
// becomes: a real store right beside métro Beaubien, open 7 days, they test it in hand and pay at the counter.
const fs = require("fs");
const NL = String.fromCharCode(10);
let s = fs.readFileSync(__dirname + "/teaching24.js", "utf8");
let nrep = 0;
function rep(a, b, all) {
  const n = s.split(a).length - 1;
  if (n === 0) { console.error("MISSING anchor:", a.slice(0, 140)); process.exit(1); }
  if (n > 1 && !all) { console.error("AMBIGUOUS anchor (" + n + "):", a.slice(0, 140)); process.exit(1); }
  s = s.split(a).join(b); nrep++; return n;
}
s = "// Twenty-fifth pass (Nov 8 2026): no Google reviews, no 1 700 figure, no rating words; SubSell still 0." + NL + s;
rep("settings24.json", "settings25.json");

// ---- Business info ----
rep(`A real store with more than 1 700 Google reviews. The buyer tests the phone in hand, pays at the counter, nothing before, and leaves with it.`,
    `A real store, right beside métro Beaubien, open 7 days. The buyer tests the phone in hand, pays at the counter, nothing before, and leaves with it. Never a word about reviews, ratings or stars, never "Google": the trust is the real store, the test in hand and paying at the counter.`);
rep(`in a real store beside métro Beaubien with more than 1 700 Google reviews; they test the phone in hand, pay at the counter, nothing before, warranty, up to 1 to 2 years.`,
    `in a real store beside métro Beaubien, open 7 days; they test the phone in hand, pay at the counter, nothing before, warranty, up to 1 to 2 years.`);

// ---- Instructions ----
rep(`8. Trust in one line. A real store, more than 1 700 Google reviews, they pay at the counter, nothing before, warranty up to 1 to 2 years.`,
    `8. Trust in one line. A real store right beside métro Beaubien, open 7 days, they test it in hand, pay at the counter, nothing before, warranty up to 1 to 2 years. Never reviews, ratings, stars or "Google".`);
rep(`- They test it in hand, compare several units, pay at the counter, nothing before, and walk out with it. A real store with more than 1 700 Google reviews.`,
    `- They test it in hand, compare several units, pay at the counter, nothing before, and walk out with it. A real store right beside métro Beaubien, open 7 days.`);
rep(`a real store at 7️⃣5️⃣7️⃣ Rue Beaubien E beside the metro, open 7 days, more than 1 700 Google reviews, they test the phone in hand`,
    `a real store at 7️⃣5️⃣7️⃣ Rue Beaubien E beside the metro, open 7 days, they test the phone in hand`);
rep(`a seller is told the price is set at the shop in minutes, never sent to a site.`,
    `a seller is told the price is set at the shop in minutes, never sent to a site. Never "Google", "avis Google", "reviews", "avis", "étoiles", "stars" or any rating or review count either: the trust is the real store beside the metro, the test in hand and paying at the counter.`);

// ---- Closer goals ----
rep(`trust (real store, 1 700+ reviews, test it, pay at the counter)`,
    `trust (a real store beside the metro, open 7 days, test it, pay at the counter)`);

// ---- Examples ----
rep(`in a real store beside Beaubien metro, 1 700+ Google reviews, you test it in hand and pay at the counter, nothing before.`,
    `in a real store beside Beaubien metro, open 7 days, you test it in hand and pay at the counter, nothing before.`);
rep(`Vrai magasin à côté du métro Beaubien, plus de 1 700 avis Google, tu testes en main pis tu paies au comptoir, rien avant.`,
    `Vrai magasin à côté du métro Beaubien, ouvert 7 jours, tu testes en main pis tu paies au comptoir, rien avant.`);

fs.writeFileSync(__dirname + "/teaching25.js", s);
const t = require(__dirname + "/teaching25.js");
const msgs = [...t.examples.matchAll(/(First|Second) message: "([^"]+)"/g)];
const BAD = /à confirmer|confirme au magasin|confirmer au magasin|en appelant|appelle pour|appelez pour|change avec les arrivages|dépend des arrivages|vérifies sur place|vérifie sur place|tu le vois sur place|on vérifie|se confirme au magasin|to confirm|to be confirmed|check at the shop|verify in person|call to check|exact model you see|availability to confirm|depends on arrivals|stock changes|ça change chaque jour|contactez-nous pour confirmer|centaines de demandes|hundreds of requests|pour l'instant|ça bouge|partent vite|ça rentre|vrais deals|partent en premier|Half the people|18 Pro Max : disponibles|Fifteen minutes|15 minutes|google|review|avis|1 700|étoile|subsell/i;
const bad = msgs.filter((m) => BAD.test(m[2]));
const noShop = msgs.filter((m) => !/Beaubien/.test(m[2]));
const noFoot = msgs.filter((m) => !/premier arrivé premier servi|first come first served/.test(m[2]));
const twoQ = msgs.filter((m) => (m[2].match(/[?]/g) || []).length > 1);
const all = Object.values(t).filter((v) => typeof v === "string").join(NL);
const leftGoogle = (all.match(/google/gi) || []).length, leftReview = (all.match(/review/gi) || []).length, left1700 = (all.match(/1 700/g) || []).length, leftSub = (all.match(/subsell/gi) || []).length, leftAvis = (all.match(/\bavis\b/gi) || []).length;
console.log("teaching25.js written", s.length, "| replacements:", nrep, "| examples:", msgs.length, "| bad phrases in examples:", bad.length, "| no shop line:", noShop.length, "| no footer:", noFoot.length, "| two questions:", twoQ.length, "| left in ALL boxes (rule text included): google=" + leftGoogle + " review=" + leftReview + " 1700=" + left1700 + " avis=" + leftAvis + " subsell=" + leftSub);
for (const m of bad) console.log("BAD:", m[2].match(BAD)[0], "|", m[2].slice(0, 110));
if (bad.length || noShop.length || noFoot.length || twoQ.length || left1700 || leftSub) process.exit(1);
