# SubSell Marketplace Auto-Reply — Chrome Extension

A Chrome **Manifest V3** extension that auto-replies to Facebook Marketplace
buyer messages using the Anthropic Claude API. Bilingual FR/EN (casual Quebec
French), built for used-iPhone sales in Montréal. Runs locally per Chrome profile
by default; **optional cloud sync** turns it into a web app so one change reaches
every computer.

> 🚦 **v0.21.40 — the blocks are gone: no 24h pauses, no "all clips must load first", queued sets go out within minutes.**
> Operator directive: *"remove all blocks of this functionality — just send any video you
> can, you don't need to upload all to send."* Everything that could keep a not-yet-served
> chat from getting its clips is now either removed or reduced to a short pace: the
> **24-hour attach/load pause and the 3-strike give-up are gone** (a failing chat simply
> retries after 3 minutes, forever — the counts stay visible in the diagnostic as
> `attachFails3+`); the **whole-set rule is gone** — clips that loaded go out now, and a
> clip that can't load yet gets its own slot, retried on the next visit (never skipped);
> the **pending-videos lane** runs every 90 s instead of every 4 min and a queued set is
> eligible after 2 min (a diagnostic showed 21 sets queued, the oldest for 19 hours); a
> crashed pass blocks its own chat's resume for 10 min instead of 30; and **rush mode**
> (reply first, videos queued) now triggers only when the file API is genuinely
> unavailable on the machine, not merely "unproven recently". The duplicate-safety
> rules are untouched: a chat marked delivered is never re-sent, and an attempted clip
> whose state is unknowable is skipped rather than risked twice.
>
> 🎬 **v0.21.38 — one clip in flight at a time; the composer itself confirms the attach; no more piles, no more 24h video pauses.**
> A live diagnostic (machine PC-mnbbd) showed the failure behind "some chats get no
> video at all": on that machine the file API handed the clips to Messenger correctly
> (`ok=97`) but the preview tiles rendered far later than the bot's 12-30 s windows.
> Each attempt was judged "nothing attached", swept, re-pasted, and the chat struck
> (21 chats sat in 24h pauses); later all the tiles rendered at once (`tray7`) and one
> Enter would have sent seven clips. Now: **(1)** with the file API the engine sends
> **one clip at a time** — clip 1 is handed over within seconds of the chat opening,
> sent the moment it is ready, the text reply rides right behind it, then clips 2 and 3
> — so at most one clip is ever in flight per chat and nothing can pile up. **(2)** The
> attach is confirmed by Messenger's **own send control** (the like button turning into
> Send), which flips instantly even when the tile is slow, so slow machines no longer
> fail on timing. **(3)** Before every Enter the tray must hold exactly one message's
> worth; a surplus copy is removed, and if it won't go, nothing is sent. **(4)** A clip
> the browser accepted but that never showed is counted as attempted and the next visit
> adopts its late tile — never a second copy. **(5)** Clips are checked to still exist on
> disk before every attach (a deleted file was another way to get "ok" with nothing
> staged), and clips no longer travel as base64 before the first attach. **(6)** Existing
> attach pauses are cleared once so those chats retry now. Machines that show
> `sud: base=-` in the diagnostic (PC-mnbbd, PC-5u78q) cannot self-update and need the
> zip link once, extracted inside Downloads.
>
> 🧭 **v0.21.37 — answer the buyer even when Facebook clutters the thread; rush mode; stale-machine alerts.**
> From two live diagnostics: on the v0.21.36 machine videos are now 100% consistent
> (`fileapi ok=33 verified=33`, every set `bulk:3`), but "Mohand: Bonjour · 1h" and
> "Touty: Ça dépend · 10h" still sat unanswered — Facebook's unpainted, centered
> system blocks (automated-suggestion cards, "X is waiting for your response", dividers)
> rendered *after* the buyer's bubble were counted as our message. Now: unpainted
> **centered** blocks are treated as system rows (never "ours"), and the sidebar rescue
> walks back over such blocks to find the text Messenger itself attributes to the buyer.
> **Rush mode:** when 3+ other buyers are waiting and the file API hasn't proven itself
> on the machine recently, the reply goes out first and the clips are queued (pending
> lane) instead of spending minutes on synthetic attaches. **Stale machines** (self-update
> can't find the extension folder, e.g. the machine still on v0.21.33 in the second
> diagnostic) now post a once-a-day "STALE BUILD … cannot self-update" row to the
> dashboard Activity feed naming the cure — update those by hand with the zip link.
>
> 🎯 **v0.21.36 — videos attached through Chrome's own file API (the permanent fix).**
> Field evidence (screenshot + diagnostic): the bot replied but no video went out because
> the *attach* step — faking a paste/drag/file-input event into Facebook's composer — is
> accepted only some of the time on this Facebook build. Now the primary path is the one
> Playwright uses: the extension puts the clips on disk once per machine
> (`Downloads/SubSell-videos/`) and hands them to the composer's hidden file input
> through Chrome's debugger protocol (`DOM.setFileInputFiles`) — Chrome stages them
> exactly as if you picked them in the file dialog (trusted events), all clips at once.
> Needs the new `debugger` permission (granted automatically on reload for Load-unpacked
> installs). Chrome shows a small "SubSell started debugging this browser" bar for a
> second or two per attach; add `--silent-debugger-extension-api` to the Chrome shortcut
> to hide it. If a machine has the extension's **"Allow access to file URLs"** switch off,
> the popup diagnostic says so (`fileapi:` line) and the old paste path is used meanwhile.
> Every failure falls back to the previous strategies — never worse than before.
> Also: chats where zero clips attached are now queued for an explicit retry visit.
>
> ⚡ **v0.21.34 — stream videos as they're ready; reply right after clip 1; rescue misread buyers.**
> Diagnosed from a live machine report (`bulk:0` on every set, ~60s per clip, 41 pending
> video chats, buyers waiting 2–12h while "suppressed"):
> - **Send whatever can send.** On this Facebook build a multi-file paste is rejected and a
>   new paste is refused while a clip is still uploading, so the old "attach everything, one
>   Enter at the end" design held all 3 clips (and the text answer) for ~4 minutes per chat.
>   Now each clip is **sent the moment its own upload finishes**, the **text reply ships right
>   after clip 1** (still honoring your response delay), and the remaining clips stream one
>   by one — each next paste lands on an empty, settled tray, so it attaches on the first try.
> - **Nobody waits for an old chat's videos.** Between clips the engine checks whether
>   another buyer is waiting for a reply; if so it parks the remaining clips on the
>   pending lane (guaranteed later delivery, no failure strike) and lets the reply go first.
> - **Sidebar-confirmed buyer turns.** When Messenger's own row reads "Charles: How much? ·
>   2h" but the open-chat paint/geometry read defaulted that bubble to "me" (it was being
>   suppressed for 6h after 3 such reads), the sidebar attribution now confirms it as the
>   buyer's message and it gets answered.
> - One-shot: attach-paused chats (3 strikes under the old hold-then-send path) retry
>   immediately under the streaming engine. Busy watchdog widened to 9 min to cover a fully
>   streamed 3-clip set.
>
> 🩹 **v0.21.33 — reply-reliability fixes ported from the review branch.**
> Four classes of "this convo never got a reply" fixed, plus one message-loss fix:
> - **Noise filter regressions:** the price/spec/date-header rules matched real buyer
>   messages as prefixes — "$300 possible?", "128gb still available?", "mon budget
>   c'est 300", "hier j'ai vu l'annonce", "demain 18h30", "dimanche 13h00" were all
>   dropped, so the bot thought IT spoke last and parked those chats. Headers now
>   need real header shapes (day word + time, amount-only, incl. the FR
>   "aujourd'hui" typographic apostrophe). Covered by a 60-case regression test.
> - **"Is this still available?" answered again:** that exact text is the buyer's
>   standard opener; it was being filtered as a preset-chip. Chips stay excluded
>   structurally (role=button), the real opener gets a reply.
> - **Photo/sticker-only messages:** media bubbles (≥48px, non-blob, outside links)
>   are now read with the same buyer-only-with-positive-evidence rule, so a buyer
>   who answers with just a picture gets a reply instead of an endless idle park;
>   our own clips are ignored when deciding who spoke last.
> - **Repeated identical messages:** dedupe now keys on (our last message + trailing
>   buyer texts + buyer text), so a buyer who says "ok" twice gets answered twice
>   (old plain-text marks still honored — no re-billing of parked chats).
> - **Follow-up/visit-confirm alarms** that fire while the content script is busy
>   (or another tab holds the chat) re-arm 3 minutes later instead of being lost.
>
> ☁️ **v0.12.0 — cloud sync (web app).** Run SubSell like a web app: sign into a hosted
> **settings dashboard** (Google or email) that serves your settings to every computer.
> Edit once → every machine picks it up within ~10 min. Backed by your own free
> **Supabase** project: settings live in a private row (`subsell_configs`, Row-Level
> Security), and a tiny **Edge Function** serves them at a per-user **config URL** you
> paste into the extension's existing **Settings → General → Remote config URL** — so
> **zero extension changes** are needed. Setup in `supabase/README.md` (SQL in
> `supabase/schema.sql`, function in `supabase/functions/subsell-config/`, web UI in `docs/`); the
> JSON contract is `SPEC-webapp.md`. Purely additive — the reply/video/follow-up logic is
> untouched; on/off stays per-machine.
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

## Files

| File | Purpose |
|------|---------|
| `manifest.json` | MV3 manifest — content script, service worker, popup, options. |
| `background.js` | Service worker: Anthropic API (`claude-sonnet-4-6`, `anthropic-dangerous-direct-browser-access`), system-prompt assembly, rate limits + warm-up, business hours, per-conversation cap, follow-up alarms, `[HUMAN]` notifications, mp4 blob fetch, reply log. |
| `content.js` | DOM side (SIMPLE mode): rotate through every chat → read the last message (composer-bounded, noise-filtered) → if it's the buyer's, ask Claude → type + verify-send. Live `debugTick` for the popup. |
| `popup.html` / `popup.js` | On/off, status, delay slider, live debug, **Open Marketplace** button, unread diagnostic + Copy ALL. |
| `options.html` / `options.js` | Tabbed settings (see below). Paste your web-app **config URL** in **General → Remote config URL** to pull settings from the cloud. |
| `icon16/48/128.png` | Action + notification icons. |
| `docs/` | The cloud **dashboard** — a static web app (`index.html`, `app.js`, `config.js`) deployed to GitHub Pages; sign in (Google/email) to edit settings and copy your config URL. |
| `supabase/` | Backend: `schema.sql` (table + RLS + signup trigger), `functions/subsell-config/index.ts` (public config Edge Function), and `README.md` (deploy steps). |
| `SPEC-webapp.md` | The config-JSON contract between the web app and the extension. |
| `SETTINGS-REFERENCE.md` | Every tab/field the editor mirrors + types/defaults (from `DEFAULTS`). |

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
