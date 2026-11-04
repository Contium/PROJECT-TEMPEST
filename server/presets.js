// Preset storage: one JSON file per preset in <data>/v1/presets/<kind>/<id>.json.
// Every save and import is checked with the same normalizePreset() the
// designer uses (app/forge/preset-model.js), so a hand-edited or imported file
// can't put the store into a bad state.
//
//   GET    /api/projects/:p/presets/:kind            list  [{ id, name, updatedAt, fields, sections }]
//   GET    /api/projects/:p/presets/:kind/:id        one preset
//   POST   /api/projects/:p/presets/:kind            create or import (always gets a fresh id) → preset
//   PUT    /api/projects/:p/presets/:kind/:id        save → preset
//   DELETE /api/projects/:p/presets/:kind/:id

const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const modelUrl = pathToFileURL(path.join(__dirname, '..', 'app', 'forge', 'preset-model.js')).href;
const loadModel = () => import(modelUrl);

class StoreError extends Error {
  constructor(status, message, problems = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

function createPresetStore(rootDir) {
  const dirOf = async (kind) => {
    const { PRESET_KINDS } = await loadModel();
    if (!PRESET_KINDS.includes(kind)) throw new StoreError(404, `No presets of kind "${kind}"`);
    const dir = path.join(rootDir, kind);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  };
  const fileOf = async (kind, id) => {
    const { PRESET_ID } = await loadModel();
    if (!PRESET_ID.test(id)) throw new StoreError(404, 'No such preset');
    return path.join(await dirOf(kind), `${id}.json`);
  };
  const check = async (input, kind) => {
    const { normalizePreset, PresetError } = await loadModel();
    try {
      const preset = normalizePreset(input);
      if (preset.kind !== kind) throw new PresetError([`This is a ${preset.kind} preset, not a ${kind} one`]);
      return preset;
    } catch (err) {
      if (err instanceof PresetError) throw new StoreError(400, err.message, err.problems);
      throw err;
    }
  };
  // Write to a temporary file and rename, so a crash never leaves half a preset.
  const write = async (file, preset) => {
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(preset, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return preset;
  };

  return {
    async list(kind) {
      const dir = await dirOf(kind);
      const out = [];
      for (const name of await fsp.readdir(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const p = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
          out.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, fields: Object.keys(p.fields ?? {}).length, sections: p.layout?.sections?.length ?? 0 });
        } catch {
          /* unreadable file: skip it rather than break the list */
        }
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    },
    async get(kind, id) {
      try {
        return JSON.parse(await fsp.readFile(await fileOf(kind, id), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, 'No such preset');
        throw err;
      }
    },
    /** Create, or import: the preset always gets a fresh id so it never overwrites another. */
    async create(kind, input) {
      const { newId } = await loadModel();
      const now = new Date().toISOString();
      const preset = await check({ ...input, id: newId('preset'), createdAt: now, updatedAt: now }, kind);
      return write(await fileOf(kind, preset.id), preset);
    },
    async save(kind, id, input) {
      const file = await fileOf(kind, id);
      const before = await this.get(kind, id);
      const preset = await check({ ...input, id, createdAt: before.createdAt, updatedAt: new Date().toISOString() }, kind);
      return write(file, preset);
    },
    async remove(kind, id) {
      try {
        await fsp.unlink(await fileOf(kind, id));
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, 'No such preset');
        throw err;
      }
      return { ok: true };
    },
  };
}

/** Route /api/presets/*; `rest` is the path after /api/presets. Returns true when handled. */
async function handlePresets(store, req, res, rest, { readJson, sendJson }) {
  const m = rest.match(/^\/([a-z]+)(?:\/([^/]+))?$/);
  if (!m) return false;
  const [, kind, id] = m;
  try {
    const route = `${req.method} ${id ? 'one' : 'all'}`;
    if (route === 'GET all') return sendJson(res, 200, await store.list(kind)), true;
    if (route === 'GET one') return sendJson(res, 200, await store.get(kind, decodeURIComponent(id))), true;
    if (route === 'POST all') return sendJson(res, 201, await store.create(kind, await readJson(req))), true;
    if (route === 'PUT one') return sendJson(res, 200, await store.save(kind, decodeURIComponent(id), await readJson(req))), true;
    if (route === 'DELETE one') return sendJson(res, 200, await store.remove(kind, decodeURIComponent(id))), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message, problems: err.problems }), true;
    throw err;
  }
}

module.exports = { createPresetStore, handlePresets, StoreError };
