// Loads the chrome-free "Try it" slice of background.js exactly like docs/app.js does,
// with a fake fetch that CAPTURES the request the extension would send to Anthropic.
const fs = require("fs");
const SRC = "C:/Users/hovig/projects/marketplace-auto-replier/background.js";
const CORE_BEGIN = "/* ===================== (v0.21.73) THE OWNER IS THE ONLY TEACHER";
const CORE_END = "/* ---------------- video fetch ---------------- */";

function load(onBody) {
  const src = fs.readFileSync(SRC, "utf8");
  const a = src.indexOf(CORE_BEGIN), b = src.indexOf(CORE_END, a);
  if (a < 0 || b < 0) throw new Error("slice markers not found");
  const fakeFetch = async (u, o) => {
    let body = null;
    try { body = JSON.parse(o && o.body); } catch (e) {}
    const text = onBody ? (onBody(body) || "captured") : "captured";
    return {
      ok: true, status: 200,
      headers: { get: () => null },
      json: async () => ({ id: "msg_x", type: "message", role: "assistant", model: body && body.model, content: [{ type: "text", text }], usage: { input_tokens: 1, output_tokens: 1 } }),
      text: async () => "",
    };
  };
  const ret = "\nreturn { buildSystemPrompt, buildOwnerPrompt, lessonFor, callClaude, parseReply, writeReply, metaVerdict, humanTouch, listingContext, listingFromTitle, ownerEntryFor, nowLine, trimContext, ownerTextOf };";
  return new Function("DEFAULTS", "fetch", src.slice(a, b) + ret)({}, fakeFetch);
}
module.exports = { load };
