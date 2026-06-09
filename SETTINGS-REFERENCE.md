# SubSell — Settings Reference (web editor ↔ extension config)

This is the **authoritative list** of every setting the web dashboard edits and the
extension consumes. It is generated from `DEFAULTS` in `background.js` and the tab
layout in `options.html`. The web editor (`docs/`) mirrors these tabs/fields exactly,
stores them all in one **config JSON object**, and the `supabase/functions/config`
endpoint serves that object to the extension.

- The config JSON is the same shape as the extension's "Export config" output.
- Every field is **optional** — missing fields fall back to the defaults below.
- Do **not** include `enabled` (per-machine on/off) in the config JSON.

## Tab: General

| Field | id | Type | Default | What it does |
|---|---|---|---|---|
| Anthropic API key | `apiKey` | string | `""` | Key (`sk-ant-…`) the extension calls Claude with. |
| Model | `model` | enum | `claude-sonnet-4-6` | `claude-sonnet-4-6` / `claude-opus-4-8` / `claude-haiku-4-5-20251001`. |
| Response delay (s) | `responseDelaySec` | number | `30` | Wait before replying (human-like). |
| Jitter (s) | `jitterSec` | number | `60` | Extra random 0–N s added to the delay. |
| Hourly cap | `hourlyCap` | number | `30` | Max replies/hour. |
| Daily cap | `dailyCap` | number | `200` | Max replies/day. |
| Max replies / conversation | `maxRepliesPerConvo` | number | `5` | Total bot replies in one chat (0 = unlimited). |
| When that cap is hit | `convoCapBehavior` | enum | `stop` | `stop` (go quiet) or `notify` (ping operator). |
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

`followUps` — array of rows. Each: `{ name, afterMinutes (number), message, enabled (bool) }`. After the bot replies it arms a timer; if the buyer stays quiet that long it sends `message` once.

## Tab: Videos

`videos` — array of rows. Each: `{ name, url, notes }`. A library of demo-video URLs (reference list).

## NOT web-managed (per-machine, stay in the extension)

These live in each computer's local storage and are **not** in the config JSON:
- `enabled` — on/off toggle per machine.
- `videoEnabled` (bool), `videoDelaySec` (number, default 10), `videoGapSec` (number,
  default 8 — seconds to wait between videos when more than one is set), `demoVideos`
  (uploaded mp4 files as base64) — the actual demo video is uploaded per machine (too big
  to serve as JSON). The **Videos** tab above syncs video *URLs* only. Each video is sent
  at most **once per conversation** (an atomic per-thread claim in the background guards
  against reloads and multiple tabs double-sending).

`maxRepliesPerConvo` / `convoCapBehavior` are **enforced** in the reply pipeline: once a
chat reaches the cap the bot goes quiet (`stop`) or pings you once (`notify`), even if the
buyer keeps asking questions. The count is persisted per thread.

## Source of truth
`DEFAULTS` and `buildSystemPrompt()` in `background.js`. The web app only stores/serves
these fields; the extension builds the prompt and calls Claude.
