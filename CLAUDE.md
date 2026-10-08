# SubSell marketplace auto-replier — read HANDOFF.md first (KEEP SHORT: loads every turn)

Chrome MV3 extension (content.js runs in messenger.com; background.js = service worker +
all chrome.debugger/CDP work) + Supabase dashboard in docs/. Live branch:
`claude/wizardly-noether-Oi6vP` — main is stale, never merge main over it.

## Standing rules (Sep 11 2026 "virus / random files" incident)
- Anything that clicks Messenger UI, focuses/moves windows, opens PiP, or adds
  permissions ships OFF by default behind a cloud setting and goes to ONE machine first.
- The operator wants zero manual steps in normal operation.

## Known state (v0.21.81)
- THE STORE BUILD (.81, Oct 8 2026): `dist/subsell-webstore.zip` from
  `store/build-webstore-zip.ps1` + `store/webstore-manifest.js` (no `key`, four hosts,
  same version); `STORE_BUILD` (background.js) = the manifest has an `update_url` (a store
  install) → the folder updater stands down (`cloudSelfUpdate` → `{store:true}`,
  `selfUpdateCheck` no-op), popup/🩺 say so. Unlisted item; per computer: install from the
  link → Options → Log in → remove the old unpacked entry. `store/STORE-SUBMISSION.md` is
  the walkthrough; the upload needs the owner's Google account ($5 once) — NOT done yet.
  The teaching was never erased (verified in the row + history, Oct 8): "erased" = the
  5-day Activity feed or a computer's own Settings page; "ignores the teaching / double
  videos" = the computers stuck on builds older than .73/.77. `store/smoke-store.js`.
- THE CALM COMPUTER (.80, Oct 8 2026: "opening tabs to upload the videos … we can't even
  use the computer … we can't even close the tabs"): the heartbeat's un-minimize (.44) and
  the tab reopen (.18) were the on-screen habits. Now `ensureMarketplaceTab` asks
  `calmReopenDecision` (a tab a person closed stays closed 3 h, until 07:00 after a second
  close the same day — `tabs.onRemoved` on a known Messenger tab → `tabClosed`; never while
  a person was seen in 15 min), the un-minimize is OPT-IN (local `keepWindowsRestored ===
  true`, Options → Power features) via `calmRestoreDecision`, `videoForeground` is refused
  for a person, the tab-switch/cascade helpers stop for a person. A person = focus / tab
  events the bot did not make (`noteHuman`, `botActing(ms)` before every own
  windows/tabs update) + trusted input on the Messenger page (content `HUMAN_SEEN`, never
  while `busy`). A minimized window keeps replying on TICK_NOW + the .67 gate. Popup row
  "Computer"; 🩺 `calm:` line. `store/smoke-calm.js`. Never bring back a default-on
  window/tab habit. RETENTION: `supabase/retention.sql` (pg_cron hourly: feed 5 days,
  teach/usage 35, video 60) applied Oct 8; `deploy/supabase-heal.mjs --retention --purge`.
  COMPUTE: Micro since Oct 8 12:20 Z (`--upgrade`, PATCH not POST).
- THE DEAD KEY + THE SECOND DOOR (.79, Oct 7 2026: "Activity log ✗ HTTP 404 {"error":"not
  found"}", "API key NOT set", "cloud sync frozen"): the 404 is subsell-log's — the cached
  `configKey` matched no row (dashboard "Regenerate key" / a changed account) and was never
  re-read. Now the key rides on every full pull (`adoptRowKey(row, user)`; select
  `config,updated_at,config_key` — keep that order, the harnesses match on it) and carries
  its OWNER (`configKeyUser`: the login's user id, "" for a pasted URL); a key not tied to
  the login is re-read with one full fetch; `cloudLogin` drops a foreign key; only the
  functions' own 404 body {"error":"not found"} is a dead key (`deadKeyAnswer` →
  `dropConfigKey` → `configKeyDead`; 🩺 `logKey=DEAD`); the mirror looks it up once and
  re-sends. SECOND DOOR: a login that exists but cannot refresh pulls the settings through
  `subsell-config?key=` (`cloudPullViaKey`: THIS login's key only, 5-min pace, 20-s
  timeout, no /token; the shared `applyPulledConfig(cfg, stamp, force, via)` keeps the wipe
  guard; heal/seed never through the key; shut after Log out; a late answer after the login
  came back is dropped; breadcrumb `cloudKeyDoor` — `okAt` is zeroed by ANY failure, the
  popup claims only from it), and the chat memory reads through subsell-log `read`
  (`memFetch({q, read})` / `memKeyDoor`: same owner rule, 2-min back-off after a
  timeout/5xx; needs the .79 function, else `memStats.keyUnsupportedAt`, asked again
  hourly). Both functions rewritten with NO imports (plain REST + service role, 10-s db
  timeout → 504 "db timeout") + key-first + `read` — DEPLOYED Oct 7 23:58 Z
  (`npx --yes supabase functions deploy <fn> --project-ref tcqunihripihroseswgy --no-verify-jwt`,
  the owner's access token, chat switched out of Auto mode first — the classifier refuses
  production actions in Auto). Mirror POST 25-s abort. Oct 7 21:30–23:56 Z the PROJECT (Nano
  compute) went Unhealthy, every service down, the fleet on local copies;
  `deploy/supabase-heal.mjs --restart` (Management API) healed it in ~4.5 min; such an outage
  looks like "offline" waits + "✗ no answer from subsell-log in 25 s" on every computer —
  probe PostgREST WITH the public key before blaming the code; Micro compute is the standing
  recommendation (`--upgrade`, the owner's money). `store/smoke-keydoor.js`, `store/smoke-edgefns.js`. Never add a
  third door: every /token call still goes through `cloudValidAuth` / `cloudLogin`.
- LOGIN STORM (.78, Oct 7 2026: "cloud sync frozen" + "Request rate limit reached"):
  Supabase Auth's /token budget is per INTERNET ADDRESS (150 / 5 min) and shared by
  refreshes AND password logins; the old `cloudValidAuth` retried a failed refresh on
  every call on every Chrome, and the dashboard's `signOut()` (default scope global)
  ended every computer's login. Now: refresh 10 min ahead IN THE BACKGROUND (a caller
  with a valid token never waits), one at a time (20-s timeout), a persisted wait after
  a refusal (`cloudAuthHold`: limited 2→15 min, offline 30 s→5 min, error/409/5xx
  1→10 min, ended — only on GoTrue's "gone" codes — 30 min→2 h), nothing sent while
  waiting except one try per 15 s for a click (Save / Restore / Pull now);
  popup/Settings say which wait and whether it ends by itself; a rate-limited login
  retries itself while Settings stays open (one countdown ever: `loginGen`); Log out
  asks first; dashboard signs out `scope: "local"`. 🩺 ` tok= auth=`.
  `store/smoke-authcalm.js`, `store/smoke-loginretry.js`. Every /token call
  must go through `cloudValidAuth` / `cloudLogin` — never add another.
- VIDEO DOUBLES FIXED AT THE ROOT (.77, Oct 6 2026, from PC-dodu3's 🩺): the btn
  channel's page shim (`pageArmFileShim`) was RENEWED, not rebuilt, when the next clip
  armed inside its 20-s life, and handed Messenger the PREVIOUS clip again — clip 3 of
  every set went out as a second clip 2 (`rx:o0…` on clip 3), clip 1 twice or three
  times when no reply separated clips 1-2. Now one arm = one fresh shim with its own
  clip, delivered once; an old shim's timer cannot unhook a new one; never a fall-
  through to the native click (= a Windows dialog). Evidence: btn `[rearm=N]`, trace
  ` dup:clipK`, memory `videoBlind=`. The .76 "zero reaction ⇒ unverified" rule must
  NOT ship. Real-Chrome harness pattern: HANDOFF .77.
- HOURS (.75): buyers are answered 24/7. `withinBusinessHours` gates a reply only when
  `replyWindowOnly` (NEW key, default off) is on; the OLD `businessHoursEnabled` is read
  by nothing here but is `true` on every live row and gates the builds before .75, so
  the dashboard writes it `false` on every save (`LEGACY_GATE_OFF`) and once on open
  (`legacyGateArmed`). The two hour fields now window the messages the BOT STARTS:
  `withinNudgeHours` (smart follow-up) and the alarm handler, which PARKS a follow-up /
  visit alarm due at night (`nextNudgeWindowStart`) instead of dropping it. 🩺
  `replies=24/7 nudges=9-22`. EVIDENCE for the video complaint (do not fix blind — three
  fixes already did): the teaching receipt carries `mem=on|off` (cloud login → can read
  the Activity log; a `mem=off` computer re-answers and re-sends clips, the fleet line
  names it); the Videos tab has "Where the videos went" (`videoReport`: double-served /
  short chats, incl. the structural case — `memVideoSent` is binary per chat, so a set
  left at 1/2 by one computer is never completed by another); the toolbar "Copy report"
  button gathers everything support needs as text, no key. `store/smoke-hours.js`.
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
