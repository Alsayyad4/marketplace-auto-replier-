# SubSell marketplace auto-replier — read HANDOFF.md first (KEEP SHORT: loads every turn)

Chrome MV3 extension (content.js runs in messenger.com; background.js = service worker +
all chrome.debugger/CDP work) + Supabase dashboard in docs/. Live branch:
`claude/wizardly-noether-Oi6vP` — main is stale, never merge main over it.

## Standing rules (Sep 11 2026 "virus / random files" incident)
- Anything that clicks Messenger UI, focuses/moves windows, opens PiP, or adds
  permissions ships OFF by default behind a cloud setting and goes to ONE machine first.
- The operator wants zero manual steps in normal operation.

## Known state (v0.21.70)
- SAVES (.70): config-safety.sql v0.21.61 blocked EVERY save on a live account from
  Sep 22 to Sep 29 2026 — the guard trigger ran as the caller and the history table
  had no INSERT policy, so the dashboard said "Not saved … subsell_config_history",
  every extension push failed behind "Saved ✓", and the .69 disarm never landed.
  Fixed SQL = SECURITY DEFINER + non-fatal snapshot. **PASTED by the owner Sep 29 2026** (history count=1 verified) — the dashboard now hands it
  over itself on that error (copy button + SQL-editor link) and keeps refused
  teaching as a browser draft. Never ship a trigger that can refuse a save.
  `store/smoke-sqlguard.js`.
- Demo LINK (.69): the current build has NO link sender (deleted .60). Links a buyer
  still receives come from machines stuck on v0.21.47-.51 (self-updater dead there),
  gated on `videoLinkFallback !== false` read from the SHARED account row. Fix = the
  row: all DEFAULTS now `false`, every outgoing write (push, sync mirror, restore,
  dashboard save) carries `LEGACY_LINK_OFF`, `disarmLegacyLinkInCloud(held)` compare-
  and-sets the four keys into the row after a pull whose held copy is still armed
  (stores nothing locally; the fixed row comes back through the guarded pull), and the
  dashboard does the same on open. Unreachable: a stale machine whose cloud session
  died (frozen copy) — needs a re-login or Load unpacked. Never ship `true` again;
  `store/smoke-linkoff.js`.
- Teaching (.68): `buildSystemPrompt` puts the owner's text first with a stated
  authority order, renders Activity-tab RULES at the top as orders (not as
  corrections), adds a silent BEFORE-YOU-WRITE lookup step, and `nowLine()` puts
  the clock in the USER turn only (system prompt stays byte-identical = cache).
  `store/smoke-prompt.js` locks this in. Operator: engine + video untouched.
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
