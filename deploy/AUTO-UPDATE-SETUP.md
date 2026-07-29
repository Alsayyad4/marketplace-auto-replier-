# SubSell — built-in auto-update (v0.20.0+) · NO scripts, NO antivirus flags

The previous .bat/scheduled-task installer is **deprecated** — Windows Defender
(correctly) dislikes download-and-persist scripts. The updater now lives INSIDE
the extension and uses only Chrome's own APIs: nothing for antivirus to flag.

## How it works

Every hour the extension checks the repo for a newer version (a ~1KB fetch).
When one exists, it downloads its own files through Chrome's downloads system
into its unpacked folder and reloads itself — never while a reply/video send is
in progress. There is also an **"⬇ Update now"** button in the popup.

**The one requirement:** the unpacked extension folder must live inside the
folder **Chrome saves downloads to** (that's the only place Chrome lets
extensions write files — usually `Downloads`, but OneDrive can move it). The
folder name is flexible: the standard names (`subsell-extension`,
`subsell-installer`, Extract-All nesting, ` (1)`/` (2)` re-download variants)
work out of the box, and opening the popup once teaches the updater the real
folder name even if it was renamed.

The extension verifies the folder with a probe file (`sud-probe.txt` — the name
must never start with a dot; Chrome rejects dot-file downloads as "Invalid
filename", which is what silently killed the updater before v0.21.6). If the
folder can't be verified, the update button now names the exact download folder
Chrome uses and the folder names it tried.

## Per computer

**Machine that already has SubSell loaded** (~60 seconds — do NOT remove the
extension; removing it erases its saved settings/API key):

1. Download the zip:
   https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/dist/subsell-extension.zip
2. Right-click the zip → **Extract All…** → open the extracted folders until
   you see `manifest.json`.
3. Select **all** files there → Copy → Paste into the folder that is loaded in
   `chrome://extensions` (shown under "Loaded from" on the SubSell card) →
   **Replace the files**. The bot notices the new files and restarts itself
   within ~10 minutes (or click ⟳ on the SubSell card to make it instant).
4. Open the popup → click **⬇ Update now** → it should say "Up to date ✓".

**Brand-new machine:**

1. Download the same zip **into Downloads** and Extract All.
2. `chrome://extensions` → Developer mode ON → **Load unpacked** → pick the
   extracted folder that contains `manifest.json`.
3. Paste the config link + API key in Options, open the popup → **⬇ Update now**.

Done. That computer now updates itself forever (hourly check + on-demand button).
Facebook logins and chat memory live in the Chrome profile and are never touched.

## Rollout / verification

The dashboard's **Activity** tab shows each machine as `Label · vX.Y.Z` — one
glance shows which computers are current.

## Deprecated files (kept for reference only — do not use)

- `install-subsell-auto-update.bat` / `update-subsell.ps1` / `update-subsell.bat`
  — the old OS-level updater; flagged by Defender because downloading scripts +
  hidden scheduled tasks is indistinguishable from malware behavior.
- `DEPLOY.md` / `subsell-policy.reg` / `update.xml` — enterprise-policy route;
  needs company-managed Windows.
