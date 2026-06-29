/*
 * Icon generator for Ghost Jobs Detector.
 * Dependency-free: uses only Node's built-in zlib to produce valid PNGs.
 * Generates a purple gradient tile with a stylized ghost mark.
 *
 * Run: node scripts/generate-icons.js
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// --- Minimal PNG encoder ---
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  // Add filter byte (0) per scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

// --- Drawing helpers ---
function setPx(buf, w, x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= w || y >= w) return;
  const i = (y * w + x) * 4;
  // Simple alpha-over blend onto existing pixel.
  const sa = a / 255;
  const da = buf[i + 3] / 255;
  const outA = sa + da * (1 - sa);
  if (outA === 0) return;
  buf[i] = Math.round((r * sa + buf[i] * da * (1 - sa)) / outA);
  buf[i + 1] = Math.round((g * sa + buf[i + 1] * da * (1 - sa)) / outA);
  buf[i + 2] = Math.round((b * sa + buf[i + 2] * da * (1 - sa)) / outA);
  buf[i + 3] = Math.round(outA * 255);
}

function fillRoundRect(buf, w, x0, y0, x1, y1, radius, r, g, b, a) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      // Distance from nearest rounded corner.
      let inside = true;
      const corners = [
        [x0 + radius, y0 + radius],
        [x1 - radius, y0 + radius],
        [x0 + radius, y1 - radius],
        [x1 - radius, y1 - radius],
      ];
      const cx = x < x0 + radius ? x0 + radius : x > x1 - radius ? x1 - radius : x;
      const cy = y < y0 + radius ? y0 + radius : y > y1 - radius ? y1 - radius : y;
      if (
        (x < x0 + radius || x > x1 - radius) &&
        (y < y0 + radius || y > y1 - radius)
      ) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      if (inside) setPx(buf, w, x, y, r, g, b, a);
    }
  }
}

function drawGhost(buf, w, cx, cy, size) {
  // Body: rounded top + wavy bottom. White with subtle shading.
  const halfW = size * 0.4;
  const top = cy - size * 0.5;
  const bottom = cy + size * 0.5;
  // Main body fill.
  for (let y = top; y <= bottom; y++) {
    for (let x = cx - halfW; x <= cx + halfW; x++) {
      const dx = x - cx;
      // Top dome.
      if (y < top + halfW) {
        const dy = y - (top + halfW);
        if (dx * dx + dy * dy > halfW * halfW) continue;
      }
      // Wavy bottom: 3 bumps.
      const wavePhase = (x - (cx - halfW)) / (halfW * 2) * Math.PI * 3;
      const waveY = bottom - Math.sin(wavePhase) * size * 0.08;
      if (y > waveY) continue;
      setPx(buf, w, Math.round(x), Math.round(y), 255, 255, 255, 235);
    }
  }
  // Eyes.
  const eyeY = cy - size * 0.08;
  const eyeOff = size * 0.13;
  for (let dy = -size * 0.06; dy <= size * 0.06; dy++) {
    for (let dx = -size * 0.06; dx <= size * 0.06; dx++) {
      if (dx * dx + dy * dy > (size * 0.06) ** 2) continue;
      setPx(buf, w, Math.round(cx - eyeOff + dx), Math.round(eyeY + dy), 124, 58, 237, 255);
      setPx(buf, w, Math.round(cx + eyeOff + dx), Math.round(eyeY + dy), 124, 58, 237, 255);
    }
  }
}

function makeIcon(size) {
  const buf = Buffer.alloc(size * size * 4); // transparent
  // Gradient background (purple → indigo).
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (x + y) / (size * 2);
      const r = Math.round(124 * (1 - t) + 59 * t);
      const g = Math.round(58 * (1 - t) + 130 * t);
      const b = Math.round(237 * (1 - t) + 246 * t);
      setPx(buf, size, x, y, r, g, b, 0);
    }
  }
  // Rounded tile background.
  const m = Math.max(1, Math.round(size * 0.08));
  fillRoundRect(buf, size, m, m, size - m, size - m, Math.round(size * 0.22), 124, 58, 237, 255);
  // Subtle gradient overlay on tile.
  for (let y = m; y < size - m; y++) {
    for (let x = m; x < size - m; x++) {
      const t = (x + y) / (size * 2);
      const r = Math.round(124 * (1 - t) + 59 * t);
      const g = Math.round(58 * (1 - t) + 130 * t);
      const b = Math.round(237 * (1 - t) + 246 * t);
      setPx(buf, size, x, y, r, g, b, 255);
    }
  }
  drawGhost(buf, size, size / 2, size / 2, size * 0.62);
  return encodePNG(size, size, buf);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const s of [16, 48, 128]) {
  const png = makeIcon(s);
  fs.writeFileSync(path.join(outDir, `icon${s}.png`), png);
  console.log(`✓ icons/icon${s}.png (${png.length} bytes)`);
}
console.log("Done.");