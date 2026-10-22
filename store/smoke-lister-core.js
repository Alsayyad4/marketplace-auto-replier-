/* AUTOLISTER — the pure core under test (lister/PLAN.md WP-A).
 *
 * Why this file exists: everything the lister decides without touching Facebook — what a
 * listing is, which Marketplace words to pick, the tags, the headline and description built
 * from the owner's library, when the next action may happen, renew vs rebuild — lives in
 * lister/lister-core.js so four hosts (service worker, content scripts, composer page,
 * dashboard) share one truth. This suite loads that file with require() and checks every
 * export; it needs no browser and no network.
 *
 * Run:  node store/smoke-lister-core.js
 */
const fs = require("fs");
const path = require("path");
const core = require(path.join(__dirname, "..", "lister", "lister-core.js"));
const starter = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "lister", "library-starter.json"), "utf8"));

let failed = 0, passed = 0;
const ok = (cond, msg, detail) => { if (cond) passed++; else failed++; console.log((cond ? "  PASS  " : "  FAIL  ") + msg + (cond || detail == null ? "" : " — " + detail)); };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const T0 = new Date("2026-10-21T10:00:00").getTime(); // a Wednesday, 10:00 local
const MIN = 60 * 1000;

/* 1 — the file is pure and loads everywhere */
const src = fs.readFileSync(path.join(__dirname, "..", "lister", "lister-core.js"), "utf8");
ok(!/chrome\.[a-zA-Z]/.test(src), "core touches no chrome API");
ok(!/\bdocument\.|\bwindow\./.test(src), "core touches no DOM");
ok(!/\bfetch\(/.test(src), "core makes no network call");
ok(typeof core.VERSION === "string" && core.CATEGORY_IDS.length === 12, "12 categories exported", core.CATEGORY_IDS.join(","));

/* 2 — categories, Marketplace words, inference */
ok(core.CATEGORIES.iphone.marketplace.en[0] === "Mobile Phones" && core.CATEGORIES.console.marketplace.en[0] === "Video Games" && core.CATEGORIES.macbook.marketplace.en[0] === "Electronics & Computers", "the 2026 Marketplace leaf names");
ok(core.CATEGORIES.iphone.marketplace.fr.includes("Téléphones cellulaires"), "FR alternates present");
const infer = {
  "iPhone 15 Pro Max 256GB": "iphone", "Samsung Galaxy S23 Ultra 256": "samsung", "Galaxy Tab S9": "tablet", "Apple Watch Series 9": "watch",
  "iPad Air M2 128GB": "ipad", "MacBook Pro 14 M3": "macbook", "Dell XPS 13 i7": "laptop", "PS5 Slim 1TB": "console", "Google Pixel 8": "phone",
  "Étui iPhone 15 Pro": "accessory", "AirPods Pro 2": "accessory", "Lampe de bureau": "other", "Ordinateur gaming PC tour RTX": "desktop",
};
for (const [t, want] of Object.entries(infer)) ok(core.inferCategory(t) === want, "inferCategory(" + JSON.stringify(t) + ") = " + want, core.inferCategory(t));

/* 3 — conditions */
ok(core.conditionForGrade("A") === "Used - Like New" && core.conditionForGrade("New") === "New" && core.conditionForGrade("C") === "Used - Fair", "grade → Marketplace condition");
ok(core.gradeFromCondition("Used (like new)") === "A" && core.gradeFromCondition("Utilisé - Bon état") === "B" && core.gradeFromCondition("Neuf") === "New" && core.gradeFromCondition("used - fair") === "C", "Facebook's drifting wording → grade");
ok(core.CONDITION_PATTERNS["New"].test("New") && !core.CONDITION_PATTERNS["New"].test("Used - Like New"), "'New' never matches 'Used - Like New'");
ok(core.AVAILABILITY.single.pattern.test("List as single item") && core.AVAILABILITY.instock.pattern.test("En stock"), "availability patterns EN/FR");

/* 4 — the record: defaults, sku, validation */
const rand = seq([0.1, 0.5, 0.9, 0.3, 0.7]);
const l = core.newListing({ category: "iphone", item: { model: "iPhone 15 Pro Max", storage: "256GB", color: "Natural Titanium", grade: "A" }, fb: { price: 900, location: "Ville Saint-Laurent" }, photos: [{ url: "u1" }], created_by: "PC-abc12" }, { now: T0, rand });
ok(/^[0-9a-f-]{36}$/.test(l.id), "newListing makes a uuid-shaped id", l.id);
ok(l.fb.sku === core.skuOf(l.id) && /^SS-[0-9A-F]{8}$/.test(l.fb.sku), "the SKU is SS- + 8 hex of the id", l.fb.sku);
ok(core.skuMatchesId(l.fb.sku, l.id) && core.idFromSku("ss-deadbeef") === "deadbeef" && core.idFromSku("ABC") === null, "sku ↔ id round trip");
ok(l.fb.category === "Mobile Phones" && l.fb.condition === "Used - Like New" && l.fb.availability === "single" && l.item.brand === "Apple", "defaults by category and grade");
ok(l.history.length === 1 && l.history[0].event === "created" && l.history[0].machine === "PC-abc12", "a created history line");
ok(l.status === "draft" && l.target.machine === "any" && l.relist.count === 0 && l.tries.form === 0, "status/target/relist/tries defaults");
const blank = core.newListing({}, { now: T0, rand });
ok(blank.category === "other" && blank.fb.availability === "single", "an empty listing is 'other'");
ok(core.newListing({ fb: { title: "AirPods Pro 2" } }, { now: T0, rand }).category === "accessory", "category inferred from the title when not given");
let v = core.validateListing(l);
ok(!v.ok && v.problems.includes("no title"), "a listing without a title is refused", v.problems.join("; "));
l.fb.title = "iPhone 15 Pro Max 256GB — 900$";
v = core.validateListing(l);
ok(v.ok, "a complete listing passes", v.problems.join("; "));
const bad = JSON.parse(JSON.stringify(l));
bad.photos = []; bad.fb.price = -1; bad.fb.condition = "Mint"; bad.fb.tags = new Array(21).fill("x"); bad.fb.sku = "ABC"; bad.fb.location = "";
v = core.validateListing(bad);
ok(["no photo", "price missing", "condition is not a Marketplace option", "more than 20 tags", "sku is not ours", "no location"].every((p) => v.problems.includes(p)), "every refusal reason is named", v.problems.join("; "));
ok(core.validateListing({ fb: { title: "x".repeat(101), price: 1, condition: "New", location: "L", availability: "single" }, category: "other", photos: [{}] }).problems.includes("title longer than 100"), "title limit 100");

/* 5 — tags */
ok(core.modelTokens("iPhone 15 Pro Max").join("|") === "iphone 15 pro max|iphone 15|15 pro max|15", "model tokens for an iPhone: full, family, variant, number", core.modelTokens("iPhone 15 Pro Max").join("|"));
ok(core.modelTokens("Samsung Galaxy S23 Ultra").includes("galaxy s23 ultra") && core.modelTokens("Samsung Galaxy S23 Ultra").includes("s23 ultra") && core.modelTokens("Samsung Galaxy S23 Ultra").includes("galaxy s23"), "model tokens for a Samsung", core.modelTokens("Samsung Galaxy S23 Ultra").join("|"));
ok(core.storageTokens("256GB").join("|") === "256gb|256 go" && core.storageTokens("1TB").join("|") === "1tb|1 to" && core.storageTokens("1 To").join("|") === "1tb|1 to", "storage tokens EN/FR");
const tags = core.tagsFor(l);
ok(tags.length <= 20 && tags[0] === "iphone 15 pro max" && tags.includes("256gb") && tags.includes("apple") && tags.includes("montreal") && tags.includes("like new") && tags.includes("natural titanium"), "iPhone tags: model first, storage, category set, colour, condition, city", tags.join(", "));
ok(new Set(tags).size === tags.length && tags.every((t) => t === t.toLowerCase() && t.length <= 30), "tags are unique, lowercase, ≤ 30 chars");
const sam = core.newListing({ category: "samsung", item: { model: "Samsung Galaxy S23 Ultra", storage: "512GB", grade: "B" }, fb: { price: 600 } }, { now: T0, rand });
const samTags = core.tagsFor(sam, { tagSets: { samsung: ["samsung", "galaxy", "android", "téléphone"] }, cityWords: ["laval"] });
ok(samTags.includes("samsung galaxy s23 ultra") && samTags.includes("laval") && samTags.includes("good condition") && samTags.includes("bon état") && !samTags.includes("montreal"), "owner's tag set + city words override the defaults", samTags.join(", "));
const many = core.tagsFor(core.newListing({ category: "iphone", item: { model: "Apple iPhone 14 Pro Max", storage: "1TB", color: "Deep Purple", grade: "C" } }, { now: T0, rand }), { cityWords: ["montreal", "montréal", "laval", "longueuil", "ville saint-laurent", "rive-sud", "rive-nord", "brossard"] });
ok(many.length === 20 && many[0] === "apple iphone 14 pro max" && many.includes("iphone 14"), "the cap keeps the model and cuts the tail", many.join(", "));

/* 6 — templates */
const s = core.settingsWith({ defaultCity: "Ville Saint-Laurent" });
ok(core.looksFrench("{model} {storage} — {price}$ — débloqué, garantie") && !core.looksFrench("{model} {storage} — ${price} — unlocked"), "FR/EN detection on a template");
const t1 = core.fillTemplate("{model} {storage} {color} — {price}$ — débloqué, {warranty}", l, s, { mode: "title" });
ok(t1 === "iPhone 15 Pro Max 256GB Natural Titanium — 900$ — débloqué, garantie 1 an + réseau à vie", "a title fills every placeholder", t1);
const noColor = core.newListing({ category: "iphone", item: { model: "iPhone 13", storage: "128GB", grade: "B" }, fb: { price: 400 } }, { now: T0, rand });
const t2 = core.fillTemplate("{model} {storage} — {color} — {price}$ — {city}", noColor, s, { mode: "title" });
ok(t2 === "iPhone 13 128GB — 400$ — Ville Saint-Laurent", "a title segment with an empty placeholder is dropped whole", t2);
const t3 = core.fillTemplate("{model} {storage} en {color} — {price}$", noColor, s, { mode: "title" });
ok(t3 === "400$" || t3 === "", "a segment that mixes a filled and an empty placeholder is dropped (no 'en')", t3);
const d1 = core.fillTemplate("{model} {storage} à vendre, {price}$. Couleur {color}. Grade {grade}, {condition}. {warranty}.", noColor, s);
ok(d1 === "iPhone 13 128GB à vendre, 400$. Grade B, bon état. garantie 1 an + réseau à vie.", "a description sentence with an empty placeholder is dropped; FR condition words", d1);
const d2 = core.fillTemplate("{model} for sale, ${price}. Condition: {condition}. {shop}, {city} — {hours}.", noColor, s, { lang: "en" });
ok(d2 === "iPhone 13 for sale, $400. Condition: good condition. SubSell, Ville Saint-Laurent — 9 AM to 9 PM, 7 days a week.", "EN condition words, shop, city, hours", d2);
const d3 = core.fillTemplate("Ligne un.\nLigne {color}.\nLigne trois.", noColor, s);
ok(d3 === "Ligne un. Ligne trois.", "line-separated units work too", d3);
const zero = core.newListing({ category: "iphone", item: { model: "iPhone 12" }, fb: { price: 0 } }, { now: T0, rand });
ok(core.fillTemplate("{model} — {price}$", zero, s, { mode: "title" }) === "iPhone 12", "a zero price counts as empty (never '0$')");

/* 7 — the library: rotation, title/description helpers, starter pack */
const items = [{ id: "a", text: "A {model}", lang: "fr" }, { id: "b", text: "B {model}", lang: "en" }, { id: "c", text: "C {model}", lang: "bi" }];
ok(core.pickFromLibrary(items, {}).id === "a", "never used → the first");
ok(core.pickFromLibrary(items, { a: 5, b: 3, c: 9 }).id === "b", "least recently used wins");
ok(core.pickFromLibrary(items, { a: 1, b: 1, c: 1 }, { avoidId: "a" }).id === "b", "the line used just before is skipped");
ok(core.pickFromLibrary(items, {}, { lang: "en" }).id === "b" && core.pickFromLibrary(items, { b: 1 }, { lang: "en" }).id === "c", "language filter keeps 'bi' lines");
ok(core.pickFromLibrary([items[0]], { a: 1 }, { avoidId: "a" }).id === "a", "a one-line library still answers");
const lib = { headlines: { iphone: starter.headlines.iphone.map((h, i) => Object.assign({ id: "h" + i }, h)) }, descriptions: { iphone: starter.descriptions.iphone.map((d, i) => Object.assign({ id: "d" + i }, d)) } };
const h = core.titleFor(l, lib, {}, s);
ok(h && h.id === "h0" && h.text.startsWith("iPhone 15 Pro Max 256GB Natural Titanium — 900$") && h.text.length <= 100, "titleFor fills the first unused headline", h && h.text);
const h2 = core.titleFor(l, lib, { h0: T0 }, s, { avoidId: "h0" });
ok(h2 && h2.id === "h1", "the next title rotates", h2 && h2.id);
const dsc = core.descriptionFor(l, lib, {}, s);
ok(dsc && dsc.text.includes("900$") && dsc.text.includes("Ville Saint-Laurent") && !/\{[a-z]+\}/.test(dsc.text), "descriptionFor leaves no placeholder", dsc && dsc.text.slice(0, 80));
const enOnly = core.newListing({ category: "iphone", item: { model: "iPhone 15", storage: "128GB", grade: "A" }, fb: { price: 700 }, copy: { lang: "en" } }, { now: T0, rand });
const he = core.titleFor(enOnly, lib, {}, s);
ok(he && lib.headlines.iphone.find((x) => x.id === he.id).lang === "en", "copy.lang = en picks an English headline", he && he.text);
ok(core.CATEGORY_IDS.every((c) => Array.isArray(starter.headlines[c]) && starter.headlines[c].length >= 6 && Array.isArray(starter.descriptions[c]) && starter.descriptions[c].length >= 2), "the starter pack covers every category");
ok(core.CATEGORY_IDS.every((c) => JSON.stringify(starter.tagSets[c]) === JSON.stringify(core.CATEGORIES[c].tags)), "starter tagSets equal the core's defaults (no drift)");
const banned = /\b(répar|repair|technicien|technician|diagnosti|same day|store credit|crédit magasin|retour|refund)\w*/i;
const allText = [].concat(...Object.values(starter.headlines), ...Object.values(starter.descriptions)).map((x) => x.text).join("\n");
ok(!banned.test(allText), "no banned SubSell wording in the starter pack", (banned.exec(allText) || [])[0]);
ok(/sur place/.test(allText) && /on the spot/.test(allText) && /comptant/.test(allText), "cash on the spot wording present");
const suggested = core.suggestPrice([{ model: "iPhone 15 Pro Max", storage: "256", price: 950, available: true }, { model: "iPhone 15", storage: "128", price: 700, available: true }], l.item);
ok(suggested === 950, "suggestPrice matches model + storage from the replier's Listings rows", suggested);
ok(core.suggestPrice([{ model: "iPhone 15 Pro Max", price: 950, available: false }], l.item) === null, "an unavailable row suggests nothing");

/* 8 — pacing */
const sp = { gapMin: 4, gapMax: 9, hours: [9, 21], dailyCreates: 10, dailyDeletes: 20, breakAfter: 5, breakMin: 20, breakMax: 40, warmupDays: 7, warmupCreates: 3 };
let slot = core.nextSlot({ items: [], firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.at === T0 && slot.why === "now", "nothing done yet, inside hours → now", slot.why);
slot = core.nextSlot({ items: [{ t: T0 - 1 * MIN, k: "create" }], firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.at >= T0 + 3 * MIN && slot.at <= T0 + 8 * MIN && slot.why === "gap", "one action a minute ago → wait the gap (4–9 min)", slot.why + " +" + Math.round(slot.waitMs / MIN) + "m");
const run = [];
for (let i = 5; i >= 1; i--) run.push({ t: T0 - i * 6 * MIN, k: "create" });
slot = core.nextSlot({ items: run, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.why === "break" && slot.at >= T0 + 14 * MIN - 6 * MIN && slot.at <= T0 + 40 * MIN, "five actions in a row → a break of 20–40 min", slot.why + " +" + Math.round(slot.waitMs / MIN) + "m");
const night = new Date("2026-10-21T23:30:00").getTime();
slot = core.nextSlot({ items: [], firstAt: T0 - 30 * 24 * 60 * MIN }, sp, night, "create");
ok(new Date(slot.at).getHours() === 9 && new Date(slot.at).getDate() === 22 && slot.why === "hours", "23:30 → tomorrow 09:00", new Date(slot.at).toString());
const early = new Date("2026-10-21T07:00:00").getTime();
slot = core.nextSlot({ items: [], firstAt: T0 - 30 * 24 * 60 * MIN }, sp, early, "create");
ok(new Date(slot.at).getHours() === 9 && new Date(slot.at).getDate() === 21, "07:00 → today 09:00");
const tenToday = [];
for (let i = 0; i < 10; i++) tenToday.push({ t: T0 - (i + 1) * 15 * MIN, k: "create" });
slot = core.nextSlot({ items: tenToday, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.why === "daily cap" && new Date(slot.at).getDate() === 22, "10 creates today → tomorrow", slot.why);
slot = core.nextSlot({ items: tenToday, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "renew");
ok(slot.why !== "daily cap" && new Date(slot.at).getDate() === 21 && slot.at <= T0 + 40 * MIN, "a renew waits a gap or a break today, never the create cap", slot.why);
const warm = [{ t: T0 - 60 * MIN, k: "create" }, { t: T0 - 50 * MIN, k: "create" }, { t: T0 - 40 * MIN, k: "create" }];
slot = core.nextSlot({ items: warm, firstAt: T0 - 60 * MIN }, sp, T0, "create");
ok(slot.why === "warm-up cap", "a computer on its first day stops at 3 creates", slot.why);
slot = core.nextSlot({ items: warm, firstAt: T0 - 10 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.why === "now" || slot.why === "gap", "the same three after the warm-up are fine", slot.why);
const dels = [];
for (let i = 0; i < 20; i++) dels.push({ t: T0 - (i + 1) * 10 * MIN, k: "delete" });
slot = core.nextSlot({ items: dels, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "delete");
ok(slot.why === "daily delete cap", "20 deletes today → tomorrow", slot.why);
ok(core.jitterMinutes(4, 9, "x") >= 4 && core.jitterMinutes(4, 9, "x") <= 9 && core.jitterMinutes(4, 9, "x") === core.jitterMinutes(4, 9, "x"), "jitter is bounded and deterministic for a seed");
const seeds = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => core.jitterMinutes(4, 9, k)));
ok(seeds.size >= 3, "jitter varies across seeds", [...seeds].join(","));

/* 9 — refresh planning (v1 bar = Rebuild; the smart Renew default is v2 behind preferRenew) */
const sel = [
  { fbListingId: "1", ageDays: 10, renewOffered: true, renewals: 1, ours: true },
  { fbListingId: "2", ageDays: 1, renewOffered: false, ours: false },
  { fbListingId: "3", ageDays: 40, renewOffered: false, renewals: 5, ours: true },
  { fbListingId: "4", ageDays: 30, renewOffered: true, sold: true },
];
const plan = core.planRefresh(sel, sp, { force: true });
ok(plan.jobs.map((j) => j.fbListingId).join(",") === "3,4,1,2", "oldest first", plan.jobs.map((j) => j.fbListingId).join(","));
ok(plan.jobs[0].action === "rebuild" && plan.jobs[2].action === "rebuild", "Rebuild pressed → rebuild, even when Renew is offered");
ok(plan.jobs[3].action === "skip" && /younger than 7 days/.test(plan.jobs[3].reason) && plan.jobs[3].young === true, "a listing younger than minRebuildAgeDays (7) is skipped", plan.jobs[3].reason);
ok(plan.jobs[1].action === "skip" && /Sold/.test(plan.jobs[1].reason), "a Sold/Pending card is skipped");
ok(plan.rebuilds === 2 && plan.skipped === 2 && plan.renews === 0 && plan.youngCount === 1, "counts are right", JSON.stringify([plan.rebuilds, plan.skipped, plan.renews, plan.youngCount]));
const perForce = core.planRefresh([{ fbListingId: "2", ageDays: 1, force: true }], sp, { force: true });
ok(perForce.jobs[0].action === "rebuild" && /forced by the owner/.test(perForce.jobs[0].reason), "force on the listing itself overrides the minimum age");
const smart = core.planRefresh(sel, sp, { preferRenew: true });
ok(smart.jobs.find((j) => j.fbListingId === "1").action === "renew" && smart.jobs.find((j) => j.fbListingId === "3").action === "rebuild", "v2 preferRenew: renew when offered, rebuild otherwise");
const older = core.planRefresh([{ fbListingId: "2", ageDays: 3 }], sp, { minAgeDays: 2 });
ok(older.jobs[0].action === "rebuild", "minAgeDays can be lowered per call");
const createAt = core.rebuildCreateAt(T0, sp, "x");
ok(createAt >= T0 + 45 * MIN && createAt <= T0 + 90 * MIN && createAt === core.rebuildCreateAt(T0, sp, "x"), "the re-post waits 45–90 min after the delete, deterministic per seed", Math.round((createAt - T0) / MIN) + "m");

/* 10 — atlas summary */
const line = core.atlasSummary({ kind: "create", lang: "fr", fields: [{ label: "Titre", role: "textbox" }, { label: "Prix" }, { role: "combobox" }], buttons: ["Suivant"], missing: ["Étiquettes"] });
ok(line === "create (fr) · fields: Titre, Prix, combobox · buttons: Suivant · missing: Étiquettes", "one readable line", line);

/* 11 — v2 additions: grade A+, the account defaults, the relist kind, history, stored photos */
ok(core.GRADES.join(",") === "New,A+,A,B,C" && core.conditionForGrade("A+") === "Used - Like New" && core.gradeFromCondition("Used - Like New") === "A", "grade A+ exists; a read-back of its words maps to A");
const D = core.DEFAULT_SETTINGS;
ok(D.gapMin === 12 && D.gapMax === 40 && D.dailyCreates === 4 && D.dailyDeletes === 4 && D.maxRebuildsPerDay === 3 && D.warmupDays === 14 && D.warmupCreates === 2 && D.minRebuildAgeDays === 7 && D.rebuildDelayMin === 45 && D.rebuildDelayMax === 90 && D.holdHoursOnBlock === 48 && D.unattended === false && D.region === "QC" && D.hold === null, "the shipped defaults are the poster's (PLAN 5.3)");
const relists = [{ t: T0 - 200 * MIN, k: "relist" }, { t: T0 - 150 * MIN, k: "relist" }, { t: T0 - 100 * MIN, k: "relist" }];
slot = core.nextSlot({ items: relists, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "relist");
ok(slot.why === "daily rebuild cap", "three rebuilds today → the fourth waits for tomorrow", slot.why);
slot = core.nextSlot({ items: relists, firstAt: T0 - 30 * 24 * 60 * MIN }, sp, T0, "create");
ok(slot.why === "now" || slot.why === "gap", "a plain create still fits under dailyCreates (10 in this test)", slot.why);
slot = core.nextSlot({ items: relists.concat([{ t: T0 - 90 * MIN, k: "create" }]), firstAt: T0 - 30 * 24 * 60 * MIN }, Object.assign({}, sp, { dailyCreates: 4 }), T0, "create");
ok(slot.why === "daily cap", "relists count as creates against dailyCreates", slot.why);
const h1 = core.newListing({ category: "iphone", item: { model: "iPhone 12" } }, { now: T0, rand });
for (let i = 0; i < 60; i++) core.pushHistory(h1, "renewed", "PC-x", i, T0 + i * MIN);
ok(h1.history.length === core.HISTORY_MAX && h1.history[0].detail === 10 && h1.history[49].detail === 59 && h1.updated_at === new Date(T0 + 59 * MIN).toISOString(), "history keeps the newest 50 lines and stamps updated_at");
ok(h1.relist.deletedAt === null && h1.job.step === null && h1.copy.edited === false && h1.closed_by === null, "v2 record fields present with their defaults");
const base = "https://tcqunihripihroseswgy.supabase.co/storage/v1/object/public/subsell-photos/";
const withPhotos = { photos: [{ url: base + "u/l/1.jpg", path: "u/l/1.jpg" }, { url: "https://scontent.fbcdn.net/x.jpg" }, { url: base + "u/l/2.jpg" }] };
ok(core.countStoredPhotos(withPhotos, base) === 1, "only bucket photos with a path count as stored (a Facebook URL never does)", core.countStoredPhotos(withPhotos, base));

/* 12 — the one library shape and its converters */
const rows = [
  { id: "r1", user_id: "U", category: "iphone", kind: "headline", lang: "fr", text: "A {model}", uses: 2, last_used_at: "2026-10-20T10:00:00Z" },
  { id: "r2", user_id: "U", category: "iphone", kind: "headline", lang: "en", text: "B {model}", uses: 0, last_used_at: null },
  { id: "r3", user_id: "U", category: "iphone", kind: "description", lang: "bi", text: "D {model} {price}$", uses: 0, last_used_at: null },
  { id: "r4", user_id: "U", category: "bogus", kind: "headline", lang: "bi", text: "X {model}", uses: 0, last_used_at: null },
];
const lib2 = core.libraryFromRows(rows);
ok(lib2.headlines.iphone.length === 2 && lib2.headlines.iphone[0].lastUsedAt === Date.parse("2026-10-20T10:00:00Z") && lib2.descriptions.iphone.length === 1 && lib2.headlines.other.length === 1, "rows → the one shape (unknown category → other)");
ok(core.pickFromLibrary(lib2.headlines.iphone).id === "r2", "lastUsedAt on the line drives the rotation when no usage map is given");
const back = core.rowsFromLibrary(lib2, "U");
ok(back.length === 4 && back.every((r) => r.user_id === "U") && back.find((r) => r.id === "r1").last_used_at === "2026-10-20T10:00:00.000Z" && back.find((r) => r.id === "r3").kind === "description", "the shape → rows, round trip");
const seeded = core.importStarter(starter, "U");
ok(seeded.length > 100 && seeded.every((r) => r.user_id === "U" && r.uses === 0 && ["headline", "description"].includes(r.kind) && core.CATEGORIES[r.category]), "the starter pack imports as rows", seeded.length);
const l2 = core.newListing({ category: "iphone", item: { model: "iPhone 12", storage: "64GB", grade: "B" }, fb: { price: 250 }, copy: { headlineId: "r1", descriptionId: "r3" } }, { now: T0, rand });
const rot = core.rotateCopy(l2, lib2, s, T0);
ok(rot.ids.headlineId === "r2" && rot.title === "B iPhone 12" && rot.ids.descriptionId === "r3" && rot.description === "D iPhone 12 250$", "a rebuild takes the NEXT headline (never the one it had); a one-line description library still answers", JSON.stringify(rot));

console.log("\n" + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
