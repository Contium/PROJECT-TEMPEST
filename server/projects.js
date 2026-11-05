// Projects: each one isolates everything the user makes. A project is a folder
//
//   <data>/v1/projects/<id>/project.json     { id, name, description, theme, settings, createdAt, updatedAt, openedAt }
//   <data>/v1/projects/<id>/presets/…        its presets      (server/presets.js)
//   <data>/v1/projects/<id>/characters/…     its characters   (server/entities.js)
//   <data>/v1/projects/<id>/stories/…        its stories, rumors and events
//   <data>/v1/projects/<id>/items/…          its items
//   <data>/v1/projects/<id>/netcards/…       its net cards (Combat › Netrunning › Card Forge)
//   <data>/v1/projects/<id>/networks/…       its NET architectures (Combat › Netrunning)
//   <data>/v1/projects/<id>/pois/…           its points of interest on the World View globe
//   <data>/v1/projects/<id>/assets/…         its images       (server/assets.js)
//
// so copying, backing up or sharing a project is copying one folder. Deleting a
// project moves its folder to <data>/v1/trash/ instead of erasing it.
//
//   GET    /api/projects                     list (most recently opened first), with counts
//   POST   /api/projects                     create { name, description?, theme? } → project
//   GET    /api/projects/:p                  one project (and marks it opened)
//   PATCH  /api/projects/:p                  rename / describe / set theme / settings (money, maps)
//   DELETE /api/projects/:p                  move to trash
//   *      /api/projects/:p/presets/…   /api/projects/:p/characters…   /api/projects/:p/stories…   /api/projects/:p/items…
//          /api/projects/:p/entities (every kind)   /api/projects/:p/assets…

const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { StoreError, createPresetStore, handlePresets } = require('./presets');
const { createEntityStore, handleEntities } = require('./entities');

// The entity kinds a project stores (folder = route = kind).
const ENTITY_KINDS = ['characters', 'stories', 'items', 'netcards'];
const { createAssetStore, handleAssets } = require('./assets');
const { createPoiStore, handlePois, CITY, SCREAMSHEETS, NETWORKS } = require('./pois');
const SUBS = 'presets|characters|stories|items|netcards|networks|entities|pois|citypois|screamsheets|assets';

const PROJECT_ID = /^proj_[0-9a-f]{8}$/;
const THEME_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const newProjectId = () => `proj_${crypto.randomBytes(4).toString('hex')}`;

// Project settings (money, maps) are checked with the page's own rules.
const loadPoiModel = () => import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'app', 'maps', 'poi-model.js')).href);
const loadSettingsModel = () => import(require('node:url').pathToFileURL(path.join(__dirname, '..', 'app', 'projects', 'settings-model.js')).href);
async function cleanSettings(input) {
  const { normalizeSettings, SettingsError } = await loadSettingsModel();
  try {
    return normalizeSettings(input);
  } catch (err) {
    if (err instanceof SettingsError) throw new StoreError(400, err.message, err.problems);
    throw err;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function createProjectLibrary(v1Dir) {
  const projectsDir = path.join(v1Dir, 'projects');
  const trashDir = path.join(v1Dir, 'trash');
  const stores = new Map(); // id → { presets, assets, characters, stories }
  const ready = migrateLegacy(v1Dir, projectsDir);

  const dirOf = (id) => {
    if (!PROJECT_ID.test(id ?? '')) throw new StoreError(404, 'No such project');
    return path.join(projectsDir, id);
  };
  const metaFile = (id) => path.join(dirOf(id), 'project.json');
  const readMeta = async (id) => {
    await ready;
    try {
      const meta = JSON.parse(await fsp.readFile(metaFile(id), 'utf8'));
      // Projects made before settings existed get the defaults.
      return { ...meta, settings: await cleanSettings(meta.settings).catch(async () => cleanSettings(null)) };
    } catch (err) {
      if (err.code === 'ENOENT') throw new StoreError(404, 'No such project');
      throw err;
    }
  };
  const writeMeta = async (meta) => {
    const file = metaFile(meta.id);
    const tmp = `${file}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    await fsp.rename(tmp, file);
    return meta;
  };
  const countFiles = async (dir, ext) => {
    try {
      return (await fsp.readdir(dir)).filter((n) => !ext || n.endsWith(ext)).length;
    } catch {
      return 0;
    }
  };

  const library = {
    /** The data stores of one project (throws 404 if it doesn't exist). */
    async open(id) {
      await readMeta(id);
      if (!stores.has(id)) {
        const dir = dirOf(id);
        stores.set(id, {
          presets: createPresetStore(path.join(dir, 'presets')),
          ...Object.fromEntries(ENTITY_KINDS.map((k) => [k, createEntityStore(path.join(dir, k), k)])),
          assets: createAssetStore(path.join(dir, 'assets')),
          pois: createPoiStore(path.join(dir, 'pois')),
          citypois: createPoiStore(path.join(dir, 'citypois'), CITY),
          screamsheets: createPoiStore(path.join(dir, 'screamsheets'), SCREAMSHEETS),
          networks: createPoiStore(path.join(dir, 'networks'), NETWORKS),
        });
      }
      return stores.get(id);
    },
    async list() {
      await ready;
      await fsp.mkdir(projectsDir, { recursive: true });
      const out = [];
      for (const id of await fsp.readdir(projectsDir)) {
        if (!PROJECT_ID.test(id)) continue;
        try {
          const meta = await readMeta(id);
          out.push({
            ...meta,
            counts: {
              characters: await countFiles(path.join(dirOf(id), 'characters'), '.json'),
              stories: await countFiles(path.join(dirOf(id), 'stories'), '.json'),
              items: await countFiles(path.join(dirOf(id), 'items'), '.json'),
              presets: (await Promise.all(ENTITY_KINDS.map((k) => countFiles(path.join(dirOf(id), 'presets', k), '.json')))).reduce((a, b) => a + b, 0),
            },
          });
        } catch {
          /* a broken project folder: leave it out rather than break the list */
        }
      }
      return out.sort((a, b) => (b.openedAt ?? b.createdAt).localeCompare(a.openedAt ?? a.createdAt));
    },
    async create(input = {}) {
      await ready;
      const name = text(input.name, 80);
      if (!name) throw new StoreError(400, 'A project needs a name');
      const now = new Date().toISOString();
      const meta = {
        id: newProjectId(), name, description: text(input.description, 400),
        theme: THEME_ID.test(input.theme ?? '') ? input.theme : null,
        settings: await cleanSettings(input.settings),
        createdAt: now, updatedAt: now, openedAt: now,
      };
      await fsp.mkdir(dirOf(meta.id), { recursive: true });
      return writeMeta(meta);
    },
    async get(id, { touch = false } = {}) {
      const meta = await readMeta(id);
      if (!touch) return meta;
      return writeMeta({ ...meta, openedAt: new Date().toISOString() });
    },
    async update(id, patch = {}) {
      const meta = await readMeta(id);
      const next = { ...meta };
      if ('name' in patch) {
        next.name = text(patch.name, 80);
        if (!next.name) throw new StoreError(400, 'A project needs a name');
      }
      if ('description' in patch) next.description = text(patch.description, 400);
      if ('theme' in patch) next.theme = THEME_ID.test(patch.theme ?? '') ? patch.theme : null;
      if ('settings' in patch) next.settings = await cleanSettings(patch.settings);
      next.updatedAt = new Date().toISOString();
      return writeMeta(next);
    },
    /** Every POI on the project's globe: its unique ones (from settings) first, then those placed. */
    async listPois(id, { view = 'gm' } = {}) {
      const stores = await library.open(id);
      const meta = await readMeta(id);
      const { uniquePois } = await loadPoiModel();
      const all = [...uniquePois(meta.settings), ...(await stores.pois.list())];
      return view === 'player' ? all.filter((p) => p.revealed) : all;
    },
    /** Reveal or hide a unique POI (the only change it takes); stored in the project's settings. */
    async setUnique(id, poiId, patch = {}) {
      const { UNIQUE_POIS, uniquePois } = await loadPoiModel();
      const u = UNIQUE_POIS.find((x) => x.id === poiId);
      if (!u) throw new StoreError(404, 'No such point of interest');
      const meta = await readMeta(id);
      const settings = structuredClone(meta.settings);
      settings.maps[u.key] = { ...settings.maps[u.key], revealed: patch.revealed === true };
      const saved = await library.update(id, { settings });
      const poi = uniquePois(saved.settings).find((x) => x.id === poiId);
      if (!poi) throw new StoreError(409, `${u.name} isn't on this project's map (check Project settings)`);
      return poi;
    },
    /** Move the project's folder to the trash (recoverable by moving it back). */
    async remove(id) {
      const meta = await readMeta(id);
      await fsp.mkdir(trashDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      await fsp.rename(dirOf(id), path.join(trashDir, `${id}-${stamp}`));
      stores.delete(id);
      return { ok: true, name: meta.name };
    },
  };
  return library;
}

/**
 * Before projects existed, v1 kept presets, characters and assets directly in
 * <data>/v1. If any of that holds files and no project exists yet, it all moves
 * into a first project; empty leftovers are removed.
 */
async function migrateLegacy(v1Dir, projectsDir) {
  const legacy = ['presets', 'characters', 'assets'].map((n) => [n, path.join(v1Dir, n)]).filter(([, d]) => fs.existsSync(d));
  if (!legacy.length) return;
  const hasFiles = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).some((e) => e.isFile());
  const existing = fs.existsSync(projectsDir) && fs.readdirSync(projectsDir).some((n) => PROJECT_ID.test(n));
  if (!existing && legacy.some(([, d]) => hasFiles(d))) {
    const now = new Date().toISOString();
    const id = newProjectId();
    const dir = path.join(projectsDir, id);
    await fsp.mkdir(dir, { recursive: true });
    for (const [name, from] of legacy) await fsp.rename(from, path.join(dir, name));
    await fsp.writeFile(path.join(dir, 'project.json'), `${JSON.stringify({
      id, name: 'First project', description: 'Everything made before projects existed.', theme: null, createdAt: now, updatedAt: now, openedAt: now,
    }, null, 2)}\n`);
    console.log(`[projects] moved existing presets, characters and images into "First project" (${id})`);
    return;
  }
  // Nothing worth keeping (or projects already exist): tidy up folders that are empty.
  for (const [, dir] of legacy) {
    if (!hasFiles(dir)) await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Route /api/projects/*; `rest` is the path after /api/projects. Returns true when handled. */
async function handleProjects(library, req, res, rest, params, helpers) {
  const { readJson, sendJson } = helpers;
  const m = rest.match(new RegExp(`^(?:\\/([^/]+))?(\\/(?:${SUBS})(?:\\/.*)?)?$`));
  if (!m) return false;
  const id = m[1] ? decodeURIComponent(m[1]) : null;
  const sub = m[2];
  try {
    if (sub) {
      const stores = await library.open(id);
      const [, kind, inner] = sub.match(new RegExp(`^\\/(${SUBS})(.*)$`));
      if (kind === 'presets') return handlePresets(stores.presets, req, res, inner, helpers);
      if (ENTITY_KINDS.includes(kind)) return handleEntities(stores[kind], req, res, inner, params, helpers);
      if (kind === 'pois') {
        // The list includes the project's unique POIs (Night City), which live in its settings.
        if (req.method === 'GET' && !inner) return helpers.sendJson(res, 200, await library.listPois(id, { view: params.get('view') === 'player' ? 'player' : 'gm' })), true;
        const unique = inner.match(/^\/(unique_[a-z0-9_]+)$/);
        if (unique && req.method === 'PUT') return helpers.sendJson(res, 200, await library.setUnique(id, unique[1], await readJson(req))), true;
        if (unique) throw new StoreError(400, 'Built-in points of interest can only be revealed or hidden here; turn them off in Project settings');
        return handlePois(stores.pois, req, res, inner, params, helpers);
      }
      if (kind === 'citypois') return handlePois(stores.citypois, req, res, inner, params, helpers);
      if (kind === 'screamsheets') return handlePois(stores.screamsheets, req, res, inner, params, helpers);
      if (kind === 'networks') return handlePois(stores.networks, req, res, inner, params, helpers);
      if (kind === 'entities') {
        if (req.method !== 'GET' || inner) return false;
        const all = (await Promise.all(ENTITY_KINDS.map((k) => stores[k].list()))).flat();
        return helpers.sendJson(res, 200, all.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))), true;
      }
      return handleAssets(stores.assets, req, res, inner, helpers);
    }
    const route = `${req.method} ${id ? 'one' : 'all'}`;
    if (route === 'GET all') return sendJson(res, 200, await library.list()), true;
    if (route === 'POST all') return sendJson(res, 201, await library.create(await readJson(req))), true;
    if (route === 'GET one') return sendJson(res, 200, await library.get(id, { touch: params.get('open') === '1' })), true;
    if (route === 'PATCH one') return sendJson(res, 200, await library.update(id, await readJson(req))), true;
    if (route === 'DELETE one') return sendJson(res, 200, await library.remove(id)), true;
    return false;
  } catch (err) {
    if (err instanceof StoreError) return sendJson(res, err.status, { error: err.message, problems: err.problems }), true;
    throw err;
  }
}

module.exports = { createProjectLibrary, handleProjects, PROJECT_ID };
