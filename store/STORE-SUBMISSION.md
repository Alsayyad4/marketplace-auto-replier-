# Publishing SubSell to the Chrome Web Store (v0.21.81, Oct 2026)

Why: an extension installed from the Web Store is **updated by Chrome itself**, on
every computer, whatever folder it was installed from. The unpacked fleet build
updates itself only when its folder sits where the updater looks and Chrome may
write there — on Oct 8 2026 a dozen computers had been reporting "cannot
self-update" for days. The store item is **Unlisted**: only people with the link
can install it; it never shows in search.

Plan for ~20 minutes of clicking plus **1–3 business days** of Google review.
One-time cost: **$5** for the developer account.

---

## Step 1 — Build the store ZIP (done by the repo, no manual edits)

```
powershell -ExecutionPolicy Bypass -File store\build-webstore-zip.ps1
```

→ **`dist/subsell-webstore.zip`**: the extension's runtime files only, flat, with
the store manifest (`store/webstore-manifest.js`): **no `key`** (the Store issues
its own extension ID), host permissions narrowed to the four hosts the single
purpose needs (`*.messenger.com`, `*.facebook.com`, `api.anthropic.com`,
`*.supabase.co`), and **no `debugger` and no `activeTab`** permission. Same version
as the fleet build. The fleet zips (`dist/subsell-extension.zip`,
`dist/subsell-installer.zip`) keep the key and every permission and are untouched.

What the store build gives up by dropping `debugger`: the file-API video channels
(`input`, and the opt-in `chooser` / `drop` / trusted Enter) and the diagnostic's
CDP lines. The production channel (`btn`, Messenger's own picker caught in the
page, the one fixed in v0.21.77) and the `dom` / `paste` channels need no debugger;
`content.js` parks the file-API channels for good when the permission is absent, so
nothing probes or parks in cycles. No "SubSell is debugging this browser" bar, ever.

The code tells the two installs apart at run time: a store install carries an
`update_url` in its manifest (Chrome adds it), and then `STORE_BUILD` is true in
`background.js` — the folder-based self-updater never runs, the popup's
"Update now" says the Store updates it, the diagnostic's `sud:` line says `STORE`.

---

## Step 2 — The privacy policy URL (already live)

`https://alsayyad4.github.io/marketplace-auto-replier-/docs/privacy.html`

(`docs/privacy.html`, served by GitHub Pages with the dashboard; contact email
already filled in.)

---

## Step 3 — Register as a developer (once)
1. https://chrome.google.com/webstore/devconsole → sign in with the Google account
   that will own the item (the shop's, not an employee's).
2. Accept the agreement, pay the **one-time $5** fee.

---

## Step 4 — Create the item & upload
1. Dashboard → **Add new item** → upload **`dist/subsell-webstore.zip`**.
2. **Store listing** tab — copy from [`listing.md`](./listing.md): name, summary,
   description, category **Productivity**, language, the screenshots in this folder
   (`screenshot-1280x800.png`, `promo-small-440x280.png`,
   `promo-marquee-1400x560.png`), icon `icon-store-128.png`.
3. **Privacy practices** tab — the part reviews stall on; paste exactly:
   - **Single purpose:** "Auto-replies to the operator's own Facebook Marketplace
     buyer messages, in the operator's own Messenger account, using the operator's
     own Anthropic Claude API key and the operator's own settings."
   - **Permission justifications** — the table below.
   - **Data usage:** handles *Personal communications* (the buyer messages it
     replies to) and *Authentication information* (the operator's API key and
     cloud login); not sold, not used for anything but the single purpose; complies
     with the Developer Program Policies.
   - **Privacy policy URL:** Step 2.
4. **Distribution** → Visibility **Unlisted**.
5. **Submit for review.** Keep the item's link (Store listing → "View in store" or
   `https://chromewebstore.google.com/detail/<id>`): that link is what every
   computer installs from.

### Permission justifications (paste these)

| Permission | Why it's needed |
|---|---|
| `storage`, `unlimitedStorage` | The operator's settings, API key, per-chat memory and the demo videos kept on disk. |
| `alarms` | The minute heartbeat (scan, cloud sync), follow-ups and the remote-config refresh. |
| `notifications` | Tells the operator when a conversation needs a human. |
| `tabs` | Finds the operator's open Messenger tab to work in it and keeps it from being discarded. |
| `scripting` | Injects the page-side helper that hands the demo video to Messenger's own file picker, and re-injects the content script into an already-open Messenger tab after an update, so the operator never has to reload pages. |
| `downloads` | Keeps the operator's own demo video clips on disk (Downloads/SubSell-videos). |
| Host `*.messenger.com`, `*.facebook.com` | The extension only works inside the operator's own Marketplace/Messenger chats. |
| Host `api.anthropic.com` | Generates the replies with the operator's own API key. |
| Host `*.supabase.co` | The operator's own settings/cloud sync project (configured by the operator). |

---

## Step 5 — Each computer, once (the migration)
1. Open the item's link on that computer → **Add to Chrome**.
2. Extension → **Options** → Cloud sync → **Log in** (the shop's email + password).
   The API key, the teaching and the videos arrive within a minute.
3. `chrome://extensions` → **Remove** the old unpacked "SubSell Marketplace
   Auto-Reply" entry (the one with a folder path). Two copies on one computer would
   both answer; the cloud memory settles most of it, but remove the old one anyway.
4. Pin the new icon. Done — from now on Chrome updates it by itself (the popup's
   "Update now" confirms: "the Chrome Web Store updates it by itself").

The old computers that could not self-update get this instead of a folder reinstall.

---

## Updating later (every release)
1. Bump `version` in `manifest.json` as usual, push the fleet build.
2. `powershell -ExecutionPolicy Bypass -File store\build-webstore-zip.ps1`
3. Developer dashboard → the item → **Package** → upload `dist/subsell-webstore.zip`
   → **Submit for review**. Updates review faster than the first submission; Chrome
   installs them on every computer within a few hours of approval.

---

## The review: what to write so it passes (a first submission was rejected once)
Reviewers cannot log into Messenger, so a Facebook-dependent extension is rejected
as "functionality could not be verified" unless they can see it work. In the item's
**Test instructions / notes for the reviewer** field (Privacy practices tab or the
upload page, depending on the dashboard version) paste:

> SubSell replies to the developer's OWN Facebook Marketplace buyer messages. It
> only runs on messenger.com / facebook.com and only acts in the account of the
> person who installed it. To see it work: install, open Options, enter an
> Anthropic API key, switch it ON in the popup and open messenger.com/marketplace
> with an account that has Marketplace conversations. Demo video: <link>.
> A test Messenger account can be provided on request.

Record a 60-second screen video (the popup ON, a buyer message arriving, the reply
being typed, the Options page) and upload it unlisted to YouTube or Drive; put the
link in that field. This is the single most effective thing against a rejection.

Typical rejection names and the answer:
- **Blue Argon** (functionality not working / cannot be verified): the note and the
  video above; offer a test account.
- **Purple Potassium** (unused or excessive permissions): the store build carries only
  the seven permissions in the table; `debugger`, `activeTab` and `<all_urls>` are not
  in it. Paste the table.
- **Yellow Magnesium / Purple Lithium** (privacy): the policy URL above is live and
  names the data handled (message content, API key, cloud login) and that nothing is
  sold or shared.
- **Red Nickel / spam & placement**: the listing describes exactly what it does; the
  item is Unlisted and used by one business.
- **Remote code**: none — every line ships in the package; the dashboard's "Try it"
  box fetches `background.js` from the dashboard's own site, not the other way round.
