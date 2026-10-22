# AUTOLISTER — the plan, v2 (read this first, then take ONE work package)

Written 2026-10-21 by the planning session (Fable), revised the same evening after a
five-reader verification against the code (every file:line below was checked). Owner: Hovig
(SubSell). He calls the listing tool "autolister". This file is the contract between the
sessions that build it. Each session takes one work package (WP), touches only that package's
files, and edits only its own line in the Board (section 16). Nothing in `lister/` existed
before this plan; nothing the extension already does is changed by it.

How a session starts:

    cd C:\Users\hovig\projects\marketplace-auto-replier      (branch claude/wizardly-noether-Oi6vP)
    read CLAUDE.md, then this file: sections 1–5 (the rules and the contracts), then YOUR WP in section 9
    ls lister store/fixtures/marketplace    — trust what is on disk, not the Board
    node --check <every file you wrote>  ·  node store/smoke-lister-*.js  ·  commit BY PATH (git add <your files>)
    never git stash, never touch content.js, never edit a file another WP owns, never run the replier's
    live suites with a Messenger tab in use

---------------------------------------------------------------------------------------------

## 0. The ask, in the owner's words

1. "When Marketplace listings are open I want to select them and press **Rebuild**: the same
   ones get deleted and posted again, to get more visibility. Delete and relist, just ticking
   and pressing a button."
2. "From the extension, **create a listing**, or many listings with something in between so it
   is automated. I put the headline, the pictures and all the fields Marketplace has; the
   **tags fill themselves** by category (iPhone, iPad, computer, tablet, laptop, MacBook,
   Samsung…). Headlines and descriptions are **saved**; I will prepare 100 of each per
   category and we choose from them, but I can still change them. Follow the Marketplace
   fields exactly."
3. Plan it so other sessions can build different branches of the tree in parallel.

## 1. Decisions (do not reopen these without the owner)

- **Where: inside the live extension** (`marketplace-auto-replier`, the Web Store item
  `ipompokpmlhgaioihnlbnmnhendcnejo`), as a new folder `lister/`. It already runs in the
  signed-in Chrome of every seller's computer, updates itself from the store, has the cloud
  login, the machine id, the Activity log and the dashboard. The Playwright "autolister" in
  `projects/subsell-marketplace-poster` stays as it is: its FORM KNOWLEDGE is ported here
  (section 9, WP-B/WP-C port checklists), its code is not reused.
- **The replier is not touched.** `content.js` gets zero edits. The lister is its own
  content-script list (six small files), its own service-worker module loaded by one guarded
  `importScripts` line, its own tables, its own dashboard pane. A lister bug must never reach
  a buyer conversation — that is why the import is wrapped (section 10.2) and why the lister's
  top level only defines functions and registers listeners.
- **content.js ALREADY runs on every `facebook.com/marketplace/*` page** (manifest.json:46;
  content.js:5588 treats them as bot pages). The lister shares those pages and the same
  isolated world with it, so: every lister file is one IIFE writing into
  `globalThis.SubSellLister.*`; the lister never answers `PING`, `TICK_NOW`, `PAUSE_SCANS`,
  `RESUME_SCANS`; its router returns `other` for `/marketplace/inbox`, `/marketplace/t/…`,
  `/marketplace/?…` and anything that is not {you/selling, create/item, item/<id>, edit}; its
  synthetic events never trigger content.js's `HUMAN_SEEN` (that needs `isTrusted`).
- **OFF by default, one machine first** (the Sep 11 rule): the lister acts only when the
  account switch `lister.enabled` (cloud, dashboard) AND the local switch
  `listerOnThisComputer` (Options → Power features) are both on. A third local switch
  `listerDryRun` ships ON: the first real run is a deliberate flip. The shop PC goes first.
- **One record, three editors.** A Listing is one JSON object (section 4) in
  `subsell_listings`. The composer page, the dashboard pane and the capture of an existing
  Facebook listing all produce the same object. The engine only ever reads that object.
- **Photos are bytes in our bucket, never Facebook URLs.** `subsell-photos`, path
  `<user_id>/<listing_id>/<n>.jpg`, every photo re-encoded to JPEG ≤ 1600 px (phones send
  HEIC). A captured listing's photos are fetched as bytes and uploaded BEFORE its delete;
  Facebook's CDN URLs are signed and expire within hours.
- **Capture → confirmed cloud save → delete, in that order, always.** The delete needs a
  confirmed cloud write (the PATCH answers with the row, re-read once). Cloud down = nothing
  deleted, the bar says so. A copy that lives only in `chrome.storage.local` is not a copy.
- **A press is written before it is pressed.** Before Publish and before the Delete
  confirmation, the content script asks the engine to persist "pressing" and waits for the
  ack. A press whose outcome is unclear → `needs_review`, never retried by the engine.
- **The same item, not the same bytes.** A Rebuild re-posts with the NEXT headline and
  description from the library and a reordered photo set (new cover), after a delay of
  45–90 min following the delete. Identical title + text + photos re-posted minutes after a
  delete is the duplicate pattern Facebook's spam detection targets (the poster README
  records a 30-day first strike since May 2026). A listing younger than 7 days is skipped
  unless the owner forces that one listing (logged).
- **Pace is per ACCOUNT, not per computer.** Facebook judges the account. The ledger of
  record is `subsell_lister_actions` (cloud); the local ledger is a cache; a block hold is
  written to the account's settings and honoured by every computer. Defaults are the
  poster's (section 5.3) and stay settings.
- **The owner's click is the permission; the owner's tab stays his.** Start on the bar or
  Save & queue in the composer lets the engine open ONE helper tab of its own (background,
  next to the clicked tab, wrapped in `botActing`), drive it, and park it on "Your listings"
  when the queue drains. The engine never closes a tab and never focuses one. A timer that
  acts with nobody present (`autoRefreshDays`) is v2 and needs the `unattended` setting.
- **Rebuild first, composer second, phone third.** 0.22.0 = Rebuild (WP-B, C, D, F);
  0.22.1 = the composer page (WP-E1); 0.22.2 = the dashboard pane (WP-E2). The composer's
  first real post then runs on a form driver that has already relisted real listings.
- **Renew is offered, not forced.** A small "Renew (free)" chip appears on cards where
  Facebook itself shows Renew. The smart "Renew if offered, else Rebuild" default and the
  "auto every N days" timer are v2 (core's `planRefresh` already exists for them).
- **Facebook's form is only known from reading, never from running** (both projects: nothing
  has ever been posted). Every driver step reads back what the page holds, every miss writes a
  *form atlas* (labels, roles, buttons, counts — never what was typed) to the Activity log,
  and the first real run is a rehearsal (`listerDryRun`) on the shop PC.

## 2. What stays untouched, and what is touched

Untouched: content.js · the replier's prompts, ledger, memory, videos, teaching · the dashboard's
six existing tabs · `subsell_configs` (the teaching row: the lister writes nothing in it) ·
`subsell_messages` semantics (the lister adds rows of kind `listing`, VISIBLE in the feed,
excluded from the message counts) · every existing smoke test except the pins named in 10.5.

Touched, each exactly as section 10 says: manifest.json · background.js (the import, three
guards, the reinject block, one 🩺 line) · popup.html/js · options.html/js ·
store/build-webstore-zip.ps1 · store/webstore-manifest.js (`STORE_DESCRIPTION`) · docs/privacy.html ·
docs/index.html + docs/app.js (WP-E2 only) · the smoke pins of 10.5 · CLAUDE.md/HANDOFF.md.

## 3. The tree (who owns what)

    marketplace-auto-replier/
    ├─ lister/                          NEW — everything Autolister
    │  ├─ PLAN.md                       this file (sessions edit only their Board line)
    │  ├─ README.md                     WP-F — what it is, how to run, how to test (written last)
    │  ├─ lister-core.js                WP-A — PURE: schema, categories, Marketplace words, tags, templates,
    │  │                                        library, pacing, refresh planning, SKU, atlas line   (v1 ON DISK)
    │  ├─ library-starter.json          WP-L — starter headlines/descriptions per category (FR/EN) + tag sets (ON DISK)
    │  ├─ lister-selectors.js           WP-B — PURE DATA: the poster's selectors.js ported 1:1 (names kept)
    │  ├─ lister-dom.js                 WP-B — content world helpers (find, type, combobox, files, waits, atlas)
    │  ├─ lister-form.js                WP-B — content world: fill the create form from a Listing, read back, publish
    │  ├─ lister-selling.js             WP-C — content world: the bar + checkboxes, capture (item + edit), delete, renew
    │  ├─ lister-content.js             WP-C — content world: router, generation guard, message handler, progress box
    │  ├─ lister-content.css            WP-C — bar / checkbox / progress styles ([data-subsell-lister] nodes only)
    │  ├─ lister-bg.js                  WP-D — service worker module: engine, state machine, tab, cloud, pacing, rows
    │  ├─ lister-ui.js                  WP-E1 — shared UI (composer form, board, library editor) behind an adapter
    │  ├─ compose.html, compose.js      WP-E1 — the extension page: New · Many · Board · Library · About the shop
    ├─ docs/
    │  ├─ lister.js                     WP-E2 — dashboard adapter + mount into the Autolister pane
    │  ├─ index.html, app.js            WP-E2 — TOUCH (10.6)
    │  └─ privacy.html                  WP-F — TOUCH: one sentence on listing records + photos (10.7)
    ├─ supabase/
    │  └─ lister.sql                    WP-S — tables, RLS, bucket, retention (ON DISK; the owner pastes it once)
    ├─ store/
    │  ├─ smoke-lister-core.js          WP-A — plain node (ON DISK, green)
    │  ├─ smoke-lister-engine.js        WP-D — plain node, chrome.* stubbed
    │  ├─ smoke-lister-content.js       WP-C — concatenates content.js + the six lister files → no redeclaration
    │  ├─ smoke-lister-ui.js            WP-E1 — plain node, stub DOM (the smoke-where pattern)
    │  ├─ e2e-lister-lib.mjs            WP-B — headless Chrome over raw CDP + a chrome stub + the fixture server
    │  ├─ e2e-lister-form.mjs           WP-B — the create-form cases
    │  ├─ e2e-lister-selling.mjs        WP-C — the selling / item / edit / delete cases
    │  ├─ fixtures/marketplace/         WP-B owns shell.js + create.html; WP-C owns selling.html, item.html,
    │  │                                        edit.html, dialogs.js  (one pretend page per kind, variants by ?v=)
    │  ├─ build-webstore-zip.ps1        WP-F — TOUCH (10.5): the lister folder, forward-slash zip, -Fleet mode
    │  └─ webstore-manifest.js          WP-F — TOUCH: STORE_DESCRIPTION
    ├─ manifest.json                    WP-F — TOUCH (10.1)
    ├─ background.js                    WP-F — TOUCH (10.2)
    ├─ popup.html, popup.js             WP-F — TOUCH (10.3)
    ├─ options.html, options.js         WP-F — TOUCH (10.4)
    └─ CLAUDE.md, HANDOFF.md            planning session — pointer lines (done)

Order: **A, S, L are done** (section 16). **B, C, D in parallel now** (each depends on A's
contract and section 5, not on each other; C uses B's `lister-dom.js` API as written in 5.4 and
B keeps it). **F after B+C+D** = 0.22.0 Rebuild. **E1** after F has relisted real listings =
0.22.1. **E2** after E1 = 0.22.2.

## 4. The one record — `Listing`

    {
      id: "uuid",                      // ours, forever; the SKU is "SS-" + its first 8 hex, upper-case
      user_id: "<supabase user>",      // the account (the dashboard login)
      status: "draft" | "queued" | "posting" | "live" | "relist_queued" | "relisting"
            | "needs_review" | "error" | "paused" | "sold" | "deleted",
      source: "composer" | "dashboard" | "captured",
      category: "iphone" | "samsung" | "phone" | "ipad" | "tablet" | "macbook" | "laptop"
              | "desktop" | "console" | "watch" | "accessory" | "other",
      item: { model, storage, color, grade: "New"|"A+"|"A"|"B"|"C", specs, brand },
      fb: {                              // THE MARKETPLACE FORM, field for field (section 7)
        title, price, category,          // category = the EN option text; the driver offers FR + EN + fallbacks
        condition,                       // "New" | "Used - Like New" | "Used - Good" | "Used - Fair"
        description, tags: [],           // tags ≤ 20, lowercase, deduped
        sku,                             // "SS-XXXXXXXX" (a capture that finds our SKU knows the listing is ours)
        availability: "single" | "instock",
        location,                        // city text as typed into Facebook's Location box ("Montréal, QC" form)
        meetup: { public: true, pickup: false, dropoff: false },
        hideFromFriends: false,
        groups: []                       // "List in more places" — always none; pre-checked boxes are unchecked
      },
      photos: [ { path, url, bytes, w, h, order } ],   // ≤ 10; path = "<user_id>/<id>/<n>.jpg" in subsell-photos
      copy: { headlineId, descriptionId, lang: "fr"|"en"|"bi", edited: false },
      target: { machine: "PC-xxxxx" | "any" },         // getMachineId() of the computer that posts it
      fbListingId: null | "1234…", fbUrl: null | "https://www.facebook.com/marketplace/item/…",
      relist: { count: 0, lastAt: null, deletedAt: null, everyDays: null, nextAt: null, renewals: 0 },
      job: { step: null, sentAt: null, pressing: null },   // the engine's resume point (also in listerQueue)
      tries: { form: 0, lastError: "", atlasAt: null },
      history: [ { at, event, machine, detail } ],     // newest 50 kept (core pushHistory); events:
                                                       // created queued claimed captured saved delete_pressed deleted
                                                       // publish_pressed posted relisted renewed error sold owner
      closed_by: null | "owner" | "engine",
      created_at, updated_at, created_by
    }

Statuses and who moves them:

    draft ──(Save)──► queued ──(engine claims, lease 30 min)──► posting ──► live
                                                   └──(form failed, tries < 3)──► queued (tries.form+1)
                                                   └──(failed 3×)──► error
                                                   └──(publish_pressed, result unclear)──► needs_review
    live ──(Rebuild)──► relist_queued ──(claim)──► relisting ──(deleted: relist.deletedAt set)──(45–90 min)──► live
    live ──(Renew chip)──► live (relist.renewals+1)
    live ──(card shows Sold)──► sold          live ──(owner, Board)──► sold | deleted | paused
    card not found twice after a full scroll + item page unknown ──► needs_review  (never sold/deleted by inference)

## 5. Contracts

### 5.1 Messages (chrome.runtime) — every type starts with `LISTER_`

The replier's `onMessage` listener answers EVERY unknown type synchronously with
`{ ok:false, error:"unknown message type" }` (background.js:6044-6045) and the first
`sendResponse` wins, so WP-F adds the one-line guard of 10.2(b). `lister-bg.js` registers its
own listener, returns `true` only for `LISTER_*`, returns `false` synchronously for everything
else. Every answer carries `ok: true|false` (the popup ignores an answer without `ok`,
popup.js:28-30).

    content → background
      LISTER_PAGE_READY   { kind: "selling"|"create"|"item"|"edit"|"other", url, gen }   (on load and after every navigation)
      LISTER_SELECTION    { ids: [fbListingId…], action: "rebuild"|"renew"|"stop" }
      LISTER_STEP_RESULT  { jobId, step, phase: "pressing"|"done", ok, detail, atlas? }   → { ok, ack: true }
                          detail by step:
                            observe      → { cardSeen: bool, ourListingLive: bool|null, sold: bool }
                            capture_item → { title, price, description, condition, location, sold, photos: [dataUrl…], unreadable: n }
                            capture_edit → { category, tags: [], sku, availability, hideFromFriends }
                            delete       → { gone: true } | { survey: "<text>" } (a survey without "Other"/"no longer selling" = stop)
                            renew        → { renewed: true } | { offered: false }
                            fill         → { readback: { title, price, category, condition, description, tags, location, availability },
                                             mismatches: [field…], nextEnabled: bool, dryRun: bool }
                            publish      → { fbListingId, fbUrl } | { landed: "selling", title }   (the engine then locates the card)
                            describe     → { atlas }
                          any step may answer { block: "<signal>" } | { signin: true } | { feed: true } | { hidden: true }
      LISTER_LOG          { entry }      (appendLog({ action:"listing", thread: title, threadId: "listing:"+id, reply: "🔁 …" }))
    background → content
      LISTER_DO           { jobId, step, listing, photoUrls, dryRun, gen }   (the tab is already on the right page)
      LISTER_PING         → { ok, busy, kind, url, gen }                     (the lister's own liveness; never PING)
      LISTER_PROGRESS     { jobId, fbListingId, text, pct, queue: {done, total, nextAt} }
    popup / compose / dashboard → background
      LISTER_STATUS       → { ok, on, local, cloud, login, dryRun, hold: {until, why}|null,
                              queue: { queued, relisting, doneToday, nextAt, current }, tab: {id, kind}|null, lastError, lastAtlasAt }
      LISTER_OPEN         { page: "compose"|"selling" }
      LISTER_ENQUEUE      { listings: [Listing…], when: "now"|"paced" }  → { ok, ids }
      LISTER_LIST         → { ok, listings }                (cloud read-through, local cache when offline)
      LISTER_SAVE         { listing } → { ok, listing }     (cloud write-through; edits of price/title before a relist)
      LISTER_UPLOAD       { listingId, n, type, dataUrl } → { ok, path, url }   (the worker owns the token; compose.js never does)
      LISTER_LIBRARY      { get: true } | { put: rows } → { ok, library }
      LISTER_SETTINGS     { get: true } | { put: settings } → { ok, settings }
      LISTER_MACHINES     → { ok, machines: [{ machine, label, lastSeen, on }] }   (from subsell_lister_actions kind "heartbeat", 48 h)
      LISTER_STOP         → { ok }                           (listerHold { why: "owner" }; the current listing finishes its phase)
      LISTER_SYNC_NOW     → { ok }

### 5.2 Storage keys (chrome.storage.local) — all prefixed `lister`

    listerOnThisComputer   bool    the local switch (Options → Power features), default false
    listerDryRun           bool    rehearsal only: fills everything, presses neither Delete nor Publish; ships TRUE
    listerSettings         {}      the pulled account settings (5.3), merged over core DEFAULT_SETTINGS
    listerQueue            [Listing…]   this computer's jobs with job.step persisted BEFORE each LISTER_DO
    listerLedger           { items: [{t, k, id}], firstAt }   local cache of the account ledger (k = create|relist|delete|renew)
    listerTab              { tabId, windowId, since, jobId, gen }   the ONE helper tab; listerHoldsTab() reads it
    listerHold             { until, why, machine }   mirror of the account hold
    listerLibrary          { headlines: {cat: [{id, lang, text, uses, lastUsedAt}]}, descriptions: {…} }   ONE shape (5.5)

### 5.3 Cloud (Supabase, project tcqunihripihroseswgy) — `supabase/lister.sql`

    subsell_listings         (id uuid pk, user_id default auth.uid(), status, machine, fb_listing_id, category, title, price,
                              data jsonb, closed_by, claimed_at, lease_until, created_at, updated_at)   RLS owner
    subsell_lister_actions   (id, user_id, at, kind create|relist|delete|renew|heartbeat|hold, machine, fb_listing_id,
                              listing_id, phase)   RLS owner — the ACCOUNT ledger; 14 days kept
    subsell_copy_library     (id, user_id, category, kind headline|description, lang, text, uses, last_used_at, created_at)   RLS owner
    subsell_lister_settings  (user_id pk, settings jsonb, updated_at)   RLS owner — includes hold {until, why, machine}
    bucket subsell-photos    public read; insert/update/delete only for authenticated users INSIDE their own folder
                             ((storage.foldername(name))[1] = auth.uid()::text)
    retention                pg_cron hourly: actions > 14 days; listing ROWS sold/deleted by the owner > 60 days whose
                             photos[] is already empty. FILES are removed through the Storage API by docs/lister.js on
                             open (a SQL delete of storage.objects leaves the bytes orphaned — supabase/README).

Every lister REST call from the worker: headers `{ apikey: creds.key, authorization: "Bearer " +
auth.access_token, "content-type": "application/json", prefer: "return=representation" }`,
`cache: "no-store"`, `auth = await cloudValidAuth()` (no opts; null = no login or a refusal hold →
skip cloud work this tick, keep the local queue, NEVER call /auth/v1/token from lister-bg),
`creds = await getCloudCreds()`; on `!resp.ok` call `noteRestKeyRejection(resp, creds)` like the
config read does (background.js:1789-1796). Inserts carry `user_id: auth.user_id`.

Claiming a job: `PATCH /rest/v1/subsell_listings?id=eq.<id>&or=(status.in.(queued,relist_queued),lease_until.lt.<now>)`
with body `{ status: "posting"|"relisting", machine: "PC-x", claimed_at: now, lease_until: now+30min }`;
an empty answer = another computer took it. A lease is renewed at every step; a dead claimer's
lease expires and the job resumes elsewhere through the OBSERVE step.

Lister settings (`settings` jsonb) — the shipped defaults (the poster's, after the same reading; all
stay settings; the hint beside each says what raising it risks):

    enabled false · hours [9, 21] · gapMin 12 · gapMax 40 (minutes between any two actions on the account) ·
    dailyCreates 4 · dailyDeletes 4 · maxRebuildsPerDay 3 · breakAfter 3 · breakMin 20 · breakMax 40 ·
    warmupDays 14 · warmupCreates 2 (account-wide, keyed on the first lister action ever, never on installTs) ·
    minRebuildAgeDays 7 · rebuildDelayMin 45 · rebuildDelayMax 90 · rotateCopyOnRebuild true ·
    holdHoursOnBlock 48 (a second block within 7 days → enabled false + an Activity row) ·
    unattended false (v2 timer jobs) · autoRefreshDays null (v2) ·
    defaultCity "Ville Saint-Laurent" · region "QC" · defaultMeetup {public:true} · cityWords [...] ·
    shopName "SubSell" · warranty {fr, en} · hoursText {fr, en} · tagSets {category: [...]} ·
    hold null | {until, why, machine}

### 5.4 Module APIs (synced to the code on disk)

`lister/lister-core.js` (`globalThis.SubSellListerCore`; `module.exports` in node) — ON DISK:

    VERSION, DEFAULT_SETTINGS, settingsWith(partial), LIMITS { photos 10, title 100, description 5000, tags 20, tagLength 30 }
    CATEGORIES, CATEGORY_IDS, inferCategory(title)
    CONDITIONS (New, A+, A, B, C), GRADES, CONDITION_PATTERNS, CONDITION_TEXTS, conditionForGrade(g), gradeFromCondition(text), AVAILABILITY
    uuid(rand?), skuOf(id), idFromSku(sku), skuMatchesId(sku, id), newListing(partial, {now, rand}), validateListing(l),
    pushHistory(l, event, machine, detail, now), countStoredPhotos(l, bucketBase)
    normalizeTag, modelTokens(model), storageTokens(storage), tagsFor(l, settings)
    looksFrench(text), fillTemplate(text, l, settings, {mode: "title"|undefined, lang}), pickFromLibrary(items, usage?, {avoidId, lang}),
    titleFor(l, library, usage?, settings, opts), descriptionFor(...), rotateCopy(l, library, settings) → {title, description, ids},
    libraryFromRows(rows), rowsFromLibrary(library, userId), importStarter(json, userId) → rows, suggestPrice(rows, item)
    nextSlot(ledger, settings, now, kind: "create"|"relist"|"delete"|"renew") → { at, why, waitMs }
    rebuildCreateAt(deletedAt, settings, seed) → ms, jitterMinutes(min, max, seed)
    planRefresh(selected, settings, {force, minAgeDays}) → { jobs: [{fbListingId, action: renew|rebuild|skip, reason, young, ageDays, ours}], … }
    atlasSummary(atlas) → one line

`lister/lister-selectors.js` (`SubSellLister.sel`) — port the poster's `src/selectors.js` 1:1,
same export names, Playwright syntax (`:has-text`, `xpath=`) turned into {words, role, tag} data
the DOM helpers understand:

    URLS { selling, create, item(id), edit(id) }, pageKind(url) (pathname only, so 127.0.0.1 fixtures work),
    FIELDS, DROPDOWNS, LEAF_QUERY, OPTION_CONTAINERS, MORE_DETAILS_TOGGLE, NEXT_BUTTON, PUBLISH_BUTTON, CHECKED_BOXES,
    LEAVE_PAGE_BUTTON, LISTING_CARD, CARD_MENU_BUTTON, MENU_ITEMS, CONFIRM_BUTTONS, RENEW_BUTTON, EDIT_LISTING_BUTTON,
    SOLD_MARKER, PENDING_MARKER, BLOCK_SIGNALS (+ "looks like a duplicate / similar listing", checkpoint / captcha),
    REVIEW_SIGNALS, LISTING_GONE_SIGNALS, SUCCESS_URL (item OR you/selling, query ignored), CATEGORY_FALLBACKS, CATEGORY_QUERY

`lister/lister-dom.js` (`SubSellLister.dom`):

    findField(words, {scope})   a <label> whose first span equals a word (accent-insensitive, & → and) AND contains an
                                input/textarea, or a label[role=combobox]; role=main first, then the document; NEVER a bare span
                                (the 2026 form sits in the left column; role=main holds the PREVIEW that repeats the words)
    findButton(words)           div[role=button] by aria-label or inner span text; role=banner excluded
    typeInto(el, text)          focus → select all → document.execCommand("insertText") (fires React's onChange);
                                fallback native value setter + InputEvent; read back; one retry. A DOM read-back proves the
                                VALUE only — the proof React took it is Next/Publish losing aria-disabled
    sameMoney(shown, price)     ported
    openCombobox(words) / pickLeaf(matcher, {seen, scroll, timeoutMs})   section 9 WP-B checklist (b)
    setFiles(input, files)      ONE input.files = dt.files + bubbling change/input; the uploader may empty the input, so the
                                proof is N blob thumbnails (img[src^="blob:"]) or input.files.length; re-find the input each try
    setLocation(cityText)       the type-ahead rule, section 9 WP-B checklist (e)
    detectBlock() / detectReview() / detectSignin() / detectFeed()
    waitFor(fn, ms) · visible(el) · scopeMain() · visibilityOk() (document.visibilityState; a hidden tab answers { hidden:true }
                                when a step needs rendering)
    describeForm()              the atlas: labels ≤ 40 {aria, role, text ≤ 60, field, expanded, part main|navigation|dialog},
                                fields ≤ 40 {tag, type, name, aria, placeholder, accept, role, shown, filled: BOOLEAN},
                                buttons ≤ 120 {aria, text ≤ 40, disabled, expanded, part}, url, title, headings ≤ 12,
                                role counts {combobox, listbox, option, menu, menuitem, dialog, checkbox, checked, switch} — never values

`lister/lister-form.js` (`SubSellLister.form`): `fill(listing, photos, {dryRun})` → the `fill`
detail; `publish()` → the `publish` detail (write-ahead handshake inside); `describe()`.

`lister/lister-selling.js` (`SubSellLister.selling`): `mountBar()`, `cards()` → [{id, title, el,
renewOffered, sold, pending}], `observe(id)`, `captureItem()`, `captureEdit()`, `del(id)`,
`renew(id)`, `paint(progress)`; `lister-content.js`: `pageKind()`, the generation guard
(`window.__subsellListerGen`), the listener, `LISTER_PAGE_READY`, the floating progress box.

`lister/lister-bg.js`: `listerTick()` on the alarm `subsell-lister` (ensureAlarm, 1 min, created
only while both switches are on, cleared when either goes off) · `listerHoldsTab(tabId)` → Promise
(storage-backed, memory-cached) · `listerForgetTab(id)` · `listerDiagLine()` for the 🩺 ·
`listerOnUpdateAvailable()`. Top level: listeners and function definitions ONLY (the replier's
`const`s are in their temporal dead zone while this file evaluates).

`lister/lister-ui.js` (`SubSellListerUI`): `mount(el, adapter, {host: "extension"|"dashboard"})`;
adapter = `{ listListings, saveListing, uploadPhoto, library, saveLibrary, settings, saveSettings,
machines, enqueue, stop, status }` — the extension adapter maps each to a 5.1 message; the
dashboard adapter to `window.subsellClient`.

### 5.5 One library shape

    { headlines: { iphone: [{ id, lang, text, uses, lastUsedAt }], … }, descriptions: { … } }

`libraryFromRows(rows)` builds it from `subsell_copy_library` rows; `rowsFromLibrary(library,
userId)` goes back; `importStarter(json, userId)` turns `library-starter.json` into rows. The
composer's headline box: picking a line uses it as is (`copy.headlineId`); editing the text uses the
edited text once (`copy.edited: true`, the library line unchanged); "+ save this one" inserts a new
row. Rotation = least recently used, never the line used just before.

## 6. Flows

### 6.1 Rebuild (the owner's #1)

    "Your listings" page ──► the bar:  [☐ all (loaded cards)]  [3 selected]  [🔁 Rebuild]  [⏹ Stop]      + a "Renew (free)" chip
                                                                                                          on cards Facebook offers Renew for
    tick cards → Rebuild → the sheet:
        "3 listings. Each one: saved → deleted now → posted again about an hour later with the next headline and
         description from your library and the same photos (new cover) → the next one after a pause.
         Views and saves of the old listing are lost; its chats stay. 1 is younger than 7 days → skipped (tick 'force'
         on it to do it anyway). Keep Chrome open; you can use other tabs — SubSell works in its own tab."
        [Start] [Cancel]
    Start → LISTER_SELECTION → the engine opens its helper tab (6.4) and, per listing, in this order:
      0 OBSERVE     the card is there, not Sold/Pending (SOLD_MARKER / PENDING_MARKER → skipped: sold, record → sold)
      1 CAPTURE     ours (SKU or known id) → the record; else item page (title, price, description after "See more",
                    condition, location, every photo as JPEG bytes ≤ 1600 px via canvas / fetch — an unreadable photo is
                    reported) + the edit form (category, tags, sku, availability; never Update); a missing category is
                    inferred from the title
      2 VERIFY      title · price > 0 · ≥ 1 photo AS BYTES · description — else this listing is skipped with its reason
      3 SAVE        photos uploaded to subsell-photos, the record PATCHed, the answer re-read: status relist_queued
                    (cloud down = STOP here, nothing deleted, "cloud offline — nothing deleted")
      4 DELETE      card menu → Delete → "pressing" ack → confirm (a survey: "I'm no longer selling it" or "Other"; anything
                    else = stop with atlas; never Mark as sold) → 1.5–2.5 s → block check → RELOAD the selling page →
                    re-locate the card by id (8 scrolls) → still there or two match = FAIL, nothing created, the record keeps
                    its copy → gone = relist.deletedAt written to the cloud (+ an action row kind delete)
      5 WAIT        rebuildCreateAt(deletedAt) = 45–90 min; the next listing's steps 0–4 proceed meanwhile at the gap pace
      6 CREATE      helper tab → /marketplace/create/item → the WP-B order: photos → title → price → category → condition
                    → description → tags → availability → location → meetup → uncheck "list in more places" → Next until
                    Publish → "pressing" ack → Publish → SUCCESS_URL
      7 RECORD      /item/<id> in the URL → fbListingId; landed on you/selling → locate the new card by WHOLE title (two
                    matches = needs_review); relist.count+1, history relisted, action row kind relist, Activity row
                    "🔁 Relisted: iPhone 15 Pro Max 256 — 900 $", LISTER_PROGRESS
    end of run     one Windows notification (notifyHuman pattern, background.js:5061): "✅ 3 listings posted again" or
                   "⚠️ 2 of 3 — 1 needs you (Board)"
    a step that fails before a press: the listing stays relist_queued (tries+1, atlas row); after 3 → error.
    Stop: listerHold {why:"owner"} — the listing in flight finishes its current phase (a delete whose copy is saved
    is followed by its create; nothing new is deleted).

### 6.2 Create (the owner's #2) — 0.22.1

    popup "📣 New listing" ──► lister/compose.html (an extension page, English like the rest of the extension)
      [Category ▾]  first (it fills condition, tags, availability), THEN Marketplace's fields in Marketplace's order under
                    Marketplace's own labels (section 7), so the page reads like the Facebook form:
      Photos        drop / paste / file / camera → JPEG ≤ 1600 px → ordered, first = cover (≤ 10)
      Title         [ library combo: type to filter · ✨ next unused · + save this one ]   placeholders filled live
      Price         [ ]            Category  (read-only, from the category)      Condition  [grade ▾ → Marketplace text]
      Description   [ library combo, same ]
      Product tags  chips, filled by tagsFor(), editable            SKU  (ours, read-only)
      Availability  [single | in stock]    Location [default city]    Meetup [public ✓ pickup ☐ dropoff ☐]   Hide from friends ☐
      Post from     hidden until a second computer has the lister on (then [this computer | PC-… | any])
      When          [now | paced]      [+ Add another listing] … [Save & queue]
      About the shop (box): city, region, warranty FR/EN, hours FR/EN, shop name → LISTER_SETTINGS
    Save & queue → LISTER_ENQUEUE → the engine posts them at their slots in its helper tab; the Board shows each state,
    the link, and lets the owner edit price/title (LISTER_SAVE) before a post or a relist.
    Library tab: paste 100 lines = 100 headlines (one per line); descriptions separated by a blank line; per category and
    language; "Load the starter pack" imports lister/library-starter.json once.

### 6.3 Capture of listings made by hand on Facebook

A card whose id is unknown to us is captured on its first Rebuild (6.1 steps 1–3) and becomes
ours (our SKU is written at re-post). Photo quality of a capture is what the item page renders
(≈ 960 px); our own uploads are the originals (≤ 1600 px). **Open until the shop-PC probe (14):**
whether a facebook.com content script may read an `scontent…fbcdn.net` image as bytes (CORS).
If not, hand-made listings cannot be rebuilt by the tool (they are skipped with "photos not
readable — create it once from the composer") unless the owner accepts a new host permission.

### 6.4 The engine (lister-bg.js), once a minute while both switches are on

    tick → listerHold? (block / owner / cloud) → paint, return
         → pull settings + the account hold + my jobs (status queued / relist_queued; target me or any; or an expired lease)
         → nextSlot(account ledger ∪ local cache) due? → no: paint the countdown (LISTER_PROGRESS, popup), return
         → helper tab: listerTab alive and on a lister page? else chrome.tabs.create({ url: selling, active: false,
           index: clicker.index + 1, windowId: clicker.windowId }) wrapped in botActing(5000); PAUSE_SCANS to it; keepTabAlive;
           the tab is NEVER closed by the engine (a close reads as a person's and parks the replier's inbox reopen 3 h)
         → claim (5.3) → persist job.step → ONE LISTER_DO → the content script does all waiting and answers with a NEW
           LISTER_STEP_RESULT message → persist → next step on the next tick (or at once when the step is instant)
         → a step in flight > 10 min → failed + describe → atlas row
         → chrome.tabs.get(listerTab).url re-read before every LISTER_DO and watched on tabs.onUpdated: a URL that is not
           the expected kind (content.js's error-page recovery can send the tab to messenger.com, a block page, a login
           page) = the step is reported with that reason, never pressed
         → onUpdateAvailable: finish the current step, set updatePending, chrome.runtime.reload() between jobs;
           onInstalled / onStartup: resume listerQueue at job.step through OBSERVE
         → queue drained: RESUME_SCANS, park the tab on you/selling, clear the alarm when a switch is off
    a hidden helper tab may not render Facebook's virtualised lists: a step that needs rendering checks visibilityOk();
    { hidden:true } → the popup, the bar and the progress box say "click the SubSell tab to let it finish"; the rehearsal
    (12.4) proves whether a background tab fills the form on the shop PC — if it does not, the helper tab opens in a
    separate unfocused window (a Sep 11 action: one machine first) or v1 drives the owner's own tab with a Continue button.

## 7. The Marketplace form, field for field (Item for sale, 2026)

    Marketplace (EN / FR)                              record field        required   filled by
    Photos (up to 10) / Photos                         photos[]            ≥ 1        composer / capture (bytes in our bucket)
    Video / Vidéo                                      —                   no         skipped
    Title / Titre                                      fb.title            yes        headline library (placeholders)
    Price / Prix                                       fb.price            yes        typed, READ BACK (a mangled price stops the post)
    Category / Catégorie                               fb.category         yes        scorer over FR + EN + CATEGORY_FALLBACKS; a miss is FATAL
    Condition / État                                   fb.condition        yes        anchored regex; mounts AFTER Category; a miss is not fatal
    Description / Description                          fb.description      ours       description library (on the first screen in 2026)
    Product tags / Étiquettes (≤ 20)                   fb.tags             no         AUTO (tagsFor), editable chips
    SKU / UGS                                          fb.sku              no         "SS-XXXXXXXX" (ours)
    Availability / Disponibilité                       fb.availability     —          "List as single item" | "List as in stock"
    Location / Lieu                                    fb.location         yes        type-ahead: typed THEN picked, else the form stays invalid
    Meetup preferences / Préférences de rencontre      fb.meetup           no         Public meetup on (the shop)
    Hide from friends / Masquer aux amis               fb.hideFromFriends  no         off
    Boost listing after publishing                     —                   no         never
    List in more places (groups) / Publier ailleurs    fb.groups           no         none; pre-checked boxes unchecked (screen 2 when present)
    Next / Suivant · Publish / Publier · Post          —                   —          pressed until Publish shows (≤ 4 times)
    any other box Facebook adds (Brand, …)             —                   —          left alone, named in the atlas; the driver never types into a box it does not know

The option text follows the BROWSER locale, not the listing's language: the driver offers both
lists plus the real 2026 names, scored exact (100) > prefix (90) > substring (75) after accent /
& / space normalisation, list HEADERS ("Electronics") never match.

## 8. Categories, tags, library

Categories (ours → Marketplace): iphone, samsung, phone, **accessory** → **Mobile Phones** · ipad,
tablet, macbook, laptop, desktop, watch → **Electronics & Computers** · console → **Video Games** ·
other → **Miscellaneous** (FR words beside each in core). Default availability: accessory = in
stock, everything else = single item.

Tags (≤ 20, lowercase, deduped, FR+EN because Montréal): model tokens first (`iphone 15 pro max,
iphone 15, 15 pro max, 15`), storage (`256gb, 256 go`), the category set, colour, condition
words, city words, the rest of the set. The owner edits the sets on the dashboard; defaults in
core + `library-starter.json` (the smoke checks they match).

Library: one table, rows of headline / description per category and language, the one shape of
5.5. Placeholders: `{model} {storage} {color} {grade} {condition} {price} {city} {brand} {specs}
{warranty} {shop} {hours} {category}`; a title segment or a description sentence whose placeholder
is empty is dropped whole.

Copy rules (every SubSell text): **cash only** (never store credit), payment **"sur place" / "on the
spot"** (never "same day"), warranty **1 year + lifetime network**, no repair / technician /
diagnostic words, hours 9h–21h, "à partir de" for starting prices, no returns wording.

## 9. Work packages

Each WP: what you build · what you read first · files · its test · done when. A session takes ONE.

### WP-A — Core (pure) — DONE v1 (`lister/lister-core.js`, `store/smoke-lister-core.js`)
The API of 5.4 with the defaults of 5.3. No `chrome.*`, no DOM, no network. 90+ checks. Small
follow-ups belong to whoever needs them, in core + its smoke only, keeping every existing check.

### WP-S — Cloud — DONE v1 (`supabase/lister.sql`, a paragraph in `supabase/README.md`)
Section 5.3. Idempotent, namespaced `subsell_*`. **The owner pastes it once** (the classifier
refuses production deploys from a session). Done when a dashboard login can insert/select its
own rows and an upload to `subsell-photos/<uid>/x/1.jpg` returns a public URL.

### WP-L — Library content — DONE v1 (`lister/library-starter.json`)
12 headlines + 8 descriptions per phone category, FR and EN, SubSell voice, placeholders; the
owner's 100s replace it on the dashboard.

### WP-B — Facebook form driver — `lister-selectors.js`, `lister-dom.js`, `lister-form.js`,
`store/e2e-lister-lib.mjs`, `store/e2e-lister-form.mjs`, `store/fixtures/marketplace/shell.js` + `create.html`
Read first: the poster's `src/selectors.js` (all), `src/poster.js` 1–130 and 560–880,
`scripts/test-post-flow.js` 60–480, HANDOFF.md of the poster "2026-10-02 late morning".
Port checklist (the only tested knowledge; poster.js lines):
  (a) openCreateForm 564-594: goto CREATE_ITEM_URL; wait 2.5–4.5 s (+3 s per try); detectBlock FIRST (575) → blocked,
      never retried; sign-in = URL /login|checkpoint|recover or input[name=pass] (579) → signin, never retried; "on form"
      = URL has /marketplace/create AND the hidden photo input exists (583-588, 20 s then 12 s); else retry ≤ 3 (the feed
      answer; 2× feed in a row = hold); every non-success exit = atlas.
  (b) the combobox: BEFORE the click snapshot every LEAF (`span, div[dir=auto], li`, no child elements, non-zero box) into a
      WeakSet in the page (105-119, nothing written into Facebook's markup); click the label[role=combobox] itself (312-320),
      wait 0.5–0.95 s; a second click CLOSES it (abandon with Escape, never re-click); loop to a 12 s deadline (180-258):
      a REAL list first (OPTION_CONTAINERS), else fresh leaves not in the snapshot (122-178); score (279-290); scroll the
      list to render more rows (virtualised); a miss says "the list showed: …" (261-264).
  (c) order and proofs: photos (674-680: set files, wait 2.5–4.2 s for thumbnails — typing during the re-render drops
      keystrokes; proof = thumbnails) → title (typeAndConfirm 626-650, read back) → price (sameMoney 612-624; a price the
      form does not hold STOPS the post) → category (694-714: fr + en + fallbacks; a miss is fatal) → condition (716-731:
      non-fatal, Escape and continue; mounts after category) → description (looked for first; "More details" 381-393
      only if absent) → tags (chips: type + Enter each; the fixture must model a chip input) → availability (non-fatal)
      → location (e) → uncheckCrossposting 409-431 on the groups screen → Next until Publish (≤ 4; waitEnabled 395-407)
      → dry run ends by reporting whether Next/Publish is lit; publish = write-ahead (825-831) then click.
  (d) typing: see 5.4 typeInto; the proof React took a value is the button losing aria-disabled (fixture validate()).
  (e) location 331-375: text "City, QC" (province = settings.region); find 4 s (absent → skipped, ok); if the box already
      contains the city KEEP it (344-347); else snapshot → type → 0.9–1.6 s → pick over a real listbox OR plain divs with
      locationScorer (296-305: "Montréal, Quebec" wins over "Montréal-Est, Quebec"); never leave a typed-but-unpicked box.
  (f) success: SUCCESS_URL matches /item/<id> AND /you/selling (selectors.js:223); REVIEW_SIGNALS after Publish = success,
      flagged; a block AFTER Publish keeps publish_pressed → needs_review; bare "try again later" is NOT a block.
The e2e (no precedent in this repo — keep it small): `e2e-lister-lib.mjs` starts a node http server for
`store/fixtures/marketplace/` (photos served from a SECOND port so the cross-origin fetch path runs), launches
`chrome --headless=new --remote-debugging-port=0 --user-data-dir=<tmp> --proxy-server=127.0.0.1:1`
(nothing leaves the PC), talks raw CDP over Node's global WebSocket (no npm), injects a 40-line
`chrome` stub (`runtime.id`, `sendMessage`, `onMessage`, `storage.local`) + lister-core + the WP-B
files with `Page.addScriptToEvaluateOnNewDocument`, and drives the steps by calling
`SubSellLister.form.*` directly. The fixture is ONE page script (the poster's `pretendForm(v)`
pattern, test-post-flow.js:442-473) with variants by `?v=`: EN/FR, aria-labels on/off, form in the
left column with the preview in main, plain virtualised list vs legacy role=option, condition
mounting after category, "More details" open/closed, availability present/absent, location
listbox/plain/prefilled, 1–3 screens with pre-checked group boxes, a grey Next that swallows
clicks, dropped keystrokes, a mangled price, the feed answer, the sign-in page, a block page, a
chip input for tags, a dialog with role counts; redirects from the page's own script (never a
302 — the poster's trap). Done when every variant fills and "publishes", every deliberate
breakage is reported with an atlas, and the atlas never contains the typed description.

### WP-C — "Your listings" bar, capture, delete, renew — `lister-selling.js`, `lister-content.js`,
`lister-content.css`, `store/e2e-lister-selling.mjs`, `store/smoke-lister-content.js`,
`store/fixtures/marketplace/selling.html` + `item.html` + `edit.html` + `dialogs.js`
Read first: the poster's `src/manage.js` 134-330 and 440-520, `src/maintain.js` 19-22 and
367-411, `src/selectors.js` from "Managing listings" down; section 6.1 and 6.4 here.
Port checklist: openSellingPage + block check (manage.js:134-140); locate a card by id (href) else
whole title, 8 scrolls × 1400 px (180-217; titleMatchesCard: a line may run past the title, never
stop short; ≥ 24 chars before an ellipsis; two matches = ambiguous); the card MENU scoped to the
card's container only (274-293 — never the page-scope fallback at 277, it opens another card's
menu); clickMenuItem = regex over OPTION_CONTAINERS, 6 s, 0.7–1.3 s after (296-321); RENEW_BUTTON
inside the container first (390-406), no Renew entry → Escape → `{offered:false}`; a delete is
verified by RELOAD + re-locate (446-460), never by the SPA removing the card; "card not found" is
not proof of anything — the item page's LISTING_GONE_SIGNALS (235-265) or a Sold badge on the
card's container (470-474, 507-513) decide; after 3 misses → needs_review (maintain.js:19-22).
The bar: `[☐ all]` means the cards loaded so far (scroll to the end before offering "all");
`[⏹ Stop]`; a Renew chip only on cards that show Renew; Sold/Pending cards unticked and listed as
"skipped: sold"; the sheet text of 6.1; the bar re-mounts from engine state
(LISTER_PAGE_READY → LISTER_PROGRESS) after every reload. `lister-content.js`: `pageKind()` by
pathname; `window.__subsellListerGen` — the newer instance removes `[data-subsell-lister]` nodes,
the older tears down on a gen mismatch or a dead `chrome.runtime.id`; the floating progress box on
every lister page; the listener (never PING/TICK_NOW/PAUSE_SCANS/RESUME_SCANS). The smoke
concatenates content.js + the six lister files into one `new Function` to catch a redeclared
top-level name. Done when the e2e ticks two cards, captures both (photos as bytes from the second
port), sends "pressing" and waits for the ack before the confirm, verifies the delete by reload,
skips a Sold card, reports a survey without "Other", and the generation guard leaves one bar
after a second injection.

### WP-D — Engine — `lister-bg.js`, `store/smoke-lister-engine.js`
Read first: background.js 744-800 (machine id/label, mirrorToCloud), 1485-1529 (cloudValidAuth),
1789-1796 and 1950-1958 (REST read/write), 2042-2053 (ledgerUnits — "listing" counts 0, keep it
so), 5061 (notifyHuman), 5076-5088 (appendLog), 6069-6100 (ensureAlarm), 6184-6212 (botActing,
botTabs, onRemoved), 6214-6232 (ensureMarketplaceTab), 6390-6421 (the heartbeat loop).
Build 6.4 + 5.1 + 5.2 + the cloud calls of 5.3 (settings, hold, queue, claim with lease, actions,
library, LISTER_UPLOAD to `/storage/v1/object/subsell-photos/<path>` with `x-upsert: true`,
LISTER_SAVE, LISTER_LIST, LISTER_MACHINES from hourly heartbeat action rows), the account ledger
(cloud ∪ local), `nextSlot` per action kind, `rebuildCreateAt`, holds (block 48 h, owner, cloud),
the helper tab (botActing before every create/update; `listerForgetTab` before any remove the
owner triggers; never closed by the engine), `listerHoldsTab` as a Promise, PAUSE_SCANS /
RESUME_SCANS to the held tab, `onUpdateAvailable`, resume through OBSERVE, Activity rows through
`appendLog` (never `LOG_EVENT`), the end-of-run notification, `listerDiagLine()`. Top level = only
definitions + listeners. The smoke stubs `chrome.*`, `fetch`, `botActing`, `cloudValidAuth`,
`getCloudCreds`, `appendLog` and drives: a two-listing rebuild (capture → save → delete →
45–90 min → create with rotated copy), a three-listing paced create, a block signal pausing the
account 48 h, a cloud outage stopping before the delete, a claim race losing cleanly, a crash
after delete resuming at create (deletes nothing), a lease expiring on another computer, a
"pressing" without ack never pressing, `listing` rows never reaching the ledger, botActing called
before every tab call. Done when green and `node --check` passes.

### WP-E1 — Composer page — `lister-ui.js`, `compose.html`, `compose.js`, `store/smoke-lister-ui.js` (0.22.1)
Section 6.2 behind the adapter of 5.4; photo resizing (canvas → JPEG 0.85 ≤ 1600 px, any input
type), paste/camera/file, reorder; tags from `tagsFor()` on every category change; the library
combo with ✨ and "+ save this one"; the Board with editable price/title; the Library tab with
the paste-100-lines import and "Load the starter pack"; About the shop. Smoke: stub DOM (copy
smoke-where.js 116-185), builds a listing from the form, tags appear on a category change, a
headline rotates, an edited headline sets `copy.edited`. Done when green and the page opens from
the popup.

### WP-E2 — Dashboard pane — `docs/lister.js` + the touches of 10.6 (0.22.2)
Mount `lister-ui.js` into `<section id="lister">` with the Supabase adapter (`window.subsellClient`);
`docs/lister.js` watches the tab click, `hashchange` and `#lister` on load (showTab has no hook);
on open: remove the files of listings closed by the owner > 60 days ago through the Storage API,
then empty their `photos[]` (the cron removes the rows). The one hint line at the top: "Your real
Marketplace ads. The prices the chat bot quotes stay in Listings." Smoke: its own stub-DOM copy
with "lister" in TABS (the existing harness only knows six). Done when `#lister` shows the pane
after the login and the two `?v=` pins of 10.5 are green.

### WP-F — Wiring + release (last; 0.22.0 = Rebuild)
Section 10 exactly, `lister/README.md`, HANDOFF entry, `dist/*` rebuilt AND committed (the
dashboard's download link and deploy/update-subsell.ps1 serve them from the branch), then 12.4–12.6.

## 10. Touch points in existing files (exact; WP-F unless said)

1. `manifest.json` — add a second `content_scripts` entry:
   `{ "matches": ["https://www.facebook.com/marketplace/*"], "js": ["lister/lister-core.js",
   "lister/lister-selectors.js", "lister/lister-dom.js", "lister/lister-form.js", "lister/lister-selling.js",
   "lister/lister-content.js"], "css": ["lister/lister-content.css"], "run_at": "document_idle" }`;
   `version` → `0.22.0`. No new permission, no new host (14 lists the one that may become necessary).
2. `background.js` —
   (a) line 21, right after `"use strict";` (:20) and before `const DEFAULTS` (:22):
       `try { importScripts("lister/lister-core.js", "lister/lister-bg.js"); } catch (e) { console.warn("[SubSell-BG] lister not loaded:", e && e.message); }`
       (console.warn, not LOG — `LOG` is a `const` still in its temporal dead zone). It is outside the
       STORE-STRIP markers (:6433–:6768) and store/smoke-store.js:60 proves the first 2,000 bytes are
       identical in the store build.
   (b) line 5398, first statement inside the listener, before `(async () => {`:
       `if (msg && typeof msg.type === "string" && msg.type.indexOf("LISTER_") === 0) return false; // lister/lister-bg.js answers these`
   (c) heartbeat loop: between :6393 `const h = health[key] || …` and :6394 `const resp = await pingTab(tab.id);`:
       `if (typeof listerHoldsTab === "function" && await listerHoldsTab(tab.id)) { h.misses = 0; continue; }`
       (after keepTabAlive, skipping PING, the miss reload :6404, the freshness reload :6413-6417 and TICK_NOW :6419).
   (d) videoActivateTab loop (:6353-6358), beside :6355 `if (t.active) continue;`:
       `if (typeof listerHoldsTab === "function" && await listerHoldsTab(t.id)) continue;`
   (e) selfUpdateCheck (:6734, INSIDE the strip — fleet build only), after :6735 `if (STORE_BUILD) return;` and inside
       the loop before :6754 `const p = await pingTab(tab.id);`:
       `if (typeof listerHoldsTab === "function" && await listerHoldsTab(tab.id)) { chrome.storage.local.set({ sudStatus: "v" + disk.version + " on disk — restarting when the listing job finishes" }); return; }`
   (f) reinjectAllTabs (:6792), after the content.js executeScript (:6801), guarded by the lister's match:
       `if (/^https:\/\/www\.facebook\.com\/marketplace\//.test(tab.url || "")) { chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["lister/lister-content.css"] }, () => void chrome.runtime.lastError); chrome.scripting.executeScript({ target: { tabId: tab.id }, files: LISTER_CONTENT_FILES }, () => void chrome.runtime.lastError); }`
       with `LISTER_CONTENT_FILES` = the manifest's list, in order.
   (g) buildDiagnostic (:5096): `if (typeof listerDiagLine === "function") L.push(await listerDiagLine());` (one 🩺 line).
   The closed checklist of replier habits that see a lister tab, for the shop-PC tick: heartbeat
   tabs.query → botTabs → onRemoved (covered by botActing + never closing); PING / miss reload /
   freshness reload / TICK_NOW (c); videoActivateTab (d); un-minimize and cascade (window-level,
   opt-in, never focused: accepted); selfUpdateCheck (e); reinjectAllTabs (f); ensureMarketplaceTab
   (opens only when NO facebook tab exists: accepted); content.js's own scan + error-page recovery
   (PAUSE_SCANS + the URL re-read of 6.4).
3. `popup.html` after :89 — `<div class="row" id="listerRows"><button id="listerCompose">📣 New listing</button>
   <button id="listerRebuild">🔁 Rebuild listings</button> <span id="listerStatus" class="muted"></span></div>`;
   `popup.js` beside :455 — compose opens `chrome.runtime.getURL("lister/compose.html")`, rebuild opens
   `https://www.facebook.com/marketplace/you/selling`; `LISTER_STATUS` paints the span: greyed with
   "Autolister off — Settings → Power features (this computer) · dashboard → Autolister (the account)",
   "Log in (Options → Cloud sync) first", "Rehearsal only", the hold, or "3 queued · next 14:20".
4. `options.html` after :284 (keepWindowsRestored) — two checkboxes: `listerOnThisComputer`
   "📣 Autolister on this computer" and `listerDryRun` "📣 Autolister rehearsal only — fills everything,
   presses neither Delete nor Publish (ON until the first clean dry run)"; `options.js` POWER_KEYS (:1079):
   insert both BEFORE `"keepWindowsRestored"` (store/smoke-calm.js:110 pins the literal tail
   `"keepWindowsRestored"]`); the dry-run key defaults TRUE when unset (the loop at :1080-1090 reads `!!r[k]`,
   so lister-bg treats `undefined` as true).
5. `store/build-webstore-zip.ps1` — Compress-Archive on this PC names subfolder entries with a
   BACKSLASH (`lister\lister-core.js`), which Linux unpackers (the Web Store, Chrome's check) turn into a
   root file literally named that → importScripts and the manifest paths fail → a DEAD store build. So:
   `[System.AppContext]::SetSwitch('Switch.System.IO.Compression.ZipFile.UseBackslash', $false)` at the
   top, stage the folder (`Copy-Item -Recurse lister …` then remove `lister\*.md`), write the zip with
   `[IO.Compression.ZipFile]::CreateFromDirectory($stage, $out)` instead of Compress-Archive, and VERIFY
   every entry name contains no backslash. Add a `-Fleet` mode (manifest WITH key, fleet background.js,
   INSTALL.txt → both `dist/subsell-extension.zip` and `dist/subsell-installer.zip`); the .sh is not
   used on this PC (no zip binary). Smokes to update: store/smoke-store.js (assert the lister files, the
   UseBackslash switch, CreateFromDirectory, no Compress-Archive, `importScripts("lister/…")` in the store
   worker, every importScripts target and content_scripts path present in the zip), store/smoke-where.js:112
   (version), store/smoke-calm.js:110 (unchanged if 10.4 is followed), store/smoke-dashboard.js:144 +
   smoke-where.js:111 (`app.js?v=` — WP-E2). `store/webstore-manifest.js:23` STORE_DESCRIPTION (≤ 132,
   smoke-store.js:35): "Manage your own Facebook Marketplace shop: answer buyers and post or refresh your own
   listings, one at a time, at your pace." — never "visibility", "bulk", "mass", "automate", "relist to rank".
6. `docs/index.html` (WP-E2) — tab after :123: `<div class="tab" data-tab="lister">Autolister</div>`; pane after
   :358 (the Activity `</section>`): `<section id="lister" class="pane"><div id="listerMount"></div></section>`;
   scripts after :379, each with `?v=`: `../lister/lister-core.js`, `../lister/lister-ui.js`, `lister.js`; bump
   `app.js?v=` (Pages caches ~10 min). `docs/app.js` (WP-E2) — after :1862 `client = supabase.createClient(url, key);`
   add `window.subsellClient = client;`; add `const COUNT_HIDDEN = HIDDEN_KINDS.concat("listing");` and a
   `countsOnly(q)` used by the two count queries (:1649, :1652) and the fleet line (:1157) ONLY — the feed (:1632)
   and the Copy report (:1546) keep showing `listing` rows with their emoji.
7. `docs/privacy.html` — one sentence beside the demo-video and activity-log sentences: listing records and
   listing photos are stored in the operator's own Supabase project (bucket subsell-photos) and nowhere else.
   Web Store dashboard: single-purpose field and the tabs/scripting/storage justifications now also name the
   listing form the user composed; remote code = No (importScripts of a packaged file is not remote code).
8. `CLAUDE.md`, `HANDOFF.md` — the pointer lines (done by the planning session).

## 11. Safety rails (what never ships on, what always holds)

- Three local/cloud switches: `lister.enabled` (cloud, off) · `listerOnThisComputer` (local, off) ·
  `listerDryRun` (local, ON). Unattended timer jobs need `unattended` (v2).
- A cloud login on the computer is a precondition (uploads and claims need the user token); a
  computer on a pasted config URL only cannot run the lister and the popup says so.
- Pace per account (5.3 defaults): gaps 12–40 min, 4 creates / 4 deletes / 3 rebuilds a day, a
  break after 3, hours 9–21, warm-up 2 a day for 14 days from the account's first action,
  attempts count (a form try counts even when it stops before Publish).
- Block signals (ported BLOCK_SIGNALS + duplicate/similar notice + checkpoint/captcha + 2× feed
  instead of the form) → hold 48 h on the ACCOUNT, an Activity row, the popup says it; a second
  block within 7 days → `enabled` off. REVIEW_SIGNALS = success, flagged; 3 in a row → hold.
  Block checks run after the create page opens, before Next, after Publish, after the selling
  page opens, after every confirm, on the item page. Never push through a block.
- Capture → confirmed cloud save (photos as bytes) → delete; "pressing" written before any press;
  unclear outcome → needs_review, never retried by the engine; a claim with a lease; OBSERVE on
  every resume; same item, not the same bytes (rotated copy, new cover, 45–90 min).
- Never type where the replier types: `pageKind` other → refuse; synthetic events only.
- Calm computer: the engine never focuses, moves, un-minimizes or closes anything; its helper tab
  is `active:false`, opened under `botActing`, parked when done; a hidden tab that cannot render
  asks for a click instead of guessing.
- Nothing typed is ever logged; the atlas carries labels, roles, buttons and counts only (tested).
- The replier's caps, ledger, memory and teaching are untouched; `listing` rows count 0 in
  `ledgerUnits` and are excluded from the dashboard's message totals.
- A Sold/Pending card is never rebuilt; "card not found" never means sold/deleted.

## 12. Release path

1. A, S, L are on disk (this session). The owner pastes `supabase/lister.sql`.
2. B, C, D in parallel sessions; each green on its own test; each commits by path.
3. F wires, bumps `0.22.0`, runs every `store/smoke-*.js` + both e2e, rebuilds and commits `dist/*`.
4. On the shop PC (its Chrome has the owner's Facebook; the store copy stays installed — a fresh
   unpacked copy starts with the replier OFF, keep it OFF there): Load unpacked once, Options →
   Cloud sync → Log in, tick "Autolister on this computer" (rehearsal stays ON), dashboard →
   Autolister → on. Then the day-1 probes, each one line in the Activity log: (i) fetch ONE
   `scontent…fbcdn.net` image as bytes from a facebook.com tab (6.3); (ii) a `describe` of the
   create form, the selling page, the item page and the edit form (the atlases); (iii) one
   rehearsal Rebuild of ONE listing — captures, shows the delete it would confirm, fills the
   create form in the HELPER tab (hidden) and stops before Publish; if the hidden tab did not
   render the lists, repeat with the tab clicked (6.4's last paragraph decides v1's tab mode).
   Fix `lister-selectors.js` from the atlases. Repeat until clean.
5. Untick "rehearsal only". First real Rebuild of ONE listing older than 7 days, owner watching
   the Board. Then two. Then the composer (0.22.1) with one listing.
6. Web Store submission (the owner's click; ~1 day review; remote code = No; the single-purpose
   wording of 10.5; screenshots of the bar and the composer). Store computers update by themselves.

## 13. The owner's clicks (the only ones)

- Paste `supabase/lister.sql` once (Supabase → SQL editor).
- On the shop PC: Load unpacked once (or Reload on the existing unpacked entry); Options → Cloud
  sync → Log in if not already; Power features → tick "Autolister on this computer"; dashboard →
  Autolister → switch on; after the first clean rehearsal untick "rehearsal only".
- Paste his headlines/descriptions on the Library tab (or keep the starter pack).
- Submit `dist/subsell-webstore.zip` v0.22.0 on the Web Store when WP-F says so.

## 14. Assumptions and open questions (answer when they come up; do not block on them)

- The 2026 form shape is from reading, not running: the rehearsal (12.4) is the test.
- **Photos of hand-made listings:** can a facebook.com content script read an `scontent` image as
  bytes (CORS)? Probe on day 1 (12.4 i). No → those listings are skipped ("create it once from
  the composer") unless the owner accepts `https://*.fbcdn.net/*` as a new host (a store review
  flag). The store build has no `<all_urls>`, so the worker cannot fetch them either.
- **Hidden helper tab:** does a background tab render Facebook's virtualised combobox lists? The
  rehearsal decides (6.4 last paragraph) — v1 falls back to a separate unfocused window or to the
  owner's own tab with Continue.
- Tag limits: 20 tags assumed; the per-tag length is unknown — the driver reports a refused tag.
- The delete dialog may carry a survey; only "I'm no longer selling it" / "Other" are chosen; a
  "sold" answer opens a buyer-rating flow and is never chosen.
- Captured photo size is what the item page renders (~960 px).
- Renew RECREATES the listing on Facebook's side too: saves, shares and existing buyer threads are
  not carried over (poster README) — the sheet says so for both paths.
- Chrome Web Store: the item's single purpose becomes "manage your own Marketplace shop (replies +
  listings)"; a rejection holds the store release only; the shop-PC trial does not depend on it.
- Facebook's edit form is READ for capture only; a price/title change = edit in the Board, then
  Rebuild (v1). "Mark as sold" from the bar, the smart Refresh default, the auto-every-N-days
  timer, a second extension window for unattended work: v2.
- A category-specific extra box (Brand, …) is left alone and named in the atlas.

## 15. Verification record

v1 of this plan was checked on 2026-10-21 by three readers against the code (background.js,
the dashboard, the build scripts, the poster's selectors/poster/manage/maintain/test-post-flow)
and two critics (the owner's advocate, a platform skeptic): 32 confirmations, 29 corrections,
29 additions, 44 critique items. v2 above folds in every correction and every high/medium item;
the low items that were accepted: grade A+, history cap 50, shop facts as settings with an
About-the-shop box, greyed popup rows with the reason, the end-of-run notification, the
Listings-vs-Autolister hint, the duplicate notice as a block signal, extra boxes left alone,
the `subsell-lister` alarm created only while the switches are on, photos set in one change
event, the e2e's second port for photos.

## 16. Board (each session edits ONLY its own line)

    WP-A  core          v1 ON DISK + committed 2026-10-21 · store/smoke-lister-core.js green · follow-ups welcome in core + smoke only
    WP-S  cloud         v1 ON DISK + committed 2026-10-21 · WAITING for the owner's paste
    WP-L  library       v1 ON DISK + committed 2026-10-21 · the owner's 100s replace it on the dashboard
    WP-B  form driver   not started
    WP-C  selling bar   not started
    WP-D  engine        not started
    WP-E1 composer      not started (0.22.1, after F)
    WP-E2 dashboard     not started (0.22.2, after E1)
    WP-F  wiring        not started (last; 0.22.0)
