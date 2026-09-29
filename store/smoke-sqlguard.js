/* (v0.21.70) The safety-net trigger must be able to write its own history table.
 * config-safety.sql v0.21.61 ran the guard with the CALLER's rights (the signed-in
 * operator, via the dashboard or an extension), and subsell_config_history only had
 * a SELECT policy — so from the first save after it was run (Sep 22 2026) every
 * update of a live row failed with `new row violates row-level security policy for
 * table "subsell_config_history"`. The dashboard said "Not saved"; every extension's
 * push failed behind a "Saved ✓". This locks the cure in.
 * Run:  node store/smoke-sqlguard.js
 */
const fs = require("fs");
const path = require("path");
const sql = fs.readFileSync(path.join(__dirname, "..", "supabase", "config-safety.sql"), "utf8");

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

const start = sql.indexOf("create or replace function public.subsell_guard_config()");
const end = sql.indexOf("drop trigger if exists subsell_configs_guard");
const fn = start >= 0 && end > start ? sql.slice(start, end) : "";
ok(fn.length > 0, "the guard function is defined before its trigger");
ok(/returns trigger\s+language plpgsql\s+security definer\s+set search_path = public, pg_temp\s+as \$\$/.test(fn),
   "guard runs SECURITY DEFINER with search_path pinned (owner's rights — the history table's RLS does not bind it)");
ok(/begin\s+insert into public\.subsell_config_history \(user_id, config\) values \(old\.user_id, oldcfg\);[\s\S]*?exception when others then[\s\S]*?raise warning/.test(fn),
   "the history snapshot is wrapped: a snapshot that cannot be written warns and lets the save through");
ok(/limit 20/.test(fn), "history is still pruned to 20 per account");
ok(/if newv = '' and oldv <> '' then\s+new\.config := jsonb_set\(new\.config, array\[k\], to_jsonb\(oldcfg ->> k\), true\);/.test(fn),
   "the four-field blank guard (apiKey/model/businessInfo/instructions) is untouched");
ok(/keys\s+text\[\] := array\['apiKey', 'model', 'businessInfo', 'instructions'\]/.test(fn), "the four guarded keys are unchanged");
ok(/revoke insert, update, delete on public\.subsell_config_history from anon, authenticated;/.test(sql),
   "no client role may write or prune history directly — the trigger is the only writer");
ok(!/revoke execute on function public\.subsell_guard_config/.test(sql),
   "no EXECUTE revoke on the trigger function (EXECUTE is checked at CREATE TRIGGER only, never when it fires, and a direct call is refused by plpgsql — it would be noise)");
ok(!/subsell_config_history for insert/.test(sql) && !/subsell_config_history for all/.test(sql),
   "history keeps a SELECT-only policy");
ok(/RUN THIS ONE AGAIN/.test(sql), "the header tells whoever ran v0.21.61 to run this copy again");

console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(failed ? 1 : 0);
