// @ts-nocheck — plain JavaScript on purpose (see "No imports" below); Deno runs it as is.
// SubSell activity-log endpoint (Supabase Edge Function)
// Public POST: /subsell-log
//   body: { key: <config_key>, events: [ {...}, ... ] }                 -> inserts the rows
//   body: { key: <config_key>, read: { thread_id?, kinds?, limit? } }   -> (v0.21.79) returns the rows
// Each extension fire-and-forgets the messages it sends here; the web dashboard
// reads them back (RLS) to show a combined feed + totals across all machines.
//
// (v0.21.79) `read` is the chat memory's SECOND DOOR: a computer whose cloud login is
// waiting out a refusal (Supabase's per-address /token limit), or has ended, or that
// only ever had the config link, reads what the other computers already answered and
// sent through the same key that writes every row — no login, no /token request. The
// key already returns the account's whole config (API key included) through
// subsell-config, so reading the account's own Activity rows with it adds no exposure.
//
// (v0.21.79) NO IMPORTS. The earlier build loaded supabase-js from esm.sh on every cold
// start and answered a database error with the raw error text. On Oct 7 2026 (evening)
// the project's whole data layer stopped answering — PostgREST, GoTrue and Storage from
// outside, and the functions' own REST calls from inside (a Cloudflare 522 after 90 s,
// the gateway's 150-s idle timeout) — so the functions hung with it. Plain REST calls
// with the service role: nothing to download at cold start, a database failure answers
// "db <status>" at once, and a database that does not answer at all is given
// DB_TIMEOUT_MS (10 s) and then answered 504 "db timeout" — a worker never hangs to the
// gateway's limit again.
//
// Deploy (IMPORTANT: --no-verify-jwt so the extension can POST with no login):
//   supabase functions deploy subsell-log --no-verify-jwt
//
// The config_key IS the auth (same key already in the extension's Remote config URL).

const CORS = {
  "Access-Control-Allow-Origin": "*", // request comes from a chrome-extension:// origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const s = (v, n) => (v == null ? null : String(v).slice(0, n));

const READ_COLUMNS = "created_at,machine,kind,thread_id,buyer_text,bot_text";
const READ_LIMIT_MAX = 100;
const KIND_RE = /^[a-z_]{1,20}$/; // the `in.(...)` filter is built from these: letters only

// Service role: server-side only (env vars the platform sets), bypasses RLS. The
// config_key IS the auth.
const SB_URL = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SB_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const DB_TIMEOUT_MS = Math.max(500, Number(Deno.env.get("SUBSELL_DB_TIMEOUT_MS")) || 10000);
async function rest(path, init) {
  const headers = Object.assign(
    { apikey: SB_KEY, authorization: "Bearer " + SB_KEY, accept: "application/json", "content-type": "application/json" },
    (init && init.headers) || {},
  );
  let r;
  try {
    r = await fetch(SB_URL + "/rest/v1/" + path, Object.assign({}, init || {}, { headers, signal: AbortSignal.timeout(DB_TIMEOUT_MS) }));
  } catch (e) {
    return { ok: false, status: 504, data: null, text: "db timeout (" + DB_TIMEOUT_MS + " ms): " + String(e && e.name || e), timeout: true };
  }
  const text = await r.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_e) { data = null; }
  return { ok: r.ok, status: r.status, data, text };
}
const dbFail = (q) => json({ error: q.timeout ? "db timeout" : "db " + q.status + " " + String(q.text || "").slice(0, 200) }, q.timeout ? 504 : 500);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const key = body?.key;
    if (!key || typeof key !== "string") return json({ error: "missing key" }, 400);

    // The key is checked FIRST (before .79 an empty events list answered 200 for any
    // key): the extension drops a key the moment it is told 404.
    const cfgQ = await rest("subsell_configs?select=user_id&config_key=eq." + encodeURIComponent(key) + "&limit=1");
    if (!cfgQ.ok) return dbFail(cfgQ);
    const cfg = Array.isArray(cfgQ.data) ? cfgQ.data[0] : null;
    if (!cfg || !cfg.user_id) return json({ error: "not found" }, 404);

    // (v0.21.79) READ BACK — the account's own rows, newest first.
    const read = body?.read;
    if (read && typeof read === "object" && !Array.isArray(read)) {
      const limit = Math.max(1, Math.min(READ_LIMIT_MAX, Math.floor(Number(read.limit)) || 30));
      let path = "subsell_messages?select=" + READ_COLUMNS +
        "&user_id=eq." + encodeURIComponent(cfg.user_id) +
        "&order=created_at.desc&limit=" + limit;
      const thread = s(read.thread_id, 200);
      if (thread) path += "&thread_id=eq." + encodeURIComponent(thread);
      const kinds = Array.isArray(read.kinds) ? read.kinds.map((k) => String(k)).filter((k) => KIND_RE.test(k)).slice(0, 8) : [];
      if (kinds.length) path += "&kind=in.(" + kinds.join(",") + ")";
      const rd = await rest(path);
      if (!rd.ok) return dbFail(rd);
      return json({ ok: true, rows: Array.isArray(rd.data) ? rd.data : [] });
    }

    const events = Array.isArray(body?.events)
      ? body.events
      : body?.event
      ? [body.event]
      : [];
    if (!events.length) return json({ ok: true, inserted: 0 });

    const rows = events.slice(0, 50).map((e) => ({
      user_id: cfg.user_id,
      sent_at: e?.sent_at ? new Date(Number(e.sent_at) || Date.parse(String(e.sent_at)) || Date.now()).toISOString() : null,
      machine: s(e?.machine, 120),
      thread_id: s(e?.thread_id, 200),
      thread_name: s(e?.thread_name, 200),
      kind: s(e?.kind, 20) || "text",
      buyer_text: s(e?.buyer_text, 4000),
      bot_text: s(e?.bot_text, 4000),
    }));

    const ins = await rest("subsell_messages", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify(rows) });
    if (!ins.ok) return dbFail(ins);

    return json({ ok: true, inserted: rows.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
