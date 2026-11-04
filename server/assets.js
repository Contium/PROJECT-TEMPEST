// Image storage for characters (portraits, images, galleries): one file per
// image in <data>/v1/assets/<id>, where the id comes from the image's content,
// so the same picture uploaded twice is stored once.
//
//   POST /api/projects/:p/assets       raw PNG/JPEG/GIF/WebP bytes → { id, mime, size }
//   GET  /api/projects/:p/assets/:id   the image
//
// Images are identified by their leading bytes, never by the browser's claimed
// type alone. SVG is refused: it can carry script.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { StoreError } = require('./presets');

const SIGNATURES = [
  ['image/png', (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/gif', (b) => b.subarray(0, 4).toString('latin1') === 'GIF8'],
  ['image/webp', (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP'],
];
const MAX_BYTES = 10 * 1024 * 1024;
const ASSET_ID = /^img_[0-9a-f]{24}$/;

const sniff = (buffer) => SIGNATURES.find(([, test]) => test(buffer))?.[0] ?? null;

function createAssetStore(dir) {
  const ready = fsp.mkdir(dir, { recursive: true });
  return {
    async add(buffer) {
      if (!buffer?.length) throw new StoreError(400, 'No image data received');
      if (buffer.length > MAX_BYTES) throw new StoreError(413, 'Images must be 10 MB or smaller');
      const mime = sniff(buffer);
      if (!mime) throw new StoreError(400, 'Only PNG, JPEG, GIF and WebP images are supported');
      const id = `img_${crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 24)}`;
      await ready;
      const file = path.join(dir, id);
      try {
        await fsp.writeFile(file, buffer, { flag: 'wx' });
      } catch (err) {
        if (err.code !== 'EEXIST') throw err; // already stored
      }
      return { id, mime, size: buffer.length };
    },
    async get(id) {
      if (!ASSET_ID.test(id)) throw new StoreError(404, 'No such image');
      try {
        const data = await fsp.readFile(path.join(dir, id));
        return { mime: sniff(data) ?? 'application/octet-stream', data };
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, 'No such image');
        throw err;
      }
    },
  };
}

async function handleAssets(store, req, res, rest, { readRaw, sendJson }) {
  const m = rest.match(/^(?:\/([^/]+))?$/);
  if (!m) return false;
  try {
    if (req.method === 'POST' && !m[1]) return sendJson(res, 201, await store.add(await readRaw(req, MAX_BYTES + 1))), true;
    if (req.method === 'GET' && m[1]) {
      const { mime, data } = await store.get(decodeURIComponent(m[1]));
      // Ids are content hashes, so a given URL never changes.
      res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
      res.end(data);
      return true;
    }
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message }), true;
    if (err.status === 413) return sendJson(res, 413, { error: 'Images must be 10 MB or smaller' }), true;
    throw err;
  }
}

module.exports = { createAssetStore, handleAssets };
