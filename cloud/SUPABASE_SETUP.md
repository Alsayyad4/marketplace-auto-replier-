# SubSell Cloud Sync — Supabase setup (one time, free)

This turns SubSell into a **web app**: you log into one account, change your
settings in a browser dashboard, and **every Chrome on every computer** picks up
the change within ~1 minute — even across different Google accounts. You own the
data; nothing runs on our servers.

It uses **Supabase** (a hosted Postgres + auth, generous free tier). Total setup
is about 10 minutes and you never have to touch a server again.

---

## 1. Create a Supabase project

1. Go to <https://supabase.com> → **Start your project** → sign in with GitHub.
2. **New project**. Pick any name, set a strong database password (you won't need
   it again), choose the region closest to you, and create it. Wait ~2 min for it
   to spin up.

## 2. Create the table

1. In the project, open **SQL Editor** (left sidebar) → **New query**.
2. Open [`cloud/schema.sql`](./schema.sql) from this repo, copy the whole thing,
   paste it in, and click **Run**. You should see "Success. No rows returned".

This makes a `subsell_configs` table where each account stores its settings,
locked down so an account can only read/write its **own** row.

> 💡 Everything it creates is namespaced `subsell_*` (the table, the trigger
> function), so it's **safe to run in a Supabase project you already use for
> another app** — it only ever creates its own objects and never touches your
> existing tables. (You can also just spin up a separate project for SubSell; the
> free plan allows more than one.)

## 3. Grab your two public keys

1. Open **Project Settings** (gear, bottom-left) → **API**.
2. Copy two values — both are **safe to expose publicly** (Row-Level Security is
   what actually protects your data):
   - **Project URL** — looks like `https://abcdwxyz.supabase.co`
   - **anon / public** key — a long `eyJ...` string (the "anon public" one, **not**
     `service_role`).

> ⚠️ Never copy the **`service_role`** key into the dashboard or the extension —
> that one bypasses security. Only ever use the **anon / public** key.

## 4. Create your login

Easiest path for a single operator (skips email-confirmation hassle):

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter your email + a password, tick **Auto Confirm User**, and create it.

That email + password is now your SubSell account. (If you'd rather self-serve a
signup from the dashboard, go to **Authentication → Providers → Email**, enable
it, and turn **Confirm email** off for a frictionless first login — or leave it on
and click the link it emails you.)

## 5. Deploy the dashboard

The dashboard is plain static files in [`docs/`](../docs). Pick one:

**A) GitHub Pages (recommended — free, already in this repo)**

1. Edit [`docs/config.js`](../docs/config.js) and paste in your **Project URL** and
   **anon key** from step 3. Commit + push.
2. On GitHub: repo **Settings → Pages** → *Build and deployment* → Source:
   **Deploy from a branch** → Branch: your branch (or `main`) → Folder: **`/docs`**
   → Save.
3. After a minute it's live at `https://<your-username>.github.io/<repo>/`. Open
   that, log in with your step-4 account, fill in settings, **Save**.

**B) Just open it locally**

Fill `docs/config.js` as above, then double-click `docs/index.html`. Login still
works (it only needs the two public keys). Good for trying it out, but it lives on
that one computer.

**C) Netlify / Vercel / Cloudflare Pages** — drag the `docs/` folder onto Netlify
Drop, or point any static host at it. Same result, your own URL.

## 6. Connect each extension

On **every** computer / Chrome profile running SubSell:

1. Click the SubSell icon → **Settings ▸** → **General** → **☁️ Cloud sync**.
2. Paste the same **Project URL** + **anon key** → **Save connection**.
3. Enter your account **email + password** → **Log in**.

Done. That machine now reads its settings from the cloud. Change anything in the
dashboard (or in any connected extension's Settings) and it reaches everywhere
within ~1 minute. The bot **On/Off** switch stays per-machine on purpose, so one
computer can't flip another on or off.

> Zero-per-machine setup (optional): paste your URL + anon key once into
> `SUPABASE_URL` / `SUPABASE_ANON_KEY` at the top of `background.js` before you
> distribute the build, and each machine only has to log in.

---

## How it fits the existing config layers

`getSettings()` resolves config in this order (first match wins):

**managed policy (fleet) → ☁️ cloud (this) → permanent link (gist) → Chrome sync → local**

So once an extension is logged into the cloud, the cloud is the source of truth
(an enterprise managed policy still overrides everything, as before). Log out and
it falls back to the gist link / Chrome sync / local, exactly like before.

## Security notes

- Your **Anthropic API key** is part of the settings, so it lives in your Supabase
  row. RLS means only your logged-in account can read it — but treat your account
  password like the key itself, and rotate the Anthropic key if you ever suspect
  the password leaked.
- The **anon key is meant to be public**; it grants nothing on its own without a
  valid login. The **service_role** key must never leave the Supabase dashboard.
- Tokens on each machine are stored in `chrome.storage.local` and refreshed
  automatically; **Log out** in Settings wipes them and the cached config.
