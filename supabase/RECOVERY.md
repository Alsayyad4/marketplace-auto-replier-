# Recovery — what came back, what did not, and the one path to the rest

**Sep 21, 2026.** The account's settings row was overwritten with empty strings,
then every machine that still held a copy was uninstalled — which in Chrome
deletes the extension's storage for good, sync included. There was nothing left
anywhere to pull. This file records exactly what v0.21.62 puts back, where each
fact came from, and what only the owner can still recover.

## What v0.21.62 does on login

A machine that logs into an **empty** account now fills it from `SEED_CONFIG`
(top of `background.js`), then the normal one-minute sync carries it to every
other machine. It fires only when the account holds nothing worth having AND the
machine holds nothing better; it re-reads the row before writing; once per row
stamp. Covered by `store/smoke-cloudsync.js` (§7).

## What is in the seed, and where each fact comes from

All sources are files in `C:\Users\hovig\projects\buyback-site` (the SubSell
website, subselltrade.ca) unless noted. Nothing is invented.

| key | value | source |
|---|---|---|
| `model` | `claude-haiku-4-5` | background.js DEFAULTS, options.html option list |
| `businessName` | SubSell | `src/lib/schema.ts:45-46` |
| `businessAddress` | 757 Rue Beaubien Est, Montréal (Rosemont – La Petite-Patrie), 30 s from Métro Beaubien | `src/lib/schema.ts:49-56`, `src/components/LocalSEOBlock.astro:37-38` |
| `businessHoursText` | 9AM–9PM, 7 days | `src/lib/schema.ts:321-330` (`Mo-Su 09:00-21:00`); the 22h→21h correction is commit 5c36145 |
| `businessHoursStart/End` | 9 / 21 | same — the extension's own default of 22 was wrong for this business |
| `businessInfo` | see the constant | facts drawn from `src/data/faqs.json` (cash rule :43, trade-in :76, iCloud lock :241, price lock :273), `src/pages/en/returns.astro:55-94` (no-deposit reservation, inspect before paying, 7-day exchange, 6-month warranty), `public/llms-comprehensive.txt:26-28,169-176,188-196` (what they buy, ID + IMEI checks, reviews), `src/lib/schema.ts:48` (phone) |
| `demoVideoUrls` | 3 clips | verified live in the public bucket `subsell-videos/<user id>/` — the two identically named 2025-09-30 WhatsApp files are duplicates (same size, uploaded 9 s apart), one is used |

### Left out on purpose

- **`instructions`, `closerGoals`** — background.js DEFAULTS already ship the real
  text; an absent key lets that text win (the dashboard's `EXT_DEFAULT_TEXT` rule).
- **`priceList`** — the only surviving numbers are the site's "starting from" list,
  which contradicts itself (iPhone 12 Pro Max $466 above iPhone 13 Pro Max $295 —
  `src/lib/buy-pricing.ts:36-56`, two formulas on one list) and a May-2026 buyback
  table. A bot quoting either would contradict itself in one thread. With no list
  the bot stays in its designed mode: no exact prices, best price in person.
- **`listings`** — `src/data/shop-inventory.json` is from 2026-05-08 with made-up
  quantities; a bot must not claim stock it does not have.
- **`coaching`, `examples`** — the grading history is gone and cannot be rebuilt.
- **`apiKey`** — see below.

### Wording rule carried over

The website bans repair / technician / diagnostic vocabulary (Google Ads
disapproved the account once for "Third-Party Consumer Technical Support" —
`scripts/verify-ai-corpus.mjs:66-71`). The seed uses none of it.

## What only the owner can still do

**1. Paste a new Anthropic API key.** A key that only ever lived in the row is
gone; Anthropic never shows a key twice. Make one at console.anthropic.com →
Settings → General → API key → Save. From v0.21.61 the account can no longer
be blanked by any machine.

**2. Possibly recover the ORIGINAL settings, key included — about $25.**
Supabase's own troubleshooting page says Free projects are still backed up
daily ("We are currently taking up to 7 daily backups that will be available
for you once you upgrade"). If a backup from before the wipe exists, the
documented "Restore to a new project" flow restores it into a separate,
throw-away project — the live one is never touched — and the old `config` can
be copied out with one SQL statement. Steps, in order:

1. **$0 check first.** Make a personal access token at
   https://supabase.com/dashboard/account/tokens, then:
   `GET https://api.supabase.com/v1/projects/tcqunihripihroseswgy/database/backups`
   with `Authorization: Bearer <token>`. If `backups[]` is empty, stop — upgrading
   buys nothing. If it lists a backup dated before the wipe, continue.
2. Upgrade the **organization** to Pro ($25/month; cancel after).
3. Dashboard → Database → Backups → **Restore to a New Project** → pick the
   backup from before the wipe.
4. In the NEW project's SQL editor:
   `select config from public.subsell_configs;` — copy the JSON.
5. Paste it into Settings → General → **⬆ Import config from file** (save the
   JSON to a file first) → Save. Every machine has it within a minute.
6. Delete the clone project. **Never** copy `config_key` — only `config`.

Do not delete or reset project `tcqunihripihroseswgy` while this is in play:
deleting a project deletes its backups.

**3. Run `config-safety.sql` once** (SQL editor). It keeps the last 20 configs
and refuses, in the database, to blank the key or the teaching — the only layer
that also protects against machines still on an old build.
