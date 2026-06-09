# SubSell — Handoff (read this first if you're a new session)

This is the context to continue work on SubSell without re-discovering everything.
Active branch: **`claude/wizardly-noether-Oi6vP`**.

## What it is
A **Chrome MV3 extension** that auto-replies to Facebook **Marketplace** buyer
messages with the Anthropic API (FR/EN, casual Québec tone), **plus** a **Supabase
web dashboard** to manage all settings centrally so one change reaches every
computer/Facebook account.

- The **extension** does the real work (reads/types in messenger.com). A web app
  legally cannot touch another site's tab, so the bot MUST be an extension.
- The **web app** (in `docs/`, hosted on GitHub Pages) is the control panel.
- Settings live in **Supabase**; the extension reads them two ways (either works):
  1. **Cloud sync login** (email/password in Settings → General) — pulls every ~1 min.
  2. **Remote config URL** — paste the per-user config URL; pulled every ~10 min.
     The URL is served by the **Edge Function `subsell-config`**.

## Live deployment (the operator's project)
- Supabase project ref: `tcqunihripihroseswgy` (URL `https://tcqunihripihroseswgy.supabase.co`).
- Publishable/anon key is baked into `docs/config.js` and `background.js` (public by design).
- DB: table `public.subsell_configs` (`user_id`, `config` jsonb, `config_key`, `updated_at`) — see `supabase/schema.sql`.
- Edge Function `subsell-config` (`supabase/functions/subsell-config/index.ts`), **Verify JWT = OFF**, serves `config` by `?key=`.
- Storage bucket `subsell-videos` (public) for central demo videos — see `supabase/storage.sql`.
- Dashboard: `https://alsayyad4.github.io/marketplace-auto-replier-/docs/` (Google or email login).
- ⚠️ This Supabase project is **shared with another app**, so everything is namespaced `subsell_*` — never use generic names like `configs` or a generic `on_auth_user_created` trigger.

## Key files
- `background.js` — service worker: Anthropic calls, `buildSystemPrompt()`, `DEFAULTS` (source of truth for settings), config priority (managed → cloud → remote link → sync → local), `GET_REPLY_SIMPLE`, `GET_FOLLOWUP` + `callClaudeFollowup`, cloud auth/pull/push, `parseReply` + `stripReasoning`.
- `content.js` — the DOM side: `readConversation()` (role by left/right gap), `buyerSpokeLast()`, `botTailCount()`, `handleThread()`, `typeAndSend()`, `injectVideo()`, `maybeSendVideo()`, `maybeFollowUp()`, the `scan()` loop (guarded by `busy`).
- `options.html`/`options.js` — extension Settings (mirrors the web app + Cloud sync/Remote URL plumbing + Test responses + Activity log).
- `docs/` — web dashboard (`index.html`, `app.js`, `config.js`). `SETTINGS-REFERENCE.md` is the authoritative tab/field list; the dashboard mirrors it 1:1 with the extension (verified by diff).
- `SPEC-webapp.md` — the config-JSON contract. `supabase/README.md` — backend deploy steps.

## Bugs already fixed (do NOT regress these)
- **Reply leaked the model's reasoning** ("…her real question was… ---") → strong CRITICAL output rule in `buildSystemPrompt` + `stripReasoning()` safety net in `parseReply`.
- **Replied to its own messages (self-reply spam)** → `looksLikeOurBubble()` is now **tri-state**: `true` (blue/gradient bubble = ours) / `false` (neutral-gray = the buyer's) / `null` (unknown). In `readConversation` pass 2: `isOwnEcho || true ⇒ "me"`, `false ⇒ "buyer"`, `null ⇒` geometry only if it CLEARLY hugs the left, **else "me" (stay silent)**. The core rule: **a message is the buyer's only with positive evidence; ambiguity is treated as ours so the bot can never reply to itself.** Theme-agnostic (works in dark mode).
- **Self-reply / re-reply survives reloads** → `recentSent`, `cooldowns`, `lastHandled` are **persisted to chrome.storage.local** and hydrated at boot (`persistDedup()`), so a content-script reload no longer re-arms those bugs.
- **Duplicate/garbled sends** → `typeAndSend` inserts the whole message once, compares with an **invisible-char-tolerant** normalizer (so a correct long reply isn't falsely rejected and silently dropped), **sends once**, waits 5 s, and **only escalates to the Send button if the box still holds exactly our text** — never blind-resends. `pressEnter` = keydown only, `shiftKey:false`. `clickSend` only clicks a real Send control (never mic/like/sticker; EN+FR labels).
- **Follow-up spam** → smart follow-up cap is read live (`botTailCount`); `followupsDone = botTail - 1`; stop when `>= smartFollowupMaxCount`. The **`SEND_FOLLOWUP` alarm path now enforces the same cap + `rememberSent` + cooldown** (previously it bypassed the cap — could post a 3rd consecutive bot message).
- **Replied to Facebook system lines** → `isNoise()` filters EN **and FR** system lines (e.g. "attend votre réponse", "suggestion automatisée", "vous a envoyé un"); short tokens use `NOISE_EXACT` (exact match) so real buyer messages like "Sent it yet?" aren't dropped. Quick-reply preset buttons are skipped structurally via `[role="button"]`.
- **Re-sent the demo video** → `maybeSendVideo` uses an **atomic claim** (write `videoSentThreads[id]`, re-read, verify we own it) so two passes/tabs can't both send; `chatAlreadyHasOurVideo()` tests side vs the **composer-column midpoint** (panel-proof, not window center); `injectVideo` only presses Enter when a preview actually attached and **confirms by preview-detach**.
- **Clicked the mic** → `clickSend` skips voice/clip/mic AND like/sticker/gif buttons.
- **Re-entrancy** → `scan()` sets `busy=true` synchronously before any `await` (no check/set gap).
- **Cross-tab double-send** → a per-threadId **storage lease** (`acquireThreadLock`/`releaseThreadLock`, `threadLocks` in chrome.storage.local, last-writer-wins + `LOCK_MS` stale timeout, `TAB_UID` per instance) wraps `handleThread` and the `SEND_FOLLOWUP` handler, so two Messenger tabs in one profile can't process the same chat at once.
- **Wrong-thread context on slow loads** → `handleThread` waits for two identical transcript reads before acting.

## Gotchas
- Messenger uses a **Lexical** contenteditable; `execCommand` insert/delete works but is finicky — hence the "insert once + invisible-tolerant verify + send once" pattern.
- Sender detection is now **color-first** (blue/gradient = us, gray = buyer) with geometry only as a last resort and **bias-to-silence on ambiguity**. If self-replies ever return, the color thresholds in `looksLikeOurBubble` likely need tuning to the current Messenger theme (log a known own-bubble and buyer-bubble `getComputedStyle().backgroundColor`/`backgroundImage`).
- The operator runs on a **Chrome Remote Desktop** (laggy) with **one Chrome profile per Facebook account**.
- `enabled` (on/off), the local mp4 upload, rate-limit counters, logs are **per-machine**; `cooldowns`/`lastHandled`/`recentSent`/`videoSentThreads`/`followUpState` are persisted per-machine (keyed by threadId).

## Deferred / known remaining (from the 3-agent audit, not yet implemented)
- **Avatar/attribution as the positive buyer signal (audit 1, finding 6):** color is the current positive buyer signal; the buyer's row-start avatar / "· Buyer" attribution would be even more robust but the exact selectors must be verified against the live messenger.com build (FB obfuscates classes).
- **`FETCH_VIDEO` base64 over messaging (audit 2, D2):** large mp4s are base64'd through `chrome.runtime` messaging; size-cap or switch to blob-URL for big files.

## Build / test / ship
- No bundler. Validate: `node --check background.js content.js options.js popup.js docs/app.js`.
- Rebuild the download: zip the extension files into `dist/subsell-extension.zip` (everything except `docs/`, `supabase/`, `.md`, `dist/`).
- Operator installs via **Load unpacked** per Chrome profile; pastes the config URL or logs into Cloud sync.
- **Always test reply quality in the extension's Settings → Test responses (no Facebook) before going live**, then supervise the first few real chats.
- Commit + push to `claude/wizardly-noether-Oi6vP`.

## Likely next steps
- Keep hardening the live DOM reliability (Facebook layout drift).
- Optional: a "Test responses" tab + a cross-machine Activity log in the web app (not yet built).
