// SubSell activity-log endpoint (Supabase Edge Function)
// Public POST: /subsell-log  body: { key: <config_key>, events: [ {...}, ... ] }
// Each extension fire-and-forgets the messages it sends here; the web dashboard
// reads them back (RLS) to show a combined feed + totals across all machines.
//
// Deploy (IMPORTANT: --no-verify-jwt so the extension can POST with no login):
//   supabase functions deploy subsell-log --no-verify-jwt
//
// The config_key IS the auth (same key already in the extension's Remote config URL).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*", // request comes from a chrome-extension:// origin
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

const s = (v: unknown, n: number): string | null =>
  v == null ? null : String(v).slice(0, n);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const key = body?.key;
    if (!key) return json({ error: "missing key" }, 400);

    const events = Array.isArray(body?.events)
      ? body.events
      : body?.event
      ? [body.event]
      : [];
    if (!events.length) return json({ ok: true, inserted: 0 });

    // Service role: server-side only (env var), bypasses RLS. config_key is the auth.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg, error: cfgErr } = await supabase
      .from("subsell_configs")
      .select("user_id")
      .eq("config_key", key)
      .maybeSingle();
    if (cfgErr) return json({ error: cfgErr.message }, 500);
    if (!cfg) return json({ error: "not found" }, 404);

    const rows = events.slice(0, 50).map((e: Record<string, unknown>) => ({
      user_id: cfg.user_id,
      sent_at: e?.sent_at ? new Date(Number(e.sent_at) || Date.parse(String(e.sent_at)) || Date.now()).toISOString() : null,
      machine: s(e?.machine, 120),
      thread_id: s(e?.thread_id, 200),
      thread_name: s(e?.thread_name, 200),
      kind: s(e?.kind, 20) || "text",
      buyer_text: s(e?.buyer_text, 4000),
      bot_text: s(e?.bot_text, 4000),
    }));

    const { error } = await supabase.from("subsell_messages").insert(rows);
    if (error) return json({ error: error.message }, 500);

    return json({ ok: true, inserted: rows.length });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
