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

async function checkRateLimit(settings) {
  const now = Date.now();
  const c = rollWindows(await getCounters(), now);
  if (c.hourCount >= settings.hourlyCap) return { ok: false, reason: "hourly cap reached" };
  if (c.dayCount >= settings.dailyCap) return { ok: false, reason: "daily cap reached" };
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
  lines.push("- [HUMAN] <reason> — when you should NOT auto-reply: scams, hard negotiation, weird/risky requests. The human is notified instead.");
  lines.push("- [VIDEO:<url>] <optional caption> — to send a demo video. Use a videoUrl from the listings/video library when the buyer asks to see the phone.");
  lines.push("");
  lines.push("Reply with the message text only (or one token). Keep it short and human, like a real seller texting.");
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
          sendResponse({
            ok: true,
            enabled: settings.enabled,
            apiKeySet: !!settings.apiKey,
            hourCount: counters.hourCount,
            dayCount: counters.dayCount,
            hourlyCap: settings.hourlyCap,
            dailyCap: settings.dailyCap,
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
            sendResponse({ ok: true, action: "human", reason: parsed.reason, raw: result.text });
            break;
          }
          // text or video both consume a rate-limit slot (they get sent)
          await incrementCounters();
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
