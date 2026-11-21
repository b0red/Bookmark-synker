// Draws the extension icons (blue rounded tile with a white bookmark ribbon) as PNGs. No dependencies.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function icon(size) {
  const S = 4; // supersampling for smooth edges
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22; // corner radius
  const inTile = (x, y) => {
    const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  // Ribbon: a rectangle with a V notch cut from the bottom.
  const L = size * 0.32, R = size * 0.68, T = size * 0.2, B = size * 0.8, notch = size * 0.16;
  const inRibbon = (x, y) => {
    if (x < L || x > R || y < T || y > B) return false;
    const mid = (L + R) / 2, half = (R - L) / 2;
    const notchTop = B - notch * (1 - Math.abs(x - mid) / half);
    return y < notchTop;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let tile = 0, rib = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const fx = x + (sx + 0.5) / S, fy = y + (sy + 0.5) / S;
      if (inTile(fx, fy)) { tile++; if (inRibbon(fx, fy)) rib++; }
    }
    const a = tile / (S * S), w = tile ? rib / tile : 0;
    const i = (y * size + x) * 4;
    px[i] = Math.round(0x3d + (255 - 0x3d) * w);
    px[i + 1] = Math.round(0x6e + (255 - 0x6e) * w);
    px[i + 2] = Math.round(0xf5 + (255 - 0xf5) * w);
    px[i + 3] = Math.round(255 * a);
  }
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [16, 48, 128]) fs.writeFileSync(path.join(__dirname, '..', 'extension', `icon${s}.png`), icon(s));
console.log('icons written');
