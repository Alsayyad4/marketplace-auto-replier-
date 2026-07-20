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
user's **Downloads** folder (that's the only place Chrome lets extensions write
files). Both layouts work:

- `Downloads\subsell-extension\manifest.json`
- `Downloads\subsell-extension\subsell-extension\manifest.json` (Extract-All nesting)

The extension verifies the folder with a probe file — it never guesses. If the
folder is elsewhere, the popup's update button says so instead of failing silently.

## Per computer (once, ~60 seconds, AV-clean)

1. Download the extension zip **into Downloads** (the default):
   https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/dist/subsell-extension.zip
2. Right-click the zip → **Extract All…** → Extract (defaults are fine).
3. `chrome://extensions` → remove the old SubSell → Developer mode ON →
   **Load unpacked** → pick the extracted folder that contains `manifest.json`.
4. Open the popup → click **⬇ Update now** → it should say "Up to date ✓".

Done. That computer now updates itself forever (hourly check + on-demand button).
Settings, logins, chat memory: untouched (they live in Chrome's profile).

## Rollout / verification

The dashboard's **Activity** tab shows each machine as `Label · vX.Y.Z` — one
glance shows which computers are current.

## Deprecated files (kept for reference only — do not use)

- `install-subsell-auto-update.bat` / `update-subsell.ps1` / `update-subsell.bat`
  — the old OS-level updater; flagged by Defender because downloading scripts +
  hidden scheduled tasks is indistinguishable from malware behavior.
- `DEPLOY.md` / `subsell-policy.reg` / `update.xml` — enterprise-policy route;
  needs company-managed Windows.
