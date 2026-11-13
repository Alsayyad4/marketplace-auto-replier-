// node render-ghl.js > teaching-v28-gohighlevel.md — the v28 teaching as ONE platform-neutral text file for a
// GoHighLevel Conversation AI bot (filled by Claude in claude.ai from this file). Every fact and rule of
// teaching28.js is kept; what goes is the extension's own machinery: the [VISIT:yes] / [CLIP] / [SKIP] / [GAP] /
// [HUMAN] tags, the memory note, the dashboard boxes, the demo video (no media is sent from a GHL chat).
const t = require("./teaching28.js");
const nl = "\n";
const fix = (s) => String(s)
  .split('You: "[SKIP]"').join("You: (no reply)")
  // the extension's silent tags
  .replace(/start it with \[VISIT:yes\]\.?\s*/g, "")
  .replace(/the text that starts with \[VISIT:yes\]/g, "the text where they say they are coming")
  .replace(/\[VISIT:yes\] text/g, "text where they say they are coming")
  .replace(/\(\[VISIT:yes\], or a last text/g, "(a visit set, or a last text")
  .replace(/\[VISIT:yes\]/g, "a visit")
  .replace(/\[SKIP\] \(it costs nothing\)/g, "no reply at all")
  .replace(/is \[SKIP\]/g, "gets no reply at all")
  .replace(/: \[SKIP\] when/g, ": no reply when")
  .replace(/\[SKIP\] if/g, "no reply if")
  .replace(/After a close: \[SKIP\]\./g, "After a close: no reply.")
  .replace(/\("ok", "merci", "👍"\): \[SKIP\]\./g, "(\"ok\", \"merci\", \"👍\"): no reply.")
  .replace(/\[SKIP\]/g, "no reply")
  .replace(/, no \[GAP\] for it/g, "")
  .replace(/A note saying the price list has no row for this exact model means exactly this: the family line or the block is the answer\. /g, "")
  .replace(/\[HUMAN\] only for a real scam/g, "Stop answering and leave the conversation to a person only for a real scam")
  // the memory note and the dashboard
  .replace(/The note that comes with a message tells you which text this is and when it is your last; without a note, count your own "You:" lines in the chat above, the third is the last\./g, "Count your own earlier messages in the conversation: the third is the last.")
  .replace(/the note you receive about what you already told them is an order, and so is your own reading of your earlier texts/g, "your own reading of your earlier messages is an order")
  .replace(/never one the note says you just used, /g, "")
  .replace(/Use the clock you are given\./g, "Use the current Montréal time.")
  .replace(/You know their model from the post you are told about, so you never ask which model, colour or capacity they want\./g, "When the ad they write from or their first message names the model, you never ask which model, colour or capacity they want; when no model is known at all, one short question for the model is the first text's only question.")
  .replace(/You answer the Marketplace buyers of Liquidation Téléphone Montréal between two customers/g, "You answer the buyers who write to Liquidation Téléphone Montréal on Facebook, Instagram or by text, between two customers")
  .replace(/Facebook Marketplace/g, "Facebook, Instagram or text")
  // the demo video: nothing is sent from this chat
  .replace(/- A video or photos asked \("je peux voir une vidéo\?", "t'as des photos\?", "can you show me\?"\): start that text with \[CLIP\], the short demo video goes out by itself right before your words, once per chat; say in a few words that a short video is coming and still answer them\. Never \[CLIP\] otherwise, never promise a video without it, never send a video, a photo or a link yourself\./g,
    "- A video or photos asked (\"je peux voir une vidéo?\", \"t'as des photos?\", \"can you show me?\"): no photo, video or link is ever sent from this chat and none is promised; they see the phones in hand at the shop, several of the same model to compare, then one step to the door.")
  .replace(/\[CLIP\] oui, je t'envoie une petite vidéo\. le 13 est en liquidation cette semaine,/g, "pas de vidéo par ici, mais tu le vois en main au magasin, plusieurs 13 à comparer. le 13 est en liquidation cette semaine,")
  .replace(/\[CLIP\] sure, here's a short video of the phones\. honestly the best is to see them in hand, several S23 Ultras to compare, the shop's open till 9/g, "no pics from here, honestly the best is to see them in hand, several S23 Ultras to compare, the shop's open till 9")
  .replace(/Buyer: "ok c'est combien le 14\? pis je peux voir une vidéo\?"\nYou: "\[CLIP\] je t'envoie une petite vidéo\. les prix de départ du 14 sont en haut,/g, "Buyer: \"ok c'est combien le 14? pis je peux voir une vidéo?\"\nYou: \"pas de vidéo par ici, tu le vois en main au magasin. les prix de départ du 14 sont en haut,")
  .replace(/Listing ([^,\n]+), ad price 1 \$, it is/g, "The buyer writes from the ad \"$1\" (its price is only the ad's), it is")
  .replace(/Listing ([^,\n]+), it is/g, "The buyer writes from the ad \"$1\", it is")
  .replace(/No listing, it is/g, "No ad, it is")
  .replace(/Every chat below is one buyer, in their own order, three texts at most\. "You:" is what you send, one short text at a time\./g, "Every chat below is one buyer, in their own order, three texts at most. \"You:\" is what you send, one short text at a time; \"(no reply)\" means the assistant stays silent.")
  .replace(/You: "\[SKIP\]"/g, "You: (no reply)");

const out = [];
out.push("# Liquidation Téléphone Montréal — teaching for the GoHighLevel Conversation AI (v28, Nov 2026)");
out.push("");
out.push("HOW TO USE THIS FILE (for the assistant filling GoHighLevel): this is the complete teaching of the shop's chat assistant. Fill the Conversation AI bot with it, field by field: the bot's name is \"Liquidation Téléphone Montréal\" (never another name, never a website); section 1 is the business knowledge; section 2 is the personality and the rules of every reply; section 3 is the usual questions and their answers; section 4 is the example conversations; section 5 is the goal; section 6 is the price list. Keep every fixed sentence exactly as written: the fine print (French and English), the lower-budget line (French and English), the price lines and blocks, the street number 7️⃣5️⃣7️⃣ rue Beaubien E and the phone numbers in their keycap digits. Add nothing that is not in this file. If a field has a length limit, keep in this order: the price list, the fine print, the lower-budget line, THREE TEXTS PER BUYER, WORDS THAT NEVER GO TO A BUYER, then the rest. The assistant never sends photos, videos or links: there is no media in this channel.");
out.push("");
out.push("## 1. Business knowledge");
out.push("");
out.push("Business name: " + t.businessName);
out.push("Address: " + t.businessAddress);
out.push("Hours: " + t.businessHoursText);
out.push("");
const info = fix(t.businessInfo);
const qAt = info.indexOf("THE USUAL QUESTIONS");
out.push(info.slice(0, qAt).trim());
out.push("");
out.push("## 2. Personality and the rules of every reply");
out.push("");
out.push(fix(t.instructions));
out.push("");
out.push("## 3. The usual questions (the facts; the shape is in section 2)");
out.push("");
out.push(info.slice(qAt).replace(/^THE USUAL QUESTIONS \(the facts; the shape is in the instructions\)\n/, "").trim());
out.push("");
out.push("## 4. Example conversations");
out.push("");
out.push(fix(t.examples));
out.push("");
out.push("## 5. The goal");
out.push("");
out.push(fix(t.closerGoals));
out.push("");
out.push("## 6. Price list (the fixed lines and blocks, exactly as written)");
out.push("");
out.push(t.priceList);
out.push("");
const text = out.join(nl);
const left = text.match(/\[(VISIT|CLIP|SKIP|GAP|HUMAN)[^\]]*\]/g) || [];
if (left.length) { console.error("LEFTOVER TAGS: " + left.join(" ")); process.exit(1); }
if (/dashboard|the note you receive|note that comes|Marketplace(?! ad)/.test(text)) { console.error("LEFTOVER machinery words"); process.exit(1); }
process.stdout.write(text);
