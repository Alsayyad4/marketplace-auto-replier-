// SubSell config endpoint (Supabase Edge Function)
// Public GET: /subsell-config?key=<config_key>  ->  returns that user's settings JSON,
// which is exactly what the Chrome extension's "Remote config URL" expects.
//
// Deploy (IMPORTANT: --no-verify-jwt so the extension can fetch it with no login):
//   supabase functions deploy subsell-config --no-verify-jwt
//
// Resulting URL the user pastes into the extension:
//   https://<project-ref>.supabase.co/functions/v1/subsell-config?key=<their config_key>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*", // request comes from a chrome-extension:// origin
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const key = new URL(req.url).searchParams.get("key");
    if (!key) return json({ error: "missing key" }, 400);

    // Service role: server-side only (env var), bypasses RLS. The config_key IS the auth.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data, error } = await supabase
      .from("subsell_configs")
      .select("config")
      .eq("config_key", key)
      .maybeSingle();

    if (error) return json({ error: error.message }, 500);
    if (!data) return json({ error: "not found" }, 404);

    // data.config is the settings object the extension applies as-is.
    return json(data.config ?? {});
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
