# SubSell — Settings Reference (web editor ↔ extension config)

This is the **authoritative list** of every setting the web dashboard edits and the
extension consumes. It is generated from `DEFAULTS` in `background.js` and the tab
layout in `options.html`. The web editor (`docs/`) mirrors these tabs/fields exactly,
stores them all in one **config JSON object**, and the `supabase/functions/subsell-config`
endpoint serves that object to the extension.

- The config JSON is the same shape as the extension's "Export config" output.
- Every field is **optional** — missing fields fall back to the defaults below.
- Do **not** include `enabled` (per-machine on/off) in the config JSON.

## Tab: General

| Field | id | Type | Default | What it does |
|---|---|---|---|---|
| Anthropic API key | `apiKey` | string | `""` | Key (`sk-ant-…`) the extension calls Claude with. |
| Model | `model` | enum | `claude-haiku-4-5` | `claude-haiku-4-5-20251001` (recommended — 3× cheaper) / `claude-sonnet-4-6` / `claude-opus-4-8`. |
| Response delay (s) | `responseDelaySec` | number | `30` | Wait before replying (human-like). |
| Jitter (s) | `jitterSec` | number | `60` | Extra random 0–N s added to the delay. |
| Hourly cap | `hourlyCap` | number | `30` | Max replies/hour. |
| Daily cap | `dailyCap` | number | `200` | Max replies/day. |
| Max replies / conversation | `maxRepliesPerConvo` | number | `5` | **Hard cap** on bot **text replies** in one chat, counted across the whole conversation. Once hit, the bot stays silent even if the buyer keeps asking more questions. Demo videos and follow-ups are separate and do **not** count toward it. `0` = unlimited. |
| When that cap is hit | `convoCapBehavior` | enum | `stop` | `stop` (go quiet) or `notify` (flag the chat as needs-you in the popup). |
| Typing WPM min | `wpmMin` | number | `38` | Lower bound of human typing speed. |
| Typing WPM max | `wpmMax` | number | `78` | Upper bound of human typing speed. |
| Respect business hours | `businessHoursEnabled` | bool | `true` | Only reply between the hours below. |
| Open hour (0–23) | `businessHoursStart` | number | `9` | Start of business hours. |
| Close hour (0–23) | `businessHoursEnd` | number | `22` | End of business hours. |
| Human cadence | `humanCadence` | bool | `true` | Random breaks + occasional skipped cycles. |
| Skip chance (0–1) | `skipChance` | number | `0.12` | Chance to skip a cycle. |
| Break chance / cycle (0–1) | `breakChance` | number | `0.05` | Chance per cycle to start a break. |
| Break min (min) | `breakMinMin` | number | `3` | Min break length. |
| Break max (min) | `breakMaxMin` | number | `18` | Max break length. |
| Warm-up mode | `warmupEnabled` | bool | `true` | New account ramps daily volume over N days. |
| Warm-up days | `warmupDays` | number | `7` | Ramp length. |
| Day-0 daily cap | `warmupStartCap` | number | `10` | Daily cap on day 0. |
| Off-platform guardrails | `offPlatformGuard` | bool | `true` | Forbid phone/email/links/"contact me elsewhere". |
| Closer mode | `closerMode` | bool | `true` | Drive buyers to call/visit; trade-in/buyback/liquidation. |
| Closing style | `closerIntensity` | enum | `medium` | `soft` (one gentle invite) / `medium` (guide toward the visit) / `master` (full sales playbook: micro-commitments, assumptive & two-option closes, reserve technique, honest urgency, objection handling, one advancing question per message, stop-selling-after-yes). Only applies when Closer mode is ON. |
| Never quote exact prices | `noExactPrices` | bool | `true` | Promise best price in person (ignored if `priceList` set). |
| Silent visit confirmation | `visitConfirmEnabled` | bool | `true` | After a buyer says they'll come, ask "still coming?" silently. |
| Ask after (minutes) | `visitConfirmAfterMin` | number | `120` | Delay before the silent visit confirm. |

## Tab: Business

| Field | id | Type | Default | What it does |
|---|---|---|---|---|
| Business name | `businessName` | string | `SubSell` | Used in the system prompt. |
| Address | `businessAddress` | string | `757 Rue Beaubien E, Montréal` | Shown in prompt. |
| Hours (text) | `businessHoursText` | string | `9AM–10PM, 7 days` | Human-readable hours in prompt. |
| Business info | `businessInfo` | string | (see defaults) | Free text added to prompt. |
| Instructions / tone | `instructions` | string | (see defaults) | Tone/behavior instructions in prompt. |
| Example conversations | `examples` | string | `""` | Few-shot buyer→reply pairs; strongly shapes voice. |
| Closer goals | `closerGoals` | string | (see defaults) | Closing strategy text (used when Closer mode on). |
| Price list | `priceList` | string | `""` | Starting prices, one per line. When set, the bot shares them (overrides `noExactPrices`). |
| Visit-confirm message | `visitConfirmMessage` | string | `""` | Blank = built-in bilingual default. |

## Tab: Listings

`listings` — array of rows. Each: `{ title, model, storage, condition, price (number), videoUrl, available (bool) }`. Included in the prompt; only available items are offered.

## Tab: Follow-ups

**Smart follow-up** (proactive; Claude decides per chat, capped so it never spams):
- `smartFollowupEnabled` — bool (default `false`). Master on/off for proactive follow-ups on quiet chats.
- `smartFollowupMaxCount` — number (default `1`). Max follow-ups per chat, total (e.g. 1 or 2).
- `smartFollowupQuietHours` — number (default `6`). Hours a chat must be quiet before the **first** follow-up.
- `smartFollowupGapHours` — number (default `24`). Hours between follow-ups (2nd, 3rd…).
- `coaching` — array (default `[]`). Graded real replies from the dashboard's **Activity** tab (👍 = imitate, 👎 + correction = the right answer): `[{kind:"good"|"fix", buyer, reply, bad, better, note, at}]`, capped at 30 (FIFO). Rendered into every bot's system prompt as highest-priority coaching; edited only through the Activity tab's Teach buttons + Coaching list.

**Simple timer follow-up** (fixed message; separate feature — use one or the other):
- `followUps` — array of `{ name, afterMinutes (number), message, enabled (bool) }`. After the bot replies it arms a timer; if the buyer stays quiet that long it sends `message` once.

## Tab: Videos

- `demoVideoUrls` — array of `{ name, url }`. **Central demo videos**: uploaded once in
  the dashboard (stored in Supabase Storage), served via the config URL. Each extension
  downloads them and sends them as **native** attachments **once per chat** — including
  on quiet/older chats it revisits (not just right after a reply). The buyer never sees a link.
- `demoVideoDelaySec` — number (default `10`). Seconds to wait after a fresh reply before
  sending the first video (on a revisit it's sent immediately).
- `demoVideoBetweenSec` — number (default `8`). Seconds to pause **between** videos when
  several are configured.
- `videos` — array of `{ name, url, notes }`. A reference URL library only (not auto-sent).
- `videoRetryMax` — number (default `2`). (v0.21.47) How many times a chat's native
  attach is retried (each time with a different attach channel first) when **nothing
  could be confirmed staged** — no preview tile and Messenger's own send control never
  left its empty state. `0` = no native retry.
- `videoLinkFallback` — bool (default `true`). (v0.21.47) After those retries, send the demo
  as a **link** through the normal text path (the proven send), so the buyer still gets it.
  The chat is then marked served (`link:1`) — never sent twice.
- `videoLinkUrl` — string (default blank = the first central video's own URL).
- `videoLinkText` — string (default blank = built-in `Voici la vidéo démo 🎥 (demo video) {link}`);
  `{link}` is replaced by the URL.
- `videoForeground` — bool (default `true`). (v0.21.48) While a video set attaches, uploads
  and sends, the extension brings its own Messenger window to the front and activates the
  tab (Chrome never starts a video upload in a hidden/covered tab — that is what used to
  wait for a click on the page), then hands focus back to the window that had it.
  The staged-clip watcher also uses it when an upload is stalled on a hidden tab.

## NOT web-managed (per-machine, stay in the extension)

These live in each computer's local storage and are **not** in the config JSON:
- `enabled` — on/off toggle per machine.
- `machineLabel` — how this computer/account shows up in the web app's **Activity** log (Settings → "This computer's label"). Falls back to a stable random id.
- `videoEnabled` (bool), `videoDelaySec` (number, default 10), `demoVideos` (uploaded
  mp4 files as base64) — the actual demo video is uploaded per machine (too big to serve
  as JSON). The **Videos** tab above syncs video *URLs* only.

## Source of truth
`DEFAULTS` and `buildSystemPrompt()` in `background.js`. The web app only stores/serves
these fields; the extension builds the prompt and calls Claude.
