// node post26.js settings26.json scenarios26.json out26 [id]
// For each scenario (or one id): every turn's buyer line, the raw model output, the FINAL text the buyer would
// receive (the extension's parseReply -> metaVerdict -> humanTouch -> newline flattening), per-text checks and
// per-chat checks (a fact said in more than one turn). Prints a readable report + a JSON summary line per chat.
const fs = require("fs"), path = require("path");
const { load } = require("./core.js");
const [settingsPath, scenariosPath, outdir, onlyId] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8")).filter((s) => !onlyId || s.id === onlyId);
const core = load();
const ownerText = core.ownerTextOf(settings);
const flatten = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();
const BAD = /à confirmer|confirme au magasin|confirmer au magasin|en appelant|appelle pour|appelez pour|change avec les arrivages|dépend des arrivages|vérifies sur place|vérifie sur place|tu le vois sur place|on vérifie|se confirme au magasin|to confirm|to be confirmed|check at the shop|verify in person|call to check|exact model you see|availability to confirm|depends on arrivals|stock changes|ça bouge|partent vite|ça rentre|vrais deals|google|review|\bavis\b|1 700|étoile|subsell|website|site web|https?:|www\.|\.ca\b|\bétat\b|\bcondition\b(?! s'appliquent| apply)|\bgrade\b|n'hésite|feel free|let me know|great question|bonne question|\bmessage\b|\bconversation\b|neither yes nor no|ni oui ni non|only given at the shop|seulement au magasin|exact price is only|prix exact je te le dis au comptoir|can't give you the exact|peux pas te donner le prix exact|1 an de garantie|one year warranty|1-year warranty/i;
const FACTS = [
  ["address", /757|beaubien/i], ["hours", /21\s?h|9\s?pm|9h à 21h|9am|ouvert jusqu|open till|open until|7 jours|7 days/i], ["liquidation", /liquidation/i],
  ["warranty", /garantie|warranty/i], ["carol", /CAROL/], ["fineprint", /premier arrivé premier servi|first come first served/i], ["tradein", /échange|trade|reprend|vieux téléphone|old phone/i],
  ["lowerbudget", /inquiète-toi pas pour les prix|don't worry about the list prices/i], ["pricepart", /à partir de|starts at|from \d/i], ["phone", /4️⃣3️⃣8️⃣/],
];
const summary = [];
for (const sc of scenarios) {
  console.log("\n==================== " + sc.id + " — " + (sc.thread || "(no listing)") + " ====================");
  const lines = [];
  const texts = [];
  const factTurns = {};
  let issues = [];
  for (let k = 1; k <= sc.turns.length; k++) {
    const buyer = sc.turns[k - 1];
    lines.push("Buyer: " + buyer);
    const pt = path.join(outdir, "replies-" + sc.id + "-t" + k + ".txt");
    const p = path.join(outdir, "replies-" + sc.id + "-t" + k + ".json");
    let raw = "";
    if (fs.existsSync(pt)) raw = fs.readFileSync(pt, "utf8").trim();
    else if (fs.existsSync(p)) { let r = JSON.parse(fs.readFileSync(p, "utf8")); if (Array.isArray(r)) r = r[0]; raw = String(r.raw || r.reply || ""); }
    else { console.log("  [turn " + k + "] Buyer: " + buyer + "\n  (no reply file)"); issues.push("t" + k + ": missing reply"); continue; }
    const parsed = core.parseReply(raw);
    const why = parsed.kind === "text" ? core.metaVerdict(parsed.text) : "";
    let text = parsed.kind === "text" ? core.humanTouch(parsed.text, { transcript: lines.join("\n"), seed: sc.id, ownerText }) : "";
    const final = flatten(text);
    const low = final.toLowerCase();
    const c = {
      kind: parsed.kind + (parsed.skip ? "/skip" : "") + (parsed.visit ? "/visit:" + parsed.visit : "") + (parsed.gap ? "/GAP" : "") + (parsed.clip ? "/CLIP" : ""),
      guard: why || "ok", chars: final.length, questions: (final.match(/\?/g) || []).length,
      emoji: (final.match(/\p{Extended_Pictographic}/gu) || []).filter((e) => !/[0-9]/.test(e)).length,
      keycap757: /7️⃣/.test(final), dollar: (final.match(/\d[\d\s]*\$|\$\s?\d+/g) || []).length,
      bad: (low.match(BAD) || [])[0] || "", batteryPct: /\d+\s?%/.test(final.replace(/20 (?:à|to) 40 ?%/g, "")) && /batter/i.test(final),
      yesNoToNumber: /^(oui|yes|yep|ouais|non|no)\b/.test(low) && /\d{3}/.test(buyer) && /\d{3}/.test(final) ? "check" : "",
    };
    const facts = FACTS.filter(([, re]) => re.test(final)).map(([n]) => n);
    for (const f of facts) (factTurns[f] = factTurns[f] || []).push(k);
    if (c.bad) issues.push("t" + k + ": banned '" + c.bad + "'");
    if (c.questions > 1) issues.push("t" + k + ": two questions");
    if (c.chars > 400 && !/Liquidation Samsung|Tablettes et iPad|Grand liquidation Laptop|iPhone XR/.test(final)) issues.push("t" + k + ": " + c.chars + " chars");
    if (c.keycap757) issues.push("t" + k + ": keycap street number");
    if (c.batteryPct) issues.push("t" + k + ": battery percentage");
    if (why) issues.push("t" + k + ": guard " + why);
    console.log("  [turn " + k + "] Buyer: " + buyer);
    console.log("  RAW:   " + raw.replace(/\n/g, " ⏎ ").slice(0, 700));
    console.log("  SENT:  " + (final || "(nothing — " + c.kind + ")"));
    console.log("  checks " + JSON.stringify(c) + " facts=" + facts.join(","));
    if (final) { lines.push("You: " + final); texts.push(final); }
  }
  const repeated = Object.entries(factTurns).filter(([f, ts]) => ts.length > 1 && f !== "pricepart").map(([f, ts]) => f + "@" + ts.join("+"));
  if (repeated.length) issues.push("repeated: " + repeated.join(" "));
  const essentialsFirst = texts.length ? { price: FACTS[8][1].test(texts[0]) || /inquiète-toi pas pour les prix|don't worry about the list prices|sur place en quelques minutes|en 5 minutes|on te le fait/i.test(texts[0]), where: /757|beaubien/i.test(texts[0]), when: /\?/.test(texts[0]) || /\[VISIT:yes\]|je t'attends|I'll be there/i.test(texts[0]) } : null;
  const total = texts.reduce((a, t) => a + t.length, 0);
  console.log("  CHAT: texts=" + texts.length + " totalChars=" + total + " essentialsInFirst=" + JSON.stringify(essentialsFirst) + " issues=" + (issues.length ? JSON.stringify(issues) : "none"));
  summary.push({ id: sc.id, texts: texts.length, totalChars: total, essentialsFirst, issues });
}
console.log("\nSUMMARY " + JSON.stringify(summary));
