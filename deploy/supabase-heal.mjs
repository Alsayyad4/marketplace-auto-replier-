// Heals the SubSell Supabase project with the Management API, using the owner's access
// token from the environment (SUPABASE_ACCESS_TOKEN). Steps, each reported:
//   1. health of db / auth / rest / storage;  2. restart the project if unhealthy;
//   3. wait for the public REST endpoint to answer;  4. report compute + usage so the
//   owner can decide on Micro (done with --upgrade);  5. (separate script) deploys.
// Usage: SUPABASE_ACCESS_TOKEN=<token from supabase.com/dashboard/account/tokens> node deploy/supabase-heal.mjs [--restart] [--upgrade] [--no-wait]
// (v0.21.79, Oct 7 2026: the project went Unhealthy on Nano compute; this restarted it in about 4.5 min.)
// The two Edge Functions deploy with:
//   npx --yes supabase functions deploy subsell-log --project-ref tcqunihripihroseswgy --no-verify-jwt
//   npx --yes supabase functions deploy subsell-config --project-ref tcqunihripihroseswgy --no-verify-jwt
import process from "node:process";

const REF = "tcqunihripihroseswgy";
const API = "https://api.supabase.com/v1";
const PUBLIC_URL = "https://" + REF + ".supabase.co";
const ANON = "sb_publishable_arlG6dkWL4H7PPW0xVMIUw_3CNzUc8R"; // public by design (shipped in the extension)
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const args = new Set(process.argv.slice(2));
if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN is not set"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, path, body) {
  const r = await fetch(API + path, {
    method, headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: r.status, ok: r.ok, data };
}
async function publicRest() {
  const t0 = Date.now();
  try {
    const r = await fetch(PUBLIC_URL + "/rest/v1/subsell_configs?select=updated_at&limit=1", { headers: { apikey: ANON }, signal: AbortSignal.timeout(15000) });
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, ms: Date.now() - t0, err: String(e && e.name || e) }; }
}
const line = (s) => console.log(new Date().toISOString().slice(11, 19) + "  " + s);

const proj = await api("GET", "/projects/" + REF);
line("project: " + (proj.ok ? JSON.stringify({ name: proj.data.name, region: proj.data.region, status: proj.data.status, created: proj.data.created_at }) : "HTTP " + proj.status + " " + JSON.stringify(proj.data).slice(0, 200)));
if (!proj.ok) process.exit(1);

const health = await api("GET", "/projects/" + REF + "/health?services=db,auth,rest,storage,realtime");
line("health: " + JSON.stringify(health.data));
const unhealthy = Array.isArray(health.data) ? health.data.filter((h) => !h.healthy).map((h) => h.name) : ["unknown"];
line("public REST now: " + JSON.stringify(await publicRest()));

const addons = await api("GET", "/projects/" + REF + "/billing/addons");
line("addons: " + JSON.stringify(addons.data).slice(0, 600));

if (args.has("--restart")) {
  line("restarting the project (POST /restart) …");
  const rs = await api("POST", "/projects/" + REF + "/restart");
  line("restart: HTTP " + rs.status + " " + JSON.stringify(rs.data).slice(0, 200));
  if (!args.has("--no-wait")) {
    for (let i = 0; i < 40; i++) { // up to ~10 min
      await sleep(15000);
      const p = await api("GET", "/projects/" + REF);
      const h = await api("GET", "/projects/" + REF + "/health?services=db,auth,rest,storage");
      const pub = await publicRest();
      const bad = Array.isArray(h.data) ? h.data.filter((x) => !x.healthy).map((x) => x.name) : ["?"];
      line("status=" + (p.data && p.data.status) + " unhealthy=" + JSON.stringify(bad) + " publicREST=" + pub.status + " (" + pub.ms + " ms)");
      if (p.data && p.data.status === "ACTIVE_HEALTHY" && bad.length === 0 && pub.status === 200) { line("HEALTHY"); break; }
    }
  }
} else {
  line("unhealthy services: " + JSON.stringify(unhealthy) + " (pass --restart to restart the project)");
}

if (args.has("--upgrade")) {
  line("applying compute add-on ci_micro …");
  const up = await api("POST", "/projects/" + REF + "/billing/addons", { addon_type: "compute_instance", addon_variant: "ci_micro" });
  line("upgrade: HTTP " + up.status + " " + JSON.stringify(up.data).slice(0, 300));
}
