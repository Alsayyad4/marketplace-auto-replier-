/* =====================================================================
 * SubSell Marketplace Auto-Reply — background service worker
 * ---------------------------------------------------------------------
 * Responsibilities:
 *   - Anthropic Claude API calls (claude-sonnet-4-6) with the
 *     anthropic-dangerous-direct-browser-access header
 *   - System-prompt assembly from settings (business info, listings,
 *     FR/EN auto-detect, casual Quebec tone, pricing rules, reply tokens)
 *   - Rate limiting (hourly/daily, configurable)
 *   - Business-hours gating
 *   - Follow-up scheduling via chrome.alarms (+ cancellation)
 *   - [HUMAN] desktop notifications
 *   - Video blob fetch (mp4 -> base64) for paste-to-upload in content.js
 *
 * Source of truth for DEFAULTS lives here. Options/popup write the full
 * settings object into chrome.storage.local; this worker merges over
 * DEFAULTS so missing keys never break the pipeline.
 * ===================================================================== */

"use strict";

const DEFAULTS = {
  enabled: false,
  apiKey: "",
  model: "claude-sonnet-4-6",
  responseDelaySec: 30,
  jitterSec: 60,
  hourlyCap: 30,
  dailyCap: 200,
  wpmMin: 38,
  wpmMax: 78,
  businessHoursEnabled: true,
  businessHoursStart: 9, // 9 AM
  businessHoursEnd: 22, // 10 PM
  businessName: "SubSell",
  businessAddress: "757 Rue Beaubien E, Montréal",
  businessHoursText: "9AM–10PM, 7 days",
  businessInfo:
    "Used iPhone sales in Montreal. Pickup at 757 Rue Beaubien E, Montréal. Cash or e-transfer.",
  instructions:
    "Be friendly and concise. Auto-detect the buyer's language (French or English) and reply in the same language; for French use casual Quebec French (tutoiement, 'allô', 'parfait', 'à+'). Quote prices from the listings. Never discount more than 10% without flagging a human. If the buyer is rude, scammy, or asking something unusual, return [HUMAN] with a short reason.",
  examples: "", // few-shot buyer->reply pairs the user pastes to teach tone/video/escalation
  offPlatformGuard: true, // hard rules: no phone numbers / links / "contact me elsewhere"
  // closer mode — drive buyers to the physical shop, no exact prices in chat
  closerMode: true,
  noExactPrices: true, // never quote a number; promise the best price in person
  closerGoals:
    "Your #1 goal is to get the buyer to come visit the shop in person. We give better prices in person than online. We also do trade-ins/exchanges, buyback of their old phone, and have liquidation deals — mention these naturally when relevant. Build excitement and urgency (popular model, moves fast) without being pushy. Always steer toward 'come by the shop and we'll take care of you'.",
  // starting-price list the bot can share (when set, it gives prices instead of refusing)
  priceList: "",
  // silent visit confirmation follow-up (does NOT notify the operator)
  visitConfirmEnabled: true,
  visitConfirmAfterMin: 120, // ask "still coming?" this long after a pickup intent
  visitConfirmMessage: "", // blank = use the built-in bilingual default
  // per-conversation reply cap
  maxRepliesPerConvo: 5, // total bot replies allowed in one conversation (0 = unlimited)
  convoCapBehavior: "stop", // "stop" = go quiet, "notify" = fire a [HUMAN] notification once
  // human cadence (content.js reads these)
  humanCadence: true,
  skipChance: 0.12, // chance to skip a cycle even when something is unread (looks human)
  breakChance: 0.05, // chance per cycle to start a "break"
  breakMinMin: 3, // break length min (minutes)
  breakMaxMin: 18, // break length max (minutes)
  // warm-up (new accounts ramp volume over days)
  warmupEnabled: true,
  warmupDays: 7,
  warmupStartCap: 10, // daily cap on day 0
  listings: [],
  followUps: [],
  videos: [],
};

const LOG = (...a) => console.log("[SubSell-BG]", ...a);

/* ---------------- settings ---------------- */

/* ---------------- cross-computer settings sync ----------------
 * Config syncs across every Chrome signed into the SAME Google account via
 * chrome.storage.sync. That API caps each item at ~8KB, but our config is
 * bigger, so we split the JSON into <=7KB chunks: cfg_0..cfg_(n-1) plus a
 * cfg_count marker. Per-machine state (enabled toggle, rate-limit counters,
 * logs, debug, visits) stays in storage.local on purpose. */
const SYNC_CHUNK = 7000;
const SYNC_PREFIX = "cfg_";

function syncedConfigRead(cb) {
  chrome.storage.sync.get(["cfg_count"], (meta) => {
    const n = meta && typeof meta.cfg_count === "number" ? meta.cfg_count : 0;
    if (!n) return cb({}, false);
    const keys = [];
    for (let i = 0; i < n; i++) keys.push(SYNC_PREFIX + i);
    chrome.storage.sync.get(keys, (parts) => {
      try {
        let s = "";
        for (let i = 0; i < n; i++) s += parts[SYNC_PREFIX + i] || "";
        cb(JSON.parse(s), true);
      } catch (e) {
        LOG("sync config parse failed:", e.message);
        cb({}, false);
      }
    });
  });
}

// Write a config object across sync chunks (drops `enabled` — that's local).
function syncedConfigWrite(config) {
  return new Promise((resolve) => {
    const clean = Object.assign({}, config);
    delete clean.enabled;
    const json = JSON.stringify(clean);
    const chunks = [];
    for (let i = 0; i < json.length; i += SYNC_CHUNK) chunks.push(json.slice(i, i + SYNC_CHUNK));
    chrome.storage.sync.get(null, (all) => {
      const stale = Object.keys(all || {}).filter((k) => k.startsWith(SYNC_PREFIX));
      chrome.storage.sync.remove(stale, () => {
        const payload = { cfg_count: chunks.length };
        chunks.forEach((c, i) => (payload[SYNC_PREFIX + i] = c));
        chrome.storage.sync.set(payload, () => {
          if (chrome.runtime.lastError) LOG("sync write error:", chrome.runtime.lastError.message);
          resolve(!chrome.runtime.lastError);
        });
      });
    });
  });
}

// Read enterprise-policy config (chrome.storage.managed → managed_schema.json).
// Admins push `configJson` (the whole settings JSON) to the fleet via Chrome
// policy; this returns the parsed object, or null when there's no policy.
function readManagedConfig() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.managed) return resolve(null);
    try {
      chrome.storage.managed.get(["configJson"], (mg) => {
        if (chrome.runtime.lastError || !mg || !mg.configJson) return resolve(null);
        try {
          const cfg = JSON.parse(mg.configJson);
          resolve(cfg && typeof cfg === "object" && !Array.isArray(cfg) ? cfg : null);
        } catch (e) {
          resolve(null);
        }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings", "enabledLocal", "remoteConfig"], (res) => {
      const finish = (base) => {
        const merged = Object.assign({}, DEFAULTS, base);
        // `enabled` is PER-MACHINE: enabledLocal always wins (shared config never
        // turns a machine on/off for you).
        if (typeof res.enabledLocal === "boolean") merged.enabled = res.enabledLocal;
        resolve(merged);
      };
      // Config priority: MANAGED policy (fleet) > REMOTE link > synced > legacy local.
      readManagedConfig().then((managed) => {
        if (managed) {
          delete managed.enabled;
          finish(managed);
          return;
        }
        if (res.remoteConfig && typeof res.remoteConfig === "object" && Object.keys(res.remoteConfig).length) {
          finish(res.remoteConfig);
          return;
        }
        syncedConfigRead((cfg, hadSync) => finish(hadSync ? cfg : res.settings || {}));
      });
    });
  });
}

/* ---------------- remote config ("permanent link") ----------------
 * Fetch the whole settings object from ONE URL you control (e.g. a secret GitHub
 * gist's raw link). Every machine reads from it, so you set the API key + settings
 * once and edits to that file apply everywhere — even across different Google
 * accounts. Stored locally as `remoteConfig` and treated as the source of truth by
 * getSettings(). The URL lives in `remoteConfigUrl` (local, per machine) or the
 * baked-in REMOTE_CONFIG_URL below (set it once for ZERO per-machine setup). */
const REMOTE_CONFIG_URL = ""; // optional: bake your link here

function getRemoteConfigUrl() {
  return new Promise((resolve) => {
    const fromLocal = () =>
      chrome.storage.local.get(["remoteConfigUrl"], (r) => resolve((r && r.remoteConfigUrl) || REMOTE_CONFIG_URL || ""));
    // Enterprise policy can supply the URL too (chrome.storage.managed.configUrl).
    if (chrome.storage && chrome.storage.managed) {
      try {
        chrome.storage.managed.get(["configUrl"], (mg) => {
          if (!chrome.runtime.lastError && mg && mg.configUrl) resolve(mg.configUrl);
          else fromLocal();
        });
        return;
      } catch (e) {
        /* fall through */
      }
    }
    fromLocal();
  });
}
async function fetchRemoteConfig() {
  const url = await getRemoteConfigUrl();
  if (!url) return { ok: false, error: "no remote config URL set" };
  try {
    const resp = await fetch(url, { cache: "no-store" });
    if (!resp.ok) return { ok: false, error: "HTTP " + resp.status };
    const cfg = await resp.json();
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return { ok: false, error: "config is not a JSON object" };
    delete cfg.enabled; // on/off stays per machine
    await new Promise((r) => chrome.storage.local.set({ remoteConfig: cfg, remoteConfigAt: Date.now() }, r));
    LOG("remote config applied from", url);
    return { ok: true, keys: Object.keys(cfg).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/* ---------------- counters / rate limits ---------------- */

function getCounters() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["counters"], (res) =>
      resolve(res.counters || { hourStart: 0, hourCount: 0, dayStart: 0, dayCount: 0 })
    );
  });
}

function setCounters(c) {
  return new Promise((resolve) => chrome.storage.local.set({ counters: c }, resolve));
}

function rollWindows(c, now) {
  const HOUR = 3600 * 1000;
  const DAY = 86400 * 1000;
  if (!c.hourStart || now - c.hourStart >= HOUR) {
    c.hourStart = now;
    c.hourCount = 0;
  }
  if (!c.dayStart || now - c.dayStart >= DAY) {
    c.dayStart = now;
    c.dayCount = 0;
  }
  return c;
}

/* First-run timestamp — used to compute warm-up day for a fresh account. */
function getInstallTs() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["installTs"], (res) => {
      if (res.installTs) return resolve(res.installTs);
      const ts = Date.now();
      chrome.storage.local.set({ installTs: ts }, () => resolve(ts));
    });
  });
}

/* Effective daily cap: during warm-up, ramp linearly from warmupStartCap to
 * the full dailyCap over warmupDays. New accounts start gentle, looks organic. */
async function effectiveDailyCap(settings) {
  if (!settings.warmupEnabled) return settings.dailyCap;
  const installTs = await getInstallTs();
  const dayNum = Math.floor((Date.now() - installTs) / 86400000); // 0-based
  if (dayNum >= settings.warmupDays) return settings.dailyCap;
  const start = settings.warmupStartCap || 10;
  const full = settings.dailyCap;
  const frac = settings.warmupDays > 0 ? dayNum / settings.warmupDays : 1;
  return Math.max(start, Math.round(start + (full - start) * frac));
}

async function checkRateLimit(settings) {
  const now = Date.now();
  const c = rollWindows(await getCounters(), now);
  if (c.hourCount >= settings.hourlyCap) return { ok: false, reason: "hourly cap reached" };
  const dayCap = await effectiveDailyCap(settings);
  if (c.dayCount >= dayCap) {
    const warming = dayCap < settings.dailyCap;
    return { ok: false, reason: warming ? `warm-up daily cap reached (${dayCap})` : "daily cap reached" };
  }
  return { ok: true, counters: c };
}

async function incrementCounters() {
  const now = Date.now();
  const c = rollWindows(await getCounters(), now);
  c.hourCount += 1;
  c.dayCount += 1;
  await setCounters(c);
  return c;
}

/* Per-conversation reply counter (persisted, keyed by threadId). Counts how
 * many times the bot has replied in each thread so we can cap it. Reset when
 * the buyer comes back is intentionally NOT done — the cap is a lifetime guard
 * against over-messaging a single person. */
function getConvoReplies() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["convoReplies"], (res) => resolve(res.convoReplies || {}));
  });
}
async function convoReplyCount(threadId) {
  const map = await getConvoReplies();
  return map[threadId] || 0;
}
async function bumpConvoReply(threadId) {
  const map = await getConvoReplies();
  map[threadId] = (map[threadId] || 0) + 1;
  return new Promise((resolve) => chrome.storage.local.set({ convoReplies: map }, () => resolve(map[threadId])));
}
function getCapNotified() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["capNotified"], (res) => resolve(res.capNotified || {}));
  });
}
function setCapNotified(threadId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["capNotified"], (res) => {
      const map = res.capNotified || {};
      map[threadId] = Date.now();
      chrome.storage.local.set({ capNotified: map }, () => resolve());
    });
  });
}

/* Last buyer message we ANSWERED in each thread (persisted, keyed by threadId).
 * This is the "we already replied to this person's latest message" guard: it
 * survives page reloads and service-worker restarts (the old in-memory check in
 * content.js did not), and it's shared across every tab of this Chrome profile —
 * so the bot stops re-sending the same reply after a refresh. */
function getAnsweredMap() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["answeredMap"], (res) => resolve(res.answeredMap || {}));
  });
}
async function getLastAnswered(threadId) {
  const map = await getAnsweredMap();
  return map[threadId];
}
async function setLastAnswered(threadId, buyerMessage) {
  const map = await getAnsweredMap();
  map[threadId] = buyerMessage;
  const keys = Object.keys(map);
  if (keys.length > 2000) delete map[keys[0]]; // bound storage growth
  return new Promise((resolve) => chrome.storage.local.set({ answeredMap: map }, () => resolve()));
}

/* Demo-video "already sent" per thread (persisted) + an in-memory claim set.
 * The service worker is a singleton per Chrome profile, so the synchronous
 * check-and-add on `videoClaims` is atomic across all tabs — it blocks a second
 * tab/scan from sending the same video while the first is mid-send. */
const videoClaims = new Set();
function getVideoSentThreads() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["videoSentThreads"], (res) => resolve(res.videoSentThreads || {}));
  });
}
function markVideoSent(threadId) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["videoSentThreads"], (res) => {
      const map = res.videoSentThreads || {};
      map[threadId] = true;
      chrome.storage.local.set({ videoSentThreads: map }, () => resolve());
    });
  });
}

/* In-memory per-thread reply lock. Two tabs of the same account both scanning
 * could otherwise generate + send a reply to the same thread at once (double
 * message). Acquired synchronously at the top of GET_REPLY_SIMPLE, released in a
 * finally — atomic because the worker is single-threaded. */
const processingThreads = new Set();

/* Visit intent per conversation — recorded SILENTLY (no operator notification).
 * Shape: { [threadId]: { status, thread, at, history:[{status,at}] } } */
function getVisits() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["visits"], (res) => resolve(res.visits || {}));
  });
}
async function recordVisit(threadId, threadName, status) {
  if (!threadId || !status) return;
  const map = await getVisits();
  const prev = map[threadId] || { history: [] };
  prev.status = status;
  prev.thread = threadName || prev.thread || null;
  prev.at = new Date().toISOString();
  prev.history = (prev.history || []).concat([{ status, at: prev.at }]);
  map[threadId] = prev;
  await new Promise((r) => chrome.storage.local.set({ visits: map }, r));
  LOG("visit recorded (silent):", threadName, status);
}

function withinBusinessHours(settings) {
  if (!settings.businessHoursEnabled) return true;
  const h = new Date().getHours();
  const s = settings.businessHoursStart;
  const e = settings.businessHoursEnd;
  return s <= e ? h >= s && h < e : h >= s || h < e;
}

/* ---------------- system prompt ---------------- */

function buildSystemPrompt(settings) {
  const lines = [];
  lines.push(`You are the auto-reply assistant for "${settings.businessName}", a used-iPhone reseller in Montréal.`);
  lines.push(`Address: ${settings.businessAddress}. Hours: ${settings.businessHoursText}.`);
  lines.push("");
  lines.push("BUSINESS INFO:");
  lines.push(settings.businessInfo || "");
  lines.push("");
  lines.push("INSTRUCTIONS:");
  lines.push(settings.instructions || "");

  // Starting-price list the bot CAN share. When present, it overrides the old
  // "never quote a price" behaviour — the buyer gets a real starting price, then
  // we close toward a call / shop visit.
  const hasPriceList = !!(settings.priceList && settings.priceList.trim());
  if (hasPriceList) {
    lines.push("");
    lines.push(
      "STARTING PRICES (share the relevant one when a buyer asks about a model — these are 'starting at' / 'à partir de' prices; the exact price depends on storage, condition, and the in-person deal, so quote it as 'starts at $X' and invite them in for the best price):"
    );
    lines.push(settings.priceList.trim());
  }

  if (Array.isArray(settings.listings) && settings.listings.length) {
    lines.push("");
    if (settings.noExactPrices && !hasPriceList) {
      // Hide the numbers entirely so the model literally cannot quote a price.
      lines.push("CURRENT INVENTORY (availability + video only — do NOT state any price):");
      for (const l of settings.listings) {
        lines.push(
          `- ${l.title || l.model || "item"} | ${l.storage || ""} | ${l.condition || ""} | available: ${l.available === false ? "no" : "yes"}${l.videoUrl ? " | video: " + l.videoUrl : ""}`
        );
      }
    } else {
      lines.push("CURRENT LISTINGS (only quote available items):");
      for (const l of settings.listings) {
        lines.push(
          `- ${l.title || l.model || "item"} | ${l.storage || ""} | ${l.condition || ""} | $${l.price || "?"} CAD | available: ${l.available === false ? "no" : "yes"}${l.videoUrl ? " | video: " + l.videoUrl : ""}`
        );
      }
    }
  }

  if (settings.closerMode) {
    lines.push("");
    lines.push("HOW TO CLOSE — turn this chat into a call or a shop visit:");
    lines.push(settings.closerGoals || "");
    if (hasPriceList) {
      lines.push(
        "PRICING: when asked, GIVE the relevant starting price from the list above — do NOT refuse or dodge the question. Then close: tell them the exact / best price is locked in when they call or drop by, because of the deal you can do in person."
      );
    } else if (settings.noExactPrices) {
      lines.push(
        "PRICING RULE (critical): NEVER state an exact price, number, or dollar amount in chat — not even a range, not even the listed price. If asked the price, say the listed price is on the post but you give your BEST deal in person, and invite them to come by the shop. If they push hard for a number, return [HUMAN]."
      );
    }
    lines.push(
      "Always work these in naturally: we do TRADE-INS — take their old phone/device toward the new one, and if their current phone is NEWER we can even pay them CASH for it. Push our LIQUIDATION deals and create gentle urgency (good stock moves fast). The goal: get them to call or come to the shop, where we take care of them with the best deal."
    );
  }

  lines.push("");
  lines.push("SPECIAL REPLY TOKENS (use at most one, alone on the first line):");
  lines.push("- [HUMAN] <reason> — when you should NOT auto-reply: scams, payment/shipping requests, off-platform contact pressure, or anything weird/risky. The human is notified.");
  lines.push("- [VIDEO:<url>] <optional caption> — to send a demo video. Use a videoUrl from the inventory when the buyer asks to see the phone working/condition. The app UPLOADS the actual mp4 file as a native video attachment — the URL is never shown to the buyer, so this is safe. Keep the caption short and ALWAYS vary the wording.");
  lines.push("- [VISIT:yes|no|maybe] <your normal reply text> — put this at the very start of your message ONLY when the buyer's latest message reveals whether they intend to come to the shop. yes = they confirm coming / are on their way / agreed to come; no = they decline, bought elsewhere, or back out; maybe = unsure/hesitant. The token is recorded silently and STRIPPED before sending — the buyer only sees your reply text after it. Use it in addition to replying normally; do not let it replace a real, persuasive reply.");

  if (settings.offPlatformGuard) {
    lines.push("");
    lines.push("PLATFORM SAFETY RULES (strict — Facebook flags these):");
    lines.push("- NEVER write a phone number, email, WhatsApp, Telegram, or any external link/URL.");
    lines.push("- NEVER say 'text me at', 'call me', 'contact me on …', or push the chat off Marketplace.");
    lines.push("- Keep the whole conversation inside Messenger. If the buyer insists on moving off-platform or wants your number, return [HUMAN] instead of replying.");
    lines.push("- Don't paste identical canned text; vary your wording naturally between buyers.");
  }

  if (settings.examples && settings.examples.trim()) {
    lines.push("");
    lines.push("EXAMPLE CONVERSATIONS (mimic this tone, format, and decisions — including when to send [VIDEO] or escalate [HUMAN]). Do not copy verbatim; adapt to the actual buyer:");
    lines.push(settings.examples.trim());
  }

  lines.push("");
  lines.push("HOW TO READ THE INPUT: you are given the recent conversation and the buyer's latest message. Respond ONLY to what the buyer actually wrote. If their message is empty, a sticker/emoji only, a system line, or makes no sense, reply with a short friendly greeting that invites them to say what they're looking for — do NOT invent a topic, and never react to UI words like 'Privacy & support', 'Marketplace', or menu labels. If you are unsure what they meant, ask a brief clarifying question in their language.");
  lines.push("");
  lines.push("Reply with the message text only (or one token). Keep it short and human, like a real seller texting on their phone — contractions, casual, sometimes a one-word answer. Never reuse the exact same opening sentence twice.");
  return lines.join("\n");
}

/* ---------------- Anthropic call ---------------- */

async function callClaude(settings, buyerMessage, extraContext) {
  if (!settings.apiKey) return { error: "No API key set." };
  const body = {
    model: settings.model || "claude-sonnet-4-6",
    max_tokens: 1024,
    system: buildSystemPrompt(settings),
    messages: [
      {
        role: "user",
        content:
          (extraContext ? extraContext + "\n\n" : "") +
          "Buyer's latest message:\n" +
          buyerMessage,
      },
    ],
  };

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const t = await resp.text();
      return { error: `Anthropic ${resp.status}: ${t.slice(0, 300)}` };
    }
    const data = await resp.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { text };
  } catch (e) {
    return { error: "Fetch failed: " + e.message };
  }
}

/* ---------------- reply token parsing ---------------- */

function parseReply(text) {
  if (!text) return { kind: "empty" };
  text = text.trim();

  // [VISIT:yes|no|maybe] is a silent prefix — capture it, strip it, then parse
  // whatever real reply follows (text or even a video).
  let visit = null;
  const visitMatch = text.match(/^\[VISIT:\s*(yes|no|maybe)\s*\]\s*([\s\S]*)$/i);
  if (visitMatch) {
    visit = visitMatch[1].toLowerCase();
    text = visitMatch[2].trim();
    if (!text) return { kind: "empty", visit }; // nothing left to send, but still record visit
  }

  const human = text.match(/\[HUMAN\]\s*([\s\S]*)/i);
  if (human && text.toUpperCase().startsWith("[HUMAN]")) {
    return { kind: "human", reason: human[1].trim(), visit };
  }
  const video = text.match(/\[VIDEO:([^\]]+)\]\s*([\s\S]*)/i);
  if (video && text.toUpperCase().startsWith("[VIDEO")) {
    return { kind: "video", url: video[1].trim(), caption: (video[2] || "").trim(), visit };
  }
  return { kind: "text", text: text.trim(), visit };
}

/* ---------------- the reply pipeline ----------------
 * The ONE reply path. Order of the gates matters — cheap/cap checks first so we
 * never spend an API call (or a reply slot) we shouldn't:
 *   1. business hours
 *   2. de-dupe: did we already answer this exact buyer message? (persisted)
 *   3. per-conversation reply cap (the user's "max N replies in one chat")
 *   4. hourly / daily caps
 *   5. ask Claude, parse, and — only when we actually return text — count it,
 *      bump the conversation counter, and remember the message we answered.
 */
async function handleGetReplySimple(msg) {
  const settings = await getSettings();
  if (!withinBusinessHours(settings)) return { ok: true, skip: true, reason: "outside business hours" };

  const threadId = msg.threadId || null;

  // 2) Already answered this person's latest message? Don't say it twice.
  if (threadId) {
    const last = await getLastAnswered(threadId);
    if (last != null && last === msg.buyerMessage) {
      return { ok: true, skip: true, reason: "already answered this message" };
    }
  }

  // 3) Per-conversation reply cap (total bot replies allowed in ONE chat).
  if (threadId && settings.maxRepliesPerConvo && settings.maxRepliesPerConvo > 0) {
    const count = await convoReplyCount(threadId);
    if (count >= settings.maxRepliesPerConvo) {
      if (settings.convoCapBehavior === "notify") {
        const notified = await getCapNotified();
        if (!notified[threadId]) {
          notifyHuman(`hit its ${settings.maxRepliesPerConvo}-reply limit — take over`, msg.threadName);
          await setCapNotified(threadId);
          await appendLog({ thread: msg.threadName, buyer: msg.buyerMessage, action: "cap", reply: `[CAP] reached ${settings.maxRepliesPerConvo} replies — notified operator` });
        }
      }
      return { ok: true, skip: true, reason: `conversation reply cap reached (${settings.maxRepliesPerConvo})` };
    }
  }

  // 4) Hourly / daily caps.
  const c = rollWindows(await getCounters(), Date.now());
  if (settings.hourlyCap && c.hourCount >= settings.hourlyCap) return { ok: true, skip: true, reason: "hourly cap reached" };
  if (settings.dailyCap && c.dayCount >= settings.dailyCap) return { ok: true, skip: true, reason: "daily cap reached" };

  // 5) Ask Claude.
  const result = await callClaude(
    settings,
    msg.buyerMessage,
    msg.context ? "Conversation so far (most recent last):\n" + msg.context : ""
  );
  if (result.error) return { ok: false, error: result.error };

  const parsed = parseReply(result.text);
  if (parsed.kind === "human") {
    notifyHuman(parsed.reason, msg.threadName);
    await appendLog({ thread: msg.threadName, buyer: msg.buyerMessage, action: "human", reply: "[HUMAN] " + parsed.reason });
    return { ok: true, human: true, reason: parsed.reason };
  }
  // A [VIDEO:url] just sends its caption as text in the simple build.
  const text = parsed.kind === "video" ? parsed.caption || "" : parsed.text;
  if (!text || !text.trim()) return { ok: true, skip: true, reason: "empty reply" };

  await incrementCounters();
  if (threadId) {
    await bumpConvoReply(threadId); // counts toward the per-conversation cap
    await setLastAnswered(threadId, msg.buyerMessage); // so a reload won't repeat it
  }
  await appendLog({ thread: msg.threadName, buyer: msg.buyerMessage, action: "text", reply: text });
  return { ok: true, text };
}

/* ---------------- video fetch ---------------- */

function abToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function fetchVideo(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return { error: `Video ${resp.status}` };
    const buf = await resp.arrayBuffer();
    const mime = resp.headers.get("content-type") || "video/mp4";
    return { ok: true, base64: abToBase64(buf), mime };
  } catch (e) {
    return { error: "Video fetch failed: " + e.message };
  }
}

/* ---------------- follow-ups (alarms) ---------------- */

const ALARM_PREFIX = "followup:";
const VISIT_PREFIX = "visitconfirm:";

const DEFAULT_VISIT_MSG =
  "Allô! 😊 Juste pour confirmer — tu passes toujours au shop? On va te faire un bon deal en personne! / Hey! Just confirming you're still coming by — we'll hook you up with a great deal in person 🙌";

async function scheduleFollowUps(threadId) {
  const settings = await getSettings();
  const ups = (settings.followUps || []).filter((f) => f.enabled);
  for (let i = 0; i < ups.length; i++) {
    const f = ups[i];
    const mins = Number(f.afterMinutes) || 0;
    if (mins <= 0) continue;
    const name = `${ALARM_PREFIX}${threadId}:${i}`;
    chrome.alarms.create(name, { when: Date.now() + mins * 60 * 1000 });
    LOG("scheduled follow-up", name, "in", mins, "min");
  }
}

/* Silent visit-confirmation: scheduled when a buyer signals they'll come.
 * Fires a gentle "still coming?" — the buyer's reply flows back through the
 * normal pipeline and is recorded as a [VISIT:…] status WITHOUT notifying the
 * operator. One pending confirm per thread. */
async function scheduleVisitConfirm(threadId) {
  const settings = await getSettings();
  if (!settings.visitConfirmEnabled) return;
  const mins = Number(settings.visitConfirmAfterMin) || 0;
  if (mins <= 0) return;
  const name = `${VISIT_PREFIX}${threadId}`;
  chrome.alarms.clear(name); // replace any pending one
  chrome.alarms.create(name, { when: Date.now() + mins * 60 * 1000 });
  LOG("scheduled visit-confirm", name, "in", mins, "min");
}

function cancelFollowUps(threadId) {
  chrome.alarms.getAll((alarms) => {
    for (const a of alarms) {
      if (
        a.name.startsWith(`${ALARM_PREFIX}${threadId}:`) ||
        a.name === `${VISIT_PREFIX}${threadId}`
      ) {
        chrome.alarms.clear(a.name);
        LOG("cancelled pending alarm", a.name);
      }
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!withinBusinessHours(settings)) {
    LOG("alarm skipped: outside business hours", alarm.name);
    return;
  }
  const rl = await checkRateLimit(settings);
  if (!rl.ok) {
    LOG("alarm skipped:", rl.reason);
    return;
  }

  // Silent visit-confirmation alarm
  if (alarm.name.startsWith(VISIT_PREFIX)) {
    const threadId = alarm.name.slice(VISIT_PREFIX.length);
    const tab = await findMessagesTab();
    if (!tab) {
      LOG("visit-confirm skipped: no messenger tab open");
      return;
    }
    const text = (settings.visitConfirmMessage || DEFAULT_VISIT_MSG);
    chrome.tabs.sendMessage(
      tab.id,
      { type: "SEND_FOLLOWUP", threadId, text, kind: "visitconfirm" },
      () => {
        if (chrome.runtime.lastError) LOG("visit-confirm send error", chrome.runtime.lastError.message);
      }
    );
    return;
  }

  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const rest = alarm.name.slice(ALARM_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  const threadId = rest.slice(0, sep);
  const idx = Number(rest.slice(sep + 1));

  const f = (settings.followUps || [])[idx];
  if (!f || !f.enabled) return;

  const tab = await findMessagesTab();
  if (!tab) {
    LOG("follow-up skipped: no messenger tab open");
    return;
  }
  chrome.tabs.sendMessage(
    tab.id,
    { type: "SEND_FOLLOWUP", threadId, text: f.message },
    () => {
      if (chrome.runtime.lastError) LOG("follow-up send error", chrome.runtime.lastError.message);
    }
  );
});

function findMessagesTab() {
  return new Promise((resolve) => {
    chrome.tabs.query(
      { url: ["https://*.messenger.com/*", "https://www.facebook.com/messages/*"] },
      (tabs) => resolve(tabs && tabs[0])
    );
  });
}

/* ---------------- notifications ---------------- */

function notifyHuman(reason, threadName) {
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon128.png",
    title: "SubSell — human needed",
    message: `${threadName || "A buyer"}: ${reason || "needs your attention"}`,
    priority: 2,
  });
}

/* ---------------- reply log ---------------- */
// Ring buffer of every send (and notable skip) so the operator can audit what
// each account is saying. Capped so storage doesn't grow unbounded.
const LOG_MAX = 500;

function appendLog(entry) {
  return new Promise((resolve) => {
    chrome.storage.local.get(["replyLog"], (res) => {
      const logArr = res.replyLog || [];
      logArr.push(Object.assign({ at: new Date().toISOString() }, entry));
      if (logArr.length > LOG_MAX) logArr.splice(0, logArr.length - LOG_MAX);
      chrome.storage.local.set({ replyLog: logArr }, resolve);
    });
  });
}

/* ---------------- message router ---------------- */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "GET_SETTINGS": {
          sendResponse({ ok: true, settings: await getSettings() });
          break;
        }
        case "SAVE_SETTINGS": {
          // Full config save (from options) -> synced chunks across computers.
          const s = msg.settings || {};
          const ok = await syncedConfigWrite(s);
          if (typeof s.enabled === "boolean") {
            await new Promise((r) => chrome.storage.local.set({ enabledLocal: s.enabled }, r));
          }
          sendResponse({ ok });
          break;
        }
        case "SET_ENABLED": {
          // Per-machine on/off toggle — local only, no sync writes (cheap).
          await new Promise((r) => chrome.storage.local.set({ enabledLocal: !!msg.enabled }, r));
          sendResponse({ ok: true });
          break;
        }
        case "FETCH_CONFIG": {
          // Options "Fetch now" — pull the shared config from the permanent link.
          sendResponse(await fetchRemoteConfig());
          break;
        }
        case "GET_STATUS": {
          const settings = await getSettings();
          const counters = rollWindows(await getCounters(), Date.now());
          const dayCap = await effectiveDailyCap(settings);
          sendResponse({
            ok: true,
            enabled: settings.enabled,
            apiKeySet: !!settings.apiKey,
            hourCount: counters.hourCount,
            dayCount: counters.dayCount,
            hourlyCap: settings.hourlyCap,
            dailyCap: dayCap,
            fullDailyCap: settings.dailyCap,
            warming: dayCap < settings.dailyCap,
            withinHours: withinBusinessHours(settings),
          });
          break;
        }
        case "GET_REPLY_SIMPLE": {
          // The ONLY reply path. All gating (business hours, de-dupe, per-convo
          // cap, hourly/daily caps) lives in handleGetReplySimple. We wrap it in a
          // per-thread lock so two tabs of the same account can't both reply at once.
          const threadId = msg.threadId || null;
          if (threadId && processingThreads.has(threadId)) {
            sendResponse({ ok: true, skip: true, reason: "already handling this thread" });
            break;
          }
          if (threadId) processingThreads.add(threadId);
          try {
            sendResponse(await handleGetReplySimple(msg));
          } finally {
            if (threadId) processingThreads.delete(threadId);
          }
          break;
        }
        case "CLAIM_VIDEO": {
          // Atomic "may I send the demo video to this chat?" claim. The sync
          // check-and-add on videoClaims can't race (singleton worker); the
          // persisted map covers reloads / past sessions.
          const id = msg.threadId;
          if (!id) {
            sendResponse({ ok: true, already: false });
            break;
          }
          if (videoClaims.has(id)) {
            sendResponse({ ok: true, already: true });
            break;
          }
          videoClaims.add(id); // claim now, synchronously
          const sentMap = await getVideoSentThreads();
          sendResponse({ ok: true, already: !!sentMap[id] });
          break;
        }
        case "VIDEO_SENT": {
          // Persist so we never send the demo video to this chat again.
          if (msg.threadId) {
            videoClaims.add(msg.threadId);
            await markVideoSent(msg.threadId);
          }
          sendResponse({ ok: true });
          break;
        }
        case "VIDEO_FAILED": {
          // No uploader found / error — release the in-memory claim so a later
          // turn can retry (the persisted "sent" flag was never written).
          if (msg.threadId) videoClaims.delete(msg.threadId);
          sendResponse({ ok: true });
          break;
        }
        case "GET_VISITS": {
          chrome.storage.local.get(["visits"], (res) => sendResponse({ ok: true, visits: res.visits || {} }));
          return true; // async storage callback
        }
        case "CLEAR_VISITS": {
          chrome.storage.local.set({ visits: {} }, () => sendResponse({ ok: true }));
          return true;
        }
        case "TEST_REPLY": {
          // Options "Test responses" tab — does not touch rate limits/Facebook.
          const settings = await getSettings();
          const result = await callClaude(settings, msg.buyerMessage, msg.context);
          if (result.error) sendResponse({ ok: false, error: result.error });
          else sendResponse({ ok: true, raw: result.text, parsed: parseReply(result.text) });
          break;
        }
        case "FETCH_VIDEO": {
          sendResponse(await fetchVideo(msg.url));
          break;
        }
        case "BOT_REPLIED": {
          await scheduleFollowUps(msg.threadId);
          sendResponse({ ok: true });
          break;
        }
        case "BUYER_REPLIED": {
          cancelFollowUps(msg.threadId);
          sendResponse({ ok: true });
          break;
        }
        case "NOTIFY_HUMAN": {
          notifyHuman(msg.reason, msg.threadName);
          sendResponse({ ok: true });
          break;
        }
        case "LOG_EVENT": {
          // content.js logs follow-ups and failures here.
          await appendLog(msg.entry || {});
          sendResponse({ ok: true });
          break;
        }
        case "GET_LOG": {
          chrome.storage.local.get(["replyLog"], (res) =>
            sendResponse({ ok: true, log: res.replyLog || [] })
          );
          return true; // async storage callback
        }
        case "CLEAR_LOG": {
          chrome.storage.local.set({ replyLog: [] }, () => sendResponse({ ok: true }));
          return true;
        }
        default:
          sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async
});

/* ---------------- background heartbeat ----------------
 * Backgrounded tabs throttle setInterval to ~once/minute, which would slow the
 * scan loop while the operator works in other tabs. A chrome.alarms heartbeat
 * (not throttled) pings the messenger tab every minute to force a scan. The
 * content script's own 8s interval still drives things when the tab is focused;
 * this just guarantees progress when it is not. Alarms also wake the MV3 worker.
 * Note: alarms fire at most once/minute — that's the floor Chrome allows. */
const HEARTBEAT_ALARM = "subsell-heartbeat";
chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });

// Re-pull the shared remote config every 10 min (and once now), so edits to your
// permanent link reach every machine without re-entering anything.
const CONFIG_ALARM = "subsell-config";
chrome.alarms.create(CONFIG_ALARM, { periodInMinutes: 10 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === CONFIG_ALARM) fetchRemoteConfig();
});
fetchRemoteConfig();

async function heartbeat() {
  const settings = await getSettings();
  if (!settings.enabled) return;
  // Ping EVERY open Messenger tab (not just the first) so multiple windows in the
  // same profile all keep scanning while backgrounded. Each separate Chrome
  // profile runs its own independent copy of this worker.
  const tabs = await new Promise((resolve) => {
    chrome.tabs.query(
      { url: ["https://*.messenger.com/*", "https://www.facebook.com/messages/*", "https://www.facebook.com/marketplace/*"] },
      (t) => resolve(t || [])
    );
  });
  for (const tab of tabs) {
    chrome.tabs.sendMessage(tab.id, { type: "TICK_NOW" }, () => void chrome.runtime.lastError);
  }
}

// Fold the heartbeat into the existing alarm listener path.
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === HEARTBEAT_ALARM) heartbeat();
});

/* One-time migration: if this machine has legacy local 'settings' but sync is
 * empty, seed sync from it so other computers inherit the existing config. */
chrome.storage.sync.get(["cfg_count"], (meta) => {
  if (meta && typeof meta.cfg_count === "number") return; // already syncing
  chrome.storage.local.get(["settings"], (res) => {
    if (res && res.settings && Object.keys(res.settings).length) {
      syncedConfigWrite(res.settings).then(() => LOG("migrated local settings -> sync"));
    }
  });
});

LOG("service worker started");
