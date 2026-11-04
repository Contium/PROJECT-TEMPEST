// Points of interest on the World View globe: one JSON file per POI in
// <project>/pois/<id>.json, checked with normalizePoi() (app/maps/poi-model.js).
//
//   GET    /api/projects/:p/pois[?view=player]   list (players: revealed POIs only)
//   POST   /api/projects/:p/pois                 create → poi
//   GET    /api/projects/:p/pois/:id             one POI
//   PUT    /api/projects/:p/pois/:id             save → poi
//   DELETE /api/projects/:p/pois/:id
//
// City Map POIs (app/maps/city-poi-model.js) work the same way under
// /api/projects/:p/citypois, in <project>/citypois/; ?city=nightcity lists one city's.

const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { StoreError } = require('./presets');

const modelOf = (file) => () => import(pathToFileURL(path.join(__dirname, '..', 'app', ...file.split('/'))).href);

// The globe's POIs and the City Maps' POIs share this store; each kind brings its
// own model (checks, id pattern, what players get) and id prefix.
const GLOBE = {
  prefix: 'poi',
  load: async () => {
    const m = await modelOf('maps/poi-model.js')();
    return { ID: m.POI_ID, normalize: m.normalizePoi, Error: m.PoiError, forPlayers: m.forPlayers };
  },
};
const CITY = {
  prefix: 'cpoi',
  load: async () => {
    const m = await modelOf('maps/city-poi-model.js')();
    return { ID: m.CITY_POI_ID, normalize: m.normalizeCityPoi, Error: m.CityPoiError, forPlayers: m.forPlayers };
  },
};

// Screamsheets (World › Screamsheets) are kept the same way: one checked JSON file each.
const SCREAMSHEETS = {
  prefix: 'ss',
  noun: 'screamsheet',
  load: async () => {
    const m = await modelOf('screamsheets/screamsheet-model.js')();
    return { ID: m.SS_ID, normalize: m.normalizeScreamsheet, Error: m.ScreamsheetError, forPlayers: m.forPlayers };
  },
};

function createPoiStore(dir, kind = GLOBE) {
  const loadModel = kind.load;
  const missing = `No such ${kind.noun ?? 'point of interest'}`;
  const ready = fsp.mkdir(dir, { recursive: true });
  const fileOf = async (id) => {
    const { ID } = await loadModel();
    if (!ID.test(id)) throw new StoreError(404, missing);
    await ready;
    return path.join(dir, `${id}.json`);
  };
  const check = async (input) => {
    const { normalize, Error: ModelError } = await loadModel();
    try {
      return normalize(input);
    } catch (err) {
      if (err instanceof ModelError) throw new StoreError(400, err.message, err.problems);
      throw err;
    }
  };
  const write = async (poi) => {
    const file = await fileOf(poi.id);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(poi, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return poi;
  };

  return {
    async list({ view = 'gm', city = null } = {}) {
      await ready;
      const out = [];
      for (const name of await fsp.readdir(dir)) {
        if (!name.endsWith('.json')) continue;
        try {
          const poi = JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
          if (!city || poi.city === city) out.push(poi);
        } catch {
          /* unreadable file: skip it */
        }
      }
      const { forPlayers } = await loadModel();
      out.sort((a, b) => String(a.name ?? a.headline ?? '').localeCompare(String(b.name ?? b.headline ?? ''), undefined, { sensitivity: 'base' }));
      return view === 'player' ? forPlayers(out) : out;
    },
    async get(id) {
      try {
        return JSON.parse(await fsp.readFile(await fileOf(id), 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, missing);
        throw err;
      }
    },
    async create(input) {
      const now = new Date().toISOString();
      const poi = await check({ ...input, createdAt: now, updatedAt: now });
      return write({ ...poi, id: `${kind.prefix}_${crypto.randomBytes(4).toString('hex')}` });
    },
    async save(id, input) {
      const before = await this.get(id);
      const poi = await check({ ...input, createdAt: before.createdAt, updatedAt: new Date().toISOString() });
      return write({ ...poi, id });
    },
    async remove(id) {
      try {
        await fsp.unlink(await fileOf(id));
      } catch (err) {
        if (err.code === 'ENOENT') throw new StoreError(404, missing);
        throw err;
      }
      return { ok: true };
    },
  };
}

async function handlePois(store, req, res, rest, params, { readJson, sendJson }) {
  const m = rest.match(/^(?:\/([^/]+))?$/);
  if (!m) return false;
  const id = m[1] ? decodeURIComponent(m[1]) : null;
  try {
    const route = `${req.method} ${id ? 'one' : 'all'}`;
    if (route === 'GET all') return sendJson(res, 200, await store.list({ view: params.get('view') === 'player' ? 'player' : 'gm', city: params.get('city') || null })), true;
    if (route === 'GET one') return sendJson(res, 200, await store.get(id)), true;
    if (route === 'POST all') return sendJson(res, 201, await store.create(await readJson(req))), true;
    if (route === 'PUT one') return sendJson(res, 200, await store.save(id, await readJson(req))), true;
    if (route === 'DELETE one') return sendJson(res, 200, await store.remove(id)), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message, problems: err.problems }), true;
    throw err;
  }
}

module.exports = { createPoiStore, handlePois, GLOBE, CITY, SCREAMSHEETS };
