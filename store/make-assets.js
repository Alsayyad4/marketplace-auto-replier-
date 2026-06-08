/* Generates SubSell Web Store images (no external libs): a 1280x800 screenshot
 * and the optional 440x280 + 1400x560 promo tiles. 24-bit RGB PNG (no alpha),
 * anti-aliased via supersampling, with a built-in 5x7 bitmap font.
 *   node store/make-assets.js
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");
const OUT = __dirname;

/* ---------- PNG (RGB, no alpha) ---------- */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function ch(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const b = Buffer.concat([Buffer.from(t, "ascii"), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(b), 0); return Buffer.concat([l, b, c]); }
function png(rgb, W, H) {
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc(H * (1 + W * 3)); let p = 0;
  for (let y = 0; y < H; y++) { raw[p++] = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[p++] = rgb[i]; raw[p++] = rgb[i + 1]; raw[p++] = rgb[i + 2]; } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch("IHDR", ih), ch("IDAT", zlib.deflateSync(raw, { level: 9 })), ch("IEND", Buffer.alloc(0))]);
}

/* ---------- 5x7 bitmap font (uppercase + digits + a little punctuation) ---------- */
const F = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"], B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"], D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"], F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10011", "10001", "10001", "01111"], H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"], J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"], L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"], N: ["10001", "10001", "11001", "10101", "10011", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"], R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"], T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"], V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"], X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"], Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  0: ["01110", "10001", "10011", "10101", "11001", "10001", "01110"], 1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"], 3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], 5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["01110", "10000", "10000", "11110", "10001", "10001", "01110"], 7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], 9: ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"], "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"], "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"], ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"], "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"], "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
};

/* ---------- canvas + drawing (operates at supersampled resolution) ---------- */
function Canvas(W, H, S) { return { W: W * S, H: H * S, S, buf: new Uint8Array(W * S * H * S * 3) }; }
function px(c, x, y, col) { x = x | 0; y = y | 0; if (x < 0 || y < 0 || x >= c.W || y >= c.H) return; const i = (y * c.W + x) * 3; c.buf[i] = col[0]; c.buf[i + 1] = col[1]; c.buf[i + 2] = col[2]; }
function gradient(c, top, bot) { for (let y = 0; y < c.H; y++) { const t = y / (c.H - 1); const r = top[0] + (bot[0] - top[0]) * t, g = top[1] + (bot[1] - top[1]) * t, b = top[2] + (bot[2] - top[2]) * t; for (let x = 0; x < c.W; x++) px(c, x, y, [r, g, b]); } }
function rrect(c, X, Y, W, H, R, col) { const S = c.S; X *= S; Y *= S; W *= S; H *= S; R *= S; for (let y = Y; y < Y + H; y++) for (let x = X; x < X + W; x++) { const dx = Math.max(X + R - x, x - (X + W - R), 0), dy = Math.max(Y + R - y, y - (Y + H - R), 0); if (dx * dx + dy * dy <= R * R) px(c, x, y, col); } }
function circle(c, cx, cy, r, col) { const S = c.S; cx *= S; cy *= S; r *= S; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) px(c, x, y, col); } }
function tri(c, ax, ay, bx, by, cx2, cy2, col) { const S = c.S; ax *= S; ay *= S; bx *= S; by *= S; cx2 *= S; cy2 *= S; const minx = Math.min(ax, bx, cx2), maxx = Math.max(ax, bx, cx2), miny = Math.min(ay, by, cy2), maxy = Math.max(ay, by, cy2); const sg = (px2, py, x1, y1, x2, y2) => (px2 - x2) * (y1 - y2) - (x1 - x2) * (py - y2); for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) { const d1 = sg(x, y, ax, ay, bx, by), d2 = sg(x, y, bx, by, cx2, cy2), d3 = sg(x, y, cx2, cy2, ax, ay); if (!(((d1 < 0) || (d2 < 0) || (d3 < 0)) && ((d1 > 0) || (d2 > 0) || (d3 > 0)))) px(c, x, y, col); } }
function text(c, X, Y, str, scale, col) { const S = c.S; str = String(str).toUpperCase(); let cx = X; for (const chr of str) { const g = F[chr] || F["?"]; for (let r = 0; r < 7; r++) for (let k = 0; k < 5; k++) if (g[r][k] === "1") { const bx = (cx + k * scale) * S, by = (Y + r * scale) * S, blk = scale * S; for (let yy = 0; yy < blk; yy++) for (let xx = 0; xx < blk; xx++) px(c, bx + xx, by + yy, col); } cx += 6 * scale; } return cx - X; }
function textW(str, scale) { return String(str).length * 6 * scale; }
function chatBubble(c, X, Y, W, H, col, tail) { rrect(c, X, Y, W, H, Math.min(16, H / 3), col); if (tail) tri(c, X + 10, Y + H - 8, X + 28, Y + H - 8, X + 4, Y + H + 12, col); }
function down(c, W, H) { const S = c.S, out = new Uint8Array(W * H * 3), n = S * S; for (let oy = 0; oy < H; oy++) for (let ox = 0; ox < W; ox++) { let r = 0, g = 0, b = 0; for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((oy * S + j) * c.W + (ox * S + i)) * 3; r += c.buf[k]; g += c.buf[k + 1]; b += c.buf[k + 2]; } const o = (oy * W + ox) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n); } return out; }

const BLUE = [24, 119, 242], BLUED = [16, 86, 200], WHITE = [255, 255, 255], INK = [32, 38, 48], GREYBG = [240, 242, 245], GREYB = [228, 230, 235], SUB = [210, 225, 255];

/* small SubSell mark: rounded blue square + white chat bubble + dots */
function mark(c, X, Y, s) { rrect(c, X, Y, s, s, s * 0.22, BLUE); const bx = X + s * 0.16, by = Y + s * 0.20, bw = s * 0.68, bh = s * 0.44; chatBubble(c, bx, by, bw, bh, WHITE, true); const cy = by + bh / 2, r = s * 0.045; for (let i = -1; i <= 1; i++) circle(c, bx + bw / 2 + i * s * 0.16, cy, r, BLUE); }

/* ---------- 1) Screenshot 1280x800 ---------- */
function screenshot() {
  const W = 1280, H = 800, S = 3, c = Canvas(W, H, S);
  gradient(c, [56, 132, 255], [18, 84, 214]);
  // right light panel (chat area)
  rrect(c, 560, 0, 720, 800, 0, GREYBG);
  // left content
  mark(c, 56, 64, 92);
  text(c, 56, 196, "SUBSELL", 8, WHITE);
  text(c, 56, 268, "AUTO-REPLY", 8, WHITE);
  text(c, 58, 360, "AI ANSWERS YOUR MARKETPLACE", 3, SUB);
  text(c, 58, 394, "BUYERS - IN YOUR VOICE.", 3, SUB);
  const bul = ["BILINGUAL FR / EN", "YOUR PRICES & RULES", "HUMAN WHEN IT MATTERS", "YOUR OWN CLAUDE API KEY"];
  bul.forEach((t, i) => { const y = 486 + i * 58; circle(c, 72, y + 8, 6, WHITE); text(c, 94, y, t, 3, WHITE); });
  // chat mock (right)
  rrect(c, 600, 90, 640, 620, 26, WHITE);
  text(c, 636, 120, "MESSENGER - MARKETPLACE", 2, [140, 146, 156]);
  chatBubble(c, 636, 170, 470, 60, GREYB, false); text(c, 660, 188, "IS THE 13 STILL AVAILABLE?", 2, INK);
  chatBubble(c, 720, 262, 484, 96, BLUE, false); text(c, 744, 280, "YES! 256GB, 91% BATTERY.", 2, WHITE); text(c, 744, 312, "PICKUP ON BEAUBIEN TODAY.", 2, WHITE);
  chatBubble(c, 636, 392, 420, 60, GREYB, false); text(c, 660, 410, "CAN I SEE IT WORKING?", 2, INK);
  chatBubble(c, 760, 484, 444, 96, BLUE, false); text(c, 784, 502, "SENDING A QUICK VIDEO", 2, WHITE); text(c, 784, 534, "NOW - 2 MIN AWAY!", 2, WHITE);
  text(c, 636, 636, "AUTO-REPLIED IN 30S  -  YOU STAYED HANDS-OFF", 2, [120, 170, 120]);
  return { name: "screenshot-1280x800.png", buf: png(down(c, W, H), W, H), W, H };
}

/* ---------- 2) Small promo tile 440x280 ---------- */
function small() {
  const W = 440, H = 280, S = 4, c = Canvas(W, H, S);
  gradient(c, [56, 132, 255], [18, 84, 214]);
  mark(c, 28, 28, 70);
  text(c, 112, 40, "SUBSELL", 5, WHITE);
  text(c, 112, 86, "AUTO-REPLY", 4, SUB);
  text(c, 30, 168, "AI REPLIES FOR YOUR", 3, WHITE);
  text(c, 30, 200, "MARKETPLACE BUYERS", 3, WHITE);
  text(c, 30, 236, "BILINGUAL FR / EN", 2, SUB);
  return { name: "promo-small-440x280.png", buf: png(down(c, W, H), W, H), W, H };
}

/* ---------- 3) Marquee promo tile 1400x560 ---------- */
function marquee() {
  const W = 1400, H = 560, S = 2, c = Canvas(W, H, S);
  gradient(c, [56, 132, 255], [18, 84, 214]);
  mark(c, 110, 150, 260);
  text(c, 470, 150, "SUBSELL", 16, WHITE);
  text(c, 470, 290, "AUTO-REPLY", 13, SUB);
  text(c, 474, 416, "AI ANSWERS YOUR MARKETPLACE BUYERS.", 3, WHITE);
  return { name: "promo-marquee-1400x560.png", buf: png(down(c, W, H), W, H), W, H };
}

for (const f of [screenshot, small, marquee]) {
  const o = f();
  fs.writeFileSync(path.join(OUT, o.name), o.buf);
  console.log("wrote", o.name, `${o.W}x${o.H}`, o.buf.length, "bytes");
}
