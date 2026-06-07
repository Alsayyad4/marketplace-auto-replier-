# SubSell — Supabase backend (deploy + web-app glue)

## 1) Create the table
Supabase dashboard → SQL editor → run `schema.sql`. (Creates `configs`, RLS, and a
trigger that gives every new user a `config_key` automatically.)

## 2) Enable Google login
Dashboard → Authentication → Providers → enable **Google** (add your OAuth client).

## 3) Deploy the config endpoint
```bash
supabase functions deploy config --no-verify-jwt
```
`--no-verify-jwt` is required so the extension can fetch it with no Authorization
header. The function uses the service role from env (`SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY` are injected automatically).

The per-user URL the operator pastes into the extension:
```
https://<project-ref>.supabase.co/functions/v1/config?key=<config_key>
```

## 4) Web-app glue (after Supabase Auth login)
```js
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// load the user's settings + their config_key
async function load() {
  const { data } = await supabase
    .from("configs").select("config, config_key").single();   // RLS scopes it to the user
  const extensionUrl =
    `${SUPABASE_URL}/functions/v1/config?key=${data.config_key}`;
  return { config: data.config, extensionUrl };
}

// save edited settings (settings = the JSON object from SPEC-webapp.md)
async function save(settings) {
  const { data: { user } } = await supabase.auth.getUser();
  await supabase.from("configs")
    .update({ config: settings, updated_at: new Date().toISOString() })
    .eq("user_id", user.id);
}

// regenerate the key (invalidates the old URL)
async function regenerateKey() {
  const { data: { user } } = await supabase.auth.getUser();
  const newKey = crypto.randomUUID().replaceAll("-", "");
  await supabase.from("configs").update({ config_key: newKey }).eq("user_id", user.id);
}
```

## 5) Test the endpoint
```bash
curl "https://<project-ref>.supabase.co/functions/v1/config?key=<config_key>"
# -> should print the settings JSON
```
Paste that URL into the extension (Settings → General → Remote config URL → Fetch now).

## Notes
- Treat `config_key` as secret — it returns the API key inside the config. Offer a
  "regenerate key" button; rotate the Anthropic key if a link leaks.
- The settings JSON shape is defined in `../SPEC-webapp.md`. The web-app editor should
  mirror those fields; the extension applies whatever you store unchanged.
