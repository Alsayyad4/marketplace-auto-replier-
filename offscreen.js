/* SubSell — offscreen document (v0.21.49): KEEP AWAKE.
 * A tab that is being captured is treated by Chrome as VISIBLE: it keeps
 * rendering, its timers are not throttled, media loads, and the page reads
 * document.visibilityState === "visible" — even with the window minimized and
 * the mouse elsewhere. That is exactly the state Messenger's video uploader
 * needs. The popup's 🔋 button (a user click — Chrome's requirement) obtains a
 * stream id for the Messenger tab; this document consumes it as a tiny 2-fps,
 * 256×144 stream and simply keeps it alive. Nothing is recorded or sent
 * anywhere. Streams end when Chrome restarts or the extension updates. */
const streams = {};
chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (!msg || typeof msg.type !== "string" || msg.type.indexOf("AWAKE_") !== 0) return false;
  if (msg.type === "AWAKE_CONSUME") {
    const tabId = msg.tabId;
    if (streams[tabId]) { send({ ok: true, already: true }); return true; }
    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: msg.streamId, maxWidth: 256, maxHeight: 144, maxFrameRate: 2 } },
    }).then((s) => {
      streams[tabId] = s;
      const t = s.getVideoTracks()[0];
      if (t) t.addEventListener("ended", () => {
        delete streams[tabId];
        try { chrome.runtime.sendMessage({ type: "AWAKE_ENDED", tabId }, () => void chrome.runtime.lastError); } catch (e) { /* worker asleep */ }
      });
      send({ ok: true });
    }).catch((e) => send({ ok: false, error: String((e && e.message) || e) }));
    return true;
  }
  if (msg.type === "AWAKE_STOP") {
    const s = streams[msg.tabId];
    if (s) { s.getTracks().forEach((t) => t.stop()); delete streams[msg.tabId]; }
    send({ ok: true });
    return true;
  }
  if (msg.type === "AWAKE_LIST") { send({ ok: true, tabs: Object.keys(streams).map(Number) }); return true; }
  return false;
});
