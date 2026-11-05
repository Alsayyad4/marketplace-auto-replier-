// node post.js settings.json replies.json
// replies.json = [{id, raw, transcript?}] — the raw model output per scenario.
// Runs the extension's own parseReply -> metaVerdict -> humanTouch, then the content
// script's newline flattening, and prints what the BUYER would receive plus checks.
const fs = require("fs");
const { load } = require("./core.js");
const [settingsPath, repliesPath] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const replies = JSON.parse(fs.readFileSync(repliesPath, "utf8"));
const core = load();
const ownerText = core.ownerTextOf(settings);
const flatten = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();
const out = [];
for (const r of replies) {
  const parsed = core.parseReply(r.raw || "");
  const why = parsed.kind === "text" ? core.metaVerdict(parsed.text) : "";
  let text = parsed.kind === "text" ? core.humanTouch(parsed.text, { transcript: r.transcript || "", seed: r.id, ownerText }) : "";
  const final = flatten(text);
  const low = final.toLowerCase();
  const checks = {
    kind: parsed.kind, visit: parsed.visit || null, gap: !!parsed.gap, skip: !!parsed.skip,
    guard: why || "ok",
    chars: final.length,
    address: /beaubien/.test(low),
    hours: /9\s?h|21\s?h|9\s?am|9\s?pm/.test(low),
    phone: /4️⃣/.test(final) || /438/.test(final),
    startingFrom: /à partir|starts? at|starting/.test(low),
    liquidation: /liquidation/.test(low),
    warranty: /garantie|warranty/.test(low),
    questions: (final.match(/\?/g) || []).length,
    emoji: (final.match(/\p{Extended_Pictographic}/gu) || []).length,
    saysYes: /^(oui|yes|yep|ouais)\b/.test(low),
    dollarAmounts: (final.match(/\d[\d\s]*\$|\$\s?\d+/g) || []).length,
    bannedWords: (low.match(/\b(condition|état|etat|grade|messages?|conversation|reply|response)\b/g) || []),
    batteryPct: /\d+\s?%/.test(final.replace(/20 (?:à|to) 40 %/g, "")) && /batter/i.test(final),
    scareWords: (low.match(/sujet à changement|sans garantie|sous réserve|can't guarantee|no guarantee|peut changer/g) || []),
    packItems: [[/liquidation/, "liquidation"],[/20 (?:à|to) 40 %/, "20-40"],[/garantie|warranty/, "warranty"],[/carol/, "CAROL"],[/accessoires|accessories/, "accessories"],[/étudiants|students/, "students"],[/mensuel|monthly/, "monthly"],[/échange|trade|reprend|cash/, "trade-in"],[/budget/, "budget"],[/beaubien/, "shop line"]].filter(([re]) => !re.test(low)).map(([, n]) => n),
    conditionsApply: /conditions s'appliquent|conditions apply/.test(low),
    familyLine: /iphone \d+ \/ \d+ pro \/ \d+ pro max : à partir de/.test(low),
  };
  out.push({ id: r.id, checks, final });
}
for (const o of out) {
  console.log("=== " + o.id + " " + JSON.stringify(o.checks));
  console.log(o.final);
  console.log();
}
