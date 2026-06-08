/* Generates SubSell store icons as 24-bit PNGs (no external libs).
 * Design: full-bleed blue gradient + white chat bubble (auto-reply) with a tail
 * and three dots. Anti-aliased via 4x supersampling. Node >=16.
 *
 *   node store/make-icon.js
 * Outputs: store/icon-store-128.png  (+ 48 and 16 for the extension if wanted)
 */
const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const OUTDIR = path.join(__dirname);

/* ---------- tiny PNG (RGB, 8-bit, no alpha) encoder ---------- */
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgb, W, H) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2; // RGB
  const raw = Buffer.alloc(H * (1 + W * 3));
  let p = 0;
  for (let y = 0; y < H; y++) { raw[p++] = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; raw[p++] = rgb[i]; raw[p++] = rgb[i + 1]; raw[p++] = rgb[i + 2]; } }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- geometry helpers (operate in 128-space) ---------- */
function inRoundRect(x, y, rx, ry, rw, rh, rad) {
  const cx = rx + rw / 2, cy = ry + rh / 2;
  const qx = Math.abs(x - cx) - (rw / 2 - rad);
  const qy = Math.abs(y - cy) - (rh / 2 - rad);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - rad <= 0;
}
function sign(px, py, ax, ay, bx, by) { return (px - bx) * (ay - by) - (ax - bx) * (py - by); }
function inTri(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = sign(px, py, ax, ay, bx, by), d2 = sign(px, py, bx, by, cx, cy), d3 = sign(px, py, cx, cy, ax, ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0, pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
function inCircle(x, y, cx, cy, r) { const dx = x - cx, dy = y - cy; return dx * dx + dy * dy <= r * r; }

/* ---------- render one icon at size OUT (supersampled) ---------- */
function render(OUT) {
  const S = 4, BIG = OUT * S, U = OUT / 128; // U scales 128-space design to OUT
  const big = new Uint8Array(BIG * BIG * 3);
  const top = [56, 132, 255], bot = [21, 86, 214]; // blue gradient
  const WHITE = [255, 255, 255], DOT = [24, 119, 242];
  for (let yb = 0; yb < BIG; yb++) {
    const tg = yb / (BIG - 1);
    const bgr = top[0] + (bot[0] - top[0]) * tg, bgg = top[1] + (bot[1] - top[1]) * tg, bgb = top[2] + (bot[2] - top[2]) * tg;
    for (let xb = 0; xb < BIG; xb++) {
      const x = ((xb + 0.5) / S) / U, y = ((yb + 0.5) / S) / U; // back to 128-space
      let c0 = bgr, c1 = bgg, c2 = bgb;
      // chat bubble + tail
      if (inRoundRect(x, y, 26, 28, 76, 50, 15) || inTri(x, y, 40, 73, 60, 73, 34, 94)) { c0 = WHITE[0]; c1 = WHITE[1]; c2 = WHITE[2]; }
      // three dots
      if (inCircle(x, y, 47, 52, 5.5) || inCircle(x, y, 64, 52, 5.5) || inCircle(x, y, 81, 52, 5.5)) { c0 = DOT[0]; c1 = DOT[1]; c2 = DOT[2]; }
      const i = (yb * BIG + xb) * 3; big[i] = c0; big[i + 1] = c1; big[i + 2] = c2;
    }
  }
  // downsample BIG -> OUT (box average)
  const out = new Uint8Array(OUT * OUT * 3), n = S * S;
  for (let oy = 0; oy < OUT; oy++) for (let ox = 0; ox < OUT; ox++) {
    let r = 0, g = 0, b = 0;
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const k = ((oy * S + j) * BIG + (ox * S + i)) * 3; r += big[k]; g += big[k + 1]; b += big[k + 2]; }
    const o = (oy * OUT + ox) * 3; out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
  }
  return out;
}

for (const sz of [128, 48, 16]) {
  const png = encodePNG(render(sz), sz, sz);
  const name = sz === 128 ? "icon-store-128.png" : `icon-${sz}.png`;
  fs.writeFileSync(path.join(OUTDIR, name), png);
  console.log("wrote", name, png.length, "bytes");
}
