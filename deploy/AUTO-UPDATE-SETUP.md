# SubSell — fleet auto-update (ONE double-click per computer)

For fleets of any size (10 or 500 computers). No admin rights, no folder moves,
no chrome://extensions steps, no re-login. One file, one double-click, done.

## Per computer (once, ~30 seconds)

1. Download the installer on that computer:

   **https://github.com/alsayyad4/marketplace-auto-replier-/raw/claude/wizardly-noether-Oi6vP/deploy/install-subsell-auto-update.bat**

2. **Double-click it.** It automatically:
   - finds SubSell wherever it's installed (any folder, any Chrome profile),
   - updates it to the latest version right now,
   - sets an hourly task so this computer keeps itself updated forever
     (falls back to update-at-login if task creation is blocked).

3. **First time only:** if the machine was running a version older than 0.18.2,
   restart Chrome once (or click the reload arrow on `chrome://extensions`).
   Every update after that applies fully automatically.

## How updates roll out afterwards

Push a new version to GitHub → within ~1 hour every computer downloads it →
the extension notices the new files and reloads itself (never mid-reply).
Nobody touches anything.

- Settings, logins, chat memory: untouched (they live in Chrome's profile).
- Failed download (offline, GitHub hiccup): current version stays; retries hourly.
- Rollback: point `update-subsell.ps1`'s `$zipUrl` at the pinned
  `subsell-extension-0.16.0.zip` link and the fleet rolls back the same way.

## Files

- `install-subsell-auto-update.bat` — the one-time installer (double-click).
- `update-subsell.ps1` — the updater it installs (runs hidden, hourly).

The old `DEPLOY.md` / `subsell-policy.reg` / `update.xml` enterprise-policy route
requires company-managed Windows and is superseded by this.
