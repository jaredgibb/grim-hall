// Generates the PWA icons with no dependencies: a raw RGBA buffer drawn by hand
// and encoded as PNG with node's own zlib (deflate + CRC32 chunks).
//
//   node tools/make-icons.js
//
// Run it once and commit the output; the game never needs it at runtime.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BRICK = [74, 38, 32];      // the hall's own palette, from js/art.js
const MORTAR = [34, 22, 18];
const GLOW = [224, 138, 74];
const DARK = [10, 5, 5];

const GLYPH = {
  G: ['11111', '10000', '10000', '10111', '10001', '10001', '11111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
};

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([head, body, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0;                              // filter type 0: none
    rgba.copy(raw, row + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Deterministic per-brick grain: no Math.random, so the same run always writes
// the same bytes.
const grain = (x, y) => {
  const h = (x * 73856093) ^ (y * 193491391);
  return ((h >>> 8) & 15) - 7;
};

function draw(size) {
  const px = Buffer.alloc(size * size * 4);
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
  };

  const course = Math.max(4, Math.round(size / 12));   // brick height
  const brick = Math.max(8, Math.round(size / 6));     // brick width

  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / course);
    const offset = row % 2 ? brick / 2 : 0;
    for (let x = 0; x < size; x++) {
      const col = Math.floor((x + offset) / brick);
      const seamX = (x + offset) % brick === 0;
      const seamY = y % course === 0;
      if (seamX || seamY) { put(x, y, MORTAR[0], MORTAR[1], MORTAR[2]); continue; }
      const n = grain(col, row);
      put(x, y, BRICK[0] + n, BRICK[1] + n, BRICK[2] + n);
    }
  }

  // a torch glow behind the monogram, squared falloff so it reads as light
  const cx = size / 2, cy = size / 2, rad = size * 0.42;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad;
      if (d >= 1) continue;
      const k = (1 - d * d) * 0.35;
      const i = (y * size + x) * 4;
      px[i] = Math.min(255, px[i] + GLOW[0] * k);
      px[i + 1] = Math.min(255, px[i + 1] + GLOW[1] * k);
      px[i + 2] = Math.min(255, px[i + 2] + GLOW[2] * k);
    }
  }

  // "GH" stamped in the middle, one glyph cell per pixel block
  const cells = GLYPH.G.length + 1 + GLYPH.H.length;   // 5 + gap + 5
  const cell = Math.max(4, Math.floor(size * 0.58 / cells));
  const ox = Math.floor((size - cells * cell) / 2);
  const oy = Math.floor((size - 7 * cell) / 2);
  const stamp = (glyph, gx) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] !== '1') continue;
        for (let dy = 0; dy < cell; dy++)
          for (let dx = 0; dx < cell; dx++)
            put(gx + c * cell + dx, oy + r * cell + dy, GLOW[0], GLOW[1], GLOW[2]);
      }
    }
  };
  stamp(GLYPH.G, ox);
  stamp(GLYPH.H, ox + 6 * cell);

  // letterbox bars, so the icon still reads when a launcher crops it square
  for (let y = 0; y < Math.max(1, Math.floor(size * 0.04)); y++) {
    for (let x = 0; x < size; x++) { put(x, y, DARK[0], DARK[1], DARK[2]); put(x, size - 1 - y, DARK[0], DARK[1], DARK[2]); }
  }
  return px;
}

const out = path.join(__dirname, '..', 'icons');
fs.mkdirSync(out, { recursive: true });
for (const size of [192, 512]) {
  const file = path.join(out, 'icon-' + size + '.png');
  fs.writeFileSync(file, encodePNG(size, draw(size)));
  console.log('wrote ' + file);
}
