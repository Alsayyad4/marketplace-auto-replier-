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
- **Replied to its own messages (self-reply spam)** → role detection now uses which side the bubble is pushed to (`leftGap`/`rightGap`), not the bubble center (wide bubbles broke center). Plus a `recentSent`/`isOwnEcho` guard: never reply to a "last message" we just sent.
- **Duplicate/garbled sends** → `typeAndSend` clears the box first and **bails (won't send) unless the box exactly matches** the intended text.
- **Follow-up spam** → smart follow-up cap is read live from the conversation: count consecutive trailing "me" messages; `followupsDone = botTail - 1`; stop when `>= smartFollowupMaxCount` (max=1 ⇒ never more than 2 of our messages in a row). Per-chat, plus quiet-time gate.
- **Replied to Facebook system lines** → `isNoise()` filters "you can now rate", "X is waiting for your response", "automated suggestion", "add video to listing / update listing", "sent you a message", etc.
- **Re-sent the demo video** → `maybeSendVideo` marks the chat "sent" UP FRONT (before the flaky upload), so it never re-sends.
- **Clicked the mic** → `clickSend` skips voice/clip/mic-labelled buttons.
- **Wrong-thread context on slow loads / Remote Desktop** → `handleThread` waits for two identical transcript reads before acting.

## Gotchas
- Messenger uses a **Lexical** contenteditable; `execCommand` insert/delete works but is finicky — hence the "clear + verify exact match or bail" pattern in `typeAndSend`.
- Role/alignment is geometric and can break on layout/zoom changes — if self-replies return, revisit `readConversation()`.
- The operator runs on a **Chrome Remote Desktop** (laggy) with **one Chrome profile per Facebook account**.
- `enabled` (on/off), the local mp4 upload, rate-limit counters, logs, and `followUpState`/`videoSentThreads` are **per-machine** (chrome.storage.local), not synced.

## Build / test / ship
- No bundler. Validate: `node --check background.js content.js options.js popup.js docs/app.js`.
- Rebuild the download: zip the extension files into `dist/subsell-extension.zip` (everything except `docs/`, `supabase/`, `.md`, `dist/`).
- Operator installs via **Load unpacked** per Chrome profile; pastes the config URL or logs into Cloud sync.
- **Always test reply quality in the extension's Settings → Test responses (no Facebook) before going live**, then supervise the first few real chats.
- Commit + push to `claude/wizardly-noether-Oi6vP`.

## Likely next steps
- Keep hardening the live DOM reliability (Facebook layout drift).
- Optional: a "Test responses" tab + a cross-machine Activity log in the web app (not yet built).
