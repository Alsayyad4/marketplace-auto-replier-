# SubSell Marketplace Auto-Reply — Chrome Extension

A single-user Chrome **Manifest V3** extension that auto-replies to Facebook
Marketplace buyer messages using the Anthropic Claude API. Bilingual FR/EN
(casual Quebec French), built for used-iPhone sales in Montréal. No backend, no
cloud — runs locally, one Chrome profile per Facebook account.

> ⚡ **v0.12.0 — instant videos + reply reliability + cheaper API calls.**
> - **Videos now fire INSTANTLY** when a buyer messages (once per chat) —
>   seconds after the message, right after Claude screens it (so scammers and
>   off-hours messages get no video), and long before the text reply, which
>   still waits your configured response delay + jitter. The per-video
>   "seconds after the reply" delay is gone.
> - **Videos actually send**: the uploader now verifies the file really attached
>   (upload preview appears in the composer tray) AND that the send cleared the
>   tray, waits for the upload to finish before pressing send, tracks each
>   configured video individually, and **retries up to 3×** on later scans if
>   anything failed — without ever stacking duplicate copies. Previously a
>   failed attach was silently marked as sent and never retried.
> - **Conversations stopped being skipped**: buyers who repeat the same message
>   ("ok", "?") get answered again; photo/sticker-only messages are detected and
>   answered; the noise filter no longer eats real messages starting with
>   "sent…", "mon…" (FR), "$300", "128gb…"; unread chats jump the scan queue so
>   replies go out promptly instead of waiting out 10-minute cooldowns.
> - **Cheaper Claude calls**: the system prompt is now cached
>   (`cache_control: ephemeral` — repeat calls bill ~10% for those tokens) and
>   `max_tokens` trimmed to 500 (replies are short texts anyway).
>
> 🏢 **v0.11.0 — fleet deploy for your own machines.** Fixed extension ID
> (`jdbjbonhdnfkkfihbodmhpmccoiajflm`) + Chrome enterprise-policy support, so you can
> **force-install + auto-update** SubSell across hundreds of machines and **push the
> API key + settings centrally** (via `chrome.storage.managed` / a config URL) —
> no Web Store, no per-machine `Load unpacked`, nothing typed on each box. Config
> priority is now **managed policy → permanent link → synced → local**. See
> `deploy/DEPLOY.md` for the turnkey steps + `deploy/subsell-policy.reg` +
> `deploy/update.xml`. Purely additive — the reply/video/follow-up logic is unchanged.
>
> 🔗 **v0.10.0 — one key for every computer (permanent link).** Set your API key +
> settings in ONE shared file and every Chrome reads from it — even across different
> Google accounts. In **Settings → General → "Sync across computers"**: configure one
> machine, click **Export config**, paste the file into a **secret GitHub gist**, copy
> its **raw** URL, and put that URL in **Remote config URL** on each machine (or bake it
> into the build for zero per-machine setup). Edits to the gist reach all machines within
> ~10 min (or hit **Fetch now**). The shared file then wins over local settings. ⚠️ Your
> key sits in that file — keep the link private and rotate the key if it leaks. Additive;
> the reply/video/follow-up paths are untouched.
>
> 🧩 **v0.9.0 — prices + multiple videos + follow-up.** Additive only; the reply
> core is untouched.
> - **Multiple videos + delay:** add several clips in **Settings → General**; the
>   bot sends them (once per chat) **10 s** after its reply (configurable).
> - **Share starting prices:** fill the **Price list** in **Settings → Business
>   prompt** and the bot gives the relevant *starting* price instead of refusing —
>   then still closes toward a call / shop visit, **trade-in (cash for newer
>   phones)**, and liquidation urgency.
> - **Follow-up:** add one in the **Follow-ups** tab (message + minutes + on). After
>   the bot replies it arms a timer; if the buyer stays quiet that long it nudges
>   once ("still interested? coming by or calling?"). If the buyer replies first,
>   the follow-up is skipped automatically.
>
> 🎬 **v0.8.0 — demo video, once per chat.** Upload an mp4 in **Settings → General
> → "Send a demo video once per chat"** (stored locally on that computer). After the
> bot sends its **first text reply** to a buyer, it attaches that video and sends it
> — exactly **once per conversation** (tracked by thread, never re-sends). It's fully
> isolated from the reply path: if the upload fails, the text reply already went out
> and the bot just logs it. Attaching the file into Messenger's uploader is the one
> best-effort part (hidden file-input → paste → drag-drop); keep the video under
> ~25 MB. `background.js` was not touched.
>
> ✅ **v0.7.0 — SIMPLE mode.** Deliberately stripped down to one job, because the
> fancier approaches (vision/screenshot reading, unread detection, human cadence,
> learned rules) added bug surface without earning their keep. The whole loop is now:
>
> 1. Go through **every** conversation in the Marketplace list, one at a time.
> 2. Open it and read the **last** message (the message column is bounded by the
>    composer box; your messages are on the right, the buyer's on the left; menu
>    labels / the listing card / system notices are filtered out).
> 3. **If the last message is from the buyer**, ask Claude for a reply and **type +
>    send it** — verifying the composer actually cleared (Enter → Send button →
>    Enter) so a reply can't silently fail to send.
> 4. Move on. Re-checks each chat periodically; a chat where you spoke last is
>    parked for 10 min.
>
> No vision, no `MutationObserver`, no cadence/breaks, no per-conversation caps, no
> follow-ups, no learned rules. `content.js` dropped from ~985 lines to ~390. Two
> safety limits remain and are easy to find in **Settings → General**: business
> hours (default 9 AM–10 PM) and an hourly/daily cap. `[HUMAN]` still notifies you.
>
> ⚠️ It replies to **every chat in the open list** — keep the **Marketplace folder**
> selected so it never messages a personal friend. Runs per Chrome **profile**
> independently; works on background/minimised windows (the heartbeat keeps every
> Messenger tab scanning).

## Install (Load unpacked)

1. Download this repo (green **`< > Code` → Download ZIP**) and unzip it. Open
   the folder until you see `manifest.json` directly inside.
2. Go to `chrome://extensions` → enable **Developer mode**.
3. Click **Load unpacked** → select that folder.
4. Click the SubSell icon → **Settings ▸**, paste your **Anthropic API key**,
   fill in business info / listings → **Save**.
5. Use **Settings → Test responses** to confirm the key + prompt work *without*
   touching Facebook.
6. Open **messenger.com** (or use the popup's **📨 Open Marketplace** button),
   then flip the popup toggle to **ON**.

## Web control panel (`docs/`) — configure once, every computer follows

The extension is what actually replies (a web page can't type into Messenger by
itself). The **web app in `docs/`** is the control panel + installer around it:

- **Get the extension / "Add to Chrome"** — a prominent install panel. Until the
  Chrome Web Store listing is live it offers **Download .zip → Load unpacked**;
  once you publish (see below) it becomes a one-click **Add to Chrome** button.
- **Every v10 setting, mirrored** — all seven tabs (General, Business prompt,
  Listings, Follow-ups, Videos, **Test responses**, **Activity log**). The
  **Test responses** tab calls Claude live in the browser using the *same* system
  prompt the bot builds, so you can sanity-check key + prompt without touching
  Facebook.
- **One account → all machines (Supabase cloud login).** Log in, edit settings,
  and the page gives you a per-account **config URL**. Paste it into each
  extension's **Settings → General → Remote config URL → Fetch now**. Edits reach
  every machine within ~10 min. This uses the extension's **existing** remote-config
  feature — **no extension update required**. Backend setup (one-time, free) is in
  [`supabase/README.md`](supabase/README.md); fill your project values in
  [`docs/config.js`](docs/config.js).
- **Or skip the cloud** — the **⬇ Download config file** button writes
  `subsell-config.json`; host it in a secret gist and paste its raw URL into the
  same Remote config URL field.

> Demo-video *files* stay per-machine (megabytes can't sync) — upload them in each
> extension's **Settings → General**. The video **URL library** and the on/off
> behavior do sync. Activity **logs** are per-machine too; view them in each
> extension's **Activity log** tab.

Host `docs/` on **GitHub Pages** (Settings → Pages → deploy from `main` / `docs`)
or any static host; the root [`index.html`](index.html) redirects there.

## Publish to the Chrome Web Store (real "Add to Chrome")

1. `bash store/build-extension-zip.sh` → builds `dist/subsell-extension.zip`
   (extension files only; manifest `key` stripped so the Store assigns its own ID).
2. Follow [`store/STORE-SUBMISSION.md`](store/STORE-SUBMISSION.md): $5 one-time
   registration, paste the listing copy from [`store/listing.md`](store/listing.md),
   set the privacy-policy URL ([`docs/privacy.html`](docs/privacy.html)), submit.
3. After approval, paste your listing URL into `SUBSELL_WEBSTORE_URL` in
   `docs/config.js` — the web app's **Add to Chrome** button goes live.

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — content script, service worker, popup, options. |
| `background.js` | Service worker: Anthropic API (`claude-sonnet-4-6`, `anthropic-dangerous-direct-browser-access`), system-prompt assembly, rate limits + warm-up, business hours, per-conversation cap, follow-up alarms, `[HUMAN]` notifications, mp4 blob fetch, reply log. |
| `content.js` | DOM side (SIMPLE mode): rotate through every chat → read the last message (composer-bounded, noise-filtered) → if it's the buyer's, ask Claude → type + verify-send. Live `debugTick` for the popup. |
| `popup.html` / `popup.js` | On/off, status, delay slider, live debug, **Open Marketplace** button, unread diagnostic + Copy ALL. |
| `options.html` / `options.js` | Tabbed settings (see below). |
| `icon16/48/128.png` | Action + notification icons. |
| `docs/` | The **web control panel** (static site): `index.html`, `app.js`, `config.js`, `privacy.html`. Host on GitHub Pages. |
| `supabase/` | Optional cloud backend for the dashboard: `schema.sql`, the `config` Edge Function, and setup `README.md`. |
| `store/` | Chrome Web Store kit: `build-extension-zip.sh`, `STORE-SUBMISSION.md`, `listing.md`. |
| `deploy/` | Enterprise fleet deploy (policy `.reg`, `update.xml`, `DEPLOY.md`). |

## How the pipeline works

Two complementary paths feed the same reply engine (`respondToTurn`):

**A) Inbox sweep** (every 8s, only on messages pages):

1. Find `a[href*="/t/"]` anchors → keep real conversations (`isConversationAnchor`).
2. Queue **every** visible conversation, with fresh-looking ones first (marked
   unread, or the buyer spoke last in the row preview). Styling is only used to
   *prioritise* — never to gate — so drift can't stop the bot.
3. Human-cadence gate (only on genuinely fresh bursts): maybe break or skip.
4. Pick the next thread off-cooldown, click it, verify the URL changed, and
   **wait for the composer** to render.
5. Read a labeled transcript from `[role="main"]` (composer-bounded column,
   noise/anchor-filtered); reply **only if the buyer actually spoke last**
   (`getBuyerTurn`). Threads where you spoke last are parked on a 10-min re-check.

**B) Open-thread observer** (event-driven): a `MutationObserver` on
`[role="main"]` fires (debounced) when the open conversation changes, and replies
if the buyer spoke last. Robust even when list detection is broken — just open a
thread.

Both then run the shared engine:

6. Background → Claude → reply, gated by **business hours**, **rate limits**,
   **warm-up cap**, and **per-conversation reply cap**.
7. Wait the human delay (default 30s + 0–60s jitter), type word-by-word at
   38–78 WPM with occasional pauses.
8. **Send + verify** (Enter → click Send → Enter), confirming the composer
   emptied before claiming success; de-dupe per buyer message; log, mark replied,
   schedule follow-ups.

### Reply tokens Claude can return

- `[HUMAN] <reason>` → desktop notification, no auto-reply (scams, hard
  negotiation, off-platform pressure, logistics).
- `[VIDEO:<url>] <caption>` → background fetches the mp4 as a blob; content
  builds a `File` and **uploads it as a native video attachment** via
  `ClipboardEvent`+`DataTransfer` (fallbacks: drag-drop, then `input[type=file]`),
  then types the caption. **The URL is never shown to the buyer** — no
  repetitive-link risk. Captions are instructed to always vary.

## Settings tabs

- **General** — API key, model, response delay + jitter, hourly/daily caps,
  **max replies per conversation** (+ go-quiet / notify behavior), typing WPM,
  business hours, **human cadence** (breaks + skips), **warm-up mode**,
  **off-platform guardrails**.
- **Business prompt** — name, address, hours, business info, instructions, and
  **Example conversations** (few-shot: paste real buyer→reply pairs, including
  when to send `[VIDEO]` / escalate `[HUMAN]` — the model copies your voice from
  these far better than from rules).
- **Listings** — editable table (title, model, storage, condition, price CAD,
  video URL, available) with JSON import/export.
- **Follow-ups** — name, after-minutes, message, on/off. Scheduled when the bot
  replies; cancelled if the buyer replies first.
- **Videos** — library of mp4 URLs (name, URL, notes).
- **Test responses** — dry-run Claude on a fake buyer message; no Facebook, no
  rate-limit use.
- **Activity log** — last 500 sends (buyer message + reply + action + convo
  reply number); refresh / export / clear.

## Anti-suspension features

- **Human typing** at configurable WPM with pauses.
- **Human cadence** — random breaks + occasional skipped cycles (not metronomic).
- **Warm-up mode** — new accounts ramp the daily cap from a low start to full
  over N days (tracked per-profile from first run).
- **Per-conversation cap** — at most N auto-replies per chat, then go quiet or
  hand off to you.
- **Off-platform guardrails** — prompt forbids phone numbers, emails, links, and
  "contact me elsewhere"; escalates `[HUMAN]` instead.
- **Video as native upload**, never a pasted link.

### Running multiple accounts (read this)

- **One Chrome profile per Facebook account; never rotate an account across
  machines.** Each profile keeps its own settings, log, and warm-up clock.
- **Shared IP is the biggest real risk.** N accounts auto-replying from one
  home/office WiFi is the strongest "same operator" signal — give each account
  its own network/connection. This matters more than any behavioral trick.
- **Synthetic events report `isTrusted: false`** — a structural tell no content
  script can fully hide. Keep volume and cadence human so there's no reason to
  look closely.
- Give each account its **own** listings, slightly different tone, and its own
  example conversations — identical wording across accounts is a fingerprint.

## Constraints kept throughout

- Manifest V3, service-worker background, no persistent page.
- Content script uses **no ES module imports** — all helpers inlined.
- No npm packages inside the extension.
- State in `chrome.storage.local` — **never** `localStorage`.
- All instrumentation/debug code is **permanent**.

## Tooling note

Repo scripts/tooling use **Node.js** (e.g. `node --check *.js`), not Python.
