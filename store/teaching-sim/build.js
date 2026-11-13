// node build.js settings.json scenarios.json outdir
// Captures the EXACT Anthropic request the extension builds for each scenario
// (system prompt + user turn) and writes outdir/system.txt + outdir/<id>.user.txt.
const fs = require("fs"), path = require("path");
const { load } = require("./core.js");
const [settingsPath, scenariosPath, outdir] = process.argv.slice(2);
const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
const scenarios = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
fs.mkdirSync(outdir, { recursive: true });
let captured = null;
const core = load((body) => { captured = body; return "captured"; });
(async () => {
  let system = null;
  const index = [];
  for (const sc of scenarios) {
    captured = null;
    const r = await core.callClaude(settings, sc.message, sc.transcript || "", sc.memory || "", undefined, sc.thread || "");
    if (r.error) { console.error(sc.id, "ERROR", r.error); continue; }
    if (!captured) { console.error(sc.id, "nothing captured"); continue; }
    const sys = captured.system[0].text, user = captured.messages[0].content;
    if (system === null) { system = sys; fs.writeFileSync(path.join(outdir, "system.txt"), sys); }
    else if (sys !== system) console.error(sc.id, "SYSTEM PROMPT DIFFERS (cache would miss)");
    fs.writeFileSync(path.join(outdir, sc.id + ".user.txt"), user);
    index.push({ id: sc.id, model: captured.model, max_tokens: captured.max_tokens, userChars: user.length });
  }
  fs.writeFileSync(path.join(outdir, "index.json"), JSON.stringify(index, null, 2));
  console.log("system chars:", system ? system.length : 0, "~tokens:", system ? Math.round(system.length / 3.6) : 0);
  console.log(JSON.stringify(index));
})();
