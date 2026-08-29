# SubSell — Web App / Supabase Integration Spec (for matching v0.9+)

This document is a **handoff spec** for building a Supabase-backed web app that
manages the SubSell Chrome extension's settings. Give this to the session that is
building the web app.

## 0) The most important thing to understand

**Do NOT rebuild the bot.** The Chrome extension already contains all the logic —
reading Marketplace chats, building the Claude prompt, sending replies, the demo
video, the follow-up. That stays as-is.

The web app has **three jobs only**:
1. **Auth** — user logs in (Supabase Auth, e.g. Google).
2. **Settings editor** — a UI to edit the v9 settings below + store them in Supabase.
3. **Config endpoint** — serve each user's settings back as **one JSON object** at a
   per-user URL (with a unique key). The extension fetches that URL and applies it.

The extension is **already built to do this**: in Settings → General → "Remote config
URL", you paste a URL that returns the settings JSON. The extension fetches it on
startup + every ~10 min and uses it as the source of truth. **So the integration
needs ZERO extension changes** — the web app just has to serve a compatible JSON.

```
[ Web app + Supabase ]  --(serves settings JSON at /config?key=USERKEY)-->  [ Extension ]
   you log in (Google)                                                        pastes that URL,
   edit settings                                                              fetches + applies it
```

## 1) The config JSON contract (what the extension expects)

The extension consumes a single JSON **object** (same shape as the extension's
"Export config to file" output). Serve exactly this shape. Every field is optional —
missing fields fall back to built-in defaults. Do **not** include `enabled` (that's
per-machine on/off).

### Core settings (ACTIVE — these change the bot's behavior today)

| Field | Type | Default | What it does |
|---|---|---|---|
| `apiKey` | string | "" | Anthropic API key (`sk-ant-…`). The extension calls Claude directly with it. |
| `model` | string | "claude-sonnet-4-6" | Claude model id. |
| `businessName` | string | "SubSell" | Used in the system prompt. |
| `businessAddress` | string | … | Shown in prompt. |
| `businessHoursText` | string | "9AM–10PM, 7 days" | Human-readable hours in prompt. |
| `businessInfo` | string | … | Free text added to prompt ("BUSINESS INFO"). |
| `instructions` | string | … | Tone/behavior instructions in prompt. |
| `examples` | string | "" | Few-shot buyer→reply pairs pasted in; strongly shapes voice. |
| `closerMode` | bool | true | Adds the "drive them to call/visit" closing section. |
| `closerGoals` | string | … | The closing strategy text. |
| `noExactPrices` | bool | true | If true AND no `priceList`, the bot refuses to quote a price. |
| `priceList` | string | "" | **Starting prices, one per line.** When set, the bot SHARES starting prices (overrides `noExactPrices`) then closes. |
| `offPlatformGuard` | bool | true | Forbids phone/email/links/"contact me elsewhere"; escalates `[HUMAN]`. |
| `businessHoursEnabled` | bool | true | If true, the bot only replies between the hours below. |
| `businessHoursStart` | number(0–23) | 9 | Open hour. |
| `businessHoursEnd` | number(0–23) | 22 | Close hour. |
| `hourlyCap` | number | 30 | Max replies/hour (safety). |
| `dailyCap` | number | 200 | Max replies/day (safety). |
| `responseDelaySec` | number | 30 | Wait before replying (human-like). |
| `jitterSec` | number | 60 | Extra random 0–N s added to the delay. |
| `listings` | array | [] | Inventory rows; included in the prompt. Each: `{title, model, storage, condition, price (number), videoUrl, available (bool)}`. |
| `followUps` | array | [] | Follow-up nudges. Each: `{name, afterMinutes (number), message, enabled (bool)}`. After the bot replies, it arms a timer; if the buyer stays quiet that long it sends `message` once. |

### Advanced settings (stored but NOT active in the current "simple" build)
Include them in the editor if you want forward-compat, but know they currently do
nothing in the shipped extension: `wpmMin`, `wpmMax`, `maxRepliesPerConvo`,
`convoCapBehavior`, `humanCadence`, `skipChance`, `breakChance`, `breakMinMin`,
`breakMaxMin`, `warmupEnabled`, `warmupDays`, `warmupStartCap`, `visitConfirmEnabled`,
`visitConfirmAfterMin`, `visitConfirmMessage`, `videos` (old URL list).

### Per-machine settings (NOT web-managed — leave these to the extension)
These live in each computer's local storage, not in the config JSON:
- `enabled` — on/off toggle per machine.
- **Demo video** — `videoEnabled` (bool), `demoVideos` (array of uploaded files as
  base64; sent instantly on a buyer's message, once per chat). Videos are large and are
  uploaded per machine in the extension's Settings; **do not put them in the web
  config** (too big to serve as JSON). (Future option: store video *URLs* instead and
  have the extension download them — not in v9.)

### Example config JSON (this is literally what the endpoint should return)
```json
{
  "apiKey": "sk-ant-xxxxxxxx",
  "model": "claude-sonnet-4-6",
  "businessName": "SubSell",
  "businessAddress": "757 Rue Beaubien E, Montréal",
  "businessHoursText": "9AM–10PM, 7 days",
  "businessInfo": "Used iPhone & Samsung sales in Montreal. Pickup in person. Cash or e-transfer.",
  "instructions": "Be friendly and concise. Reply in the buyer's language (FR/EN); casual Quebec French. If rude/scammy/weird, return [HUMAN] with a short reason.",
  "examples": "Buyer: iPhone 13 dispo?\nYou: Allô! Oui 👍 à partir de 420$. Passe au shop, on te fait un super deal 🙂",
  "closerMode": true,
  "closerGoals": "Get the buyer to call or come to the shop. Best price in person. Mention trade-ins (cash for newer phones) and liquidation deals. Build urgency without being pushy.",
  "noExactPrices": false,
  "priceList": "iPhone 13 — from $420\niPhone 14 — from $560\nGalaxy S22 — from $380\niPad 9 — from $300\nMacBook Air M1 — from $700",
  "offPlatformGuard": true,
  "businessHoursEnabled": true,
  "businessHoursStart": 9,
  "businessHoursEnd": 22,
  "hourlyCap": 30,
  "dailyCap": 200,
  "responseDelaySec": 30,
  "jitterSec": 60,
  "listings": [
    {"title": "iPhone 13", "model": "iPhone 13", "storage": "128GB", "condition": "Excellent", "price": 420, "videoUrl": "", "available": true}
  ],
  "followUps": [
    {"name": "Still interested?", "afterMinutes": 120, "message": "Salut! Tjs intéressé? Passe au shop ou appelle-nous 🙂 / Still interested? Drop by or call us 🙂", "enabled": true}
  ]
}
```

## 2) How the extension fetches it (the contract)
- The extension does `fetch(URL, { cache: "no-store" })` and expects a **JSON object**
  (HTTP 200, `application/json`). It must be readable **without interactive login**
  (so authenticate via a key in the URL, not a session cookie).
- It re-fetches on startup and every ~10 minutes, and applies the result as the
  highest-priority settings source.
- **CORS:** the endpoint must allow the request (the fetch comes from a Chrome
  extension origin). Return `Access-Control-Allow-Origin: *` (or echo the origin).

## 3) Suggested Supabase design

**Auth:** Supabase Auth with Google provider. Each user = one row of settings.

**Table `configs`:**
```sql
create table configs (
  user_id   uuid primary key references auth.users(id),
  api_key_present boolean default false,   -- optional UI hint
  config    jsonb not null default '{}',   -- the settings object from section 1
  config_key text unique default encode(gen_random_bytes(16), 'hex'), -- the extension's URL key
  updated_at timestamptz default now()
);
alter table configs enable row level security;
create policy "owner can read/write own row"
  on configs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Config endpoint (Edge Function `config`):** public, takes `?key=<config_key>`,
looks up the row by `config_key`, returns `row.config` as JSON with permissive CORS.
This is the URL the user pastes into the extension. Example:
`https://<project>.supabase.co/functions/v1/config?key=<config_key>`

(Because the key grants access to the API key inside, treat `config_key` as a secret:
let the user regenerate it, and keep `apiKey` only in the config served over HTTPS.)

**Web UI:** a settings page mirroring the extension's tabs:
- **General:** apiKey, model, hours, caps, delay/jitter.
- **Business:** businessName/address/hours text, businessInfo, instructions, examples,
  closerMode, closerGoals, noExactPrices, **priceList**, offPlatformGuard.
- **Listings:** table editor for `listings`.
- **Follow-ups:** table editor for `followUps`.
- Show the user their **config URL** (with `config_key`) + a "copy" button and a
  "regenerate key" button.

## 4) End-user flow
1. User signs into the web app with Google.
2. Fills in settings (key, business, prices, listings, follow-ups). Saves → Supabase.
3. Copies their **config URL** from the web app.
4. In the extension (each machine, once): Settings → General → **Remote config URL**
   → paste → Fetch now. From then on the machine pulls everything from the web app;
   edits on the web app reach every machine within ~10 min.

## 5) Reply tokens the model emits (FYI — handled inside the extension)
The extension already parses these from Claude's reply; the web app doesn't need to,
but they explain behavior:
- `[HUMAN] <reason>` → don't auto-reply; notify the operator.
- `[VIDEO:<url>] <caption>` → (in v9 the demo video is the per-machine uploaded file).
- `[VISIT:yes|no|maybe] <text>` → silent visit tracking (advanced/legacy).

## 6) Source of truth
The authoritative settings list + defaults is `DEFAULTS` in `background.js`, and the
prompt assembly is `buildSystemPrompt()` in `background.js`. The web app only needs to
**store and serve** these fields — the extension builds the prompt and calls Claude.
