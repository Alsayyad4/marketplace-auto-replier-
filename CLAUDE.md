# SubSell marketplace auto-replier — read HANDOFF.md first (KEEP SHORT: loads every turn)

Chrome MV3 extension (content.js runs in messenger.com; background.js = service worker +
all chrome.debugger/CDP work) + Supabase dashboard in docs/. Live branch:
`claude/wizardly-noether-Oi6vP` — main is stale, never merge main over it.

## Standing rules (Sep 11 2026 "virus / random files" incident)
- Anything that clicks Messenger UI, focuses/moves windows, opens PiP, or adds
  permissions ships OFF by default behind a cloud setting and goes to ONE machine first.
- The operator wants zero manual steps in normal operation.

## Known state (v0.21.74)
- LEARNING WITHOUT CODE (.74). Teaching never needs a code change: Business tab +
  Activity tab reach every computer in ~1 min. What .74 added — (a) NOTHING DROPPED:
  rules are never evicted (61st refused out loud), the 120 newest graded answers are
  kept (docs/app.js `trimCoaching`); the sheet carries every rule + the newest 30
  answers, and `lessonFor` recalls older ones by SUBJECT (`lessonKeys`, FR/EN table
  `LESSON_SUBJECT`) beside the buyer's message; a 👎 left unchanged teaches nothing
  (`coachUsable`). (b) `[GAP]` token: the bot marks a reply when the owner's text had
  no answer; `parseReply` strips it (any spelling); hidden row kind `gap` → dashboard
  "teach these" list. (c) TRY IT box (Business tab): the dashboard fetches
  `../background.js` and runs the slice between the comments `/* ===== (v0.21.73) THE
  OWNER IS THE ONLY TEACHER` and `/* ---- video fetch ---- */` — **those two comments
  are a contract, and the code between them must stay free of `chrome.*`**.
  (d) ECONOMY: `postClaude` sends the 1-hour cache marker (falls back to 5-min on a
  400, remembered a week); it only works when the sheet reaches the model's minimum
  (4096 tokens on Haiku 4.5, 1024 on Sonnet 4.6); `aiUsageNote` meters the API's own
  usage numbers (🩺 `usage:`; hidden rows kind `usage`; dashboard bill + per-model
  estimate under the model list). Hidden Activity kinds: claim, teach, gap, usage
  (`HIDDEN_KINDS` / `messagesOnly`). `store/smoke-learn.js` + smoke-teach §7–10.
- TEACHING (.73): THE OWNER IS THE ONLY TEACHER. `ownerTeachingOnly` (a NEW key, default
  on) → `buildOwnerPrompt` (background.js): the owner's sections first, in tags (info,
  instructions, rules, corrections, prices, listings, closing goal, examples), a contract
  ("this text is all you know; a gap is 'best confirmed at the shop', never a guess"),
  then mechanics only — NO playbook, NO phrasebook, and an unwritten Instructions /
  Closer-goals box is one neutral line (`settings.ownerWrote`, set by getSettings), never
  this file's DEFAULTS text. Off = the .72 prompt byte for byte. `lessonFor` puts a graded
  lesson whose buyer text matches the incoming message beside it in the USER turn.
  THE CHAT'S TITLE ("Name · listing headline") is no longer read as a line of the chat:
  content.js `labelLike` drops UNPAINTED title blocks at the read (`legacyKey` keeps
  older dedupe keys valid — an update must never re-answer a chat); background
  `isChatTitle` / `dropTitleLines` is the second wall. Every machine reports the code of
  the teaching it answers with (`noteTeaching` → hidden Activity row kind "teach"); the
  dashboard computes the same code (`teachingFingerprint`, mirrored in docs/app.js) and
  names the computers that are behind. A dashboard save that loses the stamp race MERGES
  (`saveMerged`: fields edited here win, lists merge item by item) instead of dropping
  into a draft, and 👍 / Save lesson / Teach it show the real save result.
  `store/smoke-teach.js`, `store/smoke-merge.js`. 🩺 `teaching:` line (mode, fp, sizes);
  open chat `title=known dropped=N`. Field-unverified: judge from Activity rows.
- CLIPS (.72): each chat has a CLIP LEDGER (`videoClips[chatId] = {s, t}`: sent /
  handed over unconfirmed, by clip identity `clipIdsOf` — helper block above
  `maybeSendVideo`, `store/smoke-clips.js`). The loop steps over held clips
  (`heldAt`); a served chat that owes a NEVER-ATTEMPTED clip is topped up on the
  buyer's next message only (`keyFlow`, needs `clipLedgerTrusted`); an unconfirmed
  first clip later seen in the chat (DOM stop or watcher) is credited and the REST of
  the set resumes (`noAdopt` marker) instead of the chat closing at 1 of 2; a stuck
  last clip gets an adopt visit. An attempted-unconfirmed clip is still NEVER
  re-dispatched. The dashboard's video list SAVES ITSELF on upload/remove and shows
  sizes; every machine pre-downloads new clips (`prewarmDemoClips`). Switch:
  `videoCompleteSet`. 🩺 `clips:` line. The popup's Resend also clears the ledger.
- MEMORY (.71): the Activity log (`subsell_messages`) is READ BACK per chat before every
  reply and video (`memThreadRows` → `memVerdict` / `memVideoSent` / `memoryLine`,
  background.js; `store/smoke-memory.js`): a message another computer answered is
  skipped, our own text read as the buyer's is skipped, a video any computer sent (or
  this one before a wipe) is never re-sent (`via:"cloud"` mark; every "served
  elsewhere" stop also sweeps this machine's own leftover tile + retry state), two
  computers on one account settle a new message with a hidden `kind:"claim"` row
  (earlier `created_at` wins; withdrawn on a failed model call, never written by a
  machine whose last call failed, dead once its text row lands), and the model is
  told what it already said (facts/openers/video, user turn only — system prompt
  still byte-stable). The text Activity row is now written ON DELIVERY by
  content.js, not at generation. `typingPaceMaxSec` (20) adds a length-proportional
  typing wait from `wpmMin..wpmMax`. `threadMemory` is the switch; the popup's
  "Resend video to OPEN chat" overrides the memories for 10 min. Needs the cloud-sync
  login; 🩺 `memory:` line must read `reads>0 fails=0`.
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
- Playbook prompt (.68 — since .73 ONLY when `ownerTeachingOnly` is off): owner's text
  first with a stated authority order, Activity RULES at the top as orders, a
  BEFORE-YOU-WRITE lookup step, the 12-move closer playbook, the phrasebook padding to
  Haiku's 4096-token cache floor. `nowLine()` puts the clock in the USER turn only (both
  modes). `store/smoke-prompt.js` locks this mode in.
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
- Shell trap on the owner's PC: a Bash heredoc turns two backslashes into one, and the
  Write tool turns a `\u` escape into the character itself. Spell such strings with
  `String.fromCharCode(...)` or a `\p{...}` class, and grep the diff for backslashes.
  `git stash` / a checkout rewrites the working files as CRLF (autocrlf): do not stash;
  if it happened, turn the modified files back to LF with node before testing or zipping.
