# Publishing SubSell to the Chrome Web Store

This gets you a real **"Add to Chrome"** button. Plan for ~30 minutes of setup
plus **1–3 business days** of Google review. One-time cost: **$5** for a
developer account.

> You don't have to wait for this to use the bot — the web app's **"Download the
> extension (.zip) → Load unpacked"** path works today. The Web Store is just the
> nicer, one-click install for other people / your other machines.

---

## Step 0 — What you need
- A Google account.
- **$5** (one-time) for the Chrome Web Store developer registration.
- A **hosted privacy policy URL** (you already have one — see Step 2).
- 1–5 screenshots of the extension (1280×800 or 640×400 PNG/JPG).
- A 128×128 icon (the repo ships `icon128.png`; replace it with a crisp 128×128
  PNG before submitting — the bundled one is a tiny placeholder).

---

## Step 1 — Build the store ZIP
The store package must contain **only the extension**, not the web app / backend /
docs. Run:

```bash
bash store/build-extension-zip.sh
```

This creates **`dist/subsell-extension.zip`** containing only:
`manifest.json, background.js, content.js, popup.html, popup.js, options.html,
options.js, managed_schema.json, icon16/48/128.png` — and it **strips the `key`
field** from the manifest (the Web Store assigns its own extension ID).

> Why strip `key`? The `key` pins the unpacked/fleet ID
> (`jdbjbonhdnfkkfihbodmhpmccoiajflm`). The Web Store issues its **own** ID, so the
> store build shouldn't carry the old key. Your self-hosted/fleet build keeps it.

---

## Step 2 — Host the privacy policy
The Web Store **requires** a privacy policy URL because this extension handles an
API key and reads message content. One is included at **`docs/privacy.html`**.

1. Open `docs/privacy.html` and replace `you@example.com` with a real contact email.
2. When GitHub Pages is enabled for `docs/` (see Step 6 of the main README), it's
   live at:
   `https://<your-github-username>.github.io/marketplace-auto-replier-/privacy.html`
3. Keep that URL — you'll paste it into the store listing.

---

## Step 3 — Register as a developer
1. Go to the **Chrome Web Store Developer Dashboard**:
   https://chrome.google.com/webstore/devconsole
2. Sign in, accept the agreement, pay the **one-time $5** fee.

---

## Step 4 — Create the item & upload
1. Dashboard → **Add new item** → upload `dist/subsell-extension.zip`.
2. Fill the **Store listing** tab (copy is ready in [`listing.md`](./listing.md)):
   name, summary, description, category (**Productivity**), language, screenshots,
   128×128 icon.
3. **Privacy practices** tab — this is where most reviews stall, so be precise:
   - **Single purpose:** "Auto-replies to the operator's own Facebook Marketplace
     buyer messages using the Anthropic Claude API."
   - **Permission justifications** — see the table below; paste them in.
   - **Data usage:** declare that you handle *Personal communications* (message
     content) and *Authentication information* (the API key) and that data is **not
     sold** and **not used for anything but the single purpose**. Tick that you
     comply with the Developer Program Policies.
   - **Privacy policy URL:** the one from Step 2.
4. Set **Visibility**. For a tool only you and your team use, choose **Unlisted**
   (anyone with the link can install; it won't show in search) — usually a faster,
   smoother review than Public.
5. **Submit for review.**

---

## Permission justifications (paste these)

| Permission | Why it's needed |
|---|---|
| `storage`, `unlimitedStorage` | Save the operator's settings, API key, activity log, and locally-stored demo videos. |
| `alarms` | Schedule follow-up messages and the periodic remote-config refresh. |
| `notifications` | Alert the operator when a conversation needs a human (`[HUMAN]`). |
| `tabs`, `activeTab` | Find/focus the operator's open Messenger tab to operate on it. |
| Host: `*.messenger.com`, `*.facebook.com` | The extension only auto-replies inside the operator's own Marketplace/Messenger chats. |
| Host: `api.anthropic.com` | Calls the Anthropic Claude API to generate replies (operator's own key). |
| Host: `*.supabase.co` | Fetches the operator's own settings from the Supabase project they control (cloud sync). |

> **Permissions are already slimmed for the Store.** `build-extension-zip.sh` removes
> the broad `<all_urls>` host permission from the store build (it forces an in-depth
> review and raises rejection odds), keeping only the four hosts above. The
> self-hosted / fleet build keeps `<all_urls>` for remote-config-from-any-URL and
> remote video fetch; the Store build trades those for a cleaner review.

---

## Step 5 — After it's approved
1. Copy your listing URL — it looks like
   `https://chromewebstore.google.com/detail/<name>/<extension-id>`.
2. Paste it into **`docs/config.js`** as `SUBSELL_WEBSTORE_URL`.
3. Commit/push. The web app's **"Add to Chrome"** button now sends people straight
   to your store listing.

---

## Updating later
Bump `version` in `manifest.json`, re-run `bash store/build-extension-zip.sh`, and
upload the new ZIP in the dashboard → your item → **Package**. Re-submit; updates
usually review faster than the first submission.
