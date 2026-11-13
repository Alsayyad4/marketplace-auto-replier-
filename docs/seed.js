/* The starter setup the dashboard puts back into an EMPTY account.
 *
 * MUST stay byte-identical to SEED_CONFIG in background.js (store/smoke-seed.js
 * fails the build if they drift). (v0.21.94) Brand-neutral on purpose: the Marketplace
 * shop is Liquidation Téléphone Montréal and nothing else — nothing from the SubSell
 * website (subselltrade.ca) may be in here: no warranty terms, no reservation, no
 * reviews, no clips. The owner pastes the teaching; the clips live in the Videos tab.
 * No API key, no per-machine keys, no prices, no listings.
 */
window.SUBSELL_SEED = {
  model: "claude-haiku-4-5",
  businessName: "Liquidation Téléphone Montréal",
  businessAddress: "757 Rue Beaubien E, Montréal (métro Beaubien)",
  businessHoursText: "9h à 21h (9am to 9pm), 7 jours sur 7",
  businessInfo:
    "Liquidation Téléphone Montréal: refurbished, used and brand-new phones, tablets and laptops at liquidation prices. " +
    "757 Rue Beaubien E, Montréal, right beside métro Beaubien, open 9h à 21h (9am to 9pm), 7 days a week, no appointment needed. " +
    "Buyers test the device in hand and pay at the counter, nothing before. Everything else the bot may say comes from the owner's " +
    "teaching in the web app (Business tab): paste it there after a reset.",
  demoVideoUrls: [],
};
