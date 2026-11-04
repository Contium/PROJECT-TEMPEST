// Generates assets/tempest.ico (16–256px) and assets/tempest-256.png from vector
// shapes, so the icon needs no image tooling. Run: node scripts/make-icon.js

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const OUT_DIR = path.resolve(__dirname, '..', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];
const SUPERSAMPLE = 4;

const BG = [0x0e, 0x0e, 0x17];
const RED = [0xf7, 0x50, 0x49];
const CYAN = [0x5e, 0xf6, 0xff];

// Shapes in unit space (0..1). Chamfered square: top-right and bottom-left cut.
const CUT = 0.2;
const EDGE = 0.06;
const inChamfer = (x, y, inset = 0) =>
  x >= inset && x <= 1 - inset && y >= inset && y <= 1 - inset &&
  y >= x - (1 - CUT) + inset * Math.SQRT2 &&
  y <= x + (1 - CUT) - inset * Math.SQRT2;
const inRect = (x, y, x0, y0, x1, y1) => x >= x0 && x <= x1 && y >= y0 && y <= y1;

// Returns [r,g,b,a] for a sample point, painter's order (last match wins).
function sample(x, y) {
  if (!inChamfer(x, y)) return [0, 0, 0, 0];
  let c = [...RED, 255]; // frame
  if (inChamfer(x, y, EDGE)) c = [...BG, 255];
  if (inRect(x, y, 0.24, 0.24, 0.76, 0.37)) c = [...RED, 255]; // T bar
  if (inRect(x, y, 0.435, 0.37, 0.565, 0.78)) c = [...RED, 255]; // T stem
  if (inRect(x, y, 0.64, 0.66, 0.74, 0.76)) c = [...CYAN, 255]; // interactive pip
  return c;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const [cr, cg, cb, ca] = sample((pxl + (sx + 0.5) / SUPERSAMPLE) / size, (py + (sy + 0.5) / SUPERSAMPLE) / size);
          r += cr * ca; g += cg * ca; b += cb * ca; a += ca;
        }
      }
      const i = (py * size + pxl) * 4;
      px[i] = a ? Math.round(r / a) : 0;
      px[i + 1] = a ? Math.round(g / a) : 0;
      px[i + 2] = a ? Math.round(b / a) : 0;
      px[i + 3] = Math.round(a / n);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ICO container with PNG-compressed entries (supported since Windows Vista).
function encodeIco(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e.writeUInt16LE(1, 4); // planes
    e.writeUInt16LE(32, 6); // bpp
    e.writeUInt32LE(data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += data.length;
    return e;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const pngs = SIZES.map((size) => ({ size, data: encodePng(size, render(size)) }));
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'tempest.ico'), encodeIco(pngs));
fs.writeFileSync(path.join(OUT_DIR, 'tempest-256.png'), pngs.at(-1).data);
console.log(`Wrote assets/tempest.ico (${SIZES.join(', ')}px) and assets/tempest-256.png`);
