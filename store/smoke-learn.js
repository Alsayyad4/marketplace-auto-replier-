/* (v0.21.74) RUNTIME test of the dashboard's no-code learning tools — the real
 * docs/app.js, the real background.js served to it the way the hosted site
 * serves it, a fake Anthropic endpoint and a fake Supabase:
 *
 *   1. TRY IT: a buyer message typed in the dashboard goes through the bots' own
 *      prompt / call / parse code with what is on the page; the reply is shown;
 *      a correction typed there is saved as a lesson and is USED on the very
 *      next try (learning, visible in seconds, no code);
 *   2. TEACH THESE: questions the bots could not answer are listed once each,
 *      most asked first; an answer typed there becomes a lesson and the question
 *      leaves the list; ✕ hides a line for good;
 *   3. THE BILL: measured cost from the computers' usage reports, and the
 *      per-model estimate for the saved teaching;
 *   4. a 61st rule is refused out loud; a 👎 saved with the bot's own words
 *      unchanged is refused, or kept as a rule when only the rule box was filled.
 * Run:  node store/smoke-learn.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "docs", "app.js"), "utf8");
const background = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---- a DOM that remembers children, classes and the element a selector returned ---- */
function makeDom() {
  const cache = {};
  function mkEl(id) {
    const cls = new Set();
    const el = {
      id, textContent: "", checked: false, disabled: false, readOnly: false, title: "", type: "", placeholder: "", className: "",
      style: {}, dataset: {}, files: null, children: [], _h: {}, _q: {}, _after: null,
      classList: { add: (c) => cls.add(c), remove: (c) => cls.delete(c), toggle: (c, on) => (on === undefined ? (cls.has(c) ? cls.delete(c) : cls.add(c)) : on ? cls.add(c) : cls.delete(c)), contains: (c) => cls.has(c) },
      addEventListener(ev, fn) { (el._h[ev] = el._h[ev] || []).push(fn); },
      async fire(ev, extra) { for (const fn of el._h[ev] || []) await fn(Object.assign({ preventDefault() {}, target: el, key: "" }, extra || {})); },
      appendChild(c) { el.children.push(c); return c; }, removeChild() {}, remove() { el._removed = true; }, after(n) { el._after = n; }, setAttribute() {}, getAttribute() { return ""; },
      querySelector(sel) { return (el._q[sel] = el._q[sel] || mkEl("q:" + sel)); }, querySelectorAll() { return []; }, focus() { el._focused = true; }, click() {}, select() {},
    };
    let html = "";
    Object.defineProperty(el, "innerHTML", { get: () => html, set: (v) => { html = v; if (v === "") el.children = []; } });
    let val = "";
    Object.defineProperty(el, "value", { get: () => val, set: (v) => { val = v == null ? "" : String(v); } });
    return el;
  }
  const document = {
    getElementById(id) { return (cache[id] = cache[id] || mkEl(id)); },
    querySelector() { return mkEl("qs"); }, querySelectorAll() { return []; },
    createElement(t) { return mkEl("new-" + t); }, addEventListener() {}, body: mkEl("body"),
  };
  for (const id of ["fixBanner", "draftBanner", "loginView", "teachPreview", "tryTeach", "tryFixRow", "gapBox"]) document.getElementById(id).classList.add("hidden");
  return { document, cache };
}

const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

/* ---- Supabase: one settings row, and message rows by kind ---- */
let stampN = 0;
const nextStamp = () => "2026-10-05T12:00:" + String(++stampN).padStart(2, "0") + "+00:00";
const rule = (n) => ({ kind: "bad", buyer: "(general rule from the boss)", bad: "", better: "rule " + n, note: "always applies", at: n });
const state = {
  row: {
    config: { apiKey: "sk-real", model: "claude-haiku-4-5", businessInfo: "WARRANTY: 6 months on every phone.", instructions: "", priceList: "", examples: "",
      videoLinkFallback: false, videoLinkOptIn: false, videoLinkUrl: "", videoLinkText: "", businessHoursEnabled: false, /* (v0.21.75) a row still carrying the old gate gets one system save on open */ coaching: [rule(1)] },
    config_key: "ck", updated_at: nextStamp(),
  },
  writes: 0,
  gapRows: [], usageRows: [], feed: [],
};
function makeClient() {
  function table(name) {
    const q = {
      _payload: null, _filters: {}, _head: false,
      select(_c, opts) { if (opts && opts.head) q._head = true; return q; },
      neq() { return q; }, order() { return q; }, limit() { return q; }, gte() { return q; },
      eq(col, val) { q._filters[col] = val; return q; },
      maybeSingle: async () => (name === "subsell_configs" ? { data: { config: clone(state.row.config), config_key: state.row.config_key, updated_at: state.row.updated_at }, error: null } : { data: null, error: null }),
      update(p) { q._payload = p; return q; }, insert(p) { q._payload = p; return q; },
      then(res, rej) {
        let out = { data: [], error: null };
        if (name === "subsell_configs" && q._payload) {
          if ("updated_at" in q._filters && q._filters.updated_at !== state.row.updated_at) out = { data: [], error: null };
          else { state.writes++; state.row.config = clone(q._payload.config); state.row.updated_at = nextStamp(); out = { data: [{ updated_at: state.row.updated_at }], error: null }; }
        } else if (name === "subsell_messages") {
          const k = q._filters.kind;
          if (q._head) out = { data: null, count: state.feed.length, error: null };
          else out = { data: clone(k === "gap" ? state.gapRows : k === "usage" ? state.usageRows : k === "teach" ? [] : state.feed), error: null };
        }
        return Promise.resolve(out).then(res, rej);
      },
    };
    return q;
  }
  return {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1", email: "owner@example" } } } }), onAuthStateChange() {}, signInWithPassword: async () => ({}), signOut: async () => ({}) },
    from: table,
    storage: { from: () => ({ list: async () => ({ data: [], error: null }), upload: async () => ({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: "" } }) }) },
  };
}

/* ---- the network: this site serving background.js, and the Anthropic API ---- */
const net = { serveCore: true, ai: [], aiCalls: [], coreFetches: 0 };
async function fakeFetch(url, opts) {
  url = String(url);
  if (url.indexOf("background.js") >= 0) {
    net.coreFetches++;
    return net.serveCore ? { ok: true, status: 200, text: async () => background } : { ok: false, status: 404, text: async () => "not found" };
  }
  if (url.indexOf("api.anthropic.com") >= 0) {
    const body = JSON.parse(opts.body);
    net.aiCalls.push({ body, key: opts.headers["x-api-key"] });
    const text = net.ai.length ? net.ai.shift() : "ok";
    return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text }], usage: { input_tokens: 2500, output_tokens: 12 } }) };
  }
  return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
}

async function loadPage() {
  const dom = makeDom();
  global.document = dom.document;
  global.window = { addEventListener() {}, open() {}, SUBSELL_SUPABASE_URL: "https://example.supabase.co", SUBSELL_SUPABASE_ANON_KEY: "anon", location: { href: "https://example.test/docs/", hash: "", origin: "https://example.test" }, localStorage };
  global.localStorage = localStorage;
  global.location = global.window.location;
  global.navigator = { userAgent: "node" };
  global.fetch = fakeFetch;
  global.supabase = { createClient: makeClient };
  global.alert = () => {};
  global.confirm = () => true;
  try { new Function(src)(); } catch (e) { console.error("RUNTIME ERROR in docs/app.js: " + (e && e.message)); console.error((e && e.stack || "").split("\n").slice(0, 8).join("\n")); process.exit(1); }
  await sleep(200); // getSession → showApp → loadConfig → loadFleet / loadCost
  return dom;
}
const lessons = () => state.row.config.coaching.filter((c) => c.note !== "always applies");
const rulesNow = () => state.row.config.coaching.filter((c) => c.note === "always applies");
const lastAi = () => net.aiCalls[net.aiCalls.length - 1].body;

(async () => {
  /* 3. the bill, on load */
  state.usageRows = [
    { created_at: "2026-10-05T10:00:00Z", machine: "Shop PC · v0.21.74 #PC-aaaaa", bot_text: "usage 2026-10-04 model=claude-haiku-4-5 calls=100 in=260000 cr=0 cw=0 out=6000" },
    { created_at: "2026-10-04T15:00:00Z", machine: "Shop PC · v0.21.74 #PC-aaaaa", bot_text: "usage 2026-10-04 model=claude-haiku-4-5 calls=60 in=156000 cr=0 cw=0 out=3600" },
  ];
  let dom = await loadPage();
  const cost = dom.cache.costLine.textContent;
  ok(/Measured on your computers, last 30 days: 100 AI replies ≈ \$0\.29 \(≈ \$2\.90 per 1,000\)\. Input read from the cache: 0%\./.test(cost), "3. the bill is measured from the computers' own reports: " + JSON.stringify(cost.split("\n")[0]));
  ok(/Estimate for the teaching saved now \(an instruction sheet of about \d+ tokens\), per 1,000 replies: claude-haiku-4-5 ≈ \$\d+\.\d\d \(sheet too short to cache: under 4096 tokens\) · claude-sonnet-4-6 ≈ \$\d+\.\d\d \(sheet cached\)/.test(cost), "3. …and estimated per model for the teaching saved now, with each model's cache minimum");
  ok(net.coreFetches === 1 && state.writes === 0, "3. the bots' code was fetched once from this site; nothing was written");

  /* 1. try it */
  net.ai = ["[GAP] je te confirme ça au shop"];
  dom.cache.tryText.value = "vous livrez?";
  await dom.cache.tryAsk.fire("click");
  ok(dom.cache.tryLog.textContent === "Buyer: vous livrez?\nBot: je te confirme ça au shop", "1. the reply is shown as the buyer would get it (the [GAP] mark is stripped): " + JSON.stringify(dom.cache.tryLog.textContent));
  let b = lastAi();
  ok(b.model === "claude-haiku-4-5" && net.aiCalls[0].key === "sk-real" && b.system[0].text.includes("<owner_business_info>\nWARRANTY: 6 months on every phone.") && b.system[0].text.includes("- rule 1") && /Buyer's latest message:\nvous livrez\?$/.test(b.messages[0].content), "1. the request is the bots' own: owner-only prompt built from this page, the saved rule, the message last");
  ok(/does not answer this/.test(dom.cache.tryNote.textContent) && !dom.cache.tryTeach.classList.contains("hidden") && net.coreFetches === 1, "1. the page says the teaching had no answer, and offers to teach");
  await dom.cache.tryBad.fire("click");
  ok(!dom.cache.tryFixRow.classList.contains("hidden"), "1. 👎 opens the correction box");
  dom.cache.tryFix.value = "non, c'est en personne au shop seulement";
  await dom.cache.tryFixSave.fire("click");
  ok(state.writes === 1 && lessons().length === 1 && lessons()[0].kind === "fix" && lessons()[0].buyer === "vous livrez?" && lessons()[0].bad === "je te confirme ça au shop" && lessons()[0].better === "non, c'est en personne au shop seulement", "1. the correction is saved as a lesson (one write)");
  ok(/Taught/.test(dom.cache.tryNote.textContent) && dom.cache.tryFix.value === "" && dom.cache.tryFixRow.classList.contains("hidden"), "1. the page confirms it and clears the box");
  net.ai = ["non, c'est en personne au shop seulement"];
  dom.cache.tryText.value = "Vous livrez ?";
  await dom.cache.tryAsk.fire("click");
  b = lastAi();
  ok(b.messages[0].content.includes('The owner corrected the bot on this same kind of message. The owner\'s answer: "non, c\'est en personne au shop seulement".') && b.system[0].text.includes('Correct answer: "non, c\'est en personne au shop seulement"'), "1. asked again, the lesson is in the instructions AND beside the message — learned in seconds, without any code");
  ok(/It had a lesson of yours beside this message/.test(dom.cache.tryNote.textContent) && b.messages[0].content.includes("Buyer: vous livrez?\nYou: je te confirme ça au shop\nBuyer: Vous livrez ?"), "1. the page says a lesson was used; the try-it chat keeps its own history as context");
  await dom.cache.tryGood.fire("click");
  ok(state.writes === 2 && lessons().length === 2 && lessons()[1].kind === "good" && lessons()[1].buyer === "Vous livrez ?" && lessons()[1].reply === "non, c'est en personne au shop seulement", "1. 👍 saves the answer as a model answer");
  net.ai = ["[HUMAN] wants a phone number"];
  dom.cache.tryText.value = "c'est quoi ton numéro?";
  await dom.cache.tryAsk.fire("click");
  ok(/Bot: \(the bot would hand this chat to you: wants a phone number\)$/.test(dom.cache.tryLog.textContent) && dom.cache.tryGood.disabled === true, "1. a hand-over to the owner is shown as such, and cannot be saved as a model answer");
  await dom.cache.tryReset.fire("click");
  ok(dom.cache.tryLog.textContent === "" && dom.cache.tryTeach.classList.contains("hidden"), "1. New chat clears the try-it conversation");
  const aiBefore = net.aiCalls.length;
  dom.cache.apiKey.value = "";
  state.row.config.apiKey = ""; // (the page keeps a stored key when the box is blank — make the page believe there is none)
  dom = await loadPage();
  dom.cache.tryText.value = "allo";
  await dom.cache.tryAsk.fire("click");
  ok(net.aiCalls.length === aiBefore && /API key/.test(dom.cache.tryNote.textContent), "1. without an API key nothing is called and the page says what is missing");
  state.row.config.apiKey = "sk-real";
  net.serveCore = false;
  dom = await loadPage();
  dom.cache.tryText.value = "allo";
  await dom.cache.tryAsk.fire("click");
  ok(net.aiCalls.length === aiBefore && /not available here/.test(dom.cache.tryNote.textContent) && !/Estimate for the teaching/.test(dom.cache.costLine.textContent), "1. if the bots' code cannot be fetched, try-it says so and the page keeps working (no estimate, nothing broken)");
  net.serveCore = true;

  /* 2. teach these */
  state.gapRows = [
    { created_at: "2026-10-05T15:00:00Z", buyer_text: "Vous prenez les cartes de crédit?", bot_text: "je te confirme ça au shop" },
    { created_at: "2026-10-05T14:00:00Z", buyer_text: "vous prenez les cartes de credit", bot_text: "le mieux c'est de confirmer au shop" },
    { created_at: "2026-10-05T13:30:00Z", buyer_text: "vous livrez", bot_text: "x" },
    { created_at: "2026-10-05T12:00:00Z", buyer_text: "la batterie est à combien %?", bot_text: "y" },
  ];
  state.feed = [{ created_at: "2026-10-05T15:00:00Z", sent_at: null, machine: "Shop PC · v0.21.74 #PC-aaaaa", thread_name: "Marc · iPhone 13", kind: "text", buyer_text: "c'est combien?", bot_text: "le prix se donne en personne" }];
  dom = await loadPage();
  await dom.cache.refreshActivity.fire("click");
  await sleep(50);
  let box = dom.cache.gapBox;
  const gapItems = () => box.children.slice(2); // [title, hint, …one block per question]
  ok(!box.classList.contains("hidden") && gapItems().length === 2, "2. the questions the bots could not answer are listed, one line each (the one already taught — “vous livrez” — is not)");
  ok(/cartes de crédit/.test(gapItems()[0].children[0].textContent) && /asked 2 times/.test(gapItems()[0].children[0].textContent) && /the bot said: “je te confirme ça au shop”/.test(gapItems()[0].children[0].textContent), "2. most asked first, with the count and what the bot said: " + JSON.stringify(gapItems()[0].children[0].textContent));
  const [inp, teach] = gapItems()[0].children[1].children;
  const w0 = state.writes;
  await teach.fire("click");
  ok(state.writes === w0 && inp._focused === true, "2. an empty answer saves nothing");
  inp.value = "oui, crédit, débit et comptant";
  await teach.fire("click");
  const taught = lessons()[lessons().length - 1];
  ok(state.writes === w0 + 1 && taught.kind === "fix" && taught.buyer === "Vous prenez les cartes de crédit?" && taught.better === "oui, crédit, débit et comptant" && taught.bad === "je te confirme ça au shop", "2. the typed answer becomes a lesson on that question");
  ok(gapItems().length === 1 && /batterie/.test(gapItems()[0].children[0].textContent), "2. …and the question leaves the list at once");
  await gapItems()[0].children[1].children[2].fire("click"); // ✕
  ok(box.classList.contains("hidden") && gapItems().length === 0 && [...store.keys()].some((k) => k.indexOf("subsell_gap_dismissed") === 0), "2. ✕ hides a line and remembers it in this browser");

  /* 4a. a 👎 with the bot's words unchanged */
  const tr = dom.cache.activityTable._q.tbody.children[0];
  const [, down] = tr.children[tr.children.length - 1].children; // the Teach cell: 👍, 👎
  await down.fire("click");
  const ftd = tr._after.children[0];
  const [ta, note] = ftd.children;
  const save = ftd.children[2].children[0];
  const w1 = state.writes, n1 = state.row.config.coaching.length;
  ok(ta.value === "le prix se donne en personne", "4. 👎 opens the editor with the bot's reply in it");
  await save.fire("click");
  ok(state.writes === w1 && /Change the text/.test(save.textContent), "4. saving it unchanged is refused: it would teach the mistake as the right answer");
  note.value = "never give a price in chat";
  await save.fire("click");
  ok(state.writes === w1 + 1 && rulesNow().some((c) => c.better === "never give a price in chat") && state.row.config.coaching.length === n1 + 1 && !lessons().some((c) => c.better === "le prix se donne en personne"), "4. …and with only the rule box filled, the rule is kept as a standing rule");

  /* 4b. the 61st rule */
  state.row.config.coaching = Array.from({ length: 60 }, (_, i) => rule(i + 1));
  dom = await loadPage();
  const w2 = state.writes;
  dom.cache.ruleText.value = "rule 61";
  await dom.cache.addRule.fire("click");
  ok(state.writes === w2 && /You have 60 rules/.test(dom.cache.savedMsg.textContent) && dom.cache.ruleText.value === "rule 61" && rulesNow().length === 60, "4. a 61st rule is refused out loud — no rule is ever dropped silently to make room");

  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
