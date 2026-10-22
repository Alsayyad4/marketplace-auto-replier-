/* lister/lister-core.js — AUTOLISTER core. PURE: no chrome.*, no DOM, no network, no clock
 * of its own (every function that needs "now" takes it as an argument).
 *
 * It runs in four places from this one file: the service worker (importScripts), the six
 * content scripts (first in the manifest's js list), the composer page, and the dashboard
 * (../lister/lister-core.js). Node tests load it with require(). See lister/PLAN.md 5.4.
 *
 * What lives here: the Listing record and its defaults, the categories and the words
 * Facebook's Category / Condition / Availability options use (EN/FR), the tag rules, the
 * template filling for headlines and descriptions, the library rotation, the pacing math,
 * the refresh planning (renew vs rebuild), the SKU, and the one-line form-atlas summary.
 */
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  root.SubSellListerCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const VERSION = "0.1.0";
  const MINUTE = 60 * 1000;
  const DAY = 24 * 60 * MINUTE;

  /* ------------------------------------------------------------------ settings */
  // PLAN 5.3. Everything a dashboard switch can change; the engine reads the merged copy.
  // The pace is per ACCOUNT (Facebook judges the account, not the computer). These are the
  // poster's defaults after the same reading of Facebook's behaviour; every one is a setting.
  const DEFAULT_SETTINGS = Object.freeze({
    enabled: false,          // the ACCOUNT switch (dashboard). The computer's own switch is local.
    hours: [9, 21],          // local hours during which the engine acts (the bar still shows)
    gapMin: 12,              // minutes between any two actions on the account
    gapMax: 40,
    dailyCreates: 4,         // posts (create or re-post) on the account per local day
    dailyDeletes: 4,
    maxRebuildsPerDay: 3,    // re-posts after a delete, on the account per local day
    breakAfter: 3,           // after this many actions in a row…
    breakMin: 20,            // …a break of breakMin..breakMax minutes
    breakMax: 40,
    warmupDays: 14,          // an account that never posted through the lister: warmupCreates a day for warmupDays
    warmupCreates: 2,
    minRebuildAgeDays: 7,    // a younger listing is skipped unless the owner forces that one listing
    rebuildDelayMin: 45,     // minutes between a listing's delete and its re-post (same item, not the same bytes)
    rebuildDelayMax: 90,
    rotateCopyOnRebuild: true, // the next headline + description from the library, a new cover photo
    holdHoursOnBlock: 48,    // a block signal pauses the whole account this long
    unattended: false,       // v2: may the engine act on a timer with nobody present
    autoRefreshDays: null,   // v2: null = never by itself; N = refresh live listings older than N days
    defaultCity: "Ville Saint-Laurent",
    region: "QC",            // appended to the city in Facebook's Location box ("Ville Saint-Laurent, QC")
    defaultMeetup: { public: true, pickup: false, dropoff: false },
    cityWords: ["montreal", "montréal", "laval", "ville saint-laurent"],
    shopName: "SubSell",
    warranty: { fr: "garantie 1 an + réseau à vie", en: "1-year warranty + lifetime network" },
    hoursText: { fr: "9h à 21h, 7 jours sur 7", en: "9 AM to 9 PM, 7 days a week" },
    tagSets: {},             // category → [tags]; overrides CATEGORIES[cat].tags when present
    hold: null,              // { until, why, machine } — written by any computer, honoured by all
  });

  function settingsWith(partial) {
    const s = Object.assign({}, DEFAULT_SETTINGS, partial || {});
    s.hours = Array.isArray(s.hours) && s.hours.length === 2 ? s.hours.slice() : DEFAULT_SETTINGS.hours.slice();
    s.defaultMeetup = Object.assign({}, DEFAULT_SETTINGS.defaultMeetup, (partial && partial.defaultMeetup) || {});
    s.tagSets = Object.assign({}, (partial && partial.tagSets) || {});
    s.cityWords = Array.isArray(s.cityWords) ? s.cityWords.slice() : DEFAULT_SETTINGS.cityWords.slice();
    return s;
  }

  /* ---------------------------------------------------------------- categories */
  // Marketplace's 2026 category list (read from a working poster, not run): the leaf names
  // "Mobile Phones", "Electronics & Computers", "Video Games", "Miscellaneous". FR alternates
  // are the words Facebook has used across builds; the driver matches by regex, in order.
  const MP_PHONES = { en: ["Mobile Phones", "Cell Phones", "Phones"], fr: ["Téléphones cellulaires", "Téléphones mobiles", "Cellulaires", "Téléphones"] };
  const MP_ELECTRONICS = { en: ["Electronics & Computers", "Electronics", "Computers"], fr: ["Électronique et ordinateurs", "Appareils électroniques et ordinateurs", "Électronique", "Ordinateurs"] };
  const MP_GAMES = { en: ["Video Games", "Video Games & Consoles", "Video Gaming"], fr: ["Jeux vidéo", "Jeux vidéo et consoles"] };
  const MP_MISC = { en: ["Miscellaneous"], fr: ["Divers"] };

  const SHOP_TAGS = ["unlocked", "débloqué", "garantie", "warranty"];
  const CATEGORIES = Object.freeze({
    iphone:    { label: { fr: "iPhone", en: "iPhone" }, brand: "Apple", marketplace: MP_PHONES, availability: "single",
                 tags: ["iphone", "apple", "smartphone", "cellulaire", "téléphone", "cell phone"].concat(SHOP_TAGS) },
    samsung:   { label: { fr: "Samsung", en: "Samsung" }, brand: "Samsung", marketplace: MP_PHONES, availability: "single",
                 tags: ["samsung", "galaxy", "android", "smartphone", "cellulaire", "téléphone", "cell phone"].concat(SHOP_TAGS) },
    phone:     { label: { fr: "Cellulaire", en: "Cell phone" }, brand: "", marketplace: MP_PHONES, availability: "single",
                 tags: ["android", "smartphone", "cellulaire", "téléphone", "cell phone", "phone"].concat(SHOP_TAGS) },
    ipad:      { label: { fr: "iPad", en: "iPad" }, brand: "Apple", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["ipad", "apple", "tablet", "tablette", "wifi", "garantie", "warranty"] },
    tablet:    { label: { fr: "Tablette", en: "Tablet" }, brand: "", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["tablet", "tablette", "android", "wifi", "garantie", "warranty"] },
    macbook:   { label: { fr: "MacBook", en: "MacBook" }, brand: "Apple", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["macbook", "apple", "mac", "laptop", "ordinateur portable", "macos", "garantie", "warranty"] },
    laptop:    { label: { fr: "Portable", en: "Laptop" }, brand: "", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["laptop", "ordinateur portable", "portable", "pc", "windows", "notebook", "garantie", "warranty"] },
    desktop:   { label: { fr: "Ordinateur", en: "Desktop" }, brand: "", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["desktop", "ordinateur", "pc", "tour", "windows", "gaming pc", "garantie", "warranty"] },
    console:   { label: { fr: "Console", en: "Game console" }, brand: "", marketplace: MP_GAMES, availability: "single",
                 tags: ["console", "jeux vidéo", "video games", "gaming", "manette", "controller", "garantie", "warranty"] },
    watch:     { label: { fr: "Montre", en: "Smartwatch" }, brand: "", marketplace: MP_ELECTRONICS, availability: "single",
                 tags: ["smartwatch", "montre", "watch", "montre intelligente", "garantie", "warranty"] },
    accessory: { label: { fr: "Accessoire", en: "Accessory" }, brand: "", marketplace: MP_PHONES, availability: "instock",
                 tags: ["accessoire", "accessory", "cellulaire", "phone", "apple", "samsung"] },
    other:     { label: { fr: "Autre", en: "Other" }, brand: "", marketplace: MP_MISC, availability: "single",
                 tags: ["garantie", "warranty"] },
  });
  const CATEGORY_IDS = Object.keys(CATEGORIES);

  // Inference from a title (capture of a hand-made listing). ORDER MATTERS: the specific
  // kinds first ("iPhone 15 case" is an accessory, "Galaxy Tab" a tablet, "Apple Watch" a watch).
  // JavaScript's \b is ASCII-only ("Étui", "débloqué" never match it): whole-word matching
  // here uses letter/digit lookarounds with the u flag instead.
  function wordsRe(alternation) {
    return new RegExp("(?<![\\p{L}\\p{N}])(?:" + alternation + ")(?![\\p{L}\\p{N}])", "iu");
  }
  const INFER = [
    ["accessory", wordsRe("airpods|écouteurs|ecouteurs|earbuds|chargeur|charger|câble|cable|étui|etui|case|coque|protecteur|screen protector|adaptateur|adapter|magsafe|pencil|clavier|keyboard|souris|mouse")],
    ["watch", wordsRe("apple watch|galaxy watch|smartwatch|montre|garmin|fitbit|pixel watch")],
    ["ipad", wordsRe("ipad")],
    ["tablet", wordsRe("tablet|tablette|galaxy tab|surface go|fire hd|lenovo tab")],
    ["macbook", wordsRe("macbook|imac|mac mini|mac studio|mac pro")],
    ["console", wordsRe("ps5|ps4|ps3|playstation|xbox|nintendo|switch|console|steam deck")],
    ["desktop", wordsRe("desktop|tour|gaming pc|pc gamer|all-in-one|tout-en-un")],
    ["laptop", wordsRe("laptop|portable|notebook|chromebook|thinkpad|surface pro|surface laptop|zenbook|vivobook|ideapad|inspiron|latitude|xps|pavilion|envy|spectre")],
    ["iphone", wordsRe("iphone")],
    ["samsung", wordsRe("samsung|galaxy")],
    ["phone", wordsRe("pixel|motorola|moto g|moto e|oneplus|xiaomi|redmi|huawei|lg|xperia|android|cellulaire|cell ?phone|smartphone|téléphone|telephone")],
  ];
  function inferCategory(title) {
    const t = String(title || "");
    for (const [id, re] of INFER) if (re.test(t)) return id;
    return "other";
  }

  /* ---------------------------------------------------------------- conditions */
  // grade → the Marketplace option (EN is what the record stores; FR alternates for the driver)
  const CONDITIONS = Object.freeze({
    New:  { en: "New", fr: "Neuf", words: { fr: "neuf", en: "new" } },
    "A+": { en: "Used - Like New", fr: "Utilisé - Comme neuf", words: { fr: "comme neuf", en: "like new" } }, // the reseller programme's A+
    A:   { en: "Used - Like New", fr: "Utilisé - Comme neuf", words: { fr: "comme neuf", en: "like new" } },
    B:   { en: "Used - Good", fr: "Utilisé - Bon état", words: { fr: "bon état", en: "good condition" } },
    C:   { en: "Used - Fair", fr: "Utilisé - État correct", words: { fr: "état correct", en: "fair condition" } },
  });
  const GRADES = Object.keys(CONDITIONS);
  // Facebook's wording drifts ("Used - Like New", "Used (like new)"): match by regex, never by equality.
  const CONDITION_PATTERNS = Object.freeze({
    "New": /^(new|neuf|neuve)$/i,
    "Used - Like New": /^(used\s*[-–(]?\s*like\s*new|(utilis[ée]e?\s*[-–(]?\s*)?comme\s*neuf)/i,
    "Used - Good": /^(used\s*[-–(]?\s*good|(utilis[ée]e?\s*[-–(]?\s*)?bon(\s*état)?)/i,
    "Used - Fair": /^(used\s*[-–(]?\s*fair|(utilis[ée]e?\s*[-–(]?\s*)?(acceptable|correct|passable|état correct))/i,
  });
  const CONDITION_TEXTS = Object.keys(CONDITION_PATTERNS);
  function conditionForGrade(grade) {
    const c = CONDITIONS[grade] || CONDITIONS.B;
    return c.en;
  }
  function gradeFromCondition(text) {
    const t = String(text || "").trim();
    if (!t) return null;
    for (const g of GRADES) {
      if (g === "A+") continue; // the same Marketplace words as A; a read-back maps to A
      const target = CONDITIONS[g].en;
      if (CONDITION_PATTERNS[target].test(t)) return g;
    }
    if (/\bnew\b|\bneuf\b/i.test(t) && !/like|comme/i.test(t)) return "New";
    if (/like|comme/i.test(t)) return "A";
    if (/good|bon/i.test(t)) return "B";
    if (/fair|correct|acceptable|passable/i.test(t)) return "C";
    return null;
  }

  const AVAILABILITY = Object.freeze({
    single: { en: "List as single item", fr: "Vendre un seul article", pattern: /single|unique|un\s*seul/i },
    instock: { en: "List as in stock", fr: "En stock", pattern: /in\s*stock|en\s*stock/i },
  });

  /* ------------------------------------------------------------------ the record */
  function uuid(rand) {
    // RFC-4122-shaped; crypto when the host has it, else the injected rand (tests) or Math.random.
    const g = typeof globalThis !== "undefined" ? globalThis : {};
    if (!rand && g.crypto && typeof g.crypto.randomUUID === "function") return g.crypto.randomUUID();
    const r = rand || Math.random;
    const hex = () => Math.floor(r() * 16).toString(16);
    let out = "";
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) out += "-";
      else if (i === 14) out += "4";
      else if (i === 19) out += (8 + Math.floor(r() * 4)).toString(16);
      else out += hex();
    }
    return out;
  }
  function skuOf(id) {
    return "SS-" + String(id || "").replace(/-/g, "").slice(0, 8).toUpperCase();
  }
  function idFromSku(sku) {
    const m = /^SS-([0-9A-F]{8})$/i.exec(String(sku || "").trim());
    return m ? m[1].toLowerCase() : null;
  }
  function skuMatchesId(sku, id) {
    const frag = idFromSku(sku);
    return !!frag && String(id || "").replace(/-/g, "").slice(0, 8).toLowerCase() === frag;
  }

  function newListing(partial, opts) {
    const p = partial || {};
    const o = opts || {};
    const now = o.now != null ? new Date(o.now).toISOString() : new Date().toISOString();
    const id = p.id || uuid(o.rand);
    const category = CATEGORIES[p.category] ? p.category : inferCategory((p.fb && p.fb.title) || (p.item && p.item.model) || "");
    const cat = CATEGORIES[category];
    const item = Object.assign({ model: "", storage: "", color: "", grade: "A", specs: "", brand: cat.brand }, p.item || {});
    if (!GRADES.includes(item.grade)) item.grade = "A";
    const fb = Object.assign({
      title: "", price: 0, category: cat.marketplace.en[0], condition: conditionForGrade(item.grade), description: "",
      tags: [], sku: skuOf(id), availability: cat.availability, location: "",
      meetup: { public: true, pickup: false, dropoff: false }, hideFromFriends: false, groups: [],
    }, p.fb || {});
    fb.meetup = Object.assign({ public: true, pickup: false, dropoff: false }, (p.fb && p.fb.meetup) || {});
    fb.tags = Array.isArray(fb.tags) ? fb.tags.slice() : [];
    fb.groups = Array.isArray(fb.groups) ? fb.groups.slice() : [];
    fb.sku = fb.sku || skuOf(id);
    const l = {
      id, user_id: p.user_id || null, status: p.status || "draft", source: p.source || "composer", category, item, fb,
      photos: Array.isArray(p.photos) ? p.photos.map((ph, i) => Object.assign({ order: i }, ph)) : [],
      video: null,
      copy: Object.assign({ headlineId: null, descriptionId: null, lang: "bi", edited: false }, p.copy || {}),
      target: Object.assign({ machine: "any" }, p.target || {}),
      fbListingId: p.fbListingId || null, fbUrl: p.fbUrl || null,
      relist: Object.assign({ count: 0, lastAt: null, deletedAt: null, everyDays: null, nextAt: null, renewals: 0 }, p.relist || {}),
      job: Object.assign({ step: null, sentAt: null, pressing: null }, p.job || {}),   // the engine's resume point
      tries: Object.assign({ form: 0, lastError: "", atlasAt: null }, p.tries || {}),
      history: Array.isArray(p.history) ? p.history.slice(-HISTORY_MAX) : [],
      closed_by: p.closed_by || null,
      created_at: p.created_at || now, updated_at: now, created_by: p.created_by || null,
    };
    if (!l.history.length) l.history.push({ at: now, event: "created", machine: l.created_by, detail: l.source });
    return l;
  }

  const LIMITS = Object.freeze({ photos: 10, title: 100, description: 5000, tags: 20, tagLength: 30 });
  const HISTORY_MAX = 50; // newest history lines kept on a listing (a weekly rebuild for a year stays small)
  function validateListing(l) {
    const problems = [];
    if (!l || typeof l !== "object") return { ok: false, problems: ["no listing"] };
    const fb = l.fb || {};
    const photos = Array.isArray(l.photos) ? l.photos : [];
    if (!photos.length) problems.push("no photo");
    if (photos.length > LIMITS.photos) problems.push("more than " + LIMITS.photos + " photos");
    const title = String(fb.title || "").trim();
    if (!title) problems.push("no title");
    if (title.length > LIMITS.title) problems.push("title longer than " + LIMITS.title);
    const price = Number(fb.price);
    if (!Number.isFinite(price) || price < 0) problems.push("price missing");
    if (!CATEGORIES[l.category]) problems.push("unknown category");
    if (!CONDITION_TEXTS.includes(fb.condition)) problems.push("condition is not a Marketplace option");
    if (String(fb.description || "").length > LIMITS.description) problems.push("description longer than " + LIMITS.description);
    const tags = Array.isArray(fb.tags) ? fb.tags : [];
    if (tags.length > LIMITS.tags) problems.push("more than " + LIMITS.tags + " tags");
    if (tags.some((t) => String(t).length > LIMITS.tagLength)) problems.push("a tag longer than " + LIMITS.tagLength);
    if (!String(fb.location || "").trim()) problems.push("no location");
    if (!AVAILABILITY[fb.availability]) problems.push("availability is not single/instock");
    if (fb.sku && !/^SS-[0-9A-F]{8}$/i.test(fb.sku)) problems.push("sku is not ours");
    return { ok: problems.length === 0, problems };
  }

  /* ------------------------------------------------------------------------ tags */
  const BRAND_WORDS = new Set(["apple", "samsung", "google", "motorola", "oneplus", "xiaomi", "huawei", "lg", "sony", "dell", "lenovo", "hp", "asus", "acer", "microsoft", "nintendo", "nintendo", "garmin", "fitbit"]);
  function normalizeTag(t) {
    return String(t || "").toLowerCase().replace(/[^\p{L}\p{N}\s+\-]/gu, " ").replace(/\s+/g, " ").trim();
  }
  function modelTokens(model) {
    const words = normalizeTag(model).split(" ").filter(Boolean);
    if (!words.length) return [];
    const full = words.join(" ");
    const brandless = words.filter((w) => !BRAND_WORDS.has(w));
    const out = [full, brandless.join(" ")];
    const isNum = (w) => /^(\d{1,2}[a-z]?|s\d{2}|a\d{2}|z\s?(fold|flip)\s?\d|xr|xs|se|x)$/i.test(w);
    const i = brandless.findIndex(isNum);
    if (i >= 0) {
      out.push(brandless.slice(0, i + 1).join(" "));       // the family: "iphone 15", "galaxy s23"
      out.push(brandless.slice(i).join(" "));              // the variant: "15 pro max", "s23 ultra"
      if (i > 0) out.push(brandless.slice(i, i + 1).join(" ")); // the bare number: "15", "s23"
    }
    return uniq(out.filter((s) => s && s.length >= 2));
  }
  function storageTokens(storage) {
    const m = /(\d+)\s*(tb|to|gb|go)?/i.exec(String(storage || ""));
    if (!m) return [];
    const n = m[1];
    const tb = /tb|to/i.test(m[2] || "") || (!m[2] && Number(n) <= 4);
    return tb ? [n + "tb", n + " to"] : [n + "gb", n + " go"];
  }
  function uniq(list) {
    const seen = new Set();
    const out = [];
    for (const x of list) {
      const k = normalizeTag(x);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(k);
    }
    return out;
  }
  // ≤ 20 tags, most specific first, so a cut never loses the model.
  function tagsFor(l, settingsIn) {
    const settings = settingsWith(settingsIn);
    const cat = CATEGORIES[l.category] || CATEGORIES.other;
    const set = Array.isArray(settings.tagSets[l.category]) ? settings.tagSets[l.category] : cat.tags;
    const item = l.item || {};
    const cond = CONDITIONS[item.grade] || null;
    const half = Math.ceil(set.length / 2);
    const ordered = []
      .concat(modelTokens(item.model))
      .concat(storageTokens(item.storage))
      .concat(set.slice(0, half))
      .concat(item.color ? [item.color] : [])
      .concat(cond ? [cond.words.en, cond.words.fr] : [])
      .concat(settings.cityWords)
      .concat(set.slice(half));
    return uniq(ordered).filter((t) => t.length <= LIMITS.tagLength).slice(0, LIMITS.tags);
  }

  /* ------------------------------------------------------------------- templates */
  // One unmistakably French word decides; the small words need two between them.
  const FR_STRONG = "à|état|neuf|neuve|comptant|garantie|ramassage|déverrouillé|débloqué|vendre|disponible|cellulaire|boutique|très|testé|testée|réinitialisé|réinitialisée|aucun|aucune|écrit|écris";
  const FR_WEAK = "avec|pour|est|une|des|les|sur|et|en|du|le|la|prix|ce|cette|ton|ta";
  function countWords(text, alternation) {
    const re = new RegExp("(?<![\\p{L}\\p{N}])(?:" + alternation + ")(?![\\p{L}\\p{N}])", "giu");
    let n = 0;
    while (re.exec(text)) n++;
    return n;
  }
  function looksFrench(text) {
    const t = String(text || "");
    if (countWords(t, FR_STRONG) >= 1) return true;
    return countWords(t, FR_WEAK) >= 2;
  }
  function priceText(price) {
    const n = Number(price);
    if (!Number.isFinite(n)) return "";
    return Number.isInteger(n) ? String(n) : n.toFixed(2);
  }
  function varsFor(l, settingsIn, lang) {
    const settings = settingsWith(settingsIn);
    const item = l.item || {};
    const fb = l.fb || {};
    const cat = CATEGORIES[l.category] || CATEGORIES.other;
    const fr = lang === "fr";
    const cond = CONDITIONS[item.grade] || null;
    const specs = String(item.specs || "").trim() || [item.model, item.storage, item.color].filter(Boolean).join(" ");
    return {
      model: item.model || "", storage: item.storage || "", color: item.color || "", grade: item.grade || "",
      condition: cond ? cond.words[fr ? "fr" : "en"] : "",
      price: Number(fb.price) > 0 ? priceText(fb.price) : "",
      city: fb.location || settings.defaultCity || "", brand: item.brand || cat.brand || "", specs,
      warranty: settings.warranty[fr ? "fr" : "en"] || "", shop: settings.shopName || "", hours: settings.hoursText[fr ? "fr" : "en"] || "",
      category: cat.label[fr ? "fr" : "en"],
    };
  }
  const PLACEHOLDER = /\{([a-z]+)\}/g;
  // A sentence (description) or a segment between separators (title) that still holds an
  // empty placeholder is dropped whole, so "{model} {storage} — {color}" without a colour
  // becomes "iPhone 15 256GB", never "iPhone 15 256GB — ".
  function fillTemplate(text, l, settingsIn, opts) {
    const o = opts || {};
    const lang = o.lang || (looksFrench(text) ? "fr" : "en");
    const vars = varsFor(l, settingsIn, lang);
    const unitRe = o.mode === "title" ? /(\s+[—–\-·|]\s+|,\s+|\s+:\s+)/ : /(?<=[.!?])\s+|\n+/;
    const parts = String(text || "").split(unitRe);
    const kept = [];
    for (const part of parts) {
      if (part == null) continue;
      if (o.mode === "title" && /^(\s+[—–\-·|]\s+|,\s+|\s+:\s+)$/.test(part)) { kept.push(part); continue; }
      let empty = false;
      const filled = part.replace(PLACEHOLDER, (m, key) => {
        const v = Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : "";
        if (!v) empty = true;
        return v;
      });
      if (empty) { if (o.mode === "title") { kept.push(null); } continue; }
      kept.push(filled);
    }
    let out;
    if (o.mode === "title") {
      // drop separators left dangling beside a dropped segment
      // a dropped segment takes exactly ONE neighbouring separator with it: the one before it
      // when there is one, else the one after it
      const isSep = (x) => /^(\s+[—–\-·|]\s+|,\s+|\s+:\s+)$/.test(x);
      const segs = [];
      for (let i = 0; i < kept.length; i++) {
        const k = kept[i];
        if (k === null) {
          if (segs.length && isSep(segs[segs.length - 1])) segs.pop();
          else if (i + 1 < kept.length && isSep(kept[i + 1])) i++;
          continue;
        }
        segs.push(k);
      }
      while (segs.length && /^(\s+[—–\-·|]\s+|,\s+|\s+:\s+)$/.test(segs[segs.length - 1])) segs.pop();
      while (segs.length && /^(\s+[—–\-·|]\s+|,\s+|\s+:\s+)$/.test(segs[0])) segs.shift();
      out = segs.join("");
    } else {
      out = kept.filter((k) => k !== null).join(" ");
    }
    return out.replace(/[ \t]+/g, " ").replace(/\s+([,.!?;:])/g, "$1").replace(/\(\s*\)/g, "").trim();
  }

  /* ---------------------------------------------------------------------- library */
  // items: [{ id, text, lang }] · usage: { [id]: lastUsedAt(ms) } — least recently used first,
  // never the line used just before (avoidId), ties by position (stable, deterministic).
  function pickFromLibrary(items, usage, opts) {
    const o = opts || {};
    const u = usage || {};
    let best = null;
    let bestAt = Infinity;
    for (const it of items || []) {
      if (!it || !it.text) continue;
      if (o.avoidId && it.id === o.avoidId) continue;
      if (o.lang && o.lang !== "bi" && it.lang && it.lang !== "bi" && it.lang !== o.lang) continue;
      // the one library shape (PLAN 5.5) carries lastUsedAt on the line; a usage map still wins when given
      const at = Number(u[it.id]) || Number(it.lastUsedAt) || 0;
      if (at < bestAt) { best = it; bestAt = at; }
    }
    if (!best && o.avoidId) return pickFromLibrary(items, usage, Object.assign({}, o, { avoidId: null }));
    return best;
  }
  function truncateWords(text, max) {
    const t = String(text || "").trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    const i = cut.lastIndexOf(" ");
    return (i > max * 0.6 ? cut.slice(0, i) : cut).trim();
  }
  function titleFor(l, library, usage, settings, opts) {
    const items = (library && library.headlines && library.headlines[l.category]) || [];
    const pick = pickFromLibrary(items, usage, Object.assign({ lang: l.copy && l.copy.lang }, opts || {}));
    if (!pick) return null;
    const text = truncateWords(fillTemplate(pick.text, l, settings, { mode: "title", lang: pick.lang === "bi" ? undefined : pick.lang }), LIMITS.title);
    return { id: pick.id, text };
  }
  function descriptionFor(l, library, usage, settings, opts) {
    const items = (library && library.descriptions && library.descriptions[l.category]) || [];
    const pick = pickFromLibrary(items, usage, Object.assign({ lang: l.copy && l.copy.lang }, opts || {}));
    if (!pick) return null;
    const text = truncateWords(fillTemplate(pick.text, l, settings, { lang: pick.lang === "bi" ? undefined : pick.lang }), LIMITS.description);
    return { id: pick.id, text };
  }
  // The replier's own Listings rows ({ title, model, storage, condition, price, available })
  // can suggest a price for the same model + storage. Optional; the composer offers it.
  function suggestPrice(rows, item) {
    const want = normalizeTag(item && item.model);
    if (!want) return null;
    const st = (item && item.storage) ? storageTokens(item.storage)[0] : "";
    let best = null;
    for (const r of rows || []) {
      if (!r || r.available === false) continue;
      const m = normalizeTag(r.model || r.title);
      if (m !== want && !m.startsWith(want + " ") && !want.startsWith(m + " ")) continue;
      const rs = r.storage ? storageTokens(r.storage)[0] : "";
      const price = Number(r.price);
      if (!Number.isFinite(price) || price <= 0) continue;
      const score = (m === want ? 2 : 1) + (st && rs === st ? 2 : 0);
      if (!best || score > best.score) best = { price, score, row: r };
    }
    return best ? best.price : null;
  }

  /* ------------------------------------------------------------------------ pacing */
  function localDayKey(ms) {
    const d = new Date(ms);
    return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
  }
  function startOfHourToday(ms, hour) {
    const d = new Date(ms);
    d.setHours(hour, 0, 0, 0);
    return d.getTime();
  }
  function hash32(str) {
    let h = 2166136261;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function jitterMinutes(min, max, seed) {
    const lo = Math.min(min, max), hi = Math.max(min, max);
    return lo + (hash32(seed) % (hi - lo + 1));
  }
  // ledger: { items: [{ t, k }], firstAt } — k = create | delete | renew. Returns the first moment
  // an action of `kind` may happen, and why. The latest of every constraint wins.
  function nextSlot(ledgerIn, settingsIn, now, kind) {
    const settings = settingsWith(settingsIn);
    const ledger = ledgerIn || { items: [] };
    const items = (ledger.items || []).filter((x) => x && Number.isFinite(x.t)).sort((a, b) => a.t - b.t);
    const act = kind || "create";
    const reasons = [];
    let at = now;
    const push = (when, why) => { if (when > at) { at = when; reasons.length = 0; reasons.push(why); } else if (when === at && why !== "now") reasons.push(why); };

    // hours
    const [h0, h1] = settings.hours;
    const todayStart = startOfHourToday(now, h0);
    const todayEnd = startOfHourToday(now, h1);
    if (now < todayStart) push(todayStart, "hours");
    else if (now >= todayEnd) push(todayStart + DAY, "hours");

    // daily caps (local day) on the ACCOUNT, with the warm-up of an account that never posted.
    // kinds: create (a new listing), relist (a re-post after a delete: counts as a create AND
    // against maxRebuildsPerDay), delete, renew (only the gap, the break and the hours).
    const today = localDayKey(now);
    const doneToday = (k) => items.filter((x) => x.k === k && localDayKey(x.t) === today).length;
    if (act === "create" || act === "relist") {
      let cap = settings.dailyCreates;
      const firstAt = Number(ledger.firstAt) || (items.length ? items[0].t : 0);
      const inWarmup = settings.warmupDays > 0 && (!firstAt || now - firstAt < settings.warmupDays * DAY);
      if (inWarmup) cap = Math.min(cap, settings.warmupCreates);
      const creates = doneToday("create") + doneToday("relist");
      if (cap > 0 && creates >= cap) push(startOfHourToday(now, h0) + DAY, inWarmup ? "warm-up cap" : "daily cap");
      if (act === "relist" && settings.maxRebuildsPerDay > 0 && doneToday("relist") >= settings.maxRebuildsPerDay) push(startOfHourToday(now, h0) + DAY, "daily rebuild cap");
    } else if (act === "delete") {
      if (settings.dailyDeletes > 0 && doneToday("delete") >= settings.dailyDeletes) push(startOfHourToday(now, h0) + DAY, "daily delete cap");
    }

    // the gap after the last action, and a break after a run of them
    const last = items.length ? items[items.length - 1] : null;
    if (last) {
      const gap = jitterMinutes(settings.gapMin, settings.gapMax, "gap:" + items.length + ":" + localDayKey(last.t)) * MINUTE;
      push(last.t + gap, "gap");
      const n = settings.breakAfter;
      if (n > 0 && items.length >= n) {
        const run = items.slice(-n);
        const spanOk = run[n - 1].t - run[0].t <= n * settings.gapMax * MINUTE * 1.5;
        if (spanOk) {
          const brk = jitterMinutes(settings.breakMin, settings.breakMax, "break:" + items.length) * MINUTE;
          push(run[n - 1].t + brk, "break");
        }
      }
    }
    if (at === now) reasons.push("now");
    return { at, why: uniq(reasons).join(", ") || "now", waitMs: Math.max(0, at - now) };
  }

  /* ------------------------------------------------------------------- refresh plan */
  // selected: [{ fbListingId, ageDays, renewOffered, renewals, ours, sold, force }].
  // opts.force = rebuild everything (the v1 bar's Rebuild button); opts.preferRenew = the v2
  // smart default (Renew when Facebook offers it). A listing younger than minAgeDays is skipped
  // unless that listing carries force; a Sold/Pending card is always skipped.
  function planRefresh(selected, settingsIn, opts) {
    const o = opts || {};
    const settings = settingsWith(settingsIn);
    const minAge = o.minAgeDays != null ? o.minAgeDays : settings.minRebuildAgeDays;
    const jobs = [];
    for (const s of selected || []) {
      if (!s || !s.fbListingId) continue;
      const young = Number.isFinite(s.ageDays) && s.ageDays < minAge;
      let action, reason;
      if (s.sold) { action = "skip"; reason = "the card shows Sold or Pending"; }
      else if (o.preferRenew && s.renewOffered && !s.force) { action = "renew"; reason = "Facebook offers Renew (free, keeps the listing)"; }
      else if (young && !s.force) { action = "skip"; reason = "younger than " + minAge + " days (tick force on it to do it anyway)"; }
      else { action = "rebuild"; reason = s.force ? "forced by the owner" : (o.force ? "Rebuild pressed" : (s.renewOffered === false ? "no Renew offered" : "Renew not seen on the card")); }
      jobs.push({ fbListingId: s.fbListingId, action, reason, young, ageDays: s.ageDays, ours: !!s.ours });
    }
    jobs.sort((a, b) => (Number(b.ageDays) || 0) - (Number(a.ageDays) || 0));
    return {
      jobs,
      youngCount: jobs.filter((j) => j.young).length,
      rebuilds: jobs.filter((j) => j.action === "rebuild").length,
      renews: jobs.filter((j) => j.action === "renew").length,
      skipped: jobs.filter((j) => j.action === "skip").length,
    };
  }
  // The re-post of a deleted listing waits rebuildDelayMin..rebuildDelayMax minutes after its delete.
  function rebuildCreateAt(deletedAt, settingsIn, seed) {
    const settings = settingsWith(settingsIn);
    const t = Number(deletedAt) || 0;
    return t + jitterMinutes(settings.rebuildDelayMin, settings.rebuildDelayMax, "rebuild:" + (seed || t)) * MINUTE;
  }

  /* ------------------------------------------------------------- history, photos */
  function pushHistory(l, event, machine, detail, now) {
    if (!l) return l;
    const at = now != null ? new Date(now).toISOString() : new Date().toISOString();
    l.history = Array.isArray(l.history) ? l.history : [];
    l.history.push({ at, event, machine: machine || null, detail: detail == null ? null : detail });
    if (l.history.length > HISTORY_MAX) l.history.splice(0, l.history.length - HISTORY_MAX);
    l.updated_at = at;
    return l;
  }
  // Photos that are really ours (bytes in the bucket), as opposed to a Facebook URL seen on a page.
  function countStoredPhotos(l, bucketBase) {
    const base = String(bucketBase || "");
    return ((l && l.photos) || []).filter((p) => p && p.url && (!base || String(p.url).indexOf(base) === 0) && p.path).length;
  }

  /* ---------------------------------------------------------- library converters */
  // rows: subsell_copy_library rows → the one in-memory shape (PLAN 5.5)
  function libraryFromRows(rows) {
    const lib = { headlines: {}, descriptions: {} };
    for (const r of rows || []) {
      if (!r || !r.text) continue;
      const bucket = r.kind === "description" ? lib.descriptions : lib.headlines;
      const cat = CATEGORIES[r.category] ? r.category : "other";
      (bucket[cat] = bucket[cat] || []).push({
        id: r.id, lang: r.lang || "bi", text: String(r.text), uses: Number(r.uses) || 0,
        lastUsedAt: r.last_used_at ? Date.parse(r.last_used_at) || 0 : (Number(r.lastUsedAt) || 0),
      });
    }
    return lib;
  }
  function rowsFromLibrary(library, userId) {
    const rows = [];
    const lib = library || {};
    for (const kind of ["headline", "description"]) {
      const bucket = kind === "headline" ? lib.headlines : lib.descriptions;
      for (const cat of Object.keys(bucket || {})) {
        for (const it of bucket[cat] || []) {
          if (!it || !it.text) continue;
          rows.push({
            id: it.id || undefined, user_id: userId, category: cat, kind, lang: it.lang || "bi", text: String(it.text),
            uses: Number(it.uses) || 0, last_used_at: it.lastUsedAt ? new Date(it.lastUsedAt).toISOString() : null,
          });
        }
      }
    }
    return rows;
  }
  // library-starter.json → rows to insert (ids made by the database when absent)
  function importStarter(json, userId) {
    const rows = [];
    const j = json || {};
    for (const kind of ["headline", "description"]) {
      const bucket = kind === "headline" ? j.headlines : j.descriptions;
      for (const cat of Object.keys(bucket || {})) {
        for (const it of bucket[cat] || []) {
          if (!it || !it.text) continue;
          rows.push({ user_id: userId, category: CATEGORIES[cat] ? cat : "other", kind, lang: it.lang || "bi", text: String(it.text), uses: 0, last_used_at: null });
        }
      }
    }
    return rows;
  }
  // A rebuild re-posts the same item with the NEXT headline and description (never the ones it
  // had), so the re-post is not the same bytes. Returns null parts when the library is empty.
  function rotateCopy(l, library, settingsIn, now) {
    const title = titleFor(l, library, null, settingsIn, { avoidId: l && l.copy && l.copy.headlineId });
    const description = descriptionFor(l, library, null, settingsIn, { avoidId: l && l.copy && l.copy.descriptionId });
    return {
      title: title ? title.text : null, description: description ? description.text : null,
      ids: { headlineId: title ? title.id : null, descriptionId: description ? description.id : null },
      at: now != null ? now : null,
    };
  }

  /* ----------------------------------------------------------------------- atlas */
  // { kind, lang, url, fields: [{label, role}], buttons: [label], missing: [what] } → one line
  function atlasSummary(atlas) {
    const a = atlas || {};
    const fields = (a.fields || []).map((f) => (f && (f.label || f.role)) || "").filter(Boolean);
    const buttons = (a.buttons || []).filter(Boolean);
    const parts = [(a.kind || "page") + (a.lang ? " (" + a.lang + ")" : "")];
    if (fields.length) parts.push("fields: " + fields.slice(0, 12).join(", ") + (fields.length > 12 ? "…" : ""));
    if (buttons.length) parts.push("buttons: " + buttons.slice(0, 8).join(", "));
    if (a.missing && a.missing.length) parts.push("missing: " + a.missing.join(", "));
    return parts.join(" · ");
  }

  /* ---------------------------------------------------------------- the surface */
  return {
    VERSION, DEFAULT_SETTINGS, settingsWith, LIMITS, HISTORY_MAX,
    CATEGORIES, CATEGORY_IDS, inferCategory,
    CONDITIONS, GRADES, CONDITION_PATTERNS, CONDITION_TEXTS, conditionForGrade, gradeFromCondition, AVAILABILITY,
    uuid, skuOf, idFromSku, skuMatchesId, newListing, validateListing, pushHistory, countStoredPhotos,
    normalizeTag, modelTokens, storageTokens, tagsFor,
    looksFrench, fillTemplate, pickFromLibrary, titleFor, descriptionFor, rotateCopy,
    libraryFromRows, rowsFromLibrary, importStarter, suggestPrice,
    nextSlot, rebuildCreateAt, jitterMinutes, planRefresh, atlasSummary,
  };
});
