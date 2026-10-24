/* SubSell — the starter setup the dashboard puts back into an EMPTY account.
 *
 * MUST stay byte-identical to SEED_CONFIG in background.js (store/smoke-seed.js
 * fails the build if they drift). Every fact traces to the SubSell website repo;
 * see supabase/RECOVERY.md for the per-fact sources. No API key, no per-machine
 * keys, no prices, no listings — see the comments in background.js for why.
 */
window.SUBSELL_SEED = {
  model: "claude-haiku-4-5",
  businessName: "SubSell",
  businessAddress: "757 Rue Beaubien Est, Montréal (Rosemont – La Petite-Patrie), 30 seconds from Métro Beaubien",
  businessHoursText: "9AM–9PM, 7 days",
  businessInfo:
    "SubSell is an independent used & refurbished phone shop in Montréal, open since 2017, at 757 Rue Beaubien Est " +
    "(Rosemont – La Petite-Patrie), 30 seconds on foot from Métro Beaubien (orange line). Open 7 days a week, " +
    "9 AM to 9 PM, no appointment needed. Bilingual French/English. Metered parking on Beaubien Est, free " +
    "side-street parking after 6 PM; bus 18 runs along Beaubien; bike rack in front. " +
    "Every iPhone we sell is unlocked, tested on 30+ points, and comes with a 6-month SubSell warranty plus " +
    "accessories (charger, case, screen protector already installed). 7-day exchange for another model of equal " +
    "or higher value (price difference payable, phone returned in the condition it was sold). A phone can be " +
    "reserved free for 24 hours with no deposit through the website — nothing is paid online; the buyer sees the " +
    "exact phone, tests it with us (screen, battery, cameras, Face ID, network) and pays in person only once " +
    "satisfied. We also BUY used phones and pay cash the same day (or instant Interac e-Transfer) — when we buy or " +
    "trade in, never store credit, never gift cards. Trade-ins welcome, including cross-brand (e.g. Samsung → " +
    "iPhone): the old phone's value comes off the price and the buyer pays only the difference — and if their " +
    "phone is worth more, we pay them the difference in cash. We also buy Samsung Galaxy, iPads, MacBooks, Apple " +
    "Watch and game consoles; iCloud-locked phones cannot be bought, and government photo ID is required on every " +
    "purchase. 1,500+ Google reviews at 4.9/5.",
  demoVideoUrls: [
    {
      name: "Video_iPhone.mp4",
      url: "https://tcqunihripihroseswgy.supabase.co/storage/v1/object/public/subsell-videos/3983744e-d577-4be1-8bd7-0a53f68071af/1780943854937-Video_iPhone.mp4",
    },
    {
      name: "WhatsApp Video 2026-07-06.mp4",
      url: "https://tcqunihripihroseswgy.supabase.co/storage/v1/object/public/subsell-videos/3983744e-d577-4be1-8bd7-0a53f68071af/1783399350640-WhatsApp_Video_2026-07-06_at_9.35.54_PM.mp4",
    },
  ],
};
