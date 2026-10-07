// @ts-nocheck — plain JavaScript on purpose (see "No imports" below); Deno runs it as is.
// SubSell config endpoint (Supabase Edge Function)
// Public GET: /subsell-config?key=<config_key>  ->  returns that user's settings JSON,
// which is exactly what the Chrome extension's "Remote config URL" expects — and, since
// v0.21.79, what a logged-in computer whose cloud login cannot refresh (Supabase's
// per-address /token limit, a login that ended) pulls through instead, so its settings
// never freeze.
//
// (v0.21.79) NO IMPORTS. The earlier build loaded supabase-js from esm.sh on every cold
// start and answered a database error with the raw error text. On Oct 7 2026 (evening)
// the project's whole data layer stopped answering — PostgREST, GoTrue and Storage from
// outside, and this function's own REST call from inside (a Cloudflare 522 after 90 s,
// the gateway's 150-s idle timeout) — so the functions hung with it. The function needs
// one REST call with the service role: plain fetch, nothing to download at cold start,
// a database failure answers "db <status>" at once, and a database that does not answer
// at all is given DB_TIMEOUT_MS (10 s) and then answered 504 "db timeout" — a worker
// never hangs to the gateway's limit again.
//
// Deploy (IMPORTANT: --no-verify-jwt so the extension can fetch it with no login):
//   supabase functions deploy subsell-config --no-verify-jwt
//
// Resulting URL the user pastes into the extension:
//   https://<project-ref>.supabase.co/functions/v1/subsell-config?key=<their config_key>

const CORS = {
  "Access-Control-Allow-Origin": "*", // request comes from a chrome-extension:// origin
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// Service role: server-side only (env vars the platform sets), bypasses RLS. The
// config_key IS the auth.
const SB_URL = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const SB_KEY = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
const DB_TIMEOUT_MS = Math.max(500, Number(Deno.env.get("SUBSELL_DB_TIMEOUT_MS")) || 10000);
async function rest(path) {
  let r;
  try {
    r = await fetch(SB_URL + "/rest/v1/" + path, {
      headers: { apikey: SB_KEY, authorization: "Bearer " + SB_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(DB_TIMEOUT_MS),
    });
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

  try {
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return json({ error: "missing key" }, 400);

    const q = await rest("subsell_configs?select=config&config_key=eq." + encodeURIComponent(key) + "&limit=1");
    if (!q.ok) return dbFail(q);
    const row = Array.isArray(q.data) ? q.data[0] : null;
    if (!row) return json({ error: "not found" }, 404);

    // row.config is the settings object the extension applies as-is.
    return json(row.config ?? {});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
