# SubSell marketplace auto-replier — read HANDOFF.md first (KEEP SHORT: loads every turn)

Chrome MV3 extension (content.js runs in messenger.com; background.js = service worker +
all chrome.debugger/CDP work) + Supabase dashboard in docs/. Live branch:
`claude/wizardly-noether-Oi6vP` — main is stale, never merge main over it.

## Standing rules (Sep 11 2026 "virus / random files" incident)
- Anything that clicks Messenger UI, focuses/moves windows, opens PiP, or adds
  permissions ships OFF by default behind a cloud setting and goes to ONE machine first.
- The operator wants zero manual steps in normal operation.

## Known state (v0.21.52)
- The periodic alarms are `ensureAlarm()` (create-if-absent): a top-level
  `chrome.alarms.create` re-ran on every worker wake and reset the 10-min updater
  and remote-config alarms forever. Machines still on ≤ .50 must update ONCE by hand
  (popup → Update now) before they can self-update again.
- Video retry: `blindTries` must survive the pre-send rebuild (content.js ~2973) or the
  link fallback is unreachable. Attach failures are `why="blind"`, not `"attach"`.
- Diagnose ONLY from a pasted 🩺 block. Channel stats read d/t/b/n/u (dispatched, tile,
  blind, none, unverified). `persistentInput=none` = Messenger's file input not found.

## Cheap work
- Read with `grep -n` / `sed -n` ranges; the two JS files are 8k lines — never dump them.
- `node --check <file>` before any commit. No multi-agent workflows.
