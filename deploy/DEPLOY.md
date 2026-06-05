# SubSell — fleet deployment (your own Windows machines)

Deploy SubSell to all your computers so it **auto-installs, auto-updates, and gets
the API key + settings automatically** — no `Load unpacked`, no key typed per
machine, no Chrome Web Store. This is the standard "internal tool" deployment.

- **Extension ID (fixed, forever):** `jdbjbonhdnfkkfihbodmhpmccoiajflm`
- **Your signing key:** `subsell-extension-key.pem` — **keep it safe and private.**
  Every future update must be packed with this same file or the ID changes. Do
  **not** commit it or share it.

---

## One-time: build + host (≈15 min)

**1. Pack the extension into a signed `.crx`**
- `chrome://extensions` → **Pack extension**
- *Extension root directory* = the SubSell folder (the one with `manifest.json`)
- *Private key file* = `subsell-extension-key.pem` (the one I sent you)
- → produces `subsell.crx`. (Using that key keeps the ID above.)

**2. Put your settings in a secret gist** (this is where the key lives)
- In SubSell → **Settings → General → Export config to file** (do this on a machine
  you've fully set up).
- Go to **gist.github.com → New gist**, filename `subsell-config.json`, paste the
  file, **Create secret gist**.
- Click **Raw**, copy the link, and **delete the commit-hash** so it always serves
  the latest: `https://gist.githubusercontent.com/USER/GIST_ID/raw/subsell-config.json`

**3. Host two files** on any static web host you control (your server, an S3/GCS
bucket, Cloudflare R2/Pages, etc.) at a stable path like `https://YOUR-HOST/subsell/`:
- `subsell.crx`
- `update.xml` (from this folder) — edit its `codebase` to your `subsell.crx` URL.

**4. Fill in `subsell-policy.reg`** (this folder): replace `YOUR-HOST` with your
host, and the `configUrl` line with your gist raw link from step 2.

---

## Deploy the policy to the machines

### A) You have central management (Active Directory/GPO, Intune, or an RMM)
Best case — set once, applies to the whole fleet:
- **GPO/ADMX:** load Google's Chrome ADMX, then set
  *Configure the list of force-installed apps and extensions* →
  `jdbjbonhdnfkkfihbodmhpmccoiajflm;https://YOUR-HOST/subsell/update.xml`
  and set the **3rd-party extension policy** `configUrl` for that ID to your gist link.
- **Intune/RMM:** push `subsell-policy.reg` (or the equivalent registry keys) to all
  machines. Most RMM tools can run it on every endpoint in one action.

### B) Standalone machines (no central management)
Run the policy once per machine (scriptable):
- Copy `subsell-policy.reg` to each machine and **run it as Administrator**
  (double-click, or `reg import subsell-policy.reg`), then fully restart Chrome.
- You can drop it in a shared folder / USB / a tiny `.bat` and run it once per box —
  still far less than `Load unpacked`, and **after this they auto-update on their own.**

---

## Verify (on any machine)
1. `chrome://policy` → **Reload policies** → you should see
   `ExtensionInstallForcelist` and the `configUrl` listed.
2. `chrome://extensions` → SubSell shows up **"Installed by your administrator"** and
   can't be removed by users.
3. Open the SubSell popup → API key shows **set ✓** (it pulled it from your gist).
4. messenger.com → Marketplace → it runs as normal.

## Ship an update later (you do this, fleet follows automatically)
1. I give you a new build (higher `version`).
2. Re-pack with **the same** `subsell-extension-key.pem` → new `subsell.crx`.
3. Replace the hosted `subsell.crx`, and bump `version` in the hosted `update.xml`.
4. Every machine auto-updates within a few hours (or `chrome://extensions → Update`).

## Change the key or settings later
Just edit your **gist** — every machine picks it up within ~10 min. No redeploy.

---

### Notes
- **Mac/Linux machines:** same idea via a configuration profile / `managed` policy
  (`ExtensionInstallForcelist` + `3rdparty/extensions/<id>/policy`). Ask me and I'll
  give you the plist/JSON.
- **Security:** the API key lives in your secret gist — keep the link private and
  rotate the key if it ever leaks.
- Nothing here changes how the bot replies/sends video/follows up — it's only how
  the extension is installed and configured.
