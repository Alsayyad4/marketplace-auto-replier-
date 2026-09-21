/* Tests credential resolution (background.js getCloudCreds + cloudAuthFetch), v0.21.59.
 *
 * Why this file exists: machines set up before the project credentials were baked
 * into the build were configured by TYPING a Supabase URL + anon key into Settings.
 * Those land in chrome.storage.local, survive every self-update, and used to WIN
 * over the key shipped with the build. When the project moved to publishable keys,
 * the typed legacy JWT stopped being accepted — and those machines could no longer
 * log in or refresh, so the account holding all the teaching became unreachable.
 *
 * The rules under test:
 *   1. No stored key            -> use the shipped key.
 *   2. Stored LEGACY JWT, same project -> ignore it, use the shipped key.
 *   3. Stored key + credsFallback      -> ignore it, use the shipped key.
 *   4. Stored key for a DIFFERENT project -> keep it (self-hosters are not hijacked).
 *   5. A live "Invalid API key" while using a stored key -> mark it and retry,
 *      and the retry goes out with the shipped key.
 *
 * Run:  node store/smoke-creds.js
 */
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");

const from = src.indexOf("const LEGACY_JWT_KEY");
const to = src.indexOf("\nfunction getCloudAuth(");
if (from < 0 || to < 0) { console.error("credential block not found in background.js"); process.exit(1); }
const block = src.slice(from, to);

const SHIPPED_URL = "https://tcqunihripihroseswgy.supabase.co";
const SHIPPED_KEY = (src.match(/const SUPABASE_ANON_KEY\s*=\s*"([^"]*)"/) || [])[1];

let failed = 0;
const ok = (cond, msg) => { console.log((cond ? "  PASS  " : "  FAIL  ") + msg); if (!cond) failed++; };

function build(store, fetchImpl) {
  const sets = [];
  const chrome = {
    storage: { local: {
      get: (keys, cb) => cb(Object.assign({}, store)),
      set: (v, cb) => { Object.assign(store, v); sets.push(v); if (cb) cb(); },
    } },
    runtime: { lastError: null },
  };
  const api = new Function(
    "chrome", "SUPABASE_URL", "SUPABASE_ANON_KEY", "LOG", "fetch",
    block + "; return { getCloudCreds, cloudAuthFetch, looksLikeBadApiKey };"
  )(chrome, SHIPPED_URL, SHIPPED_KEY, () => {}, fetchImpl);
  return { api, sets, store };
}

(async () => {
  ok(/^sb_publishable_/.test(SHIPPED_KEY || ""), "the build ships a publishable key (not a legacy JWT)");

  // 1. clean machine
  let c = await build({}).api.getCloudCreds();
  ok(c.key === SHIPPED_KEY && c.url === SHIPPED_URL && !c.usingStored, "no stored key -> the shipped key is used");

  // 2. the actual lockout: a legacy JWT typed in years ago, same project
  c = await build({ supabaseUrl: SHIPPED_URL, supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.stale" }).api.getCloudCreds();
  ok(c.key === SHIPPED_KEY && c.droppedStoredKey === "legacy-jwt",
     "a typed LEGACY key for this project is ignored -> the machine can reach the account again");

  // 2b. same, with a trailing slash on the stored URL (how people paste it)
  c = await build({ supabaseUrl: SHIPPED_URL + "/", supabaseAnonKey: "eyJstale" }).api.getCloudCreds();
  ok(c.key === SHIPPED_KEY, "a trailing slash on the stored URL still counts as the same project");

  // 3. a key a live request already proved dead
  c = await build({ supabaseUrl: SHIPPED_URL, supabaseAnonKey: "sb_publishable_revoked", credsFallback: 123 }).api.getCloudCreds();
  ok(c.key === SHIPPED_KEY && c.droppedStoredKey === "rejected", "a key already proven rejected is not used again");

  // 4. a genuinely self-hosted machine must NOT be hijacked
  c = await build({ supabaseUrl: "https://other.supabase.co", supabaseAnonKey: "eyJtheirOwnKey" }).api.getCloudCreds();
  ok(c.key === "eyJtheirOwnKey" && c.url === "https://other.supabase.co" && c.usingStored,
     "a machine pointed at a DIFFERENT project keeps its own credentials");

  // 5. live self-heal: first call is rejected, retry must use the shipped key
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push(init.headers.apikey);
    const bad = init.headers.apikey !== SHIPPED_KEY;
    return {
      ok: !bad, status: bad ? 401 : 200,
      json: async () => (bad ? { message: "Invalid API key" } : { access_token: "tok", refresh_token: "r" }),
    };
  };
  const b = build({ supabaseUrl: SHIPPED_URL, supabaseAnonKey: "sb_publishable_revoked" }, fetchImpl);
  const out = await b.api.cloudAuthFetch("/auth/v1/token?grant_type=password", { email: "a@b.c", password: "x" });
  ok(seen.length === 2 && seen[0] === "sb_publishable_revoked" && seen[1] === SHIPPED_KEY,
     "a rejected stored key triggers ONE retry with the shipped key — got " + seen.length + " attempt(s)");
  ok(out.resp.ok && out.data.access_token === "tok", "the retry succeeds, so login works without anyone touching the machine");
  ok(b.store.credsFallback != null, "the rejection is remembered, so later calls skip the dead key immediately");

  // 6. a WRONG PASSWORD must not be mistaken for a bad key (no pointless retry)
  const seen2 = [];
  const b2 = build({ supabaseUrl: SHIPPED_URL, supabaseAnonKey: "sb_publishable_typed" }, async (u, init) => {
    seen2.push(init.headers.apikey);
    return { ok: false, status: 400, json: async () => ({ error_code: "invalid_credentials", msg: "Invalid login credentials" }) };
  });
  await b2.api.cloudAuthFetch("/auth/v1/token?grant_type=password", { email: "a@b.c", password: "wrong" });
  ok(seen2.length === 1 && b2.store.credsFallback == null,
     "a wrong password is NOT treated as a bad key (no retry, nothing discarded)");

  console.log(failed ? "\n" + failed + " CHECK(S) FAILED" : "\nall checks passed");
  process.exit(failed ? 1 : 0);
})();
