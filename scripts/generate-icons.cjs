#!/usr/bin/env node
/**
 * Generate simple PNG app icons for Randomovie.
 * Pure Node.js — no external dependencies. Uses zlib for DEFLATE.
 *
 * Produces a dark navy background (#1a1a2e) with a stylised film
 * clapperboard drawn from basic geometric shapes in accent colours.
 */

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

// ── colour palette ──────────────────────────────────────────────
const BG      = [0x1a, 0x1a, 0x2e];
const BOARD   = [0x16, 0x21, 0x3e];
const CLAP    = [0xe9, 0x4d, 0x6b];
const CLAP2   = [0xc0, 0x39, 0x56];
const STRIPE  = [0x1a, 0x1a, 0x2e];
const LENS    = [0x53, 0x54, 0x8a];
const HIGHLIGHT = [0xf0, 0xf0, 0xf0];
const DARK    = [0x0f, 0x0f, 0x23];

// ── PNG helpers ─────────────────────────────────────────────────
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++)
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++)
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([len, typeAndData, crc]);
}

function makePNG(width, height, pixels) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    for (let x = 0; x < width; x++) {
      const si = (y * width + x) * 3;
      const di = y * (1 + width * 3) + 1 + x * 3;
      raw[di]     = pixels[si];
      raw[di + 1] = pixels[si + 1];
      raw[di + 2] = pixels[si + 2];
    }
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", Buffer.alloc(0))]);
}

// ── drawing primitives ──────────────────────────────────────────
function setPixel(px, w, h, x, y, col) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || x >= w || y < 0 || y >= h) return;
  const i = (y * w + x) * 3;
  px[i] = col[0]; px[i+1] = col[1]; px[i+2] = col[2];
}

function fillRect(px, w, h, rx, ry, rw, rh, col) {
  for (let y = Math.max(0, Math.floor(ry)); y < Math.min(h, Math.ceil(ry+rh)); y++)
    for (let x = Math.max(0, Math.floor(rx)); x < Math.min(w, Math.ceil(rx+rw)); x++)
      setPixel(px, w, h, x, y, col);
}

function fillCircle(px, w, h, cx, cy, r, col) {
  const r2 = r * r;
  for (let y = Math.floor(cy-r); y <= Math.ceil(cy+r); y++)
    for (let x = Math.floor(cx-r); x <= Math.ceil(cx+r); x++)
      if ((x-cx)**2 + (y-cy)**2 <= r2) setPixel(px, w, h, x, y, col);
}

function fillRoundRect(px, w, h, rx, ry, rw, rh, rad, col) {
  for (let y = Math.max(0, Math.floor(ry)); y < Math.min(h, Math.ceil(ry+rh)); y++)
    for (let x = Math.max(0, Math.floor(rx)); x < Math.min(w, Math.ceil(rx+rw)); x++) {
      let inside = true;
      const lx = x - rx, ly = y - ry;
      if      (lx < rad && ly < rad)             inside = (lx-rad)**2 + (ly-rad)**2 <= rad*rad;
      else if (lx > rw-rad && ly < rad)           inside = (lx-(rw-rad))**2 + (ly-rad)**2 <= rad*rad;
      else if (lx < rad && ly > rh-rad)           inside = (lx-rad)**2 + (ly-(rh-rad))**2 <= rad*rad;
      else if (lx > rw-rad && ly > rh-rad)        inside = (lx-(rw-rad))**2 + (ly-(rh-rad))**2 <= rad*rad;
      if (inside) setPixel(px, w, h, x, y, col);
    }
}

function pointInTriangle(px, py, v0, v1, v2) {
  const sign = (a, b, c) => (a[0]-c[0])*(b[1]-c[1]) - (b[0]-c[0])*(a[1]-c[1]);
  const d1 = sign([px,py], v0, v1);
  const d2 = sign([px,py], v1, v2);
  const d3 = sign([px,py], v2, v0);
  const hasNeg = (d1<0)||(d2<0)||(d3<0);
  const hasPos = (d1>0)||(d2>0)||(d3>0);
  return !(hasNeg && hasPos);
}

// ── draw the icon ───────────────────────────────────────────────
function drawIcon(size) {
  const px = new Uint8Array(size * size * 3);
  const S = size / 512; // scale factor

  // background
  fillRect(px, size, size, 0, 0, size, size, BG);

  // ── clapperboard body ──
  const bx = 96*S, by = 170*S, bw = 320*S, bh = 230*S;
  fillRoundRect(px, size, size, bx, by, bw, bh, 18*S, BOARD);

  // ── clapper top bar ──
  fillRoundRect(px, size, size, bx-6*S, 120*S, bw+4*S, 28*S, 6*S, CLAP);
  // ── clapper bottom bar ──
  fillRoundRect(px, size, size, bx, 145*S, bw, 28*S, 6*S, CLAP2);

  // diagonal stripes on top bar
  for (let i = 0; i < 9; i++) {
    const sx = bx + i * 50*S - 10*S;
    for (let y = Math.floor(120*S); y < Math.floor(148*S); y++) {
      for (let dx = 0; dx < 12*S; dx++) {
        const x = sx + dx + (y - 120*S) * 0.6;
        if (x >= bx-6*S && x < bx+bw+4*S)
          setPixel(px, size, size, x, y, STRIPE);
      }
    }
  }
  // diagonal stripes on bottom bar
  for (let i = 0; i < 9; i++) {
    const sx = bx + i * 50*S + 5*S;
    for (let y = Math.floor(145*S); y < Math.floor(173*S); y++) {
      for (let dx = 0; dx < 10*S; dx++) {
        const x = sx + dx + (y - 145*S) * 0.6;
        if (x >= bx && x < bx+bw)
          setPixel(px, size, size, x, y, STRIPE);
      }
    }
  }

  // hinge circle
  fillCircle(px, size, size, bx+18*S, 140*S, 8*S, HIGHLIGHT);

  // ── screen area ──
  fillRoundRect(px, size, size, 116*S, 195*S, 280*S, 150*S, 10*S, DARK);

  // ── film reel ──
  const cx = 256*S, cy = 270*S, oR = 50*S;
  fillCircle(px, size, size, cx, cy, oR, LENS);
  fillCircle(px, size, size, cx, cy, oR*0.55, DARK);
  fillCircle(px, size, size, cx, cy, oR*0.18, LENS);

  // spokes
  for (let a = 0; a < 4; a++) {
    const angle = a * Math.PI / 4;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    for (let t = oR*0.18; t < oR*0.55; t += 0.5) {
      for (let d = -2*S; d <= 2*S; d++) {
        setPixel(px, size, size, cx+cos*t-sin*d, cy+sin*t+cos*d, LENS);
      }
    }
  }

  // perimeter dots
  for (let a = 0; a < 8; a++) {
    const angle = a * Math.PI * 2 / 8;
    fillCircle(px, size, size, cx+Math.cos(angle)*oR*0.78, cy+Math.sin(angle)*oR*0.78, 4*S, DARK);
  }

  // ── play triangle ──
  const tS = 13*S;
  const v0 = [cx + tS*0.8, cy];
  const v1 = [cx - tS*0.5, cy - tS*0.7];
  const v2 = [cx - tS*0.5, cy + tS*0.7];
  for (let y = Math.floor(cy-tS); y <= Math.ceil(cy+tS); y++)
    for (let x = Math.floor(cx-tS); x <= Math.ceil(cx+tS); x++)
      if (pointInTriangle(x, y, v0, v1, v2))
        setPixel(px, size, size, x, y, HIGHLIGHT);

  // ── film strip holes on left edge ──
  for (let i = 0; i < 5; i++)
    fillRoundRect(px, size, size, 101*S, (200+i*34)*S, 8*S, 16*S, 3*S, DARK);

  // ── three dots at bottom (abstract "RND" label) ──
  for (let i = 0; i < 3; i++)
    fillCircle(px, size, size, (220+i*24)*S, 368*S, 4*S, LENS);

  return makePNG(size, size, px);
}

// ── generate ────────────────────────────────────────────────────
const outDir = path.join(__dirname, "..", "public");

const png192 = drawIcon(192);
fs.writeFileSync(path.join(outDir, "icon-192.png"), png192);
console.log("wrote icon-192.png (" + png192.length + " bytes)");

const png512 = drawIcon(512);
fs.writeFileSync(path.join(outDir, "icon-512.png"), png512);
console.log("wrote icon-512.png (" + png512.length + " bytes)");
