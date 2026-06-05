# SubSell Marketplace Auto-Reply — Chrome Extension

A single-user Chrome **Manifest V3** extension that auto-replies to Facebook
Marketplace buyer messages using the Anthropic Claude API. Bilingual FR/EN
(casual Quebec French), built for used-iPhone sales in Montréal. No backend, no
cloud — runs locally, one Chrome profile per Facebook account.

> ⚠️ **Unread detection is still best-effort.** `isUnread()` in `content.js`
> currently combines heuristics (bold weight, a small colored dot, an
> `unread`/`non lu` aria-label). To finalize it, use the popup **Scan now →
> Copy ALL** diagnostic on a *genuinely fresh* unread message and replace the
> `isUnread()` body with the one confirmed signal. The diagnostic capture is
> permanent — never strip it.

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

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — content script, service worker, popup, options. |
| `background.js` | Service worker: Anthropic API (`claude-sonnet-4-6`, `anthropic-dangerous-direct-browser-access`), system-prompt assembly, rate limits + warm-up, business hours, per-conversation cap, follow-up alarms, `[HUMAN]` notifications, mp4 blob fetch, once-per-chat intro-video handoff, reply log. |
| `content.js` | DOM side: permanent diagnostic capture, `isUnread()`, scan→read→reply pipeline, human-like typing, human cadence (breaks/skips), `[VIDEO]` + once-per-chat intro-video paste-to-upload, follow-up typing, live `debugTick`. |
| `popup.html` / `popup.js` | On/off, status, delay slider, live debug, **Open Marketplace** button, unread diagnostic + Copy ALL. |
| `options.html` / `options.js` | Tabbed settings (see below). |
| `icon16/48/128.png` | Action + notification icons. |

## How the pipeline works

Scan loop (every 8s, only on messages pages):

1. Find `a[href*="/marketplace/t/"]` anchors → filter with `isUnread()`.
2. Human-cadence gate: maybe take a random break or skip this cycle.
3. Pick one unread thread (90s per-thread cooldown), click it, verify the URL
   changed.
4. Read the last bubble in `[role="main"]` (the buyer's message).
5. Background → Claude → reply, gated by **business hours**, **rate limits**,
   **warm-up cap**, and **per-conversation reply cap**.
6. Wait the human delay (default 30s + 0–60s jitter), type char-by-char at
   38–78 WPM with occasional pauses, press Enter.
7. Log it, mark replied, schedule follow-ups.

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
- **Videos** — **Intro video**: upload an mp4 *from this computer*; the bot sends
  it **once per chat**, right after its first reply (native upload, not a link).
  Stored in `chrome.storage.local` on that machine only — it does **not** sync
  across computers (videos are too big for `chrome.storage.sync`), so upload it on
  each machine. Counts toward hourly/daily caps, not the per-conversation cap.
  Below it: a library of mp4 URLs (name, URL, notes) for Claude's `[VIDEO:url]`
  token.
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
