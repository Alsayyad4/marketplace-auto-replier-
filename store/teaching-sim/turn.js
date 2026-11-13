// node turn.js settings26.json scenarios26.json out26 <id> <turn>
// Multi-turn simulator step (v26). Scenario = {id, thread, turns: [buyer line 1, buyer line 2, ...]}.
// For turn N it rebuilds the chat so far from the scripted buyer lines and the bot's earlier replies
// (out26/replies-<id>-t<k>.json, k < N, each {raw}), passes each earlier reply through the extension's own
// parseReply -> humanTouch -> newline flattening (what the buyer received), adds the memory note the
// extension writes from its own earlier texts (memoryLine's facts logic), then captures the EXACT request
// the extension would send: out26/system.txt (once) + out26/<id>-t<N>.user.txt.
const fs = require("fs"), path = require("path");
const { load } = require("./core.js");
const [settingsPath, scenariosPath, outdir, sid, turnStr] = process.argv.slice(2);
const turn = Number(turnStr);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const sc = JSON.parse(fs.readFileSync(scenariosPath, "utf8")).find((s) => s.id === sid);
if (!sc) throw new Error("no scenario " + sid);
if (!(turn >= 1 && turn <= sc.turns.length)) throw new Error("turn out of range for " + sid + ": " + turnStr);
fs.mkdirSync(outdir, { recursive: true });
let captured = null;
const core = load((body) => { captured = body; return "captured"; });
const flatten = (t) => String(t).replace(/\s*\n\s*/g, " ").trim();
const ownerText = core.ownerTextOf(settings);

// what the extension's memoryLine says about our own earlier texts (no cloud rows in the sim)
function memoryNote(settings, transcript) {
  const ours = [];
  for (const l of String(transcript || "").split("\n")) { if (l.indexOf("You: ") === 0 && l.slice(5).trim()) ours.push(l.slice(5).trim()); }
  const n = ours.length;
  const has = (re) => ours.some((t) => re.test(t));
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const facts = [];
  const addr = String((settings && settings.businessAddress) || "");
  const num = (addr.match(/\d{2,}/) || [])[0];
  const street = addr.replace(/[^\p{L}\s]/gu, " ").split(/\s+/).filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] || "";
  if (num && street) {
    if (has(new RegExp("\\b" + esc(num) + "\\b[^\\n]{0,40}" + esc(street) + "|" + esc(street) + "[^\\n]{0,40}\\b" + esc(num) + "\\b", "i"))) facts.push("the address");
  } else if (num ? has(new RegExp("\\b" + esc(num) + "\\b")) : (street && has(new RegExp(esc(street), "i")))) facts.push("the address");
  if (has(/\b(ouvert|open|ferm[ée]?|clos[ée]?|jusqu|until|till|de\s+\d{1,2}\s?(am|pm|h)?\s+(à|a|to)|from\s+\d{1,2}\s?(am|pm|h)?\s+(to|till|until))\b[^.!?\n]{0,40}?\b\d{1,2}\s?(am|pm|h)\b/i) ||
      has(/\b\d{1,2}\s?(am|pm|h)\b[^.!?\n]{0,30}?\b(ouvert|open|ferm|clos)/i) ||
      has(/\b7\s?(jours|days|j\b|\/7)/i)) facts.push("the hours");
  if (has(/trade[- ]?in|[ée]change|reprise|buyback|rachat|\b(ton|votre|your)\s+(vieux |ancien |old |current )?(cell|t[ée]l[ée]phone|phone)\b/i)) facts.push("the trade-in line");
  if (has(/liquidation|clearance/i)) facts.push("the liquidation line");
  if (has(/garantie|warranty/i)) facts.push("the warranty");
  if (has(/\$\s?\d|\d\s?\$|à partir de|\bstarts? at\b|\bstarting at\b/i)) facts.push("a price");
  if (has(/\bm[ée]tro\b/i)) facts.push("the metro");
  if (has(/\b(cash|interac|e-?transfer|virement|comptant)\b/i)) facts.push("how to pay");
  const opener = (t) => { const w = String(t || "").trim().split(/\s+/)[0] || ""; const c = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""); return c.length >= 2 ? c : ""; };
  const uniq = (arr) => { const seen = new Set(); const out = []; for (const x of arr) { const k = String(x).toLowerCase(); if (!x || seen.has(k)) continue; seen.add(k); out.push(x); } return out; };
  const mineOpeners = uniq(ours.slice(-6).map(opener)).slice(-4);
  const q = (arr) => arr.map((w) => '"' + w + '"').join(", ");
  const ord = (k) => (k === 1 ? "1st" : k === 2 ? "2nd" : k === 3 ? "3rd" : k + "th");
  const parts = [];
  // (v27) mirrors background.js memoryLine v0.21.95: the per-chat cap tells the model when a text is its last
  const capN = Math.max(0, Math.floor(Number(settings && settings.maxRepliesPerConvo) || 0));
  const capLimit = capN && String((settings && settings.convoCapBehavior) || "stop") === "close" ? Math.max(1, capN - 1) : capN;
  const last = !!(capN && n + 1 >= capLimit);
  if (n > 0) parts.push("this will be your " + ord(n + 1) + (last ? " and last" : "") + " message to this buyer, so no greeting and no re-introduction");
  else if (last) parts.push("this will be your only message to this buyer");
  if (last) parts.push("nobody answers here after this message, so it must leave them everything they need to come by, the address and the hours in it, and end without a question");
  if (facts.length) parts.push("you already told them " + facts.join(", ") + " (if the owner's instructions have you say any of it again, say it in new words, never the same sentence)");
  if (mineOpeners.length) parts.push("openers you already used in this chat, do not reuse them: " + q(mineOpeners));
  if (!parts.length) return "";
  return "MEMORY OF THIS CHAT (from your own earlier messages, follow it): " + parts.join(". ") + ".";
}

const lines = [];
for (let k = 1; k < turn; k++) {
  lines.push("Buyer: " + sc.turns[k - 1]);
  const pt = path.join(outdir, "replies-" + sid + "-t" + k + ".txt");
  const p = path.join(outdir, "replies-" + sid + "-t" + k + ".json");
  let rawPrev = "";
  if (fs.existsSync(pt)) rawPrev = fs.readFileSync(pt, "utf8");
  else if (fs.existsSync(p)) { let r = JSON.parse(fs.readFileSync(p, "utf8")); if (Array.isArray(r)) r = r[0]; rawPrev = String(r.raw || r.reply || ""); }
  else throw new Error("missing " + pt);
  const parsed = core.parseReply(rawPrev.trim());
  let text = parsed.kind === "text" ? core.humanTouch(parsed.text, { transcript: lines.join("\n"), seed: sid, ownerText }) : "";
  text = flatten(text);
  if (text) lines.push("You: " + text);
}
const transcript = lines.join("\n");
const memory = memoryNote(settings, transcript);
(async () => {
  const r = await core.callClaude(settings, sc.turns[turn - 1], transcript, memory, undefined, sc.thread || "");
  if (r.error) throw new Error(r.error);
  if (!captured) throw new Error("nothing captured");
  const sys = captured.system[0].text;
  const user = typeof captured.messages[0].content === "string" ? captured.messages[0].content : JSON.stringify(captured.messages[0].content);
  const sysPath = path.join(outdir, "system.txt");
  if (!fs.existsSync(sysPath)) fs.writeFileSync(sysPath, sys);
  else if (fs.readFileSync(sysPath, "utf8") !== sys) console.error("SYSTEM PROMPT DIFFERS (cache would miss)");
  const up = path.join(outdir, sid + "-t" + turn + ".user.txt");
  fs.writeFileSync(up, user);
  console.log("wrote " + up + " (" + user.length + " chars; system " + sys.length + " chars; memory: " + (memory ? "yes" : "none") + ")");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
