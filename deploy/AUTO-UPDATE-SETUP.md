# SubSell — automatic updates on every computer (one-time setup, ~3 min/machine)

After this setup, you NEVER touch zips or "Load unpacked" again. When a new
version is pushed to GitHub, each computer downloads it on a schedule and the
extension **reloads itself** (only when it isn't mid-reply). Zero clicks.

Why this design: Chrome forbids extensions from running code fetched from the
internet, so updates must arrive as files on disk. A tiny scheduled task does the
downloading; the extension (v0.18.2+) watches its own folder and restarts itself
when new files land.

## One-time setup per computer

1. **Create the fixed folder** `C:\subsell-extension`
   and put the current extension files in it (unzip the download so that
   `manifest.json` is directly inside `C:\subsell-extension`).

2. **Point Chrome at that folder** (once):
   - `chrome://extensions` → remove the old SubSell entry
   - Developer mode ON → **Load unpacked** → choose `C:\subsell-extension`
   - Your settings/login are kept (they live in Chrome's storage, not the folder).

3. **Save the updater script**: copy `update-subsell.bat` (from this deploy/
   folder, or out of the zip) to `C:\subsell-extension-updater\update-subsell.bat`.

4. **Schedule it** — open Command Prompt **as Administrator** and paste:

   ```
   schtasks /Create /SC HOURLY /TN "SubSell Update" /TR "C:\subsell-extension-updater\update-subsell.bat" /F
   ```

   (Hourly is fine — the script is tiny and does nothing when there's no new
   version worth applying; the extension only reloads when the version number
   actually changed.)

5. **Test it once**: double-click `update-subsell.bat` → it should print
   `SubSell updated in C:\subsell-extension`. Within ~10 minutes the extension
   reloads itself if the downloaded version is newer (instantly testable via
   `chrome://extensions` → the version number).

## How an update rolls out after this

1. A new version is pushed to GitHub (same link as always).
2. Within the hour, each computer's task downloads it into `C:\subsell-extension`.
3. Within ~10 more minutes, each extension notices the new version on disk and
   reloads itself — skipping the reload while a reply/video send is in progress.
4. `chrome://extensions` shows the new version everywhere. Done.

## Notes

- **Rollback** stays trivial: run the same .bat with the pinned 0.16.0 URL, or
  unzip any older build into `C:\subsell-extension` — the extension "updates"
  onto that older version the same way.
- The updater never deletes your settings — those live in Chrome profile
  storage, not in the folder.
- If a download fails (no internet, GitHub hiccup), the script leaves the
  current installation untouched and tries again next hour.
