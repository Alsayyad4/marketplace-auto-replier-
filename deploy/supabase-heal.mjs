// Heals and maintains the SubSell Supabase project with the Management API, using the
// owner's access token from the environment (SUPABASE_ACCESS_TOKEN — make one at
// supabase.com/dashboard/account/tokens, delete it afterwards). Steps, each reported:
//   (always)      the project's status, the health of db / auth / rest / storage / realtime,
//                 the public REST endpoint, the compute add-on;
//   --restart     restart the project when its services are unhealthy, then wait for them
//                 (v0.21.79, Oct 7 2026: Unhealthy on Nano compute; this healed it in ~4.5 min);
//   --upgrade     apply the Micro compute add-on (PATCH; the project RESIZES for ~5 min);
//   --retention   apply supabase/retention.sql (pg_cron purge of the Activity log: feed 5 days,
//                 teach/usage 35, video 60 — v0.21.80);
//   --purge       run the purge now in batches of 20,000 until nothing is left to delete
//                 (the first run after months of rows; the hourly job then keeps up);
//   --sql "..."   run one read-only query and print the rows (diagnostics).
// Usage: SUPABASE_ACCESS_TOKEN=... node deploy/supabase-heal.mjs [--restart] [--upgrade] [--retention] [--purge] [--sql "select ..."] [--no-wait]
// The two Edge Functions deploy with:
//   npx --yes supabase functions deploy subsell-log --project-ref tcqunihripihroseswgy --no-verify-jwt
//   npx --yes supabase functions deploy subsell-config --project-ref tcqunihripihroseswgy --no-verify-jwt
import process from "node:process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REF = "tcqunihripihroseswgy";
const API = "https://api.supabase.com/v1";
const PUBLIC_URL = "https://" + REF + ".supabase.co";
const ANON = "sb_publishable_arlG6dkWL4H7PPW0xVMIUw_3CNzUc8R"; // public by design (shipped in the extension)
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const argv = process.argv.slice(2);
const args = new Set(argv.filter((a) => a.startsWith("--")));
if (!TOKEN) { console.error("SUPABASE_ACCESS_TOKEN is not set"); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const line = (s) => console.log(new Date().toISOString().slice(11, 19) + "  " + s);
async function api(method, p, body) {
  const r = await fetch(API + p, {
    method, headers: { authorization: "Bearer " + TOKEN, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
  });
  const text = await r.text();
  let data = null; try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  return { status: r.status, ok: r.ok, data };
}
const sql = (query) => api("POST", "/projects/" + REF + "/database/query", { query });
async function publicRest() {
  const t0 = Date.now();
  try {
    const r = await fetch(PUBLIC_URL + "/rest/v1/subsell_configs?select=updated_at&limit=1", { headers: { apikey: ANON }, signal: AbortSignal.timeout(15000) });
    return { status: r.status, ms: Date.now() - t0 };
  } catch (e) { return { status: 0, ms: Date.now() - t0, err: String(e && e.name || e) }; }
}
async function healthNow() {
  const h = await api("GET", "/projects/" + REF + "/health?services=db,auth,rest,storage,realtime");
  const bad = Array.isArray(h.data) ? h.data.filter((x) => !x.healthy).map((x) => x.name) : ["unknown"];
  return { bad, raw: h.data };
}
async function waitHealthy(label) {
  for (let i = 0; i < 28; i++) { // up to ~8 min
    await sleep(15000);
    const p = await api("GET", "/projects/" + REF);
    const { bad } = await healthNow();
    const pub = await publicRest();
    line(label + ": status=" + (p.data && p.data.status) + " unhealthy=" + JSON.stringify(bad) + " publicREST=" + pub.status + " (" + pub.ms + " ms)");
    if (p.data && p.data.status === "ACTIVE_HEALTHY" && bad.length === 0 && pub.status === 200) { line("HEALTHY"); return true; }
  }
  return false;
}

const proj = await api("GET", "/projects/" + REF);
line("project: " + (proj.ok ? JSON.stringify({ name: proj.data.name, region: proj.data.region, status: proj.data.status }) : "HTTP " + proj.status + " " + JSON.stringify(proj.data).slice(0, 200)));
if (!proj.ok) process.exit(1);
const h0 = await healthNow();
line("health: unhealthy=" + JSON.stringify(h0.bad));
line("public REST: " + JSON.stringify(await publicRest()));
const addons = await api("GET", "/projects/" + REF + "/billing/addons");
const selected = addons.ok && addons.data && Array.isArray(addons.data.selected_addons) ? addons.data.selected_addons.map((a) => a.type + ":" + (a.variant && a.variant.id)) : ["?"];
line("compute add-on: " + (selected.length ? selected.join(", ") : "none (Nano)"));

if (args.has("--restart")) {
  line("restarting the project (POST /restart) …");
  const rs = await api("POST", "/projects/" + REF + "/restart");
  line("restart: HTTP " + rs.status + " " + JSON.stringify(rs.data).slice(0, 200));
  if (!args.has("--no-wait")) await waitHealthy("restart");
}

if (args.has("--upgrade")) {
  line("applying the Micro compute add-on (PATCH /billing/addons) …");
  const up = await api("PATCH", "/projects/" + REF + "/billing/addons", { addon_type: "compute_instance", addon_variant: "ci_micro" });
  line("upgrade: HTTP " + up.status + " " + JSON.stringify(up.data).slice(0, 300));
  if (up.ok && !args.has("--no-wait")) await waitHealthy("resize");
}

if (args.has("--retention")) {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "supabase", "retention.sql");
  const text = fs.readFileSync(file, "utf8");
  line("applying " + path.basename(file) + " (" + text.length + " chars) …");
  const r = await sql(text);
  line("retention: HTTP " + r.status + " " + JSON.stringify(r.data).slice(0, 400));
  const job = await sql("select jobid, jobname, schedule, active from cron.job where jobname = 'subsell-activity-retention'");
  line("cron job: " + JSON.stringify(job.data).slice(0, 300));
}

if (args.has("--purge")) {
  for (let i = 0; i < 40; i++) {
    const r = await sql("select * from public.subsell_purge_activity(20000)");
    if (!r.ok) { line("purge: HTTP " + r.status + " " + JSON.stringify(r.data).slice(0, 300)); break; }
    const rows = Array.isArray(r.data) ? r.data : [];
    const total = rows.reduce((a, x) => a + (Number(x.deleted) || 0), 0);
    line("purge round " + (i + 1) + ": " + rows.map((x) => x.kind_group + "=" + x.deleted).join("  "));
    if (!total) break;
    await sleep(1500);
  }
  const left = await sql("select count(*) as rows_total, count(*) filter (where created_at > now() - interval '5 days') as last5d, count(*) filter (where kind='video') as videos, pg_size_pretty(pg_total_relation_size('public.subsell_messages')) as size from public.subsell_messages");
  line("after the purge: " + JSON.stringify(left.data));
}

const sqlIdx = argv.indexOf("--sql");
if (sqlIdx >= 0 && argv[sqlIdx + 1]) {
  const r = await sql(argv[sqlIdx + 1]);
  console.log(JSON.stringify(r.data, null, 1).slice(0, 4000));
}
