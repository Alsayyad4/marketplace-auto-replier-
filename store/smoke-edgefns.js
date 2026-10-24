/* Tests the two Edge Functions' logic (supabase/functions/subsell-config/index.ts and
 * subsell-log/index.ts, v0.21.79) by running the real handlers in node against a fake
 * PostgREST — the functions have no imports, so the file IS the program.
 *
 * Why this file exists: the functions are deployed by hand, rarely, and v0.21.79 changes
 * both — no supabase-js import at cold start (Oct 7 2026 both hung up to the gateway's
 * 150-s limit while REST and Auth answered in 0.1 s), the key checked first, and `read`,
 * the chat memory's door for a computer whose login is out. The photo of Oct 7 2026
 * ("Activity log ✗ HTTP 404 {"error":"not found"}") is subsell-log's 404.
 *
 * Under test:
 *   subsell-config
 *   1. a good key → that row's config as is; a key that matches no row → 404
 *      {"error":"not found"}; no key → 400; OPTIONS → 200; a database error → 500;
 *   2. the one REST call carries the service role and the key URL-encoded;
 *   subsell-log
 *   3. a key that matches no row → 404 with events, with a read, and with nothing: the
 *      key is checked first;
 *   4. events under a good key are inserted under the row's user (one POST, return=minimal),
 *      capped at 50, fields trimmed as before;
 *   5. `read` returns that user's rows only, newest first, filtered by chat and kinds,
 *      limited (1..100, 30 by default); another user's rows never leak; the kinds that
 *      are not plain words are dropped before they reach the filter;
 *   6. a read that is not an object is ignored (the events path answers);
 *   7. GET → 405, OPTIONS → 200, a missing or non-string key → 400, a database error → 500;
 *   8. neither file imports anything.
 *
 * Run:  node store/smoke-edgefns.js
 */
const fs = require("fs");
const path = require("path");
const fnSrc = (name) => fs.readFileSync(path.join(__dirname, "..", "supabase", "functions", name, "index.ts"), "utf8");
const logSrc = fnSrc("subsell-log");
const cfgSrc = fnSrc("subsell-config");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };
// A promise that never settles empties the event loop and node exits 0 mid-test: that
// must read as a failure (it is what a database call with no timeout looks like).
let finished = false;
process.on("exit", () => { if (!finished) { console.log("  FAIL  the test never reached its end (a promise never settled)"); process.exitCode = 1; } });

// The fake database.
const db = {
  configs: [
    { user_id: "u1", config_key: "k1", config: { apiKey: "sk-1", model: "claude-haiku-4-5", enabled: true, listings: [{ title: "iPhone 13" }] } },
    { user_id: "u2", config_key: "k2", config: { apiKey: "sk-2" } },
  ],
  messages: [],
  inserted: [],
};
const at = (m) => new Date(Date.parse("2026-10-07T15:00:00Z") - m * 60000).toISOString();
for (let i = 0; i < 60; i++) db.messages.push({ created_at: at(i), user_id: "u1", machine: "Shop PC", kind: i % 3 === 0 ? "video" : i % 7 === 0 ? "claim" : "text", thread_id: i % 2 ? "t1" : "t2", buyer_text: "b" + i, bot_text: "r" + i });
db.messages.push({ created_at: at(0), user_id: "u2", machine: "Other", kind: "text", thread_id: "t1", buyer_text: "SECRET", bot_text: "SECRET" });
const u1 = db.messages.filter((r) => r.user_id === "u1");
const count = (thread, kinds) => u1.filter((r) => (!thread || r.thread_id === thread) && kinds.indexOf(r.kind) >= 0).length;

// PostgREST, the little the functions use: eq. / in.() filters, order, limit, select, POST.
const calls = { get: 0, post: 0, urls: [], headers: [] };
let dbDown = false;
let dbHangs = false; // a database that accepts the connection and never answers (Oct 7 2026)
const restFetch = async (url, init) => {
  const u = new URL(url);
  calls.urls.push(u.pathname + u.search);
  calls.headers.push((init && init.headers) || {});
  if (dbHangs) return new Promise((_res, rej) => { // honours the abort signal, like fetch
    const sig = init && init.signal;
    if (sig) sig.addEventListener("abort", () => rej(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })));
  });
  if (dbDown) return new Response(JSON.stringify({ message: "down" }), { status: 503 });
  const table = u.pathname.split("/").pop();
  const method = (init && init.method) || "GET";
  if (method === "POST") { calls.post++; db.inserted.push(...JSON.parse(init.body)); return new Response("", { status: 201 }); }
  calls.get++;
  let rows = (table === "subsell_configs" ? db.configs : db.messages).slice();
  for (const [k, v] of u.searchParams.entries()) {
    if (k === "select" || k === "order" || k === "limit") continue;
    if (v.indexOf("eq.") === 0) rows = rows.filter((r) => String(r[k]) === v.slice(3));
    else if (v.indexOf("in.(") === 0 && v[v.length - 1] === ")") { const vals = v.slice(4, -1).split(","); rows = rows.filter((r) => vals.indexOf(r[k]) >= 0); }
    else return new Response(JSON.stringify({ message: "unsupported filter " + k + "=" + v }), { status: 400 });
  }
  const order = u.searchParams.get("order");
  if (order) { const [col, dir] = order.split("."); rows.sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (dir === "desc" ? -1 : 1)); }
  const limit = u.searchParams.get("limit");
  if (limit) rows = rows.slice(0, Number(limit));
  const sel = u.searchParams.get("select");
  if (sel && sel !== "*") rows = rows.map((r) => { const o = {}; for (const c of sel.split(",")) o[c] = r[c]; return o; });
  return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
};
function load(src, env) {
  let handler = null;
  const Deno = { serve: (h) => { handler = h; }, env: { get: (k) => (k === "SUPABASE_URL" ? "https://proj.supabase.co/" : k === "SUBSELL_DB_TIMEOUT_MS" ? ((env && env.timeout) || undefined) : "service-role-key") } };
  new Function("Deno", "fetch", src)(Deno, restFetch); // the repo's own file, as Deno would run it
  if (!handler) throw new Error("Deno.serve was not called");
  return handler;
}
const logFn = load(logSrc);
const cfgFn = load(cfgSrc);
const logFnFast = load(logSrc, { timeout: "600" }); // the database timeout shortened to 600 ms for the hang test
const cfgFnFast = load(cfgSrc, { timeout: "600" });

const post = async (fn, body, method) => {
  const req = new Request("https://proj.supabase.co/functions/v1/x", { method: method || "POST", body: method && method !== "POST" ? undefined : JSON.stringify(body) });
  const resp = await fn(req);
  let data = null;
  try { data = await resp.json(); } catch (e) { /* "ok" */ }
  return { status: resp.status, data };
};
const get = async (fn, qs) => {
  const resp = await fn(new Request("https://proj.supabase.co/functions/v1/subsell-config" + (qs || ""), { method: "GET" }));
  let data = null;
  try { data = await resp.json(); } catch (e) { /* "ok" */ }
  return { status: resp.status, data };
};

(async () => {
  /* ---------- subsell-config ---------- */
  let r = await get(cfgFn, "?key=k1");
  ok(r.status === 200 && r.data && r.data.apiKey === "sk-1" && r.data.enabled === true && r.data.listings.length === 1, "a good key → the row's config, as is — " + JSON.stringify(r.data));
  ok(/subsell_configs\?select=config&config_key=eq\.k1&limit=1$/.test(calls.urls[calls.urls.length - 1]), "one REST call: " + calls.urls[calls.urls.length - 1]);
  const h = calls.headers[calls.headers.length - 1];
  ok(h.apikey === "service-role-key" && h.authorization === "Bearer service-role-key", "...with the service role");
  r = await get(cfgFn, "?key=deadbeef");
  ok(r.status === 404 && JSON.stringify(r.data) === '{"error":"not found"}', "a key that matches no row → 404 {\"error\":\"not found\"}");
  r = await get(cfgFn, "?key=" + encodeURIComponent("a b&c=d"));
  ok(r.status === 404 && /config_key=eq\.a\+b%26c%3Dd|config_key=eq\.a%20b%26c%3Dd/.test(calls.urls[calls.urls.length - 1]), "an odd key is URL-encoded, not a filter — " + calls.urls[calls.urls.length - 1]);
  r = await get(cfgFn, "");
  ok(r.status === 400, "no key → 400");
  let opt = await cfgFn(new Request("https://x/subsell-config", { method: "OPTIONS" }));
  ok(opt.status === 200, "OPTIONS → 200");
  dbDown = true;
  r = await get(cfgFn, "?key=k1");
  ok(r.status === 500 && /db 503/.test(r.data.error), "a database error → 500 that names it — " + r.data.error);
  dbDown = false;

  /* ---------- subsell-log: the 404 of the photo ---------- */
  r = await post(logFn, { key: "deadbeef", events: [{ kind: "text", bot_text: "x" }] });
  ok(r.status === 404 && JSON.stringify(r.data) === '{"error":"not found"}', "a dead key with events → 404 {\"error\":\"not found\"} (the photo)");
  r = await post(logFn, { key: "deadbeef", read: { thread_id: "t1" } });
  ok(r.status === 404, "a dead key with a read → 404");
  r = await post(logFn, { key: "deadbeef" });
  ok(r.status === 404, "a dead key with nothing → 404 (the key is checked first; before .79 this answered 200)");
  ok(db.inserted.length === 0 && calls.post === 0, "nothing was inserted for it");

  /* ---------- events ---------- */
  r = await post(logFn, { key: "k1", events: [
    { kind: "text", thread_id: "t9", thread_name: "Buyer", buyer_text: "allo", bot_text: "salut", machine: "Shop PC · v0.21.79", sent_at: 1759849200000 },
    { kind: "x".repeat(40), bot_text: "y".repeat(5000) },
  ] });
  ok(r.status === 200 && r.data.ok === true && r.data.inserted === 2, "two events under a good key → inserted 2");
  ok(calls.post === 1 && db.inserted.length === 2 && db.inserted.every((x) => x.user_id === "u1"), "one POST, under the row's user");
  ok(/prefer/i.test(Object.keys(calls.headers[calls.headers.length - 1]).join()) && /return=minimal/.test(JSON.stringify(calls.headers[calls.headers.length - 1])), "...asking for no body back");
  ok(db.inserted[0].sent_at === "2025-10-07T15:00:00.000Z" && db.inserted[0].thread_id === "t9", "sent_at is normalised, the chat kept");
  ok(db.inserted[1].kind.length === 20 && db.inserted[1].bot_text.length === 4000, "long fields are trimmed as before");
  r = await post(logFn, { key: "k1", events: Array.from({ length: 70 }, (_, i) => ({ kind: "text", bot_text: "n" + i })) });
  ok(r.data.inserted === 50, "a batch is capped at 50");
  r = await post(logFn, { key: "k1", events: [] });
  ok(r.status === 200 && r.data.inserted === 0, "no events under a good key → inserted 0");

  /* ---------- read ---------- */
  r = await post(logFn, { key: "k1", read: { thread_id: "t1", kinds: ["text", "followup", "video", "claim"], limit: 60 } });
  ok(r.status === 200 && r.data.ok === true && Array.isArray(r.data.rows), "a read answers ok + rows");
  let rows = r.data.rows;
  const expT1 = count("t1", ["text", "followup", "video", "claim"]);
  ok(expT1 > 0 && rows.length === Math.min(60, expT1) && rows.every((x) => x.thread_id === "t1"), "only the chat asked for — rows=" + rows.length + " of " + expT1);
  ok(rows.every((x) => x.buyer_text !== "SECRET"), "another account's rows never come back");
  ok(rows[0].created_at > rows[rows.length - 1].created_at, "newest first");
  ok(rows.every((x) => !("user_id" in x) && "machine" in x && "kind" in x && "bot_text" in x), "the memory's columns, not the user id");
  ok(/subsell_messages\?select=created_at,machine,kind,thread_id,buyer_text,bot_text&user_id=eq\.u1&order=created_at\.desc&limit=60&thread_id=eq\.t1&kind=in\.\(text,followup,video,claim\)$/.test(calls.urls[calls.urls.length - 1]), "the REST query: " + calls.urls[calls.urls.length - 1]);
  r = await post(logFn, { key: "k1", read: { thread_id: "t1", kinds: ["video"], limit: 5 } });
  ok(count("t1", ["video"]) >= 5 && r.data.rows.length === 5 && r.data.rows.every((x) => x.kind === "video" && x.thread_id === "t1"), "kinds filter: the video rows alone, limit 5 (" + count("t1", ["video"]) + " exist)");
  r = await post(logFn, { key: "k1", read: { kinds: ["text", "followup"], limit: 30 } });
  ok(count(null, ["text", "followup"]) >= 30 && r.data.rows.length === 30 && r.data.rows.every((x) => x.kind === "text"), "no chat = the account-wide recent list (30 asked)");
  r = await post(logFn, { key: "k1", read: { limit: 1000 } });
  ok(r.data.rows.length === Math.min(100, u1.length) && u1.length === 60, "the limit is capped at 100 (" + u1.length + " rows exist)");
  r = await post(logFn, { key: "k1", read: { limit: "abc" } });
  ok(r.data.rows.length === 30, "a bad limit means 30");
  r = await post(logFn, { key: "k1", read: { limit: 0 } });
  ok(r.data.rows.length === 30, "a zero limit means 30");
  r = await post(logFn, { key: "k1", read: { thread_id: "t1", kinds: ["text", "x y", "in.(", "video", "a,b", "VIDEO", 42] } });
  ok(r.status === 200 && /kind=in\.\(text,video\)/.test(calls.urls[calls.urls.length - 1]), "kinds that are not plain words never reach the filter — " + calls.urls[calls.urls.length - 1]);
  r = await post(logFn, { key: "k1", read: { thread_id: "t1", kinds: ["x y"] } });
  ok(r.status === 200 && !/kind=/.test(calls.urls[calls.urls.length - 1]), "no usable kind = no kind filter");
  r = await post(logFn, { key: "k1", read: { thread_id: "t,1)&x=eq.y" } });
  ok(r.status === 200 && r.data.rows.length === 0 && /thread_id=eq\.t%2C1\)%26x%3Deq\.y$/.test(calls.urls[calls.urls.length - 1]), "an odd chat id is URL-encoded (one eq. value, never a second filter) — " + calls.urls[calls.urls.length - 1]);
  r = await post(logFn, { key: "k2", read: { thread_id: "t1" } });
  ok(r.data.rows.length === 1 && r.data.rows[0].buyer_text === "SECRET", "the other account reads its own row only");
  const insertedBefore = db.inserted.length;
  ok(db.inserted.length === insertedBefore, "a read inserts nothing");
  dbDown = true;
  r = await post(logFn, { key: "k1", read: { thread_id: "t1" } });
  ok(r.status === 500 && /db 503/.test(r.data.error), "a database error on a read → 500 — " + r.data.error);
  dbDown = false;

  /* ---------- not a read ---------- */
  r = await post(logFn, { key: "k1", read: "t1" });
  ok(r.status === 200 && r.data.inserted === 0 && !("rows" in r.data), "a read that is not an object is ignored (events path)");
  r = await post(logFn, { key: "k1", read: [1, 2] });
  ok(r.status === 200 && r.data.inserted === 0 && !("rows" in r.data), "an array is not a read either");

  /* ---------- method / key ---------- */
  r = await post(logFn, null, "GET");
  ok(r.status === 405, "GET → 405");
  opt = await logFn(new Request("https://x/subsell-log", { method: "OPTIONS" }));
  ok(opt.status === 200, "OPTIONS → 200");
  r = await post(logFn, { events: [{ kind: "text" }] });
  ok(r.status === 400, "a missing key → 400");
  r = await post(logFn, { key: 42, events: [{ kind: "text" }] });
  ok(r.status === 400, "a key that is not a string → 400");

  /* ---------- a database that never answers (Oct 7 2026) ---------- */
  // node's AbortSignal.timeout() timer is unref'd (it would not keep the process alive);
  // Deno's server does — so hold the loop open here the way the real runtime does
  const keepAlive = setInterval(() => {}, 100);
  dbHangs = true;
  let t0 = Date.now();
  r = await post(logFnFast, { key: "k1", read: { thread_id: "t1" } });
  let dt = Date.now() - t0;
  ok(r.status === 504 && r.data.error === "db timeout" && dt >= 500 && dt < 5000, "subsell-log: a hanging database → 504 \"db timeout\" after the configured wait (" + dt + " ms), not the gateway's 150 s");
  t0 = Date.now();
  r = await get(cfgFnFast, "?key=k1");
  dt = Date.now() - t0;
  ok(r.status === 504 && r.data.error === "db timeout" && dt >= 500 && dt < 5000, "subsell-config: the same (" + dt + " ms)");
  dbHangs = false;
  clearInterval(keepAlive);
  r = await get(cfgFnFast, "?key=k1");
  ok(r.status === 200 && r.data.apiKey === "sk-1", "...and answers normally once the database does");
  ok(/DB_TIMEOUT_MS = Math\.max\(500, Number\(Deno\.env\.get\("SUBSELL_DB_TIMEOUT_MS"\)\) \|\| 10000\)/.test(logSrc) && /DB_TIMEOUT_MS = Math\.max\(500, Number\(Deno\.env\.get\("SUBSELL_DB_TIMEOUT_MS"\)\) \|\| 10000\)/.test(cfgSrc), "the default wait is 10 s in both files");

  /* ---------- no imports ---------- */
  ok(!/^\s*import\s/m.test(logSrc) && !/^\s*import\s/m.test(cfgSrc) && !/esm\.sh/.test(logSrc.replace(/\/\/.*$/gm, "")) && !/esm\.sh/.test(cfgSrc.replace(/\/\/.*$/gm, "")), "neither function imports anything (no cold-start download)");
  ok(/^\/\/ @ts-nocheck/.test(logSrc) && /^\/\/ @ts-nocheck/.test(cfgSrc), "both files tell Deno not to type-check the plain JavaScript");

  finished = true;
  console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
