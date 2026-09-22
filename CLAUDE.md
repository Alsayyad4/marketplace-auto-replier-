# SubSell marketplace auto-replier — read HANDOFF.md first (KEEP SHORT: loads every turn)

Chrome MV3 extension (content.js runs in messenger.com; background.js = service worker +
all chrome.debugger/CDP work) + Supabase dashboard in docs/. Live branch:
`claude/wizardly-noether-Oi6vP` — main is stale, never merge main over it.

## Standing rules (Sep 11 2026 "virus / random files" incident)
- Anything that clicks Messenger UI, focuses/moves windows, opens PiP, or adds
  permissions ships OFF by default behind a cloud setting and goes to ONE machine first.
- The operator wants zero manual steps in normal operation.

## Known state (v0.21.67)
- The periodic alarms are `ensureAlarm()` (create-if-absent): a top-level
  `chrome.alarms.create` re-ran on every worker wake and reset the 10-min updater
  and remote-config alarms forever. Machines still on ≤ .50 must update ONCE by hand
  (popup → Update now) before they can self-update again.
- Video retry: `blindTries` must survive the pre-send rebuild or the bounded retry
  never ends. Attach failures are `why="blind"`, not `"attach"`. There is NO link
  fallback any more (.60/.66): a video is a file or nothing.
- Video attach (.67): a HIDDEN page that has never played media gets every media load
  parked by Chrome (`prerender::DeferMediaLoad`; user activation is NOT a term of it),
  and Messenger decodes a clip before staging it. `ensureMediaGate()` (content.js, top
  of `attachVideo`) probes the gate with a tiny WAV and primes the frame by playing a
  silent MediaStream — proven by re-probe, never assumed. `videoMediaPrime` is the one
  video helper that ships ON (invisible; local off switch). A MAIN-world reaction probe
  says whether Messenger READ the clip (`rx=`); read-but-unstaged is "unverified", never
  "none". `videoActivationPulse` (F16 key via CDP) is an OFF experiment.
- Diagnose ONLY from a pasted 🩺 block. Read `vis=`, `gate=`, `primed=`, `rx=`, `pile=`
  first. Channel stats read d/t/b/n/u (dispatched, tile, blind, none, unverified) +
  `[rx:… held]` + `[picker:…]`. `persistentInput=none` = Messenger's file input not found.

## Cheap work
- Read with `grep -n` / `sed -n` ranges; the two JS files are 8k lines — never dump them.
- `node --check <file>` before any commit. No multi-agent workflows.
