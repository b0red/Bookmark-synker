// Draws the extension icons, the app icon and the Microsoft Store tiles (a blue tile with a little house; its door is a bookmark ribbon). No dependencies.
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

// The icon: "a home for your bookmarks". A blue rounded tile, a little off-white house, and an orange bookmark ribbon as its door.
// Shapes are in a 100 × 100 grid. Later layers paint over earlier ones.
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const inPoly = (pts) => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const inRoundRect = (x0, y0, x1, y1, r) => (x, y) => {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r), cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
};
const LAYERS = [
  { color: hex('#00A3CC'), test: inRoundRect(0, 0, 100, 100, 22) },                                         // tile
  { color: hex('#FBF6EC'), test: inRoundRect(62, 22, 71, 40, 2) },                                          // chimney
  { color: hex('#FBF6EC'), test: inPoly([[50, 17], [85, 47], [78, 47], [78, 83], [22, 83], [22, 47], [15, 47]]) }, // house
  { color: hex('#E8833A'), test: inPoly([[42, 52], [58, 52], [58, 83], [50, 75], [42, 83]]) },                // ribbon door
];

// size: the tile; w × h: the image, with the tile centered on a transparent background (for wide Store tiles).
function icon(size, w = size, h = size) {
  const ox = (w - size) / 2, oy = (h - size) / 2;
  const S = 8; // supersampling for smooth edges
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const u = ((x - ox + (sx + 0.5) / S) / size) * 100, v = ((y - oy + (sy + 0.5) / S) / size) * 100;
      let c = null;
      for (const l of LAYERS) if (l.test(u, v)) c = l.color;
      if (c) { r += c[0]; g += c[1]; b += c[2]; n++; }
    }
    const i = (y * w + x) * 4;
    if (n) { px[i] = Math.round(r / n); px[i + 1] = Math.round(g / n); px[i + 2] = Math.round(b / n); }
    px[i + 3] = Math.round((255 * n) / (S * S));
  }
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

for (const s of [16, 48, 128]) fs.writeFileSync(path.join(__dirname, '..', 'extension', `icon${s}.png`), icon(s));

// The app icon for the installer and Windows (taskbar, Start menu): an .ico holding PNGs from 16 to 256 px.
function ico(sizes) {
  const pngs = sizes.map((s) => icon(s));
  const head = Buffer.alloc(6 + 16 * sizes.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
  let offset = head.length;
  sizes.forEach((s, i) => {
    const e = 6 + 16 * i;
    head[e] = s >= 256 ? 0 : s; head[e + 1] = s >= 256 ? 0 : s; // 0 means 256
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(pngs[i].length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += pngs[i].length;
  });
  return Buffer.concat([head, ...pngs]);
}
fs.mkdirSync(path.join(__dirname, '..', 'build'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'build', 'icon.ico'), ico([16, 24, 32, 48, 64, 128, 256]));

// Microsoft Store (MSIX) tiles, used by "npm run dist:store".
const appx = path.join(__dirname, '..', 'build', 'appx');
fs.mkdirSync(appx, { recursive: true });
const tiles = { 'StoreLogo.png': [50], 'Square44x44Logo.png': [44], 'Square150x150Logo.png': [150, 150, 150], 'Wide310x150Logo.png': [150, 310, 150] };
for (const [name, [size, w, h]] of Object.entries(tiles)) fs.writeFileSync(path.join(appx, name), icon(size, w, h));
console.log('icons written');
