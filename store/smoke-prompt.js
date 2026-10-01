/* Tests the system-prompt assembly (background.js buildSystemPrompt) and the
 * user-turn assembly (callClaude) — the ONLY place the owner's Business tab and
 * Activity coaching reach Claude.
 *
 * v0.21.68 properties this locks in:
 *   1. A standing rule from the Activity tab renders at the TOP as an order —
 *      not as a "CORRECTED" example with a fake buyer and an empty "wrongly said".
 *   2. The owner's sections come BEFORE the built-in playbook, and the prompt
 *      carries an explicit authority order + a lookup step.
 *   3. Nothing the boss typed is silently cut short (rules up to 600 chars,
 *      graded examples at the dashboard's own 200/300 limits).
 *   4. The prompt is byte-stable for a given settings object (the fleet cache),
 *      and the clock rides the USER turn only — never the cached system prompt.
 *   5. The "every message ends with a question" script tell is gone.
 *
 * Run:  node store/smoke-prompt.js
 */
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
function slice(startMarker, endMarker) {
  const s = src.indexOf(startMarker);
  if (s < 0) { console.error("not found: " + startMarker); process.exit(1); }
  const e = src.indexOf(endMarker, s + startMarker.length);
  if (e < 0) { console.error("end not found after: " + startMarker); process.exit(1); }
  return src.slice(s, e);
}
const fnPrompt = slice("function buildSystemPrompt(", "\n/* Static FR/EN Quebec sales phrasebook");
const phrasebook = slice("const SALES_PHRASEBOOK = [", '].join("\\n");') + '].join("\\n");';
const fnTrim = slice("function trimContext(", "\n// (v0.21.68) The model has no clock");
const fnNow = slice("function nowLine(", "\nasync function callClaude(");
const fnCall = slice("async function callClaude(", "\n/* ---------------- smart follow-up");

let captured = null;
const sandbox = {
  DEFAULTS: { model: "claude-haiku-4-5" },
  fetch: async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ content: [{ type: "text", text: "ok" }] }) }; },
};
const fn = new Function("DEFAULTS", "fetch", phrasebook + "\n" + fnPrompt + "\n" + fnTrim + "\n" + fnNow + "\n" + fnCall + "\nreturn { buildSystemPrompt, callClaude, nowLine };");
const { buildSystemPrompt, callClaude, nowLine } = fn(sandbox.DEFAULTS, sandbox.fetch);

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const idx = (text, needle) => { const i = text.indexOf(needle); if (i < 0) console.log("        (missing: " + needle + ")"); return i; };

const base = {
  businessName: "SubSell", businessAddress: "757 Rue Beaubien E", businessHoursText: "9AM–10PM, 7 days",
  businessInfo: "WARRANTY: 3 months on every phone.\nPAYMENT: cash, debit, e-transfer.\nTRADE-IN: yes, evaluated in person.",
  instructions: "Short, casual, Québec French tutoiement.",
  closerMode: true, closerIntensity: "medium", noExactPrices: true, offPlatformGuard: true,
  closerGoals: "Get them into the shop.", priceList: "", examples: "", listings: [], coaching: [],
  model: "claude-haiku-4-5",
};

(async () => {
  // --- 1. a standing rule is an order at the top, not a broken example ---
  const longRule = "Never quote the exact price in chat, always say à partir de and bring them to the shop. " + "x".repeat(400) + " END-OF-RULE";
  const s1 = Object.assign({}, base, { coaching: [
    { kind: "bad", buyer: "(general rule from the boss)", bad: "", better: longRule, note: "always applies", at: 1 },
    { kind: "good", buyer: "Still available?", reply: "ouais toujours dispo, tu passes quand?", at: 2 },
    { kind: "fix", buyer: "Do you ship?", bad: "Yes we ship anywhere!", better: "en personne seulement, viens le tester au shop", note: "never offer shipping", at: 3 },
  ] });
  const p1 = buildSystemPrompt(s1);
  const iRules = idx(p1, "OWNER — STANDING RULES");
  const iPlay = idx(p1, "MASTER CLOSER PLAYBOOK");
  const iCoach = idx(p1, "OWNER — COACHING FROM REAL CHATS");
  const iInfo = idx(p1, "OWNER — BUSINESS INFO");
  const iLookup = idx(p1, "BEFORE YOU WRITE");
  const iAuth = idx(p1, "WHO WROTE WHAT, AND WHO WINS");
  ok(iRules > 0 && iRules < iPlay, "standing rule renders at the top, before the built-in playbook");
  ok(!p1.includes("(general rule from the boss)"), "the fake buyer label never reaches the prompt");
  ok(!/WRONGLY said: ""/.test(p1), 'no empty "wrongly said" — a rule is not rendered as a correction');
  ok(p1.includes("- " + longRule.slice(0, 60)) && p1.includes("END-OF-RULE"), "a 500-char rule survives uncut (old code cut at 240)");
  ok(iInfo > 0 && iInfo < iRules && iAuth > 0 && iAuth < iInfo, "authority order → business info → rules, in that order");
  ok(iCoach > iPlay, "graded examples still render as coaching after the playbook");
  ok(p1.includes('reply: "ouais toujours dispo, tu passes quand?"'), "👍 example renders with the reply");
  ok(p1.includes('(lesson: never offer shipping)') && p1.includes('"en personne seulement, viens le tester au shop"'), "👎 correction renders with its lesson and the better answer");
  const coachSection = p1.slice(iCoach);
  ok(!coachSection.includes("END-OF-RULE"), "the rule is NOT duplicated into the coaching examples");
  ok(iLookup > 0 && p1.includes("scan BUSINESS INFO, INSTRUCTIONS, STANDING RULES"), "the lookup step names the owner's sections");
  ok(p1.includes("WARRANTY: 3 months on every phone."), "business info text is present verbatim");

  // --- 2. no coaching → no empty owner headers ---
  const p0 = buildSystemPrompt(base);
  ok(!p0.includes("OWNER — STANDING RULES") && !p0.includes("OWNER — COACHING FROM REAL CHATS"), "empty coaching adds no empty sections");

  // --- 3. the script tell is gone; the human-voice tells are named ---
  ok(!p0.includes("Every message ends with exactly ONE question"), "playbook no longer demands a question on EVERY message");
  ok(p0.includes("em-dashes (—) and semicolons"), "the AI tells (em-dash, semicolon, exclamation pile-up) are banned explicitly");
  ok(p0.includes("Never echo the time back as a timestamp"), "time-awareness rule present, with the no-echo guard");

  // --- 4. byte-stable (fleet cache) + Haiku floor logic still runs ---
  ok(buildSystemPrompt(base) === p0, "same settings → byte-identical prompt (cache stays shared)");
  const est = Math.ceil(p0.length / 3.5);
  console.log(`        (default-ish config: ~${est} est. tokens before padding; padded=${p0.includes("REFERENCE PHRASEBOOK")})`);
  ok(est >= 4300 || p0.includes("REFERENCE PHRASEBOOK"), "prompt crosses the Haiku 4096 cache floor (padded when needed)");

  // --- 5. the clock rides the user turn only ---
  const d = new Date(2026, 8, 26, 21, 5); // Sat 21:05
  ok(nowLine(d) === "Current local time: Saturday 21:05.", "nowLine formats day + HH:MM (" + nowLine(d) + ")");
  await callClaude(Object.assign({}, base, { apiKey: "k" }), "Still available?", "Conversation so far (most recent last):\nBuyer: Still available?");
  ok(!!captured && captured.url.includes("api.anthropic.com"), "callClaude posts to the API");
  const sys = captured.body.system[0];
  const user = captured.body.messages[0].content;
  ok(sys.cache_control && sys.cache_control.type === "ephemeral", "system prompt still carries cache_control");
  ok(!sys.text.includes("Current local time"), "the clock is NOT in the cached system prompt");
  ok(/Current local time: \w+ \d\d:\d\d\.\nBuyer's latest message:\nStill available\?$/.test(user), "user turn = context + clock line + buyer message");
  ok(user.startsWith("Conversation so far"), "conversation context still leads the user turn");

  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
