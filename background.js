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

function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["settings"], (res) => {
      resolve(Object.assign({}, DEFAULTS, res.settings || {}));
    });
  });
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

  if (Array.isArray(settings.listings) && settings.listings.length) {
    lines.push("");
    lines.push("CURRENT LISTINGS (only quote available items):");
    for (const l of settings.listings) {
      lines.push(
        `- ${l.title || l.model || "item"} | ${l.storage || ""} | ${l.condition || ""} | $${l.price || "?"} CAD | available: ${l.available === false ? "no" : "yes"}${l.videoUrl ? " | video: " + l.videoUrl : ""}`
      );
    }
  }

  lines.push("");
  lines.push("SPECIAL REPLY TOKENS (use at most one, alone on the first line):");
  lines.push("- [HUMAN] <reason> — when you should NOT auto-reply: scams, hard negotiation past the discount floor, payment/shipping requests, off-platform contact pressure, address/meetup logistics, or anything weird/risky. The human is notified instead.");
  lines.push("- [VIDEO:<url>] <optional caption> — to send a demo video. Use a videoUrl from the listings/video library when the buyer asks to see the phone working/condition. VARY the caption each time; never reuse the same caption wording.");

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
  const human = text.match(/\[HUMAN\]\s*([\s\S]*)/i);
  if (human && text.trim().toUpperCase().startsWith("[HUMAN]")) {
    return { kind: "human", reason: human[1].trim() };
  }
  const video = text.match(/\[VIDEO:([^\]]+)\]\s*([\s\S]*)/i);
  if (video && text.trim().toUpperCase().startsWith("[VIDEO")) {
    return { kind: "video", url: video[1].trim(), caption: (video[2] || "").trim() };
  }
  return { kind: "text", text: text.trim() };
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

function cancelFollowUps(threadId) {
  chrome.alarms.getAll((alarms) => {
    for (const a of alarms) {
      if (a.name.startsWith(`${ALARM_PREFIX}${threadId}:`)) {
        chrome.alarms.clear(a.name);
        LOG("cancelled follow-up", a.name);
      }
    }
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const rest = alarm.name.slice(ALARM_PREFIX.length);
  const sep = rest.lastIndexOf(":");
  const threadId = rest.slice(0, sep);
  const idx = Number(rest.slice(sep + 1));

  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!withinBusinessHours(settings)) {
    LOG("follow-up skipped: outside business hours", alarm.name);
    return;
  }
  const rl = await checkRateLimit(settings);
  if (!rl.ok) {
    LOG("follow-up skipped:", rl.reason);
    return;
  }
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
        case "GET_REPLY": {
          const settings = await getSettings();
          if (!withinBusinessHours(settings)) {
            sendResponse({ ok: true, blocked: true, reason: "outside business hours" });
            break;
          }
          const rl = await checkRateLimit(settings);
          if (!rl.ok) {
            sendResponse({ ok: true, blocked: true, reason: rl.reason });
            break;
          }
          const result = await callClaude(settings, msg.buyerMessage, msg.context);
          if (result.error) {
            sendResponse({ ok: false, error: result.error });
            break;
          }
          const parsed = parseReply(result.text);
          if (parsed.kind === "human") {
            notifyHuman(parsed.reason, msg.threadName);
            await appendLog({
              thread: msg.threadName,
              buyer: msg.buyerMessage,
              action: "human",
              reply: "[HUMAN] " + parsed.reason,
            });
            sendResponse({ ok: true, action: "human", reason: parsed.reason, raw: result.text });
            break;
          }
          if (parsed.kind === "empty") {
            // Nothing to send — don't consume a rate-limit slot.
            sendResponse({ ok: true, blocked: true, reason: "empty reply from model" });
            break;
          }
          // text or video both consume a rate-limit slot (they get sent)
          await incrementCounters();
          await appendLog({
            thread: msg.threadName,
            buyer: msg.buyerMessage,
            action: parsed.kind,
            reply: parsed.kind === "video" ? `[VIDEO ${parsed.url}] ${parsed.caption || ""}` : parsed.text,
          });
          sendResponse({ ok: true, action: parsed.kind, ...parsed, raw: result.text });
          break;
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

LOG("service worker started");
