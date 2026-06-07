# SubSell — COMPLETE settings reference (every option, all tabs)

This is the exhaustive list of **every setting** in the extension, grouped exactly
like the Settings page tabs. The web app should let the user edit **all** of these and
store them in the one `config` JSON object that the extension fetches. (Pair this with
`supabase/` for the backend and `SPEC-webapp.md` for the integration contract.)

Legend for "Engine":
- **active** = changes the bot's behavior in the current build.
- **stored** = saved & shown in the UI, but the current simple build doesn't act on it
  yet (keep it so nothing is lost and future builds can use it).

---

## TAB 1 — General

| Field (key) | UI label | Type | Default | Meaning | Engine |
|---|---|---|---|---|---|
| `apiKey` | Anthropic API key | password/string | "" | Claude key (`sk-ant-…`). The extension calls Claude with it. | active |
| `model` | Model | select | "claude-sonnet-4-6" | One of: `claude-sonnet-4-6`, `claude-opus-4-8`, `claude-haiku-4-5-20251001`. | active |
| `responseDelaySec` | Response delay (s) | number | 30 | Wait this long before replying. | active |
| `jitterSec` | Jitter (s) | number | 60 | Add a random 0–N s on top of the delay. | active |
| `hourlyCap` | Hourly cap | number | 30 | Max replies per hour. | active |
| `dailyCap` | Daily cap | number | 200 | Max replies per day. | active |
| `maxRepliesPerConvo` | Max replies per conversation | number | 5 | Cap of bot replies in one chat (0 = unlimited). | stored |
| `convoCapBehavior` | When that cap is hit | select | "stop" | `stop` = go quiet, `notify` = ping you. | stored |
| `wpmMin` | Typing WPM min | number | 38 | Lower bound of typing speed. | stored |
| `wpmMax` | Typing WPM max | number | 78 | Upper bound of typing speed. | stored |
| `businessHoursEnabled` | Respect business hours | checkbox | true | Only reply between the hours below. | active |
| `businessHoursStart` | Open hour (0–23) | number | 9 | Start hour. | active |
| `businessHoursEnd` | Close hour (0–23) | number | 22 | End hour. | active |
| `humanCadence` | Human cadence | checkbox | true | Random breaks + skipped cycles. | stored |
| `skipChance` | Skip chance (0–1) | number | 0.12 | Chance to skip a cycle. | stored |
| `breakChance` | Break chance / cycle (0–1) | number | 0.05 | Chance to start a break. | stored |
| `breakMinMin` | Break min (min) | number | 3 | Min break length. | stored |
| `breakMaxMin` | Break max (min) | number | 18 | Max break length. | stored |
| `warmupEnabled` | Warm-up mode | checkbox | true | Ramp daily volume over N days. | stored |
| `warmupDays` | Warm-up days | number | 7 | Ramp length. | stored |
| `warmupStartCap` | Day-0 daily cap | number | 10 | Daily cap on day 0. | stored |
| `offPlatformGuard` | Off-platform guardrails | checkbox | true | Forbid phone/email/links; escalate `[HUMAN]`. | active |
| `closerMode` | Closer mode | checkbox | true | Add the "drive them to call/visit" section. | active |
| `noExactPrices` | Never quote exact prices in chat | checkbox | true | If true AND no `priceList` → refuse to quote a price. | active |
| `visitConfirmEnabled` | Silent visit confirmation | checkbox | true | After a buyer says they'll come, ask "still coming?". | stored |
| `visitConfirmAfterMin` | Ask after (minutes) | number | 120 | Delay before that silent confirm. | stored |

**Per-machine (NOT in the web `config` JSON — they live in each computer's local storage):**
| Field | UI label | Type | Default | Notes |
|---|---|---|---|---|
| `enabled` | (popup ON/OFF) | bool | false | On/off per machine. Never serve this from the web app. |
| `remoteConfigUrl` | Remote config URL | string | "" | The link the machine pulls config from (this IS the web-app URL). |
| `videoEnabled` | Send demo video(s) once per chat | bool | false | Video on/off (local). |
| `videoDelaySec` | Send the video(s) … seconds after the reply | number | 10 | Delay before the video. |
| `demoVideos` | (Choose File list) | array | [] | Uploaded mp4s as base64 — too big for the web config; stay local. |

> To make video on/off + delay web-managed too, it's a tiny extension tweak (read
> `videoEnabled`/`videoDelaySec` from the fetched config). The video FILES stay local
> (or, future option, store video URLs instead of uploads). Say the word and I'll add it.

---

## TAB 2 — Business prompt

| Field (key) | UI label | Type | Default | Engine |
|---|---|---|---|---|
| `businessName` | Business name | text | "SubSell" | active |
| `businessAddress` | Address | text | "757 Rue Beaubien E, Montréal" | active |
| `businessHoursText` | Hours (text shown to Claude) | text | "9AM–10PM, 7 days" | active |
| `businessInfo` | Business info | textarea | "Used iPhone sales in Montreal…" | active |
| `instructions` | Instructions / tone | textarea | "Be friendly and concise. Auto-detect language…" | active |
| `examples` | Example conversations | textarea | "" | active (few-shot; strongly shapes voice) |
| `closerGoals` | Closer goals | textarea | "Your #1 goal is to get the buyer to come visit…" | active (when closerMode) |
| `priceList` | Price list | textarea | "" | active — starting prices, one per line; **overrides `noExactPrices`** |
| `visitConfirmMessage` | Visit-confirm message | textarea | "" | stored (blank = bilingual default) |

---

## TAB 3 — Listings  (`listings`: array)
Editable table. Each row:
| Column | key | type |
|---|---|---|
| Title | `title` | text |
| Model | `model` | text |
| Storage | `storage` | text |
| Condition | `condition` | text |
| Price CAD | `price` | number |
| Video URL | `videoUrl` | text |
| Avail. | `available` | bool |
Engine: **active** — included in the system prompt (shown with or without price
depending on `noExactPrices`/`priceList`).

---

## TAB 4 — Follow-ups  (`followUps`: array)
Editable table. Each row:
| Column | key | type |
|---|---|---|
| Name | `name` | text |
| After (min) | `afterMinutes` | number |
| Message | `message` | textarea |
| On | `enabled` | bool |
Engine: **active** — after the bot replies it arms a timer; if the buyer stays quiet
that long it sends `message` once (skipped if the buyer replies first).

---

## TAB 5 — Videos  (`videos`: array)  [legacy URL library]
Editable table: `{ name, url, notes }`. Engine: **stored** (legacy; the active video
feature is the per-machine upload in General). Keep in the editor for completeness.

---

## TAB 6 — Test responses  (tool, not a setting)
Runs a fake buyer message through Claude using the current settings. Optional to
rebuild in the web app; nice for previewing prompt changes. Not stored.

## TAB 7 — Activity log  (read-only, per machine)
The last 500 sends on that machine. Lives in local storage; not part of the web
config. (Future option: push logs to Supabase for a central dashboard.)

---

## Complete default `config` JSON (every web-managed field)
This is the full object the web app stores and the endpoint returns:
```json
{
  "apiKey": "",
  "model": "claude-sonnet-4-6",
  "responseDelaySec": 30,
  "jitterSec": 60,
  "hourlyCap": 30,
  "dailyCap": 200,
  "maxRepliesPerConvo": 5,
  "convoCapBehavior": "stop",
  "wpmMin": 38,
  "wpmMax": 78,
  "businessHoursEnabled": true,
  "businessHoursStart": 9,
  "businessHoursEnd": 22,
  "humanCadence": true,
  "skipChance": 0.12,
  "breakChance": 0.05,
  "breakMinMin": 3,
  "breakMaxMin": 18,
  "warmupEnabled": true,
  "warmupDays": 7,
  "warmupStartCap": 10,
  "offPlatformGuard": true,
  "closerMode": true,
  "noExactPrices": true,
  "visitConfirmEnabled": true,
  "visitConfirmAfterMin": 120,
  "businessName": "SubSell",
  "businessAddress": "757 Rue Beaubien E, Montréal",
  "businessHoursText": "9AM–10PM, 7 days",
  "businessInfo": "Used iPhone sales in Montreal. Pickup at 757 Rue Beaubien E, Montréal. Cash or e-transfer.",
  "instructions": "Be friendly and concise. Auto-detect the buyer's language (French or English) and reply in the same language; for French use casual Quebec French. Quote prices from the listings. Never discount more than 10% without flagging a human. If the buyer is rude, scammy, or asking something unusual, return [HUMAN] with a short reason.",
  "examples": "",
  "closerGoals": "Your #1 goal is to get the buyer to come visit the shop in person. We give better prices in person than online. We also do trade-ins/exchanges, buyback of their old phone, and have liquidation deals — mention these naturally when relevant. Build excitement and urgency without being pushy. Always steer toward 'come by the shop and we'll take care of you'.",
  "priceList": "",
  "visitConfirmMessage": "",
  "listings": [],
  "followUps": [],
  "videos": []
}
```

The web app's editor = these tabs. The extension applies whatever you store, unchanged.
