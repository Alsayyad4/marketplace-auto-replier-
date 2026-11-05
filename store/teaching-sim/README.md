# Teaching simulator (no API key needed on this PC)

The owner's teaching lives in the dashboard (Supabase), not in this repo. This folder holds
the Oct 21 2026 rewrite of it (`teaching.js`, rendered as `teaching-2026-10-21.md` for
copy-paste) and the harness used to test a teaching before it is pasted:

- `core.js` loads the chrome-free Try-it slice of `background.js` (same markers as
  `docs/app.js`) with a fake `fetch` that captures the request the extension would send.
- `node build.js settings.json scenarios.json out` writes `out/system.txt` (the exact system
  prompt) and one `<id>.user.txt` per scenario (listing line, owner's price line, clock, message).
- A model then answers each user turn under that system prompt (no key here: Haiku sub-agents
  played the model, one file per scenario, writing `out/replies-X.json` = `[{id, raw}]`).
- `node post.js settings.json out/replies-X.json` runs the extension's own `parseReply`,
  `metaVerdict` and `humanTouch`, then the content script's newline flattening, and prints what
  the buyer would receive plus checks (shop line, starting price, one question, emoji count, a
  leading "yes", dollar amounts).
- `node teaching.js` writes `settings.json` from `teaching.js`; `node render.js` prints the
  copy-paste markdown.

Facts of the pipeline that shaped the teaching (verified in code, Oct 21 2026):
- `typeAndSend` turns every line break into a space: a list must be written on one line.
- `humanTouch` keeps only the FIRST picture emoji per message; keycap digits (4️⃣) survive.
- `ownerEntryFor` matches price-list LINES to the listing by model number + qualifiers, so the
  price list is one model per line ("iPhone 13 Pro" never matches a "13 / 13 Pro / 13 Pro Max" line).
- The memory note (cloud login) says "you already told them the address… do not repeat"; the
  teaching overrides it for the shop line on purpose (the owner's every-message rule).
- `offPlatformGuard` ON forbids phone numbers in the prompt itself; it must be OFF for the
  keycap number to be sent.
