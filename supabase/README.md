# SubSell — Supabase backend (deploy + web-app glue)

> Table/trigger names are namespaced **`subsell_*`** so this is safe to run in a
> Supabase project that already hosts another app. The web UI that uses this
> backend lives in [`../docs`](../docs) (deploy it on GitHub Pages).

## 1) Create the table
Supabase dashboard → **SQL editor** → run [`schema.sql`](./schema.sql). Creates
`subsell_configs`, RLS, a trigger that gives every new user a `config_key`
automatically, and a backfill so existing users get one too. Safe to re-run.

## 2) Enable Google login
Dashboard → **Authentication → Providers → Google** → enable and add your Google
OAuth client (Client ID + secret). In **Authentication → URL Configuration**, add
your web-app URL (e.g. `https://<you>.github.io/<repo>/docs/`) to **Site URL** and
**Redirect URLs**. In the Google Cloud OAuth client, set the authorized redirect URI
to `https://<project-ref>.supabase.co/auth/v1/callback`.
*(The web UI also supports email + password as a fallback if you'd rather skip Google.)*

## 3) Deploy the config endpoint

**Option A — Supabase dashboard (no CLI):** Dashboard → **Edge Functions** →
**Create a function** → name it **`config`** → paste [`functions/config/index.ts`](./functions/config/index.ts)
→ **Deploy**. Then open the function's settings and turn **Verify JWT = OFF**
(required so the extension can fetch with no Authorization header).

**Option B — CLI:**
```bash
supabase functions deploy config --no-verify-jwt
```
Either way, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected into the
function automatically — no secrets to set.

The per-user URL the operator pastes into the extension:
```
https://<project-ref>.supabase.co/functions/v1/config?key=<config_key>
```

## 4) Web-app glue (already implemented in ../docs/app.js)
```js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// load the user's settings + their config_key (RLS scopes it to the logged-in user)
async function load() {
  const { data } = await supabase
    .from("subsell_configs").select("config, config_key").single();
  const extensionUrl = `${SUPABASE_URL}/functions/v1/config?key=${data.config_key}`;
  return { config: data.config, extensionUrl };
}

// save edited settings (settings = the JSON object from SPEC-webapp.md)
async function save(settings) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("subsell_configs")
    .update({ config: settings, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
}

// regenerate the key (invalidates the old URL)
async function regenerateKey() {
  const { data: { user } } = await supabase.auth.getUser();
  const newKey = crypto.randomUUID().replaceAll("-", "");
  await supabase.from("subsell_configs").update({ config_key: newKey }).eq("user_id", user.id);
}
```

## 5) Test the endpoint
```bash
curl "https://<project-ref>.supabase.co/functions/v1/config?key=<config_key>"
# -> should print the settings JSON
```
Paste that URL into the extension (Settings → General → **Remote config URL** → Fetch now).

## Notes
- Treat `config_key` as secret — it returns the API key inside the config. Offer a
  "regenerate key" button; rotate the Anthropic key if a link leaks.
- The settings JSON shape is defined in [`../SPEC-webapp.md`](../SPEC-webapp.md). The
  web-app editor mirrors those fields; the extension applies whatever you store unchanged.
- **Zero extension changes**: this uses the extension's existing "Remote config URL"
  feature, which fetches the JSON on startup and every ~10 min and applies it as the
  top settings source.
