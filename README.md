# SubSell Marketplace Auto-Reply — Chrome Extension

A single-user Chrome **Manifest V3** extension that auto-replies to Facebook
Marketplace buyer messages using the Anthropic Claude API. Bilingual FR/EN
(casual Quebec French), built for used-iPhone sales in Montréal. No backend, no
cloud — runs locally, one Chrome profile per Facebook account.

> 👁️ **v0.5.0 — reads the screen with Claude vision.** Instead of guessing which
> on-page text is a message (the fragile DOM parsing that caused the bug below),
> the bot now **screenshots the open conversation and lets Claude read it** the way
> you would, then writes the reply. A vision model won't mistake a menu label for a
> buyer message. Toggle in **Settings → General → "Read the screen with vision"**
> (on by default). Chrome can only screenshot the *visible* tab, so when Messenger
> isn't the front tab it automatically falls back to the (now-fixed) DOM reader.
> Heads-up: each reply makes one image API call, so it costs a bit more per message.
>
> ✅ **v0.4.0 — confirmed against the live messenger.com DOM.** Root cause (seen
> in a real screenshot): the bot replied repeatedly to **"Privacy & support"** —
> a label in the right-hand info panel — because `readConversation()` fell back to
> the *whole* `[role="main"]` for column bounds whenever the composer hadn't
> rendered yet. That pulled in the info panel and shifted the left/right midpoint,
> so **menu chrome was read as the buyer's message.** Fixes:
>
> - **Reads the real message, never UI chrome.** The composer is now *required* to
>   bound the message column (no full-main fallback); we wait for it to render;
>   link-wrapped text (listing card, profile) and an expanded noise list (incl.
>   Meta's safety footer, date headers) are excluded.
> - **Opens every conversation.** It no longer trusts fragile "unread" styling — it
>   queues **every** visible thread (fresh-looking ones first), opens each, and
>   replies only when the buyer genuinely spoke last (`getBuyerTurn`). Threads
>   where you spoke last are parked on a 10-min re-check; a new buyer message pulls
>   them back into rotation promptly.
> - **Open-thread observer.** A `MutationObserver` on `[role="main"]` replies to
>   whatever conversation is open the moment the buyer's message is the latest.
> - **Send is verified.** It confirms the composer emptied (the message really went
>   out) and falls back to clicking **Send**; synthetic Enter is often ignored by
>   Messenger's editor, which used to leave replies sitting unsent.
> - Also matches the broad `/t/<id>` link form so it works on messenger.com **and**
>   facebook.com.
>
> ⚠️ The bot replies to **every thread in the open list / the open thread** — keep
> the **Marketplace folder** selected so it never messages a personal chat. The
> `isUnread()` heuristics + permanent **Scan now → Copy ALL** diagnostic are kept
> for prioritisation/tuning, but are no longer required for the bot to function.

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
| `background.js` | Service worker: Anthropic API (`claude-sonnet-4-6`, `anthropic-dangerous-direct-browser-access`), system-prompt assembly, rate limits + warm-up, business hours, per-conversation cap, follow-up alarms, `[HUMAN]` notifications, mp4 blob fetch, reply log. |
| `content.js` | DOM side: permanent diagnostic capture, `isUnread()`, scan→read→reply pipeline, human-like typing, human cadence (breaks/skips), `[VIDEO]` paste-to-upload, follow-up typing, live `debugTick`. |
| `popup.html` / `popup.js` | On/off, status, delay slider, live debug, **Open Marketplace** button, unread diagnostic + Copy ALL. |
| `options.html` / `options.js` | Tabbed settings (see below). |
| `icon16/48/128.png` | Action + notification icons. |

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
