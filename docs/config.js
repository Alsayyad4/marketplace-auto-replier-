/* SubSell dashboard — fill these with YOUR values.
 *
 * The two SUPABASE_* values are safe to expose publicly: the anon key grants
 * nothing without a valid login, and Row-Level Security protects each account's
 * row. Never put the service_role key here. See ../supabase/README.md.
 */

/* ---- Supabase (cloud login + per-account config URL) ---- */
window.SUBSELL_SUPABASE_URL = "https://tcqunihripihroseswgy.supabase.co";
window.SUBSELL_SUPABASE_ANON_KEY = "sb_publishable_arlG6dkWL4H7PPW0xVMIUw_3CNzUc8R"; // publishable (public) key — safe to ship

/* ---- "Add to Chrome" button ----
 * After you publish the extension to the Chrome Web Store, paste the listing URL
 * here (looks like https://chromewebstore.google.com/detail/<name>/<id>). The big
 * "Add to Chrome" button then sends people straight to it. Until it's filled in,
 * the page shows the manual "Load unpacked" steps instead.
 * See ../store/STORE-SUBMISSION.md for how to publish. */
window.SUBSELL_WEBSTORE_URL = ""; // e.g. "https://chromewebstore.google.com/detail/subsell-auto-reply/abcdefghijklmnop"

/* ---- Manual-install download (used before the Web Store listing is live) ----
 * The .zip of the extension source. Default points at this repo's main branch;
 * change it if you host the build elsewhere. */
window.SUBSELL_DOWNLOAD_ZIP_URL =
  "https://github.com/Alsayyad4/marketplace-auto-replier-/archive/refs/heads/main.zip";
